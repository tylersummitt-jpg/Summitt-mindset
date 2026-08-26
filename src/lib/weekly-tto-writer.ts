/**
 * Weekly TTO final writer — Brief + Weekly packet → body-only JSON.
 * GPT-5.6 Sol, reasoning_effort low. No should_send. No footer. No hidden rewrite.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";

export const WEEKLY_TTO_WRITER_MODEL = "gpt-5.6-sol" as const;
export const WEEKLY_TTO_WRITER_REASONING_EFFORT = "low" as const;
export const WEEKLY_TTO_WRITER_TEMPERATURE = null;
export const WEEKLY_TTO_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const WEEKLY_TTO_SOL_WRITER_PROMPT_PATH = "weekly_brief_writer_v1" as const;
export const WEEKLY_TTO_WRITER_CAPTURE_VERSION = "weekly_writer_capture_v1" as const;

export const WEEKLY_WRITER_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const WEEKLY_TTO_SYSTEM_PROMPT = `You are Coach Pat writing one SMS for Sunday around noon inside an ongoing coaching relationship.

You receive two JSON blocks:
1. WEEKLY_COACHING_BRIEF_V1 — the coaching plan (shared morning_coaching_brief_v1 schema).
2. WEEKLY_RELATIONSHIP_PACKET_V1 — canonical facts and the exact real conversation.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the relationship. Do not re-interpret whether the week had a lesson, whether the goal belongs, whether identity belongs, whether to ask a question, or whether to look ahead. Follow the Brief.
Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Write the next natural human text in this relationship. Write as much as this moment needs and no more. Weekly may have a little more room than a Morning or Evening text when genuine perspective requires it. It is still a text message, not an essay.

Prior coach messages are conversation history, not style samples. Do not imitate robotic, stale, or generic old coach language.
Do not use Pat Pause openers, fake Pat quotes, first-person Pat memories, or invented Pat stories.
No app directions, menu directions, or robot-style reply menus.
Do not write a compliance footer. Do not write STOP/HELP copy.

SUNDAY CLOCK
packet.message_for is the receive clock (Sunday around noon, daypart=weekly). Ignore generation wall-clock, including Friday/Saturday generation. Sunday is still happening. Monday has not started. Relative-time language must fit that clock. Older relative-time words belong to their original timestamps.
If the Brief contains perspective, express it naturally. Do not invent weekly perspective if the Brief does not contain it.

PRESERVE BRIEF UNCERTAINTY
Preserve uncertainty from the Brief. If the Brief says a current fact, status, timing, circumstance, or weekly event is unclear, unknown, or one of multiple plausible states, do not collapse one possibility into an asserted premise. Either omit the uncertain premise, or phrase the text so the uncertainty remains open. If the Brief says it is unclear whether an event occurred, do not recap that event as completed.

Honor conversation_continuity.open_loop and boundaries.claims_to_avoid in the actual wording, not merely in topic selection. Do not turn plans into completed events, possibilities into facts, or unknown current circumstances into asserted current circumstances.

This does not ban natural inference when the Brief and packet clearly support the current state. It does not require "maybe" in every sentence, hedging every text, either/or questions, or clarification questions. It does not weaken challenge or accountability. Asking about the outcome of a planned action remains legal — that asks what happened; it does not assert completion.

Return strict JSON only:
{"body":"<sms text>"}
The body must be nonempty. No other keys. No should_send.`;

export type WeeklyWriterCaptureV1 = {
  capture_version: typeof WEEKLY_TTO_WRITER_CAPTURE_VERSION;
  model: typeof WEEKLY_TTO_WRITER_MODEL;
  temperature: null;
  reasoning_effort: typeof WEEKLY_TTO_WRITER_REASONING_EFFORT;
  max_completion_tokens: typeof WEEKLY_TTO_WRITER_MAX_COMPLETION_TOKENS;
  prompt_path: typeof WEEKLY_TTO_SOL_WRITER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type WeeklyWriterSuccess = {
  ok: true;
  body: string;
  messages: ChatCompletionMessageParam[];
  primaryMessages: ChatCompletionMessageParam[];
  retryMessages: ChatCompletionMessageParam[];
  retryOccurred: boolean;
  writer_prompt_path: typeof WEEKLY_TTO_SOL_WRITER_PROMPT_PATH;
  model: typeof WEEKLY_TTO_WRITER_MODEL;
  capture: WeeklyWriterCaptureV1;
};

export type WeeklyWriterFailureReason =
  | "openai_unavailable"
  | "openai_request_failed"
  | "invalid_json"
  | "empty_body";

export type WeeklyWriterFailure = {
  ok: false;
  error: WeeklyWriterFailureReason;
  messages?: ChatCompletionMessageParam[];
  primaryMessages?: ChatCompletionMessageParam[];
  retryMessages?: ChatCompletionMessageParam[];
  retryOccurred?: boolean;
  model?: typeof WEEKLY_TTO_WRITER_MODEL;
  capture?: WeeklyWriterCaptureV1;
};

export type WeeklyWriterResult = WeeklyWriterSuccess | WeeklyWriterFailure;

type WeeklyWriterJson = {
  body: string;
};

function parseWeeklyWriterJson(raw: string): WeeklyWriterJson | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if ("should_send" in rec) return null;
    const body = rec.body;
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
  openai_error?: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
}): WeeklyWriterCaptureV1 {
  return {
    capture_version: WEEKLY_TTO_WRITER_CAPTURE_VERSION,
    model: WEEKLY_TTO_WRITER_MODEL,
    temperature: WEEKLY_TTO_WRITER_TEMPERATURE,
    reasoning_effort: WEEKLY_TTO_WRITER_REASONING_EFFORT,
    max_completion_tokens: WEEKLY_TTO_WRITER_MAX_COMPLETION_TOKENS,
    prompt_path: WEEKLY_TTO_SOL_WRITER_PROMPT_PATH,
    raw_response: args.raw_response,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    request_started_at: args.request_started_at,
    request_completed_at: args.request_completed_at,
    latency_ms: args.latency_ms,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

export function buildWeeklyWriterMessages(
  packet: WeeklyRelationshipPacket,
  weeklyCoachingBrief: MorningCoachingBriefV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: WEEKLY_TTO_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "WEEKLY_COACHING_BRIEF_V1",
        JSON.stringify(weeklyCoachingBrief),
        "",
        "WEEKLY_RELATIONSHIP_PACKET_V1",
        JSON.stringify(packet),
        "",
        'Return JSON only: {"body":"<sms text>"}',
      ].join("\n"),
    },
  ];
}

const RETRY_FOLLOW_UP_USER = `Your previous response was invalid JSON or did not parse. ${WEEKLY_WRITER_JSON_REMINDER}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON. Do not change coaching content — fix format only. Do not add should_send or other keys.`;

export async function writeWeeklyTtoBody(args: {
  packet: WeeklyRelationshipPacket;
  weeklyCoachingBrief: MorningCoachingBriefV1;
}): Promise<WeeklyWriterResult> {
  const { packet, weeklyCoachingBrief } = args;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "openai_unavailable" };
  }

  const messages = buildWeeklyWriterMessages(packet, weeklyCoachingBrief);
  const client = new OpenAI({ apiKey });
  const startedMs = Date.now();
  const request_started_at = new Date(startedMs).toISOString();

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: WEEKLY_TTO_WRITER_MODEL,
      reasoning_effort: WEEKLY_TTO_WRITER_REASONING_EFFORT,
      max_completion_tokens: WEEKLY_TTO_WRITER_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
      messages: msgs,
    });

  try {
    const first = await solCreate(messages);
    let raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseWeeklyWriterJson(raw) : null;
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
      parsed = rawRetry ? parseWeeklyWriterJson(rawRetry) : null;
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
        writer_prompt_path: WEEKLY_TTO_SOL_WRITER_PROMPT_PATH,
        model: WEEKLY_TTO_WRITER_MODEL,
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
    const error: WeeklyWriterFailureReason = empty ? "empty_body" : "invalid_json";

    return {
      ok: false,
      error,
      messages,
      primaryMessages: messages,
      retryMessages,
      retryOccurred,
      model: WEEKLY_TTO_WRITER_MODEL,
      capture: buildCapture({
        raw_response: raw || null,
        raw_retry_response: rawRetry,
        error,
        ...timing,
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? false : null,
      }),
    };
  } catch (err) {
    const completedMs = Date.now();
    return {
      ok: false,
      error: "openai_request_failed",
      messages,
      primaryMessages: messages,
      retryMessages: [],
      retryOccurred: false,
      model: WEEKLY_TTO_WRITER_MODEL,
      capture: buildCapture({
        raw_response: null,
        raw_retry_response: null,
        error: "openai_request_failed",
        openai_error: scrubOpenAiRequestErrorForCapture(err),
        request_started_at,
        request_completed_at: new Date(completedMs).toISOString(),
        latency_ms: completedMs - startedMs,
        retry_occurred: false,
        retry_succeeded: null,
      }),
    };
  }
}
