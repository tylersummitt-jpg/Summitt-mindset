import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveNormalInboundBrainCase,
  finalizeNormalInboundHumanSms,
  normalInboundCuratedFallbackForCase,
} from "@/lib/v2-human-sms-brain/finalize-normal-inbound-human-sms";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import { validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";

function outcomeDecision(final: "user_yes" | "user_no" | "user_partial"): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: final,
    decision_reason: "test",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: final !== "user_yes",
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-human-sms-brain/human-sms-brain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-human-sms-brain/human-sms-brain")>();
  return {
    ...actual,
    rewriteMachineDraftToHumanSms: rewriteMock,
  };
});

describe("deriveNormalInboundBrainCase", () => {
  it("maps outcome yes/no/partial", () => {
    expect(
      deriveNormalInboundBrainCase({
        gatedDecision: outcomeDecision("user_yes"),
        deterministicEventType: "user_yes",
        replyMode: "ai_generated",
      })
    ).toBe("normal_inbound_outcome_yes");
    expect(
      deriveNormalInboundBrainCase({
        gatedDecision: outcomeDecision("user_no"),
        deterministicEventType: "user_no",
        replyMode: "ai_generated",
      })
    ).toBe("normal_inbound_outcome_no");
    expect(
      deriveNormalInboundBrainCase({
        gatedDecision: outcomeDecision("user_partial"),
        deterministicEventType: "user_partial",
        replyMode: "fallback",
      })
    ).toBe("normal_inbound_outcome_partial");
  });

  it("maps repair_then_coach", () => {
    expect(
      deriveNormalInboundBrainCase({
        gatedDecision: outcomeDecision("user_yes"),
        deterministicEventType: "user_yes",
        replyMode: "repair_then_coach",
      })
    ).toBe("normal_inbound_repair_coach");
  });

  it("maps non-outcome modes", () => {
    expect(
      deriveNormalInboundBrainCase({
        gatedDecision: {
          mode: "clarify",
          final_event_type: null,
          decision_reason: "x",
          confidence_used: null,
          should_write_outcome_event: false,
          should_open_blocker_capture: false,
          reply_style: "clarification",
          overrode_deterministic: false,
        },
        deterministicEventType: "user_partial",
        replyMode: "deterministic_human",
      })
    ).toBe("normal_inbound_non_outcome_clarify");
  });

  it("throws when outcome type is not triad (Brain path must skip earlier)", () => {
    expect(() =>
      deriveNormalInboundBrainCase({
        gatedDecision: {
          mode: "use_deterministic",
          final_event_type: "user_future" as unknown as V2InboundGatedDecision["final_event_type"],
          decision_reason: "x",
          confidence_used: null,
          should_write_outcome_event: true,
          should_open_blocker_capture: false,
          reply_style: "normal_outcome",
          overrode_deterministic: false,
        },
        deterministicEventType: "user_yes",
        replyMode: "ai_generated",
      })
    ).toThrow(/deriveNormalInboundBrainCase/);
  });
});

const PHASE2_CASES: HumanSmsBrainCase[] = [
  "normal_inbound_outcome_yes",
  "normal_inbound_outcome_no",
  "normal_inbound_outcome_partial",
  "normal_inbound_non_outcome_clarify",
  "normal_inbound_non_outcome_repair_only",
  "normal_inbound_non_outcome_commitment_change",
  "normal_inbound_non_outcome_soft_opt",
  "normal_inbound_repair_coach",
];

describe("normalInboundCuratedFallbackForCase", () => {
  it.each(PHASE2_CASES)("passes validateHumanVisibleSms (%s)", (c) => {
    const fb = normalInboundCuratedFallbackForCase(c);
    expect(validateHumanVisibleSms(fb, { channel: "normal_inbound", maxChars: 320 }).ok).toBe(
      true
    );
  });
});

describe("finalizeNormalInboundHumanSms", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    rewriteMock.mockResolvedValue({
      ok: true,
      message: "contract proposal jargon in brain output",
      confidence: 0.9,
    });
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("does not call Brain when phase2 flag off", async () => {
    delete process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND;
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Hello world.",
      brainCase: "normal_inbound_outcome_yes",
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe("Hello world.");
    expect(r.brainSkippedReason).toBe(null);
  });

  it("does not call Brain when master brain flag off", async () => {
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "false";

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Clean copy.",
      brainCase: "normal_inbound_outcome_yes",
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe("Clean copy.");
    expect(r.brainSkippedReason).toBe("brain_disabled");
  });

  it("calls Brain when both flags on", async () => {
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    rewriteMock.mockResolvedValueOnce({
      ok: true,
      message: "Polished yes reply without banned words.",
      confidence: 0.88,
    });

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Good. Logged.",
      brainCase: "normal_inbound_outcome_yes",
    });
    expect(rewriteMock).toHaveBeenCalled();
    expect(r.message).toContain("Polished");
    expect(r.brainSkippedReason).toBe(null);
    expect(typeof r.brainRewriteMs).toBe("number");
  });

  it("Brain ok:false keeps machine draft when it passes validator", async () => {
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock.mockResolvedValueOnce({
      ok: false,
      reason: "no_openai_client",
    });

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Plain coach line without jargon.",
      brainCase: "normal_inbound_outcome_yes",
    });
    expect(r.message).toBe("Plain coach line without jargon.");
    expect(r.brainFailureReason).toBe("no_openai_client");
    expect(r.brainUsed).toBe(false);
  });

  it("enforce on + bad brain output uses curated fallback", async () => {
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: "Your contract proposal is ready.",
        confidence: 0.9,
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Still bad contract proposal.",
        confidence: 0.8,
      });

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Start.",
      brainCase: "normal_inbound_outcome_yes",
    });
    expect(r.message).toBe(normalInboundCuratedFallbackForCase("normal_inbound_outcome_yes"));
    expect(r.fallbackUsed).toBe("curated_fallback_for_case");
    expect(
      validateHumanVisibleSms(r.message, { channel: "normal_inbound", maxChars: 320 }).ok
    ).toBe(true);
  });

  it("enforce off keeps invalid brain output (shadow-only)", async () => {
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    rewriteMock.mockResolvedValueOnce({
      ok: true,
      message: "Bad contract proposal wording.",
      confidence: 0.9,
    });

    const r = await finalizeNormalInboundHumanSms({
      machineDraft: "Start.",
      brainCase: "normal_inbound_outcome_partial",
    });
    expect(r.message).toContain("contract proposal");
    expect(r.validationFailed).toBe(true);
  });
});
