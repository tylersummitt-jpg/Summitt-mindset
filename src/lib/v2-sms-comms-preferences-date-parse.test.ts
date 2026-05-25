import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { parseCommsPreferenceDeadline } from "@/lib/v2-sms-comms-preferences";

const TZ = "America/New_York";

describe("parseCommsPreferenceDeadline", () => {
  it("until Monday lands on a future 7am local instant", () => {
    const now = new Date("2026-05-22T15:00:00.000Z");
    const r = parseCommsPreferenceDeadline({
      body: "pause until Monday",
      timezone: TZ,
      now,
    });
    expect(r.ambiguous).toBe(false);
    expect(r.pauseUntil).toBeTruthy();
    expect(r.pauseUntil!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("few days is ~3 days out", () => {
    const now = new Date("2026-05-22T15:00:00.000Z");
    const r = parseCommsPreferenceDeadline({
      body: "stop for a few days",
      timezone: TZ,
      now,
    });
    expect(r.pauseUntil).toBeTruthy();
    const deltaDays = (r.pauseUntil!.getTime() - now.getTime()) / 86400000;
    expect(deltaDays).toBeGreaterThan(2);
    expect(deltaDays).toBeLessThan(5);
  });

  it("this weekend ends Monday 7am local", () => {
    const now = new Date("2026-05-22T15:00:00.000Z");
    const r = parseCommsPreferenceDeadline({
      body: "don't text me this weekend",
      timezone: TZ,
      now,
    });
    expect(r.reason).toBe("weekend_or_short_break");
    expect(r.pauseUntil).toBeTruthy();
  });

  it("ambiguous date returns ambiguous", () => {
    const r = parseCommsPreferenceDeadline({
      body: "pause until someday",
      timezone: TZ,
      now: new Date(),
    });
    expect(r.ambiguous).toBe(true);
    expect(r.pauseUntil).toBeNull();
  });

  it("pause texts until I'm back with next week resolves via next-week deadline", () => {
    const now = new Date("2026-05-22T15:00:00.000Z");
    const r = parseCommsPreferenceDeadline({
      body: "I'm traveling next week, pause texts until I'm back.",
      timezone: TZ,
      now,
    });
    expect(r.ambiguous).toBe(false);
    expect(r.pauseUntil).toBeTruthy();
    expect(r.reason).toBe("travel");
  });
});
