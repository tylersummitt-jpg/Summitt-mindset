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

export const TYLER_TEXT_OVERVIEW_DRAFT_STATUSES = [
  "current",
  "sent",
  "skipped",
  "superseded",
] as const;

export type TylerTextOverviewDraftStatus = (typeof TYLER_TEXT_OVERVIEW_DRAFT_STATUSES)[number];

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
};

/** Minimal admin UI row — no phone, verdict, or debug metadata. */
export type TylerTextOverviewAdminDraftRow = {
  draftId: string;
  clerkUserId: string;
  draftForDayKey: string;
  currentBodyToSend: string | null;
  writerOpenAiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
};
