import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE,
  MORNING_LANE_WINDOW_START_MINUTE,
  MORNING_RESERVATION_LEASE_MS,
  buildMorningLaneSchedulingTelemetry,
  evaluateMorningLaneTiming,
  isMorningLaneSendEligible,
  isMorningReservationWithinLease,
  isSafeMorningRetryFailure,
  reservationAgeMs,
} from "@/lib/daily-sms-scheduling";

describe("Morning lane fixed window [07:00, 09:00)", () => {
  it("06:59 ET blocked", () => {
    const now = new Date("2026-06-27T10:59:00.000Z"); // 06:59 EDT
    const d = evaluateMorningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(6);
    expect(d.localMinute).toBe(59);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("before_morning_window");
    expect(isMorningLaneSendEligible(now, "America/New_York")).toBe(false);
  });

  it("07:00 ET eligible", () => {
    const now = new Date("2026-06-27T11:00:00.000Z"); // 07:00 EDT
    const d = evaluateMorningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(7);
    expect(d.localMinute).toBe(0);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("inside_morning_window");
    expect(d.windowStartMinute).toBe(MORNING_LANE_WINDOW_START_MINUTE);
    expect(d.windowEndMinuteExclusive).toBe(MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE);
  });

  it("07:05 ET eligible", () => {
    const now = new Date("2026-06-27T11:05:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/New_York")).toBe(true);
  });

  it("08:59 ET eligible", () => {
    const now = new Date("2026-06-27T12:59:00.000Z");
    const d = evaluateMorningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(8);
    expect(d.localMinute).toBe(59);
    expect(d.allowed).toBe(true);
  });

  it("09:00 ET blocked", () => {
    const now = new Date("2026-06-27T13:00:00.000Z");
    const d = evaluateMorningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(9);
    expect(d.localMinute).toBe(0);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("after_morning_window");
  });

  it("15:00 ET blocked", () => {
    const now = new Date("2026-06-27T19:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/New_York")).toBe(false);
  });

  it("19:00 ET blocked", () => {
    const now = new Date("2026-06-27T23:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/New_York")).toBe(false);
  });

  it("21:00 ET blocked", () => {
    const now = new Date("2026-06-28T01:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/New_York")).toBe(false);
  });

  it("Central 12:00Z is 07:00 eligible in June", () => {
    const now = new Date("2026-06-27T12:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/Chicago")).toBe(true);
  });

  it("Pacific 14:00Z is 07:00 eligible in June", () => {
    const now = new Date("2026-06-27T14:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/Los_Angeles")).toBe(true);
  });

  it("Arizona 14:00Z is 07:00 eligible (no DST)", () => {
    const now = new Date("2026-06-27T14:00:00.000Z");
    expect(isMorningLaneSendEligible(now, "America/Phoenix")).toBe(true);
  });
});

describe("legacy timing cannot move Morning window", () => {
  it("telemetry is fixed_morning_window regardless of legacy prefs", () => {
    const now = new Date("2026-06-27T11:00:00.000Z");
    const timing = evaluateMorningLaneTiming({ now, timezone: "America/New_York" });
    const telemetry = buildMorningLaneSchedulingTelemetry({
      timezone: "America/New_York",
      timing,
      attemptKind: "first_attempt",
    });
    expect(telemetry.timing_source).toBe("fixed_morning_window");
    expect(telemetry.send_window_policy_source).toBe("fixed_morning_window");
    expect(telemetry).not.toHaveProperty("learned_window");
    expect(telemetry).not.toHaveProperty("clerk_send_hour");
    expect(telemetry).not.toHaveProperty("product_floor_hour");
  });

  it("scheduling module source has no catch-up / adaptive Morning authorities", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const src = readFileSync(join(process.cwd(), "src/lib/daily-sms-scheduling.ts"), "utf8");
    expect(src).toContain("fixed_morning_window");
    expect(src).not.toMatch(/isLocalCatchupHour/);
    expect(src).not.toMatch(/evaluateDailySendTimeWindow/);
    expect(src).not.toMatch(/preferred_local_hour/);
    expect(src).not.toMatch(/learnedProfile/);
  });
});

describe("reservation lease / safe retry", () => {
  it("lease is 15 minutes", () => {
    expect(MORNING_RESERVATION_LEASE_MS).toBe(15 * 60 * 1000);
  });

  it("fresh reservation is within lease", () => {
    const now = new Date("2026-06-27T11:10:00.000Z");
    const created = "2026-06-27T11:05:00.000Z";
    expect(isMorningReservationWithinLease(created, now)).toBe(true);
    expect(reservationAgeMs(created, now)).toBe(5 * 60 * 1000);
  });

  it("reservation older than lease is reclaimable for unknown marking only", () => {
    const now = new Date("2026-06-27T11:30:00.000Z");
    const created = "2026-06-27T11:00:00.000Z";
    expect(isMorningReservationWithinLease(created, now)).toBe(false);
  });

  it("missing created_at treated as within lease (fail closed)", () => {
    expect(isMorningReservationWithinLease(null, new Date())).toBe(true);
  });

  it("safe retry only for explicit pre-Twilio failures", () => {
    expect(isSafeMorningRetryFailure({ note: "dry_run_enabled", twilio_send_attempted: false })).toBe(
      true
    );
    expect(isSafeMorningRetryFailure({ note: "twilio_not_ready", twilio_send_attempted: false })).toBe(
      true
    );
    expect(isSafeMorningRetryFailure({ note: "send_failed" })).toBe(false);
    expect(isSafeMorningRetryFailure({ note: "unknown_outcome_lease_expired" })).toBe(false);
    expect(isSafeMorningRetryFailure({ note: "retry_success", twilio_send_attempted: true })).toBe(
      false
    );
  });
});
