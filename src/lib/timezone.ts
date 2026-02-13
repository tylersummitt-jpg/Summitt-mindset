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
