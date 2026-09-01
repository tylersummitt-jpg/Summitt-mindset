/**
 * Pure Victory Calendar month / grid helpers.
 * Client-safe. No DB, auth, SMS, Sol, media, or persistence.
 *
 * Weekday-of-date uses Gregorian UTC calendar math (Date.UTC + getUTCDay).
 * Timezone conversion is not used here — callers bucket Wins and "today"
 * with timezone helpers separately.
 */

import { isValidOccurredOnDateKey } from "@/lib/v2-win-manual-fields";

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const VICTORY_CALENDAR_PATH = "/dashboard/victory-room";
export const VICTORY_CALENDAR_WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export const VICTORY_CALENDAR_SLOT_COUNT = 42;
export const VICTORY_CALENDAR_WEEKDAY_COUNT = 7;

export type VictoryCalendarSlot =
  | { kind: "blank" }
  | { kind: "day"; dateKey: string; dayOfMonth: number };

export function parseVictoryCalendarMonthKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = MONTH_KEY_RE.exec(raw.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m)) return null;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1) return null;
  return `${match[1]}-${match[2]}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatMonthKey(y: number, monthIndexZeroBased: number): string {
  const dt = new Date(Date.UTC(y, monthIndexZeroBased, 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}

/**
 * Visible month: missing/malformed/future → current member-local month.
 * Historical valid YYYY-MM is kept. Normalized YYYY-MM lexical compare is chronological.
 */
export function resolveVisibleVictoryCalendarMonth(args: {
  requestedMonth: unknown;
  currentMonthKey: string;
}): string | null {
  const current = parseVictoryCalendarMonthKey(args.currentMonthKey);
  if (!current) {
    return parseVictoryCalendarMonthKey(args.requestedMonth);
  }
  const requested = parseVictoryCalendarMonthKey(args.requestedMonth);
  if (!requested) return current;
  if (requested > current) return current;
  return requested;
}

export function previousVictoryCalendarMonth(monthKey: unknown): string | null {
  const parsed = parseVictoryCalendarMonthKey(monthKey);
  if (!parsed) return null;
  const y = Number(parsed.slice(0, 4));
  const m = Number(parsed.slice(5, 7));
  return formatMonthKey(y, m - 2);
}

export function nextVictoryCalendarMonth(monthKey: unknown): string | null {
  const parsed = parseVictoryCalendarMonthKey(monthKey);
  if (!parsed) return null;
  const y = Number(parsed.slice(0, 4));
  const m = Number(parsed.slice(5, 7));
  return formatMonthKey(y, m);
}

/**
 * English month label from calendar YYYY-MM pieces (UTC), e.g. "September 2026".
 * Uses Date.UTC year/month indexes — never Date-string parsing of YYYY-MM.
 */
export function formatVictoryCalendarMonthLabel(monthKey: unknown): string | null {
  const parsed = parseVictoryCalendarMonthKey(monthKey);
  if (!parsed) return null;
  const y = Number(parsed.slice(0, 4));
  const m = Number(parsed.slice(5, 7));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function daysInCalendarMonth(year: number, monthIndexZeroBased: number): number {
  return new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();
}

/**
 * Fixed 6×7 Sunday-first grid. Leading/trailing cells are blanks (not adjacent-month dates).
 */
export function buildVictoryCalendarGrid(monthKey: unknown): VictoryCalendarSlot[] | null {
  const parsed = parseVictoryCalendarMonthKey(monthKey);
  if (!parsed) return null;
  const year = Number(parsed.slice(0, 4));
  const month = Number(parsed.slice(5, 7));
  const monthIndex = month - 1;
  const leadingBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = daysInCalendarMonth(year, monthIndex);
  const slots: VictoryCalendarSlot[] = [];

  for (let i = 0; i < leadingBlanks; i++) {
    slots.push({ kind: "blank" });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    slots.push({
      kind: "day",
      dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
      dayOfMonth: day,
    });
  }
  while (slots.length < VICTORY_CALENDAR_SLOT_COUNT) {
    slots.push({ kind: "blank" });
  }

  return slots.length === VICTORY_CALENDAR_SLOT_COUNT ? slots : null;
}

export type VictoryCalendarPageState = {
  monthKey: string;
  selectedDay: string | null;
};

/**
 * Visible month + optional selected day from URL params and member-local today.
 * Malformed/future month → current. Invalid/future/out-of-month day → no selection.
 */
export function resolveVictoryCalendarPageState(args: {
  requestedMonth: unknown;
  requestedDay: unknown;
  todayKey: string;
}): VictoryCalendarPageState | null {
  if (!isValidOccurredOnDateKey(args.todayKey)) return null;
  const currentMonthKey = args.todayKey.slice(0, 7);
  const monthKey = resolveVisibleVictoryCalendarMonth({
    requestedMonth: args.requestedMonth,
    currentMonthKey,
  });
  if (!monthKey) return null;

  const dayRaw =
    typeof args.requestedDay === "string" ? args.requestedDay.trim() : "";
  if (!isValidOccurredOnDateKey(dayRaw)) {
    return { monthKey, selectedDay: null };
  }
  if (dayRaw.slice(0, 7) !== monthKey) {
    return { monthKey, selectedDay: null };
  }
  if (dayRaw > args.todayKey) {
    return { monthKey, selectedDay: null };
  }
  return { monthKey, selectedDay: dayRaw };
}

export function buildVictoryCalendarHref(args: {
  monthKey: string;
  currentMonthKey: string;
  dayKey?: string | null;
}): string {
  const month = parseVictoryCalendarMonthKey(args.monthKey);
  const current = parseVictoryCalendarMonthKey(args.currentMonthKey);
  if (!month || !current) return VICTORY_CALENDAR_PATH;
  const dayCandidate =
    typeof args.dayKey === "string" ? args.dayKey.trim() : "";
  const day =
    isValidOccurredOnDateKey(dayCandidate) && dayCandidate.slice(0, 7) === month
      ? dayCandidate
      : null;
  if (month === current && !day) return VICTORY_CALENDAR_PATH;
  if (day) return `${VICTORY_CALENDAR_PATH}?month=${month}&day=${day}`;
  return `${VICTORY_CALENDAR_PATH}?month=${month}`;
}

function calendarUtcDate(dateKey: string): Date | null {
  if (!isValidOccurredOnDateKey(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "September 14, 2026" from calendar YYYY-MM-DD pieces (UTC), not Date-string parsing. */
export function formatVictoryCalendarLongDate(dateKey: unknown): string | null {
  if (typeof dateKey !== "string") return null;
  const dt = calendarUtcDate(dateKey);
  if (!dt) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

/** "September 14" heading for selected-day detail. */
export function formatVictoryCalendarDayHeading(dateKey: unknown): string | null {
  if (typeof dateKey !== "string") return null;
  const dt = calendarUtcDate(dateKey);
  if (!dt) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function victoryCalendarDayAccessibleName(args: {
  dateKey: string;
  winCount: number;
  isToday: boolean;
}): string | null {
  const date = formatVictoryCalendarLongDate(args.dateKey);
  if (!date) return null;
  const n = Number.isFinite(args.winCount) ? Math.max(0, Math.floor(args.winCount)) : 0;
  const winPart = n === 0 ? "no Wins" : n === 1 ? "1 Win" : `${n} Wins`;
  return args.isToday ? `Today, ${date}, ${winPart}` : `${date}, ${winPart}`;
}
