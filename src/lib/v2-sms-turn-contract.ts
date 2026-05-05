/**
 * Structured JSON shape from the SMS Conversation Brain (OpenAI proposal).
 * Pure types/parser — no DB, routes, or Twilio.
 */

export const SMS_CONVERSATION_BRAIN_SCHEMA_VERSION = 1 as const;

export type SmsConversationBrainTurnKind =
  | "accountability_reply"
  | "meta_question"
  | "repair"
  | "commitment_change_intent"
  | "small_talk"
  | "unclear";

export type SmsConversationBrainOutcomeCandidate =
  | "user_yes"
  | "user_no"
  | "user_partial"
  | "none";

export type SmsConversationBrainProposalV1 = {
  schema_version: typeof SMS_CONVERSATION_BRAIN_SCHEMA_VERSION;
  turn_kind: SmsConversationBrainTurnKind;
  interpreted_user_meaning: string;
  accountability_outcome_candidate: SmsConversationBrainOutcomeCandidate;
  outcome_confidence: number;
  should_write_outcome_event: boolean;
  proposed_event_type: "user_yes" | "user_no" | "user_partial" | null;
  blocker_signal: boolean;
  blocker_text_if_any: string | null;
  needs_clarification: boolean;
  clarification_reason: string | null;
  repeated_clarification_risk: boolean;
  reply_strategy: string;
  final_sms_draft: string;
  safety_notes: string[];
  short_reason_for_logs: string;
};

const TURN_KINDS = new Set<SmsConversationBrainTurnKind>([
  "accountability_reply",
  "meta_question",
  "repair",
  "commitment_change_intent",
  "small_talk",
  "unclear",
]);

const OUTCOME_CANDIDATES = new Set<SmsConversationBrainOutcomeCandidate>([
  "user_yes",
  "user_no",
  "user_partial",
  "none",
]);

const EVENT_TYPES = new Set(["user_yes", "user_no", "user_partial"]);

const MAX_MEANING = 280;
const MAX_STRATEGY = 120;
const MAX_DRAFT = 640;
const MAX_SHORT_REASON = 200;
const MAX_SAFETY_NOTE = 160;
const MAX_SAFETY_NOTES = 8;

export type ParseSmsConversationBrainProposalResult =
  | { ok: true; data: SmsConversationBrainProposalV1 }
  | { ok: false; reason: string };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.min(1, Math.max(0, n));
}

function asNonEmptyString(v: unknown, field: string, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function asNullableString(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v.slice(0, MAX_SAFETY_NOTES)) {
    if (typeof x !== "string") continue;
    const t = x.trim().replace(/\s+/g, " ");
    if (!t) continue;
    out.push(t.length > MAX_SAFETY_NOTE ? `${t.slice(0, MAX_SAFETY_NOTE - 1)}…` : t);
  }
  return out;
}

export function parseSmsConversationBrainProposal(raw: unknown): ParseSmsConversationBrainProposalResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not_object" };
  }
  const o = raw as Record<string, unknown>;

  if (o.schema_version !== 1) {
    return { ok: false, reason: "bad_schema_version" };
  }

  const turn_kind = o.turn_kind;
  if (typeof turn_kind !== "string" || !TURN_KINDS.has(turn_kind as SmsConversationBrainTurnKind)) {
    return { ok: false, reason: "bad_turn_kind" };
  }

  const interpreted = asNonEmptyString(o.interpreted_user_meaning, "interpreted_user_meaning", MAX_MEANING);
  if (interpreted === null) return { ok: false, reason: "missing_interpreted_user_meaning" };

  const accCand = o.accountability_outcome_candidate;
  if (
    typeof accCand !== "string" ||
    !OUTCOME_CANDIDATES.has(accCand as SmsConversationBrainOutcomeCandidate)
  ) {
    return { ok: false, reason: "bad_accountability_outcome_candidate" };
  }

  if (typeof o.outcome_confidence !== "number" || !Number.isFinite(o.outcome_confidence)) {
    return { ok: false, reason: "bad_outcome_confidence" };
  }
  const oc = clamp01(o.outcome_confidence);
  if (!Number.isFinite(oc)) {
    return { ok: false, reason: "outcome_confidence_non_finite" };
  }
  if (o.outcome_confidence < 0 || o.outcome_confidence > 1) {
    return { ok: false, reason: "outcome_confidence_out_of_range" };
  }

  if (typeof o.should_write_outcome_event !== "boolean") {
    return { ok: false, reason: "bad_should_write_outcome_event" };
  }
  if (typeof o.blocker_signal !== "boolean") {
    return { ok: false, reason: "bad_blocker_signal" };
  }
  if (typeof o.needs_clarification !== "boolean") {
    return { ok: false, reason: "bad_needs_clarification" };
  }
  if (typeof o.repeated_clarification_risk !== "boolean") {
    return { ok: false, reason: "bad_repeated_clarification_risk" };
  }

  let proposed_event_type: "user_yes" | "user_no" | "user_partial" | null = null;
  const pet = o.proposed_event_type;
  if (pet !== null && pet !== undefined) {
    if (typeof pet !== "string" || !EVENT_TYPES.has(pet)) {
      return { ok: false, reason: "bad_proposed_event_type" };
    }
    proposed_event_type = pet as "user_yes" | "user_no" | "user_partial";
  }

  const blocker_text_if_any = asNullableString(o.blocker_text_if_any, 280);
  const clarification_reason = o.clarification_reason === null ? null : asNullableString(o.clarification_reason, 220);

  const reply_strategy_raw = asNonEmptyString(o.reply_strategy, "reply_strategy", MAX_STRATEGY);
  if (reply_strategy_raw === null) return { ok: false, reason: "missing_reply_strategy" };

  const final_draft = asNonEmptyString(o.final_sms_draft, "final_sms_draft", MAX_DRAFT);
  if (final_draft === null) return { ok: false, reason: "missing_final_sms_draft" };

  const short_reason = asNonEmptyString(o.short_reason_for_logs, "short_reason_for_logs", MAX_SHORT_REASON);
  if (short_reason === null) return { ok: false, reason: "missing_short_reason_for_logs" };

  const safety_notes = asStringArray(o.safety_notes);

  const data: SmsConversationBrainProposalV1 = {
    schema_version: 1,
    turn_kind: turn_kind as SmsConversationBrainTurnKind,
    interpreted_user_meaning: interpreted,
    accountability_outcome_candidate: accCand as SmsConversationBrainOutcomeCandidate,
    outcome_confidence: oc,
    should_write_outcome_event: o.should_write_outcome_event,
    proposed_event_type,
    blocker_signal: o.blocker_signal,
    blocker_text_if_any,
    needs_clarification: o.needs_clarification,
    clarification_reason,
    repeated_clarification_risk: o.repeated_clarification_risk,
    reply_strategy: reply_strategy_raw,
    final_sms_draft: final_draft,
    safety_notes,
    short_reason_for_logs: short_reason,
  };

  return { ok: true, data };
}
