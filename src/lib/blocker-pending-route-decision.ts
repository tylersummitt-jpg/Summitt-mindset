/**
 * Phase 2.2.0 — server-owned route decision when blocker capture is pending.
 * OpenAI/TU advises; this module decides capture vs normal inbound before processV2BlockerCapture.
 */

import { inboundContainsRealBlockerCaptureSignal } from "@/lib/blocker-capture-proposal-ack-bypass";
import type { InboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
} from "@/lib/inbound-short-answer-clauses";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { isTurnUnderstandingAuthoritative } from "@/lib/openai-relationship-turn-understanding-v1";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

export type BlockerPendingRouteDecision =
  | "actual_blocker_capture"
  | "not_blocker_normal_inbound"
  | "outcome_answer"
  | "proposal_ack"
  | "adjustment_request"
  | "unclear";

export type BlockerPendingRouteDecisionSource =
  | "turn_understanding"
  | "saca"
  | "deterministic_signal"
  | "step_e"
  | "explicit_outcome"
  | "fallback";

export type BlockerPendingRouteDecisionResult = {
  decision: BlockerPendingRouteDecision;
  source: BlockerPendingRouteDecisionSource;
  shouldClearBlockerPending: boolean;
  shouldRunProcessV2BlockerCapture: boolean;
  shouldRunNormalInbound: boolean;
  reason: string;
  /** Avoid fake user_yes/user_no when bare yes/no follows a blocker question. */
  normalInboundClassificationOverride?: {
    eventType: V2InboundEventType;
    normalizedHint: string | null;
  };
  telemetry: Record<string, unknown>;
};

export type EvaluateBlockerPendingRouteDecisionArgs = {
  rawInbound: string;
  blockerCapturePendingActive: boolean;
  blockerCaptureAfterEvent?: string | null;
  blockerCaptureExpiresAt?: string | null;
  lastCoachBody?: string | null;
  latestOpenQuestion?: string | null;
  blockerClassification: {
    eventType: V2InboundEventType;
    normalizedHint: string | null;
  };
  turnUnderstandingContext?: InboundTurnUnderstandingContext | null;
  saca?: ShortAnswerContextAuthority | null;
  stepEProposalAck?: { bypass: boolean; reason: string | null } | null;
  inboundRelationshipMeaning?: InboundMeaningFacts | null;
};

const SHORT_UNCLEAR_RE =
  /^(hmm+|um+|uh+|thanks?|thank you|thx|no problem|ty|ok|okay|k|sure|cool|alright)\.?$/i;

const BARE_YES_NO_TOKENS = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "no",
  "n",
  "nope",
  "nah",
]);

function buildTelemetry(
  args: EvaluateBlockerPendingRouteDecisionArgs,
  extras: Record<string, unknown>
): Record<string, unknown> {
  const tuCtx = args.turnUnderstandingContext;
  return {
    blocker_pending_active: args.blockerCapturePendingActive,
    blocker_pending_tu_ran: Boolean(tuCtx?.didRun),
    blocker_capture_after_event: args.blockerCaptureAfterEvent ?? null,
    blocker_capture_expires_at: args.blockerCaptureExpiresAt ?? null,
    turn_understanding_skip_reason: tuCtx?.skippedReason ?? null,
    turn_understanding_failed_reason: tuCtx?.failedReason ?? null,
    ...extras,
  };
}

function finish(
  args: EvaluateBlockerPendingRouteDecisionArgs,
  result: Omit<BlockerPendingRouteDecisionResult, "telemetry"> & {
    telemetryExtras?: Record<string, unknown>;
  }
): BlockerPendingRouteDecisionResult {
  const telemetry = buildTelemetry(args, {
    blocker_route_decision: result.decision,
    blocker_route_decision_source: result.source,
    blocker_capture_decision_reason: result.reason,
    blocker_capture_skipped_reason:
      result.shouldRunProcessV2BlockerCapture ? null : result.reason,
    old_blocker_pending_cleared: result.shouldClearBlockerPending,
    did_processV2BlockerCapture_run: result.shouldRunProcessV2BlockerCapture,
    did_normal_inbound_run: result.shouldRunNormalInbound,
    ...result.telemetryExtras,
  });
  return { ...result, telemetry };
}

export function isBareYesNoAfterBlockerQuestion(
  rawInbound: string,
  classification: { eventType: V2InboundEventType }
): boolean {
  const trimmed = rawInbound.trim();
  if (!trimmed) return false;
  if (classification.eventType !== "user_yes" && classification.eventType !== "user_no") {
    return false;
  }
  if (inboundContainsRealBlockerCaptureSignal(trimmed)) return false;
  if (
    inboundHasExplicitCompletionClause(trimmed) ||
    inboundHasExplicitMissClause(trimmed) ||
    inboundHasExplicitPartialClause(trimmed)
  ) {
    return false;
  }
  const collapsed = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (BARE_YES_NO_TOKENS.has(collapsed)) return true;
  if (trimmed.length <= 15 && /\b(yes|no|yep|nope|yeah|nah)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function hasExplicitOutcome(raw: string): boolean {
  return (
    inboundHasExplicitCompletionClause(raw) ||
    inboundHasExplicitMissClause(raw) ||
    inboundHasExplicitPartialClause(raw)
  );
}

function tuIndicatesBlockerCapture(ctx: InboundTurnUnderstandingContext | null | undefined): boolean {
  if (!ctx?.reconciled || !isTurnUnderstandingAuthoritative(ctx.reconciled)) return false;
  const meaning = ctx.reconciled.reconciled_relationship_meaning;
  const intent = ctx.reconciled.reconciled_response_intent;
  return meaning === "blocker_detail" || intent === "identify_blocker";
}

function tuIndicatesOutcomeAnswer(ctx: InboundTurnUnderstandingContext | null | undefined): boolean {
  if (!ctx?.reconciled || !isTurnUnderstandingAuthoritative(ctx.reconciled)) return false;
  const meaning = ctx.reconciled.reconciled_relationship_meaning;
  const persist = ctx.reconciled.reconciled_persistence_decision;
  if (meaning === "reported_completion" && persist === "write_user_yes_today") return true;
  if (meaning === "miss" && persist === "write_user_no") return true;
  if (meaning === "partial_attempt" && persist === "write_user_partial") return true;
  if (
    persist === "write_user_yes_today" ||
    persist === "write_user_no" ||
    persist === "write_user_partial"
  ) {
    return true;
  }
  return false;
}

function tuIndicatesAdjustment(ctx: InboundTurnUnderstandingContext | null | undefined): boolean {
  if (!ctx?.reconciled || !isTurnUnderstandingAuthoritative(ctx.reconciled)) return false;
  return ctx.reconciled.reconciled_relationship_meaning === "goal_adjustment_request";
}

function tuIndicatesPlanAck(ctx: InboundTurnUnderstandingContext | null | undefined): boolean {
  if (!ctx?.reconciled || !isTurnUnderstandingAuthoritative(ctx.reconciled)) return false;
  const intent = ctx.reconciled.reconciled_response_intent;
  return (
    intent === "reinforce_plan_without_proof" ||
    intent === "acknowledge_result_and_next_standard"
  );
}

function classificationOverrideForNonBlocker(
  args: EvaluateBlockerPendingRouteDecisionArgs
): BlockerPendingRouteDecisionResult["normalInboundClassificationOverride"] | undefined {
  if (isBareYesNoAfterBlockerQuestion(args.rawInbound, args.blockerClassification)) {
    return {
      eventType: "user_partial",
      normalizedHint: "blocker_pending_bare_yes_no",
    };
  }
  return undefined;
}

function outcomeAnswerResult(
  args: EvaluateBlockerPendingRouteDecisionArgs,
  source: BlockerPendingRouteDecisionSource,
  reason: string
): BlockerPendingRouteDecisionResult {
  return finish(args, {
    decision: "outcome_answer",
    source,
    shouldClearBlockerPending: true,
    shouldRunProcessV2BlockerCapture: false,
    shouldRunNormalInbound: true,
    reason,
    normalInboundClassificationOverride: classificationOverrideForNonBlocker(args),
  });
}

function normalNonBlockerResult(
  args: EvaluateBlockerPendingRouteDecisionArgs,
  decision: Exclude<BlockerPendingRouteDecision, "actual_blocker_capture">,
  source: BlockerPendingRouteDecisionSource,
  reason: string
): BlockerPendingRouteDecisionResult {
  return finish(args, {
    decision,
    source,
    shouldClearBlockerPending: true,
    shouldRunProcessV2BlockerCapture: false,
    shouldRunNormalInbound: true,
    reason,
    normalInboundClassificationOverride: classificationOverrideForNonBlocker(args),
  });
}

function actualBlockerResult(
  args: EvaluateBlockerPendingRouteDecisionArgs,
  source: BlockerPendingRouteDecisionSource,
  reason: string
): BlockerPendingRouteDecisionResult {
  return finish(args, {
    decision: "actual_blocker_capture",
    source,
    shouldClearBlockerPending: false,
    shouldRunProcessV2BlockerCapture: true,
    shouldRunNormalInbound: false,
    reason,
  });
}

/**
 * Decide whether inbound with blocker capture pending should invoke processV2BlockerCapture.
 * Never defaults to capture solely because blocker pending is active.
 */
export function evaluateBlockerPendingRouteDecision(
  args: EvaluateBlockerPendingRouteDecisionArgs
): BlockerPendingRouteDecisionResult {
  const raw = args.rawInbound.trim();

  if (!args.blockerCapturePendingActive) {
    return finish(args, {
      decision: "not_blocker_normal_inbound",
      source: "fallback",
      shouldClearBlockerPending: false,
      shouldRunProcessV2BlockerCapture: false,
      shouldRunNormalInbound: true,
      reason: "blocker_pending_inactive",
    });
  }

  if (!raw) {
    return normalNonBlockerResult(args, "not_blocker_normal_inbound", "fallback", "empty_inbound");
  }

  // Step E — deterministic proposal ack validation (unchanged product behavior).
  if (args.stepEProposalAck?.bypass) {
    return normalNonBlockerResult(
      args,
      "proposal_ack",
      "step_e",
      args.stepEProposalAck.reason ?? "step_e_proposal_ack"
    );
  }

  const deterministicBlocker = inboundContainsRealBlockerCaptureSignal(raw);
  const explicitOutcome = hasExplicitOutcome(raw);

  // Mixed outcome + blocker: preserve outcome via normal path; do not fake blocker-only capture.
  if (explicitOutcome && deterministicBlocker) {
    return outcomeAnswerResult(
      args,
      "explicit_outcome",
      "mixed_outcome_and_blocker_signal_route_normal"
    );
  }

  if (deterministicBlocker) {
    return actualBlockerResult(args, "deterministic_signal", "deterministic_blocker_signal");
  }

  if (isLikelyCommitmentChangeIntentTurn(raw)) {
    return normalNonBlockerResult(
      args,
      "adjustment_request",
      "fallback",
      "commitment_change_intent"
    );
  }

  if (tuIndicatesAdjustment(args.turnUnderstandingContext)) {
    return normalNonBlockerResult(
      args,
      "adjustment_request",
      "turn_understanding",
      "tu_goal_adjustment_request"
    );
  }

  if (tuIndicatesPlanAck(args.turnUnderstandingContext)) {
    return normalNonBlockerResult(
      args,
      "proposal_ack",
      "turn_understanding",
      "tu_plan_ack"
    );
  }

  if (tuIndicatesOutcomeAnswer(args.turnUnderstandingContext)) {
    return outcomeAnswerResult(args, "turn_understanding", "tu_outcome_answer");
  }

  if (explicitOutcome) {
    return outcomeAnswerResult(args, "explicit_outcome", "explicit_outcome_clause");
  }

  if (tuIndicatesBlockerCapture(args.turnUnderstandingContext)) {
    return actualBlockerResult(args, "turn_understanding", "tu_blocker_detail");
  }

  if (args.inboundRelationshipMeaning?.relationship_meaning === "blocker") {
    return actualBlockerResult(args, "fallback", "deterministic_meaning_blocker");
  }

  if (isBareYesNoAfterBlockerQuestion(raw, args.blockerClassification)) {
    return normalNonBlockerResult(
      args,
      "unclear",
      "fallback",
      "bare_yes_no_after_blocker_question"
    );
  }

  if (SHORT_UNCLEAR_RE.test(raw)) {
    return normalNonBlockerResult(args, "unclear", "fallback", "short_unclear_ack");
  }

  const saca = args.saca;
  if (saca?.prior_question_type === "outcome_check" && saca.outcome_proof_eligible) {
    return outcomeAnswerResult(args, "saca", "saca_outcome_check_prior");
  }

  if (
    saca?.response_intent_hint === "acknowledge_plan_confirmation" ||
    (saca?.prior_question_type === "plan_confirmation" && saca.short_answer_polarity === "affirm")
  ) {
    return normalNonBlockerResult(args, "proposal_ack", "saca", saca.reason ?? "saca_plan_ack");
  }

  // TU failed or inconclusive — never default to capture.
  return normalNonBlockerResult(args, "unclear", "fallback", "no_blocker_signal_default_normal");
}
