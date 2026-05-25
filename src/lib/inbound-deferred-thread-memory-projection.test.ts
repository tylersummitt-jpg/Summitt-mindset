import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildCommitmentChangeHandoffThreadMemoryContext,
  deriveCommitmentChangeHandoffSmsStateFromFacts,
  resolveAdaptiveClarificationExpectedAnswerType,
  resolveCommitmentChangeHandoffExpectedAnswerType,
  resolveContractConsentAckExpectedAnswerType,
  shouldClearBindingOpenQuestionOnCommitmentHandoff,
  shouldClearBindingOpenQuestionOnContractAck,
} from "@/lib/inbound-deferred-thread-memory-projection";

describe("resolveContractConsentAckExpectedAnswerType", () => {
  it("always returns null for projection", () => {
    expect(
      resolveContractConsentAckExpectedAnswerType({
        overlayAction: "activated",
        rpcResult: "applied",
        proposalStillValid: true,
      })
    ).toBeNull();
    expect(
      resolveContractConsentAckExpectedAnswerType({
        overlayAction: "noop_state_conflict",
        proposalStillValid: false,
      })
    ).toBeNull();
  });
});

describe("shouldClearBindingOpenQuestionOnContractAck", () => {
  it("returns true for resolved accept/decline overlay actions", () => {
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "activated",
        proposalStillValid: true,
      })
    ).toBe(true);
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "declined",
        proposalStillValid: true,
      })
    ).toBe(true);
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "activation_applied",
        proposalStillValid: true,
      })
    ).toBe(true);
  });

  it("returns true for noop when proposalStillValid is false", () => {
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "noop_already_applied",
        proposalStillValid: false,
      })
    ).toBe(true);
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "noop_not_found",
        proposalStillValid: false,
      })
    ).toBe(true);
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "noop_state_conflict",
        proposalStillValid: false,
      })
    ).toBe(true);
  });

  it("returns false for noop when proposalStillValid is true", () => {
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "noop_state_conflict",
        proposalStillValid: true,
      })
    ).toBe(false);
  });

  it("returns false for unknown overlay action", () => {
    expect(
      shouldClearBindingOpenQuestionOnContractAck({
        overlayAction: "unknown_action",
        proposalStillValid: false,
      })
    ).toBe(false);
    expect(shouldClearBindingOpenQuestionOnContractAck({ overlayAction: null })).toBe(false);
  });
});

describe("resolveAdaptiveClarificationExpectedAnswerType", () => {
  it("returns proposal_yes_no only for final binding YES/NO body", () => {
    expect(
      resolveAdaptiveClarificationExpectedAnswerType({
        stateRemainsPending: true,
        gatedBody: "Quick check on the pending ask: Reply YES or NO if you want this adjustment?",
      })
    ).toBe("proposal_yes_no");
  });

  it("returns null for non-binding soft question", () => {
    expect(
      resolveAdaptiveClarificationExpectedAnswerType({
        stateRemainsPending: true,
        gatedBody: "Can you tell me more about what feels off with the proposal?",
      })
    ).toBeNull();
  });

  it("returns null when stateRemainsPending is false", () => {
    expect(
      resolveAdaptiveClarificationExpectedAnswerType({
        stateRemainsPending: false,
        gatedBody: "Reply YES or NO if you want this adjusted ask.",
      })
    ).toBeNull();
  });

  it("returns null for empty body", () => {
    expect(
      resolveAdaptiveClarificationExpectedAnswerType({
        stateRemainsPending: true,
        gatedBody: "   ",
      })
    ).toBeNull();
  });
});

describe("deriveCommitmentChangeHandoffSmsStateFromFacts", () => {
  it("returns null when pending was not created", () => {
    expect(
      deriveCommitmentChangeHandoffSmsStateFromFacts({
        pendingResolutionCreated: false,
        serverStateTransitionSummary: "pending_resolution_skipped:soft_quit",
      })
    ).toBeNull();
  });

  it("returns awaiting_candidate when pending created without bootstrap", () => {
    expect(
      deriveCommitmentChangeHandoffSmsStateFromFacts({
        pendingResolutionCreated: true,
        serverStateTransitionSummary: "pending_resolution_upserted:commitment_replace",
      })
    ).toBe("awaiting_candidate");
  });

  it("returns awaiting_confirmation when bootstrap promoted same turn", () => {
    expect(
      deriveCommitmentChangeHandoffSmsStateFromFacts({
        pendingResolutionCreated: true,
        serverStateTransitionSummary:
          "pending_resolution_upserted:commitment_replace;bootstrap:awaiting_confirmation",
      })
    ).toBe("awaiting_confirmation");
  });
});

describe("resolveCommitmentChangeHandoffExpectedAnswerType", () => {
  it.each([
    ["awaiting_candidate", "commitment_replace"],
    ["awaiting_confirmation", "commitment_tighten"],
    [null, null],
  ] as const)("returns null for smsState=%s pendingKind=%s", (smsState, pendingKind) => {
    expect(
      resolveCommitmentChangeHandoffExpectedAnswerType({
        smsState,
        pendingKind,
        gatedBody: "What should the new daily bar be?",
      })
    ).toBeNull();
  });

  it("never returns proposal_yes_no or contract_yes_no", () => {
    const result = resolveCommitmentChangeHandoffExpectedAnswerType({
      smsState: "awaiting_confirmation",
      pendingKind: "commitment_replace",
      gatedBody: "Reply YES to lock this in?",
    });
    expect(result).toBeNull();
    expect(result).not.toBe("proposal_yes_no");
    expect(result).not.toBe("contract_yes_no");
  });
});

describe("shouldClearBindingOpenQuestionOnCommitmentHandoff", () => {
  it("returns false for awaiting_candidate", () => {
    expect(
      shouldClearBindingOpenQuestionOnCommitmentHandoff({
        smsState: "awaiting_candidate",
        priorExpectedType: "proposal_yes_no",
      })
    ).toBe(false);
  });

  it("returns true for awaiting_confirmation with prior proposal_yes_no", () => {
    expect(
      shouldClearBindingOpenQuestionOnCommitmentHandoff({
        smsState: "awaiting_confirmation",
        priorExpectedType: "proposal_yes_no",
      })
    ).toBe(true);
  });

  it("returns true for awaiting_confirmation with prior contract_yes_no", () => {
    expect(
      shouldClearBindingOpenQuestionOnCommitmentHandoff({
        smsState: "awaiting_confirmation",
        priorExpectedType: "contract_yes_no",
      })
    ).toBe(true);
  });

  it("returns false for awaiting_confirmation with prior open_reflection", () => {
    expect(
      shouldClearBindingOpenQuestionOnCommitmentHandoff({
        smsState: "awaiting_confirmation",
        priorExpectedType: "open_reflection",
      })
    ).toBe(false);
  });

  it("returns false when smsState is null (soft quit / no pending)", () => {
    expect(
      shouldClearBindingOpenQuestionOnCommitmentHandoff({
        smsState: null,
        priorExpectedType: "proposal_yes_no",
      })
    ).toBe(false);
  });
});

describe("buildCommitmentChangeHandoffThreadMemoryContext", () => {
  it("awaiting_candidate sets null expectedAnswerType and no binding clear", () => {
    const ctx = buildCommitmentChangeHandoffThreadMemoryContext({
      commitmentId: "cmt_1",
      smsState: "awaiting_candidate",
      pendingKind: "commitment_replace",
      gatedBody: "What should the new daily bar be?",
    });
    expect(ctx).toEqual({
      commitmentId: "cmt_1",
      expectedAnswerType: null,
      clearBindingOpenQuestion: false,
    });
  });

  it("awaiting_confirmation clears binding only when prior was binding", () => {
    const ctx = buildCommitmentChangeHandoffThreadMemoryContext({
      commitmentId: "cmt_1",
      smsState: "awaiting_confirmation",
      pendingKind: "commitment_replace",
      gatedBody: "Should I make that your new commitment?",
      priorExpectedType: "proposal_yes_no",
    });
    expect(ctx.expectedAnswerType).toBeNull();
    expect(ctx.clearBindingOpenQuestion).toBe(true);
  });

  it("does not include candidate or mutation fields", () => {
    const ctx = buildCommitmentChangeHandoffThreadMemoryContext({
      commitmentId: "cmt_1",
      smsState: "awaiting_confirmation",
      pendingKind: "commitment_replace",
      gatedBody: "I can change it to: walk after dinner.",
      priorExpectedType: "proposal_yes_no",
    });
    expect(Object.keys(ctx).sort()).toEqual(
      ["clearBindingOpenQuestion", "commitmentId", "expectedAnswerType"].sort()
    );
  });
});
