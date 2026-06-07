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
};

const PLAN_CONFIRMATION_QUESTION_RE =
  /\b(let me know if that works|would you like to adjust|does (this|that|it) work|how does\b.*\bfeel\b|stay(ing)? committed\b|for the next \d+ days\b|next week\b|ready to continue\b|are you (ok|okay) with)\b/i;

const OUTCOME_CHECK_QUESTION_RE =
  /\b(did you\b.*\b(today|this morning|tonight)\b|did you\b.*\b(get|do|complete|finish|protect|hit|follow through|follow-through)\b|did you\b.*\bbefore your\b|were you able to\b.*\b(today|get|do)\b|did the\b.*\b(happen|get done)\b.*\btoday\b|did you get your\b|what happened with\b.*\b(plan|block|appointment)\b)/i;

const FUTURE_PLAN_QUESTION_RE =
  /\b(what will you|what are you going to|what's the plan for tomorrow|tomorrow's story|what story\b.*\btomorrow)\b/i;

const IDENTITY_REFLECTION_RE = /\b(who are you becoming|identity|who you want to be)\b/i;

function normCore(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?…]+$/g, "").trim();
}

const SHORT_AFFIRM_LEAD_RE =
  /^(yes|y|yeah|yep|yup|sure|absolutely|definitely|correct|right|totally|for sure|heck yeah|sure did|i sure did|yes i did|yep i did)\b/i;

const SHORT_AFFIRM_PHRASE_RE =
  /^(sounds good|that works|that works for me|ok|okay|kk)\b/i;

const SHORT_DENY_LEAD_RE = /^(no|n|nope|nah|not today)\b/i;

const SHORT_DENY_PHRASE_RE =
  /^(no i missed|missed it|didn'?t|did not|not yet)\b/i;

export function detectShortAnswerPartialLanguage(raw: string): boolean {
  const t = normCore(raw);
  if (!t || t.length > 48) return false;
  if (/\b(i did half|half|some of it|part of it|got some of it done|started it|almost|not all of it)\b/i.test(t)) {
    return true;
  }
  if (/\b(got part of it done|something got in the way)\b/i.test(t)) return true;
  return false;
}

export function detectShortAnswerPolarity(raw: string): ShortAnswerPolarity {
  const t = normCore(raw);
  if (!t) return "not_applicable";
  if (t.length > 48) return "not_applicable";

  if (detectShortAnswerPartialLanguage(t) && !SHORT_AFFIRM_LEAD_RE.test(t) && !SHORT_DENY_LEAD_RE.test(t)) {
    return "unclear";
  }

  if (SHORT_AFFIRM_LEAD_RE.test(t)) return "affirm";
  if (SHORT_AFFIRM_PHRASE_RE.test(t)) return "affirm";
  if (SHORT_DENY_LEAD_RE.test(t)) return "deny";
  if (SHORT_DENY_PHRASE_RE.test(t)) return "deny";
  if (/^(maybe|kinda|kind of|sort of|somewhat|partially)\b/.test(t)) return "unclear";
  if (/^not yet\b/.test(t)) return "unclear";

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /\b(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|totally|for sure|heck yeah)\b/.test(t)) {
    return "affirm";
  }
  if (words.length <= 4 && /\b(no|nope|nah|missed)\b/.test(t)) return "deny";
  if (words.length <= 4 && /^i did\b/i.test(t)) return "affirm";

  return "not_applicable";
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
  const polarity = detectShortAnswerPolarity(raw);
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
  const isShort = polarity !== "not_applicable";

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
  } else if (explicitMiss) {
    outcomeProofEligible = true;
    allowedPersistence = "write_user_no";
    claims.miss = true;
    intent = "tell_truth_and_recover";
    reason = "explicit_miss_clause";
  } else if (explicitPartial) {
    outcomeProofEligible = true;
    allowedPersistence = "write_user_partial";
    claims.partial = true;
    intent = "tell_truth_and_recover";
    reason = "explicit_partial_clause";
  } else if (priorType === "outcome_check" && hasLive && freshEnough && isShort) {
    if (polarity === "affirm") {
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
    outcomeProofEligible = true;
    allowedPersistence = "write_user_partial";
    claims.partial = true;
    intent = "tell_truth_and_recover";
    reason = "short_partial_to_fresh_outcome_check";
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
