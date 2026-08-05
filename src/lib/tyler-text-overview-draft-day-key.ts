import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  getTylerTextOverviewAdminLocalDayKey,
  TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE,
} from "@/lib/tyler-text-overview-dashboard-copy";

/** Canonical YYYY-MM-DD draft day key (calendar date, not timestamp). */
const DRAFT_DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `value` is a real Gregorian calendar day as YYYY-MM-DD.
 * Used to reject blank/malformed batch day keys before processing users.
 */
export function isTylerTextOverviewDraftDayKey(value: string): boolean {
  const m = DRAFT_DAY_KEY_RE.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(y, month - 1, day));
  return (
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * Fail-closed day-key gate for Morning TTO batch / per-user persistence.
 * Throws on blank or non-calendar values — never falls back to user-local hour.
 */
export function requireTylerTextOverviewDraftDayKey(
  value: string | null | undefined
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!isTylerTextOverviewDraftDayKey(trimmed)) {
    throw new Error(`invalid_draft_for_day_key:${value ?? ""}`);
  }
  return trimmed;
}

/**
 * Cron / control-room Morning batch: one intended draft day for every user.
 * Uses Eastern admin calendar today + 1 (next Morning accountability day).
 * Does not use per-user timezone or local hour.
 */
export function resolveCanonicalMorningTtoBatchDraftForDayKey(now: Date): string {
  const adminToday = getTylerTextOverviewAdminLocalDayKey(now);
  return dayKeyOffset(adminToday, 1);
}

export type ResolveTylerTextOverviewEveningDraftForDayKeyArgs = {
  now: Date;
  timezone: string;
};

/**
 * Accountability day for evening_checkin previews: user-local calendar today.
 * No morning/noon rollover and no tomorrow shift — evening asks about today's goal.
 */
export function resolveTylerTextOverviewEveningDraftForDayKey(
  args: ResolveTylerTextOverviewEveningDraftForDayKeyArgs
): string {
  return getDateKeyInTimezone(args.now, args.timezone);
}

/** Re-export for cron/docs callers that need the admin TZ constant next to day helpers. */
export { TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE };
