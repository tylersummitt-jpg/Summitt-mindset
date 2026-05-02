import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-human-sms-brain/human-sms-brain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-human-sms-brain/human-sms-brain")>();
  return {
    ...actual,
    rewriteMachineDraftToHumanSms: rewriteMock,
  };
});

import { finalizePhase1HumanSms } from "@/lib/v2-human-sms-brain/finalize-phase1-human-sms";

describe("finalizePhase1HumanSms — brain flag honesty", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envSnapshot };
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "false";
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW;
    rewriteMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("enforce on + brain off + invalid draft does NOT call rewriteMachineDraftToHumanSms", async () => {
    const r = await finalizePhase1HumanSms({
      path: "pending_resolution",
      brainCase: "pending_resolution_replace_applied",
      machineDraft: "Updated contract proposal text.",
      channel: "pending_resolution",
      safeFallback: "Got it. I’ll hold you to that starting tomorrow.",
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe("Got it. I’ll hold you to that starting tomorrow.");
    expect(r.fallbackUsed).toBe("safe_fallback_arg");
  });

  it("enforce on + brain off uses curated fallback when machine draft and safeFallback fail validation", async () => {
    const r = await finalizePhase1HumanSms({
      path: "pending_resolution",
      brainCase: "pending_resolution_replace_applied",
      machineDraft: "contract proposal here",
      channel: "pending_resolution",
      safeFallback: "candidate pending resolution",
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe("Got it. I’ll hold you to that starting tomorrow.");
    expect(r.fallbackUsed).toBe("curated_fallback_for_case");
  });

  it("enforce on + brain on invokes rewrite for initial polish and for FIX when draft stays invalid", async () => {
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: "Bad internal copy about contract proposal jargon.",
        confidence: 0.9,
      })
      .mockResolvedValueOnce({
        ok: true,
        message:
          "Locked in—I’ll hold you to that bar tomorrow. Nothing else needed tonight.",
        confidence: 0.85,
      });

    const r = await finalizePhase1HumanSms({
      path: "pending_resolution",
      brainCase: "pending_resolution_replace_applied",
      machineDraft: "Starting text.",
      channel: "pending_resolution",
      safeFallback: "Fallback also bad: contract proposal.",
    });

    expect(rewriteMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(r.validationFailed).toBe(true);
    expect(r.message.length).toBeGreaterThan(5);
    expect(r.message).not.toContain("contract proposal");
  });
});
