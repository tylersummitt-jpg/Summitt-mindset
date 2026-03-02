// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";

type Params = {
  userId: string;
  dayNumber: number;
  userMessage: string;
};

export type CoachReplyMeta = {
  model: string;
  temperature: number;
  max_tokens: number;
  fallbackUsed: boolean;
};

export type CoachReplyResult = {
  text: string;
  meta: CoachReplyMeta;
};

/* ======================================================
   OpenAI
====================================================== */

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({ apiKey });
}

/* ======================================================
   Utilities
====================================================== */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function splitIntoSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * We do this because your SMS client sometimes drops apostrophes:
 * You're -> Youre
 * That is not acceptable, so we force full words.
 */
function expandContractions(text: string): string {
  // NOTE: We run this BEFORE stripping apostrophes.
  return (text || "")
    .replace(/\byou['’]re\b/gi, "you are")
    .replace(/\bthey['’]re\b/gi, "they are")
    .replace(/\bwe['’]re\b/gi, "we are")
    .replace(/\bi['’]m\b/gi, "I am")
    .replace(/\bdo['’]t\b/gi, "do not") // safety (rare OCR-like)
    .replace(/\bdon['’]t\b/gi, "do not")
    .replace(/\bcan['’]t\b/gi, "cannot")
    .replace(/\bwon['’]t\b/gi, "will not")
    .replace(/\bit['’]s\b/gi, "it is")
    .replace(/\bthat['’]s\b/gi, "that is")
    .replace(/\bthere['’]s\b/gi, "there is")
    .replace(/\blet['’]s\b/gi, "let us")
    .replace(/\bI['’]ve\b/g, "I have")
    .replace(/\bI['’]ll\b/g, "I will")
    .replace(/\bwe['’]ll\b/gi, "we will")
    .replace(/\byou['’]ll\b/gi, "you will")
    .replace(/\bthey['’]ll\b/gi, "they will")
    .replace(/\bwe['’]d\b/gi, "we would")
    .replace(/\byou['’]d\b/gi, "you would")
    .replace(/\bthey['’]d\b/gi, "they would");
}

function removeApostrophes(text: string): string {
  return (text || "").replace(/['’]/g, "");
}

/**
 * Remove phrases that expose the "mechanism" of memory.
 * We still WANT the coach to use memory, but NEVER say how it knows.
 */
function stripMemoryMetaLanguage(text: string): string {
  let t = text || "";

  // NOTE: We are intentionally conservative here.
  // We do not want to over-strip and break meaning.
  const patterns: RegExp[] = [
    /\b(as you said|as you wrote|you said|you wrote|you mentioned)\b/gi,
    /\b(earlier|previously|yesterday|last week|last month)\b/gi,
    /\b(from your journal|in your journal|your journal|journaling|journal)\b/gi,
    /\b(from your reflection|in your reflection|reflection)\b/gi,
    /\b(from your summary|in your summary|summary|summaries)\b/gi,
    /\b(I remember|I recall|from my memory|memory)\b/gi,
  ];

  for (const re of patterns) {
    t = t.replace(re, "");
  }

  return normalizeText(t);
}

/**
 * Remove emojis (some providers/clients render them inconsistently).
 */
function stripEmojis(text: string): string {
  return (text || "").replace(/\p{Emoji}/gu, "");
}

/**
 * Final cleanup:
 * - 1 paragraph
 * - no "!"
 * - normalize whitespace
 */
function finalizeOutput(text: string): string {
  let t = text || "";

  // collapse lines
  t = t.replace(/\n+/g, " ");
  t = t.replace(/!/g, "."); // no exclamation marks
  t = stripEmojis(t);

  // clean spacing around punctuation
  t = t.replace(/\s+([,.!?])/g, "$1");
  t = t.replace(/([,.!?]){2,}/g, "$1");

  return normalizeText(t);
}

/**
 * Hard cap AFTER generation:
 * - Up to 5 sentences
 * - Max total words (keeps it from becoming a speech)
 * - Max words per sentence (keeps reading level down)
 *
 * We do not pre-structure the reply. We trim it after.
 */
function enforceHardCaps(text: string): string {
  const MAX_SENTENCES = 5;
  const MAX_TOTAL_WORDS = 75; // simple, but not tiny
  const MAX_WORDS_PER_SENTENCE = 18;

  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return "";
  }

  // 1) cap sentences
  const cappedSentences = sentences.slice(0, MAX_SENTENCES).map((s) => {
    const words = s.split(" ").filter(Boolean);
    if (words.length > MAX_WORDS_PER_SENTENCE) {
      return words.slice(0, MAX_WORDS_PER_SENTENCE).join(" ");
    }
    return s;
  });

  let result = cappedSentences.join(" ");

  // 2) cap total words
  const allWords = result.split(" ").filter(Boolean);
  if (allWords.length > MAX_TOTAL_WORDS) {
    result = allWords.slice(0, MAX_TOTAL_WORDS).join(" ");
  }

  return normalizeText(result);
}

/* ======================================================
   Fallbacks
====================================================== */

function fallbackReply(dayNumber: number): string {
  if (dayNumber <= 7) {
    return "Good. Keep it simple. Do the next right thing today. Then do it again tomorrow.";
  }
  if (dayNumber <= 30) {
    return "Good. Stay steady. Do one small thing that matches your goal. Then stop.";
  }
  return "Good. Stay disciplined. Keep your standard today. Then reset for tomorrow.";
}

/* ======================================================
   Generator (Coach Reply v3)
====================================================== */

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<CoachReplyResult> {
  const openai = getOpenAIClient();

  const md = await getClerkPublicMetadata(userId);

  // Primary goal is safe to use (identity anchor).
  const primaryGoal =
    typeof md?.summittGoal === "string" && md.summittGoal.trim().length > 0
      ? normalizeText(md.summittGoal)
      : "your goal";

  // OPTIONAL PERSONALIZATION (SAFE, NO META-LANGUAGE)
  // We pass these as "facts" the coach can naturally use.
  // If they are missing, they simply will not be used.
  const trainingFocus =
    Array.isArray((md as any)?.trainingThemes) && (md as any).trainingThemes.length
      ? (md as any).trainingThemes
          .map((t: any) => (typeof t === "string" ? normalizeText(t) : ""))
          .filter(Boolean)
          .slice(0, 5)
      : [];

  const userTimezone =
    typeof (md as any)?.timezone === "string" ? (md as any).timezone : null;

  const cleanUserMessage = normalizeText(userMessage);

  // Keep model choices simple and stable.
  const MODEL = "gpt-4.1-mini";
  const TEMPERATURE = 0.55; // more adaptive than before (less scripted)
  const MAX_TOKENS = 220; // we cap after; tokens allow intelligence

  /**
   * SYSTEM PROMPT:
   * - Minimal guardrails
   * - No forced structure
   * - Use memory naturally but never mention the mechanism
   * - Simple language
   */
  const systemPrompt = `
You are Coach Pat Summitt.

Voice:
- Calm
- Direct
- Certain
- Simple words (about 4th grade level)
- Not a therapist
- Not a motivational speaker

Hard rules:
- 1 paragraph
- Up to 5 sentences
- Short sentences
- No emojis
- No exclamation marks
- No quotes
- No contractions (use full words like "you are", "do not")
- Do not repeat the user back to them
- You may use the personal facts provided to you, but never say how you know them.
- Never mention journaling, entries, summaries, memory, or past days.

Behavior:
- Match the depth and tone of the user.
- If the user asks for advice, give one clear principle and one clear action.
- If the user is short, be short.
- If the user is deep, be steady and specific.
`.trim();

  /**
   * USER PROMPT:
   * - Give the model usable facts
   * - No "memory" framing
   * - The model can naturally weave them in if it helps retention
   */
  const userPrompt = `
Goal: ${primaryGoal}
Day: ${dayNumber}
Timezone: ${userTimezone || "unknown"}
Training focus: ${trainingFocus.length ? trainingFocus.join(", ") : "none provided"}

User message:
${cleanUserMessage}

Write the coach reply.
`.trim();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    top_p: 1,
    frequency_penalty: 0.15,
    presence_penalty: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const fallback = fallbackReply(dayNumber);

  let raw = completion.choices[0]?.message?.content?.trim() || fallback;
  const fallbackUsed = !completion.choices[0]?.message?.content;

  // =========================
  // HARDENING PIPELINE (LIGHT)
  // =========================
  // 1) Expand contractions first (handles both ' and ’)
  raw = expandContractions(raw);

  // 2) Remove apostrophes (SMS safety)
  raw = removeApostrophes(raw);

  // 3) Remove memory meta-language (do not reveal mechanism)
  raw = stripMemoryMetaLanguage(raw);

  // 4) Final cleanup
  raw = finalizeOutput(raw);

  // 5) Hard caps AFTER the model thinks
  raw = enforceHardCaps(raw);

  // Safety fallback
  if (!raw || raw.length < 10) {
    raw = fallback;
  }

  return {
    text: raw,
    meta: {
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      fallbackUsed,
    },
  };
}