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
  bucket: "micro" | "short" | "normal" | "long";
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

function wordCount(text: string): number {
  return normalizeText(text).split(" ").filter(Boolean).length;
}

function splitIntoSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function removeApostrophes(text: string): string {
  return text.replace(/['’]/g, "");
}

function expandContractions(text: string): string {
  return text
    .replace(/\byou're\b/gi, "you are")
    .replace(/\bthey're\b/gi, "they are")
    .replace(/\bwe're\b/gi, "we are")
    .replace(/\bi'm\b/gi, "I am")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bit's\b/gi, "it is");
}

/* ======================================================
   Message Classification
====================================================== */

function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/\p{Emoji}/gu, "").trim();
  return stripped.length === 0;
}

function classifyMessage(text: string) {
  const clean = normalizeText(text);
  const words = wordCount(clean);

  const lower = clean.toLowerCase();

  const microList = [
    "ok",
    "okay",
    "k",
    "yes",
    "yep",
    "will do",
    "done",
    "sounds good",
    "got it",
    "thanks",
    "thank you",
  ];

  if (isEmojiOnly(clean)) return "micro";
  if (words <= 3) return "micro";
  if (microList.includes(lower)) return "micro";

  if (words <= 20) return "short";
  if (words <= 80) return "normal";
  return "long";
}

/* ======================================================
   Sentence + Word Enforcement
====================================================== */

function enforceCaps(
  text: string,
  bucket: "micro" | "short" | "normal" | "long"
): string {
  let maxSentences = 4;
  let maxWords = 65;

  if (bucket === "micro") {
    maxSentences = 2;
    maxWords = 22;
  }

  if (bucket === "short") {
    maxSentences = 2;
    maxWords = 35;
  }

  if (bucket === "normal") {
    maxSentences = 3;
    maxWords = 55;
  }

  const sentences = splitIntoSentences(text).slice(0, maxSentences);
  let result = sentences.join(" ");

  const words = result.split(" ");
  if (words.length > maxWords) {
    result = words.slice(0, maxWords).join(" ");
  }

  return result;
}

/* ======================================================
   Fallbacks
====================================================== */

function fallbackReply(dayNumber: number): string {
  if (dayNumber <= 7) {
    return "Good. That is steadiness. Keep going tomorrow.";
  }
  if (dayNumber <= 30) {
    return "Good. That is training. Stay steady tomorrow.";
  }
  return "Good. That is veteran steadiness. Keep building.";
}

/* ======================================================
   Generator
====================================================== */

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<CoachReplyResult> {
  const openai = getOpenAIClient();
  const md = await getClerkPublicMetadata(userId);

  const primaryGoal =
    typeof md?.summittGoal === "string"
      ? normalizeText(md.summittGoal)
      : "your goal";

  const cleanUser = normalizeText(userMessage);
  const bucket = classifyMessage(cleanUser);

  const MODEL = "gpt-4.1-mini";
  const TEMPERATURE = 0.3;
  const MAX_TOKENS = 140;

  const systemPrompt = `
You are Coach Pat Summitt.

Voice:
- Calm
- Direct
- Simple
- 4th grade reading level
- No hype
- No therapy tone
- No complex words

Hard rules:
- 1 paragraph
- 1 to 4 sentences only
- Short sentences
- No emojis
- No exclamation marks
- No quotes
- No contractions
- Do not repeat the user
- Do not reference journaling or past days

The shorter the user message, the shorter you respond.
`.trim();

  const userPrompt = `
Goal: ${primaryGoal}
Day: ${dayNumber}

User message:
${cleanUser}

Write the reply.
`.trim();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let raw =
    completion.choices[0]?.message?.content?.trim() ||
    fallbackReply(dayNumber);

  const fallbackUsed = !completion.choices[0]?.message?.content;

  raw = expandContractions(raw);
  raw = removeApostrophes(raw);
  raw = raw.replace(/!/g, ".");
  raw = normalizeText(raw);

  raw = enforceCaps(raw, bucket);

  if (!raw || raw.length < 10) {
    raw = fallbackReply(dayNumber);
  }

  return {
    text: raw,
    meta: {
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      fallbackUsed,
      bucket,
    },
  };
}