/**
 * Display-title length only. Never Win truth. Never mid-word slice.
 * Matches v2_win.display_title CHECK / WIN_FIELD_LIMITS.display_title (80).
 */

export const WIN_DISPLAY_TITLE_MAX_CHARS = 80 as const;

/** Existing structural fallback already used when Current Goal text is missing. */
export const WIN_DISPLAY_TITLE_SAFE_FALLBACK = "Today's follow-through" as const;

function collapseTitleWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Safe display-title limiter. No grammar, no summary.
 * - <=80 after trim/collapse: unchanged
 * - >80: last complete whitespace-separated token that fits
 * - no whitespace before the limit: null (caller supplies fallback)
 */
export function limitWinDisplayTitle(
  raw: unknown,
  max: number = WIN_DISPLAY_TITLE_MAX_CHARS
): string | null {
  if (typeof raw !== "string") return null;
  const t = collapseTitleWhitespace(raw);
  if (!t) return null;
  if (t.length <= max) return t;

  // Next character is whitespace ⇒ the max window ends on a complete token.
  if (t[max] === " ") {
    const exact = t.slice(0, max).trimEnd();
    return exact || null;
  }

  const window = t.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace <= 0) return null;
  const cut = window.slice(0, lastSpace).trimEnd();
  return cut || null;
}

/** Never throws. Always returns a non-empty title of at most `max` chars. */
export function limitWinDisplayTitleOrFallback(
  raw: unknown,
  fallback: string = WIN_DISPLAY_TITLE_SAFE_FALLBACK,
  max: number = WIN_DISPLAY_TITLE_MAX_CHARS
): string {
  const limited = limitWinDisplayTitle(raw, max);
  if (limited) return limited;
  const safeFallback = limitWinDisplayTitle(fallback, max);
  if (safeFallback) return safeFallback;
  return WIN_DISPLAY_TITLE_SAFE_FALLBACK;
}
