import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  isPauseActive,
  resolveDailySendWindowPolicy,
  shouldApplyUserCadenceOverride,
  shouldSkipDailyForCommsPrefs,
  type V2UserSmsCommsPreferencesRow,
} from "@/lib/v2-sms-comms-preferences";

const baseRow = (over: Partial<V2UserSmsCommsPreferencesRow>): V2UserSmsCommsPreferencesRow => ({
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

describe("comms preferences precedence", () => {
  const now = new Date("2026-05-22T15:00:00.000Z");
  const sat = new Date("2026-05-23T15:00:00.000Z");

  it("pause beats all", () => {
    const row = baseRow({
      pause_until: "2026-12-01T11:00:00.000Z",
      weekend_send_policy: "weekdays_only",
      preferred_local_hour: 7,
    });
    expect(shouldSkipDailyForCommsPrefs(row, sat, now).reason).toBe("user_pause");
    expect(shouldApplyUserCadenceOverride(row, now)).toBeNull();
  });

  it("weekend beats time when not paused", () => {
    const row = baseRow({ weekend_send_policy: "weekdays_only", preferred_local_hour: 7 });
    expect(shouldSkipDailyForCommsPrefs(row, sat, now).reason).toBe("weekend_policy");
  });

  it("preferred_local_hour beats preferred_send_window", () => {
    const policy = resolveDailySendWindowPolicy({
      prefs: baseRow({ preferred_local_hour: 9, preferred_send_window: "evening" }),
      learnedProfile: null,
      clerkSmsTimePreference: "morning",
    });
    expect(policy.useExplicitHour).toBe(true);
    expect(policy.explicitHour).toBe(9);
    expect(policy.useExplicitWindow).toBe(false);
  });

  it("preferred_send_window beats learned profile", () => {
    const policy = resolveDailySendWindowPolicy({
      prefs: baseRow({ preferred_send_window: "afternoon" }),
      learnedProfile: {
        clerk_user_id: "u1",
        preferred_window: "morning",
        confidence: 0.9,
        reply_count_morning: 5,
        reply_count_midday: 0,
        reply_count_afternoon: 0,
        reply_count_evening: 0,
        weak_no_reply_morning: 0,
        weak_no_reply_midday: 0,
        weak_no_reply_afternoon: 0,
        weak_no_reply_evening: 0,
        updated_at: "",
      },
      clerkSmsTimePreference: "morning",
    });
    expect(policy.useExplicitWindow).toBe(true);
    expect(policy.useLearnedProfile).toBe(false);
  });

  it("learned beats Clerk when no prefs", () => {
    const policy = resolveDailySendWindowPolicy({
      prefs: null,
      learnedProfile: {
        clerk_user_id: "u1",
        preferred_window: "evening",
        confidence: 0.9,
        reply_count_morning: 0,
        reply_count_midday: 0,
        reply_count_afternoon: 0,
        reply_count_evening: 5,
        weak_no_reply_morning: 0,
        weak_no_reply_midday: 0,
        weak_no_reply_afternoon: 0,
        weak_no_reply_evening: 0,
        updated_at: "",
      },
      clerkSmsTimePreference: "morning",
    });
    expect(policy.useLearnedProfile).toBe(true);
    expect(policy.useExplicitHour).toBe(false);
  });

  it("null prefs keeps current behavior flags", () => {
    const policy = resolveDailySendWindowPolicy({
      prefs: null,
      learnedProfile: null,
      clerkSmsTimePreference: "morning",
    });
    expect(policy.useExplicitHour).toBe(false);
    expect(policy.useExplicitWindow).toBe(false);
    expect(policy.useLearnedProfile).toBe(true);
  });

  it("pause active check", () => {
    expect(isPauseActive(baseRow({ pause_until: "2026-12-01T11:00:00.000Z" }), now)).toBe(true);
    expect(isPauseActive(baseRow({ pause_until: "2020-01-01T11:00:00.000Z" }), now)).toBe(false);
  });
});
