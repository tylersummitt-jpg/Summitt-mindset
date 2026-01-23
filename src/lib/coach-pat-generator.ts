import OpenAI from "openai";
import { buildCoachPatContext } from "@/lib/coach-pat-context";
import {
  COACH_PAT_SYSTEM_PROMPT,
  COACH_PAT_DEVELOPER_PROMPT,
  COACH_PAT_GENERATION_CONFIG,
} from "@/lib/coach-pat-prompts";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey,
});

export type GenerateCoachPatNoteInput = {
  userId: string;
  dayNumber: number;
  actionItem: string;

  // Optional identity overrides (future: from Clerk metadata)
  preferredName?: string;
  primaryGoal?: string;
};

export async function generateCoachPatNote({
  userId,
  dayNumber,
  actionItem,
  preferredName,
  primaryGoal,
}: GenerateCoachPatNoteInput): Promise<string> {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing in environment");
  }

  const context = await buildCoachPatContext({
    userId,
    dayNumber,
    actionItem,
    identity: {
      preferred_name: preferredName,
      primary_goal: primaryGoal,
      // we can add spouse_name / kids_summary later when we actually store them
    },
  });

  const completion = await openai.chat.completions.create({
    model: COACH_PAT_GENERATION_CONFIG.model,
    temperature: COACH_PAT_GENERATION_CONFIG.temperature,
    max_tokens: COACH_PAT_GENERATION_CONFIG.max_tokens,
    top_p: COACH_PAT_GENERATION_CONFIG.top_p,
    frequency_penalty: COACH_PAT_GENERATION_CONFIG.frequency_penalty,
    presence_penalty: COACH_PAT_GENERATION_CONFIG.presence_penalty,
    messages: [
      {
        role: "system",
        content: COACH_PAT_SYSTEM_PROMPT,
      },
      {
        role: "developer",
        content: COACH_PAT_DEVELOPER_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify(context),
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
