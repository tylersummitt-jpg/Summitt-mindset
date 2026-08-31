/**
 * Display-only supporting_quote grounding.
 * OpenAI owns whether a quote is worth showing. This only checks shape/safety.
 */

/** Matches v2_win.supporting_quote CHECK / WIN_FIELD_LIMITS.supporting_quote. */
export const WIN_SUPPORTING_QUOTE_MAX_CHARS = 240 as const;

function hasDisallowedControlChars(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Raw JS contiguous substring. Same law as inbound-sol-user-evidence
 * isExactContiguousSubstring: no case/whitespace/Unicode/quote normalization.
 */
function isExactContiguousSubstring(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.includes(needle);
}

/**
 * Accepts null. Trims outer whitespace only. Invalid → null. Never throws.
 * Does not judge English meaning.
 */
export function validateWinSupportingQuote(
  raw: unknown,
  inboundText: string
): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (hasDisallowedControlChars(trimmed)) return null;
  if (trimmed.length > WIN_SUPPORTING_QUOTE_MAX_CHARS) return null;
  if (typeof inboundText !== "string") return null;
  if (!isExactContiguousSubstring(inboundText, trimmed)) return null;
  return trimmed;
}
