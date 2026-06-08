/**
 * Phase 2.3-B — evidence for weekly outbound unified final guard (weekly_proof_v2 only).
 */

import type { OutcomeClaimEvidenceBundle } from "@/lib/inbound-final-body-truth-guard";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { detectTimingAnchorVoiceViolations } from "@/lib/timing-anchor-memory";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";

export const OUTBOUND_WEEKLY_WIRED_ROUTE_PURPOSES = ["weekly_proof_v2"] as const;

export type OutboundWeeklyWiredRoutePurpose = (typeof OUTBOUND_WEEKLY_WIRED_ROUTE_PURPOSES)[number];

export function isOutboundWeeklyWiredRoutePurpose(
  routePurpose: string | null | undefined
): routePurpose is OutboundWeeklyWiredRoutePurpose {
  return routePurpose === "weekly_proof_v2";
}

export type WeeklyOutboundProofGuardFacts = {
  weekStart: string;
  weekEnd: string;
  completedCount: number;
  missedCount: number;
  partialCount: number;
  silentWeek: boolean;
  roughWeek: boolean;
  strongWeek: boolean;
  proofMomentHints: string[];
  blockerPreview: string | null;
  responseCount: number;
  checkSentCount: number;
};

export type WeeklyOutboundUnifiedGuardCtx = {
  routeKind: OutboundWeeklyWiredRoutePurpose;
  clerkUserId: string;
  commitmentId: string;
  priorCoachBody: string | null;
  priorCoachSentAt: string | null;
  effectiveAsk: string | null;
  identityAnchor: string | null;
  weeklyProof: WeeklyOutboundProofGuardFacts;
  hasProofOrKnownOutcome: boolean;
};

export function deriveWeeklyRoughWeek(pack: Pick<
  V2WeeklyProofPack,
  "silent_week" | "yes_count" | "no_count" | "partial_count" | "response_count" | "comeback_after_miss"
>): boolean {
  const y = pack.yes_count;
  const neg = pack.no_count + pack.partial_count;
  return (
    pack.silent_week ||
    (pack.response_count > 0 && neg > y && !(pack.comeback_after_miss && y >= 1))
  );
}

export function deriveWeeklyStrongWeek(
  pack: Pick<V2WeeklyProofPack, "yes_count" | "no_count" | "partial_count">
): boolean {
  const y = pack.yes_count;
  const neg = pack.no_count + pack.partial_count;
  return y >= 3 && y > neg;
}

export function inferHasProofOrKnownOutcomeForWeekly(args: {
  proofMomentHints: string[];
  strongWeek: boolean;
  completedCount: number;
}): boolean {
  if (args.proofMomentHints.length > 0) return true;
  if (args.strongWeek) return true;
  if (args.completedCount >= +2) return true;
  return false;
}

export function buildWeeklyOutboundProofGuardFactsFromPack(
  pack: V2WeeklyProofPack,
  roughWeek?: boolean
): WeeklyOutboundProofGuardFacts {
  const strongWeek = deriveWeeklyStrongWeek(pack);
  const resolvedRough = roughWeek ?? deriveWeeklyRoughWeek(pack);
  return {
    weekStart: pack.week_start,
    weekEnd: pack.week_end,
    completedCount: pack.yes_count,
    missedCount: pack.no_count,
    partialCount: pack.partial_count,
    silentWeek: pack.silent_week,
    roughWeek: resolvedRough,
    strongWeek,
    proofMomentHints: pack.proof_moment_hints.slice(0, 8),
    blockerPreview: pack.blocker_preview_short,
    responseCount: pack.response_count,
    checkSentCount: pack.check_sent_count,
  };
}

export function buildWeeklyOutboundUnifiedGuardCtx(args: {
  routeKind: OutboundWeeklyWiredRoutePurpose;
  clerkUserId: string;
  commitmentId: string;
  pack: V2WeeklyProofPack;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  effectiveAsk?: string | null;
  identityAnchor?: string | null;
  roughWeek?: boolean;
}): WeeklyOutboundUnifiedGuardCtx {
  const weeklyProof = buildWeeklyOutboundProofGuardFactsFromPack(args.pack, args.roughWeek);
  const hasProofOrKnownOutcome = inferHasProofOrKnownOutcomeForWeekly({
    proofMomentHints: weeklyProof.proofMomentHints,
    strongWeek: weeklyProof.strongWeek,
    completedCount: weeklyProof.completedCount,
  });

  return {
    routeKind: args.routeKind,
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitmentId,
    priorCoachBody: args.priorCoachBody?.trim() || null,
    priorCoachSentAt: args.priorCoachSentAt?.trim() || null,
    effectiveAsk: args.effectiveAsk?.trim() || null,
    identityAnchor: args.identityAnchor?.trim() || null,
    weeklyProof,
    hasProofOrKnownOutcome,
  };
}

export function buildWeeklyOutboundOcegEvidence(
  ctx: WeeklyOutboundUnifiedGuardCtx
): OutcomeClaimEvidenceBundle {
  const wp = ctx.weeklyProof;
  const shortAnswerContext: ShortAnswerContextAuthority = {
    is_short_contextual_answer: false,
    short_answer_polarity: "unclear",
    prior_question_type: "outcome_check",
    outcome_proof_eligible: ctx.hasProofOrKnownOutcome,
    allowed_persistence: "no_outcome_write",
    allowed_outbound_claims: {
      completion: wp.completedCount >= 1,
      miss: wp.missedCount >= 1,
      partial: wp.partialCount >= 1,
    },
    response_intent_hint: null,
    reason: "weekly_outbound_proof_evidence",
  };

  return {
    rawInbound: "",
    shortAnswerContext,
    finalEventType: null,
    priorCoachBody: ctx.priorCoachBody,
    priorCoachSentAt: ctx.priorCoachSentAt,
  };
}

export const OUTBOUND_WEEKLY_UNSUPPORTED_PROOF_NO_SEND =
  "weekly_unsupported_proof_or_victory_after_unified_guard" as const;

export const OUTBOUND_WEEKLY_INTERNAL_LABEL_NO_SEND =
  "weekly_internal_label_after_unified_guard" as const;

const VICTORY_ROOM_CLAIM_RE = /\bvictory\s+room\b/i;
const EXPLICIT_PROOF_CLAIM_RE =
  /\b(that'?s|this is|counts as|count as)\s+proof\b|\byou\s+proved\b|\bproof\s+moment\b|\bmilestone\b/i;
const YOU_COMPLETED_EVERY_DAY_RE =
  /\b(completed|did|hit|showed up)\s+(?:it\s+)?every\s+day\b|\bevery\s+single\s+day\b/i;

export function detectWeeklyOutboundUnsupportedProofClaim(
  body: string,
  ctx: Pick<WeeklyOutboundUnifiedGuardCtx, "hasProofOrKnownOutcome" | "weeklyProof">
): { violation: string; phrase: string } | null {
  const t = body.trim();
  if (!t) return null;

  if (VICTORY_ROOM_CLAIM_RE.test(t)) {
    const m = t.match(VICTORY_ROOM_CLAIM_RE);
    return { violation: "unsupported_victory_room_claim", phrase: m?.[0] ?? "victory room" };
  }

  if (!ctx.hasProofOrKnownOutcome) {
    if (EXPLICIT_PROOF_CLAIM_RE.test(t)) {
      const m = t.match(EXPLICIT_PROOF_CLAIM_RE);
      return { violation: "unsupported_proof_claim", phrase: m?.[0] ?? "proof claim" };
    }
    if (YOU_COMPLETED_EVERY_DAY_RE.test(t)) {
      const m = t.match(YOU_COMPLETED_EVERY_DAY_RE);
      return {
        violation: "unsupported_every_day_proof_claim",
        phrase: m?.[0] ?? "every day claim",
      };
    }

    const timingHits = detectTimingAnchorVoiceViolations({
      body: t,
      pendingPlanProof: null,
      hasProofOrKnownOutcome: false,
    }).filter((h) => h.startsWith("unearned_"));

    if (timingHits.length > 0) {
      return { violation: timingHits[0], phrase: timingHits[0] };
    }
  }

  return null;
}
