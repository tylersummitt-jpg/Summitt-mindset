/**
 * Deterministic short-answer normalization and polarity families for SACA.
 * Token-family based — not a slang dictionary.
 */

import { hasFuturePlanIntentLanguage } from "@/lib/pending-plan-proof";

export type NormalizedShortAnswerPolarity = "affirm" | "deny" | "unclear" | "not_applicable";

export const MAX_SHORT_ANSWER_LEN = 48;

export type ShortAnswerNormalizeResult = {
  raw: string;
  normalized: string;
  is_question: boolean;
};

export type ShortAnswerOutcomeDisqualifier = {
  disqualified: boolean;
  reason: string | null;
};

function collapseRepeatedLetters(word: string): string {
  return word.replace(/(.)\1{2,}/g, "$1");
}

/** Map fused spellings to canonical yes-family tokens. */
function canonicalizeAffirmWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "yezzir" || lower === "yezzur") return "yessir";
  if (lower === "yepers" || lower === "yeppers") return "yeppers";
  const collapsed = collapseRepeatedLetters(lower);
  if (collapsed === "yesir") return "yessir";
  return collapsed;
}

function peelAffirmIntensifiers(text: string): string {
  let t = text.trim();
  t = t.replace(/^(heck|hell|hecks|hells)\s+(yeah|yep|yup)\b/i, "$2");
  t = t.replace(/^(yeah|yep|yup)\s+buddy\b/i, "$1");
  return t.trim();
}

export function normalizeShortAnswerText(raw: string): ShortAnswerNormalizeResult {
  const trimmed = raw.trim();
  const is_question = /\?\s*$/.test(trimmed) && trimmed.length <= MAX_SHORT_ANSWER_LEN;
  let t = trimmed.toLowerCase();
  t = t.replace(/[.!…]+$/g, "").trim();
  t = t.replace(/-/g, " ");
  t = t.replace(/\s+/g, " ");
  t = t
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => canonicalizeAffirmWord(word))
    .join(" ");
  t = peelAffirmIntensifiers(t);
  return { raw: trimmed, normalized: t, is_question };
}

function isPercentAffirm(normalized: string): boolean {
  return /^100\s*(%|percent)$/.test(normalized);
}

const AFFIRM_EXACT = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "yeppers",
  "yessir",
  "absolutely",
  "definitely",
  "totally",
  "sure",
  "sure did",
  "i sure did",
  "for sure",
  "correct",
  "right",
  "heck yeah",
  "sounds good",
  "that works",
  "that works for me",
  "ok",
  "okay",
  "kk",
]);

function matchesAffirmFamily(normalized: string): boolean {
  if (!normalized || normalized.length > MAX_SHORT_ANSWER_LEN) return false;
  if (isPercentAffirm(normalized)) return true;
  if (AFFIRM_EXACT.has(normalized)) return true;
  if (/^yes\s+sir$/.test(normalized)) return true;
  if (/^yep\s+yep$/.test(normalized)) return true;
  if (/^yes\s+i\s+did$/.test(normalized)) return true;
  if (/^yep\s+i\s+did$/.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /\b(yes|yeah|yep|yup|sure|absolutely|definitely|totally|for sure|heck yeah)\b/.test(normalized)) {
    return true;
  }
  if (words.length <= 4 && /^i did\b/.test(normalized)) return true;
  return false;
}

function matchesDenyFamily(normalized: string): boolean {
  if (!normalized || normalized.length > MAX_SHORT_ANSWER_LEN) return false;
  if (/^(no|n|nope|nah|no way|not today)$/.test(normalized)) return true;
  if (/^(no i missed|missed it|didn'?t|did not|not yet)$/.test(normalized)) return true;
  if (/^(couldn'?t|could not|wasn'?t able to|was not able to)$/.test(normalized)) return true;
  if (/^didn'?t get to it$/.test(normalized)) return true;
  if (/^couldn'?t get to it$/.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && /\b(nope|nah|missed)\b/.test(normalized)) return true;
  return false;
}

function matchesPartialUncertaintyLead(normalized: string): boolean {
  return /^(maybe|kinda|kind of|sort of|somewhat|partially)\b/.test(normalized);
}

export function detectNormalizedPartialLanguage(normalized: string): boolean {
  if (!normalized || normalized.length > MAX_SHORT_ANSWER_LEN) return false;
  if (
    /\b(i did half|half|some of it|part of it|got some of it done|got some done|started it|almost|not all of it|a little|close)\b/i.test(
      normalized
    )
  ) {
    return true;
  }
  if (/\b(got part of it done|something got in the way|started but|kind of|kinda|sort of)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

/** Acknowledgement-only phrases that must not count as miss or completion on outcome checks. */
const ACKNOWLEDGEMENT_ONLY_RE =
  /^(no problem|no worries|sure thing|thanks|thank you|ok thanks|okay thanks|got it|copy that|will do)$/i;

export function shortAnswerDisqualifiesOutcomeProof(
  raw: string,
  normalizedInput?: string
): ShortAnswerOutcomeDisqualifier {
  const trimmed = raw.trim();
  if (!trimmed) return { disqualified: false, reason: null };

  if (/\?\s*$/.test(trimmed) && trimmed.length <= MAX_SHORT_ANSWER_LEN) {
    return { disqualified: true, reason: "short_answer_question_shape" };
  }

  const normalized = normalizedInput ?? normalizeShortAnswerText(raw).normalized;

  if (ACKNOWLEDGEMENT_ONLY_RE.test(normalized)) {
    return { disqualified: true, reason: "short_answer_acknowledgement_only" };
  }

  if (hasFuturePlanIntentLanguage(trimmed)) {
    return { disqualified: true, reason: "short_answer_future_plan_intent" };
  }

  if (
    /\b(tomorrow|later today|next week|planning to|i'?m going to|i am going to|going to|gonna|later)\b/i.test(
      normalized
    ) &&
    !/^not today\b/.test(normalized)
  ) {
    return { disqualified: true, reason: "short_answer_future_or_intent" };
  }

  if (/,/.test(normalized) && /\b(tomorrow|planning to|later|i will|i'll)\b/i.test(normalized)) {
    return { disqualified: true, reason: "short_answer_future_or_intent" };
  }

  if (/\b(want to|i will|i'll)\b/i.test(normalized)) {
    return { disqualified: true, reason: "short_answer_future_or_intent" };
  }

  return { disqualified: false, reason: null };
}

export function detectNormalizedShortAnswerPolarity(raw: string): NormalizedShortAnswerPolarity {
  const { normalized, is_question } = normalizeShortAnswerText(raw);
  if (!normalized) return "not_applicable";
  if (normalized.length > MAX_SHORT_ANSWER_LEN) return "not_applicable";

  if (is_question) return "unclear";

  const partialLanguage = detectNormalizedPartialLanguage(normalized);
  const affirm = matchesAffirmFamily(normalized);
  const deny = matchesDenyFamily(normalized);

  if (partialLanguage && !affirm && !deny) return "unclear";
  if (affirm) return "affirm";
  if (deny) return "deny";
  if (matchesPartialUncertaintyLead(normalized)) return "unclear";
  if (/^not yet\b/.test(normalized)) return "deny";

  return "not_applicable";
}

export function mapTuAnsweredLastCoachAskToPolarityHint(
  answered: "yes" | "no" | "unclear" | null | undefined
): NormalizedShortAnswerPolarity | null {
  if (answered === "yes") return "affirm";
  if (answered === "no") return "deny";
  return null;
}
