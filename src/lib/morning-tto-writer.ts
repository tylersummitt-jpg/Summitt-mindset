/**
 * Morning TTO final writer — Brief (coaching plan) + packet (facts) → body-only JSON.
 * Phase 2D: gpt-5.6-sol via local Chat Completions (not shared lane helper).
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";

export const MORNING_TTO_WRITER_MODEL = "gpt-5.6-sol" as const;
export const MORNING_TTO_WRITER_REASONING_EFFORT = "low" as const;
/** Not sent — temperature unsupported for gpt-5.6-sol on Chat Completions. */
export const MORNING_TTO_WRITER_TEMPERATURE = null;
export const MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const MORNING_TTO_WRITER_PROMPT_PATH = "morning_brief_writer_v1" as const;
export const MORNING_TTO_WRITER_CAPTURE_VERSION = "morning_writer_capture_v1" as const;

export const MORNING_WRITER_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const MORNING_TTO_SYSTEM_PROMPT = `You are Coach Pat writing one SMS in an ongoing coaching relationship.

You receive two JSON blocks:
1. MORNING_COACHING_BRIEF_V1 — the coaching plan for this generation (what matters, what to do, what not to claim).
2. MORNING_RELATIONSHIP_PACKET_V1 — canonical facts and the exact real conversation.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the whole relationship from scratch. Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Here is what is true (packet). Here is what matters now (Brief). Here is what has already been handled. Here is whether the goal belongs today. Here is the one coaching move. Here is what must not be claimed, repeated, or forced. Write one brief, natural text.

HUMAN COACHING LAWS
- Relationship first. Respond to what is actually alive for this person.
- Current Goal is context, not compulsory daily homework. Follow goal_role_today.
- Direct user questions must generally be answered before coaching. If primary_move is "answer", answer first. Do not redirect a direct question to Current Goal before answering it.
- Meaningful life moments may outrank goal talk: family, faith, grief, work, health, celebration, coaching feedback, blockers, meaningful returns, and other real life updates.
- Follow primary_move, question_policy, action_guidance, and pressure from the Brief.
- Honor claims_to_avoid, topics_not_to_force, do_not_repeat, stale/answered continuity.
- At most one useful question. No question is often correct.
- Do not manufacture coaching energy merely because a Morning text exists.

TRUTH / PROOF LAWS
- Canonical packet facts bind. Do not invent actions, outcomes, wins, misses, plans, emotions, proof, consistency, relationships, personal details, or goal changes.
- One completion is not consistency. A plan is not proof. Identity is not proof. Silence is not progress. Prior coach claims are not user evidence.
- Pending/unconfirmed goal is not Current Goal.

IDENTITY + IMPORTANT PEOPLE
- AVAILABLE does not mean MENTION. Follow identity_use, person_use, context_use, selected_person, and selected_person_reason.
- If identity/person use is background, do_not_force, do_not_use, or unknown: generally omit it.
- If selected_person exists and person_use is relevant, you may use the person naturally only when it genuinely improves the text.
- Do not recite names, list family, mention spouse/children merely because they exist, quote identity every day, or manufacture warmth to prove memory.

TARGET DATE / TIME
- packet.message_for (local_date, local_weekday, daypart, timezone) is the authoritative clock for this SMS — not the wall-clock time when the draft was generated.
- Write as a natural text for that message_for day and morning daypart (e.g. a Friday Morning draft generated on Thursday must still read as Friday morning).
- Exact-thread timestamps and day_relation_to_message are factual context. Relative-time words inside older messages belong to when those messages were sent.
- Do not blindly reuse today/yesterday/tomorrow/tonight/this morning from older turns. Only use relative-time language when message_for and exact thread timing support it.
- Understand semantic timing with intelligence (e.g. Friday morning + goal "before bed tonight" means today's completion has not happened yet; weekday-specific goals may not apply "today"). Do not invent rigid phrase tables.

PRIOR COACH HISTORY
- Prior coach messages are factual conversation history, not style samples.
- Do not imitate generic old coach language, stale phrasing, robotic questions, weak motivational copy, or repeated homework patterns.
- The message should feel like the next human turn in the relationship.

Write one SMS. Keep it natural. No app directions, menu directions, or robot-style reply menus.

Return strict JSON only:
{"body":"<sms text>"}
The body must be nonempty. No other keys.`;

export type MorningWriterCaptureV1 = {
  capture_version: typeof MORNING_TTO_WRITER_CAPTURE_VERSION;
  model: typeof MORNING_TTO_WRITER_MODEL;
  temperature: null;
  reasoning_effort: typeof MORNING_TTO_WRITER_REASONING_EFFORT;
  max_completion_tokens: typeof MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS;
  prompt_path: typeof MORNING_TTO_WRITER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type MorningWriterSuccess = {
  ok: true;
  body: string;
  /** Exact original system+user array passed as primaryMessages. */
  messages: ChatCompletionMessageParam[];
  /** Alias of messages (primary input only). */
  primaryMessages: ChatCompletionMessageParam[];
  /** Exact assistant+user follow-ups for technical JSON retry; empty when no retry. */
  retryMessages: ChatCompletionMessageParam[];
  retryOccurred: boolean;
  writer_prompt_path: typeof MORNING_TTO_WRITER_PROMPT_PATH;
  model: typeof MORNING_TTO_WRITER_MODEL;
  capture: MorningWriterCaptureV1;
};

export type MorningWriterFailureReason =
  | "openai_unavailable"
  | "openai_request_failed"
  | "invalid_json"
  | "empty_body";

export type MorningWriterFailure = {
  ok: false;
  error: MorningWriterFailureReason;
  messages?: ChatCompletionMessageParam[];
  primaryMessages?: ChatCompletionMessageParam[];
  retryMessages?: ChatCompletionMessageParam[];
  retryOccurred?: boolean;
  model?: typeof MORNING_TTO_WRITER_MODEL;
  capture?: MorningWriterCaptureV1;
};

export type MorningWriterResult = MorningWriterSuccess | MorningWriterFailure;

export type WriteMorningTtoBodyArgs = {
  packet: MorningRelationshipPacket;
  morningCoachingBrief: MorningCoachingBriefV1;
};

type MorningWriterJson = {
  body: string;
};

function parseMorningWriterJson(raw: string): MorningWriterJson | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const body = (parsed as { body?: unknown }).body;
    if (typeof body !== "string") return null;
    const trimmed = body.trim().replace(/\r?\n/g, " ");
    if (!trimmed) return null;
    return { body: trimmed };
  } catch {
    return null;
  }
}

function isEmptyBodyJson(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return false;
    const body = (parsed as { body?: unknown }).body;
    return typeof body === "string" && !body.trim();
  } catch {
    return false;
  }
}

function buildCapture(args: {
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
}): MorningWriterCaptureV1 {
  return {
    capture_version: MORNING_TTO_WRITER_CAPTURE_VERSION,
    model: MORNING_TTO_WRITER_MODEL,
    temperature: MORNING_TTO_WRITER_TEMPERATURE,
    reasoning_effort: MORNING_TTO_WRITER_REASONING_EFFORT,
    max_completion_tokens: MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS,
    prompt_path: MORNING_TTO_WRITER_PROMPT_PATH,
    raw_response: args.raw_response,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    request_started_at: args.request_started_at,
    request_completed_at: args.request_completed_at,
    latency_ms: args.latency_ms,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

/**
 * Exact writer messages: Brief coaching plan + packet factual grounding.
 * Does not mutate packet or Brief.
 */
export function buildMorningWriterMessages(
  packet: MorningRelationshipPacket,
  morningCoachingBrief: MorningCoachingBriefV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: MORNING_TTO_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "MORNING_COACHING_BRIEF_V1",
        JSON.stringify(morningCoachingBrief),
        "",
        "MORNING_RELATIONSHIP_PACKET_V1",
        JSON.stringify(packet),
        "",
        'Return JSON only: {"body":"<sms text>"}',
      ].join("\n"),
    },
  ];
}

const RETRY_FOLLOW_UP_USER = `Your previous response was invalid JSON or did not parse. ${MORNING_WRITER_JSON_REMINDER}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON. Do not change coaching content — fix format only.`;

/**
 * Final Morning SMS writer. Brief is coaching plan; packet is facts/thread.
 * Local Sol Chat Completions call (shared lane helper forces incompatible params).
 * At most one technical JSON retry — same model, format-only reminder.
 */
export async function writeMorningTtoBody(
  args: WriteMorningTtoBodyArgs
): Promise<MorningWriterResult> {
  const { packet, morningCoachingBrief } = args;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "openai_unavailable" };
  }

  const messages = buildMorningWriterMessages(packet, morningCoachingBrief);
  const client = new OpenAI({ apiKey });
  const startedMs = Date.now();
  const request_started_at = new Date(startedMs).toISOString();

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: MORNING_TTO_WRITER_MODEL,
      reasoning_effort: MORNING_TTO_WRITER_REASONING_EFFORT,
      max_completion_tokens: MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
      messages: msgs,
    });

  try {
    const first = await solCreate(messages);
    let raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseMorningWriterJson(raw) : null;
    let retryMessages: ChatCompletionMessageParam[] = [];
    let rawRetry: string | null = null;
    let retryOccurred = false;

    if (!parsed) {
      retryOccurred = true;
      retryMessages = [
        { role: "assistant", content: raw.slice(0, 8000) },
        { role: "user", content: RETRY_FOLLOW_UP_USER },
      ];
      const second = await solCreate([...messages, ...retryMessages]);
      rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
      parsed = rawRetry ? parseMorningWriterJson(rawRetry) : null;
    }

    const completedMs = Date.now();
    const timing = {
      request_started_at,
      request_completed_at: new Date(completedMs).toISOString(),
      latency_ms: completedMs - startedMs,
    };

    if (parsed?.body) {
      return {
        ok: true,
        body: parsed.body,
        messages,
        primaryMessages: messages,
        retryMessages,
        retryOccurred,
        writer_prompt_path: MORNING_TTO_WRITER_PROMPT_PATH,
        model: MORNING_TTO_WRITER_MODEL,
        capture: buildCapture({
          raw_response: raw || null,
          raw_retry_response: rawRetry,
          error: null,
          ...timing,
          retry_occurred: retryOccurred,
          retry_succeeded: retryOccurred ? true : null,
        }),
      };
    }

    const failRaw = rawRetry ?? raw;
    const empty = isEmptyBodyJson(failRaw) || isEmptyBodyJson(raw);
    const error: MorningWriterFailureReason = empty ? "empty_body" : "invalid_json";

    return {
      ok: false,
      error,
      messages,
      primaryMessages: messages,
      retryMessages,
      retryOccurred,
      model: MORNING_TTO_WRITER_MODEL,
      capture: buildCapture({
        raw_response: raw || null,
        raw_retry_response: rawRetry,
        error,
        ...timing,
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? false : null,
      }),
    };
  } catch {
    const completedMs = Date.now();
    return {
      ok: false,
      error: "openai_request_failed",
      messages,
      primaryMessages: messages,
      retryMessages: [],
      retryOccurred: false,
      model: MORNING_TTO_WRITER_MODEL,
      capture: buildCapture({
        raw_response: null,
        raw_retry_response: null,
        error: "openai_request_failed",
        request_started_at,
        request_completed_at: new Date(completedMs).toISOString(),
        latency_ms: completedMs - startedMs,
        retry_occurred: false,
        retry_succeeded: null,
      }),
    };
  }
}

/** Shape persisted under generation_metadata.morning_writer_capture_v1 */
export function buildMorningWriterMetadataV1(args: {
  capture: MorningWriterCaptureV1;
  retryMessages: ChatCompletionMessageParam[];
}): Record<string, unknown> {
  return {
    capture_version: args.capture.capture_version,
    model: args.capture.model,
    temperature: args.capture.temperature,
    reasoning_effort: args.capture.reasoning_effort,
    max_completion_tokens: args.capture.max_completion_tokens,
    prompt_path: args.capture.prompt_path,
    request_started_at: args.capture.request_started_at,
    request_completed_at: args.capture.request_completed_at,
    latency_ms: args.capture.latency_ms,
    raw_response: args.capture.raw_response,
    raw_retry_response: args.capture.raw_retry_response,
    error: args.capture.error,
    retry_occurred: args.capture.retry_occurred,
    retry_succeeded: args.capture.retry_succeeded,
    retry_messages: args.capture.retry_occurred ? args.retryMessages : [],
  };
}
