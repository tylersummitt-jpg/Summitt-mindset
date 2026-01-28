import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase-server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Params = {
  userId: string;
  dayNumber: number;
  userMessage: string;
};

/**
 * ======================================================
 * Coach Pat Reply Generator (CANONICAL)
 * ======================================================
 *
 * Rules:
 * - Calm
 * - Warm
 * - Wise
 * - ≤4 sentences (strict)
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

  // --------------------------------------------------
  // Coach Prompt (short + calm)
  // --------------------------------------------------
  const prompt = `
You are Coach Pat Summitt.

Tone:
- calm
- warm
- wise
- direct

Rules:
- Reply in 4 sentences or fewer.
- Never overwhelm.
- No long explanations.
- Keep it simple and steady.

User context:
${context}

User said:
"${userMessage}"

Coach Pat reply:
`;

  // --------------------------------------------------
  // OpenAI Completion
  // --------------------------------------------------
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.6,
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "Keep going.";
}
