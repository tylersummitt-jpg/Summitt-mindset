/**
 * Commitment Meaning Interpreter — OpenAI JSON only. No Supabase / no state mutation.
 */

import OpenAI from "openai";
import {
  COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
  type CommitmentInterpretationInput,
  type CommitmentInterpretationResult,
} from "@/lib/v2-commitment-meaning-interpreter/types";

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

const MODEL = "gpt-4o-mini";

const SYSTEM = `You extract ONE concrete daily accountability bar from user SMS text for Summitt Mindset.
Output ONLY valid JSON with keys:
interpreted_daily_bar (string or null),
confidence (number 0-1),
needs_clarification (boolean),
clarification_question (string or null).

Rules:
- Preserve action AND duration/timing when both appear (e.g. "Work on distribution for 2 hours" must NOT become "2 hours" alone).
- Never invent activities the user did not imply.
- If the message is vague ("get healthier", "be better") set needs_clarification true and one short clarification_question.
- If only "Run" or "Exercise" with no measurable daily detail, needs_clarification true.
- If you cannot produce a usable daily bar from this message alone, needs_clarification true.
- clarifying question must be one sentence, no therapy voice.
- Do not mention databases, candidates, proposals, overlays, or internal systems.
`;

export async function interpretCommitmentMeaningFromUserText(
  input: CommitmentInterpretationInput
): Promise<CommitmentInterpretationResult> {
  const client = getOpenAIClientOrNull();
  if (!client) return { ok: false, reason: "no_openai_client" };

  const raw = input.rawUserText.trim().replace(/\s+/g, " ").slice(0, 900);
  const hint =
    input.pendingKind === "commitment_tighten"
      ? "User is tightening/shrinking their daily bar."
      : "User is replacing their daily commitment with a new bar.";

  const userBlock = [
    hint,
    "",
    `Current bar context (may be empty): ${input.currentBarSummary ?? "(none)"}`,
    "",
    `USER_MESSAGE: ${raw}`,
    "",
    `prompt_version: ${input.promptVersion}`,
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userBlock },
      ],
      temperature: 0.25,
      max_tokens: 220,
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!content) return { ok: false, reason: "empty_model_output" };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "invalid_json" };
    }

    const needs_clarification = parsed.needs_clarification === true;
    const clarification_question =
      typeof parsed.clarification_question === "string"
        ? parsed.clarification_question.trim().replace(/\s+/g, " ").slice(0, 220)
        : null;

    let interpreted_daily_bar: string | null =
      typeof parsed.interpreted_daily_bar === "string"
        ? parsed.interpreted_daily_bar.trim().replace(/\s+/g, " ").slice(0, 480)
        : null;
    if (interpreted_daily_bar === "") interpreted_daily_bar = null;

    let confidence = 0;
    if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
      confidence = Math.min(1, Math.max(0, parsed.confidence));
    }

    /** Hard guard: never accept duration-only bar when user message clearly contains more substance. */
    if (
      interpreted_daily_bar &&
      raw.length > interpreted_daily_bar.length + 12 &&
      /^(?:\d{1,3}\s*(?:hours?|hrs?|minutes?|mins?))\s*$/i.test(interpreted_daily_bar.trim())
    ) {
      interpreted_daily_bar = null;
      return {
        ok: true,
        interpreted_daily_bar: null,
        confidence: Math.min(confidence, 0.5),
        needs_clarification: true,
        clarification_question:
          clarification_question ||
          "Say that as one daily action in a single sentence—including what you’re doing and for how long if it matters.",
        promptVersion: COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
      };
    }

    if (
      interpreted_daily_bar &&
      /\b(distribution|work on)\b/i.test(raw) &&
      !/\bdistribution\b/i.test(interpreted_daily_bar) &&
      /^[\d\s]+(hours?|hrs?|minutes?|mins?)?$/i.test(interpreted_daily_bar.replace(/\s+/g, " ").trim())
    ) {
      interpreted_daily_bar = null;
      return {
        ok: true,
        interpreted_daily_bar: null,
        confidence: Math.min(confidence, 0.45),
        needs_clarification: true,
        clarification_question:
          clarification_question ||
          "What exactly is the work—you mentioned time, but what’s the action for tomorrow?",
        promptVersion: COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
      };
    }

    return {
      ok: true,
      interpreted_daily_bar,
      confidence,
      needs_clarification,
      clarification_question,
      promptVersion: COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
    };
  } catch (e) {
    console.error("[commitment-meaning-interpreter] OpenAI failed", e);
    return { ok: false, reason: "openai_error" };
  }
}
