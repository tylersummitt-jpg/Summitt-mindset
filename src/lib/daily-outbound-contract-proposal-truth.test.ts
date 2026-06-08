import { describe, expect, it } from "vitest";

import {
  DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND,
  DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND,
  DAILY_CONTRACT_PROPOSAL_TRUTH_VIOLATION_NO_SEND,
  detectDailyOutboundFalseProposalStateClaims,
  evaluatePostUnifiedGuardDailyContractProposalTruthRecheck,
} from "@/lib/daily-outbound-contract-proposal-truth";
import type { DailySemanticContractProposalFactsPacket } from "@/lib/v3-daily-contract-proposal-semantic";

const shrinkAsk = "30 minutes of deep work before noon";
const baseBehavior = "60 minutes of deep work every morning";

function shrinkFacts(): DailySemanticContractProposalFactsPacket {
  return {
    proposal_kind: "shrink_ask",
    duration_days: 7,
    base_behavior_statement: baseBehavior,
    proposed_overlay_ask: shrinkAsk,
    proposed_behavior_preview: shrinkAsk,
    desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
    must_not_claim_goal_updated: true,
    forbidden_phrases: [],
  };
}

function recommitFacts(): DailySemanticContractProposalFactsPacket {
  return {
    proposal_kind: "recommit_same",
    duration_days: 7,
    base_behavior_statement: baseBehavior,
    proposed_overlay_ask: null,
    proposed_behavior_preview: baseBehavior,
    desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
    must_not_claim_goal_updated: true,
    forbidden_phrases: [],
  };
}

describe("evaluatePostUnifiedGuardDailyContractProposalTruthRecheck", () => {
  it("valid shrink proposal passes", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `Would ${shrinkAsk} work better for you this week — want to try that bar?`,
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      canonicalProposalAskTrim: shrinkAsk,
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(false);
  });

  it("valid recommit proposal passes", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `Want to keep holding the same line — ${baseBehavior.slice(0, 40)} — for another week?`,
      proposalKind: "recommit_same",
      dailyContractSemanticFacts: recommitFacts(),
      canonicalProposalAskTrim: baseBehavior,
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(false);
  });

  it("goal already updated blocked", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `Your goal already changed to ${shrinkAsk}. Sound good?`,
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("proposal active / accepted blocked", () => {
    expect(
      detectDailyOutboundFalseProposalStateClaims("The proposal is active — you're all set.")
    ).toContain("proposal_active");
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `Would ${shrinkAsk} work for you this week? You already accepted it and the proposal is active.`,
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("missing shrink proposed bar signal blocked", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: "Want to adjust something this week?",
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
    expect(r.semanticReasonCode).toBe("missing_proposed_behavior_signal");
  });

  it("robotic Reply YES blocked", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `${shrinkAsk}. Reply YES to confirm or NO to discard.`,
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("internal label user_yes blocked", () => {
    const r = evaluatePostUnifiedGuardDailyContractProposalTruthRecheck({
      body: `Try ${shrinkAsk} — reply user_yes if that works?`,
      proposalKind: "shrink_ask",
      dailyContractSemanticFacts: shrinkFacts(),
      baseBehaviorStatement: baseBehavior,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_CONTRACT_PROPOSAL_TRUTH_VIOLATION_NO_SEND);
  });
});
