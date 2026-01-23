/**
 * Timezone utilities
 *
 * All calendar-based decisions should go through here.
 */

export function getDateKeyInTimezone(
  date: Date,
  timezone: string
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Safely resolve user timezone.
 * Defaults conservatively if missing or invalid.
 */
export function resolveUserTimezone(
  raw: unknown
): string {
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }

  // Default — conservative and predictable
  return "America/New_York";
}
