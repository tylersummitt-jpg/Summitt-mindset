/**
 * Phase 2.4a — guided shrink API outbound_daily C2-equivalent guard evidence.
 */

import {
  buildDailyOutboundOcegEvidence,
  buildDailyOutboundUnifiedGuardCtx,
} from "@/lib/daily-outbound-final-guard-evidence";
import {
  DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES,
  type DailySemanticContractProposalFactsPacket,
} from "@/lib/v3-daily-contract-proposal-semantic";
import { buildSmsRelationshipMemoryPacket } from "@/lib/sms-relationship-memory-packet";
import type { OutboundDailyGuardArgs } from "@/lib/sms-final-product-law-guard";

export const GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE = "guided_shrink_contract_prompt" as const;

export function buildGuidedShrinkContractProposalSemanticFacts(args: {
  proposalBindingText: string;
  originalBehaviorStatement: string;
}): DailySemanticContractProposalFactsPacket {
  const proposed = args.proposalBindingText.trim();
  const base = args.originalBehaviorStatement.trim();
  return {
    proposal_kind: "shrink_ask",
    duration_days: 7,
    base_behavior_statement: base,
    proposed_overlay_ask: proposed,
    proposed_behavior_preview: proposed,
    desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
    must_not_claim_goal_updated: true,
    forbidden_phrases: [...DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES],
  };
}

export async function buildGuidedShrinkOutboundDailyGuardArgs(args: {
  body: string;
  clerkUserId: string;
  commitmentId: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
}): Promise<OutboundDailyGuardArgs> {
  const proposed = args.proposalBindingText.trim();
  const semFacts = buildGuidedShrinkContractProposalSemanticFacts({
    proposalBindingText: proposed,
    originalBehaviorStatement: args.originalBehaviorStatement,
  });

  let priorCoachBody = args.priorCoachBody?.trim() || null;
  let priorCoachSentAt = args.priorCoachSentAt?.trim() || null;

  if (!priorCoachBody) {
    try {
      const mem = await buildSmsRelationshipMemoryPacket({
        clerkUserId: args.clerkUserId,
        commitmentId: args.commitmentId,
      });
      priorCoachBody = mem.last_outbound_full_body?.trim() || null;
      const coachAt = mem.recent_exact_thread_72h?.newest_at?.trim();
      if (coachAt) priorCoachSentAt = coachAt;
    } catch {
      // Optional context — near-dup still works with null prior body.
    }
  }

  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitmentId,
    priorCoachBody,
    priorCoachSentAt,
    proposalKind: "shrink_ask",
    contractSemanticFacts: semFacts,
    canonicalProposalAskTrim: proposed,
    baseBehaviorStatement: args.originalBehaviorStatement.trim(),
    proposalPending: false,
  });

  return {
    body: args.body.trim(),
    evidence: buildDailyOutboundOcegEvidence(ctx),
    dailyGuardCtx: ctx,
    priorCoachBody: ctx.priorCoachBody,
    priorCoachSentAt: ctx.priorCoachSentAt,
    routePurpose: GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
    nearDuplicateStage: "guided_shrink_outbound_near_duplicate",
    ocegStage: "guided_shrink_outbound_oceg",
  };
}
