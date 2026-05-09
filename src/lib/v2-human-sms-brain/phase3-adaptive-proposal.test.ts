import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adaptiveProposalCuratedFallbackForKind,
  finalizeAdaptiveProposalOutboundSms,
} from "@/lib/v2-human-sms-brain/finalize-adaptive-proposal-outbound-sms";
import { validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import {
  buildV2RecommitProposalOutboundSms,
  buildV2ShrinkProposalOutboundSms,
  legacyBuildV2RecommitProposalOutboundSms,
  legacyBuildV2ShrinkProposalOutboundSms,
} from "@/lib/v2-sms-accountability";

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-human-sms-brain/human-sms-brain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-human-sms-brain/human-sms-brain")>();
  return {
    ...actual,
    rewriteMachineDraftToHumanSms: rewriteMock,
  };
});

const baseArgs = {
  clerkUserId: "user_1",
  dayKey: "2026-05-01",
  proposalBindingText: "Today only: 30 minutes of deep work",
  originalBehaviorStatement: "Two hours of deep work every morning",
} as const;

describe("Phase 3A — legacy vs async builders (flags off = byte-identical to legacy)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("flags off: shrink async builder matches legacy", async () => {
    delete process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL;
    delete process.env.V2_HUMAN_SMS_BRAIN_ENABLED;

    const leg = legacyBuildV2ShrinkProposalOutboundSms({ ...baseArgs });
    const got = await buildV2ShrinkProposalOutboundSms({ ...baseArgs });
    expect(got).toEqual(leg);
  });

  it("flags off: recommit async builder matches legacy", async () => {
    delete process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL;
    const leg = legacyBuildV2RecommitProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: "Keep the same line steady for a week: my bar",
    });
    const got = await buildV2RecommitProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: "Keep the same line steady for a week: my bar",
    });
    expect(got).toEqual(leg);
  });
});

describe("Phase 3A — Brain invoked when both flags on", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";
    rewriteMock.mockResolvedValue({
      ok: true,
      message:
        "Quick check: want to keep it simpler for a bit? Yes or no.",
      confidence: 0.9,
    });
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("shrink: calls rewrite", async () => {
    const r = await buildV2ShrinkProposalOutboundSms({ ...baseArgs });
    expect(rewriteMock).toHaveBeenCalled();
    expect(r.body).toMatch(/want to keep it simpler|simpler/i);
  });

  it("recommit: calls rewrite", async () => {
    const r = await buildV2RecommitProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: "Steady hold text",
    });
    expect(rewriteMock).toHaveBeenCalled();
    expect(r.body).toMatch(/want to keep it simpler|simpler/i);
  });
});

describe("finalizeAdaptiveProposalOutboundSms", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("enforce on + banned Brain output → curated fallback passes validator", async () => {
    process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: "This contract proposal needs your review.",
        confidence: 0.9,
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Still bad: contract proposal language here.",
        confidence: 0.8,
      });

    const r = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: "Start.",
      proposalKind: "shrink",
      bindingText: "bind",
      behaviorStatementPreview: "behave",
    });
    expect(r.message).toBe(adaptiveProposalCuratedFallbackForKind("shrink"));
    expect(
      validateHumanVisibleSms(r.message, { channel: "adaptive_proposal_outbound", maxChars: 320 }).ok
    ).toBe(true);
  });

  it("Brain ok:false + valid machine draft keeps machine text", async () => {
    process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock.mockResolvedValueOnce({ ok: false, reason: "openai_error" });

    const draft =
      "Smaller version for now: ask Say yes. If not, say no and we keep today bar: \"short bar\"";
    const r = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: draft,
      proposalKind: "shrink",
      bindingText: "ask",
      behaviorStatementPreview: "bar",
    });
    expect(r.message).toBe(draft);
    expect(r.brainFailureReason).toBe("openai_error");
  });

  it("curated fallbacks pass validateHumanVisibleSms", () => {
    for (const k of ["shrink", "recommit_same"] as const) {
      const fb = adaptiveProposalCuratedFallbackForKind(k);
      expect(validateHumanVisibleSms(fb, { channel: "adaptive_proposal_outbound", maxChars: 320 }).ok).toBe(
        true
      );
    }
  });
});

describe("Binding / state invariants (no storage path in this module)", () => {
  it("proposalBindingText string is not mutated by builders", async () => {
    const env = { ...process.env };
    process.env = { ...env };
    delete process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL;

    const binding = "  Today only: 30 minutes of x  ";
    const copy = binding;
    await buildV2ShrinkProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: binding,
    });
    expect(binding).toBe(copy);
    process.env = { ...env };
  });
});

describe("adaptive_proposal_outbound validator channel", () => {
  it("allows natural yes/no consent phrasing (not triad menu)", () => {
    const s =
      "Want a simpler step for a bit? Yes or no. If no, we keep your original ask as written.";
    expect(validateHumanVisibleSms(s, { channel: "adaptive_proposal_outbound", maxChars: 360 }).ok).toBe(
      true
    );
  });

  it("legacy proposal templates never leak banned system phrases", () => {
    const shrink = legacyBuildV2ShrinkProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: "Today only: 30 minutes of deep work",
    }).body.toLowerCase();
    const recommit = legacyBuildV2RecommitProposalOutboundSms({
      ...baseArgs,
      proposalBindingText: "Keep the same line steady for a week: deep work",
    }).body.toLowerCase();
    for (const body of [shrink, recommit]) {
      expect(body).not.toContain("smaller window");
      expect(body).not.toContain("active for 7 days");
      expect(body).not.toContain("daily check-ins");
      expect(body).not.toContain("stay on track");
      expect(body).not.toContain("contract");
      expect(body).not.toContain("overlay");
      expect(body).not.toContain("pending resolution");
      expect(body).not.toContain("v2");
    }
  });
});
