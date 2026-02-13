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

function splitIntoSentences(text: string): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Hard-enforce ≤4 sentences, and make sure it never returns empty.
 */
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

  return `${sentences[0]} ${sentences[1]} ${sentences[2]} ${sentences[3]}`;
}

async function getDailySummary(userId: string, dayNumber: number) {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  const t = normalizeText(data?.daily_summaries ?? "");
  return t || null;
}

async function getMostRecentWeeklySummary(userId: string) {
  const { data } = await supabaseServer
    .from("weekly_summaries")
    .select("weekly_summary, week_start_day, week_end_day")
    .eq("clerk_user_id", userId)
    .order("week_end_day", { ascending: false })
    .limit(1)
    .maybeSingle();

  const t = normalizeText(data?.weekly_summary ?? "");
  if (!t) return null;

  return {
    text: t,
    weekStartDay: data?.week_start_day ?? null,
    weekEndDay: data?.week_end_day ?? null,
  };
}

async function getActionItemForDay(userId: string, dayNumber: number) {
  const { data } = await supabaseServer
    .from("daily_prompts")
    .select("action_item")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  const t = normalizeText(data?.action_item ?? "");
  return t || null;
}

async function getThreadForDay(userId: string, dayNumber: number) {
  // Pull recent thread messages for this day only.
  // (We don't want infinite context.)
  const { data } = await supabaseServer
    .from("coach_conversations")
    .select("role, content, created_at")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return [];

  // Keep last 10 total messages max (prevents cost creep)
  const trimmed = data.slice(-10);

  return trimmed.map((m) => ({
    role: m.role === "coach" ? "assistant" : "user",
    content: normalizeText(m.content ?? ""),
  }));
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
 * Upgraded:
 * - Uses same-day thread context
 * - Uses goal (if present)
 * - Uses weekly summary lightly (if present)
 * - Uses daily summary (if present)
 * - Uses action item (if present)
 */
export async function generateCoachReply({
  userId,
  dayNumber,
  userMessage,
}: Params): Promise<string> {
  const openai = getOpenAIClient();

  // Pull metadata for identity anchoring (goal)
  const md = await getClerkPublicMetadata(userId);

  const primaryGoal =
    typeof md?.summittGoal === "string" ? normalizeText(md.summittGoal) : null;

  // Pull memory atoms
  const [dailySummary, weeklySummary, actionItem, thread] = await Promise.all([
    getDailySummary(userId, dayNumber),
    getMostRecentWeeklySummary(userId),
    getActionItemForDay(userId, dayNumber),
    getThreadForDay(userId, dayNumber),
  ]);

  const safeUserMessage = normalizeText(userMessage);

  const systemPrompt = `
You are Coach Pat Summitt.

This is a daily habit OS. The user is not here for therapy or essays.
They are here for calm, consistent coaching.

TONE
- calm
- warm
- wise
- direct
- confident (not hype)

HARD RULES
- Output MUST be 1 paragraph.
- 4 sentences MAX.
- No bullet points.
- No lecturing.
- No long explanations.
- No motivational clichés.
- No therapy language.
- No diagnosis.
- No guilt.
- Do NOT mention "memory", "summaries", "past days", or "you said".

WHAT TO DO
- Respond like a real coach.
- Acknowledge what they wrote in one clean line.
- Give ONE clear coaching point.
- Give ONE simple next step for tomorrow.
- Close with calm reinforcement.

OPTIONAL CONTEXT
Primary goal: ${primaryGoal || "Unknown"}
Today's practice: ${actionItem || "Unknown"}
Today's summary: ${dailySummary || "None"}

Most recent weekly reflection: ${
    weeklySummary?.text
      ? weeklySummary.text
      : "None"
  }
`.trim();

  /**
   * We include the existing thread (same day only) so Coach Pat stays coherent.
   * Then we add the new user message as the final user message.
   */
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
    [{ role: "system", content: systemPrompt }];

  for (const m of thread) {
    if (!m.content) continue;
    messages.push({
      role: m.role as "user" | "assistant",
      content: m.content,
    });
  }

  // Ensure the latest user message is present
  messages.push({
    role: "user",
    content: safeUserMessage,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.55,
    max_tokens: 160,
    top_p: 1.0,
    messages,
  });

  const raw =
    completion.choices[0]?.message?.content?.trim() ||
    "Good work. Keep it simple. Stay honest. Come back tomorrow.";

  return enforceMaxFourSentences(raw);
}
