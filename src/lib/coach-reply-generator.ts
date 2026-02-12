// src/lib/coach-reply-generator.ts

import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";

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

function splitIntoSentences(text: string): string[] {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();

  if (!cleaned) return [];

  const parts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts;
}

function enforceMaxFourSentences(text: string): string {
  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return "Good work. Keep it simple. Stay honest. Come back tomorrow.";
  }

  if (sentences.length === 1) {
    return `${sentences[0]} Keep it simple. Stay honest. Come back tomorrow.`;
  }

  if (sentences.length === 2) {
    return `${sentences[0]} ${sentences[1]} Stay honest. Come back tomorrow.`;
  }

  if (sentences.length === 3) {
    return `${sentences[0]} ${sentences[1]} ${sentences[2]} Come back tomorrow.`;
  }

  // Hard cut to 4
  return `${sentences[0]} ${sentences[1]} ${sentences[2]} ${sentences[3]}`;
}

/**
 * ======================================================
 * Coach Pat Reply Generator (CANONICAL)
 * ======================================================
 *
 * Rules:
 * - Calm
 * - Warm
 * - Wise
 * - Direct
 * - ≤4 sentences (HARD ENFORCED)
 * - Never overwhelming
 *
 * Grounded lightly in the user’s daily summary (if present)
 */
export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<string> {
  // --------------------------------------------------
  // Pull daily summary for grounding (optional)
  // --------------------------------------------------
  const { data: summaryRow } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  const context = summaryRow?.daily_summaries ?? "";

  const openai = getOpenAIClient();

  const systemPrompt = `
You are Coach Pat Summitt.

You are responding to a member who just completed today's reflection.

TONE
- calm
- warm
- wise
- direct

HARD RULES
- 4 sentences MAX.
- One paragraph.
- No bullet points.
- No long explanations.
- No lecturing.
- No fluff.

CONTEXT (optional)
${context || "No daily summary available."}
`.trim();

  const userPrompt = `
Member wrote:
"${userMessage}"

Write Coach Pat’s reply:
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.6,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw =
    completion.choices[0]?.message?.content?.trim() ||
    "Good work. Keep it simple. Stay honest. Come back tomorrow.";

  return enforceMaxFourSentences(raw);
}
