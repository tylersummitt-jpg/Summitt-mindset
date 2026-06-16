/**
 * Deterministic proof quote meaningfulness — shared by Victory Room display and home cleanup.
 */

const VISUAL_TEST_PREFIX = /^\[visual test\]\s*/i;
const WRAP_QUOTES_RE = /^[\s"'""''«»]+|[\s"'""''«»]+$/g;

function normalizeProofTextForComparison(text: string): string {
  let s = text.trim().toLowerCase();
  s = s.replace(WRAP_QUOTES_RE, "");
  s = s.replace(VISUAL_TEST_PREFIX, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\.+$/, "");
  return s;
}

const CONTEXTLESS_QUOTE_BLOCKLIST = new Set([
  "good",
  "ok",
  "okay",
  "yes",
  "no",
  "done",
  "will do",
  "sounds good",
  "thanks",
  "got it",
  "yep",
  "nope",
  "sure",
  "k",
  "kk",
]);

const ACCOUNTABILITY_LANGUAGE_RE =
  /\b(did not|didn't|didnt|missed|hit my goal|got it done|followed through|stayed with it|outreach|tightened|goal yesterday|goal today|not hit|wasn't able|couldn't|honest|truth|partial|minutes|hours|block before|before noon)\b/i;

const EMOJI_ONLY_RE =
  /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\s]+$/u;

const PUNCTUATION_ONLY_RE = /^[\s"'""''«».,!?;:—–\-…]+$/;

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Verbatim user reply is meaningful enough to show as the primary card quote. */
export function isSelfExplanatoryProofQuote(quote: string | null | undefined): boolean {
  const raw = quote?.trim();
  if (!raw) return false;

  if (EMOJI_ONLY_RE.test(raw) || PUNCTUATION_ONLY_RE.test(raw)) return false;

  const normalized = normalizeProofTextForComparison(raw);
  if (!normalized) return false;

  if (CONTEXTLESS_QUOTE_BLOCKLIST.has(normalized)) return false;

  if (ACCOUNTABILITY_LANGUAGE_RE.test(raw)) return true;

  if (raw.length >= 12) return true;

  if (wordCount(raw) <= 2) return false;

  return raw.length >= 12;
}

export function proofQuoteDisplayScore(quote: string | null | undefined): number {
  const raw = quote?.trim();
  if (!raw) return 1;
  return isSelfExplanatoryProofQuote(raw) ? 2 : 0;
}

export function proofTextsAreDuplicateForDisplay(a: string, b: string): boolean {
  const x = normalizeProofTextForComparison(a);
  const y = normalizeProofTextForComparison(b);
  if (!x || !y) return false;
  return x === y;
}
