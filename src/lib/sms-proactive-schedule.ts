/**
 * Pure proactive-text schedule resolver.
 *
 * One member-local calendar date in, one calculated result out.
 * This module does not read or write preferences, drafts, or send events,
 * and it does not decide whether a past instant should still be sent.
 *
 * Callers supply:
 * - preferenceRead: a successful read (row or null) or a failed read.
 *   A failed read is not a missing row and must not become the default schedule.
 * - clerkTimezone, audienceTimezone, and audienceUnreadable.
 * - memberLocalDate: YYYY-MM-DD in the member's zone. Not the Eastern batch date.
 * - proactiveDeliveryAllowed: provider STOP, membership, and any other consent
 *   gate. This module does not query Clerk, Stripe, Supabase, or Twilio.
 * - legacyCadenceEligible: required only when there is no explicit weekly_schedule
 *   and cadence_override is every_other_day or every_3_days. The caller decides
 *   that from send history. This module does not.
 *
 * preferred_local_hour and preferred_send_window are not inputs.
 * A valid explicit weekly_schedule overrides cadence and weekend policy.
 * batchDate is a calculated fact. It is not draft_for_day_key.
 * Two member-local dates can share one Morning batch. Do not collapse them.
 *
 * Ordinary local times use a verified candidate instant. A day whose offset
 * does not agree across the probes below keeps the exhaustive minute scan.
 */

import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import {
  defaultWeeklySchedule,
  parseWeeklySchedule,
  resolveAccountSmsTimezone,
  SMS_WEEKDAYS,
  type AccountTimezoneSource,
  type SmsWeekday,
} from "@/lib/sms-account-schedule";
import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import {
  formatLocalHourMinute,
  getDateKeyInTimezone,
  isValidIanaTimezone,
} from "@/lib/timezone";

export const PROACTIVE_SCHEDULE_ADMIN_TIMEZONE = "America/New_York";

/** Administrative owner. Morning closes the overnight window. Evening is the daytime window. */
export type ProactiveTtoOwner = "morning" | "evening";

/** Database send_slot. Evening stays evening_checkin. */
export type ProactiveSendSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

export function proactiveSendSlotForOwner(owner: ProactiveTtoOwner): ProactiveSendSlot {
  return owner === "evening" ? SMS_DAILY_EVENING_PREVIEW_SEND_SLOT : SMS_DAILY_PRODUCTION_SEND_SLOT;
}

export function proactiveOwnerForSendSlot(slot: ProactiveSendSlot): ProactiveTtoOwner;
export function proactiveOwnerForSendSlot(slot: unknown): ProactiveTtoOwner | null;
export function proactiveOwnerForSendSlot(slot: unknown): ProactiveTtoOwner | null {
  if (slot === "morning" || slot === SMS_DAILY_PRODUCTION_SEND_SLOT) return "morning";
  if (slot === "evening" || slot === "evening_checkin" || slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return "evening";
  }
  return null;
}

export type ProactiveLegacyCadence = "daily" | "every_other_day" | "every_3_days";
export type ProactiveLegacyWeekend = "all" | "weekdays_only";

/** Fields this calculation reads. Legacy preferred-hour columns are intentionally absent. */
export type ProactiveSchedulePreferenceRow = {
  weekly_schedule: unknown;
  schedule_timezone: string | null;
  pause_indefinite: boolean;
  pause_until: string | null;
  cadence_override: ProactiveLegacyCadence | null;
  weekend_send_policy: ProactiveLegacyWeekend | null;
};

export type ProactiveSchedulePreferenceRead =
  | { ok: true; row: ProactiveSchedulePreferenceRow | null }
  | { ok: false };

export type ResolveProactiveScheduleInput = {
  preferenceRead: ProactiveSchedulePreferenceRead;
  clerkTimezone: unknown;
  audienceTimezone: unknown;
  audienceUnreadable?: boolean;
  memberLocalDate: string;
  proactiveDeliveryAllowed: boolean;
  legacyCadenceEligible?: boolean;
};

export type ScheduledProactiveText = {
  kind: "scheduled";
  memberLocalDate: string;
  selectedLocalMinute: number;
  effectiveLocalMinute: number;
  timeZone: string;
  timeZoneSource: AccountTimezoneSource;
  utcInstant: string;
  easternDate: string;
  easternMinute: number;
  owner: ProactiveTtoOwner;
  batchDate: string;
};

export type ProactiveScheduleUnscheduledReason =
  | "weekday_disabled"
  | "pause_indefinite"
  | "pause_until"
  | "consent_ineligible"
  | "weekend_policy"
  | "cadence"
  | "no_valid_local_instant";

export type UnscheduledProactiveText = {
  kind: "unscheduled";
  reason: ProactiveScheduleUnscheduledReason;
  memberLocalDate: string;
};

export type ProactiveScheduleUnresolvedReason =
  | "preference_read_failed"
  | "schedule_invalid"
  | "timezone_unknown"
  | "timezone_invalid"
  | "date_invalid"
  | "cadence_eligibility_required";

export type UnresolvedProactiveSchedule = {
  kind: "unresolved";
  reason: ProactiveScheduleUnresolvedReason;
  memberLocalDate: string | null;
};

export type ProactiveScheduleResult =
  | ScheduledProactiveText
  | UnscheduledProactiveText
  | UnresolvedProactiveSchedule;

type CalendarDate = { y: number; m: number; d: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** IANA offsets sit inside UTC−12 through UTC+14. The pad keeps the scan off those edges. */
const SCAN_LEAD_MS = 15 * HOUR_MS;
const SCAN_TRAIL_MS = 40 * HOUR_MS;
const MORNING_END_EXCLUSIVE = 10 * 60;
const EVENING_END_EXCLUSIVE = 21 * 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseMemberLocalDate(raw: unknown): CalendarDate | null {
  if (typeof raw !== "string") return null;
  const match = DATE_RE.exec(raw);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function weekdayFor(date: CalendarDate): SmsWeekday {
  const dow = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  const index = dow === 0 ? 6 : dow - 1;
  return SMS_WEEKDAYS[index];
}

function unresolved(
  reason: ProactiveScheduleUnresolvedReason,
  memberLocalDate: string | null
): UnresolvedProactiveSchedule {
  return { kind: "unresolved", reason, memberLocalDate };
}

function unscheduled(
  reason: ProactiveScheduleUnscheduledReason,
  memberLocalDate: string
): UnscheduledProactiveText {
  return { kind: "unscheduled", reason, memberLocalDate };
}

/** Existing timed-pause rule: active only while pause_until is strictly after the instant. */
function timedPauseCoversInstant(pauseUntil: string | null, utcMs: number): boolean {
  if (!pauseUntil) return false;
  const t = new Date(pauseUntil).getTime();
  return Number.isFinite(t) && t > utcMs;
}

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function readWall(
  fmt: Intl.DateTimeFormat,
  instant: Date
): { y: number; m: number; d: number; h: number; min: number; s: number } | null {
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => {
    const value = parts.find((part) => part.type === type)?.value;
    return value != null ? Number(value) : NaN;
  };
  let h = get("hour");
  if (h === 24) h = 0;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const min = get("minute");
  const s = get("second");
  if (![y, m, d, h, min, s].every((part) => Number.isFinite(part))) return null;
  return { y, m, d, h, min, s };
}

/** East-of-UTC offset in milliseconds, from the zone's own wall clock. */
function offsetMsAt(fmt: Intl.DateTimeFormat, utcMs: number): number | null {
  const wall = readWall(fmt, new Date(utcMs));
  if (!wall) return null;
  const wallAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min, wall.s);
  return wallAsUtc - utcMs;
}

function wallMatches(
  fmt: Intl.DateTimeFormat,
  utcMs: number,
  date: CalendarDate,
  hour: number,
  minute: number
): boolean {
  const wall = readWall(fmt, new Date(utcMs));
  return (
    wall != null &&
    wall.y === date.y &&
    wall.m === date.m &&
    wall.d === date.d &&
    wall.h === hour &&
    wall.min === minute &&
    wall.s === 0
  );
}

/**
 * Two-step offset correction. Returns the UTC instant only when that instant
 * formats back to the requested local minute. A gap or a non-minute offset returns null.
 */
function candidateUtc(
  fmt: Intl.DateTimeFormat,
  date: CalendarDate,
  hour: number,
  minute: number
): number | null {
  const label = Date.UTC(date.y, date.m - 1, date.d, hour, minute, 0);
  const firstOffset = offsetMsAt(fmt, label);
  if (firstOffset == null) return null;
  const corrected = label - firstOffset;
  const secondOffset = offsetMsAt(fmt, corrected);
  if (secondOffset == null) return null;
  const utcMs = label - secondOffset;
  if (!wallMatches(fmt, utcMs, date, hour, minute)) return null;
  return utcMs;
}

/**
 * Probes are not a proof that the offset never changed between them.
 * They reject the fast path when a lasting transition is visible at an
 * hourly local label or at either end of the scan window. A same-day
 * change that starts and ends inside one of those gaps still falls through
 * only if every probe happens to see the original offset; the scan remains
 * the path for any probe that disagrees.
 */
function ordinaryCandidate(
  fmt: Intl.DateTimeFormat,
  date: CalendarDate,
  selectedLocalMinute: number
): number | null {
  const hour = Math.floor(selectedLocalMinute / 60);
  const minute = selectedLocalMinute % 60;
  const utcMs = candidateUtc(fmt, date, hour, minute);
  if (utcMs == null) return null;
  const offset = offsetMsAt(fmt, utcMs);
  if (offset == null) return null;
  const utcMidnight = Date.UTC(date.y, date.m - 1, date.d);
  const probes = [utcMidnight - SCAN_LEAD_MS, utcMidnight + SCAN_TRAIL_MS];
  for (let localHour = 0; localHour <= 24; localHour += 1) {
    probes.push(Date.UTC(date.y, date.m - 1, date.d, localHour, 0, 0) - offset);
  }
  for (const probe of probes) {
    if (offsetMsAt(fmt, probe) !== offset) return null;
  }
  return utcMs;
}

/**
 * Earliest UTC instant for each local minute on this calendar date.
 * Ascending UTC order keeps the earlier fall-back occurrence.
 * Used only when the ordinary candidate is missing or the offset probes disagree.
 */
function scanLocalMinutes(fmt: Intl.DateTimeFormat, date: CalendarDate): Map<number, number> {
  const utcMidnight = Date.UTC(date.y, date.m - 1, date.d);
  const found = new Map<number, number>();
  for (let utc = utcMidnight - SCAN_LEAD_MS; utc <= utcMidnight + SCAN_TRAIL_MS; utc += MINUTE_MS) {
    const wall = readWall(fmt, new Date(utc));
    if (!wall || wall.y !== date.y || wall.m !== date.m || wall.d !== date.d) continue;
    const minute = wall.h * 60 + wall.min;
    if (minute < 0 || minute > 1439 || found.has(minute)) continue;
    found.set(minute, utc);
  }
  return found;
}

function resolveLocalDelivery(
  date: CalendarDate,
  selectedLocalMinute: number,
  timeZone: string
): { utcMs: number; effectiveLocalMinute: number } | null | "invalid-zone" {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = wallFormatter(timeZone);
  } catch {
    return "invalid-zone";
  }
  const fast = ordinaryCandidate(fmt, date, selectedLocalMinute);
  if (fast != null) return { utcMs: fast, effectiveLocalMinute: selectedLocalMinute };
  return effectiveDelivery(scanLocalMinutes(fmt, date), selectedLocalMinute);
}

/**
 * Exact local minute when it exists (earlier UTC if it exists twice).
 * A spring-forward gap moves to the next valid local minute on the same date.
 */
function effectiveDelivery(
  found: Map<number, number>,
  selectedLocalMinute: number
): { utcMs: number; effectiveLocalMinute: number } | null {
  const exact = found.get(selectedLocalMinute);
  if (exact != null) return { utcMs: exact, effectiveLocalMinute: selectedLocalMinute };
  for (let minute = selectedLocalMinute + 1; minute <= 1439; minute += 1) {
    const utc = found.get(minute);
    if (utc != null) return { utcMs: utc, effectiveLocalMinute: minute };
  }
  return null;
}

function easternFacts(utcMs: number): {
  easternDate: string;
  easternMinute: number;
  owner: ProactiveTtoOwner;
  batchDate: string;
} | null {
  const instant = new Date(utcMs);
  const easternDate = getDateKeyInTimezone(instant, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const hhmm = formatLocalHourMinute(instant, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const easternMinute = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isInteger(easternMinute) || easternMinute < 0 || easternMinute > 1439) return null;
  const owner: ProactiveTtoOwner =
    easternMinute >= MORNING_END_EXCLUSIVE && easternMinute < EVENING_END_EXCLUSIVE
      ? "evening"
      : "morning";
  const batchDate =
    owner === "evening" || easternMinute < EVENING_END_EXCLUSIVE
      ? easternDate
      : dayKeyOffset(easternDate, 1);
  return { easternDate, easternMinute, owner, batchDate };
}

/**
 * One supplied instant must be the member-local date, effective minute, zone,
 * Eastern owner, and administrative batch date together.
 * Uses resolveLocalDelivery and easternFacts. It does not scan minutes again.
 */
export function scheduledDeliveryTupleIsCoherent(parts: {
  utcInstant: string;
  memberLocalDate: string;
  effectiveLocalMinute: number;
  timeZone: string;
  owner: ProactiveTtoOwner;
  administrativeBatchDate?: string | null;
}): boolean {
  if (!isValidIanaTimezone(parts.timeZone)) return false;
  if (
    !Number.isInteger(parts.effectiveLocalMinute) ||
    parts.effectiveLocalMinute < 0 ||
    parts.effectiveLocalMinute > 1439
  ) {
    return false;
  }
  const date = parseMemberLocalDate(parts.memberLocalDate);
  if (!date) return false;
  const suppliedMs = Date.parse(parts.utcInstant);
  if (!Number.isFinite(suppliedMs)) return false;
  const resolved = resolveLocalDelivery(date, parts.effectiveLocalMinute, parts.timeZone);
  if (resolved == null || resolved === "invalid-zone") return false;
  if (resolved.effectiveLocalMinute !== parts.effectiveLocalMinute) return false;
  if (resolved.utcMs !== suppliedMs) return false;
  const instant = new Date(resolved.utcMs);
  if (getDateKeyInTimezone(instant, parts.timeZone) !== parts.memberLocalDate) return false;
  const localClock = /^(\d{2}):(\d{2})$/.exec(formatLocalHourMinute(instant, parts.timeZone));
  if (!localClock) return false;
  const localMinute = Number(localClock[1]) * 60 + Number(localClock[2]);
  if (localMinute !== parts.effectiveLocalMinute) return false;
  const eastern = easternFacts(resolved.utcMs);
  if (!eastern || eastern.owner !== parts.owner) return false;
  if (
    parts.administrativeBatchDate != null &&
    parts.administrativeBatchDate !== eastern.batchDate
  ) {
    return false;
  }
  return true;
}

export function resolveProactiveSchedule(
  input: ResolveProactiveScheduleInput
): ProactiveScheduleResult {
  const date = parseMemberLocalDate(input.memberLocalDate);
  if (!date) return unresolved("date_invalid", null);
  const memberLocalDate = input.memberLocalDate;

  if (!input.preferenceRead.ok) return unresolved("preference_read_failed", memberLocalDate);

  const row = input.preferenceRead.row;
  let explicit = false;
  let schedule = defaultWeeklySchedule();
  if (row && row.weekly_schedule != null) {
    const parsed = parseWeeklySchedule(row.weekly_schedule);
    if (!parsed.ok || parsed.schedule == null) {
      return unresolved("schedule_invalid", memberLocalDate);
    }
    explicit = true;
    schedule = parsed.schedule;
  }

  if (input.proactiveDeliveryAllowed !== true) {
    return unscheduled("consent_ineligible", memberLocalDate);
  }
  if (row?.pause_indefinite === true) return unscheduled("pause_indefinite", memberLocalDate);

  const weekday = weekdayFor(date);
  const selectedLocalMinute = schedule[weekday];
  if (selectedLocalMinute == null) return unscheduled("weekday_disabled", memberLocalDate);

  const weekend = row?.weekend_send_policy ?? null;
  if (
    !explicit &&
    weekend === "weekdays_only" &&
    (weekday === "saturday" || weekday === "sunday")
  ) {
    return unscheduled("weekend_policy", memberLocalDate);
  }

  const cadence = row?.cadence_override ?? null;
  if (!explicit && cadence != null && cadence !== "daily") {
    if (
      (cadence !== "every_other_day" && cadence !== "every_3_days") ||
      typeof input.legacyCadenceEligible !== "boolean"
    ) {
      return unresolved("cadence_eligibility_required", memberLocalDate);
    }
    if (!input.legacyCadenceEligible) return unscheduled("cadence", memberLocalDate);
  }

  const zone = resolveAccountSmsTimezone({
    scheduleTimezone: row?.schedule_timezone ?? null,
    clerkTimezone: input.clerkTimezone,
    audienceTimezone: input.audienceTimezone,
    audienceUnreadable: input.audienceUnreadable === true,
  });
  if (zone.source === "unknown") return unresolved("timezone_unknown", memberLocalDate);
  if (zone.invalidExplicit || !isValidIanaTimezone(zone.zone)) {
    return unresolved("timezone_invalid", memberLocalDate);
  }

  const delivery = resolveLocalDelivery(date, selectedLocalMinute, zone.zone);
  if (delivery === "invalid-zone") return unresolved("timezone_invalid", memberLocalDate);
  if (!delivery) return unscheduled("no_valid_local_instant", memberLocalDate);

  if (row && timedPauseCoversInstant(row.pause_until, delivery.utcMs)) {
    return unscheduled("pause_until", memberLocalDate);
  }

  const eastern = easternFacts(delivery.utcMs);
  if (!eastern) return unscheduled("no_valid_local_instant", memberLocalDate);

  return {
    kind: "scheduled",
    memberLocalDate,
    selectedLocalMinute,
    effectiveLocalMinute: delivery.effectiveLocalMinute,
    timeZone: zone.zone,
    timeZoneSource: zone.source,
    utcInstant: new Date(delivery.utcMs).toISOString(),
    easternDate: eastern.easternDate,
    easternMinute: eastern.easternMinute,
    owner: eastern.owner,
    batchDate: eastern.batchDate,
  };
}
