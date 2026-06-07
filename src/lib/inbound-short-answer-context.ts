/**
 * Short Answer Context Authority (SACA) — server-owned truth for contextual short replies.
 * A short token is not proof unless tied to a valid, fresh outcome-check antecedent.
 */

import type { ExpectedReplySemanticsV3 } from "@/lib/north-star-sms-context-packet";
import {
  coachQuestionExpectsYesNoAnswer,
  inferExpectedReplySemanticsFromCoachQuestion,
} from "@/lib/north-star-sms-context-packet";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
} from "@/lib/inbound-short-answer-clauses";
import type { InboundPersistenceDecision } from "@/lib/inbound-relationship-meaning";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { buildV2ActiveReplyContext } from "@/lib/v2-active-reply-context";
import {
  detectNormalizedPartialLanguage,
  detectNormalizedShortAnswerPolarity,
  mapTuAnsweredLastCoachAskToPolarityHint,
  normalizeShortAnswerText,
  shortAnswerDisqualifiesOutcomeProof,
} from "@/lib/inbound-short-answer-polarity";

export type ShortAnswerPolarity = "affirm" | "deny" | "unclear" | "not_applicable";

export type PriorQuestionType =
  | "outcome_check"
  | "plan_confirmation"
  | "adjustment_prompt"
  | "open_reflection"
  | "identity_reflection"
  | "future_plan_question"
  | "support_or_contract"
  | "no_recent_question"
  | "unknown";

export type ShortAnswerResponseIntentHint =
  | "acknowledge_plan_confirmation"
  | "clarify_adjustment"
  | "acknowledge_outcome"
  | "tell_truth_and_recover"
  | "unclear_clarify"
  | null;

export type ShortAnswerOutboundClaims = {
  completion: boolean;
  miss: boolean;
  partial: boolean;
};

export type ShortAnswerContextAuthority = {
  is_short_contextual_answer: boolean;
  short_answer_polarity: ShortAnswerPolarity;
  prior_question_type: PriorQuestionType;
  outcome_proof_eligible: boolean;
  allowed_persistence: InboundPersistenceDecision;
  allowed_outbound_claims: ShortAnswerOutboundClaims;
  response_intent_hint: ShortAnswerResponseIntentHint;
  reason: string;
};

export type ResolveShortAnswerContextAuthorityArgs = {
  rawInbound: string;
  latestOutboundBody?: string | null;
  latestOpenQuestion?: string | null;
  expectedAnswerType?: string | null;
  expectedReplySemantics?: ExpectedReplySemanticsV3 | string | null;
  openQuestionPending?: boolean;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  commitmentTitle?: string | null;
  recentEventsNewestFirst?: V2EventRowForAi[];
  hasLiveAccountabilityPrompt?: boolean;
  promptFreshEnough?: boolean;
  /** OpenAI TU fallback: answered_last_coach_ask when deterministic polarity is unclear. */
  tuAnsweredLastCoachAsk?: "yes" | "no" | "unclear" | null;
};

const PLAN_CONFIRMATION_QUESTION_RE =
  /\b(let me know if that works|would you like to adjust|does (this|that|it) work|how does\b.*\bfeel\b|stay(ing)? committed\b|for the next \d+ days\b|next week\b|ready to continue\b|are you (ok|okay) with)\b/i;

const OUTCOME_CHECK_QUESTION_RE =
  /\b(did you\b.*\b(today|this morning|tonight)\b|did you\b.*\b(get|do|complete|finish|protect|hit|follow through|follow-through)\b|did you\b.*\bbefore your\b|were you able to\b.*\b(today|get|do)\b|did the\b.*\b(happen|get done)\b.*\btoday\b|did you get your\b|what happened with\b.*\b(plan|block|appointment)\b)/i;

const FUTURE_PLAN_QUESTION_RE =
  /\b(what will you|what are you going to|what's the plan for tomorrow|tomorrow's story|what story\b.*\btomorrow)\b/i;

const IDENTITY_REFLECTION_RE = /\b(who are you becoming|identity|who you want to be)\b/i;

function normCore(text: string): string {
  return normalizeShortAnswerText(text).normalized;
}

export function detectShortAnswerPartialLanguage(raw: string): boolean {
  const { normalized } = normalizeShortAnswerText(raw);
  return detectNormalizedPartialLanguage(normalized);
}

function resolveShortAnswerPolarity(
  raw: string,
  tuAnsweredLastCoachAsk?: "yes" | "no" | "unclear" | null
): ShortAnswerPolarity {
  let polarity = detectNormalizedShortAnswerPolarity(raw);
  if (
    (polarity === "unclear" || polarity === "not_applicable") &&
    tuAnsweredLastCoachAsk
  ) {
    const tuPolarity = mapTuAnsweredLastCoachAskToPolarityHint(tuAnsweredLastCoachAsk);
    if (tuPolarity) polarity = tuPolarity;
  }
  return polarity;
}

export function detectShortAnswerPolarity(raw: string): ShortAnswerPolarity {
  return resolveShortAnswerPolarity(raw);
}

export function isShortContextualAnswer(raw: string): boolean {
  return detectShortAnswerPolarity(raw) !== "not_applicable";
}

export function isBoundedPlanConfirmationAnswer(raw: string): boolean {
  const core = normCore(raw);
  if (!core || core.length > 32) return false;
  if (/^(yes|y|yeah|yep|yup|no|n|nope|nah)$/.test(core)) return true;
  if (/^(sure|ok|okay)$/.test(core)) return true;
  if (/^sounds good$/.test(core)) return true;
  if (/^(that works|that works for me)$/.test(core)) return true;
  return false;
}

function coachQuestionText(args: ResolveShortAnswerContextAuthorityArgs): string {
  return (
    args.latestOpenQuestion?.trim() ||
    args.latestOutboundBody?.trim() ||
    ""
  );
}

export function inferPriorQuestionType(
  args: ResolveShortAnswerContextAuthorityArgs
): PriorQuestionType {
  const expectedType = args.expectedAnswerType?.trim().toLowerCase() ?? "";
  const semantics = (args.expectedReplySemantics ?? "").toString().trim().toLowerCase();
  const q = coachQuestionText(args);

  if (expectedType === "proposal_yes_no" || semantics === "proposal_yes_no") {
    return "plan_confirmation";
  }
  if (semantics === "accountability_check") return "outcome_check";
  if (semantics === "goal_change_clarification") return "adjustment_prompt";
  if (semantics === "future_plan_story_title" || FUTURE_PLAN_QUESTION_RE.test(q)) {
    return "future_plan_question";
  }
  if (IDENTITY_REFLECTION_RE.test(q)) return "identity_reflection";
  if (semantics === "open_reflection") return "open_reflection";

  if (q) {
    if (PLAN_CONFIRMATION_QUESTION_RE.test(q)) return "plan_confirmation";
    if (OUTCOME_CHECK_QUESTION_RE.test(q)) return "outcome_check";
    if (coachQuestionExpectsYesNoAnswer(q) && /\btoday\b/i.test(q)) return "outcome_check";
    if (coachQuestionExpectsYesNoAnswer(q) && PLAN_CONFIRMATION_QUESTION_RE.test(q)) {
      return "plan_confirmation";
    }
    if (coachQuestionExpectsYesNoAnswer(q)) return "open_reflection";
    const inferred = inferExpectedReplySemanticsFromCoachQuestion(q);
    if (inferred === "accountability_check") return "outcome_check";
    if (inferred === "proposal_yes_no") return "plan_confirmation";
    if (inferred === "goal_change_clarification") return "adjustment_prompt";
    if (inferred === "open_reflection") return "open_reflection";
  }

  if (args.openQuestionPending) return "unknown";
  return "no_recent_question";
}

function resolvePromptFreshness(args: ResolveShortAnswerContextAuthorityArgs): {
  hasLive: boolean;
  freshEnough: boolean;
} {
  if (
    typeof args.hasLiveAccountabilityPrompt === "boolean" &&
    typeof args.promptFreshEnough === "boolean"
  ) {
    return { hasLive: args.hasLiveAccountabilityPrompt, freshEnough: args.promptFreshEnough };
  }
  if (!args.recentEventsNewestFirst?.length) {
    return { hasLive: false, freshEnough: false };
  }
  const ctx = buildV2ActiveReplyContext({
    inboundText: args.rawInbound,
    eventsNewestFirst: args.recentEventsNewestFirst,
    commitmentTitle: args.commitmentTitle ?? null,
    behaviorStatement: args.behaviorStatement ?? "",
    effectiveAsk: args.effectiveAsk ?? "",
  });
  const freshEnough =
    ctx.has_live_accountability_prompt &&
    (ctx.accountability_prompt_age_minutes ?? 99999) <= 36 * 60;
  return { hasLive: ctx.has_live_accountability_prompt, freshEnough };
}

export function resolveShortAnswerContextAuthority(
  args: ResolveShortAnswerContextAuthorityArgs
): ShortAnswerContextAuthority {
  const raw = args.rawInbound.trim();
  const normalizedMeta = normalizeShortAnswerText(raw);
  const polarity = resolveShortAnswerPolarity(raw, args.tuAnsweredLastCoachAsk);
  const priorType = inferPriorQuestionType(args);
  const explicitCompletion = inboundHasExplicitCompletionClause(raw);
  const explicitMiss = inboundHasExplicitMissClause(raw);
  const explicitPartial = inboundHasExplicitPartialClause(raw);
  const hasExplicitOutcome = explicitCompletion || explicitMiss || explicitPartial;

  if (polarity === "not_applicable" && !hasExplicitOutcome) {
    return {
      is_short_contextual_answer: false,
      short_answer_polarity: "not_applicable",
      prior_question_type: priorType,
      outcome_proof_eligible: hasExplicitOutcome,
      allowed_persistence: hasExplicitOutcome
        ? explicitMiss
          ? "write_user_no"
          : explicitPartial
            ? "write_user_partial"
            : "write_user_yes_today"
        : "no_outcome_write",
      allowed_outbound_claims: {
        completion: explicitCompletion,
        miss: explicitMiss,
        partial: explicitPartial,
      },
      response_intent_hint: null,
      reason: "not_short_answer",
    };
  }

  const { hasLive, freshEnough } = resolvePromptFreshness(args);
  const isShort =
    polarity !== "not_applicable" || detectShortAnswerPartialLanguage(raw);

  let outcomeProofEligible = false;
  let allowedPersistence: InboundPersistenceDecision = "no_outcome_write";
  let claims: ShortAnswerOutboundClaims = { completion: false, miss: false, partial: false };
  let intent: ShortAnswerResponseIntentHint = "unclear_clarify";
  let reason = "contextless_ambiguous";

  if (explicitCompletion) {
    outcomeProofEligible = true;
    allowedPersistence = "write_user_yes_today";
    claims.completion = true;
    intent = "acknowledge_outcome";
    reason = "explicit_completion_clause";
  } else if (explicitPartial) {
    outcomeProofEligible = true;
    allowedPersistence = "write_user_partial";
    claims.partial = true;
    intent = "tell_truth_and_recover";
    reason = "explicit_partial_clause";
  } else if (explicitMiss) {
    outcomeProofEligible = true;
    allowedPersistence = "write_user_no";
    claims.miss = true;
    intent = "tell_truth_and_recover";
    reason = "explicit_miss_clause";
  } else if (priorType === "outcome_check" && hasLive && freshEnough && isShort) {
    const disqualifier = shortAnswerDisqualifiesOutcomeProof(raw, normalizedMeta.normalized);
    if (disqualifier.disqualified) {
      reason = `short_answer_disqualified:${disqualifier.reason ?? "unknown"}`;
      intent = "unclear_clarify";
    } else if (polarity === "affirm") {
      outcomeProofEligible = true;
      allowedPersistence = "write_user_yes_today";
      claims.completion = true;
      intent = "acknowledge_outcome";
      reason = "short_affirm_to_fresh_outcome_check";
    } else if (polarity === "deny") {
      outcomeProofEligible = true;
      allowedPersistence = "write_user_no";
      claims.miss = true;
      intent = "tell_truth_and_recover";
      reason = "short_deny_to_fresh_outcome_check";
    } else if (detectShortAnswerPartialLanguage(raw)) {
      outcomeProofEligible = true;
      allowedPersistence = "write_user_partial";
      claims.partial = true;
      intent = "tell_truth_and_recover";
      reason = "short_partial_to_fresh_outcome_check";
    } else {
      reason = "short_unclear_to_outcome_check";
      intent = "unclear_clarify";
    }
  } else if (
    priorType === "outcome_check" &&
    hasLive &&
    freshEnough &&
    detectShortAnswerPartialLanguage(raw)
  ) {
    const disqualifier = shortAnswerDisqualifiesOutcomeProof(raw, normalizedMeta.normalized);
    if (!disqualifier.disqualified) {
      outcomeProofEligible = true;
      allowedPersistence = "write_user_partial";
      claims.partial = true;
      intent = "tell_truth_and_recover";
      reason = "short_partial_to_fresh_outcome_check";
    } else {
      reason = `short_answer_disqualified:${disqualifier.reason ?? "unknown"}`;
      intent = "unclear_clarify";
    }
  } else if (priorType === "plan_confirmation" && isShort) {
    if (polarity === "affirm") {
      intent = "acknowledge_plan_confirmation";
      reason = "short_affirm_plan_confirmation";
    } else if (polarity === "deny") {
      intent = "clarify_adjustment";
      reason = "short_deny_plan_adjustment";
    } else {
      intent = "unclear_clarify";
      reason = "short_unclear_plan_confirmation";
    }
  } else if (
    (priorType === "adjustment_prompt" || priorType === "open_reflection") &&
    isShort
  ) {
    intent = polarity === "deny" ? "clarify_adjustment" : "acknowledge_plan_confirmation";
    reason = `short_answer_${priorType}`;
  } else if (isShort) {
    intent = "unclear_clarify";
    reason =
      priorType === "no_recent_question"
        ? "contextless_short_answer"
        : `short_answer_no_outcome_antecedent_${priorType}`;
  }

  return {
    is_short_contextual_answer: isShort,
    short_answer_polarity: polarity,
    prior_question_type: priorType,
    outcome_proof_eligible: outcomeProofEligible,
    allowed_persistence: allowedPersistence,
    allowed_outbound_claims: claims,
    response_intent_hint: intent,
    reason,
  };
}

/** North Star / writer: today completed only with authorized proof. */
export function authorizesTodayCompletedDisplay(args: {
  priorYesToday: boolean;
  rawInbound: string;
  shortAnswerContext: ShortAnswerContextAuthority | null;
  willPersistUserYes?: boolean;
  inboundReportsCompletion?: boolean;
}): boolean {
  if (args.priorYesToday) return true;
  if (args.willPersistUserYes) return true;
  if (args.inboundReportsCompletion) return true;
  if (args.shortAnswerContext?.outcome_proof_eligible && args.shortAnswerContext.allowed_outbound_claims.completion) {
    return true;
  }
  return false;
}

export function authorizesProofSignalDisplay(args: {
  proofDisplayedOrMoment?: boolean;
  willPersistUserYes?: boolean;
  shortAnswerContext: ShortAnswerContextAuthority | null;
  inboundReportsCompletion?: boolean;
}): boolean {
  if (args.proofDisplayedOrMoment) return true;
  if (args.willPersistUserYes) return true;
  if (args.inboundReportsCompletion) return true;
  if (args.shortAnswerContext?.outcome_proof_eligible && args.shortAnswerContext.allowed_outbound_claims.completion) {
    return true;
  }
  return false;
}

export function slimShortAnswerContextForTelemetry(
  saca: ShortAnswerContextAuthority | null | undefined
): Record<string, unknown> | null {
  if (!saca) return null;
  return {
    is_short_contextual_answer: saca.is_short_contextual_answer,
    short_answer_polarity: saca.short_answer_polarity,
    prior_question_type: saca.prior_question_type,
    outcome_proof_eligible: saca.outcome_proof_eligible,
    allowed_persistence: saca.allowed_persistence,
    allowed_outbound_claims: saca.allowed_outbound_claims,
    response_intent_hint: saca.response_intent_hint,
    reason: saca.reason,
  };
}
