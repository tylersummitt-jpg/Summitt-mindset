/**
 * Timezone utilities
 *
 * All calendar-based decisions should go through here.
 */

const DEFAULT_TZ = "America/New_York";

function isValidIanaTimezone(tz: string): boolean {
  try {
    // If tz is invalid, this throws RangeError in most runtimes.
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getDateKeyInTimezone(date: Date, timezone: string): string {
  const tz = resolveUserTimezone(timezone);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the next 8:00 AM America/New_York as an ISO string (UTC).
 * - If current Eastern time is before 8am → today at 8am Eastern
 * - If current Eastern time is at or after 8am → tomorrow at 8am Eastern
 * Uses Intl.DateTimeFormat for timezone-safe conversion. DST is handled automatically.
 */
export function getNext8AMEastern(): string {
  const now = new Date();
  const tz = "America/New_York";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const year = get("year");
  const month = get("month") - 1;
  const day = get("day");
  const hour = get("hour");

  let targetYear = year;
  let targetMonth = month;
  let targetDay = day;
  if (hour >= 8) {
    const nextDate = new Date(Date.UTC(year, month, day));
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    targetYear = nextDate.getUTCFullYear();
    targetMonth = nextDate.getUTCMonth();
    targetDay = nextDate.getUTCDate();
  }

  // 8am Eastern = 12:00 UTC (EDT) or 13:00 UTC (EST). Check which one displays as 8am.
  const candidate12 = new Date(Date.UTC(targetYear, targetMonth, targetDay, 12, 0, 0));
  const candidate13 = new Date(Date.UTC(targetYear, targetMonth, targetDay, 13, 0, 0));
  const hour12 = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(candidate12);
  const hour13 = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(candidate13);
  const target =
    hour12 === "08" ? candidate12 : hour13 === "08" ? candidate13 : candidate12;

  return target.toISOString();
}

/**
 * Safely resolve user timezone.
 * Defaults conservatively if missing or invalid.
 */
export function resolveUserTimezone(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_TZ;

  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_TZ;

  // Guard against invalid/poisoned values
  if (!isValidIanaTimezone(trimmed)) return DEFAULT_TZ;

  return trimmed;
}

const LOCAL_DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseLocalDateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = LOCAL_DATE_KEY_RE.exec(raw.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseLocalMonthKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = LOCAL_MONTH_KEY_RE.exec(raw.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m)) return null;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1) return null;
  return `${match[1]}-${match[2]}`;
}

function addCalendarDaysToDateKey(dateKey: string, deltaDays: number): string | null {
  const parsed = parseLocalDateKey(dateKey);
  if (!parsed) return null;
  const [y, m, d] = parsed.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function nextLocalMonthKey(monthKey: string): string | null {
  const parsed = parseLocalMonthKey(monthKey);
  if (!parsed) return null;
  const y = Number(parsed.slice(0, 4));
  const m = Number(parsed.slice(5, 7));
  const nd = new Date(Date.UTC(y, m, 1));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function localWallParts(
  date: Date,
  timeZone: string
): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => {
    const v = parts.find((p) => p.type === type)?.value;
    return v != null ? Number(v) : NaN;
  };
  let h = get("hour");
  if (h === 24) h = 0;
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h,
    min: get("minute"),
    s: get("second"),
  };
}

/**
 * UTC instant for local calendar-day midnight in `timeZone`.
 * Invalid date or unresolvable local midnight → null (fail closed).
 * Invalid timezone falls back via resolveUserTimezone.
 */
export function utcInstantForLocalMidnight(dateKey: unknown, timeZone: unknown): Date | null {
  const key = parseLocalDateKey(dateKey);
  if (!key) return null;
  const tz = resolveUserTimezone(timeZone);
  const match = LOCAL_DATE_KEY_RE.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const desiredAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utcMs = desiredAsUtc;
  for (let i = 0; i < 8; i++) {
    const wall = localWallParts(new Date(utcMs), tz);
    if (![wall.y, wall.m, wall.d, wall.h, wall.min, wall.s].every(Number.isFinite)) {
      return null;
    }
    const actualAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min, wall.s);
    const delta = desiredAsUtc - actualAsUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  const resolved = new Date(utcMs);
  if (getDateKeyInTimezone(resolved, tz) !== key) return null;
  return resolved;
}

export type LocalUtcRange = {
  startUtcIso: string;
  endUtcIso: string;
};

/**
 * Member-local calendar day as [local midnight, next local midnight).
 * Uses next-local-midnight, never +24h. Unresolvable → null.
 */
export function localDayUtcRange(dateKey: unknown, timeZone: unknown): LocalUtcRange | null {
  const key = parseLocalDateKey(dateKey);
  if (!key) return null;
  const nextKey = addCalendarDaysToDateKey(key, 1);
  if (!nextKey) return null;
  const start = utcInstantForLocalMidnight(key, timeZone);
  const end = utcInstantForLocalMidnight(nextKey, timeZone);
  if (!start || !end) return null;
  if (!(start.getTime() < end.getTime())) return null;
  return { startUtcIso: start.toISOString(), endUtcIso: end.toISOString() };
}

/**
 * Member-local calendar month as [first-of-month midnight, first-of-next-month midnight).
 * Never +30 days. Unresolvable → null.
 */
export function localMonthUtcRange(monthKey: unknown, timeZone: unknown): LocalUtcRange | null {
  const key = parseLocalMonthKey(monthKey);
  if (!key) return null;
  const nextKey = nextLocalMonthKey(key);
  if (!nextKey) return null;
  const start = utcInstantForLocalMidnight(`${key}-01`, timeZone);
  const end = utcInstantForLocalMidnight(`${nextKey}-01`, timeZone);
  if (!start || !end) return null;
  if (!(start.getTime() < end.getTime())) return null;
  return { startUtcIso: start.toISOString(), endUtcIso: end.toISOString() };
}

export type SmsTimezoneSource = "clerk" | "audience" | "default";

export type ResolvedSmsUserTimezone = {
  timezone: string;
  timezone_source: SmsTimezoneSource;
};

/**
 * Single SMS timezone resolution: Clerk public metadata first, then sms_audience, then default.
 */
export function resolveSmsUserTimezone(args: {
  clerkMetadataTimezone?: unknown;
  audienceTimezone?: unknown;
}): ResolvedSmsUserTimezone {
  const clerk =
    typeof args.clerkMetadataTimezone === "string" && args.clerkMetadataTimezone.trim()
      ? args.clerkMetadataTimezone.trim()
      : null;
  if (clerk && isValidIanaTimezone(clerk)) {
    return { timezone: clerk, timezone_source: "clerk" };
  }
  const audience =
    typeof args.audienceTimezone === "string" && args.audienceTimezone.trim()
      ? args.audienceTimezone.trim()
      : null;
  if (audience && isValidIanaTimezone(audience)) {
    return { timezone: audience, timezone_source: "audience" };
  }
  return { timezone: DEFAULT_TZ, timezone_source: "default" };
}
