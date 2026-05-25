import { describe, expect, it } from "vitest";

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import {
  deriveSmsGoalAdjustmentSignal,
  smsGoalAdjustmentShrinkOverlayEligible,
} from "@/lib/sms-goal-adjustment-signal";

const NOW = new Date("2026-05-10T12:00:00.000Z").getTime();

function outcome(daysAgo: number, type: "user_yes" | "user_no" | "user_partial"): V2EventRowForAi {
  const at = new Date(NOW - daysAgo * 86400000).toISOString();
  return { event_type: type, occurred_at: at, payload_json: {} };
}

describe("deriveSmsGoalAdjustmentSignal", () => {
  it("returns keep low when no events", () => {
    const s = deriveSmsGoalAdjustmentSignal({ eventsNewestFirst: [], nowMs: NOW });
    expect(s.move).toBe("keep");
    expect(s.confidence).toBe("low");
    expect(s.mentionAllowed).toBe(false);
    expect(s.requiresUserConfirmation).toBe(false);
  });

  it("returns low shrink without mention for two misses and no pattern", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(2, "user_no"), outcome(5, "user_no")],
      nowMs: NOW,
    });
    expect(s.move).toBe("shrink_temporary");
    expect(s.confidence).toBe("low");
    expect(s.mentionAllowed).toBe(false);
    expect(s.requiresUserConfirmation).toBe(true);
    expect(s.compatibleFlow).toBe("overlay");
  });

  it("returns medium shrink with overlay when misses and medium pattern", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(2, "user_no"), outcome(6, "user_partial")],
      patternSignal: {
        canonical: "work_pressure",
        confidence: "medium",
        count14d: 2,
      },
      nowMs: NOW,
    });
    expect(s.move).toBe("shrink_temporary");
    expect(s.confidence).toBe("medium");
    expect(s.mentionAllowed).toBe(true);
    expect(s.compatibleFlow).toBe("overlay");
    expect(smsGoalAdjustmentShrinkOverlayEligible(s)).toBe(true);
  });

  it("suppresses shrink when overlay is active", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(2, "user_no"), outcome(6, "user_no")],
      patternSignal: { canonical: "phone_pull", confidence: "high", count14d: 3 },
      overlayState: { overlayActive: true },
      nowMs: NOW,
    });
    expect(s.move).toBe("keep");
    expect(s.mentionAllowed).toBe(false);
  });

  it("suppresses competing moves when pending resolution is active", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(1, "user_no")],
      inboundRaw: "change my goal to morning runs",
      pendingResolution: { kind: "commitment_replace", sms_state: "awaiting_confirmation" },
      nowMs: NOW,
    });
    expect(s.move).toBe("keep");
    expect(s.compatibleFlow).toBe("pending_replace");
  });

  it("returns upstream for late bedtime medium pattern", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      patternSignal: { canonical: "late_bedtime_upstream", confidence: "medium", count14d: 2 },
      nowMs: NOW,
    });
    expect(s.move).toBe("upstream");
    expect(s.requiresUserConfirmation).toBe(true);
    expect(s.mentionAllowed).toBe(true);
  });

  it("returns replace for explicit goal change language", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "change my goal to write for one hour each morning",
      nowMs: NOW,
    });
    expect(s.move).toBe("replace");
    expect(s.compatibleFlow).toBe("pending_replace");
    expect(s.requiresUserConfirmation).toBe(true);
    expect(s.mentionAllowed).toBe(true);
  });

  it("returns tighten_durable for permanent smaller language", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "make it smaller permanently — 20 minutes only",
      nowMs: NOW,
    });
    expect(s.move).toBe("tighten_durable");
    expect(s.compatibleFlow).toBe("pending_tighten");
    expect(s.requiresUserConfirmation).toBe(true);
  });

  it("returns raise_bar when streak and user wants more", () => {
    const events = Array.from({ length: 5 }, (_, i) => outcome(i + 1, "user_yes"));
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: events,
      coachingMemory: { yes_streak_14d: 6 },
      inboundRaw: "this feels too easy — ready for more",
      nowMs: NOW,
    });
    expect(s.move).toBe("raise_bar");
    expect(s.mentionAllowed).toBe(true);
    expect(s.requiresUserConfirmation).toBe(true);
  });

  it("does not raise_bar from streak alone without user language", () => {
    const events = Array.from({ length: 6 }, (_, i) => outcome(i + 1, "user_yes"));
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: events,
      coachingMemory: { yes_streak_14d: 6 },
      nowMs: NOW,
    });
    expect(s.move).not.toBe("raise_bar");
  });

  it("returns pause_cadence for vacation and does not frame as failure", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(0, "user_no")],
      inboundRaw: "I'm on vacation this week",
      nowMs: NOW,
    });
    expect(s.move).toBe("pause_cadence");
    expect(s.internalHint).toMatch(/planned_interruption/i);
    expect(s.mentionAllowed).toBe(true);
  });

  it("returns pause_cadence for grieving", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "I'm grieving — need space",
      nowMs: NOW,
    });
    expect(s.move).toBe("pause_cadence");
  });

  it("pause my subscription is not pause_cadence", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "pause my subscription",
      nowMs: NOW,
    });
    expect(s.move).not.toBe("pause_cadence");
  });

  it("bare STOP does not return subscription_integrity", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "STOP",
      nowMs: NOW,
    });
    expect(s.move).not.toBe("subscription_integrity");
  });

  it("cancel my subscription returns subscription_integrity", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [],
      inboundRaw: "I need to cancel my subscription please",
      nowMs: NOW,
    });
    expect(s.move).toBe("subscription_integrity");
    expect(s.requiresUserConfirmation).toBe(false);
    expect(s.mentionAllowed).toBe(true);
  });

  it("suppresses mention when do_not_repeat contains key", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(2, "user_no"), outcome(5, "user_no")],
      patternSignal: { canonical: "time_pressure", confidence: "medium", count14d: 2 },
      coachingMemory: { do_not_repeat_phrases: ["goal_adjustment_shrink_temporary_prompt"] },
      nowMs: NOW,
    });
    expect(s.move).toBe("shrink_temporary");
    expect(s.mentionAllowed).toBe(false);
  });

  it("evolution replace_commitment yields replace evolution hint without mention", () => {
    const s = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: [outcome(1, "user_no"), outcome(2, "user_no"), outcome(3, "user_no")],
      evolutionEval: { recommended_action: "replace_commitment" },
      nowMs: NOW,
    });
    expect(s.move).toBe("replace");
    expect(s.compatibleFlow).toBe("evolution_hint");
    expect(s.mentionAllowed).toBe(false);
    expect(s.requiresUserConfirmation).toBe(true);
  });

  it("mutating moves require confirmation", () => {
    const cases = [
      deriveSmsGoalAdjustmentSignal({
        eventsNewestFirst: [outcome(2, "user_no"), outcome(4, "user_no")],
        patternSignal: { canonical: "time_pressure", confidence: "medium", count14d: 2 },
        nowMs: NOW,
      }),
      deriveSmsGoalAdjustmentSignal({
        eventsNewestFirst: [],
        inboundRaw: "change my goal to meditate daily",
        nowMs: NOW,
      }),
      deriveSmsGoalAdjustmentSignal({
        eventsNewestFirst: [],
        inboundRaw: "I'm sick today",
        nowMs: NOW,
      }),
    ];
    for (const s of cases) {
      if (s.move === "keep" || s.move === "subscription_integrity" || s.move === "resume_after_silence") {
        continue;
      }
      expect(s.requiresUserConfirmation).toBe(true);
    }
  });
});
