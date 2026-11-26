import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildDailyTextsSaveBody,
  canSaveDailyTexts,
  classifyPreferenceWriteResponse,
  dailyTextsFrequencyCopy,
  defaultWeeklySchedule,
  displayScheduleForAccount,
  explicitTimezoneSelection,
  formatTimedPauseWhen,
  isNighttimeDeliveryMinute,
  mergeAccountDailyTextsDraft,
  parseWeeklySchedule,
  scheduleHasNighttimeDelivery,
} from "@/lib/sms-account-schedule";

const off = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
} as const;

describe("account SMS schedule", () => {
  it("uses 7:00 AM on all seven days when no explicit schedule exists", () => {
    expect(defaultWeeklySchedule()).toEqual({
      monday: 420,
      tuesday: 420,
      wednesday: 420,
      thursday: 420,
      friday: 420,
      saturday: 420,
      sunday: 420,
    });
    const shown = displayScheduleForAccount({
      explicitSchedule: null,
      weekendSendPolicy: "weekdays_only",
    });
    expect(shown.saturday).toBeNull();
    expect(shown.sunday).toBeNull();
    expect(shown.monday).toBe(420);
    expect(defaultWeeklySchedule().saturday).toBe(420);
  });

  it("does not read an all-off schedule as the default", () => {
    const parsed = parseWeeklySchedule(off);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.schedule).toEqual(off);
  });

  it("rejects malformed schedules and accepts whole minutes", () => {
    expect(
      parseWeeklySchedule({
        monday: 421,
        tuesday: 0,
        wednesday: 1439,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      }).ok
    ).toBe(true);
    expect(parseWeeklySchedule({ monday: 1440 }).ok).toBe(false);
    expect(parseWeeklySchedule({ monday: -1 }).ok).toBe(false);
    expect(parseWeeklySchedule({ monday: 7.5 }).ok).toBe(false);
    expect(parseWeeklySchedule({ monday: "420" }).ok).toBe(false);
    expect(parseWeeklySchedule([]).ok).toBe(false);
    expect(parseWeeklySchedule(null)).toEqual({ ok: true, schedule: null });
  });

  it("night notice hours are 9:00 PM through 5:59 AM on enabled days only", () => {
    expect(isNighttimeDeliveryMinute(21 * 60)).toBe(true);
    expect(isNighttimeDeliveryMinute(5 * 60 + 59)).toBe(true);
    expect(isNighttimeDeliveryMinute(6 * 60)).toBe(false);
    expect(isNighttimeDeliveryMinute(20 * 60 + 59)).toBe(false);
    const schedule = defaultWeeklySchedule();
    schedule.monday = 23 * 60;
    schedule.tuesday = null;
    expect(scheduleHasNighttimeDelivery(schedule)).toBe(true);
    schedule.monday = 7 * 60;
    expect(scheduleHasNighttimeDelivery(schedule)).toBe(false);
  });

  it("adjusts frequency copy for pause, stop, no days, and older limits", () => {
    const schedule = defaultWeeklySchedule();
    expect(
      dailyTextsFrequencyCopy({
        schedule,
        paused: false,
        stopped: false,
        explicitSchedule: true,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toBe("You will receive scheduled texts every day.");
    schedule.sunday = null;
    expect(
      dailyTextsFrequencyCopy({
        schedule,
        paused: false,
        stopped: false,
        explicitSchedule: true,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toBe("You will receive scheduled texts 6 days per week.");
    expect(
      dailyTextsFrequencyCopy({
        schedule: { ...off },
        paused: false,
        stopped: false,
        explicitSchedule: true,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toBe("Scheduled daily texts are off. You can still text Coach Pat.");
    expect(
      dailyTextsFrequencyCopy({
        schedule: { ...off },
        paused: false,
        stopped: false,
        explicitSchedule: true,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: false,
      })
    ).toBe("Scheduled daily texts are off.");
    expect(
      dailyTextsFrequencyCopy({
        schedule: defaultWeeklySchedule(),
        paused: true,
        stopped: false,
        explicitSchedule: false,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toBe("Daily texts are paused. Your days and times stay saved.");
    expect(
      dailyTextsFrequencyCopy({
        schedule: defaultWeeklySchedule(),
        paused: false,
        stopped: true,
        explicitSchedule: false,
        cadenceOverride: null,
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toContain("Text START");
    expect(
      dailyTextsFrequencyCopy({
        schedule: defaultWeeklySchedule(),
        paused: false,
        stopped: false,
        explicitSchedule: false,
        cadenceOverride: "every_other_day",
        weekendSendPolicy: null,
        canTextCoach: true,
      })
    ).toContain("every-other-day");
  });

  it("timezone-only save does not create a schedule, and an untouched default can be confirmed", () => {
    const schedule = defaultWeeklySchedule();
    expect(
      buildDailyTextsSaveBody({
        schedule,
        timezone: "America/Chicago",
        scheduleDirty: false,
        timezoneDirty: true,
        explicitSchedule: false,
      })
    ).toEqual({ schedule_timezone: "America/Chicago" });
    expect(
      buildDailyTextsSaveBody({
        schedule,
        timezone: "America/New_York",
        scheduleDirty: false,
        timezoneDirty: false,
        explicitSchedule: false,
      })
    ).toEqual({ weekly_schedule: schedule });
    expect(
      buildDailyTextsSaveBody({
        schedule,
        timezone: "America/New_York",
        scheduleDirty: false,
        timezoneDirty: false,
        explicitSchedule: true,
      })
    ).toBeNull();
  });

  it("lets a member confirm a time zone when the effective zone is unknown", () => {
    expect(
      canSaveDailyTexts({
        stopped: false,
        scheduleInvalid: false,
        sourceUnknown: true,
        zone: "America/New_York",
        zoneExplicit: false,
      })
    ).toBe(false);
    const choice = explicitTimezoneSelection({ selectedZone: "America/New_York" });
    expect(choice).toEqual({ zone: "America/New_York", explicit: true });
    expect(
      canSaveDailyTexts({
        stopped: false,
        scheduleInvalid: false,
        sourceUnknown: true,
        zone: choice.zone,
        zoneExplicit: choice.explicit,
      })
    ).toBe(true);
    expect(
      buildDailyTextsSaveBody({
        schedule: defaultWeeklySchedule(),
        timezone: choice.zone,
        scheduleDirty: false,
        timezoneDirty: true,
        explicitSchedule: false,
      })
    ).toEqual({ schedule_timezone: "America/New_York" });
  });

  it("keeps unsaved schedule edits when refreshing saved preferences", () => {
    const dirty = { ...defaultWeeklySchedule(), monday: 480 };
    const loaded = defaultWeeklySchedule();
    expect(
      mergeAccountDailyTextsDraft({
        loadedSchedule: loaded,
        loadedZone: "America/Chicago",
        sourceUnknown: false,
        draftSchedule: dirty,
        draftZone: "America/Denver",
        scheduleDirty: true,
        zoneDirty: true,
      })
    ).toEqual({ schedule: dirty, zone: "America/Denver" });
    expect(
      mergeAccountDailyTextsDraft({
        loadedSchedule: loaded,
        loadedZone: "America/Chicago",
        sourceUnknown: false,
        draftSchedule: dirty,
        draftZone: "America/Denver",
        scheduleDirty: true,
        zoneDirty: false,
      })
    ).toEqual({ schedule: dirty, zone: "America/Chicago" });
    expect(
      mergeAccountDailyTextsDraft({
        loadedSchedule: loaded,
        loadedZone: "America/Chicago",
        sourceUnknown: false,
        draftSchedule: dirty,
        draftZone: "America/Denver",
        scheduleDirty: false,
        zoneDirty: true,
      })
    ).toEqual({ schedule: loaded, zone: "America/Denver" });
    expect(
      mergeAccountDailyTextsDraft({
        loadedSchedule: loaded,
        loadedZone: "America/Chicago",
        sourceUnknown: false,
        draftSchedule: dirty,
        draftZone: "America/Denver",
        scheduleDirty: false,
        zoneDirty: false,
      }).zone
    ).toBe("America/Chicago");
  });

  it("formats a timed pause without calling an unknown zone local time", () => {
    const iso = "2026-12-01T15:00:00.000Z";
    const known = formatTimedPauseWhen(iso, "America/New_York", true);
    expect(known).toBeTruthy();
    expect(known).toContain("10:00");
    expect(known).not.toContain("2026-12-01T15:00:00.000Z");
    const unknown = formatTimedPauseWhen(iso, "", false);
    expect(unknown).toContain("UTC");
    expect(unknown).not.toContain("EST");
    expect(formatTimedPauseWhen("not-a-date", "America/New_York", true)).toBeNull();
  });

  it("distinguishes failed, confirmed, and uncertain preference writes", () => {
    expect(
      classifyPreferenceWriteResponse({
        networkError: false,
        httpOk: false,
        body: { ok: false, persistence: "failed", error: "db down" },
      }).state
    ).toBe("failed");
    expect(
      classifyPreferenceWriteResponse({
        networkError: false,
        httpOk: true,
        body: { ok: true, preferencesPersisted: true, refreshRequired: false },
      })
    ).toEqual({ state: "confirmed", refreshRequired: false });
    expect(
      classifyPreferenceWriteResponse({
        networkError: false,
        httpOk: true,
        body: { ok: true, preferencesPersisted: true, refreshRequired: true },
      })
    ).toEqual({ state: "confirmed", refreshRequired: true });
    expect(
      classifyPreferenceWriteResponse({
        networkError: true,
        httpOk: false,
        body: null,
      }).state
    ).toBe("uncertain");
    expect(
      classifyPreferenceWriteResponse({
        networkError: false,
        httpOk: false,
        body: { ok: false, persistence: "uncertain" },
      }).state
    ).toBe("uncertain");
  });

  it("migration adds only the three account columns and no new table", () => {
    const sql = readFileSync(
      "supabase/migrations/20261125120000_v2_user_sms_comms_preferences_account_schedule.sql",
      "utf8"
    );
    expect(sql).toContain("ADD COLUMN weekly_schedule jsonb");
    expect(sql).toContain("ADD COLUMN schedule_timezone text");
    expect(sql).toContain("ADD COLUMN pause_indefinite boolean NOT NULL DEFAULT false");
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toContain("CREATE FUNCTION");
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql).not.toContain("CREATE INDEX");
    expect(sql).not.toContain("ENABLE ROW LEVEL SECURITY");
  });
});
