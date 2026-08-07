/**
 * Tyler Text Overview — schema literals and env gate (Phase 1 types only).
 * Not wired into daily/weekly/inbound runtime yet.
 */

export const TYLER_TEXT_OVERVIEW_ENABLED_ENV = "TYLER_TEXT_OVERVIEW_ENABLED" as const;

/** Single env gate for Tyler Text Overview runtime (noon generation, later send/admin phases). */
export function isTylerTextOverviewEnabled(): boolean {
  return process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] === "true";
}

export const SMS_DAILY_DRAFT_GENERATIONS_TABLE = "sms_daily_draft_generations" as const;
export const SMS_DAILY_DRAFTS_TABLE = "sms_daily_drafts" as const;

/**
 * Outbound SMS moment/purpose slots — NOT wall-clock send times.
 * Future per-slot local schedules (e.g. morning 5–10 AM, evening_checkin 5–10 PM) will be
 * user-configurable; send_slot identifies which product moment the message serves.
 */
export const SMS_DAILY_SEND_SLOTS = ["morning", "evening_checkin", "weekly_review"] as const;
export type SmsDailySendSlot = (typeof SMS_DAILY_SEND_SLOTS)[number];

/**
 * Phase 1 production slot: the current daily planning/accountability SMS.
 * May send at different wall-clock hours via legacy Clerk smsTimePreference (e.g. evening = 19:00).
 * evening_checkin is reserved for a future second check-in SMS — not implemented in Phase 1.
 */
export const SMS_DAILY_PRODUCTION_SEND_SLOT: SmsDailySendSlot = "morning";

/** Preview-only slot — persisted in TTO tables; never sent in Phase 2B. */
export const SMS_DAILY_EVENING_PREVIEW_SEND_SLOT: SmsDailySendSlot = "evening_checkin";

/**
 * Weekly TTO draft slot — draft/review/edit only until weekly send cutover.
 * Does not use sms_send_events; future send truth is sms_weekly_send_events.
 */
export const SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT: SmsDailySendSlot = "weekly_review";

export const SMS_DAILY_PREVIEW_ONLY_SEND_SLOTS = [
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
] as const satisfies ReadonlyArray<SmsDailySendSlot>;

export type SmsDailyPreviewOnlySendSlot =
  (typeof SMS_DAILY_PREVIEW_ONLY_SEND_SLOTS)[number];

export function isSmsDailySendSlot(
  slot: string | null | undefined
): slot is SmsDailySendSlot {
  return (SMS_DAILY_SEND_SLOTS as readonly string[]).includes(slot ?? "");
}

/**
 * Parse a known TTO send_slot. Unknown values return null — never silently coerce to morning.
 */
export function parseSmsDailySendSlot(
  slot: string | null | undefined
): SmsDailySendSlot | null {
  const v = typeof slot === "string" ? slot.trim() : "";
  if (isSmsDailySendSlot(v)) return v;
  return null;
}

export function isPreviewOnlySendSlot(
  slot: SmsDailySendSlot | string | null | undefined
): slot is SmsDailyPreviewOnlySendSlot {
  return (
    slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT ||
    (SMS_DAILY_PREVIEW_ONLY_SEND_SLOTS as readonly string[]).includes(slot ?? "")
  );
}

export function isProductionSendSlot(
  slot: SmsDailySendSlot | string | null | undefined
): slot is typeof SMS_DAILY_PRODUCTION_SEND_SLOT {
  return slot === SMS_DAILY_PRODUCTION_SEND_SLOT;
}

export function isWeeklyReviewSendSlot(
  slot: SmsDailySendSlot | string | null | undefined
): slot is typeof SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT {
  return slot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;
}

export const TYLER_TEXT_OVERVIEW_GENERATION_REASONS = [
  "noon_batch",
  "inbound_after_generation",
  "evening_sweep",
  "pre_send_stale_refresh",
  "live_send_fallback",
  "manual_regenerate",
] as const;

export type TylerTextOverviewGenerationReason =
  (typeof TYLER_TEXT_OVERVIEW_GENERATION_REASONS)[number];

export const TYLER_TEXT_OVERVIEW_CURRENT_BODY_SOURCES = [
  "machine",
  "tyler_edit",
  "live_fallback",
] as const;

export type TylerTextOverviewCurrentBodySource =
  (typeof TYLER_TEXT_OVERVIEW_CURRENT_BODY_SOURCES)[number];

/**
 * Why ORIGINAL MACHINE DRAFT is available or not for the authoritative generation.
 * Never filled from current_body_to_send.
 */
export type AuthoritativeMachineDraftStatus =
  | "available"
  | "generation_failed"
  | "generation_missing"
  | "historical_unavailable";

export const TYLER_TEXT_OVERVIEW_DRAFT_STATUSES = [
  "current",
  "sent",
  "skipped",
  "superseded",
] as const;

export type TylerTextOverviewDraftStatus = (typeof TYLER_TEXT_OVERVIEW_DRAFT_STATUSES)[number];

export const TYLER_TEXT_OVERVIEW_ROW_STATES = [
  "no_draft_yet",
  "draft_current",
  "draft_sent",
  "draft_skipped",
  "draft_other",
] as const;

export type TylerTextOverviewRowState = (typeof TYLER_TEXT_OVERVIEW_ROW_STATES)[number];

export type TylerTextOverviewAdminCounts = {
  sendableUsers: number;
  noDraftYet: number;
  draftCurrent: number;
  /** Current drafts with nonblank current_body_to_send (ready to send if gates pass). */
  draftCurrentReady: number;
  /** Current drafts Tyler blanked (edited_by_tyler + blank body). */
  draftCurrentTylerBlanked: number;
  /** Selected-day drafts with status=sent among the loaded audience manifest rows. */
  draftSent: number;
  draftSkipped: number;
  machineShouldSendTrue: number;
  machineShouldSendFalse: number;
  generationLinkageErrors: number;
  /**
   * All selected-day sms_daily_drafts with status=sent (not limited to current sendable audience).
   * Label in UI as "Drafts marked sent".
   */
  draftsMarkedSentDayTotal: number;
  /**
   * Selected-day sms_send_events with a nonblank Twilio message_sid (API accepted).
   * Null when day not selected or count unavailable. Label as "Twilio-accepted send events".
   */
  twilioAcceptedDayTotal: number | null;
};

/** Sub-checks that together determine manifestComplete. */
export type TylerTextOverviewManifestSubChecks = {
  audienceComplete: boolean;
  commitmentLookupComplete: boolean;
  preferenceLookupComplete: boolean;
  profileLookupComplete: boolean;
  draftQueryComplete: boolean;
  generationQueryComplete: boolean;
  historicalSentCountComplete: boolean;
  twilioCountComplete: boolean;
  audienceOverlayInvariantComplete: boolean;
};

/** Completeness of the Morning/Evening TTO selected-day admin manifest. */
export type TylerTextOverviewManifestIntegrity = {
  expectedAudienceCount: number;
  /** Selected-day draft overlays among the complete sendable audience. */
  audienceDraftOverlayCount: number;
  /** Audience members with no selected-day overlay (genuine missing). */
  genuineMissingAudienceDraftCount: number;
  /** Alias of audienceDraftOverlayCount (legacy field name). */
  selectedDayDraftCount: number;
  /** Alias of genuineMissingAudienceDraftCount (legacy field name). */
  genuineMissingDraftCount: number;
  /** All selected-day current|sent|skipped drafts returned for audience user-id chunks. */
  allSelectedDayDraftCount: number;
  /** Day-total sms_daily_drafts.status=sent (not audience-limited). */
  allSelectedDaySentDraftCount: number;
  generationLinkageErrorCount: number;
  manifestComplete: boolean;
  queriedDraftExactCount: number;
  returnedDraftCount: number;
  /** Alias of allSelectedDaySentDraftCount. */
  draftsMarkedSentDayTotal: number;
  /** Twilio-accepted send event rows (nonblank message_sid). Null = unavailable. */
  twilioAcceptedEventCount: number | null;
  /** Alias of twilioAcceptedEventCount. */
  twilioAcceptedDayTotal: number | null;
  selectedDayKey: string | null;
  lastRefreshedAt: string;
  incompletenessReason: string | null;
} & TylerTextOverviewManifestSubChecks;

export const TYLER_TEXT_OVERVIEW_NOTEBOOK_VERDICTS = [
  "verified",
  "failed",
  "not_applicable",
] as const;

export type TylerTextOverviewNotebookVerdict =
  (typeof TYLER_TEXT_OVERVIEW_NOTEBOOK_VERDICTS)[number];

export const TYLER_TEXT_OVERVIEW_SEND_SOURCES = [
  "machine_draft",
  "tyler_edit",
  "live_fallback_no_draft",
  "live_fallback_stale",
  "live_fallback_error",
  "live_fallback_empty_body",
  "live_fallback_special_branch",
] as const;

export type TylerTextOverviewSendSource = (typeof TYLER_TEXT_OVERVIEW_SEND_SOURCES)[number];

export const TTO_CURRENT_DRAFT_FINAL_STALE_REASON = "tto_current_draft_final" as const;

export const TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT =
  "tto_current_draft_special_branch_conflict" as const;

export const TTO_CURRENT_DRAFT_ROUTE_CONFLICT = "tto_current_draft_route_conflict" as const;

export type TtoCurrentDraftRouteConflictReason =
  | typeof TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT
  | typeof TTO_CURRENT_DRAFT_ROUTE_CONFLICT;

export const TTO_POST_TTO_GUARDS_SKIPPED = [
  "north_star_mutation",
  "fvg_rewrite",
  "unified_rewrite",
  "live_build_body",
] as const;

export const TTO_DRAFT_REVALIDATION_REASON_MISSING =
  "current_draft_missing_on_revalidation" as const;

export const TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT =
  "current_draft_no_longer_current" as const;

export const TTO_DRAFT_REVALIDATION_REASON_EMPTY =
  "current_draft_empty_on_revalidation" as const;

export type TtoDraftRevalidationFailureReason =
  | typeof TTO_DRAFT_REVALIDATION_REASON_MISSING
  | typeof TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT
  | typeof TTO_DRAFT_REVALIDATION_REASON_EMPTY;

export const TTO_DRAFT_REVALIDATION_SKIP_STATUSES = [
  "skipped_tto_current_draft_revalidation_failed",
  "skipped_tto_current_draft_no_longer_current",
  "skipped_tto_current_draft_empty_on_revalidation",
] as const;

export type TtoDraftRevalidationSkipStatus =
  (typeof TTO_DRAFT_REVALIDATION_SKIP_STATUSES)[number];

/** Non-empty trimmed TTO current draft body — protected from generate/refresh overwrite. */
export function isProtectedTtoCurrentDraftBody(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return raw.trim().length > 0;
}

/**
 * Morning generation/stale-refresh overwrite protection.
 * Keeps body-only pin semantics separate: non-empty bodies stay protected as before,
 * and Tyler-saved drafts (including intentional blank) are also protected.
 * Machine/generation nulls without Tyler provenance remain refreshable.
 */
export function isProtectedFromMorningDraftOverwrite(draft: {
  current_body_to_send?: string | null;
  edited_by_tyler?: boolean | null;
  current_body_source?: string | null;
}): boolean {
  if (isProtectedTtoCurrentDraftBody(draft.current_body_to_send)) return true;
  return draft.edited_by_tyler === true || draft.current_body_source === "tyler_edit";
}

/** Compact sms_send_events.metadata.tyler_text_overview block (Phase 5). */
export type TylerTextOverviewSendMetadata = {
  enabled: true;
  draft_id: string | null;
  generation_id: string | null;
  draft_for_day_key: string;
  send_source: TylerTextOverviewSendSource;
  edited_by_tyler: boolean;
  machine_body_hash: string | null;
  current_body_hash: string | null;
  final_body_sent_hash: string | null;
  notebook_verdict_at_generation: string | null;
  notebook_verdict_reason_at_generation: string | null;
  stale: boolean;
  stale_reason: string | null;
  tto_current_draft_protected?: boolean;
  post_tto_writers_bypassed?: boolean;
  sent_body_equals_current_body_to_send?: boolean;
  stale_check_ignored_reason?: typeof TTO_CURRENT_DRAFT_FINAL_STALE_REASON;
  live_fallback_used?: boolean;
  post_tto_guards_skipped?: readonly string[];
  current_body_hash_at_send?: string | null;
  tto_current_draft_route_conflict_reason?: TtoCurrentDraftRouteConflictReason;
  tto_current_draft_revalidated_before_twilio?: boolean;
  tto_current_draft_reloaded_before_twilio?: boolean;
  tto_current_draft_body_refreshed_before_twilio?: boolean;
  tto_current_draft_previous_body_hash?: string | null;
  tto_current_draft_revalidation_failed?: boolean;
  tto_current_draft_revalidation_reason?: TtoDraftRevalidationFailureReason;
  previous_loaded_body_hash?: string | null;
  current_body_source_at_send?: TylerTextOverviewCurrentBodySource | null;
};

/** Phase 6A stale refresh sweep stats. */
export type TylerTextOverviewRefreshStaleStats = {
  ok: boolean;
  enabled: boolean;
  generation_reason: TylerTextOverviewGenerationReason;
  current_drafts_scanned: number;
  stale_found: number;
  refreshed: number;
  skipped_not_stale: number;
  skipped_audience: number;
  skipped_not_v2: number;
  skipped_comms_prefs: number;
  build_failed: number;
  insert_failed: number;
  upsert_failed: number;
  supersede_failed: number;
  skipped_protected_current_draft: number;
  capped: boolean;
  errors_preview: string[];
};

import type {
  TylerTextOverviewNotebookDisplayMode,
  TylerTextOverviewNotebookFamily,
} from "@/lib/tyler-text-overview-notebook-display";

export type {
  TylerTextOverviewNotebookDisplayMode,
  TylerTextOverviewNotebookFamily,
} from "@/lib/tyler-text-overview-notebook-display";

/** Admin UI row — sendable audience member with optional draft overlay. */
export type TylerTextOverviewAdminDraftRow = {
  draftId: string | null;
  clerkUserId: string;
  preferredName: string | null;
  phoneNumber: string | null;
  timezone: string | null;
  rowState: TylerTextOverviewRowState;
  draftForDayKey: string;
  /** Outbound moment slot (Phase 1: always morning / primary daily). Not wall-clock time. */
  sendSlot: SmsDailySendSlot;
  draftStatus: TylerTextOverviewDraftStatus;
  sentAt: string | null;
  finalBodySent: string | null;
  twilioMessageSid: string | null;
  sourceSmsSendEventId: string | null;
  currentBodyToSend: string | null;
  /** Persisted body source; Tyler Save sets tyler_edit. */
  currentBodySource: TylerTextOverviewCurrentBodySource | null;
  /** True after Tyler Save in TTO (Morning: absolute send approval for non-empty body). */
  editedByTyler: boolean;
  editedAt: string | null;
  writerOpenAiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  /**
   * Exact technical JSON retry follow-up messages from the authoritative generation
   * (assistant invalid output + reminder user). Empty when no retry.
   */
  authoritativeRetryMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  /** Immutable machine_draft_body from current_generation_id (not current_body_to_send). */
  authoritativeMachineDraftBody: string | null;
  /** Discriminated availability of authoritativeMachineDraftBody — never inferred from current body. */
  authoritativeMachineDraftStatus: AuthoritativeMachineDraftStatus | null;
  authoritativeWriterModel: string | null;
  authoritativeRetryOccurred: boolean | null;
  authoritativeGeneratedAt: string | null;
  currentGenerationId: string | null;
  currentGenerationNumber: number | null;
  latestGenerationId: string | null;
  latestGenerationNumber: number | null;
  isLatestGeneration: boolean | null;
  writerPromptPath: string | null;
  notebookHash: string | null;
  notebookMessageCount: number;
  notebookFamily: TylerTextOverviewNotebookFamily;
  notebookDisplayMode: TylerTextOverviewNotebookDisplayMode;
  machineShouldSend: boolean | null;
  machineNoSendReason: string | null;
  capturePresent: boolean | null;
  silenceCadenceRoute: string | null;
  silenceDay: number | null;
  intentionalSpace: boolean | null;
  laneStage: string | null;
  slotCoachingContext: TylerTextOverviewSlotCoachingContextPanel | null;
  /** Phase 2C — stored generation-time interpreter capture (observation only). */
  morningBriefInterpreterV1: TylerTextOverviewMorningBriefInterpreterPanel | null;
  /** Phase 2C — stored final Morning Coaching Brief. */
  morningCoachingBriefV1: Record<string, unknown> | null;
  /** Phase 2D — stored Sol writer forensic capture (generation-time only). */
  morningWriterCaptureV1: TylerTextOverviewMorningWriterCapturePanel | null;
  /**
   * Persisted generation-time message target (message_for).
   * Never derived from the admin day selector.
   */
  messageFor: {
    timezone: string;
    local_date: string;
    local_weekday: string;
    daypart: "morning" | "evening";
  } | null;
  /** Persisted generation-time relationship packet (Evening Sol stores full packet). */
  morningRelationshipPacketV1: Record<string, unknown> | null;
  /** E3+ shared Sol marker from generation_metadata.coaching_stack. */
  coachingStack: string | null;
  /** True when generation_metadata.preview_only is set (evening preview rows). */
  previewOnly?: boolean;
  morningAnchorSource?: string | null;
  morningAnchorSent?: boolean | null;
  morningAnchorBodyPreview?: string | null;
  /** Weekly TTO period fields from generation_metadata. */
  weekKey?: string | null;
  weekStart?: string | null;
  weekEnd?: string | null;
  /**
   * True when a draft overlay exists but current_generation_id could not be loaded.
   * Never remapped to no_draft_yet.
   */
  generationLinkageError?: boolean;
};

/** Read-only TTO panel — notebook context, not mandatory send rules. */
export type TylerTextOverviewSlotCoachingContextPanel = {
  currentSlot: SmsDailySendSlot | null;
  previousSlot: SmsDailySendSlot | null;
  activeCoachingThread: string | null;
  slotRoleRecommendation: string | null;
  checkinFocus: string | null;
  userRepliesSincePreviousOutbound: string | null;
  shouldSendRecommendation: string | null;
  skipReasonHint: string | null;
};

/** Phase 2C — stored Morning Brief interpreter forensic capture (generation-time only). */
export type TylerTextOverviewMorningBriefInterpreterPanel = {
  model: string | null;
  temperature: number | null;
  reasoningEffort: string | null;
  maxCompletionTokens: number | null;
  latencyMs: number | null;
  error: string | null;
  exactSystemMessage: string | null;
  exactUserMessage: string | null;
  exactInputObject: Record<string, unknown> | null;
  rawResponse: string | null;
  parsedBrief: Record<string, unknown> | null;
};

/** Phase 2D — stored Morning Sol writer forensic capture (generation-time only). */
export type TylerTextOverviewMorningWriterCapturePanel = {
  model: string | null;
  temperature: number | null;
  reasoningEffort: string | null;
  maxCompletionTokens: number | null;
  latencyMs: number | null;
  error: string | null;
  rawResponse: string | null;
  rawRetryResponse: string | null;
  retryOccurred: boolean | null;
  retrySucceeded: boolean | null;
};
