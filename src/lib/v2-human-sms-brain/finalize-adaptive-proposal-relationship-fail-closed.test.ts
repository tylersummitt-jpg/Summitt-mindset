import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-human-sms-brain/human-sms-brain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-human-sms-brain/human-sms-brain")>();
  return {
    ...actual,
    rewriteMachineDraftToHumanSms: rewriteMock,
  };
});

vi.mock("@/lib/v3-sms-machine-refine", () => ({
  refineMachineSmsBodyWithV3RefineLane: vi.fn(),
}));

const finalizeNsMock = vi.hoisted(() =>
  vi.fn(async (args: { proposedBody: string }) => ({
    visibleBody: args.proposedBody,
    meta: { source: "approved" as const, blockedReasons: [] as string[] },
  }))
);

vi.mock("@/lib/north-star-coach-sms-openai", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/north-star-coach-sms-openai")>();
  return {
    ...actual,
    finalizeNorthStarCoachSmsAsync: finalizeNsMock,
  };
});

import * as refine from "@/lib/v3-sms-machine-refine";
import { finalizeAdaptiveProposalOutboundSms } from "./finalize-adaptive-proposal-outbound-sms";

const stubCommitment = {
  id: "cmt_test",
  clerk_user_id: "user_1",
  behavior_statement: "Two hours of deep work every morning",
  status: "active",
} as ActiveV2CommitmentRow;

describe("finalizeAdaptiveProposalOutboundSms — v3Refine relationship fail-closed", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(refine.refineMachineSmsBodyWithV3RefineLane).mockResolvedValue({
      body: "This contract proposal needs your review and a clear yes or no.",
      replySource: "v3_adaptive_proposal_refined",
      contextPacket: {
        source: "adaptive_proposal_outbound",
        behaviorStatement: "b",
        effectiveAskText: "bind",
      },
    });
    finalizeNsMock.mockImplementation(async (args: { proposedBody: string }) => ({
      visibleBody: args.proposedBody,
      meta: { source: "approved", blockedReasons: [] },
    }));
    rewriteMock.mockResolvedValue({ ok: false, reason: "fix_unavailable" });
  });

  it("withholds instead of returning Phase3A curated/minimal deterministic fallback", async () => {
    process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    const r = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: "seed",
      proposalKind: "shrink",
      bindingText: "Today only: 30 minutes",
      behaviorStatementPreview: "Deep work",
      v3Refine: {
        clerkUserId: "user_1",
        messageSid: "sid",
        commitment: stubCommitment,
        timezone: "America/Chicago",
      },
    });

    expect(r.message).toBe("");
    expect(r.relationshipVoiceReady).toBe(false);
    expect(r.shouldSend).toBe(false);
    expect(r.northStarReplySource).toBeNull();
    expect(r.adaptiveProposalFallbackPrevented).toBe(true);
    expect(r.deterministicReplacementPrevented).toBe(true);
    expect(r.requiresV3Repair).toBe(true);
    expect(r.fallbackUsed).not.toBe("curated_fallback_for_kind");
    expect(r.fallbackUsed).not.toBe("minimal_or_curated_slice");
  });

  it("does not claim V3/refined provenance on the withheld result object", async () => {
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";
    const r = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: "seed",
      proposalKind: "shrink",
      bindingText: "bind",
      behaviorStatementPreview: "behave",
      v3Refine: {
        clerkUserId: "user_1",
        messageSid: "sid",
        commitment: stubCommitment,
        timezone: "America/Chicago",
      },
    });
    expect(r.northStarReplySource).toBeNull();
  });
});

describe("contract_prompt FVG after adaptive finalizer would be empty", () => {
  const prevOpenAi = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
  });

  it("empty proposed body yields shouldSend false when repair unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "",
      replySource: undefined,
      channel: "contract_prompt",
      activeCommitmentId: "c1",
      effectiveAsk: "30 min focus",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.skipReason).toBe("no_safe_v3_voice");
  });
});
