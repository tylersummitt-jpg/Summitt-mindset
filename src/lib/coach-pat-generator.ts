// src/lib/coach-pat-generator.ts

import OpenAI from "openai";
import { buildCoachPatContext } from "@/lib/coach-pat-context";
import {
  COACH_PAT_SYSTEM_PROMPT,
  COACH_PAT_DEVELOPER_PROMPT,
  COACH_PAT_GENERATION_CONFIG,
} from "@/lib/coach-pat-prompts";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in environment");
  return new OpenAI({ apiKey });
}

export type GenerateCoachPatNoteInput = {
  userId: string;
  dayNumber: number;
  actionItem: string;
};

export async function generateCoachPatNote({
  userId,
  dayNumber,
  actionItem,
}: GenerateCoachPatNoteInput): Promise<string> {
  const openai = getOpenAIClient();

  const context = await buildCoachPatContext({
    userId,
    dayNumber,
    actionItem,
  });

  const completion = await openai.chat.completions.create({
    model: COACH_PAT_GENERATION_CONFIG.model,
    temperature: COACH_PAT_GENERATION_CONFIG.temperature,
    max_tokens: COACH_PAT_GENERATION_CONFIG.max_tokens,
    top_p: COACH_PAT_GENERATION_CONFIG.top_p,
    frequency_penalty: COACH_PAT_GENERATION_CONFIG.frequency_penalty,
    presence_penalty: COACH_PAT_GENERATION_CONFIG.presence_penalty,
    messages: [
      { role: "system", content: COACH_PAT_SYSTEM_PROMPT },
      { role: "developer", content: COACH_PAT_DEVELOPER_PROMPT },
      { role: "user", content: JSON.stringify(context, null, 2) },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
