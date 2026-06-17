/**
 * Phase 1 — Reliable inbound accountability outcome persistence.
 * Ensures clear yes/no/partial replies to a live check write one spine row before SMS send.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { V2ActiveReplyContext } from "@/lib/v2-active-reply-context";
import type { V2AccountabilityOutcome } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision, V2InboundGatedMode } from "@/lib/v2-ai-inbound";
import type { ProofMomentMeta } from "@/lib/v2-proof-moment";
import { proofMomentPayloadFields } from "@/lib/v2-proof-moment";
import {
  buildInboundMeaningFacts,
  persistenceDecisionToOutcomeEventType,
  slimInboundMeaningForFacts,
  type InboundMeaningFacts,
  type InboundPersistenceDecision,
} from "@/lib/inbound-relationship-meaning";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
  inboundHasExplicitAccountabilityMissClause,
  looksLikeCoachContextCorrectionOrMetaDispute,
  looksLikeOnboardingProcessDispute,
} from "@/lib/inbound-short-answer-clauses";
import {
  isNonOutcomePlanPriorQuestionType,
  isPlanAckFromShortAnswerContext,
  isPlanRejectionFromShortAnswerContext,
  looksLikeShortProposalRejectionLanguage,
  resolveShortAnswerContextAuthority,
} from "@/lib/inbound-short-answer-context";
import { shortAnswerDisqualifiesOutcomeProof, normalizeShortAnswerText } from "@/lib/inbound-short-answer-polarity";
import {
  buildTurnUnderstandingPersistGuardMeta,
  isTurnUnderstandingAuthoritative,
  shouldBlockClassifierYesForSatisfiedAsk,
  type ReconciledTurnUnderstanding,
  type TurnUnderstandingPersistGuardMeta,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  v2UserReplyIdempotencyKey,
  type V2InboundEventType,
} from "@/lib/v2-sms-accountability";

export { isClearAccountabilityCompletionReply } from "@/lib/v2-inbound-accountability-completion";
import { isSubstantiveSelfReportedCompletionForProof } from "@/lib/inbound-self-reported-completion";
import {
  isFutureForwardPlanInbound,
  isGoalIncreaseIntentClarifyInbound,
} from "@/lib/v2-sms-future-stretch-intent";

export type InboundOutcomePersistBranch =
  | "main"
  | "open_question"
  | "central_pivot"
  | "arc_clarify"
  | "conversation_brain_legacy_fallback";

export type InboundOutcomePersistLaneExclusion =
  | "none"
  | "commitment_change_handoff"
  | "identity_edit"
  | "relationship_exit"
  | "soft_opt_out"
  | "repair_reply_only"
  | "future_forward_plan"
  | "goal_increase_clarify"
  | "arc_clarify_only"
  | "blocker_capture_only";

export type InboundOutcomePersistSkipReason =
  | "no_message_sid"
  | "no_commitment_id"
  | "classifier_not_accountability_outcome"
  | "no_live_accountability_prompt"
  | "lane_excluded"
  | "gated_non_outcome_mode"
  | "arc_clarify_only"
  | "meaning_ack_only"
  | "meaning_no_outcome_write"
  | "meaning_deferred_route"
  | "turn_understanding_expand_blocked"
  | "turn_understanding_satisfied_ask_no_proof"
  | "plan_or_proposal_ack_backstop"
  | "plan_or_proposal_rejection_backstop"
  | "coach_context_correction_not_miss"
  | "coach_process_dispute_not_miss"
  | "onboarding_process_dispute_not_miss";

export type InboundOutcomePersistResult =
  | {
      status: "inserted";
      eventType: V2AccountabilityOutcome;
      eventId: string;
      idempotencyKey: string;
      overrideGatedNoWrite: boolean;
    }
  | {
      status: "duplicate";
      eventType: V2AccountabilityOutcome;
      idempotencyKey: string;
      overrideGatedNoWrite: boolean;
    }
  | { status: "skipped"; skipReason: InboundOutcomePersistSkipReason; overrideGatedNoWrite?: boolean }
  | { status: "error"; message: string; code?: string; eventType?: V2AccountabilityOutcome };

const GATED_MODES_BLOCKING_PERSIST: ReadonlySet<V2InboundGatedMode> = new Set([
  "commitment_change_handoff",
  "relationship_exit_integrity",
  "identity_edit_integrity",
  "soft_opt_out_reply",
  "repair_reply_only",
]);

const ACCOUNTABILITY_OUTCOMES: ReadonlySet<V2AccountabilityOutcome> = new Set([
  "user_yes",
  "user_no",
  "user_partial",
]);

/**
 * Clarify-gated no-send may still persist explicit miss/partial when server meaning + CLOE agree.
 * Stricter than completion bypass: requires matching relationship_meaning and explicit clause/SACA deny.
 */
export function canBypassClarifyGateForExplicitNonYesOutcome(args: {
  rawBody: string;
  persistence: InboundPersistenceDecision;
  inboundMeaning: InboundMeaningFacts;
}): boolean {
  const raw = args.rawBody.trim();
  if (!raw) return false;

  if (shortAnswerDisqualifiesOutcomeProof(raw).disqualified) return false;

  if (args.persistence === "write_user_no") {
    if (args.inboundMeaning.relationship_meaning !== "miss") return false;
    return (
      inboundHasExplicitMissClause(raw) ||
      args.inboundMeaning.evidence.some(
        (e) => e.startsWith("saca_short_deny") || e.includes("explicit_miss")
      )
    );
  }

  if (args.persistence === "write_user_partial") {
    if (args.inboundMeaning.relationship_meaning !== "partial_attempt") return false;
    return (
      inboundHasExplicitPartialClause(raw) ||
      args.inboundMeaning.evidence.some(
        (e) =>
          e.startsWith("saca_short_partial") ||
          e.includes("explicit_partial") ||
          e === "partial_attempt_phrasing"
      )
    );
  }

  return false;
}

export function resolveInboundAccountabilityOutcomeEventType(args: {
  classifierEventType: V2InboundEventType;
  gatedDecision: V2InboundGatedDecision;
}): V2AccountabilityOutcome {
  const gated = args.gatedDecision.final_event_type;
  if (
    gated === "user_yes" ||
    gated === "user_no" ||
    gated === "user_partial"
  ) {
    return gated;
  }
  return args.classifierEventType;
}

export function laneExclusionFromGatedMode(
  mode: V2InboundGatedMode
): InboundOutcomePersistLaneExclusion | "none" {
  if (mode === "commitment_change_handoff") return "commitment_change_handoff";
  if (mode === "identity_edit_integrity") return "identity_edit";
  if (mode === "relationship_exit_integrity") return "relationship_exit";
  if (mode === "soft_opt_out_reply") return "soft_opt_out";
  if (mode === "repair_reply_only") return "repair_reply_only";
  return "none";
}

export type ShouldPersistInboundAccountabilityOutcomeArgs = {
  messageSid: string;
  commitmentId: string;
  rawBody: string;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint?: string | null;
  gatedDecision: V2InboundGatedDecision;
  laneExclusion: InboundOutcomePersistLaneExclusion;
  activeReplyContext: Pick<
    V2ActiveReplyContext,
    "has_live_accountability_prompt" | "self_contained_accountability_answer"
  > | null;
  inboundMeaning?: InboundMeaningFacts | null;
  turnUnderstandingReconciled?: ReconciledTurnUnderstanding | null;
};

export type ShouldPersistInboundAccountabilityOutcomeResult =
  | {
      persist: true;
      resolvedEventType: V2AccountabilityOutcome;
      liveAccountabilityPromptDetected: boolean;
      overrideGatedNoWrite: boolean;
      turnUnderstandingPersistGuard?: TurnUnderstandingPersistGuardMeta | null;
    }
  | {
      persist: false;
      skipReason: InboundOutcomePersistSkipReason;
      turnUnderstandingPersistGuard?: TurnUnderstandingPersistGuardMeta | null;
    };

function evaluateUserYesPersistBackstop(args: {
  raw: string;
  inboundMeaning: InboundMeaningFacts;
}): InboundOutcomePersistSkipReason | null {
  const raw = args.raw.trim();
  if (args.inboundMeaning.persistence_decision !== "write_user_yes_today") return null;
  if (inboundHasExplicitCompletionClause(raw)) return null;
  if (isSubstantiveSelfReportedCompletionForProof(raw)) return null;

  const m = args.inboundMeaning;
  if (m.relationship_meaning === "answer_to_prior_question" || m.relationship_meaning === "plan_made") {
    return "plan_or_proposal_ack_backstop";
  }

  if (
    m.evidence.some(
      (e) =>
        e.includes("plan_confirmation") ||
        e.includes("short_answer_plan") ||
        e.includes("plan_or_future") ||
        e.includes("bounded_proposal") ||
        e.includes("future_affirmative_not_completion") ||
        e.includes("reported_completion_blocked_future_affirmative")
    )
  ) {
    return "plan_or_proposal_ack_backstop";
  }

  if (
    typeof m.reason === "string" &&
    (m.reason.includes("future_affirmative_not_completion") ||
      m.reason.includes("reported_completion_blocked_future_affirmative") ||
      m.reason.includes("short_answer_no_outcome_proof"))
  ) {
    return "plan_or_proposal_ack_backstop";
  }

  const saca = resolveShortAnswerContextAuthority({ rawInbound: raw });
  if (isPlanAckFromShortAnswerContext(saca)) {
    return "plan_or_proposal_ack_backstop";
  }

  const disqualifier = shortAnswerDisqualifiesOutcomeProof(raw);
  if (
    disqualifier.disqualified &&
    (disqualifier.reason === "short_answer_future_or_intent" ||
      disqualifier.reason === "short_answer_future_plan_intent")
  ) {
    return "plan_or_proposal_ack_backstop";
  }

  return null;
}

function isExplicitProposalRejectionPhrase(raw: string): boolean {
  if (!looksLikeShortProposalRejectionLanguage(raw)) return false;
  const core = normalizeShortAnswerText(raw).normalized;
  return !/^(no|n|nope|nah)$/.test(core);
}

function evaluateUserNoPersistBackstop(args: {
  raw: string;
  inboundMeaning: InboundMeaningFacts;
}): InboundOutcomePersistSkipReason | null {
  const raw = args.raw.trim();
  if (args.inboundMeaning.persistence_decision !== "write_user_no") return null;

  if (
    looksLikeCoachContextCorrectionOrMetaDispute(raw) &&
    !inboundHasExplicitAccountabilityMissClause(raw)
  ) {
    return looksLikeOnboardingProcessDispute(raw)
      ? "onboarding_process_dispute_not_miss"
      : "coach_context_correction_not_miss";
  }

  if (
    args.inboundMeaning.evidence.some((e) =>
      e.includes("onboarding_process_dispute_not_miss")
    )
  ) {
    return "onboarding_process_dispute_not_miss";
  }

  if (
    args.inboundMeaning.evidence.some((e) =>
      e.includes("coach_context_correction_not_miss")
    )
  ) {
    return "coach_context_correction_not_miss";
  }

  if (
    args.inboundMeaning.evidence.some((e) =>
      e.includes("coach_process_dispute_not_miss")
    )
  ) {
    return "coach_process_dispute_not_miss";
  }

  if (inboundHasExplicitMissClause(raw)) return null;

  const m = args.inboundMeaning;
  if (m.relationship_meaning === "answer_to_prior_question") {
    return "plan_or_proposal_rejection_backstop";
  }

  if (
    m.evidence.some(
      (e) =>
        e.includes("plan_proposal_rejection") ||
        e.includes("short_answer_plan_proposal_rejection") ||
        e.includes("short_deny_plan_proposal_rejection") ||
        e.includes("future_negative_not_miss")
    )
  ) {
    return "plan_or_proposal_rejection_backstop";
  }

  if (
    typeof m.reason === "string" &&
    (m.reason.includes("future_negative_not_miss") ||
      m.reason.includes("explicit_miss_blocked_plan_proposal_rejection") ||
      m.reason.includes("short_answer_no_outcome_proof"))
  ) {
    return "plan_or_proposal_rejection_backstop";
  }

  const saca = resolveShortAnswerContextAuthority({ rawInbound: raw });
  if (isPlanRejectionFromShortAnswerContext(saca)) {
    return "plan_or_proposal_rejection_backstop";
  }

  if (
    isNonOutcomePlanPriorQuestionType(saca.prior_question_type) &&
    !saca.outcome_proof_eligible &&
    looksLikeShortProposalRejectionLanguage(raw)
  ) {
    return "plan_or_proposal_rejection_backstop";
  }

  if (isExplicitProposalRejectionPhrase(raw)) {
    return "plan_or_proposal_rejection_backstop";
  }

  return null;
}

function evaluateShouldPersistWithMeaning(
  args: ShouldPersistInboundAccountabilityOutcomeArgs,
  inboundMeaning: InboundMeaningFacts
): ShouldPersistInboundAccountabilityOutcomeResult {
  const messageSid = args.messageSid.trim();
  if (!messageSid) {
    return { persist: false, skipReason: "no_message_sid" };
  }

  const commitmentId = args.commitmentId.trim();
  if (!commitmentId) {
    return { persist: false, skipReason: "no_commitment_id" };
  }

  if (!ACCOUNTABILITY_OUTCOMES.has(args.classifierEventType)) {
    return { persist: false, skipReason: "classifier_not_accountability_outcome" };
  }

  const raw = args.rawBody.trim();
  if (isFutureForwardPlanInbound(raw)) {
    return { persist: false, skipReason: "lane_excluded" };
  }
  if (isGoalIncreaseIntentClarifyInbound(raw)) {
    return { persist: false, skipReason: "lane_excluded" };
  }

  if (args.laneExclusion !== "none") {
    if (args.laneExclusion === "future_forward_plan") {
      return { persist: false, skipReason: "lane_excluded" };
    }
    if (args.laneExclusion === "goal_increase_clarify") {
      return { persist: false, skipReason: "lane_excluded" };
    }
    if (args.laneExclusion === "arc_clarify_only") {
      return { persist: false, skipReason: "arc_clarify_only" };
    }
    return { persist: false, skipReason: "lane_excluded" };
  }

  if (GATED_MODES_BLOCKING_PERSIST.has(args.gatedDecision.mode)) {
    return { persist: false, skipReason: "gated_non_outcome_mode" };
  }

  const persistence = inboundMeaning.persistence_decision;
  if (
    persistence === "defer_to_pending_resolution" ||
    persistence === "defer_to_contract_consent"
  ) {
    return { persist: false, skipReason: "meaning_deferred_route" };
  }
  if (persistence === "ack_only") {
    return { persist: false, skipReason: "meaning_ack_only" };
  }
  if (persistence === "no_outcome_write") {
    return { persist: false, skipReason: "meaning_no_outcome_write" };
  }

  const meaningEventType = persistenceDecisionToOutcomeEventType(persistence);
  if (!meaningEventType) {
    return { persist: false, skipReason: "meaning_no_outcome_write" };
  }

  const livePrompt = args.activeReplyContext?.has_live_accountability_prompt === true;
  const selfContained = args.activeReplyContext?.self_contained_accountability_answer === true;
  const substantiveSelfReportedCompletion = isSubstantiveSelfReportedCompletionForProof(raw);
  const todayCompletionBypass =
    persistence === "write_user_yes_today" &&
    inboundMeaning.relationship_meaning === "reported_completion" &&
    (substantiveSelfReportedCompletion ||
      inboundMeaning.reason === "substantive_self_reported_completion" ||
      inboundMeaning.evidence.some(
        (e) =>
          e.includes("completion") ||
          e.includes("explicit") ||
          e.includes("saca_short_affirm")
      ) ||
      /\b(did it|got my|got in|completed|finished|i did|hit the goal|hit my goal|steps)\b/i.test(raw));
  const sacaShortOutcomeBypass =
    (persistence === "write_user_yes_today" ||
      persistence === "write_user_no" ||
      persistence === "write_user_partial") &&
    inboundMeaning.evidence.some((e) => e.startsWith("saca_short_"));
  const promptOk =
    livePrompt ||
    selfContained ||
    (persistence === "write_user_yes_today" && todayCompletionBypass) ||
    sacaShortOutcomeBypass;

  if (!promptOk) {
    return { persist: false, skipReason: "no_live_accountability_prompt" };
  }

  const overrideGatedNoWrite = args.gatedDecision.should_write_outcome_event === false;

  if (
    !args.gatedDecision.should_write_outcome_event &&
    args.gatedDecision.mode === "clarify" &&
    persistence !== "write_user_yes_today" &&
    !selfContained &&
    !canBypassClarifyGateForExplicitNonYesOutcome({
      rawBody: raw,
      persistence,
      inboundMeaning,
    })
  ) {
    return { persist: false, skipReason: "gated_non_outcome_mode" };
  }

  if (meaningEventType === "user_yes") {
    const backstop = evaluateUserYesPersistBackstop({ raw, inboundMeaning });
    if (backstop) {
      return { persist: false, skipReason: backstop };
    }
  }

  if (meaningEventType === "user_no") {
    const backstop = evaluateUserNoPersistBackstop({ raw, inboundMeaning });
    if (backstop) {
      return { persist: false, skipReason: backstop };
    }
  }

  return {
    persist: true,
    resolvedEventType: meaningEventType,
    liveAccountabilityPromptDetected: livePrompt,
    overrideGatedNoWrite,
  };
}

export function shouldPersistInboundAccountabilityOutcome(
  args: ShouldPersistInboundAccountabilityOutcomeArgs
): ShouldPersistInboundAccountabilityOutcomeResult {
  const raw = args.rawBody.trim();
  const inboundMeaning =
    args.inboundMeaning ??
    buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: args.classifierEventType,
      classifierNormalizedHint: args.classifierNormalizedHint ?? null,
    });

  const baselineResult = evaluateShouldPersistWithMeaning(args, inboundMeaning);
  const tu = args.turnUnderstandingReconciled;
  if (!tu || !isTurnUnderstandingAuthoritative(tu)) {
    return baselineResult;
  }

  const narrowedMeaning: InboundMeaningFacts = {
    ...inboundMeaning,
    persistence_decision: tu.reconciled_persistence_decision,
  };
  const narrowedResult = evaluateShouldPersistWithMeaning(args, narrowedMeaning);

  if (narrowedResult.persist && !baselineResult.persist) {
    const guard = buildTurnUnderstandingPersistGuardMeta({
      turn: tu,
      baselinePersistence: inboundMeaning.persistence_decision,
      effectivePersistence: tu.reconciled_persistence_decision,
      persistAllowed: false,
      guardReason: "turn_understanding_expand_blocked",
    });
    return {
      persist: false,
      skipReason: "turn_understanding_expand_blocked",
      turnUnderstandingPersistGuard: guard,
    };
  }

  if (
    narrowedResult.persist &&
    narrowedResult.resolvedEventType === "user_yes" &&
    shouldBlockClassifierYesForSatisfiedAsk(tu, narrowedMeaning)
  ) {
    const guard = buildTurnUnderstandingPersistGuardMeta({
      turn: tu,
      baselinePersistence: inboundMeaning.persistence_decision,
      effectivePersistence: tu.reconciled_persistence_decision,
      persistAllowed: false,
      guardReason: "turn_understanding_satisfied_ask_no_proof",
    });
    return {
      persist: false,
      skipReason: "turn_understanding_satisfied_ask_no_proof",
      turnUnderstandingPersistGuard: guard,
    };
  }

  const guard = buildTurnUnderstandingPersistGuardMeta({
    turn: tu,
    baselinePersistence: inboundMeaning.persistence_decision,
    effectivePersistence: tu.reconciled_persistence_decision,
    persistAllowed: narrowedResult.persist,
    guardReason: narrowedResult.persist
      ? null
      : narrowedResult.skipReason,
  });

  if (!narrowedResult.persist) {
    return { ...narrowedResult, turnUnderstandingPersistGuard: guard };
  }

  return { ...narrowedResult, turnUnderstandingPersistGuard: guard };
}

export function inboundMeaningPayloadForOutcomePersist(
  meaning: InboundMeaningFacts
): Record<string, unknown> {
  return { inbound_meaning: slimInboundMeaningForFacts(meaning) };
}

export function logInboundOutcomePersistAttempt(args: {
  messageSid: string;
  commitmentId: string;
  branch: InboundOutcomePersistBranch;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  gatedDecision: V2InboundGatedDecision;
  resolvedEventType?: V2AccountabilityOutcome;
  liveAccountabilityPromptDetected: boolean;
  result: InboundOutcomePersistResult | ShouldPersistInboundAccountabilityOutcomeResult;
  idempotencyKey?: string;
}): void {
  const gated = args.gatedDecision;
  const base = {
    message_sid: args.messageSid,
    commitment_id: args.commitmentId,
    branch: args.branch,
    classifier_event_type: args.classifierEventType,
    classifier_normalized_hint: args.classifierNormalizedHint,
    gated_should_write: gated.should_write_outcome_event,
    gated_mode: gated.mode,
    gated_final_event_type: gated.final_event_type,
    resolved_event_type: args.resolvedEventType ?? null,
    live_accountability_prompt_detected: args.liveAccountabilityPromptDetected,
    idempotency_key: args.idempotencyKey ?? null,
  };

  if ("persist" in args.result) {
    if (!args.result.persist) {
      console.info("[inbound-outcome-persist]", {
        ...base,
        outcome_persist_status: "skipped",
        outcome_persist_skip_reason: args.result.skipReason,
      });
      return;
    }
    console.info("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "eligible",
      override_gated_no_write: args.result.overrideGatedNoWrite,
    });
    return;
  }

  if (args.result.status === "skipped") {
    console.info("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "skipped",
      outcome_persist_skip_reason: args.result.skipReason,
    });
    return;
  }

  if (args.result.status === "error") {
    console.warn("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "error",
      outcome_persist_error: args.result.message,
      outcome_persist_error_code: args.result.code ?? null,
    });
    return;
  }

  console.info("[inbound-outcome-persist]", {
    ...base,
    outcome_persist_status: args.result.status,
    override_gated_no_write:
      args.result.status === "inserted" || args.result.status === "duplicate"
        ? args.result.overrideGatedNoWrite
        : false,
  });
}

export type PersistInboundAccountabilityOutcomeEventArgs = {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  rawBody: string;
  eventType: V2AccountabilityOutcome;
  branch: InboundOutcomePersistBranch;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  gatedDecision: V2InboundGatedDecision;
  liveAccountabilityPromptDetected: boolean;
  overrideGatedNoWrite: boolean;
  proofMeta: ProofMomentMeta | null;
  payloadJson: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function persistInboundAccountabilityOutcomeEvent(
  args: PersistInboundAccountabilityOutcomeEventArgs
): Promise<InboundOutcomePersistResult> {
  const idempotencyKey =
    args.idempotencyKey ?? v2UserReplyIdempotencyKey(args.eventType, args.messageSid);

  const payload: Record<string, unknown> = {
    message_sid: args.messageSid,
    source_path: "sms_inbound_accountability",
    outcome_persist_branch: args.branch,
    message: args.rawBody,
    ...(args.classifierNormalizedHint != null
      ? { normalized_hint: args.classifierNormalizedHint }
      : {}),
    ...(args.overrideGatedNoWrite
      ? { outcome_persist_override_gated_no_write: true }
      : {}),
    ...proofMomentPayloadFields(args.proofMeta, args.rawBody),
    ...args.payloadJson,
  };

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: args.eventType,
      source: "sms_v2_accountability",
      payload_json: payload,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return {
        status: "duplicate",
        eventType: args.eventType,
        idempotencyKey,
        overrideGatedNoWrite: args.overrideGatedNoWrite,
      };
    }
    return {
      status: "error",
      message: error.message,
      code,
      eventType: args.eventType,
    };
  }

  if (!data?.id || typeof data.id !== "string") {
    return {
      status: "error",
      message: "insert_succeeded_without_row_id",
      eventType: args.eventType,
    };
  }

  return {
    status: "inserted",
    eventType: args.eventType,
    eventId: data.id,
    idempotencyKey,
    overrideGatedNoWrite: args.overrideGatedNoWrite,
  };
}
