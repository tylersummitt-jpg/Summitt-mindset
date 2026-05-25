import { describe, expect, it } from "vitest";

import {
  applyPlannedInterruptionGatedOverride,
  buildPlannedInterruptionMemorySignalPayload,
  detectSmsPlannedInterruption,
  isActivePlannedInterruptionSignal,
  isPlannedInterruptionActionable,
} from "@/lib/sms-planned-interruption";

describe("detectSmsPlannedInterruption", () => {
  it("detects vacation", () => {
    const d = detectSmsPlannedInterruption("I'm on vacation this week");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("vacation");
    expect(isPlannedInterruptionActionable(d)).toBe(true);
  });

  it("detects sick/flu", () => {
    const d = detectSmsPlannedInterruption("I'm sick with the flu");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("illness");
  });

  it("detects family emergency", () => {
    const d = detectSmsPlannedInterruption("family emergency — can't check in");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("family_emergency");
  });

  it("detects grieving", () => {
    const d = detectSmsPlannedInterruption("I'm grieving right now");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("grief");
  });

  it("detects hospital/surgery", () => {
    const d = detectSmsPlannedInterruption("I'm in the hospital after surgery");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("hospital_or_surgery");
  });

  it("detects tournament/camp", () => {
    expect(detectSmsPlannedInterruption("at a tournament all week").detected).toBe(true);
    expect(detectSmsPlannedInterruption("coaching camp this week").reasonCategory).toBe(
      "competition_or_camp"
    );
  });

  it("detects pause me until Monday with resumeHint", () => {
    const d = detectSmsPlannedInterruption("pause me until Monday please");
    expect(d.detected).toBe(true);
    expect(d.resumeHint).toMatch(/monday/i);
  });

  it("detects don't text me this weekend with resumeHint", () => {
    const d = detectSmsPlannedInterruption("don't text me this weekend");
    expect(d.detected).toBe(true);
    expect(d.resumeHint).toMatch(/weekend/i);
  });

  it("detects stop for a few days as planned interruption", () => {
    const d = detectSmsPlannedInterruption("stop for a few days");
    expect(d.detected).toBe(true);
    expect(d.reasonCategory).toBe("pause_request");
  });

  it("does not detect exact STOP", () => {
    expect(detectSmsPlannedInterruption("STOP").detected).toBe(false);
  });

  it("does not detect exact cancel", () => {
    expect(detectSmsPlannedInterruption("cancel").detected).toBe(false);
  });

  it("does not detect cancel my subscription", () => {
    expect(detectSmsPlannedInterruption("cancel my subscription").detected).toBe(false);
  });

  it("does not detect normal miss I missed it", () => {
    expect(detectSmsPlannedInterruption("I missed it").detected).toBe(false);
  });
});

describe("buildPlannedInterruptionMemorySignalPayload", () => {
  it("uses message_preview not full raw body", () => {
    const long = "I'm on vacation ".repeat(20);
    const p = buildPlannedInterruptionMemorySignalPayload({
      raw: long,
      reasonCategory: "vacation",
      confidence: "high",
      sourcePath: "test",
    });
    expect(p.planned_interruption).toBe(true);
    expect(String(p.message_preview).length).toBeLessThanOrEqual(120);
    expect(String(p.message_preview)).not.toBe(long.trim());
  });
});

describe("isActivePlannedInterruptionSignal", () => {
  it("TTL works for tomorrow", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const detectedAt = new Date("2026-05-09T12:00:00.000Z").toISOString();
    const payload = {
      memory_signal: {
        planned_interruption: true,
        detected_at: detectedAt,
        resume_hint: "tomorrow",
      },
    };
    expect(isActivePlannedInterruptionSignal(payload, now)).toBe(true);
    const expired = new Date("2026-05-12T12:00:00.000Z");
    expect(isActivePlannedInterruptionSignal(payload, expired)).toBe(false);
  });

  it("TTL works for next week", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const detectedAt = new Date("2026-05-01T12:00:00.000Z").toISOString();
    const payload = {
      memory_signal: {
        planned_interruption: true,
        detected_at: detectedAt,
        resume_hint: "next week",
      },
    };
    expect(isActivePlannedInterruptionSignal(payload, now)).toBe(true);
  });

  it("fail closed false if malformed", () => {
    expect(isActivePlannedInterruptionSignal(null)).toBe(false);
    expect(isActivePlannedInterruptionSignal({})).toBe(false);
  });
});

describe("applyPlannedInterruptionGatedOverride", () => {
  it("suppresses outcome and blocker capture", () => {
    const out = applyPlannedInterruptionGatedOverride({
      mode: "use_deterministic",
      final_event_type: "user_no",
      decision_reason: "test",
      confidence_used: null,
      should_write_outcome_event: true,
      should_open_blocker_capture: true,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    });
    expect(out.should_write_outcome_event).toBe(false);
    expect(out.should_open_blocker_capture).toBe(false);
    expect(out.final_event_type).toBeNull();
    expect(out.decision_reason).toBe("planned_interruption_detected");
  });
});
