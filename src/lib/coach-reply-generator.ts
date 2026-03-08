// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { buildProfileContext } from "@/lib/profile-context";
import { buildCoachPatContext } from "@/lib/coach-pat-context";
import { supabaseServer } from "@/lib/supabase-server";

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

function expandContractions(text: string): string {
  return (text || "")
    .replace(/\byou['’]re\b/gi, "you are")
    .replace(/\bthey['’]re\b/gi, "they are")
    .replace(/\bwe['’]re\b/gi, "we are")
    .replace(/\bi['’]m\b/gi, "I am")
    .replace(/\bcan['’]t\b/gi, "cannot")
    .replace(/\bwon['’]t\b/gi, "will not")
    .replace(/\bit['’]s\b/gi, "it is")
    .replace(/\bthat['’]s\b/gi, "that is");
}

function removeApostrophes(text: string): string {
  return (text || "").replace(/['’]/g, "");
}

function stripMemoryMetaLanguage(text: string): string {
  let t = text || "";

  const patterns: RegExp[] = [
    /\b(as you said|as you wrote|you said|you wrote|you mentioned)\b/gi,
    /\b(earlier|previously|yesterday|last week|last month)\b/gi,
    /\b(from your journal|journal|journaling)\b/gi,
    /\b(reflection|summary|summaries)\b/gi,
    /\b(I remember|I recall|memory)\b/gi,
  ];

  for (const re of patterns) {
    t = t.replace(re, "");
  }

  return normalizeText(t);
}

function stripEmojis(text: string): string {
  return (text || "").replace(/\p{Emoji}/gu, "");
}

function finalizeOutput(text: string): string {
  let t = text || "";

  t = t.replace(/\n+/g, " ");
  t = t.replace(/!/g, ".");
  t = stripEmojis(t);

  t = t.replace(/\s+([,.!?])/g, "$1");
  t = t.replace(/([,.!?]){2,}/g, "$1");

  return normalizeText(t);
}

function enforceHardCaps(text: string): string {
  const MAX_SENTENCES = 5;
  const MAX_TOTAL_WORDS = 75;
  const MAX_WORDS_PER_SENTENCE = 18;

  const sentences = splitIntoSentences(text);

  const cappedSentences = sentences.slice(0, MAX_SENTENCES).map((s) => {
    const words = s.split(" ").filter(Boolean);
    if (words.length > MAX_WORDS_PER_SENTENCE) {
      return words.slice(0, MAX_WORDS_PER_SENTENCE).join(" ");
    }
    return s;
  });

  let result = cappedSentences.join(" ");

  const allWords = result.split(" ").filter(Boolean);
  if (allWords.length > MAX_TOTAL_WORDS) {
    result = allWords.slice(0, MAX_TOTAL_WORDS).join(" ");
  }

  return normalizeText(result);
}

function firstSentence(text: string): string | null {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return null;
  return normalizeText(sentences[0]);
}

function buildProfileBlock(profile: {
  identity?: string;
  relationships?: string;
  work?: string;
  health?: string;
  pressure?: string;
}): string {
  const lines: string[] = [];

  if (profile.identity) lines.push(`IDENTITY: ${profile.identity}`);
  if (profile.relationships) lines.push(`RELATIONSHIPS: ${profile.relationships}`);
  if (profile.work) lines.push(`WORK: ${profile.work}`);
  if (profile.health) lines.push(`HEALTH: ${profile.health}`);
  if (profile.pressure) lines.push(`PRESSURE: ${profile.pressure}`);

  return lines.length ? lines.join("\n") : "PROFILE: none";
}

/* ======================================================
   Conversation Context
====================================================== */

async function loadRecentConversation(userId: string, dayNumber: number) {
  const { data } = await supabaseServer
    .from("coach_conversations")
    .select("role, content")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .order("created_at", { ascending: true })
    .limit(6);

  if (!data || data.length === 0) {
    return {
      conversation: "none",
      lastCoachInsight: "none",
    };
  }

  const conversation = data
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${normalizeText(m.content)}`)
    .join("\n");

  const lastCoachMessage = [...data]
    .reverse()
    .find((m) => normalizeText(m.role).toLowerCase() === "coach");

  const lastCoachInsight =
    firstSentence(normalizeText(lastCoachMessage?.content ?? "")) || "none";

  return {
    conversation,
    lastCoachInsight,
  };
}

/* ======================================================
   Fallback
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
   Generator
====================================================== */

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<CoachReplyResult> {
  const openai = getOpenAIClient();

  const md = await getClerkPublicMetadata(userId);
  const profile = await buildProfileContext(userId);

  const coachContext = await buildCoachPatContext({
    userId,
    dayNumber,
    actionItem: "",
  });

  const { conversation, lastCoachInsight } = await loadRecentConversation(
    userId,
    dayNumber
  );

  const practiceSummary = coachContext?.today_practice?.practice_summary || "none";

  const primaryPattern =
    Array.isArray(coachContext?.patterns) && coachContext.patterns.length
      ? coachContext.patterns[0]
      : "none";

  const recentSummary = coachContext?.recent_summary?.summary_text || "none";

  const cleanUserMessage = normalizeText(userMessage);

  const MODEL = "gpt-4.1-mini";
  const TEMPERATURE = 0.5;
  const MAX_TOKENS = 220;

  const systemPrompt = `
You are Coach Pat Summitt.

Voice:
Calm. Direct. Simple language. Short sentences.

Rules:
- One paragraph
- Up to 5 sentences
- No emojis
- No exclamation marks
- No contractions
- Never explain how you know something
- Never mention journals, summaries, or past entries
- Use at most ONE personal detail
- Use at most ONE pattern
- Use LAST_COACH_INSIGHT only to avoid repeating yourself
- Do not quote LAST_COACH_INSIGHT back word-for-word
- If the user is circling the same issue, move the coaching forward one step
`.trim();

  const userPrompt = `
GOAL: today's practice
DAY: ${dayNumber}

TODAY PRACTICE:
${practiceSummary}

PATTERN:
${primaryPattern}

RECENT SUMMARY:
${recentSummary}

LAST COACH INSIGHT:
${lastCoachInsight}

RECENT CONVERSATION:
${conversation}

${buildProfileBlock(profile)}

USER MESSAGE:
${cleanUserMessage}

Write the coach reply.

Guidelines:
- Match the depth of the user.
- If they ask for help, give one principle and one action.
- If they are short, be short.
- If they are reflective, respond calmly.
- The practice may influence today's standard.
- The pattern may shape the coaching insight.
- LAST COACH INSIGHT is for continuity, not repetition.
- Push the conversation one step forward when appropriate.
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

  const fallback = fallbackReply(dayNumber);

  let raw = completion.choices[0]?.message?.content?.trim() || fallback;
  const fallbackUsed = !completion.choices[0]?.message?.content;

  raw = expandContractions(raw);
  raw = removeApostrophes(raw);
  raw = stripMemoryMetaLanguage(raw);
  raw = finalizeOutput(raw);
  raw = enforceHardCaps(raw);

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