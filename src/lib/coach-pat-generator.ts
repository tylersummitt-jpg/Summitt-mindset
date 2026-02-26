// src/lib/coach-pat-generator.ts

import OpenAI from "openai";
import { buildCoachPatContext } from "@/lib/coach-pat-context";
import {
  COACH_PAT_SYSTEM_PROMPT,
  COACH_PAT_DEVELOPER_PROMPT,
  COACH_PAT_GENERATION_CONFIG,
} from "@/lib/coach-pat-prompts";
import { enforceSimplicity } from "@/lib/coach-pat-simplicity";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in environment");
  return new OpenAI({ apiKey });
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export type GenerateCoachPatNoteResult = {
  text: string;
  stalenessMode: "fresh" | "normal" | "reentry";
  simplicityPassed: boolean;
  attempts: number;
  model: string;
};

export async function generateCoachPatNote({
  userId,
  dayNumber,
  actionItem,
}: {
  userId: string;
  dayNumber: number;
  actionItem: string;
}): Promise<GenerateCoachPatNoteResult> {

  const openai = getOpenAIClient();

  const context = await buildCoachPatContext({
    userId,
    dayNumber,
    actionItem,
  });

  const brief = `
DAY: ${context.today_context.day_number}
PHASE: ${context.today_context.phase}
STALENESS: ${context.today_context.staleness_mode}
PRACTICE: ${context.today_practice.practice_summary}
PATTERNS: ${context.patterns.join(" | ") || "none"}
RECENT: ${context.recent_summary.summary_text || "none"}
`;

  const fallback =
    "Keep it simple today. Stay steady. Do the next right thing. That is enough.";

  let attempts = 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    attempts = attempt;

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
        {
          role: "user",
          content: `
${brief}

Write today's note.
Exactly 4 sentences.
One paragraph.
One directive sentence.
Short sentences.
No metaphors.
`,
        },
      ],
    });

    let raw =
      completion.choices[0]?.message?.content?.trim() || fallback;

    raw = normalizeText(raw);

    const result = enforceSimplicity(raw);

    if (result.valid) {
      return {
        text: result.cleaned,
        stalenessMode: context.today_context.staleness_mode,
        simplicityPassed: true,
        attempts,
        model: COACH_PAT_GENERATION_CONFIG.model,
      };
    }
  }

  return {
    text: fallback,
    stalenessMode: context.today_context.staleness_mode,
    simplicityPassed: false,
    attempts,
    model: COACH_PAT_GENERATION_CONFIG.model,
  };
}