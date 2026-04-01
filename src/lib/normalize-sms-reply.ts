/**
 * Normalizes raw SMS body before translateSmsReply / downstream mapping.
 * Preserves original casing except when collapsing to a single MCQ letter.
 */
export function normalizeSmsReply(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return trimmed;

  const s = trimmed.toLowerCase();

  // --- STRONG MCQ DETECTION ---

  // Match patterns like:
  // "a", "a.", "a)", "a,", "a!", "a -", "a because..."
  const letterMatch = s.match(/^[^a-z]*([abcd])([^a-z]|$)/);
  if (letterMatch) {
    return letterMatch[1]!.toUpperCase();
  }

  // Match "option a", "option b"
  const optionMatch = s.match(/option\s+([abcd])/);
  if (optionMatch) {
    return optionMatch[1]!.toUpperCase();
  }

  // Match natural phrases:
  // "i'm a", "i am b", "going with c", "probably d"
  const phraseMatch = s.match(
    /\b(i('| a)m|i am|going with|probably|definitely|i choose|i pick)\s+([abcd])\b/
  );
  if (phraseMatch) {
    return phraseMatch[3]!.toUpperCase();
  }

  // Handle double letters like "aa"
  if (/^([abcd])\1([^a-z]|$)/.test(s)) {
    return s[0]!.toUpperCase();
  }

  // --- SHORT TEXT (1–3 words) ---
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    return trimmed;
  }

  // --- DEFAULT ---
  return trimmed;
}
