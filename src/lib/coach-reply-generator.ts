// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";

type Params = {
  userId: string;
  dayNumber: number;
  userMessage: string;
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

function enforceMaxFourSentences(text: string): string {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return "Good work. Keep it simple. Stay honest. Come back tomorrow.";
  }
  return sentences.slice(0, 4).join(" ");
}

function stripForbiddenPhrases(text: string): string {
  const forbidden = [
    "you said",
    "you wrote",
    "you mentioned",
    "as you said",
    "as you wrote",
    "as you mentioned",
    "last week",
    "last month",
    "earlier",
    "previous",
    "based on",
    "memory",
    "summaries",
    "journal",
    "journaling",
    "entry",
    "reflection",
    "reflect on",
    "write this down",
    "write it down",
  ];

  let cleaned = text;
  for (const phrase of forbidden) {
    const regex = new RegExp(phrase, "gi");
    cleaned = cleaned.replace(regex, "");
  }
  return cleaned;
}

function stripUserEcho(reply: string, userMessage: string): string {
  const replyLower = reply.toLowerCase();
  const userLower = userMessage.toLowerCase();
  const userWords = userLower.split(/\s+/);

  for (let i = 0; i < userWords.length - 7; i++) {
    const fragment = userWords.slice(i, i + 8).join(" ");
    if (replyLower.includes(fragment)) {
      const regex = new RegExp(fragment, "gi");
      reply = reply.replace(regex, "");
    }
  }

  return reply;
}

function finalizeOutput(text: string): string {
  let t = normalizeText(text);
  t = t.replace(/\n+/g, " ");
  t = t.replace(/\s+([,.!?])/g, "$1");
  t = t.replace(/([,.!?]){2,}/g, "$1");
  return normalizeText(t);
}

export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<string> {
  const openai = getOpenAIClient();

  const md = await getClerkPublicMetadata(userId);

  const primaryGoal =
    typeof md?.summittGoal === "string"
      ? normalizeText(md.summittGoal)
      : null;

  const safeUserMessage = normalizeText(userMessage);

  const systemPrompt = `
You are Coach Pat Summitt.

Calm. Direct. Grounded.

HARD RULES:
- 1 paragraph
- 4 sentences MAX
- No quoting user
- No mirroring wording
- No journaling references
- No therapy language
- No guilt
- No hype

Structure:
1. Brief acknowledgment (no echo)
2. One coaching point
3. One next step
4. Calm reinforcement
`.trim();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `
Primary goal: ${primaryGoal || "Unknown"}
Day: ${dayNumber}

User message:
${safeUserMessage}
`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.5,
    max_tokens: 160,
    top_p: 1,
    messages,
  });

  let raw =
    completion.choices[0]?.message?.content?.trim() ||
    "Good work. Keep it simple. Stay honest. Come back tomorrow.";

  raw = stripMarkdown(raw);
  raw = stripQuotes(raw);
  raw = stripForbiddenPhrases(raw);
  raw = stripUserEcho(raw, safeUserMessage);
  raw = enforceMaxFourSentences(raw);
  raw = finalizeOutput(raw);

  if (!raw || raw.length < 20) {
    raw = "Good work. Keep it simple. Stay honest. Come back tomorrow.";
  }

  return raw;
}
