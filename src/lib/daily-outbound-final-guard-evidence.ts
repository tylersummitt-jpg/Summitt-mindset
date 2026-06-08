/**
 * Phase 2.3-C1 — evidence for daily outbound unified final guard (main + reactivation only).
 */

import type { OutcomeClaimEvidenceBundle } from "@/lib/inbound-final-body-truth-guard";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import {
  detectTimingAnchorVoiceViolations,
  inferHasProofOrKnownOutcomeForDailyAccountability,
} from "@/lib/timing-anchor-memory";
import type { PendingPlanProofFact } from "@/lib/pending-plan-proof";
import type { DailyV3RouteKind } from "@/lib/v3-daily-relationship-lane";

export const OUTBOUND_DAILY_C1_ROUTE_PURPOSES = [
  "main_active_accountability",
  "low_pressure_reactivation",
] as const;

export type OutboundDailyC1RoutePurpose = (typeof OUTBOUND_DAILY_C1_ROUTE_PURPOSES)[number];

export function isOutboundDailyC1RoutePurpose(
  routePurpose: string | null | undefined
): routePurpose is OutboundDailyC1RoutePurpose {
  return (
    routePurpose === "main_active_accountability" || routePurpose === "low_pressure_reactivation"
  );
}

export type DailyOutboundUnifiedGuardCtx = {
  routeKind: OutboundDailyC1RoutePurpose;
  clerkUserId: string;
  commitmentId: string;
  priorCoachBody: string | null;
  priorCoachSentAt: string | null;
  lastInboundBody: string | null;
  priorOutcome: string | null;
  pendingPlanProof: PendingPlanProofFact | null;
  proofOrMilestoneSignal: string | null;
  hasProofOrKnownOutcome: boolean;
};

export function buildDailyOutboundUnifiedGuardCtx(args: {
  routeKind: OutboundDailyC1RoutePurpose;
  clerkUserId: string;
  commitmentId: string;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  lastInboundBody?: string | null;
  priorOutcome?: string | null;
  pendingPlanProof?: PendingPlanProofFact | null;
  proofOrMilestoneSignal?: string | null;
}): DailyOutboundUnifiedGuardCtx {
  const pendingPlanProof = args.pendingPlanProof ?? null;
  const priorOutcome = args.priorOutcome?.trim() || null;
  const proofOrMilestoneSignal = args.proofOrMilestoneSignal?.trim() || null;
  const hasProofOrKnownOutcome = inferHasProofOrKnownOutcomeForDailyAccountability({
    pending_plan_proof: pendingPlanProof,
    prior_outcome: priorOutcome,
    proof_or_milestone_signal: proofOrMilestoneSignal,
  });

  return {
    routeKind: args.routeKind,
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitmentId,
    priorCoachBody: args.priorCoachBody?.trim() || null,
    priorCoachSentAt: args.priorCoachSentAt?.trim() || null,
    lastInboundBody: args.lastInboundBody?.trim() || null,
    priorOutcome,
    pendingPlanProof,
    proofOrMilestoneSignal,
    hasProofOrKnownOutcome,
  };
}

function dailyAllowedOutboundClaims(priorOutcome: string | null): ShortAnswerContextAuthority["allowed_outbound_claims"] {
  const yes = priorOutcome === "user_yes";
  const no = priorOutcome === "user_no";
  const partial = priorOutcome === "user_partial";
  return {
    completion: yes,
    miss: no,
    partial,
  };
}

export function buildDailyOutboundOcegEvidence(
  ctx: DailyOutboundUnifiedGuardCtx
): OutcomeClaimEvidenceBundle {
  const allowed = dailyAllowedOutboundClaims(ctx.priorOutcome);
  const shortAnswerContext: ShortAnswerContextAuthority = {
    is_short_contextual_answer: Boolean(ctx.lastInboundBody?.trim()),
    short_answer_polarity:
      ctx.priorOutcome === "user_yes"
        ? "affirm"
        : ctx.priorOutcome === "user_no"
          ? "deny"
          : ctx.priorOutcome === "user_partial"
            ? "unclear"
            : "unclear",
    prior_question_type: "outcome_check",
    outcome_proof_eligible: ctx.hasProofOrKnownOutcome,
    allowed_persistence: "no_outcome_write",
    allowed_outbound_claims: allowed,
    response_intent_hint: null,
    reason: "daily_outbound_c1_evidence",
  };

  return {
    rawInbound: ctx.lastInboundBody ?? "",
    shortAnswerContext,
    finalEventType: ctx.priorOutcome,
    priorCoachBody: ctx.priorCoachBody,
    priorCoachSentAt: ctx.priorCoachSentAt,
  };
}

export const OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND =
  "outbound_daily_unsupported_proof_claim_blocked" as const;

export const OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND =
  "outbound_daily_internal_label_blocked" as const;

const VICTORY_ROOM_CLAIM_RE = /\bvictory\s+room\b/i;
const EXPLICIT_PROOF_CLAIM_RE = /\b(that'?s|this is)\s+proof\b/i;

export function detectDailyOutboundUnsupportedProofClaim(
  body: string,
  ctx: Pick<DailyOutboundUnifiedGuardCtx, "hasProofOrKnownOutcome" | "pendingPlanProof">
): { violation: string; phrase: string } | null {
  const t = body.trim();
  if (!t) return null;
  if (ctx.hasProofOrKnownOutcome) return null;

  if (VICTORY_ROOM_CLAIM_RE.test(t)) {
    const m = t.match(VICTORY_ROOM_CLAIM_RE);
    return { violation: "unsupported_victory_room_claim", phrase: m?.[0] ?? "victory room" };
  }
  if (EXPLICIT_PROOF_CLAIM_RE.test(t)) {
    const m = t.match(EXPLICIT_PROOF_CLAIM_RE);
    return { violation: "unsupported_proof_claim", phrase: m?.[0] ?? "proof claim" };
  }

  const timingHits = detectTimingAnchorVoiceViolations({
    body: t,
    pendingPlanProof: ctx.pendingPlanProof,
    hasProofOrKnownOutcome: false,
  }).filter((h) => h.startsWith("unearned_"));

  if (timingHits.length > 0) {
    return { violation: timingHits[0], phrase: timingHits[0] };
  }

  return null;
}

export function resolveDailyBuiltRouteKind(args: {
  v2ReactivationNudge?: boolean;
  v2ContractProposalMode?: boolean;
  v2PendingResolutionReminder?: boolean;
  v2RefreshOutboundPlan?: { kind: string } | null;
}): DailyV3RouteKind {
  if (args.v2ReactivationNudge) return "low_pressure_reactivation";
  if (args.v2ContractProposalMode) return "contract_prompt";
  if (args.v2PendingResolutionReminder) return "pending_resolution";
  if (args.v2RefreshOutboundPlan?.kind === "identity_first") return "refresh_identity";
  if (args.v2RefreshOutboundPlan) return "refresh_commitment";
  return "main_active_accountability";
}
