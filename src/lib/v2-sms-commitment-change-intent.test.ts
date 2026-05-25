import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));
import { deriveSmsCommitmentChangeIntent } from "@/lib/v2-sms-commitment-change";

describe("deriveSmsCommitmentChangeIntent — raise_bar", () => {
  it('maps goalAdjustmentMove "raise_bar" to sms_raise_bar_request', () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "this goal is too easy",
      interpretation: null,
      goalAdjustmentMove: "raise_bar",
    });
    expect(p.intent).toBe("sms_raise_bar_request");
    expect(p.candidateNewBar).toBeNull();
  });

  it('maps explicit "raise the bar" with raise_bar signal to sms_raise_bar_request', () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "raise the bar",
      interpretation: null,
      goalAdjustmentMove: "raise_bar",
    });
    expect(p.intent).toBe("sms_raise_bar_request");
    expect(p.candidateNewBar).toBeNull();
  });

  it('maps "raise the bar" to sms_raise_bar_request without goal signal or candidate', () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "raise the bar",
      interpretation: null,
      goalAdjustmentMove: "keep",
    });
    expect(p.intent).toBe("sms_raise_bar_request");
    expect(p.candidateNewBar).toBeNull();
  });

  it.each(["make it harder", "this goal is too easy"])(
    "maps explicit raise phrase %s to sms_raise_bar_request without candidate",
    (phrase) => {
      const p = deriveSmsCommitmentChangeIntent({
        rawBody: phrase,
        interpretation: null,
        goalAdjustmentMove: "keep",
      });
      expect(p.intent).toBe("sms_raise_bar_request");
      expect(p.candidateNewBar).toBeNull();
    }
  );

  it("embeds bar when raise signal and change-goal phrase coexist", () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "this is too easy — change my goal to walk 30 minutes daily",
      interpretation: null,
      goalAdjustmentMove: "raise_bar",
    });
    expect(p.intent).toBe("sms_raise_bar_request");
    expect(p.candidateNewBar).toMatch(/walk 30 minutes daily/i);
  });
});

describe("deriveSmsCommitmentChangeIntent — boundaries", () => {
  it("returns soft quit for frustration, not replace", () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "I want to quit",
      interpretation: null,
    });
    expect(p.intent).toBe("sms_soft_quit_or_frustration");
  });

  it("does not return replace request when plannedInterruptionActionable", () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "change my goal to walking after dinner",
      interpretation: null,
      plannedInterruptionActionable: true,
    });
    expect(p.intent).toBe("sms_change_unspecified");
    expect(p.intent).not.toBe("sms_replace_request");
  });

  it('does not return replace for "this week is impossible"', () => {
    const p = deriveSmsCommitmentChangeIntent({
      rawBody: "this week is impossible",
      interpretation: null,
    });
    expect(p.intent).not.toBe("sms_replace_request");
    expect(p.intent).not.toBe("sms_raise_bar_request");
  });
});
