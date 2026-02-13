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
 * Hard enforce:
 * - max 4 sentences
 * - single paragraph
 */
function enforceMaxFourSentences(text: string): string {
  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return "Today is about staying steady. Keep it simple. Do the work in front of you. That’s enough.";
  }

  if (sentences.length <= 4) {
    return sentences.join(" ");
  }

  return sentences.slice(0, 4).join(" ");
}

/**
 * Remove phrases that break the “no memory talk” rule.
 */
function stripForbiddenPhrases(text: string): string {
  const forbidden = [
    "last week",
    "last month",
    "you said",
    "you wrote",
    "based on",
    "from your summary",
    "from your summaries",
    "as you mentioned",
  ];

  let cleaned = text;

  for (const phrase of forbidden) {
    const regex = new RegExp(phrase, "gi");
    cleaned = cleaned.replace(regex, "");
  }

  return cleaned;
}

function buildContextBrief(context: Awaited<ReturnType<typeof buildCoachPatContext>>): string {
  const { identity, patterns, recent_summary, today_context, today_practice } =
    context;

  const parts: string[] = [];

  parts.push(`DAY NUMBER: ${today_context.day_number}`);
  parts.push(`PHASE: ${today_context.phase}`);
  parts.push(`STALENESS: ${today_context.staleness_mode}`);

  if (identity?.preferred_name) {
    parts.push(`NAME: ${identity.preferred_name}`);
  }

  if (identity?.primary_goal) {
    parts.push(`PRIMARY GOAL: ${identity.primary_goal}`);
  }

  if (identity?.onboarding?.arena) {
    parts.push(`ARENA: ${identity.onboarding.arena}`);
  }

  if (identity?.onboarding?.outcome) {
    parts.push(`OUTCOME: ${identity.onboarding.outcome}`);
  }

  parts.push(`TODAY PRACTICE: ${today_practice.practice_summary}`);

  if (patterns.length > 0) {
    parts.push(`PATTERNS: ${patterns.join(" | ")}`);
  }

  if (recent_summary.available && recent_summary.summary_text) {
    parts.push(`RECENT MEMORY: ${recent_summary.summary_text}`);
  }

  return parts.join("\n");
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

  const brief = buildContextBrief(context);

  /**
   * Behavioral guidance override layer
   * We explicitly steer tone based on staleness.
   */
  let modeInstruction = "";

  switch (context.today_context.staleness_mode) {
    case "fresh":
      modeInstruction =
        "The athlete is in rhythm. Reinforce momentum. Keep it confident and steady.";
      break;
    case "normal":
      modeInstruction =
        "Momentum is steady but not fragile. Reinforce discipline without intensity.";
      break;
    case "reentry":
      modeInstruction =
        "This is a reentry moment. No guilt. No pressure. Welcome them back and simplify everything.";
      break;
  }

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
INTERNAL BRIEF (do not mention this structure in output)

${brief}

MODE INSTRUCTION:
${modeInstruction}

Write today’s Coach Pat note.
Rules:
- 1 paragraph
- 4 sentences MAX
- Calm, steady, direct
- No memory references
- No dates
- No therapy language
- No fluff
`,
      },
    ],
  });

  let raw =
    completion.choices[0]?.message?.content?.trim() ||
    "Today is about staying steady. Keep it simple. Do the work in front of you. That’s enough.";

  raw = stripForbiddenPhrases(raw);
  raw = enforceMaxFourSentences(raw);

  return raw;
}
