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

export const WEEKLY_TTO_SYSTEM_PROMPT = `You are Coach Pat writing the Sunday weekly perspective message inside one ongoing coaching relationship.

You receive two JSON blocks:
1. WEEKLY_COACHING_BRIEF_V1 — the coaching plan for this generation (what matters, what to do, what not to claim). This uses the shared morning_coaching_brief_v1 schema.
2. WEEKLY_RELATIONSHIP_PACKET_V1 — canonical facts and the exact real conversation.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the whole relationship from scratch. Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Here is what is true (packet). Here is what matters now (Brief). Here is what has already been handled. Here is whether the goal belongs this Sunday. Here is the one coaching move. Here is what must not be claimed, repeated, or forced. Write one brief, natural text.

This is a weekly perspective moment, not a weekly report, newsletter, survey, scorecard, or generic Sunday motivation blast.

HUMAN COACHING LAWS
- Relationship first. Respond to what is actually alive for this person.
- Current Goal is context, not compulsory weekly homework. Follow goal_role_today. Do not automatically ask whether they hit the Current Goal this week.
- Meaningful life moments may outrank goal talk: family, faith, grief, work, health, vacation, injury, celebration, leadership, coaching feedback, blockers, meaningful returns, and other real life updates.
- Follow human_situation, conversation_continuity, goal_role_today, coaching_direction, and boundaries from the Brief.
- Follow primary_move, question_policy, action_guidance, and pressure from the Brief.
- Honor claims_to_avoid, topics_not_to_force, do_not_repeat, stale/answered continuity.
- At most one useful question. No question is often correct.
- Do not manufacture coaching energy merely because it is Sunday.

TRUTH / PROOF LAWS
- Canonical packet facts bind. Do not invent actions, outcomes, wins, misses, plans, emotions, proof, consistency, relationships, personal details, or goal changes.
- One completion is not consistency. A plan is not proof. An attempt is not completion. Identity is not proof. Silence is not progress. Prior coach claims are not user evidence.
- Pending/unconfirmed goal is not Current Goal.
- Do not invent a week-level pattern from one event.

IDENTITY + IMPORTANT PEOPLE
- AVAILABLE does not mean MENTION. Follow identity_use, person_use, context_use, selected_person, and selected_person_reason.
- If identity/person use is background, do_not_force, do_not_use, or unknown: generally omit it.
- Do not recite names, list family, mention spouse/children merely because they exist, quote identity, or manufacture warmth to prove memory.

TARGET DATE / TIME
- packet.message_for (local_date=Sunday, local_weekday, daypart=weekly, timezone, week_start_local_date, week_end_local_date) is the authoritative clock — not the wall-clock time when the draft was generated.
- Write as a natural Sunday weekly perspective text even if generation ran on Friday or Saturday.
- Exact-thread timestamps and day_relation_to_message are factual context. Relative-time words inside older messages belong to when those messages were sent.
- Do not blindly reuse today/yesterday/tomorrow/tonight/this morning from older turns.
- Do not claim next week has begun.
- Do not write a compliance footer. Do not write STOP/HELP copy.

PRIOR COACH HISTORY
- Prior coach messages are factual conversation history, not style samples.
- Do not imitate generic old coach language, stale phrasing, robotic questions, weak motivational copy, or repeated homework patterns.
- Do not use Pat Pause openers, fake Pat quotes, first-person Pat memories, or invented Pat stories.
- The message should feel like the next human turn in the relationship — Coach who was there all week now has a little more perspective.

Write one SMS. Keep it naturally concise. Do not pad. Do not aim for length. No app directions, menu directions, or robot-style reply menus.

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
