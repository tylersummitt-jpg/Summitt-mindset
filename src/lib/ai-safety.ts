/**
 * Pat Summitt brand-safety: shared rules, moderation, lexical backstop, fallbacks.
 * Fails open on moderation API errors to preserve availability; fails closed on flagged/lexical hits.
 */

import type OpenAI from "openai";

/** Injected into system prompts alongside existing voice/style prompts. */
export const PAT_BRAND_SAFETY_RULES = `
BRAND SAFETY (NON-NEGOTIABLE)
- Stay focused on leadership, discipline, standards, habits, resilience, teamwork, and personal responsibility.
- Never use profanity, curse words, vulgar phrasing, slurs, or crude language.
- Never engage in sexual content, sexual advice, sexual jokes, or suggestive language.
- Never express political opinions, partisan views, endorsements, campaign messaging, or commentary on political controversies or elections.
- Never give inflammatory, divisive, or culture-war style opinions.
- Never provide legal, medical, psychiatric, or crisis-response guidance beyond briefly encouraging the user to seek a qualified professional when serious health, legal, or safety issues arise.
- Never shame, humiliate, insult, or degrade the user.
- Never imitate Pat Summitt in a way that damages her legacy or puts offensive or controversial words in her mouth.
- When a request is off-topic, unsafe, sexual, political, hateful, or inappropriate, briefly decline without lecturing and redirect to leadership, discipline, or personal standards.
- Keep every response calm, clean, respectful, and brand-safe.
`.trim();

export const ASK_PAT_INPUT_BLOCKED_FALLBACK =
  "Let us keep this focused on leadership, discipline, and the standards that build a strong life.";

export const COACH_REPLY_BLOCKED_FALLBACK =
  "Let us bring this back to what you can control today: your standards, your effort, and your next right step.";

export function getCoachPatDailySafeFallback(
  stalenessMode: "fresh" | "normal" | "reentry"
): string {
  if (stalenessMode === "reentry") {
    return "Start simple. Stay steady. Let today be clean and manageable. Do the next right thing.";
  }
  return "Keep it simple today. Stay steady. Do the next right thing. That is enough.";
}

/** Output fallback when model output fails moderation/lexical (same as input blocked for surface). */
export const ASK_PAT_OUTPUT_FALLBACK = ASK_PAT_INPUT_BLOCKED_FALLBACK;
export const COACH_REPLY_OUTPUT_FALLBACK = COACH_REPLY_BLOCKED_FALLBACK;

const LEX_PROFANITY = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "asshole",
  "bullshit",
  "motherfucker",
  "mf",
  "slut",
  "whore",
];

const LEX_SEXUAL = [
  "porn",
  "xxx",
  "blowjob",
  "handjob",
  "cumshot",
  "dildo",
  "nude",
  "orgasm",
  "masturbat",
];

/** Minimal partisan / culture-war signals (high precision, not exhaustive). */
const LEX_POLITICAL_HOT = [
  "maga",
  "antifa",
  "nazi",
  "heil hitler",
  "genocide the",
  "race war",
];

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLexPattern(words: string[]): RegExp {
  const body = words.map((w) => escapeRx(w)).join("|");
  return new RegExp(`\\b(?:${body})\\b`, "i");
}

const PROF_RX = buildLexPattern(LEX_PROFANITY);
const SEX_RX = buildLexPattern(LEX_SEXUAL);
const POL_RX = buildLexPattern(LEX_POLITICAL_HOT);

/**
 * Lexical backstop: true = text is OK, false = block/replace.
 */
export function lexicalSafetyPass(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return true;
  if (PROF_RX.test(t)) return false;
  if (SEX_RX.test(t)) return false;
  if (POL_RX.test(t)) return false;
  return true;
}

export type ModerationSafeResult =
  | { ok: true }
  | { ok: false; reason: "moderation" | "lexical" };

/**
 * OpenAI Moderations + lexical. On API/network error, returns ok: true (fail open).
 */
export async function assertTextSafeForBrand(
  openai: OpenAI,
  text: string
): Promise<ModerationSafeResult> {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: true };

  if (!lexicalSafetyPass(trimmed)) {
    return { ok: false, reason: "lexical" };
  }

  try {
    const mod = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: trimmed.slice(0, 32000),
    });
    const flagged = mod.results?.[0]?.flagged === true;
    if (flagged) {
      return { ok: false, reason: "moderation" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[ai-safety] moderation API error (fail open):", err);
    return { ok: true };
  }
}

/**
 * After generation: lexical + OpenAI moderation. Returns fallback if unsafe.
 * On moderation API error, returns original text (fail open) except lexical always wins.
 */
export async function sanitizeModelOutput(
  openai: OpenAI,
  text: string,
  fallback: string
): Promise<string> {
  const trimmed = (text || "").trim();
  if (!trimmed) return fallback;

  if (!lexicalSafetyPass(trimmed)) {
    return fallback;
  }

  try {
    const mod = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: trimmed.slice(0, 32000),
    });
    if (mod.results?.[0]?.flagged === true) {
      return fallback;
    }
  } catch (err) {
    console.error("[ai-safety] output moderation error (fail open):", err);
  }

  return trimmed;
}
