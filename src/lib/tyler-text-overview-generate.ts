import { buildDailySmsContent, type DailySmsBuilt } from "@/lib/daily-sms-build";
import { loadMorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { writeMorningTtoBody } from "@/lib/morning-tto-writer";
import {
  morningAnchorToPreviousOutbound,
  resolveEveningPreviewMorningAnchor,
} from "@/lib/evening-preview-context-v1";
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
  isProtectedTtoCurrentDraftBody,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type SmsDailySendSlot,
  type TylerTextOverviewGenerationReason,
  type TylerTextOverviewNotebookVerdict,
} from "@/lib/tyler-text-overview-types";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipDailyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { hashWriterOpenAiMessages } from "@/lib/tyler-text-overview-writer-capture";

export const MORNING_RELATIONSHIP_ROUTE_KIND = "morning_relationship" as const;

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
    writerPromptPath: "morning_relationship_v1";
    model?: string;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
  };
  failure?: {
    error: string;
    messages?: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath?: string | null;
    model?: string | null;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
  };
  packetMetadata?: {
    thread_message_count: number;
    days_since_last_user_response: number | null;
    never_replied: boolean;
    has_pending_goal_change: boolean;
  };
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
    notebook_verdict_reason: capturePresent ? "morning_relationship_writer_ran" : "writer_not_invoked",
    notebook_source_candidate_count: null,
    notebook_exact_source_message_count: null,
    notebook_thread_message_count: args.packetMetadata?.thread_message_count ?? null,
    notebook_filtered_out_reason_top: null,
    route_kind: MORNING_RELATIONSHIP_ROUTE_KIND,
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
      morning_writer_capture_v1: {
        model,
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? retrySucceeded : null,
        retry_messages: retryOccurred ? retryMessages : [],
      },
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
    writerPromptPath: "morning_relationship_v1";
    model?: string;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
  };
  failure?: {
    error: string;
    messages?: TylerTextOverviewWriterOpenAiMessage[];
    writerPromptPath?: string | null;
    model?: string | null;
    retryMessages?: TylerTextOverviewWriterOpenAiMessage[];
    retryOccurred?: boolean;
    retrySucceeded?: boolean;
  };
  packetMetadata?: {
    thread_message_count: number;
    days_since_last_user_response: number | null;
    never_replied: boolean;
    has_pending_goal_change: boolean;
  };
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
  });

  const existingDraft = await loadExistingCurrentDraft(
    args.clerkUserId,
    args.draftForDayKey,
    sendSlot
  );
  const protectExistingDraft =
    args.respectProtectedMorningDraft !== false &&
    sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT &&
    existingDraft != null &&
    existingDraft.status === "current" &&
    isProtectedTtoCurrentDraftBody(existingDraft.current_body_to_send);

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
} | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("status, current_body_to_send, current_generation_id")
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
}): Promise<{ ok: boolean; error?: string; protected?: boolean }> {
  const existing = await loadExistingCurrentDraft(
    args.clerkUserId,
    args.draftForDayKey,
    args.sendSlot
  );
  if (
    args.respectProtectedMorningDraft !== false &&
    args.sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT &&
    existing &&
    existing.status === "current" &&
    isProtectedTtoCurrentDraftBody(existing.current_body_to_send)
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

  const inserted = await insertGenerationRow(generationRow);
  if ("error" in inserted) {
    return { ok: false, reason: "insert_failed", error: inserted.error };
  }

  const nowIso = args.now.toISOString();
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

  const writerResult = await writeMorningTtoBody(packet);
  const writerMessages = writerResult.messages
    ? mapOpenAiMessagesToWriterCapture(writerResult.messages)
    : undefined;
  const retryMessages = mapOpenAiMessagesToWriterCapture(
    writerResult.retryMessages ?? []
  );
  const retryOccurred = writerResult.retryOccurred === true;
  const writerModel =
    typeof writerResult.model === "string" ? writerResult.model : null;

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
        writerPromptPath: writerMessages?.length ? "morning_relationship_v1" : null,
        model: writerModel,
        retryMessages,
        retryOccurred,
        retrySucceeded: retryOccurred ? false : undefined,
      },
      packetMetadata,
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
      writerPromptPath: writerMessages?.length ? "morning_relationship_v1" : null,
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
    },
    packetMetadata,
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
      built: DailySmsBuilt;
      morningAnchorSource: string;
      slotCoachingContext: Record<string, unknown> | null;
    }
  | {
      ok: false;
      reason:
        | "disabled"
        | "audience"
        | "comms_prefs"
        | "not_v2"
        | "build_failed"
        | "insert_failed"
        | "upsert_failed";
      error?: string;
    };

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
  const draftForDayKey =
    args.draftForDayKey?.trim() ||
    resolveTylerTextOverviewEveningDraftForDayKey({
      now,
      timezone,
    });

  const morningAnchor = await resolveEveningPreviewMorningAnchor({
    clerkUserId,
    draftForDayKey,
    supabase: supabaseServer,
  });

  const previousOutbound = morningAnchorToPreviousOutbound(morningAnchor);

  const built = await buildDailySmsContent(clerkUserId, md, draftForDayKey, timezone, {
    mode: "draft",
    writingBriefOverrides: {
      currentSendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      slotDaypartOverride: "evening",
      previousOutbound,
      userRepliesSincePreviousOutbound: undefined,
    },
  });

  const activeCommitment = await getActiveCommitment(clerkUserId);
  const commitmentId =
    (built.ok ? built.v2CommitmentId : null) ?? activeCommitment?.id ?? null;
  const sendPrefSnapshot = formatSendPrefSnapshot(clerkSmsTimePreference, commsPrefs);

  const previewMetadataExtra = {
    preview_only: true,
    preview_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    morning_anchor_source: morningAnchor.source,
    morning_anchor_sent: morningAnchor.sent,
    morning_anchor_body_preview: morningAnchor.body?.slice(0, 160) ?? null,
    ...(built.ok && commitmentId
      ? {
          v2_outbound_snapshot: {
            v2_commitment_id: commitmentId,
            v2_template_id: built.v2TemplateId,
            v2_template_family:
              built.v2TemplateFamily === "recovery" ? "recovery" : "standard",
            v2_effective_ask_text: built.v2EffectiveAskText ?? built.smsBody,
            v2_prior_outcome: built.v2PriorOutcome ?? null,
            v2_blocker_preview: built.v2BlockerPreview ?? null,
          },
        }
      : {}),
  };

  const persisted = await persistTylerTextOverviewDraftFromBuilt({
    clerkUserId,
    draftForDayKey,
    generationReason: "manual_regenerate",
    built,
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    generationMetadataExtra: previewMetadataExtra,
    respectProtectedMorningDraft: false,
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  const meta = metadataFromBuilt(built);
  const slotCtx =
    meta.slot_coaching_context &&
    typeof meta.slot_coaching_context === "object" &&
    !Array.isArray(meta.slot_coaching_context)
      ? (meta.slot_coaching_context as Record<string, unknown>)
      : null;

  return {
    ok: true,
    draftForDayKey,
    generationId: persisted.generationId,
    built,
    morningAnchorSource: morningAnchor.source,
    slotCoachingContext: slotCtx,
  };
}
