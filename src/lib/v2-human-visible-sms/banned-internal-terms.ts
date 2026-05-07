/**
 * Case-insensitive banned substrings for customer-facing SMS (umbrella quality gate).
 * Keep lowercase entries for scanning (normalize message to lower).
 */

export const HUMAN_VISIBLE_SMS_BANNED_SUBSTRINGS_LOWER = [
  // ---- Internal product / workflow terms ----
  "contract proposal",
  "candidate",
  "pending resolution",
  "adaptive overlay",
  "contract overlay",
  "same commitment-recommit",
  "recommit to this bar",
  "i acknowledge your decision",
  "state conflict",
  "guided resolution",
  "commitment replace mutation",
  "commitment event",
  "event spine",
  "accountability system",
  "as an ai",
  "same commitment—recommit",
  "same commitment-recommit",

  // ---- User-visible copy we never want leaking into SMS ----
  "smaller window",
  "active for 7 days",
  "daily check-ins",
  "stay on track",
  "stick to this bar for 7 days",
  "pending resolution",
  "recovery day check",
  "what specific successes did you experience",

  // ---- Explicit versioning / system labels ----
  "v2",

  // ---- Mechanical consent / plan language ----
  "contract",
  "overlay",
  "recommitment",
  "proposal",
  "current bar",
  "same bar",

  // ---- Generic / cheerlead filler (ban broadly) ----
  "great job",
  "keep pushing",
  "keep building momentum",
  "you've got this",
  "lets aim for",
] as const;

/** Scan after lowercasing message (ASCII-ish SMS). */
export function findBannedHumanVisibleSubstring(messageLower: string): string | null {
  const m = messageLower;
  for (const term of HUMAN_VISIBLE_SMS_BANNED_SUBSTRINGS_LOWER) {
    if (m.includes(term)) return term;
  }
  // Internal product jargon: standalone "overlay"/"contract" boundary hits (backstop).
  if (/\boverlay\b/.test(m)) return "overlay";
  if (/\bcontract\b/.test(m)) return "contract";
  return null;
}
