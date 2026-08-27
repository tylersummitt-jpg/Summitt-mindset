/**
 * Inbound Sol interpreter — GPT-5.6 Sol, reasoning_effort low, strict JSON, one schema retry.
 * No DB mutation. No SMS body.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import {
  classifyMorningBriefInterpreterParseFailure,
} from "@/lib/morning-tto-brief-interpreter-v1";
import { buildInboundSolBriefExactContractPromptAppendix } from "@/lib/inbound-sol-brief-json-schema";
import { INBOUND_SOL_BRIEF_RESPONSE_FORMAT } from "@/lib/inbound-sol-brief-json-schema";
import { HISTORICAL_EVIDENCE_HISTORY_LAW } from "@/lib/historical-evidence";
import {
  parseInboundCoachingBriefV1,
  type InboundCoachingBriefV1,
} from "@/lib/inbound-sol-coaching-brief";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";

export const INBOUND_SOL_INTERPRETER_MODEL = "gpt-5.6-sol" as const;
export const INBOUND_SOL_INTERPRETER_REASONING_EFFORT = "low" as const;
export const INBOUND_SOL_INTERPRETER_TEMPERATURE = null;
export const INBOUND_SOL_INTERPRETER_MAX_COMPLETION_TOKENS = 2500 as const;
export const INBOUND_SOL_INTERPRETER_PROMPT_PATH = "inbound_sol_interpreter_v1" as const;

export const INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW = `DURABLE USER EVIDENCE

Optionally preserve ONE exact verbatim excerpt from latest_inbound_text only when the member explicitly states a rare relationship truth likely to remain useful beyond the recent conversation window.

Strong candidates include:
- explicit lasting instructions about how Coach should coach them
- foundational values or standards stated in the member's own words
- durable relationship priorities
- rare long-term human context likely to materially improve future coaching

Do not preserve:
- ordinary updates
- temporary moods/problems
- plans
- transient circumstances
- inferred traits
- model interpretations
- Current Goal restatements
- facts already represented as accountability outcomes or Wins

A this-turn-only request is not a lasting coaching preference.

user_is_correcting_coach can also be durable relationship guidance when the correction is lasting, not only for this turn. One capture object. Do not create a separate correction-memory field.

When unsure:
return null.

If returning evidence:
exact_user_evidence MUST be a verbatim contiguous substring of latest_inbound_text.

Do not select evidence from exact_thread.
Do not select something Coach said.
Do not paraphrase.
Do not normalize wording.
Do not "improve" grammar.

This is semantic capture by Sol.
No keyword rules.`;

export const INBOUND_SOL_INTERPRETER_SCHEMA_RETRY_USER =
  `Your previous response did not match inbound_coaching_brief_v1. Return ONLY valid JSON for that exact schema (six Coaching Brief sections plus inbound extras). Do not change coaching meaning — fix structure only. No markdown. No SMS body.`;

export const INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT = `You are a constrained relationship interpreter for Summitt Mindset Coach Pat inbound texts.

Your job is to interpret the user's newest real inbound text in one ongoing Coach Pat relationship, using canonical facts and the exact real SMS thread, then return structured JSON only.

Hard rules:
- CODE DOES NOT UNDERSTAND GENERAL ENGLISH. You are the only semantic brain for this inbound turn.
- Newest real inbound text (latest_inbound_text) is the center of gravity.
- message_for (local_date, local_weekday, daypart=inbound, timezone) is the receive clock for this interpretation.
- Canonical Current Goal, pending goal state, identity, and people are hard boundaries — not compulsory subjects.
- Current Goal is context, not compulsory. Goal role may be central, background, do_not_mention, or unresolved.
- If the user asks a real direct question or request: generally primary_move = answer, answer_priority = first. Do not redirect to Current Goal before answering.
- Human moments may outrank goal: family, faith, grief, work, health, travel, celebration, coaching feedback, blockers, meaningful returns.
- Coaching feedback / correction ("stop asking me that", "I don't like being asked the same thing", "you missed my point") are live relationship instructions. Set user_is_correcting_coach = true when that is what the newest text is doing.
- Short answers (yes, no, church, done, good, trying) MUST be interpreted against the exact thread. Never in isolation.
- Identity is not proof. Silence is not progress. Coach claims are not user evidence. A plan is not an attempt. An attempt is not automatically partial. An attempt is not completion. One completion is not consistency. A direct question is not an accountability outcome. A life update is not an accountability outcome.
- Do not invent outcomes, proof, emotions, goal changes, or live search capability.
- Prefer honest unknown / unclear / not_applicable / do_not_mention over guessing.
- Choose one primary coaching move. At most one useful question (question_policy none or one_useful_question).
- Prior coach messages are factual conversation history, not style examples.
- Output JSON only matching the Coaching Brief schema (version "${MORNING_COACHING_BRIEF_VERSION}") plus inbound extras.
- Never output user-visible SMS copy.
- Never include keys: body, sms_body, message, final_message, reply.
- Never mutate state.

HISTORICAL EVIDENCE
${HISTORICAL_EVIDENCE_HISTORY_LAW}

INBOUND ACCOUNTABILITY INTERPRETATION (inbound.accountability_interpretation):
- relevance: whether the newest text is about the Current Goal (central | related | unrelated | unclear).
- outcome: completed | partial | missed | attempt | plan | unclear | not_applicable.
- Use not_applicable when the text is not an accountability report (questions, life updates, coaching instructions, product questions, corrections).
- Use plan for future intent ("I'm going to do it tomorrow") — not completion.
- Use attempt when they started/tried without a clear partial/complete/miss report. Attempt is NOT automatically partial.
- confidence: low unless the newest text plus exact thread actually support the outcome.
- evidence: grounded in the newest text / thread. Empty string is allowed only when not_applicable.

MEANINGFUL WIN (inbound.meaningful_win):
- For a normal Current Goal completion only: prefer null (accountability completion is enough).
- relationship=goal or mixed means the win IS the accountability completion — still prefer null unless a distinct extra is clearly present.
- relationship=life means a DISTINCT whole-life win besides the Current Goal.
- relationship=unclear → treat as no extra win (set null unless you must mark present).

${INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW}

PENDING PHOTO (inbound.pending_photo_relation):
- pending_media_context is CODE-supplied fact about a parked inbound photo, if any. It is not a photo. You never receive image bytes, URLs, or Storage paths.
- If candidate_count is 0 or 2: relation MUST be none and target_win_id MUST be null. Do not pair. Never pick among photos.
- If candidate_count is 1: decide from the whole conversational sequence whether the newest inbound TEXT is about that pending photo.
- If awaiting_user is true, clarification_body is the exact Coach question that was ALREADY SENT about this parked photo. Decide whether newest inbound text answers that question. If yes, current_turn_win when this text is the Win from THIS turn (or existing_win if they identify a listed recent Win). Do not ask another photo question.
- Humans routinely send one photo and then a caption, explanation, reflection, or description of that moment WITHOUT saying "this photo", "this picture", "that image", or "here's what it was". Explicit photo/picture/image nouns are NOT required for current_turn_win.
- Conversational sequencing is legitimate semantic evidence. Elapsed time by itself is never enough to pair. Recency/sequence may be one contextual clue, combined with text meaning, continuity, and whether intervening turns conflict. Do not pair when context conflicts. Code does not auto-pair by age.
- relation=none: unrelated, or no single pending photo.
- relation=uncertain: a human genuinely could not tell whether the later text is explaining the pending photo. Do not use uncertain merely because photo nouns are missing. Do not ask a clarification question about the photo.
- relation=current_turn_win: the later text naturally reads as a caption/explanation/reflection/description of the moment represented by the one pending photo, AND the Win created from THIS turn. target_win_id MUST be null (the Win UUID does not exist yet).
- relation=existing_win: this text refers to the pending photo AND an already-listed recent Win. Copy target_win_id exactly from recent_wins[].id. Never invent a UUID.
- Do not mention saving or attaching a photo.

PENDING PHOTO EXAMPLES (candidate_count=1 unless noted):
- [one photo], ~5 minutes later: "Awesome family day today! Loved spending time with Brooke and the kids." → current_turn_win (same life moment; no photo noun required).
- [one photo], then: "Breck hit his first home run today!" → current_turn_win if no conflicting context.
- awaiting_user, clarification_body "What made this one a win for you?", then: "I took Lakelyn to her first dance class." → current_turn_win (this text answers the sent question and is the Win).
- [one photo], then: "What time is my check-in tomorrow?" → none.
- [one photo], then a substantially changed unrelated topic → none or uncertain.
- Vague later text where a human genuinely could not tell → uncertain, not current_turn_win.
- candidate_count=2 → none. Never pick among photos.

TEMPORAL:
- Newest inbound is "now" for this receive. Older relative-time words belong to those turns' timestamps and day_relation_to_message.
- Do not answer stale thread topics instead of the newest text.
- hard_state.open_coach_question is context only (a pending Coach question from product state). Newest U (latest_inbound_text) is the subject. You decide whether newest U answers that question or has moved on. Do not force a stale pending question.
- conversation_continuity.answered_question is the Coach question in this conversation that newest U actually answered, if any. That may be hard_state.open_coach_question or another real Coach question visible in exact_thread. It does NOT refer to pending photo clarification (clarification_body). Photo uses inbound.pending_photo_relation independently.
- If newest U answers the server-supplied open_coach_question, set answered_question.question to the exact open_coach_question.text (copy that supplied text exactly; do not paraphrase its identity) and answered_question.answer to what they said.
- If newest U instead answers a different real Coach question in exact_thread, set answered_question to that question and their answer. Server close uses identity match and will leave a mismatched open_coach_question pending. If they did not answer a Coach question, moved on, or asked something else: null. If you cannot tell: "unknown".

${buildInboundSolBriefExactContractPromptAppendix()}`;

export type InboundSolInterpreterCapture = {
  model: typeof INBOUND_SOL_INTERPRETER_MODEL;
  temperature: null;
  reasoning_effort: typeof INBOUND_SOL_INTERPRETER_REASONING_EFFORT;
  prompt_path: typeof INBOUND_SOL_INTERPRETER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type InboundSolInterpreterSuccess = {
  ok: true;
  brief: InboundCoachingBriefV1;
  capture: InboundSolInterpreterCapture;
};

export type InboundSolInterpreterFailure = {
  ok: false;
  brief: null;
  error: string;
  capture: InboundSolInterpreterCapture;
};

export type InboundSolInterpreterResult =
  | InboundSolInterpreterSuccess
  | InboundSolInterpreterFailure;

export function buildInboundSolInterpreterMessages(
  packet: InboundRelationshipPacket
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "INBOUND_RELATIONSHIP_PACKET_V1",
        JSON.stringify(packet),
        "",
        "Interpret the newest real inbound text in latest_inbound_text against exact_thread.",
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
}): InboundSolInterpreterCapture {
  return {
    model: INBOUND_SOL_INTERPRETER_MODEL,
    temperature: INBOUND_SOL_INTERPRETER_TEMPERATURE,
    reasoning_effort: INBOUND_SOL_INTERPRETER_REASONING_EFFORT,
    prompt_path: INBOUND_SOL_INTERPRETER_PROMPT_PATH,
    raw_response: args.raw,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

export async function runInboundSolBriefInterpreter(args: {
  packet: InboundRelationshipPacket;
  client?: OpenAI | null;
}): Promise<InboundSolInterpreterResult> {
  const fail = (
    error: string,
    raw: string | null,
    retryMeta?: {
      raw_retry_response: string | null;
      retry_occurred: boolean;
      retry_succeeded: boolean | null;
    },
    openai_error?: ScrubbedOpenAiRequestError | null
  ): InboundSolInterpreterFailure => ({
    ok: false,
    brief: null,
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

  const messages = buildInboundSolInterpreterMessages(args.packet);

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: INBOUND_SOL_INTERPRETER_MODEL,
      reasoning_effort: INBOUND_SOL_INTERPRETER_REASONING_EFFORT,
      max_completion_tokens: INBOUND_SOL_INTERPRETER_MAX_COMPLETION_TOKENS,
      response_format: INBOUND_SOL_BRIEF_RESPONSE_FORMAT,
      messages: msgs,
    });

  try {
    const parseRaw = (rawText: string): InboundCoachingBriefV1 | null => {
      try {
        return parseInboundCoachingBriefV1(JSON.parse(rawText) as unknown);
      } catch {
        return null;
      }
    };

    const first = await solCreate(messages);
    const raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseRaw(raw) : null;

    let rawRetry: string | null = null;
    let retryOccurred = false;

    if (!parsed) {
      retryOccurred = true;
      const retryMessages: ChatCompletionMessageParam[] = [
        { role: "assistant", content: raw.slice(0, 8000) },
        { role: "user", content: INBOUND_SOL_INTERPRETER_SCHEMA_RETRY_USER },
      ];
      const second = await solCreate([...messages, ...retryMessages]);
      rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
      parsed = rawRetry ? parseRaw(rawRetry) : null;
    }

    if (parsed) {
      return {
        ok: true,
        brief: parsed,
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
