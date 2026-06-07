/**
 * Outcome Claim Evidence Guard (OCEG) — visible SMS must not assert completion/miss/partial without proof.
 */

import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
} from "@/lib/inbound-short-answer-clauses";
import {
  applyInboundFinalBodyTurnUnderstandingGuardAsync,
  type InboundFinalBodyTurnUnderstandingGuardResult,
  type InboundTurnUnderstandingContext,
} from "@/lib/inbound-turn-understanding-context";
import {
  applyPrematureAdjustmentProposalGuard,
  type MissAdjustmentPolicyResult,
  PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND,
} from "@/lib/inbound-miss-adjustment-policy";
import {
  applyRapidNearDuplicateCoachReplyGuard,
  RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
} from "@/lib/inbound-near-duplicate-reply-policy";
import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";

export const UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND =
  "unsupported_accountability_claim_blocked" as const;

export type OutcomeClaimKind = "completion" | "miss" | "partial";

export type UnsupportedAccountabilityClaim = {
  kind: OutcomeClaimKind;
  phrase: string;
};

export type OutcomeClaimEvidenceBundle = {
  rawInbound: string;
  latestOpenQuestion?: string | null;
  expectedReplySemantics?: string | null;
  openQuestionPending?: boolean;
  shortAnswerContext?: ShortAnswerContextAuthority | null;
  inboundMeaning?: InboundMeaningFacts | null;
  turnUnderstandingReconciled?: ReconciledTurnUnderstanding | null;
  persistedOutcomeThisTurn?: "user_yes" | "user_no" | "user_partial" | null;
  willPersistOutcomeThisTurn?: boolean;
  missAdjustmentPolicy?: MissAdjustmentPolicyResult | null;
  finalEventType?: string | null;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
};

const COMPLETION_CLAIM_RE =
  /\b(great to hear you\b.*\b(hit|got|completed|finished|nailed|crushed)|glad you\b.*\b(completed|finished|got|hit)|you\b.*\b(hit|got|completed|finished|nailed|crushed)\b[^.!?]{0,40}\b(steps|goal|calls|hours|workout|commitment)\b|you got it done|strong work getting|good work getting|that's proof|logged as done)\b/i;

const MISS_CLAIM_RE =
  /\b(since you missed|you didn'?t get|you did not get|yesterday was a miss|you fell short|you missed your)\b/i;

const PARTIAL_CLAIM_RE =
  /\b(you got partway|you made a partial attempt|you only did part|partial attempt today)\b/i;

const ASKING_QUESTION_RE = /\?\s*$/;

function tuSupportsClaim(
  tu: ReconciledTurnUnderstanding | null | undefined,
  kind: OutcomeClaimKind
): boolean {
  if (!tu) return false;
  const m = tu.reconciled_relationship_meaning;
  if (kind === "completion" && (m === "reported_completion" || m === "reported_metric_or_result")) {
    return true;
  }
  if (kind === "miss" && m === "miss") return true;
  if (kind === "partial" && m === "partial_attempt") return true;
  return false;
}

function meaningSupportsClaim(
  meaning: InboundMeaningFacts | null | undefined,
  kind: OutcomeClaimKind
): boolean {
  if (!meaning) return false;
  if (kind === "completion" && meaning.relationship_meaning === "reported_completion") {
    return meaning.persistence_decision === "write_user_yes_today" || meaning.persistence_decision === "ack_only";
  }
  if (kind === "miss" && meaning.relationship_meaning === "miss") return true;
  if (kind === "partial" && meaning.relationship_meaning === "partial_attempt") return true;
  return false;
}

export function evidenceAllowsOutcomeClaim(
  kind: OutcomeClaimKind,
  evidence: OutcomeClaimEvidenceBundle
): boolean {
  const raw = evidence.rawInbound.trim();

  if (kind === "completion") {
    if (inboundHasExplicitCompletionClause(raw)) return true;
    if (evidence.shortAnswerContext?.allowed_outbound_claims.completion) return true;
    if (evidence.willPersistOutcomeThisTurn && evidence.persistedOutcomeThisTurn === "user_yes") {
      return true;
    }
    if (meaningSupportsClaim(evidence.inboundMeaning, "completion")) return true;
    if (tuSupportsClaim(evidence.turnUnderstandingReconciled, "completion")) return true;
    return false;
  }

  if (kind === "miss") {
    if (inboundHasExplicitMissClause(raw)) return true;
    if (evidence.shortAnswerContext?.allowed_outbound_claims.miss) return true;
    if (evidence.willPersistOutcomeThisTurn && evidence.persistedOutcomeThisTurn === "user_no") {
      return true;
    }
    if (meaningSupportsClaim(evidence.inboundMeaning, "miss")) return true;
    if (tuSupportsClaim(evidence.turnUnderstandingReconciled, "miss")) return true;
    return false;
  }

  if (kind === "partial") {
    if (inboundHasExplicitPartialClause(raw)) return true;
    if (evidence.shortAnswerContext?.allowed_outbound_claims.partial) return true;
    if (evidence.willPersistOutcomeThisTurn && evidence.persistedOutcomeThisTurn === "user_partial") {
      return true;
    }
    if (meaningSupportsClaim(evidence.inboundMeaning, "partial")) return true;
    if (tuSupportsClaim(evidence.turnUnderstandingReconciled, "partial")) return true;
    return false;
  }

  return false;
}

export function detectUnsupportedAccountabilityClaimInOutbound(
  body: string,
  evidence: OutcomeClaimEvidenceBundle
): UnsupportedAccountabilityClaim | null {
  const t = body.trim();
  if (!t || ASKING_QUESTION_RE.test(t)) return null;

  if (COMPLETION_CLAIM_RE.test(t) && !evidenceAllowsOutcomeClaim("completion", evidence)) {
    const m = t.match(COMPLETION_CLAIM_RE);
    return { kind: "completion", phrase: m?.[0]?.slice(0, 80) ?? "completion_claim" };
  }
  if (MISS_CLAIM_RE.test(t) && !evidenceAllowsOutcomeClaim("miss", evidence)) {
    const m = t.match(MISS_CLAIM_RE);
    return { kind: "miss", phrase: m?.[0]?.slice(0, 80) ?? "miss_claim" };
  }
  if (PARTIAL_CLAIM_RE.test(t) && !evidenceAllowsOutcomeClaim("partial", evidence)) {
    const m = t.match(PARTIAL_CLAIM_RE);
    return { kind: "partial", phrase: m?.[0]?.slice(0, 80) ?? "partial_claim" };
  }
  return null;
}

export type InboundFinalBodyTruthGuardResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: typeof UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND | null;
  metadata: Record<string, unknown>;
};

export type ApplyInboundFinalBodyTruthGuardArgs = {
  body: string;
  evidence: OutcomeClaimEvidenceBundle;
  stage?: string;
  routePurpose?: string;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: import("@/lib/sms-relationship-repair-snapshot-v1").RepairRelationshipSnapshotV1 | null;
};

export async function applyInboundFinalBodyTruthGuard(
  args: ApplyInboundFinalBodyTruthGuardArgs
): Promise<InboundFinalBodyTruthGuardResult> {
  const stage = args.stage ?? "post_turn_understanding_guard";
  const baseMeta: Record<string, unknown> = {
    unsupported_accountability_claim_guard_ran: true,
    unsupported_accountability_claim_guard_stage: stage,
  };

  const violation = detectUnsupportedAccountabilityClaimInOutbound(args.body, args.evidence);
  if (!violation) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        unsupported_accountability_claim_violation_detected: false,
      },
    };
  }

  const blockedReasons = [`unsupported_${violation.kind}_claim`];
  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: args.routePurpose ?? "unsupported_accountability_claim_guard",
    originalBody: args.body,
    blockedReasons,
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    systemInstruction: `TRUTH GUARD: The draft asserts the user ${violation.kind === "completion" ? "completed" : violation.kind === "miss" ? "missed" : "partially completed"} the commitment without evidence. The latest inbound only ${args.evidence.shortAnswerContext?.is_short_contextual_answer ? "answered ambiguously or confirmed a plan" : "did not prove that outcome"}. Do NOT claim completion, miss, or partial. Do NOT reference yesterday/today completion unless the user explicitly reported it this turn. Acknowledge safely, confirm plan agreement, or ask one clarifying question. No hard-coded templates.`,
  });

  if (repair?.body?.trim()) {
    const recheck = detectUnsupportedAccountabilityClaimInOutbound(repair.body, args.evidence);
    if (!recheck) {
      return {
        body: repair.body.trim(),
        shouldSend: true,
        noSendReason: null,
        metadata: {
          ...baseMeta,
          unsupported_accountability_claim_violation_detected: true,
          unsupported_accountability_claim_kind: violation.kind,
          unsupported_accountability_claim_phrase: violation.phrase,
          unsupported_accountability_claim_repair_attempted: true,
          unsupported_accountability_claim_repair_succeeded: true,
          unsupported_accountability_claim_repair_metadata: repair.metadata,
        },
      };
    }
  }

  return {
    body: "",
    shouldSend: false,
    noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
    metadata: {
      ...baseMeta,
      unsupported_accountability_claim_violation_detected: true,
      unsupported_accountability_claim_kind: violation.kind,
      unsupported_accountability_claim_phrase: violation.phrase,
      unsupported_accountability_claim_repair_attempted: Boolean(repair),
      unsupported_accountability_claim_repair_succeeded: false,
      unsupported_accountability_claim_no_send_reason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
    },
  };
}

export type InboundCoachFinalBodyGuardsResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  tuGuard: InboundFinalBodyTurnUnderstandingGuardResult;
  prematureAdjustmentGuard: import("@/lib/inbound-miss-adjustment-policy").PrematureAdjustmentProposalGuardResult | null;
  truthGuard: InboundFinalBodyTruthGuardResult | null;
  nearDuplicateGuard: import("@/lib/inbound-near-duplicate-reply-policy").RapidNearDuplicateCoachReplyGuardResult | null;
};

export async function applyInboundCoachFinalBodyGuards(args: {
  body: string;
  turnUnderstandingContext: InboundTurnUnderstandingContext | null | undefined;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  evidence: OutcomeClaimEvidenceBundle;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: ApplyInboundFinalBodyTruthGuardArgs["repairSnapshot"];
  stage?: string;
  routePurpose?: string;
  /** Test hook — defaults to Date.now() in near-duplicate recency checks. */
  nowMs?: number;
}): Promise<InboundCoachFinalBodyGuardsResult> {
  const tuGuard = await applyInboundFinalBodyTurnUnderstandingGuardAsync({
    body: args.body,
    context: args.turnUnderstandingContext,
    latestOpenQuestion: args.latestOpenQuestion,
    lastCoachOutbound: args.lastCoachOutbound,
    stage: args.stage ?? "pre_truth_guard",
    routePurpose: args.routePurpose,
    factsJson: args.factsJson,
    repairSnapshot: args.repairSnapshot,
    rawInbound: args.evidence.rawInbound,
    inboundMeaning: args.evidence.inboundMeaning,
  });

  if (!tuGuard.shouldSend) {
    return {
      body: tuGuard.body,
      shouldSend: false,
      noSendReason: tuGuard.noSendReason,
      tuGuard,
      prematureAdjustmentGuard: null,
      truthGuard: null,
      nearDuplicateGuard: null,
    };
  }

  const prematureAdjustmentGuard = await applyPrematureAdjustmentProposalGuard({
    body: tuGuard.body,
    policy: args.evidence.missAdjustmentPolicy,
    inboundMeaning: args.evidence.inboundMeaning,
    finalEventType: args.evidence.finalEventType ?? null,
    routePurpose: args.routePurpose,
    factsJson: args.factsJson,
    repairSnapshot: args.repairSnapshot,
    stage: "post_turn_understanding_premature_adjustment",
  });

  if (!prematureAdjustmentGuard.shouldSend) {
    return {
      body: prematureAdjustmentGuard.body,
      shouldSend: false,
      noSendReason:
        prematureAdjustmentGuard.noSendReason ?? PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND,
      tuGuard,
      prematureAdjustmentGuard,
      truthGuard: null,
      nearDuplicateGuard: null,
    };
  }

  const truthGuard = await applyInboundFinalBodyTruthGuard({
    body: prematureAdjustmentGuard.body,
    evidence: args.evidence,
    stage: "post_turn_understanding_guard",
    routePurpose: args.routePurpose,
    factsJson: args.factsJson,
    repairSnapshot: args.repairSnapshot,
  });

  if (!truthGuard.shouldSend) {
    return {
      body: truthGuard.body,
      shouldSend: false,
      noSendReason: truthGuard.noSendReason,
      tuGuard,
      prematureAdjustmentGuard,
      truthGuard,
      nearDuplicateGuard: null,
    };
  }

  const nearDuplicateGuard = await applyRapidNearDuplicateCoachReplyGuard({
    body: truthGuard.body,
    priorCoachBody: args.evidence.priorCoachBody ?? args.lastCoachOutbound ?? null,
    priorCoachSentAt: args.evidence.priorCoachSentAt ?? null,
    inboundRaw: args.evidence.rawInbound,
    nowMs: args.nowMs,
    routePurpose: args.routePurpose,
    factsJson: args.factsJson,
    repairSnapshot: args.repairSnapshot,
    stage: "post_oceg_near_duplicate",
  });

  if (!nearDuplicateGuard.shouldSend) {
    return {
      body: nearDuplicateGuard.body,
      shouldSend: false,
      noSendReason: nearDuplicateGuard.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      tuGuard,
      prematureAdjustmentGuard,
      truthGuard,
      nearDuplicateGuard,
    };
  }

  let finalBody = nearDuplicateGuard.body;
  let finalTruthGuard = truthGuard;

  const postNearDupOcegViolation = detectUnsupportedAccountabilityClaimInOutbound(
    finalBody,
    args.evidence
  );
  if (postNearDupOcegViolation) {
    const truthRecheck = await applyInboundFinalBodyTruthGuard({
      body: finalBody,
      evidence: args.evidence,
      stage: "post_near_duplicate_oceg_recheck",
      routePurpose: args.routePurpose,
      factsJson: args.factsJson,
      repairSnapshot: args.repairSnapshot,
    });
    finalTruthGuard = truthRecheck;
    if (!truthRecheck.shouldSend) {
      return {
        body: truthRecheck.body,
        shouldSend: false,
        noSendReason: truthRecheck.noSendReason,
        tuGuard,
        prematureAdjustmentGuard,
        truthGuard: finalTruthGuard,
        nearDuplicateGuard,
      };
    }
    finalBody = truthRecheck.body;
  }

  return {
    body: finalBody,
    shouldSend: true,
    noSendReason: null,
    tuGuard,
    prematureAdjustmentGuard,
    truthGuard: finalTruthGuard,
    nearDuplicateGuard,
  };
}
