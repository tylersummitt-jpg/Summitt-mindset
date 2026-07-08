/**
 * OpenAI Relationship Turn Understanding V1 — inbound advisory meaning (not persistence authority).
 */

import OpenAI from "openai";

import type { InboundMeaningFacts, InboundPersistenceDecision } from "@/lib/inbound-relationship-meaning";
import { isUserCompletedGoalWantsToMoveOnLanguage } from "@/lib/v2-sms-conversation-brain-eligibility";
import type { InboundMeaningRoutePriority } from "@/lib/inbound-relationship-meaning";
import {
  buildInboundMeaningFacts,
  openQuestionAsksForListOrProofAnswer,
  shouldPromoteClarifyForReportedCompletionPersist,
} from "@/lib/inbound-relationship-meaning";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import { type V2InboundEventType } from "@/lib/v2-sms-accountability";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitAccountabilityMissClause,
  inboundHasExplicitPartialClause,
  inboundHasPlanConfirmationClause,
  inboundExplicitOutcomeDetected,
  looksLikeStaleGoalOrContextCorrection,
  looksLikeCoachContextCorrectionOrMetaDispute,
  splitInboundClauses,
} from "@/lib/inbound-short-answer-clauses";
import { inboundSignalsCompletion } from "@/lib/north-star-coach-sms";
import { isReportedCompletionRelationshipCandidate } from "@/lib/pending-plan-proof";

export const OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION =
  "openai_relationship_turn_understanding_v1" as const;

/** Live inbound turn interpreter — single model, no env override. */
export const TURN_UNDERSTANDING_OPENAI_MODEL = "gpt-4o-mini" as const;

const OPENAI_TIMEOUT_MS = 10_000;
const MAX_EVIDENCE_QUOTES = 2;
const MAX_DO_NOT_REPEAT = 6;
const LOW_CONFIDENCE_THRESHOLD = 0.55;

export type TurnUnderstandingRelationshipMeaning =
  | "reported_completion"
  | "miss"
  | "partial_attempt"
  | "blocker_detail"
  | "plan_made"
  | "already_scheduled_or_happening"
  | "prior_ask_satisfied"
  | "reported_metric_or_result"
  | "goal_adjustment_request"
  | "support_request"
  | "emotional_reflection"
  | "direct_answer"
  | "unclear";

export type TurnUnderstandingAnsweredLastCoachAsk = "yes" | "no" | "unclear";

export type TurnUnderstandingSatisfactionKind =
  | "completed"
  | "already_scheduled"
  | "currently_happening"
  | "plan_exists"
  | "answered_no"
  | "partial"
  | "not_satisfied"
  | "unclear";

export type TurnUnderstandingCommitmentOutcomeRecommendation =
  | "write_user_yes_today"
  | "write_user_no"
  | "write_user_partial"
  | "ack_only"
  | "no_outcome_write"
  | "unclear";

export type TurnUnderstandingPersistenceSafety =
  | "safe_to_write"
  | "do_not_write_but_acknowledge"
  | "defer_to_server";

export type TurnUnderstandingResponseIntent =
  | "acknowledge_completion"
  | "acknowledge_prior_ask_satisfied"
  | "tell_truth_and_recover"
  | "identify_blocker"
  | "reinforce_plan_without_proof"
  | "clarify_goal_change"
  | "answer_user_question"
  | "acknowledge_result_and_next_standard"
  | "ask_next_specific_step"
  | "close_loop_no_new_action"
  | "unclear_clarify";

export type TurnUnderstandingTemporalScope =
  | "today"
  | "yesterday"
  | "past"
  | "future"
  | "unclear";

export type TurnUnderstandingRoutePriorityRecommendation =
  | "none"
  | "support"
  | "crisis"
  | "compliance"
  | "contract_consent"
  | "pending_resolution"
  | "commitment_change"
  | "defer";

export type TurnUnderstandingGoalAdjustmentType =
  | "amend"
  | "restate"
  | "reset"
  | "raise"
  | "lower"
  | "shrink"
  | "replace"
  | "new_goal"
  | "blocker_focus"
  | "unspecified"
  | "none";

export type TurnUnderstandingGoalChangeSource =
  | "user_requested"
  | "consistency_signal"
  | "recurring_blocker"
  | "none";

export type TurnUnderstandingGoalChangeConfidenceLevel = "low" | "medium" | "high";

/** OpenAI-proposed goal-change moment — advisory only; server confirms before any mutation. */
export type TurnUnderstandingGoalChangeIntent = {
  detected: boolean;
  adjustment_type: TurnUnderstandingGoalAdjustmentType;
  source: TurnUnderstandingGoalChangeSource;
  requires_confirmation: boolean;
  proposed_new_goal_text: string | null;
  evidence_quote: string | null;
  confidence: TurnUnderstandingGoalChangeConfidenceLevel;
};

/** Server-reconciled goal-change intent — authoritative when `authoritative` is true. */
export type ReconciledGoalChangeIntent = {
  authoritative: boolean;
  detected: boolean;
  adjustment_type: TurnUnderstandingGoalAdjustmentType;
  source: TurnUnderstandingGoalChangeSource;
  requires_confirmation: boolean;
  proposed_new_goal_text: string | null;
  evidence_quote: string | null;
  confidence: TurnUnderstandingGoalChangeConfidenceLevel;
  goal_change_not_outcome_write: true;
  goal_change_no_state_mutation_without_confirmation: true;
};

export type OpenAIRelationshipTurnUnderstandingV1 = {
  version: typeof OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION;
  user_turn_summary: string;
  evidence_quotes: string[];
  relationship_meaning: TurnUnderstandingRelationshipMeaning;
  answered_last_coach_ask: TurnUnderstandingAnsweredLastCoachAsk;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  satisfaction_kind: TurnUnderstandingSatisfactionKind;
  do_not_repeat_asks: string[];
  stale_ask_risk: boolean;
  commitment_outcome_recommendation: TurnUnderstandingCommitmentOutcomeRecommendation;
  persistence_safety: TurnUnderstandingPersistenceSafety;
  response_intent: TurnUnderstandingResponseIntent;
  temporal_scope: TurnUnderstandingTemporalScope;
  reported_for_day_key: string | null;
  confidence: number;
  uncertainty_flags: string[];
  route_priority_recommendation: TurnUnderstandingRoutePriorityRecommendation;
  safety_or_support_flags: string[];
  goal_change_intent?: TurnUnderstandingGoalChangeIntent;
};

/** Safe, scrubbed diagnostics when OpenAI turn understanding fails (P0). */
export type TurnUnderstandingFailureDiagnostics = {
  tu_error_code: string;
  tu_error_message_short: string | null;
  tu_latency_ms: number | null;
  tu_raw_preview?: string | null;
  tu_sdk_status?: number | string | null;
  tu_sdk_type?: string | null;
};

export type ReconciledTurnUnderstanding = {
  proposal: OpenAIRelationshipTurnUnderstandingV1 | null;
  reconciled_relationship_meaning: TurnUnderstandingRelationshipMeaning;
  reconciled_response_intent: TurnUnderstandingResponseIntent;
  reconciled_persistence_decision: InboundPersistenceDecision;
  reconciled_do_not_repeat_asks: string[];
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  satisfaction_kind: TurnUnderstandingSatisfactionKind;
  stale_ask_risk: boolean;
  confidence: number;
  disagreement_flags: string[];
  interpreter_failed_reason: string | null;
  stale_ask_avoided: boolean;
  persistence_note: string;
  interpreter_latency_ms?: number | null;
  /** Conservative server fallback when live interpreter failed — still authoritative for guards. */
  turn_understanding_failed_safe_fallback?: boolean;
  turn_understanding_failed_safe_reason?: string | null;
  turn_understanding_failed_safe_do_not_repeat_asks?: string[];
  /** P0 failure diagnostics (scrubbed; never keys/prompts/full raw). */
  turn_understanding_failure_diagnostics?: TurnUnderstandingFailureDiagnostics | null;
  reconciled_goal_change_intent: ReconciledGoalChangeIntent | null;
  /** Phase 1 inbound route contract — authoritative for low-risk close-loop routes. */
  inbound_route_contract?: InboundRouteContract | null;
  /** Failed-safe: correction/stale-goal language blocked outcome write. */
  correction_language_detected?: boolean;
  blocked_outcome_reason?: string | null;
};

export type InboundPhase1Route =
  | "acknowledgment_no_reply"
  | "win_close_loop"
  | "proof_answer_close_loop"
  | "legacy_other";

export type InboundRouteOutcome = "win" | "miss" | "partial" | "proof" | "none" | "unclear";

export type InboundVictoryRoomLanguageMode = "none" | "metaphor_only" | "recorded_allowed";

export type InboundRouteAllowedClaims = {
  can_claim_win: boolean;
  can_claim_miss: boolean;
  can_claim_partial: boolean;
  can_claim_proof: boolean;
  can_reference_victory_room: boolean;
  can_claim_recorded: boolean;
  can_claim_streak: boolean;
  can_claim_consistency: boolean;
  victory_room_language_mode: InboundVictoryRoomLanguageMode;
};

export type InboundRouteContract = {
  route: InboundPhase1Route;
  phase1_authoritative: boolean;
  source: "server_backstop" | "turn_understanding" | "none";
  relationship_engagement: boolean;
  outcome: InboundRouteOutcome;
  answered_prior_ask: boolean;
  prior_ask_satisfied: boolean;
  should_persist: boolean;
  should_reply: boolean;
  close_loop: boolean;
  max_questions: 0 | 1;
  allow_new_assignment: boolean;
  allow_generic_advice: boolean;
  facts_to_reflect: string[];
  forbidden_moves: string[];
  outcome_to_persist: "win" | "miss" | "partial" | "proof" | "none";
};

export const PHASE1_AUTHORITATIVE_ROUTES = new Set<InboundPhase1Route>([
  "acknowledgment_no_reply",
  "win_close_loop",
  "proof_answer_close_loop",
]);

export function isPhase1AuthoritativeRouteContract(
  contract: InboundRouteContract | null | undefined
): boolean {
  return Boolean(
    contract?.phase1_authoritative &&
      PHASE1_AUTHORITATIVE_ROUTES.has(contract.route)
  );
}

export type MapTurnUnderstandingToInboundRouteContractArgs = {
  rawInbound: string;
  reconciled: ReconciledTurnUnderstanding;
  openQuestionPending?: boolean;
  latestOpenQuestion?: string | null;
  classifierEventType?: V2InboundEventType;
};

export function looksLikeRealHelpRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(thanks|thank you|appreciate)\b/i.test(t) && t.length <= 120) {
    if (
      /\b(thanks|thank you|appreciate)\b.*\b(for the advice|for your advice|for the help|for your help|for that|for this)\b/i.test(
        t
      )
    ) {
      return false;
    }
  }
  if (/^(thanks|thank you|thx|ty|okay|ok|k|good|sounds good|got it|will do|appreciate it)[.!]*$/i.test(t)) {
    return false;
  }
  return (
    /\b(how (can|do|should) i|what should i|struggling with|need help with)\b/i.test(t) ||
    /\bcan you (help|share|suggest)\b/i.test(t) ||
    (/\?\s*$/.test(t) && t.length >= 20 && /\b(what|how|why|should)\b/i.test(t))
  );
}

/** Mixed outcome/proof/friction language disqualifies pure closer no-reply. */
export function messageDisqualifiesPureAcknowledgmentCloser(
  rawInbound: string,
  args?: { openQuestionPending?: boolean; latestOpenQuestion?: string | null }
): boolean {
  const t = rawInbound.trim();
  if (!t) return true;
  if (looksLikeRealHelpRequest(t)) return true;
  if (inboundExplicitOutcomeDetected(t)) return true;
  if (detectWinCloseLoopBackstop(t)) return true;
  if (
    detectProofAnswerCloseLoopBackstop({
      rawInbound: t,
      openQuestionPending: args?.openQuestionPending,
      latestOpenQuestion: args?.latestOpenQuestion,
    })
  ) {
    return true;
  }
  if (/\b(blocked|stuck|frustrated|overwhelmed|can't|cannot)\b/i.test(t) && t.length > 24) {
    return true;
  }
  return false;
}

export function detectPureAcknowledgmentCloser(
  rawInbound: string,
  args?: { openQuestionPending?: boolean; latestOpenQuestion?: string | null }
): boolean {
  const t = rawInbound.trim();
  if (!t || t.length > 120) return false;
  if (messageDisqualifiesPureAcknowledgmentCloser(t, args)) return false;
  if (/^[\p{Extended_Pictographic}\s.!]+$/u.test(t) && t.length <= 8) return true;
  if (
    /^(thanks|thank you|thx|ty|okay|ok|k|good|sounds good|got it|will do|appreciate it|appreciated|noted)[.!]*$/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(thank you|thanks|appreciate|needed that)\b/i.test(t) && t.length <= 120) {
    return true;
  }
  return false;
}

export function detectWinCloseLoopBackstop(rawInbound: string): boolean {
  const raw = rawInbound.trim();
  if (!raw || looksLikeRealHelpRequest(raw)) return false;
  if (inboundHasExplicitCompletionClause(raw)) return true;
  if (/\b(we hit the goal|hit the goal|i did it|got it done|got that done|knocked it out)\b/i.test(raw)) {
    return true;
  }
  if (/\b(i finished it|i completed it|finished it|completed it)\b/i.test(raw)) {
    return true;
  }
  if (
    /\b(gave|compliment|compliments|told|said)\b/i.test(raw) &&
    /\b(goal|hit|done|completed|finished)\b/i.test(raw)
  ) {
    return true;
  }
  return false;
}

export function detectProofAnswerCloseLoopBackstop(args: {
  rawInbound: string;
  openQuestionPending?: boolean;
  latestOpenQuestion?: string | null;
}): boolean {
  const raw = args.rawInbound.trim();
  if (!raw || raw.length < 40) return false;
  if (looksLikeRealHelpRequest(raw)) return false;
  if (!args.openQuestionPending) return false;
  if (!openQuestionAsksForListOrProofAnswer(args.latestOpenQuestion)) return false;
  const sentenceCount = raw.split(/[.!?]+/).filter((s) => s.trim().length >= 12).length;
  const listParts = raw.split(/[,;]/).filter((p) => p.trim().length >= 8).length;
  return sentenceCount >= 2 || listParts >= 2;
}

function buildPhase1RouteContract(args: {
  route: InboundPhase1Route;
  source: InboundRouteContract["source"];
  relationship_engagement: boolean;
  outcome: InboundRouteOutcome;
  answered_prior_ask: boolean;
  prior_ask_satisfied: boolean;
  should_persist: boolean;
  should_reply: boolean;
  close_loop: boolean;
  max_questions: 0 | 1;
  allow_new_assignment: boolean;
  allow_generic_advice: boolean;
  facts_to_reflect: string[];
  forbidden_moves: string[];
  outcome_to_persist: InboundRouteContract["outcome_to_persist"];
}): InboundRouteContract {
  const phase1 = PHASE1_AUTHORITATIVE_ROUTES.has(args.route);
  return {
    route: args.route,
    phase1_authoritative: phase1,
    source: args.source,
    relationship_engagement: args.relationship_engagement,
    outcome: args.outcome,
    answered_prior_ask: args.answered_prior_ask,
    prior_ask_satisfied: args.prior_ask_satisfied,
    should_persist: args.should_persist,
    should_reply: args.should_reply,
    close_loop: args.close_loop,
    max_questions: args.max_questions,
    allow_new_assignment: args.allow_new_assignment,
    allow_generic_advice: args.allow_generic_advice,
    facts_to_reflect: args.facts_to_reflect.slice(0, 3),
    forbidden_moves: args.forbidden_moves.slice(0, 10),
    outcome_to_persist: args.outcome_to_persist,
  };
}

function extractFactsToReflect(rawInbound: string, max = 2): string[] {
  const raw = rawInbound.trim();
  if (!raw) return [];
  const parts = raw
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  if (parts.length >= 2) return parts.slice(0, max).map((s) => s.slice(0, 120));
  if (parts.length === 1) return [parts[0]!.slice(0, 120)];
  return [raw.slice(0, 120)];
}

export function mapTurnUnderstandingToInboundRouteContract(
  args: MapTurnUnderstandingToInboundRouteContractArgs
): InboundRouteContract {
  const raw = args.rawInbound.trim();
  const reconciled = args.reconciled;
  const commonForbidden = [
    "Do not ask a follow-up question when max_questions is 0.",
    "Do not give generic advice or a new assignment after a close-loop route.",
  ];

  if (detectWinCloseLoopBackstop(raw)) {
    const facts = extractFactsToReflect(raw);
    return buildPhase1RouteContract({
      route: "win_close_loop",
      source: "server_backstop",
      relationship_engagement: true,
      outcome: "win",
      answered_prior_ask: false,
      prior_ask_satisfied: false,
      should_persist: true,
      should_reply: true,
      close_loop: true,
      max_questions: 0,
      allow_new_assignment: false,
      allow_generic_advice: false,
      facts_to_reflect: facts,
      forbidden_moves: [
        ...commonForbidden,
        "Do not ask what got in the way.",
        "Do not ask for proof again.",
        "Warmly mark the win — do not flatly restate only.",
      ],
      outcome_to_persist: "win",
    });
  }

  if (
    detectProofAnswerCloseLoopBackstop({
      rawInbound: raw,
      openQuestionPending: args.openQuestionPending,
      latestOpenQuestion: args.latestOpenQuestion,
    })
  ) {
    const facts = extractFactsToReflect(raw);
    return buildPhase1RouteContract({
      route: "proof_answer_close_loop",
      source: "server_backstop",
      relationship_engagement: true,
      outcome: "proof",
      answered_prior_ask: true,
      prior_ask_satisfied: true,
      should_persist: true,
      should_reply: true,
      close_loop: true,
      max_questions: 0,
      allow_new_assignment: false,
      allow_generic_advice: false,
      facts_to_reflect: facts,
      forbidden_moves: [
        ...commonForbidden,
        "Do not re-ask the same gratitude or list question.",
        "Do not give vague future gratitude advice.",
        "Do not classify as reflective_share.",
      ],
      outcome_to_persist: "proof",
    });
  }

  if (
    detectPureAcknowledgmentCloser(raw, {
      openQuestionPending: args.openQuestionPending,
      latestOpenQuestion: args.latestOpenQuestion,
    })
  ) {
    return buildPhase1RouteContract({
      route: "acknowledgment_no_reply",
      source: "server_backstop",
      relationship_engagement: true,
      outcome: "none",
      answered_prior_ask: false,
      prior_ask_satisfied: false,
      should_persist: false,
      should_reply: false,
      close_loop: true,
      max_questions: 0,
      allow_new_assignment: false,
      allow_generic_advice: false,
      facts_to_reflect: [],
      forbidden_moves: [
        ...commonForbidden,
        "Do not treat thanks or okay as a help request.",
        "Do not send coaching advice on a pure closer.",
      ],
      outcome_to_persist: "none",
    });
  }

  const tuAuthoritative = isTurnUnderstandingAuthoritative(reconciled);
  const confidence = reconciled.confidence ?? 0;
  if (tuAuthoritative && confidence >= LOW_CONFIDENCE_THRESHOLD) {
    const intent = reconciled.reconciled_response_intent;
    const lastAsk = reconciled.last_ask_satisfied;
    if (
      intent === "close_loop_no_new_action" &&
      (detectPureAcknowledgmentCloser(raw, {
        openQuestionPending: args.openQuestionPending,
        latestOpenQuestion: args.latestOpenQuestion,
      }) ||
        raw.length <= 80)
    ) {
      return buildPhase1RouteContract({
        route: "acknowledgment_no_reply",
        source: "turn_understanding",
        relationship_engagement: true,
        outcome: "none",
        answered_prior_ask: false,
        prior_ask_satisfied: false,
        should_persist: false,
        should_reply: false,
        close_loop: true,
        max_questions: 0,
        allow_new_assignment: false,
        allow_generic_advice: false,
        facts_to_reflect: [],
        forbidden_moves: commonForbidden,
        outcome_to_persist: "none",
      });
    }
    if (
      intent === "acknowledge_completion" ||
      reconciled.reconciled_relationship_meaning === "reported_completion"
    ) {
      return buildPhase1RouteContract({
        route: "win_close_loop",
        source: "turn_understanding",
        relationship_engagement: true,
        outcome: "win",
        answered_prior_ask: false,
        prior_ask_satisfied: false,
        should_persist: reconciled.reconciled_persistence_decision === "write_user_yes_today",
        should_reply: true,
        close_loop: true,
        max_questions: 0,
        allow_new_assignment: false,
        allow_generic_advice: false,
        facts_to_reflect: extractFactsToReflect(raw),
        forbidden_moves: [
          ...commonForbidden,
          "Warmly mark the win and close.",
        ],
        outcome_to_persist: "win",
      });
    }
    if (
      (intent === "acknowledge_prior_ask_satisfied" || lastAsk === "yes") &&
      (args.openQuestionPending || reconciled.reconciled_do_not_repeat_asks.length > 0)
    ) {
      return buildPhase1RouteContract({
        route: "proof_answer_close_loop",
        source: "turn_understanding",
        relationship_engagement: true,
        outcome: "proof",
        answered_prior_ask: true,
        prior_ask_satisfied: true,
        should_persist:
          reconciled.reconciled_persistence_decision === "write_user_yes_today" ||
          reconciled.reconciled_persistence_decision === "write_user_partial",
        should_reply: true,
        close_loop: true,
        max_questions: 0,
        allow_new_assignment: false,
        allow_generic_advice: false,
        facts_to_reflect: extractFactsToReflect(raw),
        forbidden_moves: [
          ...commonForbidden,
          "Reflect one specific detail from their answer and close.",
        ],
        outcome_to_persist: "proof",
      });
    }
  }

  return buildPhase1RouteContract({
    route: "legacy_other",
    source: "none",
    relationship_engagement: raw.length > 0,
    outcome: "unclear",
    answered_prior_ask: reconciled.last_ask_satisfied === "yes",
    prior_ask_satisfied: reconciled.last_ask_satisfied === "yes",
    should_persist: false,
    should_reply: true,
    close_loop: false,
    max_questions: 1,
    allow_new_assignment: true,
    allow_generic_advice: true,
    facts_to_reflect: [],
    forbidden_moves: [],
    outcome_to_persist: "none",
  });
}

export function enrichReconciledWithInboundRouteContract(
  reconciled: ReconciledTurnUnderstanding,
  args: Omit<MapTurnUnderstandingToInboundRouteContractArgs, "reconciled">
): ReconciledTurnUnderstanding {
  return {
    ...reconciled,
    inbound_route_contract: mapTurnUnderstandingToInboundRouteContract({
      reconciled,
      ...args,
    }),
  };
}

export function buildInboundRouteAllowedClaims(args: {
  routeContract: InboundRouteContract | null | undefined;
  proofPersistedBeforeWriter?: boolean;
  proofPersistedEventType?: "user_yes" | "user_no" | "user_partial" | null;
}): InboundRouteAllowedClaims {
  const route = args.routeContract?.route ?? "legacy_other";
  const persisted =
    args.proofPersistedBeforeWriter === true &&
    (args.proofPersistedEventType === "user_yes" ||
      args.proofPersistedEventType === "user_partial");
  const winRoute = route === "win_close_loop";
  const proofRoute = route === "proof_answer_close_loop";
  const canWin = persisted && winRoute;
  const canProof = persisted && (winRoute || proofRoute);
  const canReferenceVictoryRoom = canWin || (persisted && proofRoute);
  return {
    can_claim_win: canWin,
    can_claim_miss: false,
    can_claim_partial: persisted && args.proofPersistedEventType === "user_partial",
    can_claim_proof: canProof,
    can_reference_victory_room: canReferenceVictoryRoom,
    can_claim_recorded: canReferenceVictoryRoom,
    can_claim_streak: false,
    can_claim_consistency: false,
    victory_room_language_mode: canReferenceVictoryRoom
      ? "recorded_allowed"
      : winRoute || proofRoute
        ? "metaphor_only"
        : "none",
  };
}

export type TurnUnderstandingPersistGuardMeta = {
  persistence_narrowed_by_turn_understanding: boolean;
  persistence_narrowed_from: string | null;
  persistence_narrowed_to: string | null;
  turn_understanding_persistence_guard_reason: string | null;
  turn_understanding_applied_to_persist?: boolean;
  turn_understanding_persist_skip_reason?: string | null;
};

export type RelationshipPacketTurnUnderstanding = {
  authority: "authoritative_current";
  relationship_meaning: TurnUnderstandingRelationshipMeaning;
  response_intent: TurnUnderstandingResponseIntent;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  satisfaction_kind: TurnUnderstandingSatisfactionKind;
  do_not_repeat_asks: string[];
  stale_ask_risk: boolean;
  evidence_quotes: string[];
  confidence: number;
  persistence_note: string;
};

const SATISFACTION_KINDS_BLOCKING_CLASSIFIER_YES = new Set<TurnUnderstandingSatisfactionKind>([
  "already_scheduled",
  "currently_happening",
  "plan_exists",
]);

/** Hard routes: interpreter must not be authoritative (skip live call). */
export function shouldSkipInboundTurnUnderstandingRoute(args: {
  routePurpose?: string | null;
  routePriority?: InboundMeaningRoutePriority;
}): boolean {
  const rp = args.routePurpose?.trim() ?? "";
  if (
    rp &&
    rp !== "normal_inbound_reply" &&
    rp !== "commitment_change_context_heuristic"
  ) {
    return true;
  }
  const pr = args.routePriority ?? {};
  if (
    pr.compliance_or_stop ||
    pr.crisis_or_safety ||
    pr.support_or_cancel ||
    pr.pending_resolution ||
    pr.contract_consent ||
    pr.relationship_exit ||
    pr.identity_edit ||
    pr.commitment_change_handoff
  ) {
    return true;
  }
  return false;
}

/** Explicit skip reason for observability when interpreter must not run. */
export function resolveInboundTurnUnderstandingSkipReason(args: {
  routePurpose?: string | null;
  routePriority?: InboundMeaningRoutePriority;
}): string | null {
  if (!shouldSkipInboundTurnUnderstandingRoute(args)) return null;
  const pr = args.routePriority ?? {};
  if (pr.compliance_or_stop) return "hard_route_compliance_or_stop";
  if (pr.crisis_or_safety) return "hard_route_crisis_or_safety";
  if (pr.support_or_cancel) return "hard_route_support_or_cancel";
  if (pr.pending_resolution) return "hard_route_pending_resolution";
  if (pr.contract_consent) return "hard_route_contract_consent";
  if (pr.relationship_exit) return "hard_route_relationship_exit";
  if (pr.identity_edit) return "hard_route_identity_edit";
  if (pr.commitment_change_handoff) return "hard_route_commitment_change_handoff";
  const rp = args.routePurpose?.trim() ?? "";
  if (
    rp &&
    rp !== "normal_inbound_reply" &&
    rp !== "commitment_change_context_heuristic"
  ) {
    return `hard_route_route_purpose_${rp}`;
  }
  return "hard_route_priority";
}

function truncateStore(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const RELATIONSHIP_MEANINGS = new Set<string>([
  "reported_completion",
  "miss",
  "partial_attempt",
  "blocker_detail",
  "plan_made",
  "already_scheduled_or_happening",
  "prior_ask_satisfied",
  "reported_metric_or_result",
  "goal_adjustment_request",
  "support_request",
  "emotional_reflection",
  "direct_answer",
  "unclear",
]);

const YES_NO_UNCLEAR = new Set(["yes", "no", "unclear"]);

const SATISFACTION_KINDS = new Set([
  "completed",
  "already_scheduled",
  "currently_happening",
  "plan_exists",
  "answered_no",
  "partial",
  "not_satisfied",
  "unclear",
]);

const OUTCOME_RECS = new Set([
  "write_user_yes_today",
  "write_user_no",
  "write_user_partial",
  "ack_only",
  "no_outcome_write",
  "unclear",
]);

const PERSISTENCE_SAFETY = new Set([
  "safe_to_write",
  "do_not_write_but_acknowledge",
  "defer_to_server",
]);

const RESPONSE_INTENTS = new Set([
  "acknowledge_completion",
  "acknowledge_prior_ask_satisfied",
  "tell_truth_and_recover",
  "identify_blocker",
  "reinforce_plan_without_proof",
  "clarify_goal_change",
  "answer_user_question",
  "acknowledge_result_and_next_standard",
  "ask_next_specific_step",
  "close_loop_no_new_action",
  "unclear_clarify",
]);

const TEMPORAL_SCOPES = new Set(["today", "yesterday", "past", "future", "unclear"]);

const ROUTE_RECS = new Set([
  "none",
  "support",
  "crisis",
  "compliance",
  "contract_consent",
  "pending_resolution",
  "commitment_change",
  "defer",
]);

const GOAL_ADJUSTMENT_TYPES = new Set<string>([
  "amend",
  "restate",
  "reset",
  "raise",
  "lower",
  "shrink",
  "replace",
  "new_goal",
  "blocker_focus",
  "unspecified",
  "none",
]);

const GOAL_CHANGE_SOURCES = new Set<string>([
  "user_requested",
  "consistency_signal",
  "recurring_blocker",
  "none",
]);

const GOAL_CHANGE_CONFIDENCE_LEVELS = new Set<string>(["low", "medium", "high"]);

const GOAL_CHANGE_AUTHORITATIVE_CONFIDENCE = new Set<TurnUnderstandingGoalChangeConfidenceLevel>([
  "medium",
  "high",
]);

function parseEnum<T extends string>(raw: unknown, allowed: Set<string>): T | null {
  return typeof raw === "string" && allowed.has(raw) ? (raw as T) : null;
}

function parseStringArray(raw: unknown, maxItems: number, maxLen: number): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    out.push(truncateStore(item, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

export function parseTurnUnderstandingGoalChangeIntent(
  raw: unknown
): TurnUnderstandingGoalChangeIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.detected !== "boolean") return null;

  const adjustment_type = parseEnum<TurnUnderstandingGoalAdjustmentType>(
    o.adjustment_type,
    GOAL_ADJUSTMENT_TYPES
  );
  const source = parseEnum<TurnUnderstandingGoalChangeSource>(o.source, GOAL_CHANGE_SOURCES);
  const confidence = parseEnum<TurnUnderstandingGoalChangeConfidenceLevel>(
    o.confidence,
    GOAL_CHANGE_CONFIDENCE_LEVELS
  );
  if (!adjustment_type || !source || !confidence) return null;

  const proposed_new_goal_text =
    typeof o.proposed_new_goal_text === "string" && o.proposed_new_goal_text.trim()
      ? truncateStore(o.proposed_new_goal_text, 200)
      : null;
  const evidence_quote =
    typeof o.evidence_quote === "string" && o.evidence_quote.trim()
      ? truncateStore(o.evidence_quote, 120)
      : null;

  return {
    detected: o.detected,
    adjustment_type,
    source,
    requires_confirmation: o.requires_confirmation !== false,
    proposed_new_goal_text,
    evidence_quote,
    confidence,
  };
}

/** Minimal server backstop when live interpreter failed — not a product brain. */
export function inferMinimalGoalChangeIntentFromInbound(
  rawInbound: string
): TurnUnderstandingGoalChangeIntent | null {
  const t = rawInbound.trim();
  if (!t || t.length < 8) return null;

  if (
    /\b(thinking\s+about\s+goals?\s+generally|goals?\s+in\s+general|just\s+thinking\s+about\s+goals?)\b/i.test(
      t
    )
  ) {
    return null;
  }

  if (isUserCompletedGoalWantsToMoveOnLanguage(t)) {
    return {
      detected: true,
      adjustment_type: /\b(reset|fresh start|clean slate)\b/i.test(t) ? "reset" : "replace",
      source: "user_requested",
      requires_confirmation: true,
      proposed_new_goal_text: null,
      evidence_quote: truncateStore(t.slice(0, 80), 120),
      confidence: "medium",
    };
  }

  let adjustment_type: TurnUnderstandingGoalAdjustmentType = "unspecified";
  if (/\b(amend|re-?state)\b.*\b(old\s+)?goals?\b/i.test(t) || /\bneed\s+to\s+amend\b/i.test(t)) {
    adjustment_type = /\bre-?state\b/i.test(t) ? "restate" : "amend";
  } else if (/\b(restate|re-state)\b.*\b(old\s+)?goals?\b/i.test(t)) {
    adjustment_type = "restate";
  } else if (/\breset\b.*\b(old\s+)?goals?\b/i.test(t) || /\breset\s+(the\s+)?goal\b/i.test(t)) {
    adjustment_type = "reset";
  } else if (/\b(too\s+easy|ready\s+for\s+more|raise\s+the\s+bar|every\s+day)\b/i.test(t)) {
    adjustment_type = "raise";
  } else if (/\b(too\s+hard|make\s+(this|it)\s+(smaller|easier)|can'?t\s+keep\s+up)\b/i.test(t)) {
    adjustment_type = /\b(smaller|easier|shrink)\b/i.test(t) ? "shrink" : "lower";
  } else if (/\b(no\s+longer\s+fits|different\s+goal|new\s+goal|replace\s+(the\s+)?goal)\b/i.test(t)) {
    adjustment_type = /\bnew\s+goal\b/i.test(t) ? "new_goal" : "replace";
  } else if (
    /\b(blocker|getting\s+in\s+the\s+way|stopping\s+me)\b/i.test(t) &&
    /\b(focus|target|goal|first)\b/i.test(t)
  ) {
    adjustment_type = "blocker_focus";
  } else if (
    /\b(change|adjust|revise|update|alter)\b.*\b(goal|goals|commitment|bar|standard)\b/i.test(t)
  ) {
    adjustment_type = "unspecified";
  } else {
    return null;
  }

  const evidenceMatch =
    t.match(
      /\b(yes[,.\s]+)?(we\s+)?need\s+to\s+(amend|re-?state)[^.!?]{0,60}/i
    )?.[0] ??
    t.match(/\b(amend|re-?state|reset|restate)[^.!?]{0,48}/i)?.[0] ??
    t.slice(0, 80);

  return {
    detected: true,
    adjustment_type,
    source: "user_requested",
    requires_confirmation: true,
    proposed_new_goal_text: null,
    evidence_quote: truncateStore(evidenceMatch, 120),
    confidence: "medium",
  };
}

export function isAuthoritativeReconciledGoalChangeIntent(
  intent: ReconciledGoalChangeIntent | null | undefined
): boolean {
  return Boolean(intent?.authoritative && intent.detected && intent.adjustment_type !== "none");
}

export function buildReconciledGoalChangeIntent(args: {
  proposalIntent: TurnUnderstandingGoalChangeIntent | null | undefined;
  relationshipMeaning: TurnUnderstandingRelationshipMeaning;
  overallConfidence: number;
  fromFailedSafeFallback?: boolean;
}): ReconciledGoalChangeIntent | null {
  const proposal = args.proposalIntent;
  const meaningSignalsGoalChange = args.relationshipMeaning === "goal_adjustment_request";

  const detected =
    proposal?.detected === true ||
    (meaningSignalsGoalChange && args.overallConfidence >= LOW_CONFIDENCE_THRESHOLD);

  if (!detected) return null;

  const adjustment_type =
    proposal?.adjustment_type && proposal.adjustment_type !== "none"
      ? proposal.adjustment_type
      : meaningSignalsGoalChange
        ? "unspecified"
        : "none";

  if (adjustment_type === "none") return null;

  const goalConfidence =
    proposal?.confidence ??
    (args.overallConfidence >= 0.75
      ? "high"
      : args.overallConfidence >= LOW_CONFIDENCE_THRESHOLD
        ? "medium"
        : "low");

  const authoritative =
    GOAL_CHANGE_AUTHORITATIVE_CONFIDENCE.has(goalConfidence) &&
    (args.overallConfidence >= LOW_CONFIDENCE_THRESHOLD ||
      proposal?.detected === true ||
      args.fromFailedSafeFallback === true);

  if (!authoritative) {
    return {
      authoritative: false,
      detected: true,
      adjustment_type,
      source: proposal?.source ?? "user_requested",
      requires_confirmation: true,
      proposed_new_goal_text: proposal?.proposed_new_goal_text ?? null,
      evidence_quote: proposal?.evidence_quote ?? null,
      confidence: goalConfidence,
      goal_change_not_outcome_write: true,
      goal_change_no_state_mutation_without_confirmation: true,
    };
  }

  return {
    authoritative: true,
    detected: true,
    adjustment_type,
    source: proposal?.source ?? (meaningSignalsGoalChange ? "user_requested" : "none"),
    requires_confirmation: proposal?.requires_confirmation !== false,
    proposed_new_goal_text: proposal?.proposed_new_goal_text ?? null,
    evidence_quote: proposal?.evidence_quote ?? null,
    confidence: goalConfidence,
    goal_change_not_outcome_write: true,
    goal_change_no_state_mutation_without_confirmation: true,
  };
}

export function buildGoalChangeIntentTelemetry(
  intent: ReconciledGoalChangeIntent | null | undefined,
  pendingMeta?: {
    pendingResolutionCreated?: boolean;
    pendingKind?: string | null;
    pendingSkipReason?: string | null;
    handoffOpened?: boolean;
  } | null
): Record<string, unknown> {
  if (!intent?.detected) {
    return { goal_change_intent_detected: false };
  }
  return {
    goal_change_intent_detected: true,
    goal_change_authoritative: intent.authoritative,
    goal_change_type: intent.adjustment_type,
    goal_change_source: intent.source,
    goal_change_confidence: intent.confidence,
    goal_change_requires_confirmation: intent.requires_confirmation,
    goal_change_proposed_text: intent.proposed_new_goal_text,
    goal_change_proposed_new_goal_text_present: Boolean(intent.proposed_new_goal_text?.trim()),
    goal_change_evidence_quote: intent.evidence_quote,
    goal_change_not_outcome_write: intent.goal_change_not_outcome_write,
    goal_change_no_state_mutation_without_confirmation:
      intent.goal_change_no_state_mutation_without_confirmation,
    goal_change_routed_to_existing_handoff:
      pendingMeta?.handoffOpened ?? pendingMeta?.pendingResolutionCreated ?? intent.authoritative,
    goal_change_pending_resolution_created: pendingMeta?.pendingResolutionCreated === true,
    goal_change_pending_kind: pendingMeta?.pendingKind ?? null,
    goal_change_pending_skip_reason: pendingMeta?.pendingSkipReason ?? null,
  };
}

export function parseOpenAIRelationshipTurnUnderstandingV1(
  raw: Record<string, unknown>
): OpenAIRelationshipTurnUnderstandingV1 | null {
  if (raw.version !== OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION) return null;

  const user_turn_summary =
    typeof raw.user_turn_summary === "string" ? truncateStore(raw.user_turn_summary, 400) : "";
  if (user_turn_summary.length < 3) return null;

  const evidenceRaw = parseStringArray(raw.evidence_quotes, MAX_EVIDENCE_QUOTES, 120);
  if (evidenceRaw == null) return null;

  const relationship_meaning = parseEnum<TurnUnderstandingRelationshipMeaning>(
    raw.relationship_meaning,
    RELATIONSHIP_MEANINGS
  );
  const answered_last_coach_ask = parseEnum<TurnUnderstandingAnsweredLastCoachAsk>(
    raw.answered_last_coach_ask,
    YES_NO_UNCLEAR
  );
  const last_ask_satisfied = parseEnum<TurnUnderstandingAnsweredLastCoachAsk>(
    raw.last_ask_satisfied,
    YES_NO_UNCLEAR
  );
  const satisfaction_kind = parseEnum<TurnUnderstandingSatisfactionKind>(
    raw.satisfaction_kind,
    SATISFACTION_KINDS
  );
  const response_intent = parseEnum<TurnUnderstandingResponseIntent>(
    raw.response_intent,
    RESPONSE_INTENTS
  );
  const commitment_outcome_recommendation =
    parseEnum<TurnUnderstandingCommitmentOutcomeRecommendation>(
      raw.commitment_outcome_recommendation,
      OUTCOME_RECS
    );
  const persistence_safety = parseEnum<TurnUnderstandingPersistenceSafety>(
    raw.persistence_safety,
    PERSISTENCE_SAFETY
  );
  const temporal_scope = parseEnum<TurnUnderstandingTemporalScope>(
    raw.temporal_scope,
    TEMPORAL_SCOPES
  );
  const route_priority_recommendation = parseEnum<TurnUnderstandingRoutePriorityRecommendation>(
    raw.route_priority_recommendation,
    ROUTE_RECS
  );

  if (
    !relationship_meaning ||
    !answered_last_coach_ask ||
    !last_ask_satisfied ||
    !satisfaction_kind ||
    !response_intent ||
    !commitment_outcome_recommendation ||
    !persistence_safety ||
    !temporal_scope ||
    !route_priority_recommendation
  ) {
    return null;
  }

  if (
    typeof raw.confidence !== "number" ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  ) {
    return null;
  }
  const confidence = raw.confidence;

  if (typeof raw.stale_ask_risk !== "boolean") return null;

  const doNotRaw = parseStringArray(raw.do_not_repeat_asks, MAX_DO_NOT_REPEAT, 160);
  if (doNotRaw == null) return null;

  const uncertainty_flags =
    parseStringArray(raw.uncertainty_flags, 8, 80) ?? [];
  const safety_or_support_flags =
    parseStringArray(raw.safety_or_support_flags, 6, 80) ?? [];

  const reported_for_day_key =
    typeof raw.reported_for_day_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.reported_for_day_key.trim())
      ? raw.reported_for_day_key.trim()
      : null;

  const goal_change_intent =
    raw.goal_change_intent != null
      ? parseTurnUnderstandingGoalChangeIntent(raw.goal_change_intent)
      : undefined;

  return {
    version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    user_turn_summary,
    evidence_quotes: evidenceRaw,
    relationship_meaning,
    answered_last_coach_ask,
    last_ask_satisfied,
    satisfaction_kind,
    do_not_repeat_asks: doNotRaw,
    stale_ask_risk: raw.stale_ask_risk,
    commitment_outcome_recommendation,
    persistence_safety,
    response_intent,
    temporal_scope,
    reported_for_day_key,
    confidence,
    uncertainty_flags,
    route_priority_recommendation,
    safety_or_support_flags,
    ...(goal_change_intent != null ? { goal_change_intent } : {}),
  };
}

export type BuildTurnUnderstandingPromptArgs = {
  inboundBody: string;
  lastCoachOutbound: string | null;
  latestOpenQuestion: string | null;
  latestAnswerAfterOpenQuestion: string | null;
  openQuestionPending: boolean;
  expectedReplySemantics: string | null;
  effectiveAsk: string;
  behaviorStatement: string;
  recentThreadExcerpt: string;
  routePurpose: string | null;
  routePriority: InboundMeaningRoutePriority;
  temporalContract: TemporalContractV1 | null;
  proofCalloutClaimSavedAllowed: boolean;
  deterministicMeaning: InboundMeaningFacts;
  classifierEventType: V2InboundEventType;
};

export function buildTurnUnderstandingUserPrompt(args: BuildTurnUnderstandingPromptArgs): string {
  const lines: string[] = [
    "Interpret the user's latest inbound SMS for relationship turn understanding (shadow advisory — not final SMS).",
    "",
    "OUTPUT: Return ONLY valid JSON matching OpenAIRelationshipTurnUnderstandingV1:",
    `{"version":"${OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION}","user_turn_summary":"...","evidence_quotes":["..."],"relationship_meaning":"...","answered_last_coach_ask":"yes|no|unclear","last_ask_satisfied":"yes|no|unclear","satisfaction_kind":"...","do_not_repeat_asks":["..."],"stale_ask_risk":false,"commitment_outcome_recommendation":"...","persistence_safety":"...","response_intent":"...","temporal_scope":"...","reported_for_day_key":null,"confidence":0.0,"uncertainty_flags":[],"route_priority_recommendation":"none","safety_or_support_flags":[],"goal_change_intent":{"detected":false,"adjustment_type":"none","source":"none","requires_confirmation":true,"proposed_new_goal_text":null,"evidence_quote":null,"confidence":"low"}}`,
    "",
    "RULES:",
    "- Propose meaning only. Do NOT write coach SMS.",
    "- Distinguish what the coach should acknowledge vs what the server may persist as proof/outcome.",
    "- Plans, already-scheduled, or currently-happening family/time can satisfy the prior coach ask without being proof.",
    "- If the user already answered or satisfied the last coach ask, set last_ask_satisfied yes and list normalized do_not_repeat_asks (coach question phrases to avoid repeating).",
    "- Do NOT infer proof saved or Victory Room unless explicitly allowed below.",
    "- If support/crisis/compliance, set route_priority_recommendation and safety_or_support_flags; persistence_safety defer_to_server.",
    "- If uncertain, confidence < 0.55 and response_intent unclear_clarify.",
    "- evidence_quotes: at most 2 short spans from inbound only.",
    "- do_not_repeat_asks: at most 6 short normalized phrases.",
    "",
    "GOAL-CHANGE / GOAL-ADJUSTMENT (goal_change_intent — advisory only; server confirms before any mutation):",
    "- Infer from natural language, not exact keywords. Examples (non-exhaustive): amend/re-state/reset old goals; goal too easy/hard; make it smaller; ready for more; goal no longer fits; user completed the current goal and wants to move on to a new daily bar.",
    "- Distinguish talking about goals in general (detected false) vs asking to change/adjust/restate/replace the current commitment.",
    "- When goal_change_intent.detected is true: relationship_meaning should be goal_adjustment_request; commitment_outcome_recommendation must be no_outcome_write; persistence_safety must NOT be safe_to_write for user_yes/user_no/user_partial.",
    "- Goal-change is NEVER user_yes, user_no, or user_partial proof — even if the message starts with yes.",
    "- requires_confirmation is always true when detected. proposed_new_goal_text only when user gave a concrete new bar.",
    "- adjustment_type: amend|restate|reset|raise|lower|shrink|replace|new_goal|blocker_focus|unspecified|none.",
    "- source: user_requested unless coach-side consistency/blocker signals are explicit in thread.",
    "- route_priority_recommendation commitment_change or pending_resolution when detected with medium/high goal_change_intent.confidence.",
    "",
    `proof_callout_claim_saved_allowed: ${args.proofCalloutClaimSavedAllowed}`,
    `deterministic_relationship_meaning: ${args.deterministicMeaning.relationship_meaning}`,
    `deterministic_persistence_decision: ${args.deterministicMeaning.persistence_decision}`,
    `deterministic_sms_response_intent: ${args.deterministicMeaning.sms_response_intent}`,
    `classifier_event_type: ${args.classifierEventType}`,
    `route_purpose: ${args.routePurpose ?? "normal_inbound_reply"}`,
    `route_priority: ${JSON.stringify(args.routePriority)}`,
    "",
    `latest_inbound: ${truncateStore(args.inboundBody, 900)}`,
    `last_coach_outbound: ${truncateStore(args.lastCoachOutbound ?? "", 500)}`,
    `latest_open_question: ${truncateStore(args.latestOpenQuestion ?? "", 280)}`,
    `latest_answer_after_open_question: ${truncateStore(args.latestAnswerAfterOpenQuestion ?? "", 220)}`,
    `open_question_pending: ${args.openQuestionPending}`,
    `expected_reply_semantics: ${args.expectedReplySemantics ?? "unknown"}`,
    `effective_ask: ${truncateStore(args.effectiveAsk, 220)}`,
    `behavior_statement: ${truncateStore(args.behaviorStatement, 220)}`,
  ];
  if (args.temporalContract) {
    lines.push(`temporal_contract: ${JSON.stringify(args.temporalContract).slice(0, 1200)}`);
  }
  if (args.recentThreadExcerpt.trim()) {
    lines.push("", "recent_thread_excerpt:", args.recentThreadExcerpt.trim().slice(0, 2200));
  }
  return lines.join("\n");
}

const TURN_UNDERSTANDING_SYSTEM_PROMPT = `You interpret inbound SMS for a long-term coaching relationship.
Return strict JSON only. Never write the coach's reply text.
Goal-change intent is advisory only — never treat it as proof or permission to mutate the commitment.`;

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export type CallTurnUnderstandingOpenAIResult =
  | { ok: true; proposal: OpenAIRelationshipTurnUnderstandingV1; model: string; latencyMs: number }
  | {
      ok: false;
      reason: string;
      model: string | null;
      latencyMs: number;
      diagnostics: TurnUnderstandingFailureDiagnostics;
    };

const TU_SECRET_SCRUB_RE =
  /\b(sk-[a-zA-Z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|api[_-]?key\s*[:=]\s*\S+)/gi;

export function scrubTurnUnderstandingErrorMessage(raw: string, maxLen = 120): string {
  const scrubbed = raw.replace(TU_SECRET_SCRUB_RE, "[redacted]").replace(/\s+/g, " ").trim();
  if (scrubbed.length <= maxLen) return scrubbed;
  return `${scrubbed.slice(0, maxLen - 1).trimEnd()}…`;
}

function extractOpenAiSdkDiagnostics(err: unknown): {
  message: string;
  status: number | string | null;
  type: string | null;
} {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown_error";
  const anyErr = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    type?: unknown;
    error?: { type?: unknown; code?: unknown; message?: unknown };
    name?: unknown;
  } | null;
  const status =
    typeof anyErr?.status === "number" || typeof anyErr?.status === "string"
      ? anyErr.status
      : typeof anyErr?.statusCode === "number" || typeof anyErr?.statusCode === "string"
        ? anyErr.statusCode
        : null;
  const type =
    (typeof anyErr?.error?.type === "string" && anyErr.error.type) ||
    (typeof anyErr?.type === "string" && anyErr.type) ||
    (typeof anyErr?.code === "string" && anyErr.code) ||
    (typeof anyErr?.name === "string" && anyErr.name) ||
    null;
  return { message, status, type };
}

function buildTurnUnderstandingFailureDiagnostics(args: {
  reason: string;
  latencyMs: number;
  errorMessage?: string | null;
  rawPreview?: string | null;
  sdkStatus?: number | string | null;
  sdkType?: string | null;
}): TurnUnderstandingFailureDiagnostics {
  const short =
    args.errorMessage && args.errorMessage.trim()
      ? scrubTurnUnderstandingErrorMessage(args.errorMessage, 120)
      : null;
  const rawPreview =
    args.reason === "schema_validation_failed" && args.rawPreview
      ? scrubTurnUnderstandingErrorMessage(args.rawPreview, 200)
      : undefined;
  return {
    tu_error_code: args.reason,
    tu_error_message_short: short,
    tu_latency_ms: args.latencyMs,
    ...(rawPreview !== undefined ? { tu_raw_preview: rawPreview } : {}),
    ...(args.sdkStatus != null ? { tu_sdk_status: args.sdkStatus } : {}),
    ...(args.sdkType ? { tu_sdk_type: args.sdkType } : {}),
  };
}

export async function callOpenAIRelationshipTurnUnderstandingV1(
  promptArgs: BuildTurnUnderstandingPromptArgs
): Promise<CallTurnUnderstandingOpenAIResult> {
  const started = Date.now();
  const model = TURN_UNDERSTANDING_OPENAI_MODEL;
  const client = getOpenAIClientOrNull();
  if (!client) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      reason: "no_openai_key",
      model: null,
      latencyMs,
      diagnostics: buildTurnUnderstandingFailureDiagnostics({
        reason: "no_openai_key",
        latencyMs,
        errorMessage: "OPENAI_API_KEY missing",
      }),
    };
  }

  const userPrompt = buildTurnUnderstandingUserPrompt(promptArgs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<OpenAIRelationshipTurnUnderstandingV1>({
      client,
      model,
      temperature: 0.25,
      maxTokens: 680,
      primaryMessages: [
        { role: "system", content: TURN_UNDERSTANDING_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      jsonSchemaReminder: `version must be "${OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION}" with all required enum fields.`,
      signal: controller.signal,
      allowRetry: false,
      parse: (raw) => {
        try {
          return parseOpenAIRelationshipTurnUnderstandingV1(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          return null;
        }
      },
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - started;

    if (!jsonOut.value) {
      return {
        ok: false,
        reason: "schema_validation_failed",
        model,
        latencyMs,
        diagnostics: buildTurnUnderstandingFailureDiagnostics({
          reason: "schema_validation_failed",
          latencyMs,
          errorMessage: "turn understanding JSON failed schema validation",
          rawPreview: jsonOut.retryMeta.original_raw_preview || jsonOut.raw,
        }),
      };
    }

    return {
      ok: true,
      proposal: jsonOut.value,
      model,
      latencyMs,
    };
  } catch (e) {
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const sdk = extractOpenAiSdkDiagnostics(e);
    const reason = sdk.message.toLowerCase().includes("abort")
      ? "openai_timeout"
      : "openai_request_failed";
    return {
      ok: false,
      reason,
      model,
      latencyMs,
      diagnostics: buildTurnUnderstandingFailureDiagnostics({
        reason,
        latencyMs,
        errorMessage: sdk.message,
        sdkStatus: sdk.status,
        sdkType: sdk.type,
      }),
    };
  }
}

function mapProposalOutcomeToPersistence(
  rec: TurnUnderstandingCommitmentOutcomeRecommendation
): InboundPersistenceDecision {
  switch (rec) {
    case "write_user_yes_today":
      return "write_user_yes_today";
    case "write_user_no":
      return "write_user_no";
    case "write_user_partial":
      return "write_user_partial";
    case "ack_only":
      return "ack_only";
    case "no_outcome_write":
      return "no_outcome_write";
    default:
      return "no_outcome_write";
  }
}

function serverAllowsPersistenceWrite(
  decision: InboundPersistenceDecision,
  deterministicMeaning: InboundMeaningFacts
): boolean {
  if (decision === "write_user_yes_today") {
    return shouldPromoteClarifyForReportedCompletionPersist({ inboundMeaning: deterministicMeaning });
  }
  if (decision === "write_user_no" || decision === "write_user_partial") {
    return (
      deterministicMeaning.relationship_meaning === "miss" ||
      deterministicMeaning.relationship_meaning === "partial_attempt" ||
      deterministicMeaning.persistence_decision === decision
    );
  }
  return false;
}

export type ReconcileTurnUnderstandingArgs = {
  proposal: OpenAIRelationshipTurnUnderstandingV1 | null;
  deterministicMeaning: InboundMeaningFacts;
  routePriority?: InboundMeaningRoutePriority;
  latestCoachQuestion?: string | null;
  interpreterFailedReason?: string | null;
  inboundBody?: string | null;
  failureDiagnostics?: TurnUnderstandingFailureDiagnostics | null;
};

function hardRoutePriorityOverridesProposal(routePriority?: InboundMeaningRoutePriority): boolean {
  const pr = routePriority ?? {};
  return Boolean(
    pr.compliance_or_stop ||
    pr.crisis_or_safety ||
    pr.support_or_cancel ||
    pr.pending_resolution ||
    pr.contract_consent
  );
}

export function isTurnUnderstandingAuthoritative(
  tu: ReconciledTurnUnderstanding | null | undefined
): boolean {
  if (!tu) return false;
  if (tu.turn_understanding_failed_safe_fallback) return true;
  return !tu.interpreter_failed_reason;
}

const TU_INTENTS_OVERRIDING_OPEN_QUESTION_FACTS: ReadonlySet<TurnUnderstandingResponseIntent> =
  new Set([
    "acknowledge_prior_ask_satisfied",
    "close_loop_no_new_action",
    "acknowledge_result_and_next_standard",
    "unclear_clarify",
  ]);

/** When true, reconciled TU coaching move wins over open_question_facts. */
export function reconciledTurnUnderstandingOverridesOpenQuestionFacts(
  tu: ReconciledTurnUnderstanding | null | undefined
): boolean {
  if (!isTurnUnderstandingAuthoritative(tu) || !tu) return false;
  if (tu.last_ask_satisfied === "yes") return true;
  if (tu.stale_ask_risk) return true;
  if (tu.reconciled_do_not_repeat_asks.length > 0) return true;
  return TU_INTENTS_OVERRIDING_OPEN_QUESTION_FACTS.has(tu.reconciled_response_intent);
}

export function isSubstantiveInboundForFailedSafe(raw: string): boolean {
  const t = raw.trim();
  if (t.length >= 24) return true;
  if (/\b(family|slept|hours|minutes|visiting|tomorrow|ohio|plans|calendar)\b/i.test(t)) {
    return true;
  }
  return !/^(yes|y|yeah|yep|yup|no|n|nope|ok|okay|sure)\.?$/i.test(t);
}

/** Strong completion for persist on interpreter failure — excludes bare/contextual yes. */
export function isStrongServerOutcomeForFailedSafePersist(
  raw: string,
  classifierEventType: V2InboundEventType
): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (
    looksLikeStaleGoalOrContextCorrection(t) ||
    looksLikeCoachContextCorrectionOrMetaDispute(t)
  ) {
    return false;
  }

  if (classifierEventType === "user_partial") {
    return inboundHasExplicitPartialClause(t);
  }

  if (classifierEventType === "user_no") {
    // Humble: only obvious self-contained accountability miss clauses — never leading "No," alone.
    return inboundHasExplicitAccountabilityMissClause(t);
  }

  if (classifierEventType !== "user_yes") return false;
  if (/^(yes|y|yeah|yep|yup|sure|ok|okay)\.?$/i.test(t)) return false;
  if (inboundHasExplicitCompletionClause(t)) return true;

  for (const clause of splitInboundClauses(t)) {
    const c = clause.trim();
    if (!c) continue;
    if (/\b(i\s+)?did\s+it\b/i.test(c) && !/\b(did not|didn't|almost|wish)\b/i.test(c)) {
      return true;
    }
    if (/\b(got\s+it\s+done|finished\s+it|completed\s+it|knocked\s+it\s+out)\b/i.test(c)) {
      return true;
    }
    if (/\bi\s+did\s+it\s+today\b/i.test(c)) return true;
    if (/\b(got\s+my\s+[^.!?]{2,48}\s+in\s+today)\b/i.test(c)) return true;
    if (inboundSignalsCompletion(c) && /\b(today|this morning|tonight)\b/i.test(c)) return true;
    if (isReportedCompletionRelationshipCandidate(c) && inboundSignalsCompletion(c)) return true;
  }

  if (
    isSubstantiveInboundForFailedSafe(t) &&
    !/\b(did it|done|finished|got it done|completed|knocked it out|i did it today)\b/i.test(t)
  ) {
    return false;
  }
  if (/\b(i\s+)?did\s+it\b/i.test(t) && !/\b(did not|didn't|almost|wish)\b/i.test(t)) {
    return true;
  }
  if (/\b(got\s+it\s+done|finished\s+it|completed\s+it|knocked\s+it\s+out)\b/i.test(t)) {
    return true;
  }
  if (/\bi\s+did\s+it\s+today\b/i.test(t)) return true;
  if (inboundSignalsCompletion(t) && /\b(today|this morning|tonight)\b/i.test(t)) return true;
  if (isReportedCompletionRelationshipCandidate(t) && inboundSignalsCompletion(t)) return true;
  return false;
}

export function resolveFailedSafePersistenceDecision(args: {
  deterministicMeaning: InboundMeaningFacts;
  rawInbound: string;
  classifierEventType: V2InboundEventType;
}): InboundPersistenceDecision {
  const det = args.deterministicMeaning.persistence_decision;
  const raw = args.rawInbound.trim();

  if (
    looksLikeStaleGoalOrContextCorrection(raw) ||
    looksLikeCoachContextCorrectionOrMetaDispute(raw)
  ) {
    return "no_outcome_write";
  }

  if (args.classifierEventType === "user_no" && isStrongServerOutcomeForFailedSafePersist(raw, "user_no")) {
    return "write_user_no";
  }
  if (
    args.classifierEventType === "user_partial" &&
    isStrongServerOutcomeForFailedSafePersist(raw, "user_partial")
  ) {
    return "write_user_partial";
  }
  if (
    isStrongServerOutcomeForFailedSafePersist(raw, args.classifierEventType) &&
    (det === "write_user_yes_today" || args.classifierEventType === "user_yes")
  ) {
    return "write_user_yes_today";
  }

  // Also allow obvious miss/partial when deterministic meaning already decided that way,
  // even if classifier event type drifted (e.g. miss classified as user_partial).
  if (det === "write_user_no" && inboundHasExplicitAccountabilityMissClause(raw)) {
    return "write_user_no";
  }
  if (det === "write_user_partial" && inboundHasExplicitPartialClause(raw)) {
    return "write_user_partial";
  }
  if (det === "write_user_yes_today" && isStrongServerOutcomeForFailedSafePersist(raw, "user_yes")) {
    return "write_user_yes_today";
  }

  // Humble: never passthrough write_user_no / write_user_partial without obvious self-contained language.
  if (det === "write_user_yes_today" && !isStrongServerOutcomeForFailedSafePersist(raw, "user_yes")) {
    return "no_outcome_write";
  }
  if (det === "ack_only") return "ack_only";
  return "no_outcome_write";
}

function applyAuthoritativeGoalChangeToReconciledFields(args: {
  reconciled_relationship_meaning: TurnUnderstandingRelationshipMeaning;
  reconciled_response_intent: TurnUnderstandingResponseIntent;
  reconciled_persistence_decision: InboundPersistenceDecision;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  reconciled_goal_change_intent: ReconciledGoalChangeIntent;
  disagreement_flags: string[];
}): {
  reconciled_relationship_meaning: TurnUnderstandingRelationshipMeaning;
  reconciled_response_intent: TurnUnderstandingResponseIntent;
  reconciled_persistence_decision: InboundPersistenceDecision;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  disagreement_flags: string[];
} {
  const flags = [...args.disagreement_flags, "goal_change_not_outcome_write"];
  let response_intent = args.reconciled_response_intent;
  if (
    args.reconciled_goal_change_intent.authoritative &&
    (response_intent === "ask_next_specific_step" ||
      response_intent === "unclear_clarify" ||
      response_intent === "acknowledge_completion")
  ) {
    response_intent = "clarify_goal_change";
    flags.push("goal_change_intent_coaching_move");
  }
  if (
    args.last_ask_satisfied === "yes" &&
    args.reconciled_goal_change_intent.authoritative
  ) {
    response_intent = "clarify_goal_change";
    flags.push("goal_change_prior_ask_satisfied_bridge");
  }
  return {
    reconciled_relationship_meaning: "goal_adjustment_request",
    reconciled_response_intent: response_intent,
    reconciled_persistence_decision: "no_outcome_write",
    last_ask_satisfied: args.last_ask_satisfied,
    disagreement_flags: flags,
  };
}

function finalizeReconciledGoalChange(args: {
  proposal: OpenAIRelationshipTurnUnderstandingV1 | null;
  reconciled_relationship_meaning: TurnUnderstandingRelationshipMeaning;
  reconciled_response_intent: TurnUnderstandingResponseIntent;
  reconciled_persistence_decision: InboundPersistenceDecision;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  confidence: number;
  disagreement_flags: string[];
  rawInboundForFallback?: string | null;
  fromFailedSafeFallback?: boolean;
}): {
  reconciled_relationship_meaning: TurnUnderstandingRelationshipMeaning;
  reconciled_response_intent: TurnUnderstandingResponseIntent;
  reconciled_persistence_decision: InboundPersistenceDecision;
  last_ask_satisfied: TurnUnderstandingAnsweredLastCoachAsk;
  reconciled_goal_change_intent: ReconciledGoalChangeIntent | null;
  disagreement_flags: string[];
} {
  let proposalIntent = args.proposal?.goal_change_intent ?? null;
  if (!proposalIntent?.detected && args.rawInboundForFallback) {
    proposalIntent = inferMinimalGoalChangeIntentFromInbound(args.rawInboundForFallback);
  }

  const reconciled_goal_change_intent = buildReconciledGoalChangeIntent({
    proposalIntent,
    relationshipMeaning: args.reconciled_relationship_meaning,
    overallConfidence: args.confidence,
    fromFailedSafeFallback: args.fromFailedSafeFallback,
  });

  if (!isAuthoritativeReconciledGoalChangeIntent(reconciled_goal_change_intent)) {
    return {
      reconciled_relationship_meaning: args.reconciled_relationship_meaning,
      reconciled_response_intent: args.reconciled_response_intent,
      reconciled_persistence_decision: args.reconciled_persistence_decision,
      last_ask_satisfied: args.last_ask_satisfied,
      reconciled_goal_change_intent,
      disagreement_flags: args.disagreement_flags,
    };
  }

  const applied = applyAuthoritativeGoalChangeToReconciledFields({
    reconciled_relationship_meaning: args.reconciled_relationship_meaning,
    reconciled_response_intent: args.reconciled_response_intent,
    reconciled_persistence_decision: args.reconciled_persistence_decision,
    last_ask_satisfied: args.last_ask_satisfied,
    reconciled_goal_change_intent: reconciled_goal_change_intent!,
    disagreement_flags: args.disagreement_flags,
  });

  return {
    ...applied,
    reconciled_goal_change_intent: reconciled_goal_change_intent!,
  };
}

export function buildInterpreterFailedSafeReconciled(args: {
  interpreterFailedReason: string;
  proposal: OpenAIRelationshipTurnUnderstandingV1 | null;
  deterministicMeaning: InboundMeaningFacts;
  latestCoachQuestion?: string | null;
  openQuestionPending?: boolean;
  rawInbound: string;
  classifierEventType: V2InboundEventType;
  failureDiagnostics?: TurnUnderstandingFailureDiagnostics | null;
}): ReconciledTurnUnderstanding {
  const coachQ = args.latestCoachQuestion?.trim() ?? "";
  const substantive = isSubstantiveInboundForFailedSafe(args.rawInbound);
  const stale_ask_risk =
    substantive && (coachQ.length >= 12 || args.openQuestionPending === true);
  const do_not_repeat_asks =
    coachQ.length >= 12 ? [coachQ.slice(0, 160)] : [];
  const correctionLanguage =
    looksLikeStaleGoalOrContextCorrection(args.rawInbound) ||
    looksLikeCoachContextCorrectionOrMetaDispute(args.rawInbound);
  const reconciled_persistence_decision = resolveFailedSafePersistenceDecision({
    deterministicMeaning: args.deterministicMeaning,
    rawInbound: args.rawInbound,
    classifierEventType: args.classifierEventType,
  });

  const hasCompletionClause = inboundHasExplicitCompletionClause(args.rawInbound);
  const hasPlanClause = inboundHasPlanConfirmationClause(args.rawInbound);
  let reconciled_response_intent: TurnUnderstandingResponseIntent = "unclear_clarify";
  if (hasCompletionClause && reconciled_persistence_decision === "write_user_yes_today") {
    reconciled_response_intent = hasPlanClause
      ? "acknowledge_result_and_next_standard"
      : "acknowledge_completion";
  } else if (
    args.deterministicMeaning.relationship_meaning === "answer_to_prior_question" ||
    hasPlanClause
  ) {
    reconciled_response_intent = "answer_user_question";
  } else if (
    args.deterministicMeaning.relationship_meaning === "miss" &&
    reconciled_persistence_decision === "write_user_no"
  ) {
    reconciled_response_intent = "tell_truth_and_recover";
  }

  const baseMeaning = hasCompletionClause
    ? "reported_completion"
    : mapDeterministicToTurnMeaning(args.deterministicMeaning.relationship_meaning);

  const finalized = finalizeReconciledGoalChange({
    proposal: args.proposal,
    reconciled_relationship_meaning: baseMeaning,
    reconciled_response_intent,
    reconciled_persistence_decision,
    last_ask_satisfied: "unclear",
    confidence: 0.35,
    disagreement_flags: ["interpreter_failed_safe_fallback"],
    rawInboundForFallback: args.rawInbound,
    fromFailedSafeFallback: true,
  });

  return {
    proposal: args.proposal,
    reconciled_relationship_meaning: finalized.reconciled_relationship_meaning,
    reconciled_response_intent: finalized.reconciled_response_intent,
    reconciled_persistence_decision: finalized.reconciled_persistence_decision,
    reconciled_do_not_repeat_asks: do_not_repeat_asks,
    last_ask_satisfied: finalized.last_ask_satisfied,
    satisfaction_kind: "unclear",
    stale_ask_risk,
    confidence: 0.35,
    disagreement_flags: finalized.disagreement_flags,
    interpreter_failed_reason: args.interpreterFailedReason,
    stale_ask_avoided: stale_ask_risk && do_not_repeat_asks.length > 0,
    persistence_note:
      "server failed-safe fallback: clarify without repeating prior ask; persistence only on strong clear outcomes",
    turn_understanding_failed_safe_fallback: true,
    turn_understanding_failed_safe_reason: args.interpreterFailedReason,
    turn_understanding_failed_safe_do_not_repeat_asks: do_not_repeat_asks,
    turn_understanding_failure_diagnostics: args.failureDiagnostics ?? null,
    reconciled_goal_change_intent: finalized.reconciled_goal_change_intent,
    ...(correctionLanguage && finalized.reconciled_persistence_decision === "no_outcome_write"
      ? {
          correction_language_detected: true,
          blocked_outcome_reason: "goal_or_context_correction",
        }
      : {}),
  };
}

export function reconcileTurnUnderstanding(
  args: ReconcileTurnUnderstandingArgs
): ReconciledTurnUnderstanding {
  const det = args.deterministicMeaning;
  const failed = args.interpreterFailedReason?.trim() || null;
  const disagreement_flags: string[] = [];
  const coachQ = args.latestCoachQuestion?.trim() ?? "";

  if (hardRoutePriorityOverridesProposal(args.routePriority) && args.proposal) {
    const fallbackDnr = coachQ.length >= 12 ? [coachQ.slice(0, 160)] : [];
    return {
      proposal: args.proposal,
      reconciled_relationship_meaning: mapDeterministicToTurnMeaning(det.relationship_meaning),
      reconciled_response_intent: mapDeterministicToTurnResponseIntent(det),
      reconciled_persistence_decision: det.persistence_decision,
      reconciled_do_not_repeat_asks: fallbackDnr,
      last_ask_satisfied: "unclear",
      satisfaction_kind: "unclear",
      stale_ask_risk: false,
      confidence: det.confidence === "high" ? 0.7 : det.confidence === "medium" ? 0.55 : 0.4,
      disagreement_flags: ["hard_route_priority_override"],
      interpreter_failed_reason: null,
      stale_ask_avoided: false,
      persistence_note: "server kept deterministic persistence (hard route priority)",
      reconciled_goal_change_intent: null,
    };
  }

  if (failed || !args.proposal) {
    const fallbackDnr = coachQ.length >= 12 ? [coachQ.slice(0, 160)] : [];
    return {
      proposal: args.proposal,
      reconciled_relationship_meaning: mapDeterministicToTurnMeaning(det.relationship_meaning),
      reconciled_response_intent: mapDeterministicToTurnResponseIntent(det),
      reconciled_persistence_decision: det.persistence_decision,
      reconciled_do_not_repeat_asks: fallbackDnr,
      last_ask_satisfied: "unclear",
      satisfaction_kind: "unclear",
      stale_ask_risk: false,
      confidence: det.confidence === "high" ? 0.7 : det.confidence === "medium" ? 0.55 : 0.4,
      disagreement_flags: failed ? ["interpreter_failed"] : ["no_proposal"],
      interpreter_failed_reason: failed ?? "no_proposal",
      stale_ask_avoided: false,
      persistence_note: "server kept deterministic persistence (interpreter unavailable)",
      turn_understanding_failure_diagnostics: args.failureDiagnostics ?? null,
      reconciled_goal_change_intent: null,
    };
  }

  const p = args.proposal;
  let reconciled_relationship_meaning = p.relationship_meaning;
  let reconciled_response_intent = p.response_intent;
  let reconciled_persistence_decision = det.persistence_decision;
  let reconciled_do_not_repeat_asks = [...p.do_not_repeat_asks];
  let last_ask_satisfied = p.last_ask_satisfied;
  let satisfaction_kind = p.satisfaction_kind;
  let stale_ask_risk = p.stale_ask_risk;
  let confidence = p.confidence;

  if (p.route_priority_recommendation === "compliance" || p.route_priority_recommendation === "crisis") {
    disagreement_flags.push("route_priority_advisory_only");
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    reconciled_response_intent = "unclear_clarify";
    disagreement_flags.push("low_confidence_clarify");
    if (stale_ask_risk && coachQ.length >= 12) {
      reconciled_do_not_repeat_asks.push(coachQ.slice(0, 160));
    }
  }

  if (last_ask_satisfied === "yes") {
    if (
      reconciled_response_intent === "ask_next_specific_step" ||
      reconciled_response_intent === "reinforce_plan_without_proof"
    ) {
      reconciled_response_intent = "acknowledge_prior_ask_satisfied";
      disagreement_flags.push("intent_downgraded_after_satisfied_ask");
    }
    if (coachQ.length >= 12 && !reconciled_do_not_repeat_asks.some((x) => x.includes(coachQ.slice(0, 40)))) {
      reconciled_do_not_repeat_asks.unshift(coachQ.slice(0, 160));
    }
    stale_ask_risk = true;
  }

  if (p.persistence_safety !== "safe_to_write") {
    const proposedPersist = mapProposalOutcomeToPersistence(p.commitment_outcome_recommendation);
    if (proposedPersist === "write_user_yes_today" || proposedPersist === "write_user_no" || proposedPersist === "write_user_partial") {
      disagreement_flags.push("openai_outcome_write_declined");
    }
    reconciled_persistence_decision =
      det.persistence_decision === "ack_only" || det.persistence_decision === "no_outcome_write"
        ? det.persistence_decision
        : "no_outcome_write";
  } else if (p.commitment_outcome_recommendation !== "unclear") {
    const proposedPersist = mapProposalOutcomeToPersistence(p.commitment_outcome_recommendation);
    if (serverAllowsPersistenceWrite(proposedPersist, det)) {
      reconciled_persistence_decision = proposedPersist;
    } else {
      disagreement_flags.push("server_rejected_openai_persistence");
      reconciled_persistence_decision = det.persistence_decision;
    }
  }

  reconciled_do_not_repeat_asks = reconciled_do_not_repeat_asks
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_DO_NOT_REPEAT);

  const stale_ask_avoided =
    last_ask_satisfied === "yes" && reconciled_do_not_repeat_asks.length > 0 && stale_ask_risk;

  const persistence_note =
    reconciled_persistence_decision === det.persistence_decision
      ? `server persistence unchanged: ${reconciled_persistence_decision}`
      : `server adjusted persistence to ${reconciled_persistence_decision} (deterministic was ${det.persistence_decision})`;

  const finalized = finalizeReconciledGoalChange({
    proposal: p,
    reconciled_relationship_meaning,
    reconciled_response_intent,
    reconciled_persistence_decision,
    last_ask_satisfied,
    confidence,
    disagreement_flags,
    rawInboundForFallback: args.inboundBody ?? null,
  });

  return {
    proposal: p,
    reconciled_relationship_meaning: finalized.reconciled_relationship_meaning,
    reconciled_response_intent: finalized.reconciled_response_intent,
    reconciled_persistence_decision: finalized.reconciled_persistence_decision,
    reconciled_do_not_repeat_asks,
    last_ask_satisfied: finalized.last_ask_satisfied,
    satisfaction_kind,
    stale_ask_risk,
    confidence,
    disagreement_flags: finalized.disagreement_flags,
    interpreter_failed_reason: null,
    stale_ask_avoided,
    persistence_note,
    reconciled_goal_change_intent: finalized.reconciled_goal_change_intent,
  };
}

function mapDeterministicToTurnMeaning(
  m: InboundMeaningFacts["relationship_meaning"]
): TurnUnderstandingRelationshipMeaning {
  if (m === "answer_to_prior_question") return "direct_answer";
  if (m === "question") return "unclear";
  if (m === "uncertain") return "unclear";
  if (m === "unknown") return "unclear";
  if (m === "contract_consent") return "unclear";
  if (RELATIONSHIP_MEANINGS.has(m)) return m as TurnUnderstandingRelationshipMeaning;
  return "unclear";
}

function mapDeterministicToTurnResponseIntent(
  det: InboundMeaningFacts
): TurnUnderstandingResponseIntent {
  switch (det.sms_response_intent) {
    case "acknowledge_completion_and_next_step":
      return "acknowledge_completion";
    case "tell_truth_and_recover":
      return "tell_truth_and_recover";
    case "identify_blocker_or_next_move":
      return "identify_blocker";
    case "reinforce_plan_and_choose_first_step":
      return "reinforce_plan_without_proof";
    case "answer_prior_question":
      return "answer_user_question";
    case "clarify_gently":
      return "unclear_clarify";
    default:
      return "ask_next_specific_step";
  }
}

export function coachingMoveFromReconciledResponseIntent(
  intent: TurnUnderstandingResponseIntent
): string | null {
  switch (intent) {
    case "acknowledge_completion":
      return "acknowledge_completion";
    case "acknowledge_prior_ask_satisfied":
      return "acknowledge_prior_ask_satisfied";
    case "tell_truth_and_recover":
      return "name_blocker";
    case "identify_blocker":
      return "narrow_blocker";
    case "reinforce_plan_without_proof":
      return "next_first_step";
    case "clarify_goal_change":
      return "respond_commitment_change_context_without_pending_resolution";
    case "answer_user_question":
      return "respond_to_open_question_answer_natural";
    case "acknowledge_result_and_next_standard":
      return "acknowledge_result_and_next_standard";
    case "ask_next_specific_step":
      return "ask_accountability";
    case "close_loop_no_new_action":
      return "close_loop_no_new_action";
    case "unclear_clarify":
      return "clarify_intent";
    default:
      return null;
  }
}

export function buildRelationshipPacketTurnUnderstanding(
  r: ReconciledTurnUnderstanding
): RelationshipPacketTurnUnderstanding {
  return {
    authority: "authoritative_current",
    relationship_meaning: r.reconciled_relationship_meaning,
    response_intent: r.reconciled_response_intent,
    last_ask_satisfied: r.last_ask_satisfied,
    satisfaction_kind: r.satisfaction_kind,
    do_not_repeat_asks: r.reconciled_do_not_repeat_asks,
    stale_ask_risk: r.stale_ask_risk,
    evidence_quotes: r.proposal?.evidence_quotes ?? [],
    confidence: r.confidence,
    persistence_note: r.persistence_note,
  };
}

export function buildTurnUnderstandingLaneGuardrails(): string {
  return `
TURN_UNDERSTANDING (structured_recent_truth.turn_understanding — authoritative_current):
- If turn_understanding.last_ask_satisfied is yes: acknowledge that the prior coach ask is satisfied; do NOT ask do_not_repeat_asks again in different words.
- turn_understanding overrides generic effective_ask / accountability re-asks when they conflict.
- acknowledge_prior_ask_satisfied and close_loop_no_new_action are NOT proof saved and NOT Victory Room unless proof_victory_permission explicitly allows.
- If response_intent is acknowledge_result_and_next_standard: acknowledge the user's reported result and their stated next standard; do NOT ask an old outcome triad (protected/partial/missed) they already answered.
- If response_intent is unclear_clarify: one concise clarifying question — not the stale old coach ask.
- If reconciled goal-change intent is authoritative: this is NOT proof/outcome; do NOT treat as user_yes/user_no; do NOT claim the goal changed; bridge toward commitment-change context without repeating prior goal-change clarification asks.`;
}

export function buildTurnUnderstandingPersistGuardMeta(args: {
  turn: ReconciledTurnUnderstanding;
  baselinePersistence: InboundPersistenceDecision;
  effectivePersistence: InboundPersistenceDecision;
  persistAllowed: boolean;
  guardReason: string | null;
}): TurnUnderstandingPersistGuardMeta {
  const narrowed =
    args.baselinePersistence !== args.effectivePersistence || !args.persistAllowed;
  return {
    persistence_narrowed_by_turn_understanding: narrowed,
    persistence_narrowed_from: narrowed ? args.baselinePersistence : null,
    persistence_narrowed_to: narrowed ? args.effectivePersistence : null,
    turn_understanding_persistence_guard_reason: args.guardReason,
    turn_understanding_applied_to_persist: true,
    turn_understanding_persist_skip_reason: null,
  };
}

export function shouldBlockClassifierYesForSatisfiedAsk(
  turn: ReconciledTurnUnderstanding,
  inboundMeaning: InboundMeaningFacts
): boolean {
  if (isAuthoritativeReconciledGoalChangeIntent(turn.reconciled_goal_change_intent)) {
    return true;
  }
  if (turn.last_ask_satisfied !== "yes") return false;
  if (!SATISFACTION_KINDS_BLOCKING_CLASSIFIER_YES.has(turn.satisfaction_kind)) return false;
  if (shouldPromoteClarifyForReportedCompletionPersist({ inboundMeaning })) return false;
  if (turn.reconciled_relationship_meaning === "reported_completion") return false;
  const safety = turn.proposal?.persistence_safety;
  if (safety === "safe_to_write" && turn.reconciled_persistence_decision === "write_user_yes_today") {
    return false;
  }
  return true;
}

export function slimTurnUnderstandingMetadata(
  r: ReconciledTurnUnderstanding | null | undefined,
  persistGuard?: TurnUnderstandingPersistGuardMeta | null
): Record<string, unknown> {
  if (!r) return { openai_turn_understanding_version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION };
  const diag = r.turn_understanding_failure_diagnostics;
  return {
    openai_turn_understanding_version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    ...(r.interpreter_latency_ms != null ? { interpreter_latency_ms: r.interpreter_latency_ms } : {}),
    ...(persistGuard ?? {}),
    turn_understanding_relationship_meaning: r.reconciled_relationship_meaning,
    turn_understanding_response_intent: r.reconciled_response_intent,
    turn_understanding_last_ask_satisfied: r.last_ask_satisfied,
    turn_understanding_satisfaction_kind: r.satisfaction_kind,
    turn_understanding_persistence_recommendation: r.proposal?.commitment_outcome_recommendation ?? null,
    server_reconciled_persistence_decision: r.reconciled_persistence_decision,
    server_reconciled_response_intent: r.reconciled_response_intent,
    do_not_repeat_asks: r.reconciled_do_not_repeat_asks,
    turn_understanding_confidence: r.confidence,
    uncertainty_flags: r.proposal?.uncertainty_flags ?? [],
    interpreter_failed_reason: r.interpreter_failed_reason,
    stale_ask_avoided: r.stale_ask_avoided,
    disagreement_flags: r.disagreement_flags,
    persistence_note: r.persistence_note,
    ...(r.turn_understanding_failed_safe_fallback
      ? {
          turn_understanding_failed_safe_fallback: true,
          turn_understanding_failed_safe_reason:
            r.turn_understanding_failed_safe_reason ?? r.interpreter_failed_reason,
          turn_understanding_failed_safe_do_not_repeat_asks:
            r.turn_understanding_failed_safe_do_not_repeat_asks ?? r.reconciled_do_not_repeat_asks,
        }
      : {}),
    ...(diag
      ? {
          tu_error_code: diag.tu_error_code,
          tu_error_message_short: diag.tu_error_message_short,
          tu_latency_ms: diag.tu_latency_ms,
          ...(diag.tu_raw_preview != null ? { tu_raw_preview: diag.tu_raw_preview } : {}),
          ...(diag.tu_sdk_status != null ? { tu_sdk_status: diag.tu_sdk_status } : {}),
          ...(diag.tu_sdk_type ? { tu_sdk_type: diag.tu_sdk_type } : {}),
        }
      : {}),
    ...(r.correction_language_detected
      ? {
          correction_language_detected: true,
          blocked_outcome_reason: r.blocked_outcome_reason ?? "goal_or_context_correction",
        }
      : {}),
    ...buildGoalChangeIntentTelemetry(r.reconciled_goal_change_intent),
  };
}

export type RunInboundTurnUnderstandingArgs = {
  inboundBody: string;
  timezone: string;
  receivedAtIso: string;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  routePurpose?: string | null;
  routePriority?: InboundMeaningRoutePriority;
  effectiveAsk: string;
  behaviorStatement: string;
  lastCoachOutbound: string | null;
  latestOpenQuestion: string | null;
  latestAnswerAfterOpenQuestion: string | null;
  openQuestionPending: boolean;
  expectedReplySemantics: string | null;
  recentThreadExcerpt: string;
  temporalContract: TemporalContractV1 | null;
  proofCalloutClaimSavedAllowed: boolean;
  openQuestionFacts?: unknown;
  expectedAnswerType?: string | null;
  recentEventsNewestFirst?: import("@/lib/v2-commitment").V2EventRowForAi[];
  commitmentTitle?: string | null;
};

/** Build deterministic meaning, optionally call OpenAI, reconcile — inbound normal lane only. */
export async function runInboundRelationshipTurnUnderstanding(
  args: RunInboundTurnUnderstandingArgs
): Promise<ReconciledTurnUnderstanding | null> {
  if (
    shouldSkipInboundTurnUnderstandingRoute({
      routePurpose: args.routePurpose,
      routePriority: args.routePriority,
    })
  ) {
    return null;
  }

  const routePriority = args.routePriority ?? {};
  const deterministicMeaning = buildInboundMeaningFacts({
    rawInbound: args.inboundBody,
    receivedAt: new Date(args.receivedAtIso),
    timezone: args.timezone,
    classifierEventType: args.classifierEventType,
    classifierNormalizedHint: args.classifierNormalizedHint,
    routePriority,
    openQuestionPending: args.openQuestionPending,
    latestOpenQuestion: args.latestOpenQuestion,
    latestOutboundBody: args.lastCoachOutbound,
    expectedAnswerType: args.expectedAnswerType,
    expectedReplySemantics: args.expectedReplySemantics,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
    commitmentTitle: args.commitmentTitle,
    recentEventsNewestFirst: args.recentEventsNewestFirst,
  });

  const promptArgs: BuildTurnUnderstandingPromptArgs = {
    inboundBody: args.inboundBody,
    lastCoachOutbound: args.lastCoachOutbound,
    latestOpenQuestion: args.latestOpenQuestion,
    latestAnswerAfterOpenQuestion: args.latestAnswerAfterOpenQuestion,
    openQuestionPending: args.openQuestionPending,
    expectedReplySemantics: args.expectedReplySemantics,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
    recentThreadExcerpt: args.recentThreadExcerpt,
    routePurpose: args.routePurpose ?? "normal_inbound_reply",
    routePriority,
    temporalContract: args.temporalContract,
    proofCalloutClaimSavedAllowed: args.proofCalloutClaimSavedAllowed,
    deterministicMeaning,
    classifierEventType: args.classifierEventType,
  };

  const openAi = await callOpenAIRelationshipTurnUnderstandingV1(promptArgs);
  const coachQ = args.latestOpenQuestion?.trim() || args.lastCoachOutbound?.trim() || null;

  const reconciled = reconcileTurnUnderstanding({
    proposal: openAi.ok ? openAi.proposal : null,
    deterministicMeaning,
    routePriority,
    latestCoachQuestion: coachQ,
    interpreterFailedReason: openAi.ok ? null : openAi.reason,
    inboundBody: args.inboundBody,
    failureDiagnostics: openAi.ok ? null : openAi.diagnostics,
  });
  return {
    ...enrichReconciledWithInboundRouteContract(reconciled, {
      rawInbound: args.inboundBody,
      openQuestionPending: args.openQuestionPending,
      latestOpenQuestion: args.latestOpenQuestion,
      classifierEventType: args.classifierEventType,
    }),
    interpreter_latency_ms: openAi.latencyMs,
  };
}
