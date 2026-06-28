import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildDailySchedulingTelemetry,
  clerkSendHourFromPreference,
  evaluateDailySendTimeWindow,
  isBlockedByDailyProductFloor,
} from "@/lib/daily-sms-scheduling";
import { getLocalHourInTimezone as profileGetLocalHour } from "@/lib/v2-send-time-profile";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

const basePrefs = (
  over: Partial<V2UserSmsCommsPreferencesRow> = {}
): V2UserSmsCommsPreferencesRow => ({
  clerk_user_id: "u1",
  pause_until: null,
  pause_reason_category: null,
  cadence_override: null,
  weekend_send_policy: null,
  preferred_send_window: null,
  preferred_local_hour: null,
  source_message_sid: null,
  resume_prompt_sent_at: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const learnedMorningHigh = {
  clerk_user_id: "u1",
  preferred_window: "morning" as const,
  confidence: 0.9,
  reply_count_morning: 8,
  reply_count_midday: 0,
  reply_count_afternoon: 0,
  reply_count_evening: 0,
  weak_no_reply_morning: 0,
  weak_no_reply_midday: 0,
  weak_no_reply_afternoon: 0,
  weak_no_reply_evening: 0,
  updated_at: "",
};

describe("daily-sms-scheduling — local hour", () => {
  it("America/New_York at 2026-06-27T10:00:00Z computes local hour 6", () => {
    const now = new Date("2026-06-27T10:00:00.000Z");
    expect(profileGetLocalHour(now, "America/New_York")).toBe(6);
  });

  it("America/Chicago boundary: 12:00Z is 7AM Central in June", () => {
    const now = new Date("2026-06-27T12:00:00.000Z");
    expect(profileGetLocalHour(now, "America/Chicago")).toBe(7);
  });

  it("America/Los_Angeles boundary: 14:00Z is 7AM Pacific in June", () => {
    const now = new Date("2026-06-27T14:00:00.000Z");
    expect(profileGetLocalHour(now, "America/Los_Angeles")).toBe(7);
  });
});

describe("daily-sms-scheduling — 7AM product floor", () => {
  const sixAmEt = new Date("2026-06-27T10:00:00.000Z");
  const sevenAmEt = new Date("2026-06-27T11:00:00.000Z");

  it("default Clerk morning / no prefs / learned inactive → no send at local hour 6", () => {
    const result = evaluateDailySendTimeWindow({
      now: sixAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: null,
      bypassWindowGate: false,
    });
    expect(result.computedLocalHour).toBe(6);
    expect(result.sendTimeWindowOk).toBe(false);
    expect(result.productFloorBlockedWithoutBypass).toBe(true);
    expect(result.sendWindowPolicySource).toBe("clerk_hour");
  });

  it("preferred_send_window = morning → no send at local hour 6", () => {
    const result = evaluateDailySendTimeWindow({
      now: sixAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: basePrefs({ preferred_send_window: "morning" }),
      learnedProfile: null,
      bypassWindowGate: false,
    });
    expect(result.sendTimeWindowOk).toBe(false);
    expect(result.sendWindowPolicySource).toBe("explicit_window");
    expect(result.productFloorBlockedWithoutBypass).toBe(true);
  });

  it("learned_profile preferred_window = morning, confidence high → no send at local hour 6", () => {
    const result = evaluateDailySendTimeWindow({
      now: sixAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: learnedMorningHigh,
      bypassWindowGate: false,
    });
    expect(result.sendTimeWindowOk).toBe(false);
    expect(result.sendWindowPolicySource).toBe("learned_profile");
    expect(result.productFloorBlockedWithoutBypass).toBe(true);
  });

  it("same user at 7AM local → send allowed", () => {
    const result = evaluateDailySendTimeWindow({
      now: sevenAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: learnedMorningHigh,
      bypassWindowGate: false,
    });
    expect(result.computedLocalHour).toBe(7);
    expect(result.sendTimeWindowOk).toBe(true);
    expect(result.productFloorBlockedWithoutBypass).toBe(false);
  });

  it("explicit preferred_local_hour = 6 → send allowed at 6", () => {
    const result = evaluateDailySendTimeWindow({
      now: sixAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: basePrefs({ preferred_local_hour: 6 }),
      learnedProfile: null,
      bypassWindowGate: false,
    });
    expect(result.sendTimeWindowOk).toBe(true);
    expect(result.productFloorBlockedWithoutBypass).toBe(false);
    expect(result.sendWindowPolicySource).toBe("explicit_hour");
  });

  it("bypassWindowGate preserves retry path but flags product floor telemetry", () => {
    const result = evaluateDailySendTimeWindow({
      now: sixAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: learnedMorningHigh,
      bypassWindowGate: true,
    });
    expect(result.sendTimeWindowOk).toBe(true);
    expect(result.sendTimeWindowOkWithoutBypass).toBe(false);
    expect(result.productFloorBlockedWithoutBypass).toBe(true);
    const telemetry = buildDailySchedulingTelemetry({
      timezone: "America/New_York",
      evaluation: result,
      retryOutsideWindow: true,
    });
    expect(telemetry.retry_outside_window).toBe(true);
    expect(telemetry.product_floor_hour).toBe(7);
    expect(telemetry.computed_local_hour).toBe(6);
    expect(telemetry.send_window_policy_source).toBe("learned_profile");
  });

  it("product_floor telemetry populated", () => {
    const result = evaluateDailySendTimeWindow({
      now: sevenAmEt,
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: basePrefs({ preferred_send_window: "morning" }),
      learnedProfile: null,
      bypassWindowGate: false,
    });
    const telemetry = buildDailySchedulingTelemetry({
      timezone: "America/New_York",
      evaluation: result,
    });
    expect(telemetry.user_timezone).toBe("America/New_York");
    expect(telemetry.computed_local_hour).toBe(7);
    expect(telemetry.clerk_send_hour).toBe(7);
    expect(telemetry.product_floor_applied).toBe(true);
    expect(telemetry.preferred_send_window).toBe("morning");
  });

  it("isBlockedByDailyProductFloor blocks hour 6 without explicit early hour", () => {
    expect(isBlockedByDailyProductFloor(6, null)).toBe(true);
    expect(isBlockedByDailyProductFloor(6, 6)).toBe(false);
    expect(isBlockedByDailyProductFloor(7, null)).toBe(false);
  });

  it("clerkSendHourFromPreference maps morning to 7", () => {
    expect(clerkSendHourFromPreference("morning")).toBe(7);
    expect(clerkSendHourFromPreference("early_morning")).toBe(7);
  });
});

describe("daily-sms-scheduling — metadata.sent_at does not drive scheduling", () => {
  it("scheduling uses now instant only (no sent_at field in evaluator)", () => {
    const src = evaluateDailySendTimeWindow.toString();
    expect(src).not.toMatch(/sent_at/);
  });
});
