/**
 * Weekly TTO period keys — aligned with /api/cron/weekly-sms getWeekKey + Mon–Sun proof window.
 * Kept free of Supabase imports so admin copy/tests can use it safely.
 */

import { getDateKeyInTimezone } from "@/lib/timezone";
import { getWeekKeyForLocalDateKey } from "@/lib/weekly-sms-week-key";

export const WEEKLY_TTO_WEEK_ANCHOR_RULE = "user_local_sunday_week_end" as const;
export const WEEKLY_TTO_WRITER_PROMPT_PATH = "weekly_brief_writer_v1" as const;
/** Draft body excludes compliance footer; future send may append it like weekly-sms. */
export const WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER = true as const;

export type ResolveTylerTextOverviewWeeklyPeriodArgs = {
  now: Date;
  timezone: string;
};

export type TylerTextOverviewWeeklyPeriod = {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  draftForDayKey: string;
  weekAnchorRule: typeof WEEKLY_TTO_WEEK_ANCHOR_RULE;
  timezone: string;
};

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Monday = 0 … Sunday = 6 — matches buildV2WeeklyProofPack week window. */
function weekdayMon0Sun6InTimezone(date: Date, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const key = short.slice(0, 3);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[key] ?? 0;
}

/**
 * Weekly TTO period: week_key is getWeekKey applied to the target Sunday (week_end),
 * not generate-now weekday. Friday/Saturday/Sunday generate and Sunday cron share one key.
 * draft_for_day_key = week_end Sunday date (Mon–Sun window matching weekly proof pack).
 * No morning rollover. No evening-only helper.
 */
export function resolveTylerTextOverviewWeeklyPeriod(
  args: ResolveTylerTextOverviewWeeklyPeriodArgs
): TylerTextOverviewWeeklyPeriod {
  const todayKey = getDateKeyInTimezone(args.now, args.timezone);
  const dow = weekdayMon0Sun6InTimezone(args.now, args.timezone);
  const weekStart = addCalendarDays(todayKey, -dow);
  const weekEnd = addCalendarDays(weekStart, 6);
  return {
    weekKey: getWeekKeyForLocalDateKey(weekEnd),
    weekStart,
    weekEnd,
    draftForDayKey: weekEnd,
    weekAnchorRule: WEEKLY_TTO_WEEK_ANCHOR_RULE,
    timezone: args.timezone,
  };
}
