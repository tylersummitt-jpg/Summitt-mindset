/**
 * Case-insensitive banned substrings for customer-facing SMS (umbrella quality gate).
 * Keep lowercase entries for scanning (normalize message to lower).
 */

export const HUMAN_VISIBLE_SMS_BANNED_SUBSTRINGS_LOWER = [
  "contract proposal",
  "candidate",
  "pending resolution",
  "adaptive overlay",
  "same commitment-recommit",
  "recommit to this bar",
  "i acknowledge your decision",
  "state conflict",
  "guided resolution",
  "commitment replace mutation",
  "as an ai",
  "same commitment—recommit",
  "same commitment-recommit",
] as const;

/** Scan after lowercasing message (ASCII-ish SMS). */
export function findBannedHumanVisibleSubstring(messageLower: string): string | null {
  const m = messageLower;
  for (const term of HUMAN_VISIBLE_SMS_BANNED_SUBSTRINGS_LOWER) {
    if (m.includes(term)) return term;
  }
  // Internal product jargon: standalone "overlay" (narrow boundary).
  if (/\boverlay\b/.test(m)) return "overlay";
  return null;
}
