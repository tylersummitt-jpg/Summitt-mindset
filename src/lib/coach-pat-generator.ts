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

function pickPrimaryPattern(patterns: string[]): string | null {
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  const first = normalizeText(patterns[0] || "");
  return first || null;
}

function buildProfileBlock(profile: {
  available: boolean;
  identity?: string;
  relationships?: string;
  work?: string;
  health?: string;
  pressure?: string;
}): string {
  if (!profile.available) {
    return "PROFILE: none";
  }

  const lines: string[] = [];

  if (profile.identity) lines.push(`IDENTITY: ${profile.identity}`);
  if (profile.relationships) lines.push(`RELATIONSHIPS: ${profile.relationships}`);
  if (profile.work) lines.push(`WORK: ${profile.work}`);
  if (profile.health) lines.push(`HEALTH: ${profile.health}`);
  if (profile.pressure) lines.push(`PRESSURE: ${profile.pressure}`);

  if (lines.length === 0) {
    return "PROFILE: none";
  }

  return lines.join("\n");
}

function buildRecencyHint(staleness: "fresh" | "normal" | "reentry"): string {
  switch (staleness) {
    case "fresh":
      return "RECENCY_HINT: This person is in active rhythm. Continuity can be lightly felt.";
    case "normal":
      return "RECENCY_HINT: This person still has continuity. Keep the note grounded and steady.";
    case "reentry":
      return "RECENCY_HINT: Keep it welcoming, simple, and present-focused. Do not imply a lapse or recap.";
    default:
      return "RECENCY_HINT: Stay simple and present.";
  }
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

  const primaryPattern =
    context.today_context.staleness_mode === "reentry"
      ? null
      : pickPrimaryPattern(context.patterns);

  const practiceAction = context.today_practice.practice_action_signal || context.today_practice.practice_summary;

  const brief = `
DAY: ${context.today_context.day_number}
PHASE: ${context.today_context.phase}
STALENESS: ${context.today_context.staleness_mode}
${buildRecencyHint(context.today_context.staleness_mode)}
PRACTICE_TYPE: ${context.today_practice.practice_summary}
PRACTICE_ACTION: ${practiceAction}
PATTERN: ${primaryPattern || "none"}
RECENT: ${context.recent_summary.summary_text || "none"}

${buildProfileBlock(context.profile_context)}
`;

  const fallback =
    context.today_context.staleness_mode === "reentry"
      ? "Start simple. Stay steady. Let today be clean and manageable. Do the next right thing."
      : "Keep it simple today. Stay steady. Do the next right thing. That is enough.";

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

Rules for this note:
- 3 to 5 sentences, one paragraph.
- At least one directive sentence (clear, winnable standard).
- Short sentences.
- No metaphors.
- Use at most ONE pattern.
- Use at most ONE personal detail from PROFILE.
- Never say how you know the personal detail.
- Do not quote PROFILE language back word-for-word.
- If PROFILE is not useful, ignore it.
- PATTERN should shape the note quietly, not dominate it.
- PRACTICE should shape the standard for today.
- RECENT may influence tone, but do not summarize it back.
`,
        },
      ],
    });

    let raw = completion.choices[0]?.message?.content?.trim() || fallback;

    raw = normalizeText(raw);

    const result = enforceSimplicity(raw);

    if (!result.valid) {
      const sentenceCount = raw.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).length;
      console.warn("[CoachPatNote] simplicity failed", {
        attempt,
        reason: result.reason,
        sentenceCount,
      });
    }

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

  console.warn("[CoachPatNote] fallback returned", {
    attemptCount: 3,
    dayNumber,
    phase: context.today_context.phase,
    stalenessMode: context.today_context.staleness_mode,
  });

  return {
    text: fallback,
    stalenessMode: context.today_context.staleness_mode,
    simplicityPassed: false,
    attempts,
    model: COACH_PAT_GENERATION_CONFIG.model,
  };
}