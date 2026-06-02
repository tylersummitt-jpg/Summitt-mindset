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
import { classifyInboundSmsSafetyTier } from "@/lib/sms-inbound-safety";
import { SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE } from "@/lib/sms-relationship-exit-intent";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";

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
  InboundSmsResponseIntentResult;

export type DeriveInboundRelationshipMeaningArgs = {
  rawInbound: string;
  classifierEventType?: V2InboundEventType;
  classifierNormalizedHint?: string | null;
  routePriority?: InboundMeaningRoutePriority;
  openQuestionPending?: boolean;
  latestOpenQuestion?: string | null;
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

  if (looksLikePlanMade(raw)) {
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
    return {
      relationship_meaning: "miss",
      temporal_scope,
      confidence: "high",
      evidence: ["explicit_miss_or_negation"],
      disqualifiers,
    };
  }

  if (disqualifiers.length > 0) {
    const classification =
      args.classifierEventType != null
        ? { eventType: args.classifierEventType, normalizedHint: args.classifierNormalizedHint ?? null }
        : classifyV2InboundReply(raw);

    if (classification.eventType === "user_no") {
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

  if (isReportedCompletionRelationshipCandidate(raw)) {
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

export function derivePersistenceDecision(args: {
  meaning: InboundRelationshipMeaningResult;
  routePriority?: InboundMeaningRoutePriority;
  classifierEventType?: V2InboundEventType;
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
      return {
        persistence_decision: "write_user_yes_today",
        reason: "reported_completion_today_scope",
      };
    }
    case "miss":
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
  const meaning = deriveInboundRelationshipMeaning({ ...args, routePriority });
  const persistence = derivePersistenceDecision({
    meaning,
    routePriority,
    classifierEventType: args.classifierEventType,
  });
  const sms = deriveSmsResponseIntent({ meaning, persistence });
  return { ...meaning, ...persistence, ...sms };
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
  return meaning.persistence_decision === "write_user_yes_today";
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
