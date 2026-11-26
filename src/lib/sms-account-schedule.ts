/**
 * Account Daily Texts schedule.
 * Pure helpers shared by the Account page and the preference API.
 * SQL NULL weekly_schedule means "no explicit Account schedule" (effective default).
 * An object with seven null days means the member turned scheduled texts off.
 */

import { isValidIanaTimezone } from "@/lib/timezone";

export const SMS_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type SmsWeekday = (typeof SMS_WEEKDAYS)[number];

/** Minutes after local midnight, or null when that day is off. */
export type SmsWeeklySchedule = Record<SmsWeekday, number | null>;

export const DEFAULT_SMS_LOCAL_MINUTE = 7 * 60;

export const SMS_TIME_ZONE_NAME_PATTERN = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/;

export const STANDARD_SMS_TIME_ZONES: readonly { label: string; zone: string }[] = [
  { label: "Eastern Time (ET)", zone: "America/New_York" },
  { label: "Central Time (CT)", zone: "America/Chicago" },
  { label: "Mountain Time (MT)", zone: "America/Denver" },
  { label: "Pacific Time (PT)", zone: "America/Los_Angeles" },
  { label: "Alaska Time (AKT)", zone: "America/Anchorage" },
  { label: "Hawaii Time (HT)", zone: "Pacific/Honolulu" },
  { label: "Arizona (MST)", zone: "America/Phoenix" },
];

const WEEKDAY_SET = new Set<string>(SMS_WEEKDAYS);

export function defaultWeeklySchedule(): SmsWeeklySchedule {
  return {
    monday: DEFAULT_SMS_LOCAL_MINUTE,
    tuesday: DEFAULT_SMS_LOCAL_MINUTE,
    wednesday: DEFAULT_SMS_LOCAL_MINUTE,
    thursday: DEFAULT_SMS_LOCAL_MINUTE,
    friday: DEFAULT_SMS_LOCAL_MINUTE,
    saturday: DEFAULT_SMS_LOCAL_MINUTE,
    sunday: DEFAULT_SMS_LOCAL_MINUTE,
  };
}

export function isPlausibleIanaZoneName(zone: string): boolean {
  return zone.length >= 1 && zone.length <= 80 && SMS_TIME_ZONE_NAME_PATTERN.test(zone);
}

/**
 * Accept a real IANA zone. Do not substitute Eastern Time for an invalid value.
 */
export function parseAccountScheduleTimezone(
  raw: unknown
): { ok: true; zone: string | null } | { ok: false } {
  if (raw === null) return { ok: true, zone: null };
  if (typeof raw !== "string") return { ok: false };
  const zone = raw.trim();
  if (!zone || zone !== raw || !isPlausibleIanaZoneName(zone) || !isValidIanaTimezone(zone)) {
    return { ok: false };
  }
  return { ok: true, zone };
}

export function parseWeeklySchedule(
  raw: unknown
): { ok: true; schedule: SmsWeeklySchedule | null } | { ok: false } {
  if (raw == null) return { ok: true, schedule: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== SMS_WEEKDAYS.length) return { ok: false };
  for (const key of keys) {
    if (!WEEKDAY_SET.has(key)) return { ok: false };
  }
  const schedule = {} as SmsWeeklySchedule;
  for (const day of SMS_WEEKDAYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, day)) return { ok: false };
    const value = obj[day];
    if (value === null) {
      schedule[day] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1439) {
      return { ok: false };
    }
    schedule[day] = value;
  }
  return { ok: true, schedule };
}

export function isNighttimeDeliveryMinute(minute: number): boolean {
  return minute >= 21 * 60 || minute < 6 * 60;
}

export function scheduleHasNighttimeDelivery(schedule: SmsWeeklySchedule): boolean {
  return SMS_WEEKDAYS.some((day) => {
    const minute = schedule[day];
    return minute != null && isNighttimeDeliveryMinute(minute);
  });
}

export function enabledDayCount(schedule: SmsWeeklySchedule): number {
  return SMS_WEEKDAYS.filter((day) => schedule[day] != null).length;
}

export function formatLocalMinuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function quarterHourMinutes(extraMinute: number | null): number[] {
  const values: number[] = [];
  for (let minute = 0; minute < 24 * 60; minute += 15) values.push(minute);
  if (
    extraMinute != null &&
    Number.isInteger(extraMinute) &&
    extraMinute >= 0 &&
    extraMinute <= 1439 &&
    !values.includes(extraMinute)
  ) {
    values.push(extraMinute);
    values.sort((a, b) => a - b);
  }
  return values;
}

export function timezoneLabel(zone: string): string {
  return STANDARD_SMS_TIME_ZONES.find((option) => option.zone === zone)?.label ?? zone;
}

export function timezoneChoices(currentZone: string | null): { label: string; zone: string }[] {
  const choices = STANDARD_SMS_TIME_ZONES.map((option) => ({ ...option }));
  if (currentZone && !choices.some((option) => option.zone === currentZone)) {
    choices.push({ label: currentZone, zone: currentZone });
  }
  return choices;
}

export type AccountTimezoneSource = "schedule" | "clerk" | "audience" | "default" | "unknown";

export function resolveAccountSmsTimezone(args: {
  scheduleTimezone: string | null;
  clerkTimezone: unknown;
  audienceTimezone: unknown;
  audienceUnreadable?: boolean;
}): { zone: string; source: AccountTimezoneSource; invalidExplicit: boolean } {
  const explicit = args.scheduleTimezone?.trim() ?? "";
  if (explicit) {
    if (isValidIanaTimezone(explicit)) {
      return { zone: explicit, source: "schedule", invalidExplicit: false };
    }
    return { zone: explicit, source: "schedule", invalidExplicit: true };
  }
  const clerk = typeof args.clerkTimezone === "string" ? args.clerkTimezone.trim() : "";
  if (clerk && isValidIanaTimezone(clerk)) {
    return { zone: clerk, source: "clerk", invalidExplicit: false };
  }
  if (args.audienceUnreadable) {
    return { zone: "", source: "unknown", invalidExplicit: false };
  }
  const audience = typeof args.audienceTimezone === "string" ? args.audienceTimezone.trim() : "";
  if (audience && isValidIanaTimezone(audience)) {
    return { zone: audience, source: "audience", invalidExplicit: false };
  }
  return { zone: "America/New_York", source: "default", invalidExplicit: false };
}

export function dailyTextsFrequencyCopy(args: {
  schedule: SmsWeeklySchedule;
  paused: boolean;
  stopped: boolean;
  explicitSchedule: boolean;
  cadenceOverride: string | null;
  weekendSendPolicy: string | null;
  canTextCoach: boolean;
}): string {
  if (args.stopped) {
    return "Texts are stopped. Text START to resume text messages.";
  }
  if (args.paused) {
    return "Daily texts are paused. Your days and times stay saved.";
  }
  const enabled = enabledDayCount(args.schedule);
  if (enabled === 0) {
    return args.canTextCoach
      ? "Scheduled daily texts are off. You can still text Coach Pat."
      : "Scheduled daily texts are off.";
  }
  if (!args.explicitSchedule && args.cadenceOverride === "every_other_day") {
    return "An every-other-day limit is still on, so this is not a text every calendar day.";
  }
  if (!args.explicitSchedule && args.cadenceOverride === "every_3_days") {
    return "An every-third-day limit is still on, so this is not a text every calendar day.";
  }
  if (!args.explicitSchedule && args.weekendSendPolicy === "weekdays_only") {
    return "A weekdays-only limit is still on. Weekend days stay off until you save a new weekly schedule.";
  }
  if (enabled === 7) return "You will receive scheduled texts every day.";
  return `You will receive scheduled texts ${enabled} days per week.`;
}

/**
 * SAVE sends only the parts the member is confirming.
 * A timezone-only edit does not create an explicit weekly schedule.
 * Pressing SAVE with no edits, when no explicit schedule exists, confirms the displayed schedule.
 * Opening the page must not call this.
 */
export function buildDailyTextsSaveBody(args: {
  schedule: SmsWeeklySchedule;
  timezone: string;
  scheduleDirty: boolean;
  timezoneDirty: boolean;
  explicitSchedule: boolean;
}): { weekly_schedule?: SmsWeeklySchedule; schedule_timezone?: string } | null {
  const body: { weekly_schedule?: SmsWeeklySchedule; schedule_timezone?: string } = {};
  const confirmDisplayedDefault =
    !args.explicitSchedule && !args.scheduleDirty && !args.timezoneDirty;
  if (args.scheduleDirty || confirmDisplayedDefault) {
    body.weekly_schedule = args.schedule;
  }
  if (args.timezoneDirty) {
    body.schedule_timezone = args.timezone;
  }
  if (body.weekly_schedule === undefined && body.schedule_timezone === undefined) return null;
  return body;
}

export function sameTimeAcrossEnabledDays(schedule: SmsWeeklySchedule): boolean {
  const times = SMS_WEEKDAYS.map((day) => schedule[day]).filter((minute): minute is number => minute != null);
  if (times.length <= 1) return true;
  return times.every((minute) => minute === times[0]);
}

export function applySameTimeToEnabledDays(
  schedule: SmsWeeklySchedule,
  minute: number
): SmsWeeklySchedule {
  const next = { ...schedule };
  for (const day of SMS_WEEKDAYS) {
    if (next[day] != null) next[day] = minute;
  }
  return next;
}

/**
 * A member selection counts even when it matches the unconfirmed placeholder
 * currently shown in the control.
 */
export function explicitTimezoneSelection(args: {
  selectedZone: string;
}): { zone: string; explicit: boolean } {
  return { zone: args.selectedZone, explicit: args.selectedZone.trim().length > 0 };
}

export function canSaveDailyTexts(args: {
  stopped: boolean;
  scheduleInvalid: boolean;
  sourceUnknown: boolean;
  zone: string;
  zoneExplicit: boolean;
}): boolean {
  if (args.stopped || args.scheduleInvalid) return false;
  if (!args.zone || !isValidIanaTimezone(args.zone)) return false;
  if (args.sourceUnknown && !args.zoneExplicit) return false;
  return true;
}

export type PreferenceWriteState = "failed" | "confirmed" | "uncertain";

export function classifyPreferenceWriteResponse(args: {
  networkError: boolean;
  httpOk: boolean;
  body: unknown;
}): { state: PreferenceWriteState; refreshRequired: boolean } {
  if (args.networkError) return { state: "uncertain", refreshRequired: false };
  const body = args.body;
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (record?.preferencesPersisted === true && record.ok === true) {
    return { state: "confirmed", refreshRequired: record.refreshRequired === true };
  }
  if (record?.persistence === "uncertain") return { state: "uncertain", refreshRequired: false };
  if (!args.httpOk) return { state: "failed", refreshRequired: false };
  if (!record || record.ok !== true) return { state: "uncertain", refreshRequired: false };
  return { state: "confirmed", refreshRequired: false };
}

/** Human-readable timed pause. Unknown zones are labeled UTC, not member-local. */
export function formatTimedPauseWhen(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
  zoneKnown: boolean
): string | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return null;
  const known = zoneKnown && typeof timeZone === "string" && isValidIanaTimezone(timeZone);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: known ? timeZone : "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
  if (!known && !formatted.includes("UTC")) return `${formatted} UTC`;
  return formatted;
}

/** Refresh keeps unsaved day, time, and time-zone edits. Saved fields replace clean drafts. */
export function mergeAccountDailyTextsDraft(args: {
  loadedSchedule: SmsWeeklySchedule;
  loadedZone: string;
  sourceUnknown: boolean;
  draftSchedule: SmsWeeklySchedule;
  draftZone: string;
  scheduleDirty: boolean;
  zoneDirty: boolean;
}): { schedule: SmsWeeklySchedule; zone: string } {
  return {
    schedule: args.scheduleDirty ? args.draftSchedule : args.loadedSchedule,
    zone: args.zoneDirty ? args.draftZone : args.sourceUnknown ? "" : args.loadedZone,
  };
}

export function displayScheduleForAccount(args: {
  explicitSchedule: SmsWeeklySchedule | null;
  weekendSendPolicy: string | null;
}): SmsWeeklySchedule {
  if (args.explicitSchedule) return { ...args.explicitSchedule };
  const schedule = defaultWeeklySchedule();
  if (args.weekendSendPolicy === "weekdays_only") {
    schedule.saturday = null;
    schedule.sunday = null;
  }
  return schedule;
}
