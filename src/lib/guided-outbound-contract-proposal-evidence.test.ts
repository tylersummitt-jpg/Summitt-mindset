import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import {
  GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
  buildGuidedShrinkContractProposalSemanticFacts,
  buildGuidedShrinkOutboundDailyGuardArgs,
} from "@/lib/guided-outbound-contract-proposal-evidence";
import { isOutboundDailyC2RoutePurpose } from "@/lib/daily-outbound-final-guard-evidence";

vi.mock("@/lib/sms-relationship-memory-packet", () => ({
  buildSmsRelationshipMemoryPacket: vi.fn(async () => ({
    last_outbound_full_body: "Did you get your deep work block in today?",
    recent_exact_thread_72h: { newest_at: "2026-05-09T08:00:00.000Z" },
  })),
}));

const PROPOSED = "Walk ten minutes daily";
const BASE = "Two hours of deep work each morning";

describe("buildGuidedShrinkContractProposalSemanticFacts", () => {
  it("builds shrink_ask semantic facts with must_not_claim_goal_updated", () => {
    const facts = buildGuidedShrinkContractProposalSemanticFacts({
      proposalBindingText: PROPOSED,
      originalBehaviorStatement: BASE,
    });
    expect(facts.proposal_kind).toBe("shrink_ask");
    expect(facts.proposed_overlay_ask).toBe(PROPOSED);
    expect(facts.base_behavior_statement).toBe(BASE);
    expect(facts.must_not_claim_goal_updated).toBe(true);
  });
});

describe("buildGuidedShrinkOutboundDailyGuardArgs", () => {
  it("uses guided_shrink_contract_prompt C2 route purpose", async () => {
    const args = await buildGuidedShrinkOutboundDailyGuardArgs({
      body: `Would ${PROPOSED} work for you this week?`,
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      proposalBindingText: PROPOSED,
      originalBehaviorStatement: BASE,
    });
    expect(args.routePurpose).toBe(GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE);
    expect(isOutboundDailyC2RoutePurpose(args.routePurpose)).toBe(true);
    expect(args.dailyGuardCtx.proposalKind).toBe("shrink_ask");
    expect(args.dailyGuardCtx.contractSemanticFacts?.proposed_overlay_ask).toBe(PROPOSED);
    expect(args.priorCoachBody).toContain("deep work");
    expect(args.evidence.shortAnswerContext.allowed_outbound_claims).toEqual({
      completion: false,
      miss: false,
      partial: false,
    });
  });
});
