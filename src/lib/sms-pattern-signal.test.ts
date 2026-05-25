import { describe, expect, it } from "vitest";

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { deriveSmsPatternSignal, normalizeSmsPatternSignalText } from "@/lib/sms-pattern-signal";

const NOW = new Date("2026-05-10T12:00:00.000Z").getTime();

function blockerEvent(daysAgo: number, message: string): V2EventRowForAi {
  const at = new Date(NOW - daysAgo * 86400000).toISOString();
  return {
    event_type: "blocker_captured",
    occurred_at: at,
    created_at: at,
    payload_json: { message },
  };
}

function outcomeEvent(daysAgo: number, type: "user_no" | "user_partial"): V2EventRowForAi {
  const at = new Date(NOW - daysAgo * 86400000).toISOString();
  return { event_type: type, occurred_at: at, created_at: at, payload_json: {} };
}

describe("normalizeSmsPatternSignalText", () => {
  it("maps phone, avoidance, work, travel, and time phrases", () => {
    expect(normalizeSmsPatternSignalText("kept scrolling on my phone")).toBe("phone_pull");
    expect(normalizeSmsPatternSignalText("hard to start the task")).toBe("avoidance_getting_started");
    expect(normalizeSmsPatternSignalText("back to back meetings all day")).toBe("work_pressure");
    expect(normalizeSmsPatternSignalText("out of town on a trip")).toBe("travel_disruption");
    expect(normalizeSmsPatternSignalText("ran out of time")).toBe("time_pressure");
  });

  it("maps unknown text to other", () => {
    expect(normalizeSmsPatternSignalText("random friction")).toBe("other");
  });
});

describe("deriveSmsPatternSignal", () => {
  it("returns low with no events", () => {
    const s = deriveSmsPatternSignal({ eventsNewestFirst: [], nowMs: NOW });
    expect(s.confidence).toBe("low");
    expect(s.mentionAllowed).toBe(false);
    expect(s.canonical).toBeNull();
  });

  it("returns low for one blocker event", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(2, "up late again")],
      nowMs: NOW,
    });
    expect(s.confidence).toBe("low");
    expect(s.mentionAllowed).toBe(false);
    expect(s.canonical).toBe("late_bedtime_upstream");
  });

  it("returns medium for two late bedtime blockers in 14d without raw quote", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [
        blockerEvent(3, "up late watching TV"),
        blockerEvent(8, "late night could not sleep"),
      ],
      nowMs: NOW,
    });
    expect(s.confidence).toBe("medium");
    expect(s.mentionAllowed).toBe(true);
    expect(s.gentleUserLine).toContain("Late nights");
    expect(s.gentleUserLine).not.toMatch(/watching|TV|sleep/i);
  });

  it("returns high for three same canonical in 21d", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [
        blockerEvent(2, "phone scroll"),
        blockerEvent(9, "tiktok distraction"),
        blockerEvent(16, "social on phone"),
      ],
      nowMs: NOW,
    });
    expect(s.confidence).toBe("high");
    expect(s.canonical).toBe("phone_pull");
  });

  it("elevates to medium on explicit user phrase when canonical exists", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(4, "meetings all day")],
      inboundRaw: "this keeps happening every week",
      nowMs: NOW,
    });
    expect(s.confidence).toBe("medium");
    expect(s.source).toBe("explicit_user_phrase");
    expect(s.mentionAllowed).toBe(true);
  });

  it("suppresses mention on user correction phrase", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(2, "late night"), blockerEvent(6, "bedtime slip")],
      inboundRaw: "that's not it",
      nowMs: NOW,
    });
    expect(s.confidence).toBe("medium");
    expect(s.mentionAllowed).toBe(false);
  });

  it("suppresses mention when do_not_repeat key is present", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(2, "late night"), blockerEvent(6, "up late")],
      coachingMemory: {
        do_not_repeat_phrases: ["repeated_late_bedtime_upstream_prompt"],
      },
      nowMs: NOW,
    });
    expect(s.mentionAllowed).toBe(false);
  });

  it("keeps health lines generic without raw details", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [
        blockerEvent(2, "migraine at doctor visit"),
        blockerEvent(7, "sick with flu"),
      ],
      nowMs: NOW,
    });
    expect(s.canonical).toBe("health_disruption");
    expect(s.gentleUserLine).toBe("Health has been in the way more than once. Keep today's step realistic.");
    expect(s.gentleUserLine).not.toMatch(/migraine|doctor|flu/i);
  });

  it("does not emit gentleUserLine when Pat Read high pattern is present", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(2, "late night"), blockerEvent(6, "up late")],
      patRead: { pattern_text: "Late nights upstream", pattern_confidence: "high" },
      nowMs: NOW,
    });
    expect(s.confidence).toBe("high");
    expect(s.gentleUserLine).toBeNull();
    expect(s.source).toBe("pat_read");
  });

  it("ignores stale blockers outside 14/21d windows", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [
        blockerEvent(2, "late night"),
        blockerEvent(20, "up late"),
        blockerEvent(25, "bedtime"),
      ],
      nowMs: NOW,
    });
    expect(s.count14d).toBe(1);
    expect(s.confidence).toBe("low");
    expect(s.mentionAllowed).toBe(false);
  });

  it("maps other without mention unless explicit phrase supports it", () => {
    const s = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(3, "weird friction xyz")],
      nowMs: NOW,
    });
    expect(s.canonical).toBe("other");
    expect(s.mentionAllowed).toBe(false);

    const s2 = deriveSmsPatternSignal({
      eventsNewestFirst: [blockerEvent(3, "weird friction xyz")],
      inboundRaw: "same thing again",
      nowMs: NOW,
    });
    expect(s2.mentionAllowed).toBe(true);
  });
});
