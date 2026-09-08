/**
 * Sol Goal Change semantic interpreter — GPT-5.6 Sol, reasoning_effort low,
 * strict JSON Schema, one schema retry.
 *
 * Structured meaning only. No SMS body. No DB mutation. Slice 2 pending-open
 * calls this interpreter; this module still does not write pending or send SMS.
 *
 * AUTHORITY LAW (prompt + parse overlay):
 * Conversation context can explain what the member means. It cannot manufacture
 * server state. confirms_existing_pending requires authoritative_pending on input.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { classifyMorningBriefInterpreterParseFailure } from "@/lib/morning-tto-brief-interpreter-v1";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
import {
  parseSolGoalChangeSemanticJson,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  type SolGoalChangeSemanticInput,
  type SolGoalChangeSemanticResult,
} from "@/lib/sol-goal-change-semantic";
import {
  buildSolGoalChangeSemanticExactContractPromptAppendix,
  SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT,
} from "@/lib/sol-goal-change-semantic-json-schema";

export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL = "gpt-5.6-sol" as const;
export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT = "low" as const;
export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_TEMPERATURE = null;
export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MAX_COMPLETION_TOKENS = 1200 as const;
export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_PROMPT_PATH =
  "sol_goal_change_semantic_interpreter_v1" as const;

export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SCHEMA_RETRY_USER =
  `Your previous response did not match ${SOL_GOAL_CHANGE_SEMANTIC_VERSION}. Return ONLY valid JSON for that exact schema (same field names and enum tokens). Do not change meaning — fix structure only. No markdown. No SMS body.`;

export const SOL_GOAL_CHANGE_SEMANTIC_AUTHORITY_LAW = `AUTHORITY LAW
Conversation context can explain what the member means. It cannot manufacture server state.
A previous Coach message such as "Do you want 10:30 to replace 9:30 every night going forward?" is conversational history only. It does NOT create actionable Goal Change pending.
Only authoritative_pending on the input is binding Goal Change pending.
confirms_existing_pending = true REQUIRES authoritative_pending.actionable = true with a confirmable candidate (typically sms_state awaiting_confirmation).
If authoritative_pending is null or not actionable: confirms_existing_pending, rejects_existing_pending, and modifies_existing_pending_candidate MUST all be false.
Exact thread alone may never create that authority.
You do not mutate Current Goal. You do not write pending. You do not send SMS.`;

export const SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT = `You are a constrained Goal Change semantic interpreter for Summitt Mindset Coach Pat inbound texts.

Your job is to interpret the member's newest inbound text for Goal Change meaning and concurrent meanings, then return structured JSON only. You are not a writer. Never output SMS.

${SOL_GOAL_CHANGE_SEMANTIC_AUTHORITY_LAW}

Hard rules:
- CODE DOES NOT UNDERSTAND GENERAL ENGLISH. You are the semantic brain for Goal Change on this turn.
- newest inbound (latest_inbound_text) is the center of gravity. recent_exact_thread explains short answers; it does not create server pending.
- canonical_saved_behavior_statement is the saved Current Goal. effective_coaching_ask is today's check-in bar when different; it is not a second saved goal.
- planned_interruption_known is a deterministic server signal already detected for this turn. You may also set concurrent_meaning.planned_interruption from the newest text. Interruption and saved replace are NOT mutually exclusive.
- Do not automatically treat every temporary disruption (travel, illness, one night out) as saved Goal Change.
- Do not invent a candidate bar that the member did not propose.
- Never include keys: body, sms_body, message, final_message, reply, adaptive_ask_expires_at, expires_at, expires_at_utc.
- Never output UTC timestamps. Never compute expiry. Duration meaning is structured fields only.
- Never mutate state.

INTENTS
- none: no Goal Change meaning (ordinary chat, miss, travel-only, life update).
- possible_saved_replace: they want a durable saved-goal change but the new bar is missing or too vague ("make it harder", "I need a change"). needs_clarification true. candidate_behavior_statement null unless a partial bar is clearly stated.
- saved_replace: they want the saved Current Goal replaced going forward, with a concrete proposed bar (clock, days/week, named behavior). requires_confirmation true unless they are confirming existing pending.
- temporary_adjustment: a non-durable overlay bar (tonight / this week / N days / through or until a weekday or local date / "for now"), while keeping the normal saved goal. Not saved_replace.

TEMPORARY DURATION (intent === temporary_adjustment only):
You own English duration meaning. Output structured fields only. Do not output UTC. Do not output adaptive_ask_expires_at.
- remaining_local_day: tonight / today only / rest of today. Detail fields null.
- days: "for the next N days" with N in 1–14. temporary_duration_days = N. weekday and date null.
- local_week: this week / for the week. Detail fields null.
- through_weekday: "through Friday" — that weekday is INCLUDED. temporary_weekday required. days/date null.
- until_weekday: "until Friday" — that weekday is EXCLUDED. temporary_weekday required. days/date null.
- through_local_date: "through September 12" — that local date is INCLUDED. temporary_end_local_date = YYYY-MM-DD. days/weekday null.
- until_local_date: "until September 12" — that local date is EXCLUDED. temporary_end_local_date = YYYY-MM-DD. days/weekday null.
- unspecified: duration is not representable ("for now", "while traveling" with no explicit end). Detail fields null. needs_clarification true.
If intent is not temporary_adjustment: temporary_duration_kind = unspecified and all detail fields null.
"Through" vs "until" are distinct. Do not collapse them. Do not guess a calendar date the member did not state.

SAVED REPLACEMENT examples:
- "I need to change my goal to 10:30"
- "I think I need to revise it to 10:30"
- "9:30 isn't realistic anymore. Let's do 10:30"
- "Make my goal 10:30"
- "Change my goal to 10:30"
- "Going forward, make it 10:30" → saved_replace; temporary duration fields unspecified/null
- "I want to work out three days instead of five"

TEMPORARY ADJUSTMENT examples:
- "Just tonight, hold me to 10:30." → temporary_adjustment, remaining_local_day
- "Today only, 10:30." → temporary_adjustment, remaining_local_day
- "This week, hold me to 10:30." → temporary_adjustment, local_week
- "For the next 3 days, hold me to 10:30." → temporary_adjustment, days=3
- "Through Friday, hold me to 10:30." → temporary_adjustment, through_weekday=friday
- "Until Friday, hold me to 10:30." → temporary_adjustment, until_weekday=friday
- "Through September 12, hold me to 10:30." → temporary_adjustment, through_local_date=2026-09-12
- "Until September 12, hold me to 10:30." → temporary_adjustment, until_local_date=2026-09-12
- "For now, make it 10:30." → temporary_adjustment, unspecified, needs_clarification true
- "While I'm traveling, make it 10:30." → temporary_adjustment, unspecified unless an explicit end is also stated; concurrent planned_interruption may be true; needs_clarification true if no representable end
- "While I'm traveling, through Friday hold me to 10:30." → temporary_adjustment + planned_interruption + through_weekday=friday
- "Make it harder this week." → temporary_adjustment, local_week — not automatically saved_replace
- "Make it easier this week." → temporary_adjustment, local_week
- "I'm traveling this week so let's just aim for twice"
- "Can we lower the bar this week?"
- "I still want five days normally, but three this week"
- "Keep my normal goal, but this week let's do 10:30"

DUAL MEANING (required capability):
"I'm out of town tonight, so 9:30 won't happen. Also I think I need to revise the goal to 10:30."
→ concurrent_meaning.planned_interruption = true
→ concurrent_meaning.accountability_update may be true (tonight's miss)
→ goal_change.intent = saved_replace
→ candidate for 10:30
These meanings MUST be allowed together. Do not drop saved replace because travel is present. Do not drop travel because a durable revise is present.

EXISTING PENDING (authoritative_pending only):
If server pending has candidate 10:30 awaiting confirmation:
- "Yes" / "Absolutely" / "Sounds good" → confirms_existing_pending true. Not a new replace. intent may remain saved_replace as the pending kind.
- "Yes, but make it 10:15" → modifies_existing_pending_candidate true, candidate 10:15, confirms_existing_pending false.
- "Actually let's keep 9:30" / "Actually keep 9:30" → rejects_existing_pending true, confirms false.

If server pending is commitment_replace awaiting_candidate with no candidate:
- The open question is "what should the new saved goal be?" It is NOT a yes/no confirmation.
- Bare "Yes" / "No" are NOT protocol confirm/reject. Interpret them as English in that hallway.
- A real proposed new goal → saved_replace (or possible_saved_replace), candidate_behavior_statement as a COMPLETE replacement sentence shaped like the current saved goal when the member's words support it. needs_clarification false.
- "Never mind" / "Forget it" / "Keep the old goal" / "I don't want to change it" → rejects_existing_pending true. candidate null.
- Vague / uncertain / unrelated ("Something easier", "I don't know yet", a workout check-in) → do NOT invent a candidate. needs_clarification true or intent none. rejects false.
- Do not treat a clock inside a hedging sentence ("Maybe 10:30 would be better, but I'm not sure") as a committed candidate.

NO PENDING:
If authoritative_pending is null:
- "Yes" after Coach asked a confirmation question in exact_thread is conversational agreement only.
- confirms_existing_pending MUST be false.
- That Yes is NOT authorization to change saved Current Goal.
- intent should be none for a bare Yes / Absolutely / Sounds good with no pending.

CANDIDATE
- Prefer a short behavior-statement-shaped bar ("be in bed by 10:30 pm nightly") when the member's words support it.
- If they only said "10:30", candidate may be "10:30" or a conservative expansion grounded in the current saved goal's shape.
- Vague "make it harder" → possible_saved_replace, candidate null, needs_clarification true.

${buildSolGoalChangeSemanticExactContractPromptAppendix()}`;

export type SolGoalChangeSemanticInterpreterCapture = {
  model: typeof SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL;
  temperature: null;
  reasoning_effort: typeof SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT;
  prompt_path: typeof SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type SolGoalChangeSemanticInterpreterSuccess = {
  ok: true;
  result: SolGoalChangeSemanticResult;
  capture: SolGoalChangeSemanticInterpreterCapture;
};

export type SolGoalChangeSemanticInterpreterFailure = {
  ok: false;
  result: null;
  error: string;
  capture: SolGoalChangeSemanticInterpreterCapture;
};

export type SolGoalChangeSemanticInterpreterResult =
  | SolGoalChangeSemanticInterpreterSuccess
  | SolGoalChangeSemanticInterpreterFailure;

export function buildSolGoalChangeSemanticInterpreterUserPayload(
  input: SolGoalChangeSemanticInput
): Record<string, unknown> {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    canonical_saved_behavior_statement: input.canonical_saved_behavior_statement,
    effective_coaching_ask: input.effective_coaching_ask,
    authoritative_pending: input.authoritative_pending,
    planned_interruption_known: input.planned_interruption_known,
    latest_inbound_text: input.latest_inbound_text,
    recent_exact_thread: input.recent_exact_thread,
    timezone: input.timezone,
    local_daypart: input.local_daypart,
    authority: {
      conversation_cannot_manufacture_server_state: true,
      confirms_existing_pending_requires_authoritative_pending: true,
      prior_coach_confirmation_question_is_not_pending: true,
    },
  };
}

export function buildSolGoalChangeSemanticInterpreterMessages(
  input: SolGoalChangeSemanticInput
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "SOL_GOAL_CHANGE_SEMANTIC_INPUT_V1",
        JSON.stringify(buildSolGoalChangeSemanticInterpreterUserPayload(input)),
        "",
        "Interpret Goal Change meaning for latest_inbound_text.",
        "Return JSON only. No SMS body.",
      ].join("\n"),
    },
  ];
}

function buildCapture(args: {
  raw: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error?: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
}): SolGoalChangeSemanticInterpreterCapture {
  return {
    model: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL,
    temperature: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_TEMPERATURE,
    reasoning_effort: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT,
    prompt_path: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_PROMPT_PATH,
    raw_response: args.raw,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

export async function runSolGoalChangeSemanticInterpreter(args: {
  input: SolGoalChangeSemanticInput;
  client?: OpenAI | null;
}): Promise<SolGoalChangeSemanticInterpreterResult> {
  const fail = (
    error: string,
    raw: string | null,
    retryMeta?: {
      raw_retry_response: string | null;
      retry_occurred: boolean;
      retry_succeeded: boolean | null;
    },
    openai_error?: ScrubbedOpenAiRequestError | null
  ): SolGoalChangeSemanticInterpreterFailure => ({
    ok: false,
    result: null,
    error,
    capture: buildCapture({
      raw,
      raw_retry_response: retryMeta?.raw_retry_response ?? null,
      error,
      openai_error: openai_error ?? null,
      retry_occurred: retryMeta?.retry_occurred ?? false,
      retry_succeeded: retryMeta?.retry_succeeded ?? null,
    }),
  });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    args.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : args.client;

  if (!client) {
    return fail("openai_unavailable", null);
  }

  const messages = buildSolGoalChangeSemanticInterpreterMessages(args.input);

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL,
      reasoning_effort: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT,
      max_completion_tokens: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MAX_COMPLETION_TOKENS,
      response_format: SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT,
      messages: msgs,
    });

  try {
    const parseRaw = (rawText: string) =>
      parseSolGoalChangeSemanticJson(rawText, args.input);

    const first = await solCreate(messages);
    const raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseRaw(raw) : null;
    let parsedOk = parsed?.ok === true ? parsed.result : null;

    let rawRetry: string | null = null;
    let retryOccurred = false;

    if (!parsedOk) {
      retryOccurred = true;
      const retryMessages: ChatCompletionMessageParam[] = [
        { role: "assistant", content: raw.slice(0, 8000) },
        { role: "user", content: SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SCHEMA_RETRY_USER },
      ];
      const second = await solCreate([...messages, ...retryMessages]);
      rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
      parsed = rawRetry ? parseRaw(rawRetry) : null;
      parsedOk = parsed?.ok === true ? parsed.result : null;
    }

    if (parsedOk) {
      return {
        ok: true,
        result: parsedOk,
        capture: buildCapture({
          raw,
          raw_retry_response: rawRetry,
          error: null,
          retry_occurred: retryOccurred,
          retry_succeeded: retryOccurred ? true : null,
        }),
      };
    }

    const failRaw = rawRetry ?? raw;
    return fail(
      classifyMorningBriefInterpreterParseFailure(failRaw),
      raw || null,
      {
        raw_retry_response: rawRetry,
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? false : null,
      }
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      return fail("invalid_json", null, undefined, scrubOpenAiRequestErrorForCapture(err));
    }
    return fail(
      "openai_request_failed",
      null,
      undefined,
      scrubOpenAiRequestErrorForCapture(err)
    );
  }
}
