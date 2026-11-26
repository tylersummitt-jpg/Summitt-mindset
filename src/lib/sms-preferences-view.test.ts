import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { maskSmsPhoneDisplay } from "@/lib/sms-preferences-types";
import {
  assertSmsPreferencesPatchAllowed,
  buildSmsPreferencesViewModel,
  deriveRelationshipStatus,
  isClearOnlySmsPreferencesPatch,
  validateSmsPreferencesPatch,
} from "@/lib/sms-preferences-view";
import { MAX_PAUSE_DURATION_MS } from "@/lib/v2-sms-comms-preferences";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

const baseRow = (over: Partial<V2UserSmsCommsPreferencesRow>): V2UserSmsCommsPreferencesRow => ({
  clerk_user_id: "user_1",
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

const now = new Date("2026-05-22T15:00:00.000Z");

describe("sms-preferences-view", () => {
  it("builds active status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: null,
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view.relationshipStatus).toBe("active");
    expect(view.pauseActive).toBe(false);
  });

  it("builds paused status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({ pause_until: "2026-12-01T11:00:00.000Z", pause_reason_category: "vacation" }),
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view.relationshipStatus).toBe("paused");
    expect(view.pauseActive).toBe(true);
    expect(view.pauseReasonLabel).toBe("Vacation");
  });

  it("builds stopped status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: false,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: null,
      accountabilityPhase: null,
      now,
    });
    expect(view.relationshipStatus).toBe("stopped");
  });

  it("masks phone", () => {
    expect(maskSmsPhoneDisplay("+15551234567")).toBe("(***) ***-4567");
    expect(maskSmsPhoneDisplay("")).toBeNull();
  });

  it("GET view model omits timing display fields", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({ preferred_local_hour: 9, preferred_send_window: "morning" }),
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view).not.toHaveProperty("effectiveTimingLabel");
    expect(view).not.toHaveProperty("effectiveTimingSource");
    expect(view).not.toHaveProperty("preferredSendWindow");
    expect(view).not.toHaveProperty("preferredLocalHour");
    expect(view.cadenceLabel).toBe("Daily (default rhythm)");
    expect(view.weekendLabel).toBe("All days");
  });

  it("validates pause max duration", () => {
    const tooFar = new Date(now.getTime() + MAX_PAUSE_DURATION_MS + 86400000).toISOString();
    const result = validateSmsPreferencesPatch({ pause_until: tooFar }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects preferred_send_window from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ preferred_send_window: "morning" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Unknown field");
    }
  });

  it("rejects preferred_local_hour from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ preferred_local_hour: 7 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Unknown field");
    }
  });

  it("rejects clearPreferredTime from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ clearPreferredTime: true }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown field");
  });

  it("rejects unknown fields", () => {
    const result = validateSmsPreferencesPatch({ sms_enabled: true }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown field");
  });

  it("rejects pending photo-request columns from app PATCH", () => {
    for (const key of [
      "pending_photo_request_win_id",
      "pending_photo_request_expires_at",
      "last_photo_request_sent_at",
    ]) {
      const result = validateSmsPreferencesPatch({ [key]: "x" }, now);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Unknown field");
    }
  });

  it("rejects daily cadence from app", () => {
    const result = validateSmsPreferencesPatch({ cadence_override: "daily" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("daily");
  });

  it("clear-only patch detection", () => {
    expect(isClearOnlySmsPreferencesPatch({ clearPause: true })).toBe(true);
    expect(isClearOnlySmsPreferencesPatch({ cadence_override: "every_other_day" })).toBe(false);
  });

  it("deriveRelationshipStatus not_configured without phone", () => {
    expect(
      deriveRelationshipStatus({
        smsEnabled: true,
        phoneConfigured: false,
        prefs: null,
        now,
      })
    ).toBe("not_configured");
  });

  it("missing preference row resolves to the default without calling it saved", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/Chicago",
      smsDisclosureAccepted: true,
      prefs: null,
      accountabilityPhase: null,
      now,
    });
    expect(view.preferenceRecordPresent).toBe(false);
    expect(view.weeklyScheduleExplicit).toBe(false);
    expect(view.weeklySchedule).toBeNull();
    expect(view.effectiveTimezone).toBe("America/Chicago");
    expect(view.effectiveTimezoneSource).toBe("clerk");
    expect(view.applicationPauseActive).toBe(false);
    expect(view.consentKnown).toBe(true);
  });

  it("an explicit all-off schedule is not the default and does not pause", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({
        weekly_schedule: {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        cadence_override: "every_other_day",
        weekend_send_policy: "weekdays_only",
        preferred_local_hour: 8,
      }),
      accountabilityPhase: null,
      now,
    });
    expect(view.weeklyScheduleExplicit).toBe(true);
    expect(view.weeklySchedule?.sunday).toBeNull();
    expect(view.applicationPauseActive).toBe(false);
    expect(view.cadenceOverride).toBe("every_other_day");
    expect(view.weekendSendPolicy).toBe("weekdays_only");
    expect(view).not.toHaveProperty("preferredLocalHour");
  });

  it("indefinite pause stays paused without erasing a future timed pause", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({
        pause_indefinite: true,
        pause_until: "2026-12-01T11:00:00.000Z",
        schedule_timezone: "America/Denver",
      }),
      accountabilityPhase: null,
      now,
    });
    expect(view.pauseIndefinite).toBe(true);
    expect(view.timedPauseActive).toBe(true);
    expect(view.applicationPauseActive).toBe(true);
    expect(view.relationshipStatus).toBe("paused");
    expect(view.pauseUntil).toBe("2026-12-01T11:00:00.000Z");
    expect(view.effectiveTimezone).toBe("America/Denver");
  });

  it("keeps a valid time zone that is not one of the seven standard labels", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({ schedule_timezone: "Europe/Paris" }),
      accountabilityPhase: null,
      now,
    });
    expect(view.scheduleTimezoneExplicit).toBe(true);
    expect(view.effectiveTimezone).toBe("Europe/Paris");
    expect(view.effectiveTimezoneSource).toBe("schedule");
  });

  it("does not treat an unreadable audience zone as Eastern when Clerk has no zone", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: null,
      smsDisclosureAccepted: true,
      prefs: null,
      audienceTimezoneUnreadable: true,
      accountabilityPhase: null,
      now,
    });
    expect(view.effectiveTimezoneSource).toBe("unknown");
    expect(view.effectiveTimezone).toBe("");
  });

  it("schedule validation accepts minute values and rejects malformed schedules", () => {
    const valid = validateSmsPreferencesPatch({
      weekly_schedule: {
        monday: 421,
        tuesday: 0,
        wednesday: null,
        thursday: 1439,
        friday: null,
        saturday: null,
        sunday: null,
      },
      schedule_timezone: "America/Los_Angeles",
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.upsert.patch.weekly_schedule?.monday).toBe(421);
      expect(valid.upsert.patch.schedule_timezone).toBe("America/Los_Angeles");
      expect(valid.upsert.patch).not.toHaveProperty("pause_indefinite");
    }

    const timezoneOnly = validateSmsPreferencesPatch({ schedule_timezone: "Pacific/Honolulu" });
    expect(timezoneOnly.ok).toBe(true);
    if (timezoneOnly.ok) {
      expect(timezoneOnly.upsert.patch).toEqual({ schedule_timezone: "Pacific/Honolulu" });
    }

    const bad = [
      { weekly_schedule: { monday: 1440 } },
      { weekly_schedule: { monday: -1 } },
      { weekly_schedule: { monday: 7.25 } },
      { weekly_schedule: { monday: "420" } },
      { weekly_schedule: ["monday"] },
      { schedule_timezone: "Not a zone" },
      { schedule_timezone: "America/Not_A_Real_Place" },
      { account_pause: "resume", weekly_schedule: { monday: 420 } },
    ];
    for (const body of bad) {
      const result = validateSmsPreferencesPatch(body);
      expect(result.ok).toBe(false);
    }
  });

  it("account resume clears pause without being allowed after STOP", () => {
    const resume = validateSmsPreferencesPatch({ account_pause: "resume" });
    expect(resume.ok).toBe(true);
    if (resume.ok) {
      expect(resume.upsert.clearPause).toBe(true);
      expect(resume.upsert.clearIndefinitePause).toBe(true);
      expect(resume.upsert.patch).not.toHaveProperty("cadence_override");
      expect(resume.upsert.patch).not.toHaveProperty("weekly_schedule");
      expect(resume.upsert.patch).not.toHaveProperty("schedule_timezone");
      expect(resume.upsert.patch).not.toHaveProperty("pause_indefinite");
    }
    expect(isClearOnlySmsPreferencesPatch({ account_pause: "resume" })).toBe(false);
    expect(isClearOnlySmsPreferencesPatch({ account_pause: "indefinite" })).toBe(false);
    expect(
      assertSmsPreferencesPatchAllowed({
        smsEnabled: false,
        body: { account_pause: "resume" },
      }).ok
    ).toBe(false);

    const legacy = validateSmsPreferencesPatch({ clearPause: true });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.upsert.clearPause).toBe(true);
      expect(legacy.upsert.clearIndefinitePause).toBeUndefined();
    }
    const legacyNull = validateSmsPreferencesPatch({ pause_until: null });
    expect(legacyNull.ok).toBe(true);
    if (legacyNull.ok) {
      expect(legacyNull.upsert.clearPause).toBe(true);
      expect(legacyNull.upsert.clearIndefinitePause).toBeUndefined();
    }
  });
});
