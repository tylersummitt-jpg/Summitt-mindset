export const MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION = 1 as const;
export const MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2 = 2 as const;

/** Optional shadow-only labels (secondary_intents / answer_type). Not used for live routing. */
export const MEANING_INTERPRETER_SECONDARY_INTENT_LABELS = [
  "answered_prior_open_question",
  "time_answer_to_prior_question",
  "short_numeric_time_answer",
  "direct_answer_to_coach_question",
  "contract_yes_answer",
  "contract_no_answer",
  "acknowledgement",
  "cancellation_request",
  "support_request",
  "completion",
  "miss",
  "partial",
  "blocker",
  "goal_adjustment_request",
  "unclear",
] as const;

export type MeaningInterpreterSecondaryIntentLabel =
  (typeof MEANING_INTERPRETER_SECONDARY_INTENT_LABELS)[number];

export const MEANING_INTERPRETER_ANSWER_TYPES = [
  "time_or_schedule",
  "contract_yes_no",
  "support",
  "cancellation",
  "accountability_yes_no_partial",
  "direct_coach_answer",
  "acknowledgement",
  "unclear",
] as const;

export type MeaningInterpreterAnswerType = (typeof MEANING_INTERPRETER_ANSWER_TYPES)[number];

export const MEANING_INTERPRETER_PRIMARY_INTENTS = [
  "accountability_answer",
  "open_question_answer",
  "commitment_change",
  "pause_or_cadence",
  "blocker",
  "proof_or_completion",
  "meta_or_confusion",
  "repair",
  "soft_opt_out",
  "relationship_exit",
  "compliance",
  "unclear",
] as const;

export type MeaningInterpreterPrimaryIntent = (typeof MEANING_INTERPRETER_PRIMARY_INTENTS)[number];

export const MEANING_INTERPRETER_EMOTIONAL_TONES = [
  "neutral",
  "discouraged",
  "ashamed",
  "resistant",
  "proud",
  "confused",
  "urgent",
] as const;

export type MeaningInterpreterEmotionalTone = (typeof MEANING_INTERPRETER_EMOTIONAL_TONES)[number];

export const MEANING_INTERPRETER_ANSWERED_OPEN_QUESTION = [
  "yes",
  "no",
  "unclear",
  "not_applicable",
] as const;

export type MeaningInterpreterAnsweredOpenQuestion =
  (typeof MEANING_INTERPRETER_ANSWERED_OPEN_QUESTION)[number];

export const MEANING_INTERPRETER_SAFETY_HINTS = [
  "none",
  "possible_crisis",
  "possible_self_harm",
] as const;

export type MeaningInterpreterSafetyHint = (typeof MEANING_INTERPRETER_SAFETY_HINTS)[number];

export const MEANING_INTERPRETER_FOLLOWUP_KINDS = [
  "clarify",
  "acknowledge",
  "ask_blocker",
  "handoff_goal_change",
  "none",
] as const;

export type MeaningInterpreterFollowupKind = (typeof MEANING_INTERPRETER_FOLLOWUP_KINDS)[number];

export type MeaningInterpreterSignals = {
  goal_change: boolean;
  pause_or_cadence: boolean;
  completion_or_proof: boolean;
  blocker: boolean;
  resistance_or_shame: boolean;
  substitution_counts: boolean;
};

export type MeaningInterpreterShadowParsed = {
  version: typeof MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION | typeof MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2;
  primary_intent: MeaningInterpreterPrimaryIntent;
  secondary_intents: string[];
  emotional_tone: MeaningInterpreterEmotionalTone;
  answered_open_question: MeaningInterpreterAnsweredOpenQuestion;
  /** v2 optional — did user answer the coach's pending question? */
  answered_prior_open_question?: "yes" | "no" | "unclear" | null;
  /** v2 optional — coarse answer shape for SQL audits */
  answer_type?: MeaningInterpreterAnswerType | null;
  open_question_answer_summary: string | null;
  signals: MeaningInterpreterSignals;
  safety_hint: MeaningInterpreterSafetyHint;
  confidence: number;
  disagrees_with_deterministic_route: boolean;
  disagreement_reason: string | null;
  explanation_short: string;
  recommended_followup_kind: MeaningInterpreterFollowupKind;
};

const PRIMARY_SET = new Set<string>(MEANING_INTERPRETER_PRIMARY_INTENTS);
const TONE_SET = new Set<string>(MEANING_INTERPRETER_EMOTIONAL_TONES);
const ANSWERED_SET = new Set<string>(MEANING_INTERPRETER_ANSWERED_OPEN_QUESTION);
const SAFETY_SET = new Set<string>(MEANING_INTERPRETER_SAFETY_HINTS);
const FOLLOWUP_SET = new Set<string>(MEANING_INTERPRETER_FOLLOWUP_KINDS);

function truncateStore(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function parseStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !item.trim()) continue;
    out.push(truncateStore(item, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseSignals(raw: unknown): MeaningInterpreterSignals | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    goal_change: o.goal_change === true,
    pause_or_cadence: o.pause_or_cadence === true,
    completion_or_proof: o.completion_or_proof === true,
    blocker: o.blocker === true,
    resistance_or_shame: o.resistance_or_shame === true,
    substitution_counts: o.substitution_counts === true,
  };
}

function parseAnsweredPriorOpenQuestion(
  raw: unknown
): "yes" | "no" | "unclear" | null {
  if (raw === "yes" || raw === "no" || raw === "unclear") return raw;
  return null;
}

function parseAnswerType(raw: unknown): MeaningInterpreterAnswerType | null {
  if (typeof raw !== "string") return null;
  return (MEANING_INTERPRETER_ANSWER_TYPES as readonly string[]).includes(raw)
    ? (raw as MeaningInterpreterAnswerType)
    : null;
}

export function parseAndValidateMeaningInterpreterShadow(
  raw: Record<string, unknown>
): MeaningInterpreterShadowParsed | null {
  if (
    raw.version !== MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION &&
    raw.version !== MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2
  ) {
    return null;
  }

  const primary =
    typeof raw.primary_intent === "string" && PRIMARY_SET.has(raw.primary_intent)
      ? (raw.primary_intent as MeaningInterpreterPrimaryIntent)
      : null;
  if (!primary) return null;

  const emotional_tone =
    typeof raw.emotional_tone === "string" && TONE_SET.has(raw.emotional_tone)
      ? (raw.emotional_tone as MeaningInterpreterEmotionalTone)
      : null;
  if (!emotional_tone) return null;

  const answered_open_question =
    typeof raw.answered_open_question === "string" && ANSWERED_SET.has(raw.answered_open_question)
      ? (raw.answered_open_question as MeaningInterpreterAnsweredOpenQuestion)
      : null;
  if (!answered_open_question) return null;

  const safety_hint =
    typeof raw.safety_hint === "string" && SAFETY_SET.has(raw.safety_hint)
      ? (raw.safety_hint as MeaningInterpreterSafetyHint)
      : null;
  if (!safety_hint) return null;

  const recommended_followup_kind =
    typeof raw.recommended_followup_kind === "string" && FOLLOWUP_SET.has(raw.recommended_followup_kind)
      ? (raw.recommended_followup_kind as MeaningInterpreterFollowupKind)
      : null;
  if (!recommended_followup_kind) return null;

  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) return null;
  const confidence = Math.min(1, Math.max(0, raw.confidence));

  const signals = parseSignals(raw.signals);
  if (!signals) return null;

  const explanation_short =
    typeof raw.explanation_short === "string" ? truncateStore(raw.explanation_short, 280) : "";
  if (!explanation_short) return null;

  let open_question_answer_summary: string | null = null;
  if (typeof raw.open_question_answer_summary === "string" && raw.open_question_answer_summary.trim()) {
    open_question_answer_summary = truncateStore(raw.open_question_answer_summary, 200);
  }

  let disagreement_reason: string | null = null;
  if (typeof raw.disagreement_reason === "string" && raw.disagreement_reason.trim()) {
    disagreement_reason = truncateStore(raw.disagreement_reason, 200);
  }

  return {
    version:
      raw.version === MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2
        ? MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2
        : MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION,
    primary_intent: primary,
    secondary_intents: parseStringArray(raw.secondary_intents, 8, 80),
    emotional_tone,
    answered_open_question,
    answered_prior_open_question: parseAnsweredPriorOpenQuestion(raw.answered_prior_open_question),
    answer_type: parseAnswerType(raw.answer_type),
    open_question_answer_summary,
    signals,
    safety_hint,
    confidence,
    disagrees_with_deterministic_route: raw.disagrees_with_deterministic_route === true,
    disagreement_reason,
    explanation_short,
    recommended_followup_kind,
  };
}
