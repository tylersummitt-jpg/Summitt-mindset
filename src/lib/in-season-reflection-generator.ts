import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey });

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

async function getRecentMemory(userId: string) {
  // Prefer weekly summary, fall back to latest daily summary
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
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dailyText = normalizeText(daily?.daily_summaries ?? "");
  if (dailyText) return { kind: "daily" as const, text: dailyText };

  return { kind: "none" as const, text: "" };
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
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in environment");

  const memory = await getRecentMemory(userId);

  // If no memory yet, we still generate a safe universal question.
  const input = {
    phase: "In-Season",
    day_number: dayNumber,
    action_text: actionText,
    primary_goal: primaryGoal ?? null,
    recent_memory_kind: memory.kind,
    recent_memory_text: memory.text || null,
  };

  const system = `
You write ONE calm reflection question for a daily practice app.

NON-NEGOTIABLE:
- Output exactly ONE question, 1 sentence.
- Must be answerable in one honest sentence.
- No therapy language. No diagnosis.
- No guilt. No pressure. No "fix yourself."
- Do NOT mention memory, summaries, past days, or "you said".
- Keep it neutral. Human. Simple.
`.trim();

  const developer = `
Your job:
- Write a question that fits the action_text.
- If primary_goal exists, gently angle the question toward it (subtle).
- If recent_memory_text exists, you may gently nudge toward a recurring theme WITHOUT referencing it directly.
- Never assume weakness (e.g. don't imply lack of confidence).
- Avoid buzzwords like "optimize", "mindset shift", "trauma", "healing".

Return ONLY the question text. No quotes. No bullets.
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.6,
    max_tokens: 60,
    top_p: 1.0,
    messages: [
      { role: "system", content: system },
      { role: "developer", content: developer },
      { role: "user", content: JSON.stringify(input) },
    ],
  });

  const out = normalizeText(completion.choices[0]?.message?.content ?? "");
  // Hard safety: ensure it ends with ? and isn't empty.
  if (!out) return "What did you notice when you tried today’s practice?";
  if (!out.endsWith("?")) return `${out}?`;
  return out;
}
