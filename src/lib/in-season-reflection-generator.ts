import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { getUserStalenessLevel } from "@/lib/get-user-staleness";

/**
 * ======================================================
 * In-Season Reflection Prompt Generator (V3 – Staleness Aware)
 * ======================================================
 *
 * Adds:
 * - Gentle re-entry tone if user is idle (medium/long)
 * - Still ONE sentence, ONE question
 * - Never mentions missed days or streaks
 */

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in environment");
  return new OpenAI({ apiKey });
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function clampSimple(input: string, maxLen: number) {
  const text = normalizeText(input);
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim();
}

async function getRecentMemory(userId: string) {
  const { data: weekly } = await supabaseServer
    .from("weekly_summaries")
    .select("weekly_summary")
    .eq("clerk_user_id", userId)
    .order("week_end_day", { ascending: false })
    .limit(1)
    .maybeSingle();

  const weeklyText = normalizeText(weekly?.weekly_summary ?? "");
  if (weeklyText) return { kind: "weekly" as const, text: weeklyText };

  const { data: daily } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summary, daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dailyText = normalizeText(
    (daily as any)?.daily_summary ??
      (daily as any)?.daily_summaries ??
      ""
  );

  if (dailyText) return { kind: "daily" as const, text: dailyText };

  return { kind: "none" as const, text: "" };
}

function buildFallbackQuestion(actionText: string) {
  const safeAction = clampSimple(actionText, 120);
  if (!safeAction)
    return "How does showing up in a small way shape who you are becoming?";
  return "How does this practice help you be the kind of person you want to be?";
}

export async function generateInSeasonReflectionPrompt({
  userId,
  dayNumber,
  actionText,
  primaryGoal,
}: {
  userId: string;
  dayNumber: number;
  actionText: string;
  primaryGoal?: string;
}): Promise<string> {
  const openai = getOpenAIClient();
  const memory = await getRecentMemory(userId);
  const md = await getClerkPublicMetadata(userId);

  const { level: stalenessLevel } = getUserStalenessLevel({
    timezoneFromMetadata: md?.timezone,
    lastCompletedAt: md?.lastCompletedAt,
  });

  const input = {
    phase: "In-Season",
    day_number: dayNumber,
    action_text: clampSimple(actionText, 180),
    primary_goal: primaryGoal ? clampSimple(primaryGoal, 80) : null,
    recent_memory_kind: memory.kind,
    recent_memory_text: memory.text
      ? clampSimple(memory.text, 400)
      : null,
  };

  const system = `
You write ONE calm reflection question for a daily practice app.

NON-NEGOTIABLE:
- Output exactly ONE question, 1 sentence.
- 3rd/4th grade reading level.
- Must be answerable in ONE honest sentence.
- No therapy words. No diagnosis. No trauma language.
- No guilt. No pressure.
- DO NOT mention memory, summaries, past days, streaks, or "you said."
- DO NOT assume they did the action.
- Keep it calm and safe.
`.trim();

  let developer = `
Your job:
- Write a question that matches the action_text.
- Never assume completion.
- Use simple "How does..." style questions.
- Point toward agency, identity, small progress.
- If primary_goal exists, gently align toward it.
- If memory exists, gently align theme without referencing it.

STYLE:
- ONE sentence only.
- Short. Plain words.
- Return ONLY the question.
`.trim();

  if (stalenessLevel === "medium_idle" || stalenessLevel === "long_idle") {
    developer += `

IMPORTANT:
- The user may be returning after some time.
- Subtly make the question feel welcoming.
- Do NOT mention time away.
- Do NOT mention missing days.
- Make it feel safe to begin again.
`;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.4,
    max_tokens: 50,
    top_p: 1.0,
    messages: [
      { role: "system", content: system },
      { role: "developer", content: developer },
      { role: "user", content: JSON.stringify(input) },
    ],
  });

  let out = normalizeText(
    completion.choices[0]?.message?.content ?? ""
  );

  if (!out) out = buildFallbackQuestion(actionText);

  out = out.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();

  const qmIndex = out.indexOf("?");
  if (qmIndex !== -1) out = out.slice(0, qmIndex + 1);

  if (!out.endsWith("?")) out = `${out}?`;

  out = clampSimple(out, 140);
  if (!out.endsWith("?")) out = `${out}?`;

  if (!out || out.length < 8)
    return buildFallbackQuestion(actionText);

  return out;
}