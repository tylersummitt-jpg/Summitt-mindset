/**
 * Morning / Evening proactive lane timing — fixed user-local windows.
 * Morning: [07:00, 09:00). Evening: [19:00, 21:00).
 * Scheduling uses Intl local parts via getLocalHourInTimezone / getLocalMinuteInTimezone.
 * Adaptive Clerk / learned / explicit hour authorities are not used for these lanes.
 */

import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { getLocalHourInTimezone } from "@/lib/v2-send-time-profile";

/** Inclusive start of Morning lane eligibility (07:00 local). */
export const MORNING_LANE_WINDOW_START_MINUTE = 7 * 60;

/** Exclusive end of Morning lane eligibility (09:00 local). */
export const MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE = 9 * 60;

/** Inclusive start of Evening lane eligibility (19:00 local). */
export const EVENING_LANE_WINDOW_START_MINUTE = 19 * 60;

/** Exclusive end of Evening lane eligibility (21:00 local). */
export const EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE = 21 * 60;

/**
 * Minimum age before a reserved/no-SID row may be marked unknown.
 * Fresh rows are treated as in-flight and must not be reclaimed by the next five-minute cron tick.
 * 15 minutes exceeds one long daily-sms pass while still allowing same-morning visibility.
 */
export const MORNING_RESERVATION_LEASE_MS = 15 * 60 * 1000;

/** Same lease policy for Evening slot reservations. */
export const EVENING_RESERVATION_LEASE_MS = MORNING_RESERVATION_LEASE_MS;

export type MorningLaneTimingReason =
  | "inside_morning_window"
  | "before_morning_window"
  | "after_morning_window";

export type MorningLaneTimingDecision = {
  allowed: boolean;
  timezone: string;
  localDayKey: string;
  localHour: number;
  localMinute: number;
  localMinuteOfDay: number;
  windowStartMinute: number;
  windowEndMinuteExclusive: number;
  reason: MorningLaneTimingReason;
};

export type EveningLaneTimingReason =
  | "inside_evening_window"
  | "before_evening_window"
  | "after_evening_window";

export type EveningLaneTimingDecision = {
  allowed: boolean;
  timezone: string;
  localDayKey: string;
  localHour: number;
  localMinute: number;
  localMinuteOfDay: number;
  windowStartMinute: number;
  windowEndMinuteExclusive: number;
  reason: EveningLaneTimingReason;
};

/** Local minute (0–59) in `timeZone` for instant `at`. */
export function getLocalMinuteInTimezone(at: Date, timeZone: string): number {
  const tz = resolveUserTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    minute: "numeric",
  }).formatToParts(at);
  const minutePart = parts.find((p) => p.type === "minute");
  const m = minutePart ? parseInt(minutePart.value, 10) : NaN;
  return Number.isFinite(m) ? m : 0;
}

export function evaluateMorningLaneTiming(args: {
  now: Date;
  timezone: string;
}): MorningLaneTimingDecision {
  const timezone = resolveUserTimezone(args.timezone);
  const localHour = getLocalHourInTimezone(args.now, timezone);
  const localMinute = getLocalMinuteInTimezone(args.now, timezone);
  const localMinuteOfDay = localHour * 60 + localMinute;
  const localDayKey = getDateKeyInTimezone(args.now, timezone);
  const windowStartMinute = MORNING_LANE_WINDOW_START_MINUTE;
  const windowEndMinuteExclusive = MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE;

  let reason: MorningLaneTimingReason;
  if (localMinuteOfDay < windowStartMinute) {
    reason = "before_morning_window";
  } else if (localMinuteOfDay >= windowEndMinuteExclusive) {
    reason = "after_morning_window";
  } else {
    reason = "inside_morning_window";
  }

  return {
    allowed: reason === "inside_morning_window",
    timezone,
    localDayKey,
    localHour,
    localMinute,
    localMinuteOfDay,
    windowStartMinute,
    windowEndMinuteExclusive,
    reason,
  };
}

export function isMorningLaneSendEligible(now: Date, timezone: string): boolean {
  return evaluateMorningLaneTiming({ now, timezone }).allowed;
}

export function evaluateEveningLaneTiming(args: {
  now: Date;
  timezone: string;
}): EveningLaneTimingDecision {
  const timezone = resolveUserTimezone(args.timezone);
  const localHour = getLocalHourInTimezone(args.now, timezone);
  const localMinute = getLocalMinuteInTimezone(args.now, timezone);
  const localMinuteOfDay = localHour * 60 + localMinute;
  const localDayKey = getDateKeyInTimezone(args.now, timezone);
  const windowStartMinute = EVENING_LANE_WINDOW_START_MINUTE;
  const windowEndMinuteExclusive = EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE;

  let reason: EveningLaneTimingReason;
  if (localMinuteOfDay < windowStartMinute) {
    reason = "before_evening_window";
  } else if (localMinuteOfDay >= windowEndMinuteExclusive) {
    reason = "after_evening_window";
  } else {
    reason = "inside_evening_window";
  }

  return {
    allowed: reason === "inside_evening_window",
    timezone,
    localDayKey,
    localHour,
    localMinute,
    localMinuteOfDay,
    windowStartMinute,
    windowEndMinuteExclusive,
    reason,
  };
}

export function isEveningLaneSendEligible(now: Date, timezone: string): boolean {
  return evaluateEveningLaneTiming({ now, timezone }).allowed;
}

export function reservationAgeMs(createdAt: string | null | undefined, now: Date): number | null {
  if (typeof createdAt !== "string" || !createdAt.trim()) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now.getTime() - t);
}

export function isMorningReservationWithinLease(
  createdAt: string | null | undefined,
  now: Date,
  leaseMs: number = MORNING_RESERVATION_LEASE_MS
): boolean {
  const age = reservationAgeMs(createdAt, now);
  if (age == null) {
    // Missing created_at: treat as in-flight (fail closed — no reclaim).
    return true;
  }
  return age < leaseMs;
}

export function isEveningReservationWithinLease(
  createdAt: string | null | undefined,
  now: Date,
  leaseMs: number = EVENING_RESERVATION_LEASE_MS
): boolean {
  return isMorningReservationWithinLease(createdAt, now, leaseMs);
}

/**
 * True only when a send_failed row is known-safe to retry (Twilio never successfully accepted).
 * Ambiguous / unknown outcomes must not auto-retry.
 */
export function isSafeMorningRetryFailure(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  if (metadata.twilio_send_attempted === true) return false;
  const note = typeof metadata.note === "string" ? metadata.note : "";
  if (
    note === "unknown_outcome_lease_expired" ||
    note === "recovered_stuck_reserved" ||
    note === "unknown_outcome_no_automatic_retry"
  ) {
    return false;
  }
  // Explicit pre-Twilio / config skips are safe.
  if (
    note === "dry_run_enabled" ||
    note === "twilio_not_ready" ||
    note === "skipped_missing_twilio" ||
    metadata.twilio_send_attempted === false
  ) {
    return true;
  }
  // Classic send_failed / retry_failed after messages.create threw: no SID, but outcome may be ambiguous.
  // Favor miss over duplicate — do not auto-retry.
  if (note === "send_failed" || note === "retry_failed") {
    return false;
  }
  return false;
}

/** Same no-ambiguous-retry law for Evening slot. */
export function isSafeEveningRetryFailure(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return isSafeMorningRetryFailure(metadata);
}

export function buildMorningLaneSchedulingTelemetry(args: {
  timezone: string;
  timing: MorningLaneTimingDecision;
  attemptKind: "first_attempt" | "safe_retry";
  reservationAgeMs?: number | null;
}): Record<string, unknown> {
  const t = args.timing;
  return {
    send_slot: "morning",
    timing_source: "fixed_morning_window",
    send_window_policy_source: "fixed_morning_window",
    user_timezone: args.timezone,
    day_key: t.localDayKey,
    computed_local_hour: t.localHour,
    computed_local_minute: t.localMinute,
    local_minute_of_day: t.localMinuteOfDay,
    morning_window_start_minute: t.windowStartMinute,
    morning_window_end_minute_exclusive: t.windowEndMinuteExclusive,
    morning_window_reason: t.reason,
    attempt_kind: args.attemptKind,
    ...(typeof args.reservationAgeMs === "number"
      ? { reservation_age_ms: args.reservationAgeMs }
      : {}),
  };
}

export function buildEveningLaneSchedulingTelemetry(args: {
  timezone: string;
  timing: EveningLaneTimingDecision;
  attemptKind: "first_attempt" | "safe_retry";
  reservationAgeMs?: number | null;
}): Record<string, unknown> {
  const t = args.timing;
  return {
    send_slot: "evening_checkin",
    timing_source: "fixed_evening_window",
    send_window_policy_source: "fixed_evening_window",
    user_timezone: args.timezone,
    day_key: t.localDayKey,
    computed_local_hour: t.localHour,
    computed_local_minute: t.localMinute,
    local_minute_of_day: t.localMinuteOfDay,
    evening_window_start_minute: t.windowStartMinute,
    evening_window_end_minute_exclusive: t.windowEndMinuteExclusive,
    evening_window_reason: t.reason,
    attempt_kind: args.attemptKind,
    ...(typeof args.reservationAgeMs === "number"
      ? { reservation_age_ms: args.reservationAgeMs }
      : {}),
  };
}
