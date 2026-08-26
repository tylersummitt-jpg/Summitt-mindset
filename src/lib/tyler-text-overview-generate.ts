import { type DailySmsBuilt } from "@/lib/daily-sms-build";
import { loadMorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { writeMorningTtoBody } from "@/lib/morning-tto-writer";
import {
  assembleMorningBriefInterpreterInputFromPacket,
  countRecentUnansweredOutboundFromExactThread,
  loadMorningBriefCanonicalExtrasV1,
} from "@/lib/morning-tto-brief-canonical-load-v1";
import {
  buildLowConfidenceUnknownBriefFromCanonical,
  buildMorningBriefInterpreterMetadataV1,
  runMorningBriefInterpreterV1,
} from "@/lib/morning-tto-brief-interpreter-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { getClerkUser } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import {
  requireTylerTextOverviewDraftDayKey,
  resolveTylerTextOverviewEveningDraftForDayKey,
} from "@/lib/tyler-text-overview-draft-day-key";
import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";
import {
  isTylerTextOverviewEnabled,
  isProtectedFromMorningDraftOverwrite,
  isProtectedTylerProvenanceDraft,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  type SmsDailySendSlot,
  type TylerTextOverviewGenerationReason,
  type TylerTextOverviewNotebookVerdict,
} from "@/lib/tyler-text-overview-types";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipDailyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { hashWriterOpenAiMessages } from "@/lib/tyler-text-overview-writer-capture";
import {
  MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
  clampProactiveDecision,
  isIntentionalSpaceDecision,
  resolveQuietRelationshipMechanicalFacts,
} from "@/lib/sms-proactive-relationship-touch";

export const MORNING_RELATIONSHIP_ROUTE_KIND = "morning_relationship" as const;

/** Slots where Tyler-saved draft bodies (including intentional blank) survive regenerate. */
function isProtectedTtoOverwriteSlot(sendSlot: SmsDailySendSlot): boolean {
  return (
    sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT ||
    sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT ||
    sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT
  );
}

function existingCurrentDraftBlocksOverwrite(args: {
  sendSlot: SmsDailySendSlot;
  respectProtectedMorningDraft?: boolean;
  protectTylerProvenanceOnly?: boolean;
  existing: {
    status: string;
    current_body_to_send: string | null;
    edited_by_tyler: boolean;
    current_body_source: string | null;
  } | null;
}): boolean {
  if (args.respectProtectedMorningDraft === false) return false;
  if (!isProtectedTtoOverwriteSlot(args.sendSlot)) return false;
  if (!args.existing || args.existing.status !== "current") return false;
  if (args.protectTylerProvenanceOnly === true) {
    return isProtectedTylerProvenanceDraft({
      edited_by_tyler: args.existing.edited_by_tyler,
      current_body_source: args.existing.current_body_source,
    });
  }
  return isProtectedFromMorningDraftOverwrite({
    current_body_to_send: args.existing.current_body_to_send,
    edited_by_tyler: args.existing.edited_by_tyler,
    current_body_source: args.existing.current_body_source,
  });
}

function mapOpenAiMessagesToWriterCapture(
  messages: Array<{ role: string; content?: unknown }>
): TylerTextOverviewWriterOpenAiMessage[] {
  return messages
    .filter(
      (m): m is { role: "system" | "user" | "assistant"; content: string } =>
        (m.role === "system" || m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

export type TylerTextOverviewAudienceRow = {
  clerk_user_id: string;
  phone_number: string | null;
  sms_enabled: boolean;
  stopped_at: string | null;
  timezone: string | null;
  summitt_subscribed: boolean;
};

export type TylerTextOverviewGenerateStats = {
  ok: boolean;
  enabled: boolean;
  /** Canonical batch draft day when provided; null only on early invalid-arg failure. */
  draft_for_day_key: string | null;
  scanned: number;
  eligible: number;
  generated: number;
  generation_inserted: number;
  current_drafts_upserted: number;
  skipped_disabled: number;
  skipped_audience: number;
  skipped_not_v2: number;
  skipped_comms_prefs: number;
  build_failed: number;
  insert_failed: number;
  upsert_failed: number;
  supersede_failed: number;
  errors_preview: string[];
};

function emptyStats(overrides: Partial<TylerTextOverviewGenerateStats> = {}): TylerTextOverviewGenerateStats {
  return {
    ok: true,
    enabled: false,
    draft_for_day_key: null,
    scanned: 0,
    eligible: 0,
    generated: 0,
    generation_inserted: 0,
    current_drafts_upserted: 0,
    skipped_disabled: 0,
    skipped_audience: 0,
    skipped_not_v2: 0,
    skipped_comms_prefs: 0,
    build_failed: 0,
    insert_failed: 0,
    upsert_failed: 0,
    supersede_failed: 0,
    errors_preview: [],
    ...overrides,
  };
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const raw = metadata[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function readMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const raw = metadata[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const raw = metadata[key];
  if (typeof raw === "boolean") return raw;
  return null;
}

function readMetadataObject(metadata: Record<string, unknown>, key: string): unknown {
  const raw = metadata[key];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return null;
}

function metadataFromBuilt(built: DailySmsBuilt): Record<string, unknown> {
  if (!built.ok && built.dailyLaneMeta) {
    return built.dailyLaneMeta;
  }
  if (built.ok && built.v2AiPayload?.v3_brain && typeof built.v2AiPayload.v3_brain === "object") {
    return built.v2AiPayload.v3_brain as Record<string, unknown>;
  }
  return {};
}

export function resolveTylerTextOverviewMachineNoSendReason(built: DailySmsBuilt): string | null {
  if (built.ok) return null;
  const meta = metadataFromBuilt(built);
  const laneReason = readMetadataString(meta, "no_send_reason");
  if (laneReason) return laneReason;
  const skipSource = readMetadataString(meta, "skip_source");
  if (skipSource) return skipSource;
  return built.error;
}

export function resolveTylerTextOverviewRouteKind(built: DailySmsBuilt): string | null {
  const meta = metadataFromBuilt(built);
  return readMetadataString(meta, "route_purpose") ?? readMetadataString(meta, "route_kind");
}

export function resolveTylerTextOverviewNotebookFields(built: DailySmsBuilt): {
  notebook_verdict: TylerTextOverviewNotebookVerdict;
  notebook_verdict_reason: string;
  notebook_source_candidate_count: number | null;
  notebook_exact_source_message_count: number | null;
  notebook_thread_message_count: number | null;
  notebook_filtered_out_reason_top: string | null;
} {
  const meta = metadataFromBuilt(built);
  const capturePresent = Boolean(built.writerOpenAiCapture?.messages?.length);

  if (Object.keys(meta).length > 0) {
    const verdictRaw = readMetadataString(meta, "notebook_verdict");
    const verdict: TylerTextOverviewNotebookVerdict =
      verdictRaw === "verified" || verdictRaw === "failed" || verdictRaw === "not_applicable"
        ? verdictRaw
        : "not_applicable";
    return {
      notebook_verdict: verdict,
      notebook_verdict_reason:
        readMetadataString(meta, "notebook_verdict_reason") ??
        (capturePresent ? "unknown_missing_telemetry" : "writer_not_invoked"),
      notebook_source_candidate_count: readMetadataNumber(meta, "notebook_source_candidate_count"),
      notebook_exact_source_message_count: readMetadataNumber(
        meta,
        "notebook_exact_source_message_count"
      ),
      notebook_thread_message_count: readMetadataNumber(meta, "notebook_brief_thread_message_count"),
      notebook_filtered_out_reason_top: readMetadataString(meta, "notebook_filtered_out_reason_top"),
    };
  }

  if (!capturePresent) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "writer_not_invoked",
      notebook_source_candidate_count: null,
      notebook_exact_source_message_count: null,
      notebook_thread_message_count: null,
      notebook_filtered_out_reason_top: null,
    };
  }

  return {
    notebook_verdict: "not_applicable",
    notebook_verdict_reason: "unknown_missing_telemetry",
    notebook_source_candidate_count: null,
    notebook_exact_source_message_count: null,
    notebook_thread_message_count: null,
    notebook_filtered_out_reason_top: null,
  };
}

export function buildTylerTextOverviewGenerationMetadata(args: {
  built: DailySmsBuilt;
  draftForDayKey: string;
  capturePresent: boolean;
}): Record<string, unknown> {
  const meta = metadataFromBuilt(args.built);
  return {
    build_ok: args.built.ok,
    build_error: args.built.ok ? null : args.built.error,
    draft_for_day_key: args.draftForDayKey,
    capture_present: args.capturePresent,
    machine_no_send_reason: resolveTylerTextOverviewMachineNoSendReason(args.built),
    route_kind: resolveTylerTextOverviewRouteKind(args.built),
    lane_stage: readMetadataString(meta, "lane_stage"),
    skip_source: readMetadataString(meta, "skip_source"),
    silence_cadence_route: readMetadataString(meta, "silence_cadence_route"),
    silence_day: readMetadataNumber(meta, "silence_day"),
    send_today: readMetadataBoolean(meta, "send_today"),
    intentional_space: readMetadataBoolean(meta, "intentional_space"),
    no_send_reason: readMetadataString(meta, "no_send_reason"),
    v3_daily_relationship_lane: args.built.ok ? args.built.v3DailyRelationshipLane ?? null : null,
    v3_daily_sms: args.built.ok ? args.built.v3DailySms ?? null : null,
    slot_coaching_context: readMetadataObject(meta, "slot_coaching_context"),
    current_send_slot: readMetadataString(meta, "current_send_slot"),
    post_writer_checks_softened_for_tto: readMetadataBoolean(meta, "post_writer_checks_softened_for_tto"),
    primary_writer_should_send: readMetadataBoolean(meta, "primary_writer_should_send"),
    primary_writer_no_send_reason: readMetadataString(meta, "primary_writer_no_send_reason"),
    draft_content_warnings: Array.isArray(meta.draft_content_warnings)
      ? meta.draft_content_warnings.filter((x): x is string => typeof x === "string")
      : null,
  };
}

export function formatSendPrefSnapshot(
  clerkSmsTimePreference: string,
  commsPrefs: Awaited<ReturnType<typeof fetchV2UserSmsCommsPreferences>>
): string {
  const parts = [`clerk:${clerkSmsTimePreference}`];
  if (commsPrefs?.preferred_send_window) {
    parts.push(`window:${commsPrefs.preferred_send_window}`);
  }
  if (commsPrefs?.preferred_local_hour != null) {
    parts.push(`hour:${commsPrefs.preferred_local_hour}`);
  }
  return parts.join("|");
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return (error.message ?? "").toLowerCase().includes("duplicate");
}

async function fetchNextGenerationNumber(
  clerkUserId: string,
  draftForDayKey: string,
  sendSlot: SmsDailySendSlot = SMS_DAILY_PRODUCTION_SEND_SLOT
): Promise<number> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("generation_number")
    .eq("clerk_user_id", clerkUserId)
    .eq("draft_for_day_key", draftForDayKey)
    .eq("send_slot", sendSlot)
    .order("generation_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`generation_number_lookup_failed:${error.message}`);
  }

  const max = typeof data?.generation_number === "number" ? data.generation_number : 0;
  return max + 1;
}

export type TylerTextOverviewGenerationInsertRow = {
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: SmsDailySendSlot;
  generation_number: number;
  generation_reason: TylerTextOverviewGenerationReason;
  commitment_id: string | null;
  machine_draft_body: string | null;
  machine_should_send: boolean;
  machine_no_send_reason: string | null;
  writer_openai_messages: TylerTextOverviewWriterOpenAiMessage[];
  writer_prompt_path: string | null;
  writer_notebook_snapshot: null;
  notebook_hash: string | null;
  notebook_verdict: TylerTextOverviewNotebookVerdict;
  notebook_verdict_reason: string;
  notebook_source_candidate_count: number | null;
  notebook_exact_source_message_count: number | null;
  notebook_thread_message_count: number | null;
  notebook_filtered_out_reason_top: string | null;
  route_kind: string | null;
  generation_metadata: Record<string, unknown>;
  timezone_snapshot: string;
  send_pref_snapshot: string;
  machine_body_hash: string | null;
};

export function mapBuiltToTylerTextOverviewGenerationRow(args: {
  clerkUserId: string;
  draftForDayKey: string;
  generationNumber: number;
  generationReason?: TylerTextOverviewGenerationReason;
  built: DailySmsBuilt;
  commitmentId: string | null;
  timezone: string;
  sendPrefSnapshot: string;
  sendSlot?: SmsDailySendSlot;
  generationMetadataExtra?: Record<string, unknown>;
}): TylerTextOverviewGenerationInsertRow {
  const machineBody = args.built.ok ? args.built.smsBody.trim() || null : null;
  const capture = args.built.writerOpenAiCapture ?? null;
  const notebook = resolveTylerTextOverviewNotebookFields(args.built);
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;

  return {
    clerk_user_id: args.clerkUserId,
    draft_for_day_key: args.draftForDayKey,
    send_slot: sendSlot,
    generation_number: args.generationNumber,
    generation_reason: args.generationReason ?? "noon_batch",
    commitment_id: args.commitmentId,
    machine_draft_body: machineBody,
    machine_should_send: args.built.ok === true,
    machine_no_send_reason: resolveTylerTextOverviewMachineNoSendReason(args.built),
    writer_openai_messages: capture?.messages ?? [],
    writer_prompt_path: capture?.writer_prompt_path ?? null,
    writer_notebook_snapshot: null,
    notebook_hash: capture?.notebook_hash ?? null,
    notebook_verdict: notebook.notebook_verdict,
    notebook_verdict_reason: notebook.notebook_verdict_reason,
    notebook_source_candidate_count: notebook.notebook_source_candidate_count,
    notebook_exact_source_message_count: notebook.notebook_exact_source_message_count,
    notebook_thread_message_count: notebook.notebook_thread_message_count,
    notebook_filtered_out_reason_top: notebook.notebook_filtered_out_reason_top,
    route_kind: resolveTylerTextOverviewRouteKind(args.built),
    generation_metadata: {
      ...buildTylerTextOverviewGenerationMetadata({
        built: args.built,
        draftForDayKey: args.draftForDayKey,
        capturePresent: Boolean(capture?.messages?.length),
      }),
      ...(args.generationMetadataExtra ?? {}),
    },
    timezone_snapshot: args.timezone,
    send_pref_snapshot: args.sendPrefSnapshot,
    machine_body_hash: machineBody ? hashSmsSnippet(machineBody) : null,
  };
}

export function mapMorningWriterToGenerationRow(args: {
  clerkUserId: string;
  draftForDayKey: string;
  generationNumber: number;
  generationReason?: TylerTextOverviewGenerationReason;
  commitmentId: string | null;
  timezone: string;
  sendPrefSnapshot: string;
  sendSlot?: SmsDailySendSlot;
  success?: {
    body: string;
    messages: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath: "morning_brief_writer_v1" | "morning_relationship_v1" | "weekly_brief_writer_v1";
    model?: string;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
    writerCapture?: Record<string, unknown>;
  };
  failure?: {
    error: string;
    messages?: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath?: string | null;
    model?: string | null;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
    writerCapture?: Record<string, unknown>;
  };
  packetMetadata?: {
    thread_message_count: number;
    days_since_last_user_response: number | null;
    never_replied: boolean;
    has_pending_goal_change: boolean;
  };
  generationMetadataExtra?: Record<string, unknown>;
  routeKind?: string;
  notebookVerdictReason?: string;
}): TylerTextOverviewGenerationInsertRow {
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const messages = args.success?.messages ?? args.failure?.messages ?? [];
  const capturePresent = messages.length > 0;
  const machineBody = args.success?.body.trim() || null;
  const writerPromptPath =
    args.success?.writerPromptPath ?? args.failure?.writerPromptPath ?? null;
  const failureError = args.failure?.error ?? "unknown_morning_writer_failure";
  const model =
    args.success?.model?.trim() ||
    args.failure?.model?.trim() ||
    null;
  const retryMessages =
    args.success?.retryMessages ?? args.failure?.retryMessages ?? [];
  const retryOccurred =
    args.success?.retryOccurred === true ||
    args.failure?.retryOccurred === true ||
    retryMessages.length > 0;
  const retrySucceeded =
    args.success?.retrySucceeded ?? args.failure?.retrySucceeded ?? null;
  const writerCapture =
    args.success?.writerCapture ?? args.failure?.writerCapture ?? null;

  return {
    clerk_user_id: args.clerkUserId,
    draft_for_day_key: args.draftForDayKey,
    send_slot: sendSlot,
    generation_number: args.generationNumber,
    generation_reason: args.generationReason ?? "noon_batch",
    commitment_id: args.commitmentId,
    machine_draft_body: machineBody,
    machine_should_send: Boolean(args.success),
    machine_no_send_reason: args.success ? null : failureError,
    writer_openai_messages: messages,
    writer_prompt_path: writerPromptPath,
    writer_notebook_snapshot: null,
    notebook_hash: capturePresent ? hashWriterOpenAiMessages(messages) : null,
    notebook_verdict: "not_applicable",
    notebook_verdict_reason:
      args.notebookVerdictReason ??
      (capturePresent ? "morning_brief_writer_ran" : "writer_not_invoked"),
    notebook_source_candidate_count: null,
    notebook_exact_source_message_count: null,
    notebook_thread_message_count: args.packetMetadata?.thread_message_count ?? null,
    notebook_filtered_out_reason_top: null,
    route_kind: args.routeKind ?? MORNING_RELATIONSHIP_ROUTE_KIND,
    generation_metadata: {
      packet_version: "morning_relationship_v1",
      build_ok: Boolean(args.success),
      ...(args.success ? {} : { error: failureError }),
      draft_for_day_key: args.draftForDayKey,
      capture_present: capturePresent,
      thread_message_count: args.packetMetadata?.thread_message_count ?? null,
      thread_window_days: 21,
      days_since_last_user_response: args.packetMetadata?.days_since_last_user_response ?? null,
      never_replied: args.packetMetadata?.never_replied ?? null,
      has_pending_goal_change: args.packetMetadata?.has_pending_goal_change ?? null,
      ...(model ? { writer_model: model } : {}),
      morning_writer_capture_v1: writerCapture
        ? {
            ...writerCapture,
            retry_messages: retryOccurred ? retryMessages : [],
          }
        : {
            model,
            temperature: null,
            reasoning_effort: null,
            max_completion_tokens: null,
            retry_occurred: retryOccurred,
            retry_succeeded: retryOccurred ? retrySucceeded : null,
            retry_messages: retryOccurred ? retryMessages : [],
            raw_response: null,
            raw_retry_response: null,
            error: args.success ? null : failureError,
          },
      ...(args.generationMetadataExtra ?? {}),
    },
    timezone_snapshot: args.timezone,
    send_pref_snapshot: args.sendPrefSnapshot,
    machine_body_hash: machineBody ? hashSmsSnippet(machineBody) : null,
  };
}

export async function persistMorningTtoGeneration(args: {
  clerkUserId: string;
  draftForDayKey: string;
  generationReason: TylerTextOverviewGenerationReason;
  commitmentId: string | null;
  timezone: string;
  sendPrefSnapshot: string;
  now: Date;
  sendSlot?: SmsDailySendSlot;
  success?: {
    body: string;
    messages: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath: "morning_brief_writer_v1" | "morning_relationship_v1" | "weekly_brief_writer_v1";
    model?: string;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
    writerCapture?: Record<string, unknown>;
  };
  failure?: {
    error: string;
    messages?: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath?: string | null;
    model?: string | null;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
    writerCapture?: Record<string, unknown>;
  };
  packetMetadata?: {
    thread_message_count: number;
    days_since_last_user_response: number | null;
    never_replied: boolean;
    has_pending_goal_change: boolean;
  };
  generationMetadataExtra?: Record<string, unknown>;
  respectProtectedMorningDraft?: boolean;
  /** Weekly explicit regenerate: pin Tyler edit/blank only; allow replacing untouched machine copy. */
  protectTylerProvenanceOnly?: boolean;
  routeKind?: string;
  notebookVerdictReason?: string;
}): Promise<
  | { ok: true; generationId: string; supersedeFailed: boolean; currentDraftProtected?: boolean }
  | { ok: false; reason: "insert_failed" | "upsert_failed"; error?: string }
> {
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  let generationNumber: number;
  try {
    generationNumber = await fetchNextGenerationNumber(
      args.clerkUserId,
      args.draftForDayKey,
      sendSlot
    );
  } catch (e) {
    return {
      ok: false,
      reason: "insert_failed",
      error: e instanceof Error ? e.message : "generation_number_lookup_failed",
    };
  }

  const generationRow = mapMorningWriterToGenerationRow({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    generationNumber,
    generationReason: args.generationReason,
    commitmentId: args.commitmentId,
    timezone: args.timezone,
    sendPrefSnapshot: args.sendPrefSnapshot,
    sendSlot,
    success: args.success,
    failure: args.failure,
    packetMetadata: args.packetMetadata,
    generationMetadataExtra: args.generationMetadataExtra,
    routeKind: args.routeKind,
    notebookVerdictReason: args.notebookVerdictReason,
  });

  const existingDraft = await loadExistingCurrentDraft(
    args.clerkUserId,
    args.draftForDayKey,
    sendSlot
  );
  const protectExistingDraft = existingCurrentDraftBlocksOverwrite({
    sendSlot,
    respectProtectedMorningDraft: args.respectProtectedMorningDraft,
    protectTylerProvenanceOnly: args.protectTylerProvenanceOnly,
    existing: existingDraft,
  });

  const inserted = await insertGenerationRow(generationRow);
  if ("error" in inserted) {
    return { ok: false, reason: "insert_failed", error: inserted.error };
  }

  const nowIso = args.now.toISOString();

  // Protected draft: keep history, but never supersede the still-authoritative generation
  // the draft continues to point at (would leave current_generation_id → superseded row).
  if (protectExistingDraft && existingDraft) {
    const authoritativeId = existingDraft.current_generation_id;
    if (authoritativeId) {
      const { error: orphanError } = await supabaseServer
        .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
        .update({
          superseded_by_generation_id: authoritativeId,
          superseded_at: nowIso,
        })
        .eq("id", inserted.id);
      if (orphanError) {
        console.warn("[tyler-text-overview] protected_history_generation_mark_failed", {
          clerk_user_id: args.clerkUserId,
          draft_for_day_key: args.draftForDayKey,
          generation_id: inserted.id,
          message: orphanError.message,
        });
      }
    }
    return {
      ok: true,
      generationId: inserted.id,
      supersedeFailed: false,
      currentDraftProtected: true,
    };
  }

  const supersede = await supersedePriorGenerations({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    newGenerationId: inserted.id,
    nowIso,
  });
  if (!supersede.ok) {
    console.warn("[tyler-text-overview] supersede_prior_generation_failed", {
      clerk_user_id: args.clerkUserId,
      draft_for_day_key: args.draftForDayKey,
      message: supersede.error,
    });
  }

  const upsert = await upsertCurrentDraft({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    generationId: inserted.id,
    machineBody: generationRow.machine_draft_body,
    machineBodyHash: generationRow.machine_body_hash,
    nowIso,
    respectProtectedMorningDraft: args.respectProtectedMorningDraft,
    protectTylerProvenanceOnly: args.protectTylerProvenanceOnly,
  });
  if (!upsert.ok) {
    return { ok: false, reason: "upsert_failed", error: upsert.error };
  }

  return {
    ok: true,
    generationId: inserted.id,
    supersedeFailed: !supersede.ok,
    currentDraftProtected: upsert.protected === true,
  };
}

async function insertGenerationRow(
  row: TylerTextOverviewGenerationInsertRow
): Promise<{ id: string } | { error: string }> {
  let attempt = 0;
  let generationNumber = row.generation_number;

  while (attempt < 2) {
    const payload = { ...row, generation_number: generationNumber };
    const { data, error } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .insert(payload)
      .select("id")
      .single();

    if (!error && data?.id) {
      return { id: data.id as string };
    }

    if (isUniqueViolation(error) && attempt === 0) {
      attempt += 1;
      try {
        generationNumber = await fetchNextGenerationNumber(
          row.clerk_user_id,
          row.draft_for_day_key,
          row.send_slot
        );
      } catch (lookupErr) {
        return {
          error:
            lookupErr instanceof Error
              ? lookupErr.message
              : "generation_number_retry_lookup_failed",
        };
      }
      continue;
    }

    return { error: error?.message ?? "generation_insert_failed" };
  }

  return { error: "generation_insert_retry_exhausted" };
}

async function supersedePriorGenerations(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: SmsDailySendSlot;
  newGenerationId: string;
  nowIso: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .update({
      superseded_by_generation_id: args.newGenerationId,
      superseded_at: args.nowIso,
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", args.sendSlot)
    .neq("id", args.newGenerationId)
    .is("superseded_at", null);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function loadExistingCurrentDraft(
  clerkUserId: string,
  draftForDayKey: string,
  sendSlot: SmsDailySendSlot = SMS_DAILY_PRODUCTION_SEND_SLOT
): Promise<{
  status: string;
  current_body_to_send: string | null;
  current_generation_id: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
} | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "status, current_body_to_send, current_generation_id, current_body_source, edited_by_tyler"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("draft_for_day_key", draftForDayKey)
    .eq("send_slot", sendSlot)
    .eq("status", "current")
    .maybeSingle();

  if (error) {
    throw new Error(`current_draft_lookup_failed:${error.message}`);
  }

  if (!data || typeof data.status !== "string") {
    return null;
  }

  return {
    status: data.status,
    current_body_to_send:
      typeof data.current_body_to_send === "string" ? data.current_body_to_send : null,
    current_generation_id:
      typeof data.current_generation_id === "string" && data.current_generation_id.trim()
        ? data.current_generation_id.trim()
        : null,
    current_body_source:
      typeof data.current_body_source === "string" ? data.current_body_source : null,
    edited_by_tyler: data.edited_by_tyler === true,
  };
}

async function upsertCurrentDraft(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: SmsDailySendSlot;
  generationId: string;
  machineBody: string | null;
  machineBodyHash: string | null;
  nowIso: string;
  respectProtectedMorningDraft?: boolean;
  protectTylerProvenanceOnly?: boolean;
}): Promise<{ ok: boolean; error?: string; protected?: boolean }> {
  const existing = await loadExistingCurrentDraft(
    args.clerkUserId,
    args.draftForDayKey,
    args.sendSlot
  );
  if (
    existingCurrentDraftBlocksOverwrite({
      sendSlot: args.sendSlot,
      respectProtectedMorningDraft: args.respectProtectedMorningDraft,
      protectTylerProvenanceOnly: args.protectTylerProvenanceOnly,
      existing,
    })
  ) {
    return { ok: true, protected: true };
  }

  const { error } = await supabaseServer.from(SMS_DAILY_DRAFTS_TABLE).upsert(
    {
      clerk_user_id: args.clerkUserId,
      draft_for_day_key: args.draftForDayKey,
      send_slot: args.sendSlot,
      current_generation_id: args.generationId,
      current_body_to_send: args.machineBody,
      current_body_source: "machine",
      edited_by_tyler: false,
      edited_at: null,
      edit_distance_chars: null,
      machine_body_hash: args.machineBodyHash,
      current_body_hash: args.machineBodyHash,
      status: "current",
      updated_at: args.nowIso,
    },
    { onConflict: "clerk_user_id,draft_for_day_key,send_slot" }
  );

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function loadTylerTextOverviewAudienceRow(
  clerkUserId: string
): Promise<TylerTextOverviewAudienceRow | null> {
  const { data, error } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`sms_audience_user_query_failed:${error.message}`);
  }

  if (
    !data ||
    typeof data.clerk_user_id !== "string" ||
    !data.clerk_user_id.trim() ||
    data.sms_enabled !== true ||
    data.summitt_subscribed !== true ||
    (data.stopped_at != null && data.stopped_at !== "")
  ) {
    return null;
  }

  return data as TylerTextOverviewAudienceRow;
}

export async function loadTylerTextOverviewAudienceRows(): Promise<TylerTextOverviewAudienceRow[]> {
  const { data, error } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  if (error) {
    throw new Error(`sms_audience_query_failed:${error.message}`);
  }

  return (data ?? []).filter(
    (row): row is TylerTextOverviewAudienceRow =>
      typeof row.clerk_user_id === "string" &&
      row.clerk_user_id.trim().length > 0 &&
      row.sms_enabled === true &&
      row.summitt_subscribed === true &&
      (row.stopped_at == null || row.stopped_at === "")
  );
}

export async function persistTylerTextOverviewDraftFromBuilt(args: {
  clerkUserId: string;
  draftForDayKey: string;
  generationReason: TylerTextOverviewGenerationReason;
  built: DailySmsBuilt;
  commitmentId: string | null;
  timezone: string;
  sendPrefSnapshot: string;
  now: Date;
  sendSlot?: SmsDailySendSlot;
  generationMetadataExtra?: Record<string, unknown>;
  respectProtectedMorningDraft?: boolean;
}): Promise<
  | { ok: true; generationId: string; supersedeFailed: boolean; currentDraftProtected?: boolean }
  | { ok: false; reason: "insert_failed" | "upsert_failed"; error?: string }
> {
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  let generationNumber: number;
  try {
    generationNumber = await fetchNextGenerationNumber(
      args.clerkUserId,
      args.draftForDayKey,
      sendSlot
    );
  } catch (e) {
    return {
      ok: false,
      reason: "insert_failed",
      error: e instanceof Error ? e.message : "generation_number_lookup_failed",
    };
  }

  const generationRow = mapBuiltToTylerTextOverviewGenerationRow({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    generationNumber,
    generationReason: args.generationReason,
    built: args.built,
    commitmentId: args.commitmentId,
    timezone: args.timezone,
    sendPrefSnapshot: args.sendPrefSnapshot,
    sendSlot,
    generationMetadataExtra: args.generationMetadataExtra,
  });

  const existingDraft = await loadExistingCurrentDraft(
    args.clerkUserId,
    args.draftForDayKey,
    sendSlot
  );
  const protectExistingDraft =
    args.respectProtectedMorningDraft !== false &&
    isProtectedTtoOverwriteSlot(sendSlot) &&
    existingDraft != null &&
    existingDraft.status === "current" &&
    isProtectedFromMorningDraftOverwrite({
      current_body_to_send: existingDraft.current_body_to_send,
      edited_by_tyler: existingDraft.edited_by_tyler,
      current_body_source: existingDraft.current_body_source,
    });

  const inserted = await insertGenerationRow(generationRow);
  if ("error" in inserted) {
    return { ok: false, reason: "insert_failed", error: inserted.error };
  }

  const nowIso = args.now.toISOString();

  // Protected draft: keep history, but never supersede the still-authoritative generation
  // the draft continues to point at (would leave current_generation_id → superseded row).
  if (protectExistingDraft) {
    const authoritativeId = existingDraft.current_generation_id;
    if (authoritativeId) {
      const { error: orphanError } = await supabaseServer
        .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
        .update({
          superseded_by_generation_id: authoritativeId,
          superseded_at: nowIso,
        })
        .eq("id", inserted.id);
      if (orphanError) {
        console.warn("[tyler-text-overview] protected_history_generation_mark_failed", {
          clerk_user_id: args.clerkUserId,
          draft_for_day_key: args.draftForDayKey,
          generation_id: inserted.id,
          message: orphanError.message,
        });
      }
    }
    return {
      ok: true,
      generationId: inserted.id,
      supersedeFailed: false,
      currentDraftProtected: true,
    };
  }

  const supersede = await supersedePriorGenerations({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    newGenerationId: inserted.id,
    nowIso,
  });
  if (!supersede.ok) {
    console.warn("[tyler-text-overview] supersede_prior_generation_failed", {
      clerk_user_id: args.clerkUserId,
      draft_for_day_key: args.draftForDayKey,
      message: supersede.error,
    });
  }

  const upsert = await upsertCurrentDraft({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    generationId: inserted.id,
    machineBody: generationRow.machine_draft_body,
    machineBodyHash: generationRow.machine_body_hash,
    nowIso,
    respectProtectedMorningDraft: args.respectProtectedMorningDraft,
  });
  if (!upsert.ok) {
    return { ok: false, reason: "upsert_failed", error: upsert.error };
  }

  return {
    ok: true,
    generationId: inserted.id,
    supersedeFailed: !supersede.ok,
    currentDraftProtected: upsert.protected === true,
  };
}

export type TylerTextOverviewMorningDraftResult =
  | {
      ok: true;
      draftForDayKey: string;
      generationId: string;
      body: string | null;
      machineShouldSend: boolean;
      writerPromptPath: string | null;
      supersedeFailed: boolean;
      currentDraftProtected?: boolean;
    }
  | {
      ok: false;
      reason: "comms_prefs" | "not_v2" | "insert_failed" | "upsert_failed";
      error?: string;
    };

type QuietRelationshipMechanicalFacts = Awaited<
  ReturnType<typeof resolveQuietRelationshipMechanicalFacts>
>;

function quietMetadataFields(quiet: QuietRelationshipMechanicalFacts): Record<string, unknown> {
  return {
    quiet_relationship_eligible: quiet.quiet_relationship_eligible,
    message_required_today: quiet.message_required_today,
    clock_lookup_failed: quiet.clock_lookup_failed,
    clock_lookup_error: quiet.clock_lookup_error,
    days_since_last_successful_proactive_send: quiet.days_since_last_successful_proactive_send,
    days_since_first_successful_proactive_send: quiet.days_since_first_successful_proactive_send,
  };
}

/** Operational clamp at the writer-skip seam. Interpreter merge also clamps. */
function withClampedProactiveDecision(
  brief: MorningCoachingBriefV1,
  quiet: QuietRelationshipMechanicalFacts
): MorningCoachingBriefV1 {
  const proactive_decision = clampProactiveDecision({
    decision: brief.coaching_direction.proactive_decision,
    quietRelationshipEligible: quiet.quiet_relationship_eligible,
    messageRequiredToday: quiet.message_required_today,
    clockLookupFailed: quiet.clock_lookup_failed === true,
  });
  if (proactive_decision === brief.coaching_direction.proactive_decision) return brief;
  return {
    ...brief,
    coaching_direction: {
      ...brief.coaching_direction,
      proactive_decision,
    },
  };
}

function failSoftInterpreterInputFromPacket(
  packet: MorningRelationshipPacket,
  quiet: QuietRelationshipMechanicalFacts
) {
  return {
    version: "morning_brief_interpreter_input_v1" as const,
    message_for: {
      timezone: packet.message_for.timezone,
      local_date: packet.message_for.local_date,
      local_weekday: packet.message_for.local_weekday,
      daypart: packet.message_for.daypart,
    },
    mechanical: {
      days_since_last_user_response: packet.last_user_response.days_since,
      never_replied: packet.last_user_response.never_replied,
      recent_unanswered_outbound_count: 0,
      message_required_today: quiet.message_required_today,
      quiet_relationship_eligible: quiet.quiet_relationship_eligible,
    },
    canonical_goal: { text: packet.current_goal.text },
    pending_goal_change: packet.hard_state.pending_goal_change,
    available_identity: packet.current_identity.text
      ? { text: packet.current_identity.text }
      : null,
    available_important_people: [] as Array<{ name: string; relationship: string }>,
    available_life_context: [] as Array<{ type: string; value: string }>,
    truth_spine: {
      latest_outcome: null,
      latest_outcome_at: null,
      latest_outcome_message: null,
      evidence_strength: "none" as const,
      consistency_supported: false,
      proof_claims_allowed: {
        completion: false,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    thread_memory_hint: null,
    exact_thread: {
      window_days: 21 as const,
      max_messages: 30 as const,
      messages: packet.exact_thread.messages,
      omitted_older_turn_count: packet.exact_thread.omitted_older_turn_count,
    },
  };
}

/**
 * Morning Brief interpreter orchestration. Never mutates packet. Never throws to caller.
 * Always returns a post-merge (or fail-soft) Brief for the final writer.
 */
export async function runObservationalMorningBriefInterpreter(args: {
  packet: MorningRelationshipPacket;
  clerkUserId: string;
  commitmentId: string;
  quietFacts?: QuietRelationshipMechanicalFacts;
}): Promise<{
  morning_brief_interpreter_v1: Record<string, unknown>;
  morning_coaching_brief_v1: MorningCoachingBriefV1;
}> {
  const quiet =
    args.quietFacts ??
    ({
      quiet_relationship_eligible: false,
      message_required_today: false,
      clock_lookup_failed: false,
      clock_lookup_error: null,
      days_since_last_successful_proactive_send: null,
      days_since_first_successful_proactive_send: null,
    } satisfies QuietRelationshipMechanicalFacts);

  try {
    const extras = await loadMorningBriefCanonicalExtrasV1({
      clerkUserId: args.clerkUserId,
      commitmentId: args.commitmentId,
    });
    const assembled = assembleMorningBriefInterpreterInputFromPacket({
      packet: args.packet,
      extras,
      messageRequiredToday: quiet.message_required_today,
      quietRelationshipEligible: quiet.quiet_relationship_eligible,
    });
    if ("ok" in assembled) {
      return {
        morning_brief_interpreter_v1: {
          capture_version: "morning_brief_interpreter_capture_v1",
          error: assembled.error,
          retry: null,
          parsed_brief: null,
          raw_response: null,
        },
        // Assemble failure is rare (packet already has goal/day); empty fail-soft without spine input.
        morning_coaching_brief_v1: buildLowConfidenceUnknownBriefFromCanonical(
          failSoftInterpreterInputFromPacket(args.packet, quiet)
        ),
      };
    }

    const result = await runMorningBriefInterpreterV1({ input: assembled });
    const meta = buildMorningBriefInterpreterMetadataV1(result.capture);
    if (!result.ok) {
      meta.fallback_brief_used = true;
    }
    return {
      morning_brief_interpreter_v1: meta,
      morning_coaching_brief_v1: result.brief,
    };
  } catch (e) {
    return {
      morning_brief_interpreter_v1: {
        capture_version: "morning_brief_interpreter_capture_v1",
        error: e instanceof Error ? e.message : "interpreter_orchestration_failed",
        retry: null,
        parsed_brief: null,
        raw_response: null,
      },
      morning_coaching_brief_v1: buildLowConfidenceUnknownBriefFromCanonical(
        failSoftInterpreterInputFromPacket(args.packet, quiet)
      ),
    };
  }
}

export async function generateTylerTextOverviewDraftForUser(args: {
  audienceUser: TylerTextOverviewAudienceRow;
  now: Date;
  /** Required: control-room / existing-draft day. Never derived from user-local hour. */
  draftForDayKey: string;
  generationReason?: TylerTextOverviewGenerationReason;
}): Promise<TylerTextOverviewMorningDraftResult> {
  const draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  const clerkUserId = args.audienceUser.clerk_user_id;
  const user = await getClerkUser(clerkUserId);
  const md = (user.public_metadata ?? {}) as Record<string, unknown>;

  const tzResolved = resolveSmsUserTimezone({
    clerkMetadataTimezone: md.timezone,
    audienceTimezone: args.audienceUser.timezone,
  });
  const timezone = tzResolved.timezone;
  const localNow = new Date(args.now.toLocaleString("en-US", { timeZone: timezone }));

  const commsPrefs = await fetchV2UserSmsCommsPreferences(clerkUserId);
  const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, args.now);
  if (commsSkip.skip) {
    return { ok: false, reason: "comms_prefs" };
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(clerkUserId);
  if (!v2Status.fullyOnV2) {
    return { ok: false, reason: "not_v2" };
  }

  const clerkSmsTimePreference = smsTimePreferenceFromClerkMetadata(md);
  const sendPrefSnapshot = formatSendPrefSnapshot(clerkSmsTimePreference, commsPrefs);

  const packetResult = await loadMorningRelationshipPacket({
    clerkUserId,
    timezone,
    now: args.now,
    draftForDayKey,
  });

  if (!packetResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "noon_batch",
      commitmentId: null,
      timezone,
      sendPrefSnapshot,
      now: args.now,
      failure: { error: packetResult.error },
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      writerPromptPath: null,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const { packet, commitmentId } = packetResult;
  const packetMetadata = {
    thread_message_count: packet.exact_thread.messages.length,
    days_since_last_user_response: packet.last_user_response.days_since,
    never_replied: packet.last_user_response.never_replied,
    has_pending_goal_change: packet.hard_state.pending_goal_change != null,
  };

  const quietFacts = await resolveQuietRelationshipMechanicalFacts({
    clerkUserId,
    timezone,
    localDate: draftForDayKey,
    daysSinceLastUserResponse: packet.last_user_response.days_since,
    neverReplied: packet.last_user_response.never_replied,
    recentUnansweredOutboundCount: countRecentUnansweredOutboundFromExactThread(
      packet.exact_thread.messages
    ),
  });

  // Phase 2D: Brief → Sol final writer. Packet unmutated; Brief is separate input.
  const briefMetadataExtra = await runObservationalMorningBriefInterpreter({
    packet,
    clerkUserId,
    commitmentId,
    quietFacts,
  });
  const morningCoachingBrief = withClampedProactiveDecision(
    briefMetadataExtra.morning_coaching_brief_v1,
    quietFacts
  );
  const quietMeta = {
    ...quietMetadataFields(quietFacts),
    proactive_decision: morningCoachingBrief.coaching_direction.proactive_decision,
  };

  if (isIntentionalSpaceDecision(morningCoachingBrief.coaching_direction.proactive_decision)) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "noon_batch",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now: args.now,
      failure: { error: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE },
      packetMetadata,
      generationMetadataExtra: {
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: true,
        error: null,
      },
      notebookVerdictReason: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      writerPromptPath: null,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const writerResult = await writeMorningTtoBody({
    packet,
    morningCoachingBrief,
  });
  const writerMessages = writerResult.messages
    ? mapOpenAiMessagesToWriterCapture(writerResult.messages)
    : undefined;
  const retryMessages = mapOpenAiMessagesToWriterCapture(
    writerResult.retryMessages ?? []
  );
  const retryOccurred = writerResult.retryOccurred === true;
  const writerModel =
    typeof writerResult.model === "string" ? writerResult.model : null;
  const writerCapture = writerResult.capture
    ? {
        capture_version: writerResult.capture.capture_version,
        model: writerResult.capture.model,
        temperature: writerResult.capture.temperature,
        reasoning_effort: writerResult.capture.reasoning_effort,
        max_completion_tokens: writerResult.capture.max_completion_tokens,
        prompt_path: writerResult.capture.prompt_path,
        request_started_at: writerResult.capture.request_started_at,
        request_completed_at: writerResult.capture.request_completed_at,
        latency_ms: writerResult.capture.latency_ms,
        raw_response: writerResult.capture.raw_response,
        raw_retry_response: writerResult.capture.raw_retry_response,
        error: writerResult.capture.error,
        openai_error: writerResult.capture.openai_error ?? null,
        retry_occurred: writerResult.capture.retry_occurred,
        retry_succeeded: writerResult.capture.retry_succeeded,
      }
    : undefined;
  const writerPromptPathForPersist = writerMessages?.length
    ? ("morning_brief_writer_v1" as const)
    : null;

  if (!writerResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "noon_batch",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now: args.now,
      failure: {
        error: writerResult.error,
        messages: writerMessages,
        writerPromptPath: writerPromptPathForPersist,
        model: writerModel,
        retryMessages,
        retryOccurred,
        retrySucceeded: retryOccurred ? false : undefined,
        writerCapture,
      },
      packetMetadata,
      generationMetadataExtra: {
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: false,
      },
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      writerPromptPath: writerPromptPathForPersist,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const persisted = await persistMorningTtoGeneration({
    clerkUserId,
    draftForDayKey,
    generationReason: args.generationReason ?? "noon_batch",
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now: args.now,
    success: {
      body: writerResult.body,
      messages: mapOpenAiMessagesToWriterCapture(writerResult.messages),
      writerPromptPath: writerResult.writer_prompt_path,
      model: writerResult.model,
      retryMessages,
      retryOccurred,
      retrySucceeded: retryOccurred ? true : undefined,
      writerCapture,
    },
    packetMetadata,
    generationMetadataExtra: {
      ...briefMetadataExtra,
      morning_coaching_brief_v1: morningCoachingBrief,
      ...quietMeta,
      intentional_space: false,
    },
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  return {
    ok: true,
    draftForDayKey,
    generationId: persisted.generationId,
    body: writerResult.body,
    machineShouldSend: true,
    writerPromptPath: writerResult.writer_prompt_path,
    supersedeFailed: persisted.supersedeFailed,
    currentDraftProtected: persisted.currentDraftProtected,
  };
}

export type GenerateTylerTextOverviewDailyDraftsArgs = {
  now: Date;
  /** One canonical Morning draft day for every user in this batch. */
  draftForDayKey: string;
};

export async function generateTylerTextOverviewDailyDrafts(
  args: GenerateTylerTextOverviewDailyDraftsArgs
): Promise<TylerTextOverviewGenerateStats> {
  let draftForDayKey: string;
  try {
    draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  } catch (e) {
    return emptyStats({
      ok: false,
      enabled: isTylerTextOverviewEnabled(),
      errors_preview: [e instanceof Error ? e.message : "invalid_draft_for_day_key"],
    });
  }

  if (!isTylerTextOverviewEnabled()) {
    return emptyStats({
      skipped_disabled: 1,
      draft_for_day_key: draftForDayKey,
    });
  }

  const now = args.now;
  const stats = emptyStats({ enabled: true, draft_for_day_key: draftForDayKey });
  const errors: string[] = [];

  let audience: TylerTextOverviewAudienceRow[];
  try {
    audience = await loadTylerTextOverviewAudienceRows();
  } catch (e) {
    stats.ok = false;
    stats.errors_preview.push(
      e instanceof Error ? e.message : "sms_audience_query_failed"
    );
    return stats;
  }

  for (const audienceUser of audience) {
    stats.scanned += 1;

    if (audienceUser.stopped_at) {
      stats.skipped_audience += 1;
      continue;
    }

    try {
      const result = await generateTylerTextOverviewDraftForUser({
        audienceUser,
        now,
        draftForDayKey,
      });
      if (!result.ok) {
        if (result.reason === "comms_prefs") {
          stats.skipped_comms_prefs += 1;
        } else if (result.reason === "not_v2") {
          stats.skipped_not_v2 += 1;
        } else if (result.reason === "insert_failed") {
          stats.eligible += 1;
          stats.insert_failed += 1;
          if (result.error) errors.push(`${audienceUser.clerk_user_id}:insert:${result.error}`);
        } else if (result.reason === "upsert_failed") {
          stats.eligible += 1;
          stats.upsert_failed += 1;
          if (result.error) errors.push(`${audienceUser.clerk_user_id}:upsert:${result.error}`);
        } else {
          stats.build_failed += 1;
          if (result.error) errors.push(`${audienceUser.clerk_user_id}:build:${result.error}`);
        }
        continue;
      }

      stats.eligible += 1;
      stats.generated += 1;
      stats.generation_inserted += 1;
      if (!result.currentDraftProtected) {
        stats.current_drafts_upserted += 1;
      }
      if (result.supersedeFailed) {
        stats.supersede_failed += 1;
      }
    } catch (e) {
      stats.build_failed += 1;
      errors.push(
        `${audienceUser.clerk_user_id}:unexpected:${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  stats.errors_preview = errors.slice(0, 20);
  return stats;
}

export type TylerTextOverviewEveningPreviewResult =
  | {
      ok: true;
      draftForDayKey: string;
      generationId: string;
      body: string | null;
      machineShouldSend: boolean;
      machineNoSendReason: string | null;
      writerPromptPath: string | null;
      messageFor: MorningRelationshipPacket["message_for"] | null;
      supersedeFailed: boolean;
      currentDraftProtected?: boolean;
    }
  | {
      ok: false;
      reason:
        | "disabled"
        | "audience"
        | "comms_prefs"
        | "not_v2"
        | "insert_failed"
        | "upsert_failed";
      error?: string;
    };

/**
 * Evening TTO Generate — shared Sol packet → interpreter → Brief → writer.
 * Bypasses legacy V3 / gpt-4o-mini / writing-brief / slot-coaching path.
 * Does not pass unsent Morning drafts into Sol context (exact_thread = sent/received only).
 */
export async function generateTylerTextOverviewEveningPreviewForUser(args: {
  clerkUserId: string;
  draftForDayKey?: string;
  now?: Date;
}): Promise<TylerTextOverviewEveningPreviewResult> {
  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) {
    return { ok: false, reason: "audience", error: "missing_clerk_user_id" };
  }

  const audienceUser = await loadTylerTextOverviewAudienceRow(clerkUserId);
  if (!audienceUser) {
    return { ok: false, reason: "audience", error: "user_not_in_sms_audience" };
  }

  const now = args.now ?? new Date();
  const user = await getClerkUser(clerkUserId);
  const md = (user.public_metadata ?? {}) as Record<string, unknown>;

  const tzResolved = resolveSmsUserTimezone({
    clerkMetadataTimezone: md.timezone,
    audienceTimezone: audienceUser.timezone,
  });
  const timezone = tzResolved.timezone;
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  const commsPrefs = await fetchV2UserSmsCommsPreferences(clerkUserId);
  const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, now);
  if (commsSkip.skip) {
    return { ok: false, reason: "comms_prefs" };
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(clerkUserId);
  if (!v2Status.fullyOnV2) {
    return { ok: false, reason: "not_v2" };
  }

  const clerkSmsTimePreference = smsTimePreferenceFromClerkMetadata(md);
  const sendPrefSnapshot = formatSendPrefSnapshot(clerkSmsTimePreference, commsPrefs);

  let draftForDayKey: string;
  try {
    draftForDayKey = args.draftForDayKey?.trim()
      ? requireTylerTextOverviewDraftDayKey(args.draftForDayKey)
      : resolveTylerTextOverviewEveningDraftForDayKey({ now, timezone });
  } catch (e) {
    return {
      ok: false,
      reason: "insert_failed",
      error: e instanceof Error ? e.message : "invalid_draft_for_day_key",
    };
  }

  const packetResult = await loadMorningRelationshipPacket({
    clerkUserId,
    timezone,
    now,
    draftForDayKey,
    daypart: "evening",
  });

  const eveningMetaBase = {
    preview_only: true,
    preview_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    coaching_stack: "shared_sol_v1",
  };

  if (!packetResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId: null,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      failure: { error: packetResult.error },
      generationMetadataExtra: eveningMetaBase,
      respectProtectedMorningDraft: true,
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      machineNoSendReason: packetResult.error,
      writerPromptPath: null,
      messageFor: null,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const { packet, commitmentId } = packetResult;
  const packetMetadata = {
    thread_message_count: packet.exact_thread.messages.length,
    days_since_last_user_response: packet.last_user_response.days_since,
    never_replied: packet.last_user_response.never_replied,
    has_pending_goal_change: packet.hard_state.pending_goal_change != null,
  };

  const quietFacts = await resolveQuietRelationshipMechanicalFacts({
    clerkUserId,
    timezone,
    localDate: draftForDayKey,
    daysSinceLastUserResponse: packet.last_user_response.days_since,
    neverReplied: packet.last_user_response.never_replied,
    recentUnansweredOutboundCount: countRecentUnansweredOutboundFromExactThread(
      packet.exact_thread.messages
    ),
  });

  const briefMetadataExtra = await runObservationalMorningBriefInterpreter({
    packet,
    clerkUserId,
    commitmentId,
    quietFacts,
  });
  const morningCoachingBrief = withClampedProactiveDecision(
    briefMetadataExtra.morning_coaching_brief_v1,
    quietFacts
  );
  const quietMeta = {
    ...quietMetadataFields(quietFacts),
    proactive_decision: morningCoachingBrief.coaching_direction.proactive_decision,
  };

  if (isIntentionalSpaceDecision(morningCoachingBrief.coaching_direction.proactive_decision)) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      failure: { error: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE },
      packetMetadata,
      generationMetadataExtra: {
        ...eveningMetaBase,
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: true,
        error: null,
        message_for: packet.message_for,
        morning_relationship_packet_v1: packet,
      },
      notebookVerdictReason: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
      respectProtectedMorningDraft: true,
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      machineNoSendReason: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
      writerPromptPath: null,
      messageFor: packet.message_for,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const writerResult = await writeMorningTtoBody({
    packet,
    morningCoachingBrief,
  });
  const writerMessages = writerResult.messages
    ? mapOpenAiMessagesToWriterCapture(writerResult.messages)
    : undefined;
  const retryMessages = mapOpenAiMessagesToWriterCapture(
    writerResult.retryMessages ?? []
  );
  const retryOccurred = writerResult.retryOccurred === true;
  const writerModel =
    typeof writerResult.model === "string" ? writerResult.model : null;
  const writerCapture = writerResult.capture
    ? {
        capture_version: writerResult.capture.capture_version,
        model: writerResult.capture.model,
        temperature: writerResult.capture.temperature,
        reasoning_effort: writerResult.capture.reasoning_effort,
        max_completion_tokens: writerResult.capture.max_completion_tokens,
        prompt_path: writerResult.capture.prompt_path,
        request_started_at: writerResult.capture.request_started_at,
        request_completed_at: writerResult.capture.request_completed_at,
        latency_ms: writerResult.capture.latency_ms,
        raw_response: writerResult.capture.raw_response,
        raw_retry_response: writerResult.capture.raw_retry_response,
        error: writerResult.capture.error,
        openai_error: writerResult.capture.openai_error ?? null,
        retry_occurred: writerResult.capture.retry_occurred,
        retry_succeeded: writerResult.capture.retry_succeeded,
      }
    : undefined;
  const writerPromptPathForPersist = writerMessages?.length
    ? ("morning_brief_writer_v1" as const)
    : null;

  const generationMetadataExtra = {
    ...eveningMetaBase,
    ...briefMetadataExtra,
    morning_coaching_brief_v1: morningCoachingBrief,
    ...quietMeta,
    intentional_space: false,
    message_for: packet.message_for,
    morning_relationship_packet_v1: packet,
  };

  if (!writerResult.ok) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: "manual_regenerate",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      failure: {
        error: writerResult.error,
        messages: writerMessages,
        writerPromptPath: writerPromptPathForPersist,
        model: writerModel,
        retryMessages,
        retryOccurred,
        retrySucceeded: retryOccurred ? false : undefined,
        writerCapture,
      },
      packetMetadata,
      generationMetadataExtra,
      respectProtectedMorningDraft: true,
    });

    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason, error: persisted.error };
    }

    return {
      ok: true,
      draftForDayKey,
      generationId: persisted.generationId,
      body: null,
      machineShouldSend: false,
      machineNoSendReason: writerResult.error,
      writerPromptPath: writerPromptPathForPersist,
      messageFor: packet.message_for,
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const persisted = await persistMorningTtoGeneration({
    clerkUserId,
    draftForDayKey,
    generationReason: "manual_regenerate",
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    success: {
      body: writerResult.body,
      messages: mapOpenAiMessagesToWriterCapture(writerResult.messages),
      writerPromptPath: writerResult.writer_prompt_path,
      model: writerResult.model,
      retryMessages,
      retryOccurred,
      retrySucceeded: retryOccurred ? true : undefined,
      writerCapture,
    },
    packetMetadata,
    generationMetadataExtra,
    respectProtectedMorningDraft: true,
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  return {
    ok: true,
    draftForDayKey,
    generationId: persisted.generationId,
    body: writerResult.body,
    machineShouldSend: true,
    machineNoSendReason: null,
    writerPromptPath: writerResult.writer_prompt_path,
    messageFor: packet.message_for,
    supersedeFailed: persisted.supersedeFailed,
    currentDraftProtected: persisted.currentDraftProtected,
  };
}
