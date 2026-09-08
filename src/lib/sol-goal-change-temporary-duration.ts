/**
 * Pure server resolver for Sol Goal Change temporary overlay expiry.
 *
 * Sol owns English meaning (structured duration enums only).
 * This module owns deterministic civil-calendar math.
 *
 * No DB. No OpenAI. No pending writes. No overlay writes.
 * Does not inspect raw member text.
 *
 * WEEKDAY OCCURRENCE LAW (Slice 7A):
 * Next occurrence of the named weekday on or after the current member-local
 * date (delta 0 = today). through_weekday includes that day. until_weekday
 * excludes it. If until_weekday resolves to today, the boundary is already
 * at or before now — fail closed; do not jump to next week.
 */

import {
  getDateKeyInTimezone,
  localDayUtcRange,
  resolveUserTimezone,
  utcInstantForLocalMidnight,
} from "@/lib/timezone";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import type {
  SolGoalChangeTemporaryDurationKind,
  SolGoalChangeTemporaryWeekday,
} from "@/lib/sol-goal-change-semantic";
import { SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MAX } from "@/lib/sol-goal-change-semantic";

export const TEMPORARY_WEEKDAY_OCCURRENCE_RULE =
  "next_occurrence_on_or_after_today" as const;

export const TEMPORARY_OVERLAY_MAX_LOCAL_DAYS =
  SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MAX;

const WEEKDAY_TO_MON0: Record<SolGoalChangeTemporaryWeekday, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export type ResolveTemporaryOverlayExpiryInput = {
  temporary_duration_kind: SolGoalChangeTemporaryDurationKind;
  temporary_duration_days: number | null;
  temporary_weekday: SolGoalChangeTemporaryWeekday | null;
  temporary_end_local_date: string | null;
  timezone: string | null;
  now: Date;
};

export type TemporaryOverlayExpiryReason =
  | "resolved"
  | "unspecified"
  | "invalid_structure"
  | "invalid_date"
  | "already_expired"
  | "beyond_supported_window"
  | "unresolvable_calendar";

export type TemporaryOverlayExpiryResult = {
  supported: boolean;
  expires_at_utc: string | null;
  last_included_local_date: string | null;
  clarification_required: boolean;
  reason: TemporaryOverlayExpiryReason;
};

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function monday0FromDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const jsSun0 = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (jsSun0 + 6) % 7;
}

function fail(
  reason: Exclude<TemporaryOverlayExpiryReason, "resolved">
): TemporaryOverlayExpiryResult {
  return {
    supported: false,
    expires_at_utc: null,
    last_included_local_date: null,
    clarification_required: true,
    reason,
  };
}

function resolved(args: {
  expiresAtUtc: string;
  lastIncludedLocalDate: string;
}): TemporaryOverlayExpiryResult {
  return {
    supported: true,
    expires_at_utc: args.expiresAtUtc,
    last_included_local_date: args.lastIncludedLocalDate,
    clarification_required: false,
    reason: "resolved",
  };
}

function expiryAfterLocalDay(
  lastIncludedLocalDate: string,
  timezone: string
): TemporaryOverlayExpiryResult {
  const range = localDayUtcRange(lastIncludedLocalDate, timezone);
  if (!range) return fail("unresolvable_calendar");
  return resolved({
    expiresAtUtc: range.endUtcIso,
    lastIncludedLocalDate,
  });
}

function expiryAtLocalDayStart(
  boundaryLocalDate: string,
  lastIncludedLocalDate: string,
  timezone: string
): TemporaryOverlayExpiryResult {
  const start = utcInstantForLocalMidnight(boundaryLocalDate, timezone);
  if (!start) return fail("unresolvable_calendar");
  return resolved({
    expiresAtUtc: start.toISOString(),
    lastIncludedLocalDate,
  });
}

function capAndGuard(args: {
  now: Date;
  todayKey: string;
  timezone: string;
  lastIncluded: string;
  result: TemporaryOverlayExpiryResult;
}): TemporaryOverlayExpiryResult {
  if (!args.result.supported || !args.result.expires_at_utc) return args.result;
  const maxLast = addCalendarDays(args.todayKey, TEMPORARY_OVERLAY_MAX_LOCAL_DAYS - 1);
  if (args.lastIncluded > maxLast) return fail("beyond_supported_window");
  if (args.lastIncluded < args.todayKey) return fail("already_expired");
  if (Date.parse(args.result.expires_at_utc) <= args.now.getTime()) {
    return fail("already_expired");
  }
  return args.result;
}

/**
 * Resolve overlay expiry from structured duration fields + member timezone + now.
 * Civil local days, never rolling 24h. DST-safe via timezone helpers.
 */
export function resolveTemporaryOverlayExpiry(
  input: ResolveTemporaryOverlayExpiryInput
): TemporaryOverlayExpiryResult {
  const timezone = resolveUserTimezone(input.timezone);
  const now = input.now;
  const todayKey = getDateKeyInTimezone(now, timezone);
  const kind = input.temporary_duration_kind;
  const days = input.temporary_duration_days;
  const weekday = input.temporary_weekday;
  const date = input.temporary_end_local_date;

  const guard = (
    lastIncluded: string,
    result: TemporaryOverlayExpiryResult
  ): TemporaryOverlayExpiryResult =>
    capAndGuard({ now, todayKey, timezone, lastIncluded, result });

  if (kind === "unspecified") {
    if (days != null || weekday != null || date != null) return fail("invalid_structure");
    return fail("unspecified");
  }

  if (kind === "remaining_local_day") {
    if (days != null || weekday != null || date != null) return fail("invalid_structure");
    return guard(todayKey, expiryAfterLocalDay(todayKey, timezone));
  }

  if (kind === "days") {
    if (
      days == null ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > TEMPORARY_OVERLAY_MAX_LOCAL_DAYS ||
      weekday != null ||
      date != null
    ) {
      return fail("invalid_structure");
    }
    const lastIncluded = addCalendarDays(todayKey, days - 1);
    return guard(lastIncluded, expiryAfterLocalDay(lastIncluded, timezone));
  }

  if (kind === "local_week") {
    if (days != null || weekday != null || date != null) return fail("invalid_structure");
    const week = resolveTylerTextOverviewWeeklyPeriod({ now, timezone });
    return guard(week.weekEnd, expiryAfterLocalDay(week.weekEnd, timezone));
  }

  if (kind === "through_weekday" || kind === "until_weekday") {
    if (!weekday || days != null || date != null) return fail("invalid_structure");
    const todayMon0 = monday0FromDateKey(todayKey);
    const targetMon0 = WEEKDAY_TO_MON0[weekday];
    const delta = (targetMon0 - todayMon0 + 7) % 7;
    if (kind === "through_weekday") {
      const lastIncluded = addCalendarDays(todayKey, delta);
      return guard(lastIncluded, expiryAfterLocalDay(lastIncluded, timezone));
    }
    if (delta === 0) return fail("already_expired");
    const boundary = addCalendarDays(todayKey, delta);
    const lastIncluded = addCalendarDays(boundary, -1);
    return guard(lastIncluded, expiryAtLocalDayStart(boundary, lastIncluded, timezone));
  }

  if (kind === "through_local_date" || kind === "until_local_date") {
    if (!date || days != null || weekday != null) return fail("invalid_structure");
    const start = utcInstantForLocalMidnight(date, timezone);
    if (!start) return fail("invalid_date");
    if (kind === "through_local_date") {
      return guard(date, expiryAfterLocalDay(date, timezone));
    }
    const lastIncluded = addCalendarDays(date, -1);
    return guard(lastIncluded, expiryAtLocalDayStart(date, lastIncluded, timezone));
  }

  return fail("invalid_structure");
}
