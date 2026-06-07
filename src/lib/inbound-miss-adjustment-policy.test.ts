import { describe, expect, it } from "vitest";

import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  applyPrematureAdjustmentProposalGuard,
  buildSingleMissRecoveryLaneGuardrails,
  buildSingleMissRecoveryRequiredMeaningSummary,
  deriveAdjustmentProposalAllowedByEvidence,
  detectPrematureCommitmentAdjustmentProposal,
  inboundUserRequestedGoalAdjustment,
  PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND,
} from "@/lib/inbound-miss-adjustment-policy";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const MS_DAY = 86400000;
const NOW = Date.parse("2026-06-07T12:00:00.000Z");

function outcome(daysAgo: number, eventType: "user_no" | "user_partial"): V2EventRowForAi {
  return {
    event_type: eventType,
    occurred_at: new Date(NOW - daysAgo * MS_DAY).toISOString(),
    payload_json: {},
  } as V2EventRowForAi;
}

function missMeaning(raw = "I did not hit my goal yesterday") {
  return buildInboundMeaningFacts({
    rawInbound: raw,
    classifierEventType: "user_partial",
  });
}

describe("deriveAdjustmentProposalAllowedByEvidence", () => {
  it("A: single explicit miss → not allowed, recovery required", () => {
    const m = missMeaning();
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: m,
      inboundRaw: "I did not hit my goal yesterday",
      finalEventType: "user_partial",
      eventsNewestFirst: [],
      nowMs: NOW,
    });
    expect(r.adjustment_proposal_allowed_by_evidence).toBe(false);
    expect(r.single_miss_recovery_required).toBe(true);
    expect(r.adjustment_evidence_reason).toBe("not_allowed_single_miss");
  });

  it("B: repeated miss evidence → allowed", () => {
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      inboundRaw: "I missed again",
      eventsNewestFirst: [outcome(2, "user_no"), outcome(5, "user_no")],
      patternSignal: { canonical: "time_pressure", confidence: "medium", mentionAllowed: true },
      nowMs: NOW,
    });
    expect(r.adjustment_proposal_allowed_by_evidence).toBe(true);
    expect(r.adjustment_evidence_reason).toBe("repeated_miss_pattern");
    expect(r.single_miss_recovery_required).toBe(false);
  });

  it("C: user asks to adjust → allowed", () => {
    const raw = "I need to change the goal";
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(raw),
      inboundRaw: raw,
      eventsNewestFirst: [],
      nowMs: NOW,
    });
    expect(r.adjustment_proposal_allowed_by_evidence).toBe(true);
    expect(r.adjustment_evidence_reason).toBe("user_requested_adjustment");
  });

  it("D: active adaptive proposal → allowed", () => {
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      inboundRaw: "I missed it",
      adaptiveProposalPending: true,
      nowMs: NOW,
    });
    expect(r.adjustment_proposal_allowed_by_evidence).toBe(true);
    expect(r.adjustment_evidence_reason).toBe("active_adaptive_proposal");
  });

  it("D2: pending resolution → allowed", () => {
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      pendingResolutionActive: true,
      nowMs: NOW,
    });
    expect(r.adjustment_proposal_allowed_by_evidence).toBe(true);
    expect(r.adjustment_evidence_reason).toBe("pending_resolution");
  });

  it("E: not a miss turn → guard inactive", () => {
    const yes = buildInboundMeaningFacts({
      rawInbound: "Yes I did it",
      classifierEventType: "user_yes",
    });
    const r = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: yes,
      finalEventType: "user_yes",
    });
    expect(r.adjustment_evidence_reason).toBe("not_a_miss_turn");
    expect(r.single_miss_recovery_required).toBe(false);
  });
});

describe("detectPrematureCommitmentAdjustmentProposal", () => {
  it("F: let's adjust + committing sound → true", () => {
    expect(
      detectPrematureCommitmentAdjustmentProposal(
        "Let's adjust our approach. How does committing to one hour sound?"
      )
    ).toBe(true);
  });

  it("G: how do you feel about committing → true", () => {
    expect(
      detectPrematureCommitmentAdjustmentProposal(
        "How do you feel about committing to one hour of distribution per day?"
      )
    ).toBe(true);
  });

  it("H: would you like to adjust the goal → true", () => {
    expect(detectPrematureCommitmentAdjustmentProposal("Would you like to adjust the goal?")).toBe(
      true
    );
  });

  it("I: reflective before changing → false", () => {
    expect(
      detectPrematureCommitmentAdjustmentProposal(
        "Let's understand what got in the way before changing anything."
      )
    ).toBe(false);
  });

  it("J: what got in the way → false", () => {
    expect(detectPrematureCommitmentAdjustmentProposal("What got in the way yesterday?")).toBe(
      false
    );
  });

  it("K: recovery question → false", () => {
    expect(
      detectPrematureCommitmentAdjustmentProposal("What would help you recover today?")
    ).toBe(false);
  });
});

describe("buildSingleMissRecoveryLaneGuardrails", () => {
  it("L: includes blocker-first instruction when recovery required", () => {
    const policy = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      inboundRaw: "I did not hit my goal yesterday",
    });
    const g = buildSingleMissRecoveryLaneGuardrails(policy);
    expect(g).toContain("adjustment_proposal_allowed_by_evidence is false");
    expect(g).toMatch(/what got in the way/i);
    expect(buildSingleMissRecoveryRequiredMeaningSummary(policy)).toMatch(/what got in the way/i);
  });
});

describe("applyPrematureAdjustmentProposalGuard", () => {
  it("M: miss + premature proposal + no evidence → no-send when repair fails", async () => {
    const policy = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      inboundRaw: "I did not hit my goal yesterday",
    });
    const r = await applyPrematureAdjustmentProposalGuard({
      body: "Let's adjust our approach. How does committing to one hour of distribution per day sound?",
      policy,
      inboundMeaning: missMeaning(),
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe(PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND);
  });

  it("N: miss + recovery question → allowed", async () => {
    const policy = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
    });
    const r = await applyPrematureAdjustmentProposalGuard({
      body: "What got in the way yesterday?",
      policy,
      inboundMeaning: missMeaning(),
    });
    expect(r.shouldSend).toBe(true);
  });

  it("O: repeated miss policy → adjustment candidate allowed", async () => {
    const policy = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(),
      eventsNewestFirst: [outcome(2, "user_no"), outcome(4, "user_no")],
      patternSignal: { canonical: "time_pressure", confidence: "medium", mentionAllowed: true },
      nowMs: NOW,
    });
    const r = await applyPrematureAdjustmentProposalGuard({
      body: "How does adjusting the plan sound?",
      policy,
      inboundMeaning: missMeaning(),
    });
    expect(r.shouldSend).toBe(true);
  });

  it("P: user requested adjust → allowed", async () => {
    const raw = "I need to change the goal";
    const policy = deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: missMeaning(raw),
      inboundRaw: raw,
    });
    const r = await applyPrematureAdjustmentProposalGuard({
      body: "How does one hour per day sound?",
      policy,
      inboundMeaning: missMeaning(raw),
    });
    expect(r.shouldSend).toBe(true);
  });
});

describe("inboundUserRequestedGoalAdjustment", () => {
  it("detects explicit goal change language", () => {
    expect(inboundUserRequestedGoalAdjustment("I need to change the goal")).toBe(true);
    expect(inboundUserRequestedGoalAdjustment("Good")).toBe(false);
  });
});
