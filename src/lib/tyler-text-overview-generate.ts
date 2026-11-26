import { type DailySmsBuilt } from "@/lib/daily-sms-build";
import { loadMorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { getPatEvidenceForSms, normalizePatSmsQuery } from "@/lib/inbound-pat-source-evidence";
import { writeMorningTtoBody } from "@/lib/morning-tto-writer";
import {
  applyRepeatedCoachEmojiHygiene,
  recentSentCoachBodiesFromExactThread,
} from "@/lib/morning-tto-repeated-emoji-hygiene";
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
import {
  sundayContextEvidenceFromCoaching,
  type MorningRelationshipPacket,
  type SundayContextEvidence,
  type TtoSavedTextDeliveryContext,
} from "@/lib/morning-tto-relationship-packet";
import { attachSundayCoachingContext } from "@/lib/weekly-tto-relationship-packet";
import {
  isProactiveConversationComplianceBody,
  type ExactThreadExcludedSource,
} from "@/lib/sms-recent-exact-thread-72h";
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
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  TTO_GENERATION_EFFECTIVE_ASK_KEY,
  type SmsDailySendSlot,
  type TylerTextOverviewGenerationReason,
  type TylerTextOverviewNotebookVerdict,
} from "@/lib/tyler-text-overview-types";
import { formatMinuteOfDayAsHhMm } from "@/lib/daily-sms-scheduling";
import { scheduledDeliveryTupleIsCoherent } from "@/lib/sms-proactive-schedule";
import { getDateKeyInTimezone, isValidIanaTimezone, resolveSmsUserTimezone } from "@/lib/timezone";
import { staleTylerConversationReplacementMetadata } from "@/lib/tto-stale-tyler-replacement";
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
  observedSilenceDays,
  resolveQuietRelationshipMechanicalFacts,
} from "@/lib/sms-proactive-relationship-touch";

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
  /** Effective coaching ask used by this writer run. First-class generation_metadata key. */
  generationEffectiveAsk?: string | null;
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
  const generationEffectiveAsk = args.generationEffectiveAsk?.trim() || "";

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
      ...(generationEffectiveAsk
        ? { [TTO_GENERATION_EFFECTIVE_ASK_KEY]: generationEffectiveAsk }
        : {}),
    },
    timezone_snapshot: args.timezone,
    send_pref_snapshot: args.sendPrefSnapshot,
    machine_body_hash: machineBody ? hashSmsSnippet(machineBody) : null,
  };
}

function persistEffectiveAskFromPacket(packet: { current_goal: { text: string } }): {
  generationEffectiveAsk: string;
} {
  return { generationEffectiveAsk: packet.current_goal.text };
}

/** Morning/Evening only. Writer output stays natural; sent/persisted body may drop a recently repeated Coach emoji. */
function hygienedMorningEveningSmsBody(args: {
  body: string;
  packet: MorningRelationshipPacket;
}): string {
  return applyRepeatedCoachEmojiHygiene({
    body: args.body,
    recentSentCoachBodies: recentSentCoachBodiesFromExactThread(
      args.packet.exact_thread.messages
    ),
  });
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
  /** Effective coaching ask used by this writer run. Persisted on generation_metadata. */
  generationEffectiveAsk?: string | null;
  respectProtectedMorningDraft?: boolean;
  /** Weekly explicit regenerate: pin Tyler edit/blank only; allow replacing untouched machine copy. */
  protectTylerProvenanceOnly?: boolean;
  /** Send-time only. Default false. Replaces a nonempty Tyler sentence. A blank stays pinned. */
  allowReplaceStaleTylerNonempty?: boolean;
  replacedStaleTylerBody?: string | null;
  replacedStaleTylerEditedAt?: string | null;
  /** Facts added to generation_metadata. Existing writer and interpreter fields stay. */
  scheduledGenerationMetadata?: Record<string, unknown> | null;
  /** When set, finish must still own this scheduled-generation claim. */
  claimOwnerId?: string | null;
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

  const callerMetadata = args.generationMetadataExtra ?? {};
  const generationMetadataExtra = {
    ...(args.scheduledGenerationMetadata ?? {}),
    ...(args.allowReplaceStaleTylerNonempty === true
      ? {
          ...callerMetadata,
          ...staleTylerConversationReplacementMetadata({
            body:
              typeof args.replacedStaleTylerBody === "string"
                ? args.replacedStaleTylerBody
                : null,
            editedAt:
              typeof args.replacedStaleTylerEditedAt === "string"
                ? args.replacedStaleTylerEditedAt
                : null,
          }),
        }
      : callerMetadata),
  };

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
    generationMetadataExtra,
    generationEffectiveAsk: args.generationEffectiveAsk,
    routeKind: args.routeKind,
    notebookVerdictReason: args.notebookVerdictReason,
  });

  if (args.respectProtectedMorningDraft === false) {
    return {
      ok: false,
      reason: "upsert_failed",
      error: "protected_draft_bypass_refused",
    };
  }

  const inserted = await insertGenerationRow(generationRow);
  if ("error" in inserted) {
    return { ok: false, reason: "insert_failed", error: inserted.error };
  }

  const nowIso = args.now.toISOString();
  const finished = await finishTtoGenerationPersistence({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    generationId: inserted.id,
    machineBody: generationRow.machine_draft_body,
    machineBodyHash: generationRow.machine_body_hash,
    nowIso,
    protectTylerProvenanceOnly: args.protectTylerProvenanceOnly,
    allowReplaceStaleTylerNonempty: args.allowReplaceStaleTylerNonempty === true,
    ...(args.claimOwnerId ? { claimOwnerId: args.claimOwnerId } : {}),
  });
  if (!finished.ok) {
    return { ok: false, reason: "upsert_failed", error: finished.error };
  }

  return {
    ok: true,
    generationId: inserted.id,
    supersedeFailed: false,
    currentDraftProtected: finished.protected,
  };
}

async function insertGenerationRow(
  row: TylerTextOverviewGenerationInsertRow
): Promise<{ id: string } | { error: string }> {
  let attempt = 0;
  let generationNumber = row.generation_number;

  while (attempt < 2) {
    const payload = { ...row, generation_number: generationNumber };
    const { data, error } = await supabaseServer.rpc("tto_insert_generation_row", {
      p_row: payload,
    });
    const insertedId = typeof data === "string" && data.length > 0 ? data : null;

    if (!error && insertedId) {
      return { id: insertedId };
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

export type TtoInputEvidence = {
  succeeded: boolean;
  /** Source ids of the turns actually included in this generation's packet. */
  considered_source_ids?: string[];
  thread_oldest_sent_at?: string | null;
  omitted_older_turn_count?: number;
  /** Clock captured before the conversation read. Not generated_at. */
  conversation_read_at?: string | null;
  /** Set when this attempt failed before a complete conversation read. */
  retrieval_failed?: boolean;
  /**
   * Discovery identities the failed retrieval did not supply to a model.
   * Not considered, and not a deliberate exclusion.
   */
  retrieval_unavailable_source_ids?: string[];
  thread_tail: {
    source_id?: string;
    sender: "coach" | "user";
    sent_at_utc: string;
    body_sha256?: string;
  } | null;
  thread_message_count?: number;
  goal_text: string;
  existing_body_sha256: string | null;
  existing_body_source: string | null;
  edited_by_tyler: boolean;
  edited_at: string | null;
  delivery: {
    utc_instant: string | null;
    member_local_date: string | null;
    batch_date: string | null;
    effective_local_minute: number | null;
    time_zone: string | null;
    send_slot: string | null;
    preference_updated_at?: string | null;
  };
  attempt_id: string;
  /** Interpreter token from this attempt. Not a delivery-freshness flag. */
  model_existing_text_decision?: "keep" | "replace" | "not_applicable";
  /**
   * Why the saved body remained. model_keep is an affirmative interpreter KEEP.
   * tyler_edit_policy retains the body after REPLACE when the edit is authoritative.
   * Neither value authorizes delivery.
   */
  body_retention?: "model_keep" | "tyler_edit_policy";
  /**
   * Observed during packet selection and deliberately left out of the model input.
   * Not a lifetime ban, and not proof the model saw the body.
   */
  excluded_source_ids?: ExactThreadExcludedSource[];
  /**
   * Policy retention of a Tyler edit whose delivery context is unknown while the
   * current schedule is not the context already on record. Not send authorization.
   */
  delivery_mismatch_unresolved?: boolean;
  /**
   * The body this evidence belongs to. Hash alone is not the version.
   * False means the record is knowledge of an earlier consideration, not approval of the current body.
   */
  current_body_approval?: boolean;
  applies_to_body_version?: TtoBodyVersion;
  /**
   * Source edit the model actually received on a successful KEEP or REPLACE.
   * Absent on failure evidence, so a failed attempt does not count as consideration.
   */
  evaluated_cross_owner_source?: CrossOwnerSourceVersion;
  /**
   * Sunday tape and interruption for this attempt.
   * On a successful KEEP or REPLACE this is the evidence supplied to the interpreter.
   * On a failure it is the snapshot loaded for the attempt, and
   * sunday_context_supplied_to_model is false when the interpreter never received it.
   * Absent on Monday–Saturday. Unavailable is not an empty tape.
   */
  sunday_context?: SundayContextEvidence;
  /**
   * False when sunday_context was loaded for the attempt and the attempt failed
   * before the interpreter received the packet. Absent when the packet supplied it.
   */
  sunday_context_supplied_to_model?: boolean;
};

export type TtoBodyVersion = {
  generation_id: string | null;
  body_hash: string | null;
  edited_at: string | null;
  body_source: string | null;
  edited_by_tyler: boolean;
};

export type TtoEditDeliveryContext = TtoSavedTextDeliveryContext & {
  body_hash: string | null;
  generation_id: string | null;
  edited_at: string | null;
};

export type TtoReconsiderationFence = {
  claimOwnerId: string;
  expectedGenerationId: string;
  expectedEditedAt: string | null;
  expectedBodyHash: string | null;
  expectedBodySource: string | null;
  expectedEditedByTyler: boolean;
  currentBody: string | null;
  delivery: TtoInputEvidence["delivery"];
  /**
   * The current body is a newer Tyler edit and no post-edit member message
   * authorizes replacement. Goal and schedule changes may still be interpreted.
   */
  preserveTylerEdit?: boolean;
  /** Clock the earlier model input actually contained. Not inferred from schedule metadata. */
  originalModelDelivery?: OriginalModelDelivery;
  /** Affirmative KEEP of this same body. Absent when the last success was policy retention. */
  latestAffirmedDelivery?: TtoSavedTextDeliveryContext | null;
  /** Context bound to this Tyler body. Null when the edit has no reliable context. */
  tylerEditDelivery?: TtoSavedTextDeliveryContext | null;
  /**
   * The saved Tyler edit has no reliable delivery context and the current schedule
   * is not the context already recorded. Policy retention must say so.
   */
  deliveryMismatchUnresolved?: boolean;
  /** Discovery identities this attempt must account for before a model call. */
  observedDiscoverySourceIds?: string[];
  /** Source version copied onto the target before this claim. Not itself a successful consideration. */
  transferredSourceEdit?: CrossOwnerSourceVersion;
  /**
   * Sunday snapshot already loaded for this reconsideration attempt.
   * A failure may record it without claiming the interpreter received it.
   */
  attemptedSundayContext?: SundayContextEvidence | "not_sunday";
};

export type CrossOwnerSourceVersion = {
  sourceDraftId: string;
  sourceGenerationId: string;
  sourceBodyHash: string | null;
  sourceEditedAt: string | null;
  sourceBodySource: string | null;
  sourceEditedByTyler: boolean;
};

export type OriginalModelDelivery = NonNullable<
  NonNullable<MorningRelationshipPacket["existing_saved_text"]>["original_model_delivery"]
>;

const SCHEDULED_DELIVERY_CONVENTION = "member_local_delivery_v1";

export type ScheduledProactiveDelivery = {
  timeZone: string;
  memberLocalDate: string;
  effectiveLocalMinute: number;
  utcInstant: string;
  batchDate: string;
  owner: "morning" | "evening";
  sendSlot: string;
  preferenceUpdatedAt: string | null;
};

function dayKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function ownerFromUnknown(value: unknown): "morning" | "evening" | null {
  if (value === "morning" || value === SMS_DAILY_PRODUCTION_SEND_SLOT) return "morning";
  if (value === "evening" || value === "evening_checkin" || value === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return "evening";
  }
  return null;
}

export function scheduledDeliveryFromParts(parts: {
  timeZone: unknown;
  memberLocalDate: unknown;
  effectiveLocalMinute: unknown;
  utcInstant: unknown;
  batchDate: unknown;
  owner: unknown;
  sendSlot: string;
  preferenceUpdatedAt?: unknown;
}): ScheduledProactiveDelivery | null {
  const timeZone = typeof parts.timeZone === "string" ? parts.timeZone.trim() : "";
  const memberLocalDate = dayKey(parts.memberLocalDate);
  const batchDate = dayKey(parts.batchDate);
  const utcInstant = typeof parts.utcInstant === "string" ? parts.utcInstant.trim() : "";
  const minute =
    typeof parts.effectiveLocalMinute === "number"
      ? parts.effectiveLocalMinute
      : typeof parts.effectiveLocalMinute === "string" && parts.effectiveLocalMinute.trim()
        ? Number(parts.effectiveLocalMinute)
        : NaN;
  const owner = ownerFromUnknown(parts.owner);
  if (!timeZone || !isValidIanaTimezone(timeZone) || !memberLocalDate || !batchDate || !owner) {
    return null;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  if (!Number.isFinite(Date.parse(utcInstant))) return null;
  if (!scheduledDeliveryTupleIsCoherent({
    utcInstant,
    memberLocalDate,
    effectiveLocalMinute: minute,
    timeZone,
    owner,
    administrativeBatchDate: batchDate,
  })) {
    return null;
  }
  const preference =
    typeof parts.preferenceUpdatedAt === "string" && parts.preferenceUpdatedAt.trim()
      ? parts.preferenceUpdatedAt
      : null;
  return {
    timeZone,
    memberLocalDate,
    effectiveLocalMinute: minute,
    utcInstant,
    batchDate,
    owner,
    sendSlot: parts.sendSlot,
    preferenceUpdatedAt: preference,
  };
}

/** Legacy callers receive null. A required schedule with missing facts is unresolved. */
export function scheduledDeliveryForGeneration(args: {
  requireScheduled: boolean;
  metadata?: Record<string, unknown> | null;
  fenceDelivery?: TtoInputEvidence["delivery"] | null;
  sendSlot: string;
  fallbackOwner: "morning" | "evening";
  draftForDayKey: string;
}): ScheduledProactiveDelivery | null | "unresolved" {
  const meta = args.metadata ?? null;
  const fence = args.fenceDelivery ?? null;
  const metaScheduled = meta?.scheduled_generation_convention === SCHEDULED_DELIVERY_CONVENTION;
  const fencePresent =
    fence != null &&
    (fence.effective_local_minute != null ||
      fence.utc_instant != null ||
      (typeof fence.time_zone === "string" && fence.time_zone.trim() !== ""));
  if (!args.requireScheduled && !metaScheduled && !fencePresent) return null;
  const fromFence = fence
    ? scheduledDeliveryFromParts({
        timeZone: fence.time_zone,
        memberLocalDate: fence.member_local_date,
        effectiveLocalMinute: fence.effective_local_minute,
        utcInstant: fence.utc_instant,
        batchDate: fence.batch_date,
        owner: args.fallbackOwner,
        sendSlot: typeof fence.send_slot === "string" && fence.send_slot.trim() ? fence.send_slot : args.sendSlot,
        preferenceUpdatedAt: fence.preference_updated_at,
      })
    : null;
  const fromMeta = meta
    ? scheduledDeliveryFromParts({
        timeZone: meta.time_zone,
        memberLocalDate: meta.member_local_date,
        effectiveLocalMinute: meta.effective_local_minute,
        utcInstant: meta.utc_instant,
        batchDate: meta.administrative_batch_date,
        owner: meta.tto_owner ?? args.fallbackOwner,
        sendSlot: args.sendSlot,
      })
    : null;
  const delivery = fromFence ?? fromMeta;
  if (!delivery || delivery.memberLocalDate !== args.draftForDayKey || delivery.owner !== args.fallbackOwner) {
    return "unresolved";
  }
  return delivery;
}

export function evidenceDeliveryFromSchedule(
  delivery: ScheduledProactiveDelivery
): TtoInputEvidence["delivery"] {
  return {
    utc_instant: delivery.utcInstant,
    member_local_date: delivery.memberLocalDate,
    batch_date: delivery.batchDate,
    effective_local_minute: delivery.effectiveLocalMinute,
    time_zone: delivery.timeZone,
    send_slot: delivery.sendSlot,
    preference_updated_at: delivery.preferenceUpdatedAt,
  };
}

function readStoredMessageFor(value: unknown): OriginalModelDelivery["message_for"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const messageFor = (value as { message_for?: unknown }).message_for ?? value;
  if (!messageFor || typeof messageFor !== "object" || Array.isArray(messageFor)) return null;
  const row = messageFor as Record<string, unknown>;
  const timezone = typeof row.timezone === "string" ? row.timezone.trim() : "";
  const local_date = typeof row.local_date === "string" ? row.local_date.trim() : "";
  const local_weekday = typeof row.local_weekday === "string" ? row.local_weekday.trim() : "";
  const daypart = typeof row.daypart === "string" ? row.daypart.trim() : "";
  const intended = typeof row.intended_receive_time_local === "string" ? row.intended_receive_time_local.trim() : "";
  if (!timezone || !local_date || !local_weekday || !daypart || !intended) return null;
  return {
    timezone,
    local_date,
    local_weekday,
    daypart,
    intended_receive_time_local: intended,
    utc_instant: typeof row.utc_instant === "string" ? row.utc_instant : null,
    administrative_batch_date:
      typeof row.administrative_batch_date === "string" ? row.administrative_batch_date : null,
  };
}

/** Uses the stored model packet or interpreter input. Schedule metadata alone is not the model clock. */
export function originalModelDeliveryFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  editedByTyler: boolean
): OriginalModelDelivery {
  const packetClock = readStoredMessageFor(metadata?.morning_relationship_packet_v1);
  const interpreter = metadata?.morning_brief_interpreter_v1;
  const interpreterInput =
    interpreter && typeof interpreter === "object" && !Array.isArray(interpreter)
      ? (interpreter as { exact_input_object?: unknown }).exact_input_object
      : null;
  const interpreterClock = readStoredMessageFor(interpreterInput);
  const messageFor = packetClock ?? interpreterClock;
  if (!messageFor) {
    return { status: "unavailable", describes_saved_body: false, message_for: null };
  }
  return {
    status: "known",
    describes_saved_body: editedByTyler !== true,
    message_for: messageFor,
  };
}

function withObservedSilence(
  packet: MorningRelationshipPacket,
  now: Date,
  timezone: string
): MorningRelationshipPacket {
  return {
    ...packet,
    last_user_response: {
      ...packet.last_user_response,
      days_since_at_generation: observedSilenceDays({
        replyAtUtc: packet.last_user_response.at_utc,
        now,
        timezone,
      }),
    },
  };
}

function unavailableDeliveryContext(): TtoSavedTextDeliveryContext {
  return {
    status: "unavailable",
    member_local_date: null,
    effective_local_minute: null,
    time_zone: null,
    utc_instant: null,
    owner: null,
  };
}

export function minuteFromHhMm(value: string | null | undefined): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 1439 ? minute : null;
}

export function normalizeDeliveryOwner(owner: string | null | undefined): string | null {
  if (owner === "morning" || owner === "evening_checkin") return owner;
  if (owner === "evening") return "evening_checkin";
  return null;
}

function readDeliveryFact(value: unknown): TtoSavedTextDeliveryContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const memberLocalDate = typeof row.member_local_date === "string" ? row.member_local_date.trim() : "";
  const timeZone = typeof row.time_zone === "string" ? row.time_zone.trim() : "";
  const minute = row.effective_local_minute;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(memberLocalDate) || !timeZone) return null;
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const owner = normalizeDeliveryOwner(typeof row.owner === "string" ? row.owner : typeof row.send_slot === "string" ? row.send_slot : null);
  return {
    status: "known",
    member_local_date: memberLocalDate,
    effective_local_minute: minute,
    time_zone: timeZone,
    utc_instant: typeof row.utc_instant === "string" ? row.utc_instant : null,
    owner,
  };
}

export function readTylerEditDeliveryContext(
  metadata: Record<string, unknown> | null | undefined
): TtoEditDeliveryContext | null {
  const raw = metadata?.tyler_edit_delivery_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const status = row.status === "known" ? "known" : row.status === "unavailable" ? "unavailable" : null;
  if (!status) return null;
  const known = status === "known" ? readDeliveryFact(row) : null;
  return {
    ...(known ?? unavailableDeliveryContext()),
    status,
    body_hash: typeof row.body_hash === "string" ? row.body_hash : row.body_hash === null ? null : null,
    generation_id: typeof row.generation_id === "string" ? row.generation_id : null,
    edited_at: typeof row.edited_at === "string" ? row.edited_at : null,
  };
}

export type TtoCurrentDeliveryFacts = {
  memberLocalDate: string;
  effectiveLocalMinute: number;
  timeZone: string;
  utcInstant: string;
  owner: string;
};

/** True only for a known context bound to this exact body and a real schedule difference. */
export function tylerEditDeliveryMateriallyDiffers(args: {
  context: TtoEditDeliveryContext | null;
  currentBodyHash: string | null;
  current: TtoCurrentDeliveryFacts;
}): boolean {
  const context = args.context;
  if (!context || context.status !== "known") return false;
  if ((context.body_hash ?? null) !== (args.currentBodyHash ?? null)) return false;
  if (context.member_local_date !== args.current.memberLocalDate) return true;
  if (context.effective_local_minute !== args.current.effectiveLocalMinute) return true;
  if ((context.time_zone ?? "") !== args.current.timeZone) return true;
  const contextOwner = normalizeDeliveryOwner(context.owner);
  const currentOwner = normalizeDeliveryOwner(args.current.owner);
  if (contextOwner && currentOwner && contextOwner !== currentOwner) return true;
  if (
    context.utc_instant &&
    args.current.utcInstant &&
    context.utc_instant !== args.current.utcInstant
  ) {
    return true;
  }
  return false;
}

/** Same instant. Both absent matches. An unparseable value never matches. */
export function recordedInstantsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (left == null && right == null) return true;
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (!left.trim() || !right.trim()) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false;
  return leftMs === rightMs;
}

/** Known edit context for this generation, hash, and edit instant. The hash alone is not the version. */
export function editContextBelongsToBodyVersion(
  context: TtoEditDeliveryContext | null,
  version: TtoBodyVersion
): boolean {
  if (!context || context.status !== "known") return false;
  if ((context.generation_id ?? null) !== (version.generation_id ?? null)) return false;
  if ((context.body_hash ?? null) !== (version.body_hash ?? null)) return false;
  return recordedInstantsMatch(context.edited_at, version.edited_at);
}

export function considerationMatchesCurrentDelivery(
  considered: TtoInputEvidence | null | undefined,
  current: { utcInstant: string; effectiveLocalMinute: number; timeZone: string }
): boolean {
  if (!considered) return false;
  return considered.delivery.utc_instant === current.utcInstant
    && considered.delivery.effective_local_minute === current.effectiveLocalMinute
    && (considered.delivery.time_zone ?? "") === current.timeZone;
}

/**
 * The current body's confirmed context differs from the live schedule, and this
 * exact body has not already been successfully considered for that live delivery.
 * Approval of another version, or of this version for a different delivery, does not suppress it.
 */
export function currentBodyEditContextRequiresReconsideration(args: {
  context: TtoEditDeliveryContext | null;
  currentBodyHash: string | null;
  current: TtoCurrentDeliveryFacts;
  considered: TtoInputEvidence | null;
  currentVersion: TtoBodyVersion;
}): boolean {
  if (!editContextBelongsToBodyVersion(args.context, args.currentVersion)) return false;
  if (!tylerEditDeliveryMateriallyDiffers({
    context: args.context,
    currentBodyHash: args.currentBodyHash,
    current: args.current,
  })) {
    return false;
  }
  if (
    evidenceApprovesCurrentBody(args.considered, args.currentVersion)
    && considerationMatchesCurrentDelivery(args.considered, args.current)
  ) {
    return false;
  }
  return true;
}

export function bodyVersionsMatch(
  left: TtoBodyVersion | null | undefined,
  right: TtoBodyVersion | null | undefined
): boolean {
  if (!left || !right) return false;
  return left.generation_id === right.generation_id
    && (left.body_hash ?? null) === (right.body_hash ?? null)
    && recordedInstantsMatch(left.edited_at, right.edited_at)
    && (left.body_source ?? null) === (right.body_source ?? null)
    && left.edited_by_tyler === right.edited_by_tyler;
}

export function fenceBodyVersion(fence: TtoReconsiderationFence): TtoBodyVersion {
  return {
    generation_id: fence.expectedGenerationId,
    body_hash: fence.expectedBodyHash,
    edited_at: fence.expectedEditedAt,
    body_source: fence.expectedBodySource,
    edited_by_tyler: fence.expectedEditedByTyler,
  };
}

/** True only when this evidence approves this exact body version. */
export function evidenceApprovesCurrentBody(
  evidence: TtoInputEvidence | null | undefined,
  version: TtoBodyVersion
): boolean {
  if (!evidence || evidence.succeeded !== true || evidence.current_body_approval === false) return false;
  if (evidence.applies_to_body_version) return bodyVersionsMatch(evidence.applies_to_body_version, version);
  return (evidence.existing_body_sha256 ?? null) === (version.body_hash ?? null)
    && recordedInstantsMatch(evidence.edited_at, version.edited_at)
    && (evidence.existing_body_source ?? null) === (version.body_source ?? null)
    && evidence.edited_by_tyler === version.edited_by_tyler;
}

export function bindFinishedConsiderationEvidence(args: {
  evidence: TtoInputEvidence;
  result: "keep" | "release" | "replace";
  version: TtoBodyVersion;
}): TtoInputEvidence {
  if (args.result === "release") {
    return {
      ...args.evidence,
      succeeded: false,
      current_body_approval: false,
      applies_to_body_version: args.evidence.applies_to_body_version ?? args.version,
    };
  }
  if (args.evidence.current_body_approval === false) {
    return { ...args.evidence, succeeded: true, current_body_approval: false };
  }
  return {
    ...args.evidence,
    succeeded: true,
    current_body_approval: true,
    applies_to_body_version: args.result === "replace"
      ? args.version
      : (args.evidence.applies_to_body_version ?? args.version),
  };
}

/**
 * Sunday input known when the attempt failed.
 * Not proof the interpreter received it, and not a successful empty tape.
 */
export function attemptedSundayFailureFields(
  attempted: SundayContextEvidence | "not_sunday" | undefined
): Partial<TtoInputEvidence> {
  if (!attempted || attempted === "not_sunday") {
    return {
      sunday_context: undefined,
      sunday_context_supplied_to_model: undefined,
    };
  }
  return {
    sunday_context: attempted,
    sunday_context_supplied_to_model: false,
  };
}

export function retrievalFailureEvidence(fence: TtoReconsiderationFence): TtoInputEvidence {
  return {
    succeeded: false,
    retrieval_failed: true,
    considered_source_ids: [],
    excluded_source_ids: [],
    retrieval_unavailable_source_ids: fence.observedDiscoverySourceIds ?? [],
    thread_tail: null,
    goal_text: "",
    existing_body_sha256: fence.expectedBodyHash,
    existing_body_source: fence.expectedBodySource,
    edited_by_tyler: fence.expectedEditedByTyler,
    edited_at: fence.expectedEditedAt,
    delivery: fence.delivery,
    attempt_id: fence.claimOwnerId,
    current_body_approval: false,
    applies_to_body_version: fenceBodyVersion(fence),
    evaluated_cross_owner_source: undefined,
    ...attemptedSundayFailureFields(fence.attemptedSundayContext),
  };
}

export function unobservedDiscoverySourceIds(args: {
  discoveredSourceIds: string[];
  consideredSourceIds: string[];
  excludedSourceIds: Array<{ source_id?: string | null }>;
}): string[] {
  const seen = new Set(args.consideredSourceIds);
  for (const item of args.excludedSourceIds) {
    if (typeof item.source_id === "string" && item.source_id.trim()) seen.add(item.source_id.trim());
  }
  return args.discoveredSourceIds.filter((sourceId) => sourceId.trim() !== "" && !seen.has(sourceId));
}

export function failureAppliesToCurrentBody(
  evidence: TtoInputEvidence | null | undefined,
  version: TtoBodyVersion
): boolean {
  if (!evidence) return false;
  if (!evidence.applies_to_body_version) return true;
  return bodyVersionsMatch(evidence.applies_to_body_version, version);
}

export function latestAffirmedDeliveryFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  currentBodyHash: string | null,
  currentVersion?: TtoBodyVersion | null
): TtoSavedTextDeliveryContext | null {
  const raw = metadata?.reconsideration_evidence;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as TtoInputEvidence;
  if (record.succeeded !== true || record.body_retention !== "model_keep") return null;
  if (record.current_body_approval === false) return null;
  if (currentVersion) {
    if (!evidenceApprovesCurrentBody(record, currentVersion)) return null;
  } else if (record.applies_to_body_version) {
    if ((record.applies_to_body_version.body_hash ?? null) !== (currentBodyHash ?? null)) return null;
    if (
      record.applies_to_body_version.edited_by_tyler === true ||
      record.applies_to_body_version.edited_at != null
    ) {
      return null;
    }
  } else if ((record.existing_body_sha256 ?? null) !== (currentBodyHash ?? null)) return null;
  const delivery = record.delivery;
  if (!delivery) return null;
  return readDeliveryFact({
    member_local_date: delivery.member_local_date,
    effective_local_minute: delivery.effective_local_minute,
    time_zone: delivery.time_zone,
    utc_instant: delivery.utc_instant,
    send_slot: delivery.send_slot,
  });
}

export function persistedDeliveryFactsFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): TtoCurrentDeliveryFacts[] {
  if (!metadata) return [];
  const found: TtoCurrentDeliveryFacts[] = [];
  const push = (fact: TtoSavedTextDeliveryContext | null) => {
    if (!fact || fact.status !== "known" || fact.member_local_date == null || fact.effective_local_minute == null || !fact.time_zone) return;
    const owner = normalizeDeliveryOwner(fact.owner) ?? "morning";
    if (found.some((item) =>
      item.memberLocalDate === fact.member_local_date &&
      item.effectiveLocalMinute === fact.effective_local_minute &&
      item.timeZone === fact.time_zone &&
      item.utcInstant === (fact.utc_instant ?? "")
    )) return;
    found.push({
      memberLocalDate: fact.member_local_date,
      effectiveLocalMinute: fact.effective_local_minute,
      timeZone: fact.time_zone,
      utcInstant: fact.utc_instant ?? "",
      owner,
    });
  };
  push(readDeliveryFact({
    member_local_date: metadata.member_local_date,
    effective_local_minute: metadata.effective_local_minute,
    time_zone: metadata.time_zone,
    utc_instant: metadata.utc_instant,
    owner: metadata.tto_owner,
  }));
  const evidenceObjects = [metadata.input_evidence, metadata.reconsideration_evidence];
  for (const evidence of evidenceObjects) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) continue;
    const delivery = (evidence as { delivery?: unknown }).delivery;
    push(readDeliveryFact(delivery));
  }
  const messageFor = readStoredMessageFor(metadata.morning_relationship_packet_v1);
  if (messageFor) {
    const minute = minuteFromHhMm(messageFor.intended_receive_time_local);
    if (minute != null) {
      push(readDeliveryFact({
        member_local_date: messageFor.local_date,
        effective_local_minute: minute,
        time_zone: messageFor.timezone,
        utc_instant: messageFor.utc_instant,
        owner: messageFor.daypart === "evening" ? "evening_checkin" : messageFor.daypart,
      }));
    }
  }
  return found;
}

function savedTextForFence(fence: TtoReconsiderationFence): MorningRelationshipPacket["existing_saved_text"] {
  const tylerEdit = fence.expectedEditedByTyler
    ? fence.tylerEditDelivery ?? unavailableDeliveryContext()
    : undefined;
  return {
    body: fence.currentBody,
    body_source: fence.expectedBodySource,
    edited_by_tyler: fence.expectedEditedByTyler,
    edited_at: fence.expectedEditedAt,
    original_model_delivery: fence.originalModelDelivery ?? {
      status: "unavailable",
      describes_saved_body: false,
      message_for: null,
    },
    ...(fence.latestAffirmedDelivery ? { latest_affirmed_delivery: fence.latestAffirmedDelivery } : {}),
    ...(tylerEdit ? { tyler_edit_delivery: tylerEdit } : {}),
  };
}

/** What the loaded packet actually contained. Not the completion clock. */
export function buildTtoInputEvidence(args: {
  packet: MorningRelationshipPacket;
  attemptId: string;
  existingBody?: string | null;
  existingBodySource?: string | null;
  editedByTyler?: boolean;
  editedAt?: string | null;
  delivery?: TtoInputEvidence["delivery"] | null;
  conversationReadAt?: string | null;
  excludedSourceIds?: ExactThreadExcludedSource[];
}): TtoInputEvidence {
  const messages = args.packet.exact_thread.messages;
  const last = messages.at(-1) ?? null;
  const body = args.existingBody ?? null;
  const consideredSourceIds = messages
    .map((message) => (typeof message.source_id === "string" ? message.source_id.trim() : ""))
    .filter(Boolean)
    .slice(0, 30);
  const sundayContext = args.packet.sunday_coaching
    ? sundayContextEvidenceFromCoaching(args.packet.sunday_coaching)
    : undefined;
  return {
    succeeded: false,
    considered_source_ids: consideredSourceIds,
    excluded_source_ids: args.excludedSourceIds ?? [],
    thread_oldest_sent_at: messages[0]?.sent_at_utc ?? null,
    omitted_older_turn_count: args.packet.exact_thread.omitted_older_turn_count,
    conversation_read_at: args.conversationReadAt ?? null,
    thread_tail: last
      ? {
          source_id: typeof last.source_id === "string" ? last.source_id : undefined,
          sender: last.sender,
          sent_at_utc: last.sent_at_utc,
        }
      : null,
    thread_message_count: messages.length,
    goal_text: args.packet.current_goal.text,
    existing_body_sha256: body && body.trim() ? hashSmsSnippet(body) : null,
    existing_body_source: args.existingBodySource ?? null,
    edited_by_tyler: args.editedByTyler === true,
    edited_at: args.editedAt ?? null,
    delivery: args.delivery ?? {
      utc_instant: null,
      member_local_date: args.packet.message_for.local_date,
      batch_date: null,
      effective_local_minute: null,
      time_zone: args.packet.message_for.timezone,
      send_slot: null,
    },
    attempt_id: args.attemptId,
    ...(sundayContext ? { sunday_context: sundayContext } : {}),
  };
}

export function successfulConsiderationEvidence(
  metadata: Record<string, unknown> | null | undefined
): TtoInputEvidence | null {
  if (!metadata) return null;
  const reconsideration = metadata.reconsideration_evidence;
  if (reconsideration && typeof reconsideration === "object" && !Array.isArray(reconsideration)) {
    const record = reconsideration as TtoInputEvidence;
    if (record.succeeded === true) return record;
  }
  const input = metadata.input_evidence;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as TtoInputEvidence;
  }
  return null;
}

export function reconsiderationFailureEvidence(
  metadata: Record<string, unknown> | null | undefined
): TtoInputEvidence | null {
  if (!metadata) return null;
  const failure = metadata.reconsideration_failure_evidence;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    return failure as TtoInputEvidence;
  }
  return null;
}

export function reconsiderationFailureCount(
  metadata: Record<string, unknown> | null | undefined
): number {
  const count = metadata?.reconsideration_failure_count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

async function finishTtoGenerationPersistence(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: SmsDailySendSlot;
  generationId: string;
  machineBody: string | null;
  machineBodyHash: string | null;
  nowIso: string;
  protectTylerProvenanceOnly?: boolean;
  allowReplaceStaleTylerNonempty?: boolean;
  claimOwnerId?: string | null;
  reconsiderationFinish?: TtoReconsiderationFence & {
    evidence: TtoInputEvidence;
  };
}): Promise<{ ok: true; protected: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer.rpc("tto_finish_generation_persistence", {
    p_clerk_user_id: args.clerkUserId,
    p_draft_for_day_key: args.draftForDayKey,
    p_send_slot: args.sendSlot,
    p_new_generation_id: args.generationId,
    p_machine_body: args.machineBody,
    p_machine_body_hash: args.machineBodyHash,
    p_now: args.nowIso,
    p_protect_tyler_provenance_only: args.protectTylerProvenanceOnly === true,
    p_allow_replace_stale_tyler_nonempty: args.allowReplaceStaleTylerNonempty === true,
    ...(args.claimOwnerId
      ? {
          p_claim_owner_id: args.claimOwnerId,
          p_require_claim_owner: true,
        }
      : {}),
    ...(args.reconsiderationFinish
      ? {
          p_reconsideration: true,
          p_reconsideration_result: "replace",
          p_claim_owner_id: args.reconsiderationFinish.claimOwnerId,
          p_require_claim_owner: false,
          p_expected_generation_id: args.reconsiderationFinish.expectedGenerationId,
          p_expected_edited_at: args.reconsiderationFinish.expectedEditedAt,
          p_expected_body_hash: args.reconsiderationFinish.expectedBodyHash,
          p_expected_body_source: args.reconsiderationFinish.expectedBodySource,
          p_expected_edited_by_tyler: args.reconsiderationFinish.expectedEditedByTyler,
          p_reconsideration_evidence: {
            ...bindFinishedConsiderationEvidence({
              evidence: args.reconsiderationFinish.evidence,
              result: "replace",
              version: {
                generation_id: args.generationId,
                body_hash: args.machineBodyHash,
                edited_at: null,
                body_source: "machine",
                edited_by_tyler: false,
              },
            }),
            ...(args.reconsiderationFinish.transferredSourceEdit
              ? { evaluated_cross_owner_source: args.reconsiderationFinish.transferredSourceEdit }
              : {}),
          },
        }
      : {}),
  });
  if (error) {
    console.error("[tyler-text-overview] tto_finish_generation_persistence_failed", {
      clerk_user_id: args.clerkUserId,
      draft_for_day_key: args.draftForDayKey,
      generation_id: args.generationId,
      message: error.message,
    });
    return { ok: false, error: error.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; protected?: boolean; reason?: string }
    | null
    | undefined;
  if (!row || row.ok !== true) {
    const reason =
      row && typeof row.reason === "string" && row.reason.trim()
        ? row.reason.trim()
        : "tto_finish_generation_persistence_failed";
    console.error("[tyler-text-overview] tto_finish_generation_persistence_rejected", {
      clerk_user_id: args.clerkUserId,
      draft_for_day_key: args.draftForDayKey,
      generation_id: args.generationId,
      reason,
    });
    return { ok: false, error: reason };
  }
  return { ok: true, protected: row.protected === true };
}

export async function finishReconsiderationDecision(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: SmsDailySendSlot;
  fence: TtoReconsiderationFence;
  result: "keep" | "release";
  evidence: TtoInputEvidence;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const bound = bindFinishedConsiderationEvidence({
    evidence: args.evidence,
    result: args.result,
    version: fenceBodyVersion(args.fence),
  });
  const evidence = args.result === "keep" && args.fence.transferredSourceEdit
    ? { ...bound, evaluated_cross_owner_source: args.fence.transferredSourceEdit }
    : bound;
  const { data, error } = await supabaseServer.rpc("tto_finish_generation_persistence", {
    p_clerk_user_id: args.clerkUserId,
    p_draft_for_day_key: args.draftForDayKey,
    p_send_slot: args.sendSlot,
    p_new_generation_id: args.fence.expectedGenerationId,
    p_machine_body: null,
    p_machine_body_hash: null,
    p_now: new Date().toISOString(),
    p_protect_tyler_provenance_only: true,
    p_reconsideration: true,
    p_reconsideration_result: args.result,
    p_claim_owner_id: args.fence.claimOwnerId,
    p_expected_generation_id: args.fence.expectedGenerationId,
    p_expected_edited_at: args.fence.expectedEditedAt,
    p_expected_body_hash: args.fence.expectedBodyHash,
    p_expected_body_source: args.fence.expectedBodySource,
    p_expected_edited_by_tyler: args.fence.expectedEditedByTyler,
    p_reconsideration_evidence: evidence,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string } | null;
  if (!row || row.ok !== true) {
    return { ok: false, error: row?.reason ?? "reconsideration_finish_failed" };
  }
  return { ok: true };
}

async function releaseUnobservedDiscovery(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: SmsDailySendSlot;
  fence: TtoReconsiderationFence;
  consideredSourceIds: string[];
  excludedSourceIds: ExactThreadExcludedSource[];
}): Promise<boolean> {
  if (!args.fence.observedDiscoverySourceIds) return false;
  const missing = unobservedDiscoverySourceIds({
    discoveredSourceIds: args.fence.observedDiscoverySourceIds,
    consideredSourceIds: args.consideredSourceIds,
    excludedSourceIds: args.excludedSourceIds,
  });
  if (missing.length === 0) return false;
  await finishReconsiderationDecision({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot: args.sendSlot,
    fence: args.fence,
    result: "release",
    evidence: retrievalFailureEvidence(args.fence),
  });
  return true;
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

  if (args.respectProtectedMorningDraft === false) {
    return {
      ok: false,
      reason: "upsert_failed",
      error: "protected_draft_bypass_refused",
    };
  }

  const inserted = await insertGenerationRow(generationRow);
  if ("error" in inserted) {
    return { ok: false, reason: "insert_failed", error: inserted.error };
  }

  const nowIso = args.now.toISOString();
  const finished = await finishTtoGenerationPersistence({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    sendSlot,
    generationId: inserted.id,
    machineBody: generationRow.machine_draft_body,
    machineBodyHash: generationRow.machine_body_hash,
    nowIso,
    protectTylerProvenanceOnly: false,
  });
  if (!finished.ok) {
    return { ok: false, reason: "upsert_failed", error: finished.error };
  }

  return {
    ok: true,
    generationId: inserted.id,
    supersedeFailed: false,
    currentDraftProtected: finished.protected,
  };
}

export type TylerTextOverviewMorningDraftResult =
  | {
      ok: true;
      draftForDayKey: string;
      generationId: string;
      body: string | null;
      machineShouldSend: boolean;
      /** Present when this completed generation is an exact intentional SPACE. */
      machineNoSendReason?: string | null;
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

function isRealBriefString(value: string | null | "unknown" | undefined): value is string {
  return typeof value === "string" && value !== "unknown" && value.trim().length > 0;
}

function buildOptionalMorningPatRetrievalQuery(brief: MorningCoachingBriefV1): string {
  const parts: string[] = [];
  if (isRealBriefString(brief.human_situation.most_alive)) {
    parts.push(brief.human_situation.most_alive);
  }
  const stale = brief.conversation_continuity.stale_or_exhausted_topics;
  if (Array.isArray(stale)) {
    for (const item of stale) {
      if (typeof item === "string" && item.trim()) parts.push(item);
    }
  }
  const goal = brief.goal_role_today.canonical_goal;
  if (typeof goal === "string" && goal.trim()) parts.push(goal);
  return normalizePatSmsQuery(parts.join("\n"));
}

export type OptionalMorningPatWriterEvidence = {
  excerpts: Array<{
    book_id: string;
    section_title: string;
    text: string;
  }>;
};

/** Optional top-1 Pat book excerpt for Morning/Evening. Fail-soft; never parks. */
export async function maybeLoadOptionalMorningPatEvidence(args: {
  brief: MorningCoachingBriefV1;
  packet: MorningRelationshipPacket;
  quietFacts: QuietRelationshipMechanicalFacts;
}): Promise<OptionalMorningPatWriterEvidence | null> {
  const { brief, packet, quietFacts } = args;
  if (brief.coaching_direction.proactive_decision !== "send") return null;
  if (isRealBriefString(brief.human_situation.direct_question_or_need)) return null;
  if (isRealBriefString(brief.conversation_continuity.open_loop)) return null;
  if (brief.goal_role_today.role === "central") return null;
  if (packet.hard_state.pending_goal_change != null) return null;
  const stale = brief.conversation_continuity.stale_or_exhausted_topics;
  const hasStaleTopic =
    Array.isArray(stale) && stale.some((item) => typeof item === "string" && item.trim().length > 0);
  if (!hasStaleTopic && quietFacts.message_required_today !== true) return null;

  const query = buildOptionalMorningPatRetrievalQuery(brief);
  if (!query) return null;

  try {
    const { packet: evidence } = await getPatEvidenceForSms({ query, topK: 1 });
    const excerpt = evidence.retrieval_status === "ok" ? evidence.excerpts[0] : undefined;
    if (!excerpt) return null;
    return {
      excerpts: [
        {
          book_id: excerpt.book_id,
          section_title: excerpt.section_title,
          text: excerpt.text,
        },
      ],
    };
  } catch {
    return null;
  }
}

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
export function reconsiderationAppliesKeep(args: {
  decision: string;
  preserveTylerEdit?: boolean;
}): boolean {
  return args.decision === "keep" || (args.decision === "replace" && args.preserveTylerEdit === true);
}

/** Records the model token separately from the decision to leave the saved body in place. */
export function reconsiderationRetentionEvidence(args: {
  evidence: TtoInputEvidence;
  decision: string;
  deliveryMismatchUnresolved?: boolean;
}): TtoInputEvidence {
  if (args.decision === "replace") {
    return {
      ...args.evidence,
      model_existing_text_decision: "replace",
      body_retention: "tyler_edit_policy",
      ...(args.deliveryMismatchUnresolved ? { delivery_mismatch_unresolved: true } : {}),
    };
  }
  const kept: TtoInputEvidence = {
    ...args.evidence,
    model_existing_text_decision: "keep",
    body_retention: "model_keep",
  };
  delete kept.delivery_mismatch_unresolved;
  return kept;
}

function packetWithoutProactiveCompliance(
  packet: MorningRelationshipPacket
): MorningRelationshipPacket {
  const messages = packet.exact_thread.messages.filter(
    (message) => message.sender !== "user" || !isProactiveConversationComplianceBody(message.body)
  );
  if (messages.length === packet.exact_thread.messages.length) return packet;
  return {
    ...packet,
    exact_thread: {
      ...packet.exact_thread,
      messages,
    },
  };
}

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
    message_for: packet.message_for,
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
    historical_evidence: packet.historical_evidence,
    coach_relationship_memory: packet.coach_relationship_memory,
    exact_thread: {
      window_days: 21 as const,
      max_messages: 30 as const,
      messages: packet.exact_thread.messages,
      omitted_older_turn_count: packet.exact_thread.omitted_older_turn_count,
    },
    answered_user_message_links: packet.answered_user_message_links ?? [],
  };
}

const SCHEDULED_CONVENTION = "member_local_delivery_v1";

async function unclaimedCompletedScheduledDraft(args: {
  clerkUserId: string;
  draftForDayKey: string;
  sendSlot: string;
}): Promise<
  | { kind: "continue" }
  | { kind: "failed" }
  | {
      kind: "protected";
      generationId: string;
      body: string | null;
      machineShouldSend: boolean;
      machineNoSendReason: string | null;
    }
> {
  const draft = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "current_generation_id, current_body_to_send, current_body_source, edited_by_tyler"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", args.sendSlot)
    .eq("status", "current")
    .maybeSingle();
  if (draft.error) return { kind: "failed" };
  const generationId =
    typeof draft.data?.current_generation_id === "string" ? draft.data.current_generation_id : "";
  if (!generationId) return { kind: "continue" };
  const generation = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("machine_should_send, machine_no_send_reason, generation_metadata")
    .eq("id", generationId)
    .maybeSingle();
  if (generation.error || !generation.data) return { kind: "failed" };
  const metadata =
    generation.data.generation_metadata &&
    typeof generation.data.generation_metadata === "object" &&
    !Array.isArray(generation.data.generation_metadata)
      ? (generation.data.generation_metadata as Record<string, unknown>)
      : null;
  if (metadata?.scheduled_generation_convention !== SCHEDULED_CONVENTION) return { kind: "continue" };
  const body =
    typeof draft.data?.current_body_to_send === "string" ? draft.data.current_body_to_send : null;
  const machineNoSendReason =
    typeof generation.data.machine_no_send_reason === "string"
      ? generation.data.machine_no_send_reason
      : null;
  const completed =
    draft.data?.edited_by_tyler === true ||
    draft.data?.current_body_source === "tyler_edit" ||
    machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE ||
    Boolean(body && body.trim());
  if (!completed) return { kind: "continue" };
  return {
    kind: "protected",
    generationId,
    body,
    machineShouldSend: generation.data.machine_should_send === true,
    machineNoSendReason,
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
  /** Relationship-state refresh: overwrite machine copy; pin Tyler edit/blank. */
  protectTylerProvenanceOnly?: boolean;
  /** Send-time stale conversation only. Default false. */
  allowReplaceStaleTylerNonempty?: boolean;
  replacedStaleTylerBody?: string | null;
  replacedStaleTylerEditedAt?: string | null;
  /**
   * The proactive calculator already decided this delivery.
   * Legacy weekend and cadence skips must not override that decision.
   */
  scheduleAuthoritativelyResolved?: boolean;
  scheduledGenerationMetadata?: Record<string, unknown> | null;
  claimOwnerId?: string | null;
  reconsideration?: TtoReconsiderationFence;
}): Promise<TylerTextOverviewMorningDraftResult> {
  const draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  if (!args.claimOwnerId && !args.reconsideration) {
    const guard = await unclaimedCompletedScheduledDraft({
      clerkUserId: args.audienceUser.clerk_user_id,
      draftForDayKey,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    });
    if (guard.kind === "failed") {
      return { ok: false, reason: "upsert_failed", error: "draft_read_failed" };
    }
    if (guard.kind === "protected") {
      return {
        ok: true,
        draftForDayKey,
        generationId: guard.generationId,
        body: guard.body,
        machineShouldSend: guard.machineShouldSend,
        machineNoSendReason: guard.machineNoSendReason,
        writerPromptPath: null,
        supersedeFailed: false,
        currentDraftProtected: true,
      };
    }
  }
  const persistProtect = {
    ...(args.protectTylerProvenanceOnly === true
      ? { protectTylerProvenanceOnly: true as const }
      : {}),
    ...(args.allowReplaceStaleTylerNonempty === true
      ? {
          allowReplaceStaleTylerNonempty: true as const,
          replacedStaleTylerBody: args.replacedStaleTylerBody ?? null,
          replacedStaleTylerEditedAt: args.replacedStaleTylerEditedAt ?? null,
        }
      : {}),
  };
  const scheduledAttach = {
    ...(args.scheduledGenerationMetadata
      ? { scheduledGenerationMetadata: args.scheduledGenerationMetadata }
      : {}),
    ...(args.claimOwnerId ? { claimOwnerId: args.claimOwnerId } : {}),
  };
  const clerkUserId = args.audienceUser.clerk_user_id;
  const user = await getClerkUser(clerkUserId);
  const md = (user.public_metadata ?? {}) as Record<string, unknown>;

  const scheduled = scheduledDeliveryForGeneration({
    requireScheduled: args.scheduleAuthoritativelyResolved === true || args.reconsideration != null,
    metadata: args.scheduledGenerationMetadata ?? null,
    fenceDelivery: args.reconsideration?.delivery ?? null,
    sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    fallbackOwner: "morning",
    draftForDayKey,
  });
  if (scheduled === "unresolved") {
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: retrievalFailureEvidence(args.reconsideration),
      });
    }
    return { ok: false, reason: "upsert_failed", error: "scheduled_delivery_unresolved" };
  }

  const tzResolved = resolveSmsUserTimezone({
    clerkMetadataTimezone: md.timezone,
    audienceTimezone: args.audienceUser.timezone,
  });
  const timezone = scheduled ? scheduled.timeZone : tzResolved.timezone;
  const localNow = new Date(args.now.toLocaleString("en-US", { timeZone: tzResolved.timezone }));

  const commsPrefs = await fetchV2UserSmsCommsPreferences(clerkUserId);
  if (args.scheduleAuthoritativelyResolved !== true && !scheduled) {
    const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, args.now);
    if (commsSkip.skip) {
      return { ok: false, reason: "comms_prefs" };
    }
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
    daypart: "morning",
    intendedReceiveTimeLocal: scheduled
      ? formatMinuteOfDayAsHhMm(scheduled.effectiveLocalMinute)
      : undefined,
    utcInstant: scheduled?.utcInstant,
    administrativeBatchDate: scheduled?.batchDate,
    boundConversationAtNow: scheduled != null,
  });

  if (!packetResult.ok) {
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: retrievalFailureEvidence(args.reconsideration),
      });
      return { ok: false, reason: "upsert_failed", error: packetResult.error };
    }
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "noon_batch",
      commitmentId: null,
      timezone,
      sendPrefSnapshot,
      now: args.now,
      failure: { error: packetResult.error },
      ...persistProtect, ...scheduledAttach,
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

  const { packet: loadedPacket, commitmentId, conversationReadAt, excludedSourceIds } = packetResult;
  const packet = await attachSundayCoachingContext({
    packet: withObservedSilence(
      packetWithoutProactiveCompliance(loadedPacket),
      args.now,
      timezone
    ),
    clerkUserId,
    commitmentId,
    now: args.now,
  });
  const modelPacket: MorningRelationshipPacket = args.reconsideration
    ? { ...packet, existing_saved_text: savedTextForFence(args.reconsideration) }
    : packet;
  const inputEvidence = buildTtoInputEvidence({
    packet: modelPacket,
    attemptId: args.reconsideration?.claimOwnerId ?? args.claimOwnerId ?? "initial",
    existingBody: args.reconsideration?.currentBody,
    existingBodySource: args.reconsideration?.expectedBodySource,
    editedByTyler: args.reconsideration?.expectedEditedByTyler,
    editedAt: args.reconsideration?.expectedEditedAt,
    delivery: scheduled ? evidenceDeliveryFromSchedule(scheduled) : args.reconsideration?.delivery,
    conversationReadAt,
    excludedSourceIds,
  });
  if (
    args.reconsideration &&
    await releaseUnobservedDiscovery({
      clerkUserId,
      draftForDayKey,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      fence: args.reconsideration,
      consideredSourceIds: inputEvidence.considered_source_ids ?? [],
      excludedSourceIds: excludedSourceIds ?? [],
    })
  ) {
    return { ok: false, reason: "upsert_failed", error: "conversation_retrieval_incomplete" };
  }
  const evidenceMeta = {
    input_evidence: inputEvidence,
    ...(args.reconsideration?.expectedEditedByTyler
      ? {
          replaced_stale_tyler_body: args.reconsideration.currentBody,
          replaced_stale_tyler_edited_at: args.reconsideration.expectedEditedAt,
          replacement_reason: "reconsideration_replace",
        }
      : {}),
  };
  const replaceFinish = args.reconsideration
    ? {
        reconsiderationFinish: {
          ...args.reconsideration,
          evidence: { ...inputEvidence, succeeded: true },
        },
      }
    : {};
  const packetMetadata = {
    thread_message_count: modelPacket.exact_thread.messages.length,
    days_since_last_user_response: modelPacket.last_user_response.days_since,
    never_replied: modelPacket.last_user_response.never_replied,
    has_pending_goal_change: modelPacket.hard_state.pending_goal_change != null,
  };

  const quietFacts = await resolveQuietRelationshipMechanicalFacts({
    clerkUserId,
    timezone,
    localDate: draftForDayKey,
    daysSinceLastUserResponse:
      modelPacket.last_user_response.days_since_at_generation ??
      modelPacket.last_user_response.days_since,
    observedAsOfLocalDate: getDateKeyInTimezone(args.now, timezone),
    neverReplied: modelPacket.last_user_response.never_replied,
    recentUnansweredOutboundCount: countRecentUnansweredOutboundFromExactThread(
      modelPacket.exact_thread.messages
    ),
  });

  // Phase 2D: Brief → Sol final writer. Packet unmutated; Brief is separate input.
  const briefMetadataExtra = await runObservationalMorningBriefInterpreter({
    packet: modelPacket,
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

  if (args.reconsideration) {
    const decision =
      morningCoachingBrief.coaching_direction.existing_text_decision ?? "not_applicable";
    if (
      reconsiderationAppliesKeep({
        decision,
        preserveTylerEdit: args.reconsideration.preserveTylerEdit,
      })
    ) {
      const kept = await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fence: args.reconsideration,
        result: "keep",
        evidence: reconsiderationRetentionEvidence({
          evidence: inputEvidence,
          decision,
          deliveryMismatchUnresolved: args.reconsideration.deliveryMismatchUnresolved === true,
        }),
      });
      if (!kept.ok) return { ok: false, reason: "upsert_failed", error: kept.error };
      return {
        ok: true,
        draftForDayKey,
        generationId: args.reconsideration.expectedGenerationId,
        body: args.reconsideration.currentBody,
        machineShouldSend: Boolean(args.reconsideration.currentBody?.trim()),
        writerPromptPath: null,
        supersedeFailed: false,
        currentDraftProtected: true,
      };
    }
    if (decision !== "replace") {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: inputEvidence,
      });
      return { ok: false, reason: "upsert_failed", error: "reconsideration_invalid" };
    }
  }

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
      ...persistEffectiveAskFromPacket(packet),
      generationMetadataExtra: {
        ...evidenceMeta,
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: true,
        error: null,
        message_for: modelPacket.message_for,
        morning_relationship_packet_v1: modelPacket,
      },
      notebookVerdictReason: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
      ...replaceFinish,
      ...persistProtect, ...scheduledAttach,
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
      supersedeFailed: persisted.supersedeFailed,
      currentDraftProtected: persisted.currentDraftProtected,
    };
  }

  const optionalPatSourceEvidence = await maybeLoadOptionalMorningPatEvidence({
    brief: morningCoachingBrief,
    packet,
    quietFacts,
  });
  const writerResult = await writeMorningTtoBody({
    packet,
    morningCoachingBrief,
    ...(optionalPatSourceEvidence ? { optionalPatSourceEvidence } : {}),
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
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: inputEvidence,
      });
      return { ok: false, reason: "upsert_failed", error: writerResult.error };
    }
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
      ...persistEffectiveAskFromPacket(packet),
      generationMetadataExtra: {
        ...evidenceMeta,
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: false,
        message_for: modelPacket.message_for,
        morning_relationship_packet_v1: modelPacket,
      },
      ...persistProtect, ...scheduledAttach,
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

  const smsBody = hygienedMorningEveningSmsBody({
    body: writerResult.body,
    packet,
  });
  const persisted = await persistMorningTtoGeneration({
    clerkUserId,
    draftForDayKey,
    generationReason: args.generationReason ?? "noon_batch",
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now: args.now,
    success: {
      body: smsBody,
      messages: mapOpenAiMessagesToWriterCapture(writerResult.messages),
      writerPromptPath: writerResult.writer_prompt_path,
      model: writerResult.model,
      retryMessages,
      retryOccurred,
      retrySucceeded: retryOccurred ? true : undefined,
      writerCapture,
    },
    packetMetadata,
    ...persistEffectiveAskFromPacket(packet),
    generationMetadataExtra: {
      ...evidenceMeta,
      ...briefMetadataExtra,
      morning_coaching_brief_v1: morningCoachingBrief,
      ...quietMeta,
      intentional_space: false,
      message_for: modelPacket.message_for,
      morning_relationship_packet_v1: modelPacket,
    },
    ...replaceFinish,
    ...persistProtect, ...scheduledAttach,
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  return {
    ok: true,
    draftForDayKey,
    generationId: persisted.generationId,
    body: smsBody,
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
  /** Relationship-state refresh: overwrite machine copy; pin Tyler edit/blank. */
  protectTylerProvenanceOnly?: boolean;
  /** Send-time stale conversation only. Default false. */
  allowReplaceStaleTylerNonempty?: boolean;
  replacedStaleTylerBody?: string | null;
  replacedStaleTylerEditedAt?: string | null;
  /** The proactive calculator already decided this delivery. */
  scheduleAuthoritativelyResolved?: boolean;
  scheduledGenerationMetadata?: Record<string, unknown> | null;
  claimOwnerId?: string | null;
  generationReason?: TylerTextOverviewGenerationReason;
  reconsideration?: TtoReconsiderationFence;
}): Promise<TylerTextOverviewEveningPreviewResult> {
  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) {
    return { ok: false, reason: "audience", error: "missing_clerk_user_id" };
  }
  const eveningDayKey = args.draftForDayKey?.trim() ?? "";
  if (
    !args.claimOwnerId &&
    !args.reconsideration &&
    /^\d{4}-\d{2}-\d{2}$/.test(eveningDayKey)
  ) {
    const guard = await unclaimedCompletedScheduledDraft({
      clerkUserId,
      draftForDayKey: eveningDayKey,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    });
    if (guard.kind === "failed") {
      return { ok: false, reason: "upsert_failed", error: "draft_read_failed" };
    }
    if (guard.kind === "protected") {
      return {
        ok: true,
        draftForDayKey: eveningDayKey,
        generationId: guard.generationId,
        body: guard.body,
        machineShouldSend: guard.machineShouldSend,
        machineNoSendReason: guard.machineNoSendReason,
        writerPromptPath: null,
        messageFor: null,
        supersedeFailed: false,
        currentDraftProtected: true,
      };
    }
  }

  const persistProtect = {
    ...(args.protectTylerProvenanceOnly === true
      ? { protectTylerProvenanceOnly: true as const }
      : {}),
    ...(args.allowReplaceStaleTylerNonempty === true
      ? {
          allowReplaceStaleTylerNonempty: true as const,
          replacedStaleTylerBody: args.replacedStaleTylerBody ?? null,
          replacedStaleTylerEditedAt: args.replacedStaleTylerEditedAt ?? null,
        }
      : {}),
  };
  const scheduledAttach = {
    ...(args.scheduledGenerationMetadata
      ? { scheduledGenerationMetadata: args.scheduledGenerationMetadata }
      : {}),
    ...(args.claimOwnerId ? { claimOwnerId: args.claimOwnerId } : {}),
  };

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
  let timezone = tzResolved.timezone;
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tzResolved.timezone }));

  const commsPrefs = await fetchV2UserSmsCommsPreferences(clerkUserId);
  if (args.scheduleAuthoritativelyResolved !== true) {
    const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, now);
    if (commsSkip.skip) {
      return { ok: false, reason: "comms_prefs" };
    }
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

  const scheduled = scheduledDeliveryForGeneration({
    requireScheduled: args.scheduleAuthoritativelyResolved === true || args.reconsideration != null,
    metadata: args.scheduledGenerationMetadata ?? null,
    fenceDelivery: args.reconsideration?.delivery ?? null,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    fallbackOwner: "evening",
    draftForDayKey,
  });
  if (scheduled === "unresolved") {
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: retrievalFailureEvidence(args.reconsideration),
      });
    }
    return { ok: false, reason: "upsert_failed", error: "scheduled_delivery_unresolved" };
  }
  if (scheduled) timezone = scheduled.timeZone;

  const packetResult = await loadMorningRelationshipPacket({
    clerkUserId,
    timezone,
    now,
    draftForDayKey,
    daypart: "evening",
    intendedReceiveTimeLocal: scheduled
      ? formatMinuteOfDayAsHhMm(scheduled.effectiveLocalMinute)
      : undefined,
    utcInstant: scheduled?.utcInstant,
    administrativeBatchDate: scheduled?.batchDate,
    boundConversationAtNow: scheduled != null,
  });

  const eveningMetaBase = {
    preview_only: true,
    preview_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    coaching_stack: "shared_sol_v1",
  };

  if (!packetResult.ok) {
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: retrievalFailureEvidence(args.reconsideration),
      });
      return { ok: false, reason: "upsert_failed", error: packetResult.error };
    }
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "manual_regenerate",
      commitmentId: null,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      failure: { error: packetResult.error },
      generationMetadataExtra: eveningMetaBase,
      respectProtectedMorningDraft: true,
      ...persistProtect, ...scheduledAttach,
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

  const { packet: loadedPacket, commitmentId, conversationReadAt, excludedSourceIds } = packetResult;
  const packet = await attachSundayCoachingContext({
    packet: withObservedSilence(
      packetWithoutProactiveCompliance(loadedPacket),
      now,
      timezone
    ),
    clerkUserId,
    commitmentId,
    now,
  });
  const modelPacket: MorningRelationshipPacket = args.reconsideration
    ? { ...packet, existing_saved_text: savedTextForFence(args.reconsideration) }
    : packet;
  const inputEvidence = buildTtoInputEvidence({
    packet: modelPacket,
    attemptId: args.reconsideration?.claimOwnerId ?? args.claimOwnerId ?? "initial",
    existingBody: args.reconsideration?.currentBody,
    existingBodySource: args.reconsideration?.expectedBodySource,
    editedByTyler: args.reconsideration?.expectedEditedByTyler,
    editedAt: args.reconsideration?.expectedEditedAt,
    delivery: scheduled ? evidenceDeliveryFromSchedule(scheduled) : args.reconsideration?.delivery,
    conversationReadAt,
    excludedSourceIds,
  });
  if (
    args.reconsideration &&
    await releaseUnobservedDiscovery({
      clerkUserId,
      draftForDayKey,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      fence: args.reconsideration,
      consideredSourceIds: inputEvidence.considered_source_ids ?? [],
      excludedSourceIds: excludedSourceIds ?? [],
    })
  ) {
    return { ok: false, reason: "upsert_failed", error: "conversation_retrieval_incomplete" };
  }
  const evidenceMeta = {
    input_evidence: inputEvidence,
    ...(args.reconsideration?.expectedEditedByTyler
      ? {
          replaced_stale_tyler_body: args.reconsideration.currentBody,
          replaced_stale_tyler_edited_at: args.reconsideration.expectedEditedAt,
          replacement_reason: "reconsideration_replace",
        }
      : {}),
  };
  const replaceFinish = args.reconsideration
    ? {
        reconsiderationFinish: {
          ...args.reconsideration,
          evidence: { ...inputEvidence, succeeded: true },
        },
      }
    : {};
  const packetMetadata = {
    thread_message_count: modelPacket.exact_thread.messages.length,
    days_since_last_user_response: packet.last_user_response.days_since,
    never_replied: packet.last_user_response.never_replied,
    has_pending_goal_change: packet.hard_state.pending_goal_change != null,
  };

  const quietFacts = await resolveQuietRelationshipMechanicalFacts({
    clerkUserId,
    timezone,
    localDate: draftForDayKey,
    daysSinceLastUserResponse:
      modelPacket.last_user_response.days_since_at_generation ??
      modelPacket.last_user_response.days_since,
    observedAsOfLocalDate: getDateKeyInTimezone(now, timezone),
    neverReplied: modelPacket.last_user_response.never_replied,
    recentUnansweredOutboundCount: countRecentUnansweredOutboundFromExactThread(
      modelPacket.exact_thread.messages
    ),
  });

  const briefMetadataExtra = await runObservationalMorningBriefInterpreter({
    packet: modelPacket,
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

  if (args.reconsideration) {
    const decision =
      morningCoachingBrief.coaching_direction.existing_text_decision ?? "not_applicable";
    if (
      reconsiderationAppliesKeep({
        decision,
        preserveTylerEdit: args.reconsideration.preserveTylerEdit,
      })
    ) {
      const kept = await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        fence: args.reconsideration,
        result: "keep",
        evidence: reconsiderationRetentionEvidence({
          evidence: inputEvidence,
          decision,
          deliveryMismatchUnresolved: args.reconsideration.deliveryMismatchUnresolved === true,
        }),
      });
      if (!kept.ok) return { ok: false, reason: "upsert_failed", error: kept.error };
      return {
        ok: true,
        draftForDayKey,
        generationId: args.reconsideration.expectedGenerationId,
        body: args.reconsideration.currentBody,
        machineShouldSend: Boolean(args.reconsideration.currentBody?.trim()),
        machineNoSendReason: null,
        writerPromptPath: null,
        messageFor: modelPacket.message_for,
        supersedeFailed: false,
        currentDraftProtected: true,
      };
    }
    if (decision !== "replace") {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: inputEvidence,
      });
      return { ok: false, reason: "upsert_failed", error: "reconsideration_invalid" };
    }
  }

  if (isIntentionalSpaceDecision(morningCoachingBrief.coaching_direction.proactive_decision)) {
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "manual_regenerate",
      commitmentId,
      timezone,
      sendPrefSnapshot,
      now,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      failure: { error: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE },
      packetMetadata,
      ...persistEffectiveAskFromPacket(packet),
      generationMetadataExtra: {
        ...evidenceMeta,
        ...eveningMetaBase,
        ...briefMetadataExtra,
        morning_coaching_brief_v1: morningCoachingBrief,
        ...quietMeta,
        intentional_space: true,
        error: null,
        message_for: modelPacket.message_for,
        morning_relationship_packet_v1: modelPacket,
      },
      notebookVerdictReason: MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
      respectProtectedMorningDraft: true,
      ...replaceFinish,
      ...persistProtect, ...scheduledAttach,
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

  const optionalPatSourceEvidence = await maybeLoadOptionalMorningPatEvidence({
    brief: morningCoachingBrief,
    packet,
    quietFacts,
  });
  const writerResult = await writeMorningTtoBody({
    packet,
    morningCoachingBrief,
    ...(optionalPatSourceEvidence ? { optionalPatSourceEvidence } : {}),
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
    ...evidenceMeta,
    ...eveningMetaBase,
    ...briefMetadataExtra,
    morning_coaching_brief_v1: morningCoachingBrief,
    ...quietMeta,
    intentional_space: false,
    message_for: modelPacket.message_for,
    morning_relationship_packet_v1: modelPacket,
  };

  if (!writerResult.ok) {
    if (args.reconsideration) {
      await finishReconsiderationDecision({
        clerkUserId,
        draftForDayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        fence: args.reconsideration,
        result: "release",
        evidence: inputEvidence,
      });
      return { ok: false, reason: "upsert_failed", error: writerResult.error };
    }
    const persisted = await persistMorningTtoGeneration({
      clerkUserId,
      draftForDayKey,
      generationReason: args.generationReason ?? "manual_regenerate",
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
      ...persistEffectiveAskFromPacket(packet),
      generationMetadataExtra,
      respectProtectedMorningDraft: true,
      ...persistProtect, ...scheduledAttach,
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

  const smsBody = hygienedMorningEveningSmsBody({
    body: writerResult.body,
    packet,
  });
  const persisted = await persistMorningTtoGeneration({
    clerkUserId,
    draftForDayKey,
    generationReason: args.generationReason ?? "manual_regenerate",
    commitmentId,
    timezone,
    sendPrefSnapshot,
    now,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    success: {
      body: smsBody,
      messages: mapOpenAiMessagesToWriterCapture(writerResult.messages),
      writerPromptPath: writerResult.writer_prompt_path,
      model: writerResult.model,
      retryMessages,
      retryOccurred,
      retrySucceeded: retryOccurred ? true : undefined,
      writerCapture,
    },
    packetMetadata,
    ...persistEffectiveAskFromPacket(packet),
    generationMetadataExtra,
    respectProtectedMorningDraft: true,
    ...replaceFinish,
    ...persistProtect, ...scheduledAttach,
  });

  if (!persisted.ok) {
    return { ok: false, reason: persisted.reason, error: persisted.error };
  }

  return {
    ok: true,
    draftForDayKey,
    generationId: persisted.generationId,
    body: smsBody,
    machineShouldSend: true,
    machineNoSendReason: null,
    writerPromptPath: writerResult.writer_prompt_path,
    messageFor: packet.message_for,
    supersedeFailed: persisted.supersedeFailed,
    currentDraftProtected: persisted.currentDraftProtected,
  };
}
