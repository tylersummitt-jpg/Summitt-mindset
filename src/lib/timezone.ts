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
