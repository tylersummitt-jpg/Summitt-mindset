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
 * Keep to 4 sentences max.
 *
 * NOTE TO FUTURE ME:
 * This aligns with the "Perfect 4-Sentence Structure" retention stack:
 * 1) reflect (specific), 2) identity, 3) progress framing, 4) calm forward pull.
 */
function enforceMaxFourSentences(text: string): string {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return "Good. That’s steadiness. Keep that standard. We’ll build again tomorrow.";
  }
  return sentences.slice(0, 4).join(" ");
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

  // No exclamation marks (tone requirement)
  t = t.replace(/!/g, ".");

  return normalizeText(t);
}

function fallbackReply(dayNumber: number): string {
  if (dayNumber <= 7) {
    return "Good. That’s you choosing steadiness. Small wins stack into character. We’ll build again tomorrow.";
  }
  if (dayNumber <= 30) {
    return "Good. That’s disciplined training. You’re building consistency without noise. Keep that standard tomorrow.";
  }
  return "Good. That’s veteran steadiness. You’re operating from standards, not mood. Stay with it tomorrow.";
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
  const MAX_TOKENS = 170; // slightly higher to reliably fit 4 short sentences

  const systemPrompt = `
You are Coach Pat Summitt.

Voice: calm, direct, grounded. No pep talk. No therapy. Never impressed, never disappointed.

HARD RULES (non-negotiable):
- 1 paragraph only
- 4 sentences MAX
- No emojis
- No exclamation marks
- No bullet points
- Do NOT quote the user (no quotation marks)
- Do NOT restate their sentence or paraphrase it back
- Do NOT use "you said / you mentioned / it sounds like / I hear you"
- Do NOT reference journaling, reflections, entries, summaries, memory, or past days
- No guilt language
- No hype language
- Avoid parental praise like "I'm proud of you"

OUTPUT STRUCTURE (4 sentences, in this exact order):
1) Reflect something SPECIFIC about the signal/theme they shared (no quoting).
2) Identity reinforcement tied to their goal (who they are becoming).
3) Progress framing (make their change visible; subtle, real).
4) Calm forward orientation (invite continuation, no pressure, no streak talk).

Keep it short. Calm. Certain. End clean.
`.trim();

  const userPrompt = `
Primary goal: ${primaryGoal || "Unknown"}
Day: ${dayNumber}

User message (DO NOT QUOTE OR REPEAT THIS):
${safeUserMessage}

Write the coach reply using the required 4-sentence structure.
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

  let raw = completion.choices[0]?.message?.content?.trim() || fallback;

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

  raw = enforceMaxFourSentences(raw);
  raw = finalizeOutput(raw);

  const afterSanitize = normalizeText(raw);

  // Safety fallback
  if (!raw || raw.length < 30) {
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