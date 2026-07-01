/**
 * Tyler Text Overview — schema literals and env gate (Phase 1 types only).
 * Not wired into daily/weekly/inbound runtime yet.
 */

export const TYLER_TEXT_OVERVIEW_ENABLED_ENV = "TYLER_TEXT_OVERVIEW_ENABLED" as const;

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
