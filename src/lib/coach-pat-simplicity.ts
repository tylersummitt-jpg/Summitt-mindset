// src/lib/coach-pat-simplicity.ts

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function splitIntoSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const BANNED_WORDS = [
  "intentionality",
  "alignment",
  "resilience",
  "momentum",
  "optimize",
  "expand",
  "elevate",
  "framework",
  "capacity",
  "sustain",
  "refine",
  "cultivate",
  "consistency",
];

function containsBannedWords(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_WORDS.some((w) => lower.includes(w));
}

function hasLongSentence(sentences: string[]): boolean {
  return sentences.some((s) => s.split(" ").length > 20);
}

function countBehavioralDirectives(sentences: string[]): number {
  const directiveIndicators = [
    "do ",
    "take ",
    "send ",
    "choose ",
    "act ",
    "hold ",
    "start ",
    "finish ",
    "show ",
    "commit ",
  ];

  return sentences.filter((s) =>
    directiveIndicators.some((d) => s.toLowerCase().startsWith(d))
  ).length;
}

export function enforceSimplicity(raw: string): {
  valid: boolean;
  cleaned: string;
  reason?: string;
} {
  const cleaned = normalizeText(raw);
  const sentences = splitIntoSentences(cleaned);

  if (sentences.length !== 4) {
    return { valid: false, cleaned, reason: "not_four_sentences" };
  }

  if (containsBannedWords(cleaned)) {
    return { valid: false, cleaned, reason: "banned_word" };
  }

  if (hasLongSentence(sentences)) {
    return { valid: false, cleaned, reason: "sentence_too_long" };
  }

  const directives = countBehavioralDirectives(sentences);

  if (directives !== 1) {
    return { valid: false, cleaned, reason: "invalid_directive_count" };
  }

  return { valid: true, cleaned };
}