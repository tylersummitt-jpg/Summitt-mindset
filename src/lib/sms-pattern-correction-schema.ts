export const SMS_PATTERN_CORRECTION_SCOPES = ["user", "commitment", "global"] as const;
export type SmsPatternCorrectionScope = (typeof SMS_PATTERN_CORRECTION_SCOPES)[number];

export const SMS_PATTERN_CORRECTION_STATUSES = [
  "suggested",
  "approved",
  "rejected",
  "archived",
] as const;
export type SmsPatternCorrectionStatus = (typeof SMS_PATTERN_CORRECTION_STATUSES)[number];

export const SMS_PATTERN_CORRECTION_USAGE_POLICIES = [
  "blocked",
  "prompt_hint_only",
  "routing_hint_shadow",
  "routing_hint_reviewed",
] as const;
export type SmsPatternCorrectionUsagePolicy = (typeof SMS_PATTERN_CORRECTION_USAGE_POLICIES)[number];

export const SMS_PATTERN_CORRECTION_SOURCES = [
  "shadow_review",
  "user_correction",
  "operator_seed",
  "deterministic_pattern",
  "app_action",
  "offline_replay",
] as const;
export type SmsPatternCorrectionSource = (typeof SMS_PATTERN_CORRECTION_SOURCES)[number];

export const SMS_PATTERN_CORRECTION_TYPES = [
  "user_phrase_meaning",
  "open_question_answer_style",
  "blocker_phrase_pattern",
  "completion_phrase_pattern",
  "non_completion_phrase_pattern",
  "goal_change_phrase_pattern",
  "pause_or_cadence_phrase_pattern",
  "season_change_phrase_pattern",
  "frustration_or_repetition_signal",
  "do_not_repeat_question_pattern",
  "clarification_needed_pattern",
  "tone_preference_observed",
  "app_sms_alignment_pattern",
  "false_positive_route",
  "false_negative_route",
  "global_parser_rule_candidate",
  "user_specific_parser_hint",
  "shadow_disagreement_reviewed",
] as const;
export type SmsPatternCorrectionType = (typeof SMS_PATTERN_CORRECTION_TYPES)[number];

export const SMS_PATTERN_CORRECTION_MAX = {
  phrase_pattern: 240,
  normalized_pattern: 240,
  meaning_label: 80,
  correction_summary: 500,
  review_note: 1000,
  created_by: 120,
  reviewed_by: 120,
  source_message_sid: 64,
} as const;

const SCOPE_SET = new Set<string>(SMS_PATTERN_CORRECTION_SCOPES);
const STATUS_SET = new Set<string>(SMS_PATTERN_CORRECTION_STATUSES);
const USAGE_POLICY_SET = new Set<string>(SMS_PATTERN_CORRECTION_USAGE_POLICIES);
const SOURCE_SET = new Set<string>(SMS_PATTERN_CORRECTION_SOURCES);
const TYPE_SET = new Set<string>(SMS_PATTERN_CORRECTION_TYPES);

export type SmsPatternCorrectionInsertInput = {
  scope: SmsPatternCorrectionScope;
  clerk_user_id?: string | null;
  commitment_id?: string | null;
  correction_type: SmsPatternCorrectionType;
  phrase_pattern?: string | null;
  normalized_pattern?: string | null;
  meaning_label: string;
  correction_summary: string;
  usage_policy?: SmsPatternCorrectionUsagePolicy;
  status?: SmsPatternCorrectionStatus;
  source: SmsPatternCorrectionSource;
  source_shadow_id?: string | null;
  source_event_id?: string | null;
  source_message_sid?: string | null;
  confidence?: number | null;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_by?: string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ValidatedSmsPatternCorrectionInsert = {
  scope: SmsPatternCorrectionScope;
  clerk_user_id: string | null;
  commitment_id: string | null;
  correction_type: SmsPatternCorrectionType;
  phrase_pattern: string | null;
  normalized_pattern: string | null;
  meaning_label: string;
  correction_summary: string;
  usage_policy: SmsPatternCorrectionUsagePolicy;
  status: SmsPatternCorrectionStatus;
  source: SmsPatternCorrectionSource;
  source_shadow_id: string | null;
  source_event_id: string | null;
  source_message_sid: string | null;
  confidence: number | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

function truncateStore(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Normalize phrase text for durable pattern matching (no phone numbers stored). */
export function normalizePatternText(text: string | null | undefined): string | null {
  if (text == null) return null;
  const t = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!t) return null;
  return truncateStore(t, SMS_PATTERN_CORRECTION_MAX.normalized_pattern);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function parseOptionalIsoTimestamp(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") {
    throw new Error(`${field}_invalid`);
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) {
    throw new Error(`${field}_invalid`);
  }
  return new Date(t).toISOString();
}

function parseConfidence(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error("confidence_invalid");
  }
  if (v < 0 || v > 1) {
    throw new Error("confidence_out_of_range");
  }
  return v;
}

function hasNonEmptyPattern(phrase: string | null, normalized: string | null): boolean {
  return Boolean(phrase?.trim()) || Boolean(normalized?.trim());
}

export function validateSmsPatternCorrectionInsert(
  input: SmsPatternCorrectionInsertInput
): ValidatedSmsPatternCorrectionInsert {
  if (!SCOPE_SET.has(input.scope)) {
    throw new Error("scope_invalid");
  }
  const scope = input.scope as SmsPatternCorrectionScope;

  const statusRaw = input.status ?? "suggested";
  if (!STATUS_SET.has(statusRaw)) {
    throw new Error("status_invalid");
  }
  const status = statusRaw as SmsPatternCorrectionStatus;

  const usagePolicyRaw = input.usage_policy ?? "prompt_hint_only";
  if (!USAGE_POLICY_SET.has(usagePolicyRaw)) {
    throw new Error("usage_policy_invalid");
  }
  const usage_policy = usagePolicyRaw as SmsPatternCorrectionUsagePolicy;

  if (!SOURCE_SET.has(input.source)) {
    throw new Error("source_invalid");
  }
  const source = input.source as SmsPatternCorrectionSource;

  if (!TYPE_SET.has(input.correction_type)) {
    throw new Error("correction_type_invalid");
  }
  const correction_type = input.correction_type as SmsPatternCorrectionType;

  const clerk_user_id =
    typeof input.clerk_user_id === "string" && input.clerk_user_id.trim()
      ? input.clerk_user_id.trim()
      : null;
  const commitment_id =
    typeof input.commitment_id === "string" && input.commitment_id.trim()
      ? input.commitment_id.trim()
      : null;

  if (scope === "user") {
    if (!clerk_user_id) throw new Error("scope_user_requires_clerk_user_id");
    if (commitment_id) throw new Error("scope_user_forbids_commitment_id");
  }
  if (scope === "commitment") {
    if (!clerk_user_id) throw new Error("scope_commitment_requires_clerk_user_id");
    if (!commitment_id) throw new Error("scope_commitment_requires_commitment_id");
  }
  if (scope === "global") {
    if (clerk_user_id) throw new Error("scope_global_forbids_clerk_user_id");
    if (commitment_id) throw new Error("scope_global_forbids_commitment_id");
  }

  const phrase_pattern =
    typeof input.phrase_pattern === "string" && input.phrase_pattern.trim()
      ? truncateStore(input.phrase_pattern, SMS_PATTERN_CORRECTION_MAX.phrase_pattern)
      : null;

  const normalized_pattern =
    input.normalized_pattern != null && String(input.normalized_pattern).trim()
      ? normalizePatternText(input.normalized_pattern)
      : phrase_pattern
        ? normalizePatternText(phrase_pattern)
        : null;

  if (!hasNonEmptyPattern(phrase_pattern, normalized_pattern)) {
    throw new Error("pattern_required");
  }

  const meaning_label = truncateStore(input.meaning_label, SMS_PATTERN_CORRECTION_MAX.meaning_label);
  if (!meaning_label) {
    throw new Error("meaning_label_required");
  }

  const correction_summary = truncateStore(
    input.correction_summary,
    SMS_PATTERN_CORRECTION_MAX.correction_summary
  );
  if (!correction_summary) {
    throw new Error("correction_summary_required");
  }

  const confidence = parseConfidence(input.confidence ?? null);

  const review_note =
    typeof input.review_note === "string" && input.review_note.trim()
      ? truncateStore(input.review_note, SMS_PATTERN_CORRECTION_MAX.review_note)
      : null;

  const reviewed_by =
    typeof input.reviewed_by === "string" && input.reviewed_by.trim()
      ? truncateStore(input.reviewed_by, SMS_PATTERN_CORRECTION_MAX.reviewed_by)
      : null;

  const created_by =
    typeof input.created_by === "string" && input.created_by.trim()
      ? truncateStore(input.created_by, SMS_PATTERN_CORRECTION_MAX.created_by)
      : null;

  const reviewed_at = parseOptionalIsoTimestamp(input.reviewed_at, "reviewed_at");
  const expires_at = parseOptionalIsoTimestamp(input.expires_at, "expires_at");

  if (status === "approved" && !reviewed_at && !reviewed_by) {
    // Allow approved without reviewed_at when operator explicitly sets status (reviewed_at optional).
  }

  const source_message_sid =
    typeof input.source_message_sid === "string" && input.source_message_sid.trim()
      ? input.source_message_sid.trim().slice(0, SMS_PATTERN_CORRECTION_MAX.source_message_sid)
      : null;

  const source_shadow_id =
    typeof input.source_shadow_id === "string" && input.source_shadow_id.trim()
      ? input.source_shadow_id.trim()
      : null;

  const source_event_id =
    typeof input.source_event_id === "string" && input.source_event_id.trim()
      ? input.source_event_id.trim()
      : null;

  let metadata: Record<string, unknown> = {};
  if (input.metadata != null) {
    if (!isPlainObject(input.metadata)) {
      throw new Error("metadata_must_be_object");
    }
    metadata = input.metadata;
  }

  return {
    scope,
    clerk_user_id,
    commitment_id,
    correction_type,
    phrase_pattern,
    normalized_pattern,
    meaning_label,
    correction_summary,
    usage_policy,
    status,
    source,
    source_shadow_id,
    source_event_id,
    source_message_sid,
    confidence,
    review_note,
    reviewed_by,
    reviewed_at,
    created_by,
    expires_at,
    metadata,
  };
}
