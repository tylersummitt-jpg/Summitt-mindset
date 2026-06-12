/**
 * Server-owned inbound relationship meaning vs accountability state writes.
 * OpenAI writes SMS; this module decides meaning, persistence, and response intent.
 */

import { hasFuturePlanIntentLanguage } from "@/lib/pending-plan-proof";
import {
  extractCompletionDisqualifiers,
  inferTemporalScopeFromInbound,
  isReportedCompletionRelationshipCandidate,
} from "@/lib/pending-plan-proof";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
  inboundHasPlanConfirmationClause,
} from "@/lib/inbound-short-answer-clauses";
import {
  detectShortAnswerPartialLanguage,
  isBoundedPlanConfirmationAnswer,
  isNonOutcomePlanPriorQuestionType,
  isPlanAckFromShortAnswerContext,
  isPlanRejectionFromShortAnswerContext,
  isShortContextualAnswer,
  looksLikeShortProposalRejectionLanguage,
  resolveShortAnswerContextAuthority,
  type ShortAnswerContextAuthority,
} from "@/lib/inbound-short-answer-context";
import type { ExpectedReplySemanticsV3 } from "@/lib/north-star-sms-context-packet";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { classifyInboundSmsSafetyTier } from "@/lib/sms-inbound-safety";
import { SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE } from "@/lib/sms-relationship-exit-intent";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { deriveInboundTemporalDayKeys } from "@/lib/sms-temporal-contract-v1";
import { resolveUserTimezone } from "@/lib/timezone";

export type InboundRelationshipMeaning =
  | "reported_completion"
  | "miss"
  | "partial_attempt"
  | "plan_made"
  | "blocker"
  | "question"
  | "answer_to_prior_question"
  | "support_request"
  | "contract_consent"
  | "uncertain"
  | "unknown";

export type InboundTemporalScope = "today" | "yesterday" | "past" | "future" | "unclear";

export type InboundMeaningConfidence = "high" | "medium" | "low";

export type InboundPersistenceDecision =
  | "write_user_yes_today"
  | "write_user_no"
  | "write_user_partial"
  | "no_outcome_write"
  | "ack_only"
  | "defer_to_pending_resolution"
  | "defer_to_contract_consent";

export type InboundSmsResponseIntent =
  | "acknowledge_completion_and_next_step"
  | "tell_truth_and_recover"
  | "identify_blocker_or_next_move"
  | "reinforce_plan_and_choose_first_step"
  | "answer_prior_question"
  | "clarify_gently"
  | "normal_accountability";

export type InboundMeaningRoutePriority = {
  compliance_or_stop?: boolean;
  crisis_or_safety?: boolean;
  support_or_cancel?: boolean;
  pending_resolution?: boolean;
  contract_consent?: boolean;
  relationship_exit?: boolean;
  identity_edit?: boolean;
  commitment_change_handoff?: boolean;
  open_question_owns_turn?: boolean;
};

export type InboundRelationshipMeaningResult = {
  relationship_meaning: InboundRelationshipMeaning;
  temporal_scope: InboundTemporalScope;
  confidence: InboundMeaningConfidence;
  evidence: string[];
  disqualifiers: string[];
};

export type InboundPersistenceDecisionResult = {
  persistence_decision: InboundPersistenceDecision;
  reason: string;
};

export type InboundSmsResponseIntentResult = {
  sms_response_intent: InboundSmsResponseIntent;
};

export type InboundMeaningFacts = InboundRelationshipMeaningResult &
  InboundPersistenceDecisionResult &
  InboundSmsResponseIntentResult & {
    spoken_local_day_key: string | null;
    reported_for_day_key: string | null;
    user_timezone: string | null;
  };

export type DeriveInboundRelationshipMeaningArgs = {
  rawInbound: string;
  classifierEventType?: V2InboundEventType;
  classifierNormalizedHint?: string | null;
  routePriority?: InboundMeaningRoutePriority;
  openQuestionPending?: boolean;
  latestOpenQuestion?: string | null;
  latestOutboundBody?: string | null;
  expectedAnswerType?: string | null;
  expectedReplySemantics?: ExpectedReplySemanticsV3 | string | null;
  recentEventsNewestFirst?: V2EventRowForAi[];
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  commitmentTitle?: string | null;
  shortAnswerContext?: ShortAnswerContextAuthority | null;
  /** OpenAI TU fallback polarity when deterministic SACA is unclear (server gate still required). */
  tuAnsweredLastCoachAsk?: "yes" | "no" | "unclear" | null;
  /** When omitted, anchoring uses `new Date()` at derive time. */
  receivedAt?: Date;
  timezone?: string;
};

function looksLikeUserQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  if (/^(did|do|does|can|could|would|will|is|are|was|were|what|when|where|who|how|why)\b/i.test(t)) {
    return true;
  }
  return false;
}

function looksLikeMissStatement(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikePartialAttempt(t)) return false;
  if (/\b(didn'?t|did not|didnt|never|not done|haven'?t|have not|no[, ]+i didn'?t)\b/i.test(t)) {
    return true;
  }
  if (/\b(missed|wasn'?t able|couldn'?t|failed to|did not get|did not finish|did not complete)\b/i.test(t)) {
    return true;
  }
  if (/^(no|nope|nah)\b/i.test(t.toLowerCase()) && t.length <= 24) return true;
  return false;
}

export function looksLikeSupportCancelBillingIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE.test(t)) return true;
  if (/\b(cancel|help)\s+(my\s+)?(account|subscription|membership|billing)\b/i.test(t)) return true;
  if (/\bhelp\s+cancel\b/i.test(t)) return true;
  if (
    /\b(need|want)\s+to\s+cancel\b/i.test(t) &&
    /\b(subscription|membership|account|billing|charging|sign\s+up)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function looksLikeCrisisOrSafetyInbound(text: string): boolean {
  const tier = classifyInboundSmsSafetyTier(text).tier;
  return tier === "crisis" || tier === "harmful_request";
}

function looksLikePartialAttempt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /\b(almost|tried to|attempted to|started to|working on|in progress|halfway|partially|partly|not finished|didn'?t finish|started but)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\bstarted\s+but\s+(didn'?t|did not)\s+finish\b/i.test(t)) return true;
  if (/\b(did|done|finished|complete)\s+half\b/i.test(t) || /\bdid\s+half\b/i.test(t)) return true;
  if (/\bonly\s+did\s+part\b/i.test(t) || (/\bpart\s+of\s+it\b/i.test(t) && /\b(did|done|only)\b/i.test(t))) {
    return true;
  }
  if (/\btried\s+but\s+(couldn'?t|could not|didn'?t|did not)\s+finish\b/i.test(t)) return true;
  if (/\b(kind of|sort of)\b/i.test(t) && /\b(did|done|finish|complete)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Text-level signals that block classifier completion_* → reported_completion promotion. */
export function textBlocksClassifierCompletionPromotion(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (extractCompletionDisqualifiers(t).length > 0) return true;
  if (looksLikeSupportCancelBillingIntent(t)) return true;
  if (isLikelySmsComplianceOrOptOutTurn(t)) return true;
  if (looksLikeCrisisOrSafetyInbound(t)) return true;
  if (looksLikePartialAttempt(t)) return true;
  if (looksLikePlanMade(t)) return true;
  if (looksLikeMissStatement(t)) return true;
  if (looksLikeUncertainty(t)) return true;
  if (looksLikeUserQuestion(t) && !isReportedCompletionRelationshipCandidate(t)) return true;
  if (looksLikeWishOrRegret(t)) return true;
  if (looksLikeThinkingNotDoing(t)) return true;
  return false;
}

export function mergeInboundMeaningRoutePriority(
  ...layers: Array<InboundMeaningRoutePriority | undefined>
): InboundMeaningRoutePriority {
  const merged: InboundMeaningRoutePriority = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.compliance_or_stop) merged.compliance_or_stop = true;
    if (layer.crisis_or_safety) merged.crisis_or_safety = true;
    if (layer.support_or_cancel) merged.support_or_cancel = true;
    if (layer.pending_resolution) merged.pending_resolution = true;
    if (layer.contract_consent) merged.contract_consent = true;
    if (layer.relationship_exit) merged.relationship_exit = true;
    if (layer.identity_edit) merged.identity_edit = true;
    if (layer.commitment_change_handoff) merged.commitment_change_handoff = true;
    if (layer.open_question_owns_turn) merged.open_question_owns_turn = true;
  }
  return merged;
}

export function inferInboundMeaningRoutePriorityFromText(raw: string): InboundMeaningRoutePriority {
  const text = raw.trim();
  if (!text) return {};
  return {
    compliance_or_stop: isLikelySmsComplianceOrOptOutTurn(text),
    crisis_or_safety: looksLikeCrisisOrSafetyInbound(text),
    support_or_cancel: looksLikeSupportCancelBillingIntent(text),
  };
}

function looksLikePlanMade(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasFuturePlanIntentLanguage(t)) return true;
  if (/\b(made a plan|making a plan|have a plan|my plan is)\b/i.test(t)) return true;
  return false;
}

function looksLikeWishOrRegret(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\b(wish i|wished i|if only i|should have|could have would have)\b/i.test(t);
}

function looksLikeThinkingNotDoing(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\b(thought about|think about|thinking about|considered|considering)\b/i.test(t);
}

function looksLikeUncertainty(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?\s*$/.test(t) && t.length <= 48) return true;
  if (/\b(maybe|not sure|i guess|i think|unclear|unsure)\b/i.test(t) && t.length <= 80) {
    return true;
  }
  return false;
}

function looksLikeBoundedYesNo(text: string): boolean {
  const core = text.trim().toLowerCase().replace(/[.!?…]+$/g, "").trim();
  if (!core || core.length > 12) return false;
  return /^(yes|y|yeah|yep|yup|no|n|nope|nah)$/.test(core);
}

export function deriveInboundRelationshipMeaning(
  args: DeriveInboundRelationshipMeaningArgs
): InboundRelationshipMeaningResult {
  const raw = args.rawInbound.trim();
  const evidence: string[] = [];
  const route = args.routePriority ?? {};

  if (!raw) {
    return {
      relationship_meaning: "unknown",
      temporal_scope: "unclear",
      confidence: "low",
      evidence: ["empty_inbound"],
      disqualifiers: [],
    };
  }

  if (route.compliance_or_stop || route.crisis_or_safety) {
    return {
      relationship_meaning: "support_request",
      temporal_scope: "unclear",
      confidence: "high",
      evidence: ["route_priority_safety_compliance"],
      disqualifiers: [],
    };
  }

  if (route.pending_resolution) {
    return {
      relationship_meaning: "unknown",
      temporal_scope: inferTemporalScopeFromInbound(raw),
      confidence: "high",
      evidence: ["route_priority_pending_resolution"],
      disqualifiers: [],
    };
  }

  if (route.contract_consent) {
    return {
      relationship_meaning: "contract_consent",
      temporal_scope: "unclear",
      confidence: "high",
      evidence: ["route_priority_contract_consent"],
      disqualifiers: [],
    };
  }

  if (route.relationship_exit || route.identity_edit || route.commitment_change_handoff) {
    return {
      relationship_meaning: "unknown",
      temporal_scope: inferTemporalScopeFromInbound(raw),
      confidence: "high",
      evidence: ["route_priority_integrity_or_change"],
      disqualifiers: [],
    };
  }

  if (route.support_or_cancel || looksLikeSupportCancelBillingIntent(raw)) {
    return {
      relationship_meaning: "support_request",
      temporal_scope: "unclear",
      confidence: "high",
      evidence: ["support_cancel_billing_intent"],
      disqualifiers: [],
    };
  }

  const disqualifiers = extractCompletionDisqualifiers(raw);
  const temporal_scope = inferTemporalScopeFromInbound(raw);

  const saca =
    args.shortAnswerContext ??
    resolveShortAnswerContextAuthority({
      rawInbound: raw,
      latestOpenQuestion: args.latestOpenQuestion,
      latestOutboundBody: args.latestOutboundBody,
      expectedAnswerType: args.expectedAnswerType,
      expectedReplySemantics: args.expectedReplySemantics,
      openQuestionPending: args.openQuestionPending,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.behaviorStatement,
      commitmentTitle: args.commitmentTitle,
      recentEventsNewestFirst: args.recentEventsNewestFirst,
    });

  if (inboundHasExplicitCompletionClause(raw)) {
    return {
      relationship_meaning: "reported_completion",
      temporal_scope,
      confidence: "high",
      evidence: ["compound_or_explicit_completion_clause"],
      disqualifiers,
    };
  }

  if (looksLikePartialAttempt(raw)) {
    return {
      relationship_meaning: "partial_attempt",
      temporal_scope,
      confidence: "high",
      evidence: ["partial_attempt_phrasing"],
      disqualifiers,
    };
  }

  if (inboundHasExplicitMissClause(raw)) {
    return {
      relationship_meaning: "miss",
      temporal_scope,
      confidence: "high",
      evidence: ["explicit_miss_clause"],
      disqualifiers,
    };
  }

  if (inboundHasExplicitPartialClause(raw)) {
    return {
      relationship_meaning: "partial_attempt",
      temporal_scope,
      confidence: "high",
      evidence: ["explicit_partial_clause"],
      disqualifiers,
    };
  }

  if (route.open_question_owns_turn && looksLikeBoundedYesNo(raw)) {
    return {
      relationship_meaning: "answer_to_prior_question",
      temporal_scope,
      confidence: "high",
      evidence: ["bounded_yes_no_open_question"],
      disqualifiers,
    };
  }

  if (looksLikeUncertainty(raw)) {
    return {
      relationship_meaning: "uncertain",
      temporal_scope,
      confidence: "high",
      evidence: ["uncertainty_markers"],
      disqualifiers,
    };
  }

  if (looksLikeUserQuestion(raw) && !isReportedCompletionRelationshipCandidate(raw)) {
    return {
      relationship_meaning: "question",
      temporal_scope,
      confidence: "high",
      evidence: ["user_question_shape"],
      disqualifiers,
    };
  }

  if (looksLikeWishOrRegret(raw)) {
    return {
      relationship_meaning: "miss",
      temporal_scope,
      confidence: "high",
      evidence: ["wish_or_regret_not_completion"],
      disqualifiers,
    };
  }

  if (looksLikeThinkingNotDoing(raw)) {
    return {
      relationship_meaning: "uncertain",
      temporal_scope,
      confidence: "medium",
      evidence: ["thinking_not_doing"],
      disqualifiers,
    };
  }

  if (
    looksLikePlanMade(raw) &&
    !inboundHasExplicitCompletionClause(raw) &&
    !inboundHasExplicitMissClause(raw)
  ) {
    if (inboundHasPlanConfirmationClause(raw) && saca.prior_question_type === "plan_confirmation") {
      return {
        relationship_meaning: "answer_to_prior_question",
        temporal_scope: temporal_scope === "unclear" ? "future" : temporal_scope,
        confidence: "high",
        evidence: ["plan_confirmation_with_future_intent", saca.reason],
        disqualifiers,
      };
    }
    return {
      relationship_meaning: "plan_made",
      temporal_scope: temporal_scope === "unclear" ? "future" : temporal_scope,
      confidence: "high",
      evidence: ["plan_or_future_intent"],
      disqualifiers,
    };
  }

  if (looksLikePartialAttempt(raw)) {
    return {
      relationship_meaning: "partial_attempt",
      temporal_scope,
      confidence: "high",
      evidence: ["partial_or_attempt_language"],
      disqualifiers,
    };
  }

  if (looksLikeMissStatement(raw)) {
    if (!inboundHasExplicitMissClause(raw) && !saca.outcome_proof_eligible) {
      if (
        isNonOutcomePlanPriorQuestionType(saca.prior_question_type) &&
        (saca.is_short_contextual_answer ||
          looksLikeShortProposalRejectionLanguage(raw) ||
          saca.short_answer_polarity === "deny")
      ) {
        return {
          relationship_meaning: "answer_to_prior_question",
          temporal_scope,
          confidence: "high",
          evidence: ["short_deny_plan_proposal_rejection", saca.reason],
          disqualifiers,
        };
      }
      if (saca.is_short_contextual_answer) {
        return {
          relationship_meaning: "uncertain",
          temporal_scope,
          confidence: "medium",
          evidence: ["short_deny_without_outcome_antecedent", saca.reason],
          disqualifiers,
        };
      }
    }
    return {
      relationship_meaning: "miss",
      temporal_scope,
      confidence: "high",
      evidence: ["explicit_miss_or_negation"],
      disqualifiers,
    };
  }

  const planProposalRejection = resolvePlanProposalShortAnswerRejectionMeaning({
    saca,
    raw,
    temporal_scope,
    disqualifiers,
  });
  if (planProposalRejection) {
    return planProposalRejection;
  }

  if (disqualifiers.length > 0) {
    const classification =
      args.classifierEventType != null
        ? { eventType: args.classifierEventType, normalizedHint: args.classifierNormalizedHint ?? null }
        : classifyV2InboundReply(raw);

    if (classification.eventType === "user_no") {
      const rejectionAfterDisqualifiers = resolvePlanProposalShortAnswerRejectionMeaning({
        saca,
        raw,
        temporal_scope,
        disqualifiers,
      });
      if (rejectionAfterDisqualifiers) {
        return rejectionAfterDisqualifiers;
      }
      return {
        relationship_meaning: "miss",
        temporal_scope,
        confidence: "medium",
        evidence: ["classifier_user_no_with_disqualifiers"],
        disqualifiers,
      };
    }
    if (classification.normalizedHint === "keyword_partial") {
      return {
        relationship_meaning: "partial_attempt",
        temporal_scope,
        confidence: "medium",
        evidence: ["classifier_keyword_partial"],
        disqualifiers,
      };
    }
    return {
      relationship_meaning: "uncertain",
      temporal_scope,
      confidence: "medium",
      evidence: ["completion_disqualified"],
      disqualifiers,
    };
  }

  if (isReportedCompletionRelationshipCandidate(raw, saca)) {
    evidence.push("reported_completion_candidate");
    return {
      relationship_meaning: "reported_completion",
      temporal_scope,
      confidence: "high",
      evidence,
      disqualifiers: [],
    };
  }

  const classification =
    args.classifierEventType != null
      ? { eventType: args.classifierEventType, normalizedHint: args.classifierNormalizedHint ?? null }
      : classifyV2InboundReply(raw);

  if (classification.eventType === "user_no") {
    const rejectionBeforeMiss = resolvePlanProposalShortAnswerRejectionMeaning({
      saca,
      raw,
      temporal_scope,
      disqualifiers,
    });
    if (rejectionBeforeMiss) {
      return rejectionBeforeMiss;
    }
    return {
      relationship_meaning: "miss",
      temporal_scope,
      confidence: classification.normalizedHint ? "medium" : "high",
      evidence: ["classifier_user_no"],
      disqualifiers: [],
    };
  }

  if (classification.normalizedHint === "keyword_partial") {
    return {
      relationship_meaning: "partial_attempt",
      temporal_scope,
      confidence: "high",
      evidence: ["classifier_keyword_partial"],
      disqualifiers: [],
    };
  }

  if (classification.eventType === "user_yes") {
    const hint = classification.normalizedHint ?? "";
    if (
      (hint.startsWith("completion_") || hint.startsWith("success_reflection")) &&
      !textBlocksClassifierCompletionPromotion(raw)
    ) {
      return {
        relationship_meaning: "reported_completion",
        temporal_scope,
        confidence: "medium",
        evidence: [`classifier_${hint}`],
        disqualifiers: [],
      };
    }
    if (looksLikePartialAttempt(raw)) {
      return {
        relationship_meaning: "partial_attempt",
        temporal_scope,
        confidence: "medium",
        evidence: ["classifier_yes_but_partial_language"],
        disqualifiers: [],
      };
    }
  }

  if (
    saca.is_short_contextual_answer &&
    saca.prior_question_type === "plan_confirmation"
  ) {
    return {
      relationship_meaning: "answer_to_prior_question",
      temporal_scope,
      confidence: "high",
      evidence: ["short_answer_plan_confirmation", saca.reason],
      disqualifiers,
    };
  }

  if (
    saca.is_short_contextual_answer &&
    saca.prior_question_type === "no_recent_question"
  ) {
    return {
      relationship_meaning: "uncertain",
      temporal_scope,
      confidence: "medium",
      evidence: ["contextless_short_answer", saca.reason],
      disqualifiers: [],
    };
  }

  if (saca.outcome_proof_eligible && saca.prior_question_type === "outcome_check") {
    if (saca.allowed_outbound_claims.completion) {
      return {
        relationship_meaning: "reported_completion",
        temporal_scope,
        confidence: "high",
        evidence: ["saca_short_affirm_outcome_check", saca.reason],
        disqualifiers: [],
      };
    }
    if (saca.allowed_outbound_claims.miss) {
      return {
        relationship_meaning: "miss",
        temporal_scope,
        confidence: "high",
        evidence: ["saca_short_deny_outcome_check", saca.reason],
        disqualifiers: [],
      };
    }
    if (saca.allowed_outbound_claims.partial) {
      return {
        relationship_meaning: "partial_attempt",
        temporal_scope,
        confidence: "high",
        evidence: ["saca_short_partial_outcome_check", saca.reason],
        disqualifiers: [],
      };
    }
  }

  if (looksLikeBoundedYesNo(raw)) {
    return {
      relationship_meaning: args.openQuestionPending
        ? "answer_to_prior_question"
        : "unknown",
      temporal_scope,
      confidence: "medium",
      evidence: ["bounded_yes_no"],
      disqualifiers: [],
    };
  }

  return {
    relationship_meaning: "unknown",
    temporal_scope,
    confidence: "low",
    evidence: ["no_clear_meaning_signal"],
    disqualifiers: [],
  };
}

/** Block short affirmative / future commitment from persisting as today's completion. */
function shouldBlockAffirmativeAsTodayCompletion(args: {
  raw: string;
  saca?: ShortAnswerContextAuthority | null;
  meaning: InboundRelationshipMeaningResult;
}): string | null {
  const raw = args.raw.trim();
  if (!raw) return null;
  if (inboundHasExplicitCompletionClause(raw)) return null;
  if (inboundHasExplicitMissClause(raw) || inboundHasExplicitPartialClause(raw)) return null;

  const saca = args.saca;
  const isShortAffirmative =
    (saca?.is_short_contextual_answer === true && saca.short_answer_polarity === "affirm") ||
    isBoundedPlanConfirmationAnswer(raw);
  const isPlanContext =
    saca?.prior_question_type === "plan_confirmation" ||
    saca?.prior_question_type === "future_plan_question" ||
    saca?.prior_question_type === "adjustment_prompt";

  if (
    args.meaning.relationship_meaning === "reported_completion" &&
    !isShortAffirmative &&
    !isPlanContext &&
    !hasFuturePlanIntentLanguage(raw) &&
    !inboundHasPlanConfirmationClause(raw)
  ) {
    return null;
  }

  if (saca && isPlanAckFromShortAnswerContext(saca)) {
    return "plan_or_proposal_ack";
  }
  if (
    saca &&
    (saca.prior_question_type === "plan_confirmation" ||
      saca.prior_question_type === "future_plan_question" ||
      saca.prior_question_type === "adjustment_prompt") &&
    !saca.outcome_proof_eligible
  ) {
    return `prior_question_${saca.prior_question_type}`;
  }

  if (
    args.meaning.relationship_meaning === "answer_to_prior_question" ||
    args.meaning.relationship_meaning === "plan_made"
  ) {
    return `meaning_${args.meaning.relationship_meaning}`;
  }

  if (
    hasFuturePlanIntentLanguage(raw) ||
    (inboundHasPlanConfirmationClause(raw) && (isShortAffirmative || isPlanContext))
  ) {
    return "future_commitment_without_completion";
  }

  if (isBoundedPlanConfirmationAnswer(raw) && saca?.prior_question_type === "plan_confirmation") {
    return "bounded_plan_ack";
  }

  return null;
}

function resolvePlanProposalShortAnswerRejectionMeaning(args: {
  saca: ShortAnswerContextAuthority;
  raw: string;
  temporal_scope: InboundTemporalScope;
  disqualifiers: string[];
}): InboundRelationshipMeaningResult | null {
  const raw = args.raw.trim();
  if (!raw || inboundHasExplicitMissClause(raw)) return null;

  const saca = args.saca;
  const planPrior = isNonOutcomePlanPriorQuestionType(saca.prior_question_type);
  const rejectionLanguage = looksLikeShortProposalRejectionLanguage(raw);

  if (
    isPlanRejectionFromShortAnswerContext(saca) ||
    (planPrior && !saca.outcome_proof_eligible && rejectionLanguage) ||
    (planPrior &&
      !saca.outcome_proof_eligible &&
      saca.is_short_contextual_answer &&
      saca.short_answer_polarity === "deny")
  ) {
    return {
      relationship_meaning: "answer_to_prior_question",
      temporal_scope: args.temporal_scope,
      confidence: "high",
      evidence: ["short_answer_plan_proposal_rejection", saca.reason],
      disqualifiers: args.disqualifiers,
    };
  }

  return null;
}

/** Block short negative / proposal rejection from persisting as today's miss. */
function shouldBlockNegativeAsTodayMiss(args: {
  raw: string;
  saca?: ShortAnswerContextAuthority | null;
  meaning: InboundRelationshipMeaningResult;
}): string | null {
  const raw = args.raw.trim();
  if (!raw) return null;
  if (inboundHasExplicitMissClause(raw)) return null;

  const saca = args.saca;

  if (saca && isPlanRejectionFromShortAnswerContext(saca)) {
    return "plan_or_proposal_rejection";
  }

  if (
    saca &&
    isNonOutcomePlanPriorQuestionType(saca.prior_question_type) &&
    !saca.outcome_proof_eligible &&
    (saca.short_answer_polarity === "deny" || looksLikeShortProposalRejectionLanguage(raw))
  ) {
    return `prior_question_${saca.prior_question_type}`;
  }

  if (
    args.meaning.relationship_meaning === "answer_to_prior_question" &&
    args.meaning.evidence.some((e) => e.includes("plan_proposal_rejection") || e.includes("short_deny_plan"))
  ) {
    return `meaning_${args.meaning.relationship_meaning}`;
  }

  if (looksLikeShortProposalRejectionLanguage(raw) && saca && !saca.outcome_proof_eligible && saca.prior_question_type !== "outcome_check") {
    return "short_proposal_rejection_language";
  }

  return null;
}

export function derivePersistenceDecision(args: {
  meaning: InboundRelationshipMeaningResult;
  routePriority?: InboundMeaningRoutePriority;
  classifierEventType?: V2InboundEventType;
  shortAnswerContext?: ShortAnswerContextAuthority | null;
  rawInbound?: string;
}): InboundPersistenceDecisionResult {
  const route = args.routePriority ?? {};
  const m = args.meaning.relationship_meaning;

  if (route.pending_resolution) {
    return {
      persistence_decision: "defer_to_pending_resolution",
      reason: "pending_resolution_route_owns_turn",
    };
  }
  if (route.contract_consent) {
    return {
      persistence_decision: "defer_to_contract_consent",
      reason: "contract_consent_route_owns_turn",
    };
  }
  if (route.compliance_or_stop || route.crisis_or_safety || route.support_or_cancel) {
    return {
      persistence_decision: "no_outcome_write",
      reason: "safety_compliance_or_support_route",
    };
  }
  if (route.relationship_exit || route.identity_edit || route.commitment_change_handoff) {
    return {
      persistence_decision: "no_outcome_write",
      reason: "integrity_or_change_route",
    };
  }
  if (route.open_question_owns_turn) {
    return {
      persistence_decision: "no_outcome_write",
      reason: "open_question_route_owns_turn",
    };
  }

  const saca = args.shortAnswerContext;
  const raw = args.rawInbound?.trim() ?? "";
  if (
    saca?.is_short_contextual_answer &&
    !saca.outcome_proof_eligible &&
    !inboundHasExplicitCompletionClause(raw) &&
    !inboundHasExplicitMissClause(raw) &&
    !inboundHasExplicitPartialClause(raw) &&
    !detectShortAnswerPartialLanguage(raw)
  ) {
    return {
      persistence_decision: "no_outcome_write",
      reason: `short_answer_no_outcome_proof:${saca.reason}`,
    };
  }

  const blockAffirmativeReason = shouldBlockAffirmativeAsTodayCompletion({
    raw,
    saca,
    meaning: args.meaning,
  });
  if (blockAffirmativeReason) {
    return {
      persistence_decision: "no_outcome_write",
      reason: `future_affirmative_not_completion:${blockAffirmativeReason}`,
    };
  }

  const blockNegativeReason = shouldBlockNegativeAsTodayMiss({
    raw,
    saca,
    meaning: args.meaning,
  });
  if (blockNegativeReason) {
    return {
      persistence_decision: "no_outcome_write",
      reason: `future_negative_not_miss:${blockNegativeReason}`,
    };
  }

  if (
    saca?.outcome_proof_eligible === true &&
    saca.allowed_persistence !== "no_outcome_write" &&
    /^short_(affirm|deny|partial)_to_fresh_outcome_check/.test(saca.reason)
  ) {
    return {
      persistence_decision: saca.allowed_persistence,
      reason: `saca_authorized:${saca.reason}`,
    };
  }

  switch (m) {
    case "reported_completion": {
      if (
        args.meaning.temporal_scope === "yesterday" ||
        args.meaning.temporal_scope === "past"
      ) {
        return {
          persistence_decision: "ack_only",
          reason: "reported_past_completion_no_prior_day_write_support",
        };
      }
      if (args.meaning.temporal_scope === "future") {
        return {
          persistence_decision: "no_outcome_write",
          reason: "reported_future_not_today_completion",
        };
      }
      if (shouldBlockAffirmativeAsTodayCompletion({ raw, saca, meaning: args.meaning })) {
        return {
          persistence_decision: "no_outcome_write",
          reason: "reported_completion_blocked_future_affirmative",
        };
      }
      return {
        persistence_decision: "write_user_yes_today",
        reason: "reported_completion_today_scope",
      };
    }
    case "miss":
      if (shouldBlockNegativeAsTodayMiss({ raw, saca, meaning: args.meaning })) {
        return {
          persistence_decision: "no_outcome_write",
          reason: "explicit_miss_blocked_plan_proposal_rejection",
        };
      }
      return {
        persistence_decision: "write_user_no",
        reason: "explicit_miss",
      };
    case "partial_attempt":
      return {
        persistence_decision: "write_user_partial",
        reason: "partial_attempt",
      };
    case "plan_made":
      return {
        persistence_decision: "no_outcome_write",
        reason: "plan_not_proof",
      };
    case "question":
    case "uncertain":
    case "unknown":
    case "support_request":
      return {
        persistence_decision: "no_outcome_write",
        reason: `meaning_${m}_no_spine_write`,
      };
    case "answer_to_prior_question":
      return {
        persistence_decision: "no_outcome_write",
        reason: "open_question_answer_handled_elsewhere",
      };
    case "contract_consent":
      return {
        persistence_decision: "defer_to_contract_consent",
        reason: "contract_consent",
      };
    case "blocker":
      return {
        persistence_decision: "no_outcome_write",
        reason: "blocker_capture_or_lane",
      };
    default:
      return {
        persistence_decision: "no_outcome_write",
        reason: "unmapped_meaning",
      };
  }
}

export function deriveSmsResponseIntent(args: {
  meaning: InboundRelationshipMeaningResult;
  persistence: InboundPersistenceDecisionResult;
}): InboundSmsResponseIntentResult {
  switch (args.meaning.relationship_meaning) {
    case "reported_completion":
      return { sms_response_intent: "acknowledge_completion_and_next_step" };
    case "miss":
      return { sms_response_intent: "tell_truth_and_recover" };
    case "partial_attempt":
      return { sms_response_intent: "identify_blocker_or_next_move" };
    case "plan_made":
      return { sms_response_intent: "reinforce_plan_and_choose_first_step" };
    case "answer_to_prior_question":
      return { sms_response_intent: "answer_prior_question" };
    case "question":
    case "uncertain":
      return { sms_response_intent: "clarify_gently" };
    case "blocker":
      return { sms_response_intent: "identify_blocker_or_next_move" };
    default:
      if (args.persistence.persistence_decision === "write_user_no") {
        return { sms_response_intent: "tell_truth_and_recover" };
      }
      return { sms_response_intent: "normal_accountability" };
  }
}

export function buildInboundMeaningFacts(
  args: DeriveInboundRelationshipMeaningArgs
): InboundMeaningFacts {
  const routePriority = mergeInboundMeaningRoutePriority(
    inferInboundMeaningRoutePriorityFromText(args.rawInbound),
    args.routePriority
  );
  const shortAnswerContext =
    args.shortAnswerContext ??
    resolveShortAnswerContextAuthority({
      rawInbound: args.rawInbound,
      latestOpenQuestion: args.latestOpenQuestion,
      latestOutboundBody: args.latestOutboundBody,
      expectedAnswerType: args.expectedAnswerType,
      expectedReplySemantics: args.expectedReplySemantics,
      openQuestionPending: args.openQuestionPending,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.behaviorStatement,
      commitmentTitle: args.commitmentTitle,
      recentEventsNewestFirst: args.recentEventsNewestFirst,
      tuAnsweredLastCoachAsk: args.tuAnsweredLastCoachAsk,
    });
  const meaning = deriveInboundRelationshipMeaning({
    ...args,
    routePriority,
    shortAnswerContext,
  });
  const persistence = derivePersistenceDecision({
    meaning,
    routePriority,
    classifierEventType: args.classifierEventType,
    shortAnswerContext,
    rawInbound: args.rawInbound,
  });
  const sms = deriveSmsResponseIntent({ meaning, persistence });
  const receivedAt = args.receivedAt ?? new Date();
  const user_timezone = args.timezone ? resolveUserTimezone(args.timezone) : null;
  const tz = user_timezone ?? resolveUserTimezone(null);
  const { spoken_local_day_key, reported_for_day_key } = deriveInboundTemporalDayKeys({
    temporalScope: meaning.temporal_scope,
    receivedAt,
    timezone: tz,
  });
  return {
    ...meaning,
    ...persistence,
    ...sms,
    spoken_local_day_key,
    reported_for_day_key,
    user_timezone: user_timezone ?? tz,
  };
}

export function coachingMoveFromSmsResponseIntent(intent: InboundSmsResponseIntent): string | null {
  switch (intent) {
    case "acknowledge_completion_and_next_step":
      return "acknowledge_completion";
    case "tell_truth_and_recover":
      return "name_blocker";
    case "identify_blocker_or_next_move":
      return "narrow_blocker";
    case "reinforce_plan_and_choose_first_step":
      return "next_first_step";
    case "answer_prior_question":
      return "respond_to_open_question_answer_natural";
    case "clarify_gently":
      return "clarify_intent";
    default:
      return null;
  }
}

/** Gated SMS coherence: only promote clarify → today user_yes when persistence allows today's write. */
export function shouldPromoteClarifyForReportedCompletionPersist(args: {
  inboundMeaning: InboundMeaningFacts | null | undefined;
}): boolean {
  return args.inboundMeaning?.persistence_decision === "write_user_yes_today";
}

export function isInboundReportedCompletionForAntiGhost(
  inboundMeaning: InboundMeaningFacts | null | undefined
): boolean {
  return inboundMeaning?.relationship_meaning === "reported_completion";
}

export function persistenceDecisionToOutcomeEventType(
  decision: InboundPersistenceDecision
): "user_yes" | "user_no" | "user_partial" | null {
  switch (decision) {
    case "write_user_yes_today":
      return "user_yes";
    case "write_user_no":
      return "user_no";
    case "write_user_partial":
      return "user_partial";
    default:
      return null;
  }
}

export function slimInboundMeaningForFacts(
  meaning: InboundMeaningFacts
): Record<string, unknown> {
  return {
    relationship_meaning: meaning.relationship_meaning,
    temporal_scope: meaning.temporal_scope,
    persistence_decision: meaning.persistence_decision,
    persistence_reason: meaning.reason,
    sms_response_intent: meaning.sms_response_intent,
    confidence: meaning.confidence,
    evidence: meaning.evidence.slice(0, 6),
    disqualifiers: meaning.disqualifiers.slice(0, 6),
    spoken_local_day_key: meaning.spoken_local_day_key,
    reported_for_day_key: meaning.reported_for_day_key,
    user_timezone: meaning.user_timezone,
  };
}

export function buildInboundMeaningRoutePriorityFromV3BuildArgs(args: {
  pendingResolutionFacts?: unknown | null;
  contractConsentFacts?: unknown | null;
  relationshipExitFacts?: unknown | null;
  identityEditFacts?: unknown | null;
  commitmentChangeFacts?: unknown | null;
  openQuestionFacts?: unknown | null;
  rawInbound?: string;
}): InboundMeaningRoutePriority {
  return mergeInboundMeaningRoutePriority(
    args.rawInbound ? inferInboundMeaningRoutePriorityFromText(args.rawInbound) : undefined,
    {
      pending_resolution: args.pendingResolutionFacts != null,
      contract_consent: args.contractConsentFacts != null,
      relationship_exit: args.relationshipExitFacts != null,
      identity_edit: args.identityEditFacts != null,
      commitment_change_handoff: args.commitmentChangeFacts != null,
      open_question_owns_turn: args.openQuestionFacts != null,
    }
  );
}

export function inboundMeaningAuthorizesTodayCompleted(
  meaning: InboundMeaningFacts
): boolean {
  return (
    meaning.persistence_decision === "write_user_yes_today" &&
    meaning.relationship_meaning === "reported_completion"
  );
}

export function reconcileLegacyAccountabilityEventTypeFromMeaning(args: {
  inboundMeaning: InboundMeaningFacts;
  gatedFinalEventType: string | null;
}): string | null {
  const fromMeaning = persistenceDecisionToOutcomeEventType(args.inboundMeaning.persistence_decision);
  if (fromMeaning) return fromMeaning;
  if (
    args.inboundMeaning.persistence_decision === "ack_only" ||
    args.inboundMeaning.persistence_decision === "no_outcome_write" ||
    args.inboundMeaning.persistence_decision === "defer_to_pending_resolution" ||
    args.inboundMeaning.persistence_decision === "defer_to_contract_consent"
  ) {
    return args.gatedFinalEventType === "user_yes" ? null : args.gatedFinalEventType;
  }
  return args.gatedFinalEventType;
}

export function buildInboundMeaningAuthorityLaneGuardrails(): string {
  return `
INBOUND_MEANING_AUTHORITY (facts.inbound_meaning):
- Server-owned inbound_meaning overrides legacy v2_accountability hints when they conflict.
- persistence_decision ack_only = acknowledge past/reported completion without treating today as done.
- Do not claim today's goal is complete when temporal_scope is yesterday/past and persistence_decision is ack_only.
- Do not claim proof was saved unless proof_callout_hint explicitly allows saved claims.
`;
}
