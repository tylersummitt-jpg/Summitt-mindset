import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { parseInboundSmsCommsPreference } from "@/lib/v2-sms-comms-preferences";

const TZ = "America/New_York";
const NOW = new Date("2026-05-22T15:00:00.000Z");

describe("parseInboundSmsCommsPreference", () => {
  it("text me in the morning", () => {
    const r = parseInboundSmsCommsPreference({
      body: "text me in the morning",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("preferred_time");
    expect(r.confidence).toBe("high");
    expect(r.preferredSendWindow).toBe("morning");
  });

  it("text me at 7am", () => {
    const r = parseInboundSmsCommsPreference({
      body: "text me at 7am",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("preferred_time");
    expect(r.preferredLocalHour).toBe(7);
    expect(r.preferredSendWindow).toBe("morning");
  });

  it("text me tonight", () => {
    const r = parseInboundSmsCommsPreference({
      body: "text me tonight",
      timezone: TZ,
      now: NOW,
    });
    expect(r.preferredSendWindow).toBe("evening");
  });

  it("text me at 7pm", () => {
    const r = parseInboundSmsCommsPreference({
      body: "text me at 7pm",
      timezone: TZ,
      now: NOW,
    });
    expect(r.preferredLocalHour).toBe(19);
    expect(r.preferredSendWindow).toBe("evening");
  });

  it("don't text weekends / only weekdays", () => {
    expect(
      parseInboundSmsCommsPreference({
        body: "don't text me on weekends",
        timezone: TZ,
        now: NOW,
      }).weekendSendPolicy
    ).toBe("weekdays_only");
    expect(
      parseInboundSmsCommsPreference({ body: "only weekdays", timezone: TZ, now: NOW })
        .weekendSendPolicy
    ).toBe("weekdays_only");
  });

  it("text me less -> clarify", () => {
    const r = parseInboundSmsCommsPreference({
      body: "text me less",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("clarify");
    expect(r.needsCadenceClarification).toBe(true);
  });

  it("every other day / every 3 days", () => {
    expect(
      parseInboundSmsCommsPreference({
        body: "text me every other day",
        timezone: TZ,
        now: NOW,
      }).cadenceOverride
    ).toBe("every_other_day");
    expect(
      parseInboundSmsCommsPreference({
        body: "every three days",
        timezone: TZ,
        now: NOW,
      }).cadenceOverride
    ).toBe("every_3_days");
  });

  it("keep texting me daily clears cadence", () => {
    const r = parseInboundSmsCommsPreference({
      body: "actually keep texting me daily",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("clear_cadence");
    expect(r.clearCadenceOverride).toBe(true);
  });

  it("pause until Monday", () => {
    const r = parseInboundSmsCommsPreference({
      body: "pause me until Monday",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.pauseUntilIso).toBeTruthy();
    expect(r.pauseReasonCategory).toBe("pause_request");
  });

  it("stop for a few days", () => {
    const r = parseInboundSmsCommsPreference({
      body: "stop for a few days",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.pauseUntilIso).toBeTruthy();
  });

  it("vacation until Monday", () => {
    const r = parseInboundSmsCommsPreference({
      body: "vacation until Monday",
      timezone: TZ,
      now: NOW,
    });
    expect(r.pauseReasonCategory).toBe("vacation");
  });

  it("traveling until next week", () => {
    const r = parseInboundSmsCommsPreference({
      body: "traveling until next week",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.pauseReasonCategory).toBe("travel");
  });

  it("sick this week", () => {
    const r = parseInboundSmsCommsPreference({
      body: "I'm sick this week",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.pauseReasonCategory).toBe("illness");
  });

  it("exact STOP ignored", () => {
    expect(
      parseInboundSmsCommsPreference({ body: "STOP", timezone: TZ, now: NOW }).action
    ).toBe("none");
  });

  it("cancel subscription ignored", () => {
    expect(
      parseInboundSmsCommsPreference({
        body: "cancel my subscription",
        timezone: TZ,
        now: NOW,
      }).action
    ).toBe("none");
  });

  it("stop texting me is not exact STOP (no pause write without window)", () => {
    const r = parseInboundSmsCommsPreference({
      body: "stop texting me",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).not.toBe("pause_until");
  });

  it("start texting again clears pause", () => {
    const r = parseInboundSmsCommsPreference({
      body: "start texting me again",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("clear_pause");
    expect(r.confidence).toBe("high");
  });
});

describe("parseInboundSmsCommsPreference — parser hardening (Slice C P1)", () => {
  const expectNoPauseWrite = (body: string) => {
    const r = parseInboundSmsCommsPreference({ body, timezone: TZ, now: NOW });
    expect(r.action).not.toBe("pause_until");
    expect(r.confidence).not.toBe("high");
  };

  it("vacation but still want goal -> no pause write", () => {
    expectNoPauseWrite(
      "I'm going on vacation but I still want to keep trying to hit my goal."
    );
  });

  it("traveling but keep checking -> no pause write", () => {
    expectNoPauseWrite("I'm traveling but keep checking on me.");
  });

  it("sick but still want accountability -> no pause write", () => {
    expectNoPauseWrite("I'm sick but I still want the accountability.");
  });

  it("tournament weekend but still text me -> no pause write", () => {
    expectNoPauseWrite("I have a tournament this weekend but still text me.");
  });

  it("traveling next week smaller version -> no pause write", () => {
    expectNoPauseWrite("I'm traveling next week, give me a smaller version.");
  });

  it("pause texts until I'm back with next week -> pause_until", () => {
    const r = parseInboundSmsCommsPreference({
      body: "I'm traveling next week, pause texts until I'm back.",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.confidence).toBe("high");
    expect(r.pauseUntilIso).toBeTruthy();
    expect(r.pauseReasonCategory).toBe("travel");
  });

  it("pause texts until I'm back without date clue -> clarify", () => {
    const r = parseInboundSmsCommsPreference({
      body: "pause texts until I'm back",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("clarify");
    expect(r.confidence).toBe("medium");
    expect(r.pauseUntilIso).toBeNull();
  });

  it("bare I'm sick -> clarify not pause", () => {
    const r = parseInboundSmsCommsPreference({
      body: "I'm sick",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("clarify");
    expect(r.confidence).toBe("medium");
    expect(r.pauseUntilIso).toBeNull();
  });

  it("I'm sick this week -> pause_until illness", () => {
    const r = parseInboundSmsCommsPreference({
      body: "I'm sick this week",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.confidence).toBe("high");
    expect(r.pauseReasonCategory).toBe("illness");
  });

  it("I'm sick until Monday -> pause_until illness", () => {
    const r = parseInboundSmsCommsPreference({
      body: "I'm sick until Monday",
      timezone: TZ,
      now: NOW,
    });
    expect(r.action).toBe("pause_until");
    expect(r.confidence).toBe("high");
    expect(r.pauseReasonCategory).toBe("illness");
    expect(r.pauseUntilIso).toBeTruthy();
  });
});
