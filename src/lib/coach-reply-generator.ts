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

  forbiddenStrips: number;
  echoFragmentsRemoved: number;

  // Did sanitizer change the output meaningfully?
  sanitized: boolean;
};

export type CoachReplyResult = {
  text: string;
  meta: CoachReplyMeta;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in environment");
  return new OpenAI({ apiKey });
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function stripMarkdown(text: string): string {
  return (text || "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1");
}

function stripQuotes(text: string): string {
  let t = text || "";
  t = t.replace(/[“”]/g, '"');
  t = t.replace(/[‘’]/g, "'");
  t = t.replace(/".*?"/g, "");
  t = t.replace(/'.*?'/g, "");
  return t;
}

function splitIntoSentences(text: string): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Coach Reply should feel like a quick sideline note, not a speech.
 * Keep to 3 sentences max (tighter than Coach Pat daily note).
 */
function enforceMaxThreeSentences(text: string): string {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return "Good. Stay steady. Show up again tomorrow.";
  }
  return sentences.slice(0, 3).join(" ");
}

/**
 * Remove phrases that create echo/memory/journal vibes.
 * Returns both cleaned text + count of removals.
 */
function stripForbiddenPhrases(text: string): { text: string; removed: number } {
  const forbidden = [
    "you said",
    "you wrote",
    "you mentioned",
    "as you said",
    "as you wrote",
    "as you mentioned",
    "last week",
    "last month",
    "yesterday",
    "earlier",
    "previous",
    "based on",
    "from your",
    "memory",
    "summary",
    "summaries",
    "journal",
    "journaling",
    "entry",
    "reflection",
    "reflect on",
    "write this down",
    "write it down",
    "i hear you",
    "it sounds like",
    "i'm hearing",
    "thank you for sharing",
    "processing",
    "feelings",
    "emotions",
    "validate",
  ];

  let cleaned = text;
  let removed = 0;

  for (const phrase of forbidden) {
    const regex = new RegExp(phrase, "gi");
    const before = cleaned;
    cleaned = cleaned.replace(regex, "");
    if (before !== cleaned) removed += 1;
  }

  return { text: cleaned, removed };
}

/**
 * Anti-echo: remove any user fragments that appear in the reply.
 * We do this in two passes:
 * 1) Remove longer fragments (8 words)
 * 2) Remove medium fragments (6 words)
 *
 * Returns cleaned text + how many fragments removed.
 */
function stripUserEcho(
  reply: string,
  userMessage: string
): { text: string; removed: number } {
  const userLower = userMessage.toLowerCase();
  const userWords = userLower.split(/\s+/).filter(Boolean);

  let cleaned = reply;
  let removed = 0;

  // Pass 1: 8-word fragments
  const replyLower1 = cleaned.toLowerCase();

  for (let i = 0; i <= userWords.length - 8; i++) {
    const fragment = userWords.slice(i, i + 8).join(" ");
    if (fragment.length < 20) continue;

    if (replyLower1.includes(fragment)) {
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const before = cleaned;
      cleaned = cleaned.replace(regex, "");
      if (before !== cleaned) removed += 1;
    }
  }

  // Pass 2: 6-word fragments
  const replyLower2 = cleaned.toLowerCase();

  for (let i = 0; i <= userWords.length - 6; i++) {
    const fragment = userWords.slice(i, i + 6).join(" ");
    if (fragment.length < 16) continue;

    if (replyLower2.includes(fragment)) {
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const before = cleaned;
      cleaned = cleaned.replace(regex, "");
      if (before !== cleaned) removed += 1;
    }
  }

  return { text: cleaned, removed };
}

/**
 * Strip common "echo lead-ins" that still sneak through.
 */
function stripEchoLeadIns(text: string): string {
  let t = text || "";

  t = t.replace(
    /^(i hear you|i hear that|i understand|it sounds like|i'm hearing|i can tell)\b[:,-]?\s*/i,
    ""
  );

  t = t.replace(/^thank(s)?\s+(you\s+)?for\s+sharing\b[:,-]?\s*/i, "");

  return t;
}

function finalizeOutput(text: string): string {
  let t = normalizeText(text);

  t = t.replace(/\n+/g, " ");
  t = t.replace(/\s+([,.!?])/g, "$1");
  t = t.replace(/([,.!?]){2,}/g, "$1");

  // Remove stray quotes if any remain
  t = t.replace(/["']/g, "");

  return normalizeText(t);
}

function fallbackReply(dayNumber: number): string {
  if (dayNumber <= 7)
    return "Good. Keep it simple today. Do the next right thing.";
  if (dayNumber <= 30)
    return "Good work. Stay disciplined. Show up again tomorrow.";
  return "Good. Protect your focus. Keep showing up.";
}

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<CoachReplyResult> {
  const openai = getOpenAIClient();

  const md = await getClerkPublicMetadata(userId);

  const primaryGoal =
    typeof md?.summittGoal === "string" ? normalizeText(md.summittGoal) : null;

  const safeUserMessage = normalizeText(userMessage);

  const MODEL = "gpt-4.1-mini";
  const TEMPERATURE = 0.35;
  const MAX_TOKENS = 120;

  const systemPrompt = `
You are Coach Pat Summitt.

Voice: calm, direct, grounded. No pep talk. No therapy.

HARD RULES (non-negotiable):
- 1 paragraph only
- 3 sentences MAX
- Do NOT quote the user (no quotation marks, no paraphrase)
- Do NOT restate their sentence
- Do NOT use "you said / you mentioned / it sounds like / I hear you"
- Do NOT reference journaling, reflections, entries, summaries, memory, or past days
- No guilt language
- No hype language
- No emojis
- No bullet points

OUTPUT INTENT:
- Respond to the SIGNAL, not the sentence.
- Give ONE coaching point + ONE next step.
- Keep it tight. End clean.
`.trim();

  const userPrompt = `
Primary goal: ${primaryGoal || "Unknown"}
Day: ${dayNumber}

User message (DO NOT QUOTE OR REPEAT THIS):
${safeUserMessage}

Now write the coach reply.
`.trim();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    top_p: 1,
    frequency_penalty: 0.2,
    presence_penalty: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const fallback = fallbackReply(dayNumber);

  let raw =
    completion.choices[0]?.message?.content?.trim() || fallback;

  const fallbackUsed = raw === fallback;

  // Track whether sanitization changed things meaningfully
  const beforeSanitize = normalizeText(raw);

  // =========================
  // HARDENING PIPELINE
  // =========================
  raw = stripMarkdown(raw);
  raw = stripQuotes(raw);

  const forbiddenResult = stripForbiddenPhrases(raw);
  raw = forbiddenResult.text;

  raw = stripEchoLeadIns(raw);

  const echoResult = stripUserEcho(raw, safeUserMessage);
  raw = echoResult.text;

  raw = enforceMaxThreeSentences(raw);
  raw = finalizeOutput(raw);

  const afterSanitize = normalizeText(raw);

  // Safety fallback
  if (!raw || raw.length < 18) {
    raw = fallback;
  }

  const meta: CoachReplyMeta = {
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    fallbackUsed,

    forbiddenStrips: forbiddenResult.removed,
    echoFragmentsRemoved: echoResult.removed,

    sanitized: beforeSanitize !== afterSanitize,
  };

  return { text: raw, meta };
}
