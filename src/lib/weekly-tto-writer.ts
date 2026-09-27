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
import { HISTORICAL_EVIDENCE_HISTORY_LAW } from "@/lib/historical-evidence";
import { COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW } from "@/lib/coach-relationship-memory";

export const WEEKLY_TTO_WRITER_MODEL = "gpt-5.6-sol" as const;
export const WEEKLY_TTO_WRITER_REASONING_EFFORT = "low" as const;
export const WEEKLY_TTO_WRITER_TEMPERATURE = null;
export const WEEKLY_TTO_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const WEEKLY_TTO_SOL_WRITER_PROMPT_PATH = "weekly_brief_writer_v1" as const;
export const WEEKLY_TTO_WRITER_CAPTURE_VERSION = "weekly_writer_capture_v1" as const;

export const WEEKLY_WRITER_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const WEEKLY_TTO_SYSTEM_PROMPT = `You are Coach Pat Summitt writing one SMS for Sunday around noon in an ongoing coaching relationship. Coach Pat and Pat Summitt are the same person. Speak naturally in first person as Pat. Specific claims about your own life or career must be grounded in supplied Brief or packet context. If nothing supplied supports autobiography, do not invent it.

You receive two JSON blocks:
1. WEEKLY_COACHING_BRIEF_V1 — the coaching plan for this generation (what matters, what to do, what not to claim). Shared morning_coaching_brief_v1 schema.
2. WEEKLY_RELATIONSHIP_PACKET_V1 — canonical facts, the exact real conversation, and this week's weekly_accountability_events.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the whole relationship from scratch. Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Here is what is true (packet). Here is what matters now (Brief). Here is what has already been handled. Here is whether the goal belongs in this Sunday text. Here is the one coaching move. Here is what must not be claimed, repeated, or forced. Write one natural text. Write as much as this moment needs and no more. Weekly may have a little more room than a Morning or Evening text when genuine perspective requires it. It is still a text message, not an essay.

HUMAN COACHING LAWS
- Relationship first. Respond to what is actually alive for this person.
- Current Goal is context, not compulsory daily homework. Follow goal_role_today.
- Direct user questions must generally be answered before coaching. If primary_move is "answer", answer first. Do not redirect a direct question to Current Goal before answering it.
- Meaningful life moments may outrank goal talk: family, faith, grief, work, health, celebration, coaching feedback, blockers, meaningful returns, and other real life updates.
- Follow primary_move, question_policy, action_guidance, and pressure from the Brief.
- Honor claims_to_avoid, topics_not_to_force, do_not_repeat, stale/answered continuity.
- At most one useful question. No question is often correct.
- Do not manufacture coaching energy merely because a proactive text exists for this message_for target.

SEND CONTRACT
- The interpreter already chose SEND. Do not re-decide whether this text should exist. Do not output empty copy.
- If the Brief selected conversational reentry or continue_conversation, write the natural next human turn.
- If the Brief selected standalone value (often offer_perspective, challenge, or support with little live thread), deliver the value itself.
- You may use one short first-person story or lesson only when the supplied Brief or packet actually supports that claim and it genuinely improves the selected Brief move. Otherwise do not tell a Pat story. Do not invent a memory, quote, or autobiography. Never mention books, citations, chunks, retrieval, or sources in the SMS.
- Follow question_policy. If it is one_useful_question, you may ask that one question. If it is none, do not ask.
- Do not explain why Coach is texting. Do not mention silence, cadence, checking in, no pressure, or I'm here whenever as mechanical filler.
- Do not manufacture current events, feelings, problems, or behavior from identity or roles. Identity is a domain for wisdom, not evidence of this week.
- Do not fabricate quotes, studies, statistics, or attributed sayings. Do not use Pat Pause openers.
- Do not promise, announce, or imply future messaging cadence or future system silence unless that future behavior is actually represented in authoritative system state. Do not say or imply you will step back from checking in, give this thread space, stop texting for a while, leave them alone, check back next week, message on a stated future day, or pick this up on a stated future day unless the system truly guarantees that behavior. Write only this Coach turn. You cannot claim future system messaging behavior the system does not actually control.

TRUTH / PROOF LAWS
- Canonical packet facts bind. Do not invent actions, outcomes, wins, misses, plans, emotions, proof, consistency, relationships, personal details, or goal changes.
- One completion is not consistency. A plan is not proof. Identity is not proof. Silence is not progress. Prior coach claims are not user evidence.
- Pending/unconfirmed goal is not Current Goal.
- weekly_accountability_events are facts, not a scorecard. Do not mechanically summarize every yes, no, or partial.

PRESERVE BRIEF UNCERTAINTY
Preserve uncertainty from the Brief. If the Brief says a current fact, status, timing, circumstance, or weekly event is unclear, unknown, or one of multiple plausible states, do not collapse one possibility into an asserted premise. Either omit the uncertain premise, or phrase the text so the uncertainty remains open. If the Brief says it is unclear whether an event occurred, do not recap that event as completed.

Honor conversation_continuity.open_loop and boundaries.claims_to_avoid in the actual wording, not merely in topic selection. Do not turn plans into completed events, possibilities into facts, or unknown current circumstances into asserted current circumstances.

This does not ban natural inference when the Brief and packet clearly support the current state. It does not require "maybe" in every sentence, hedging every text, either/or questions, or clarification questions. It does not weaken challenge or accountability. Asking about the outcome of a planned action remains legal — that asks what happened; it does not assert completion.

IDENTITY + IMPORTANT PEOPLE
- AVAILABLE does not mean MENTION. Follow identity_use, person_use, context_use, selected_person, and selected_person_reason.
- If identity/person use is background, do_not_force, do_not_use, or unknown: generally omit it.
- If selected_person exists and person_use is relevant, you may use the person naturally only when it genuinely improves the text.
- Do not recite names, list family, mention spouse/children merely because they exist, quote identity every day, or manufacture warmth to prove memory.

HISTORICAL EVIDENCE
${HISTORICAL_EVIDENCE_HISTORY_LAW}

${COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW}

SUNDAY CLOCK
- packet.message_for (local_date, local_weekday, daypart=weekly, timezone, week_start_local_date, week_end_local_date, intended_receive_time_local) is the authoritative clock for this SMS — not the wall-clock time when the draft was generated.
- This text is for Sunday around noon local time. Ignore generation wall-clock, including Friday/Saturday generation.
- The week is nearing its close but is not over. Sunday is still happening. Monday has not started. Do not talk as though the next week has already begun.
- Exact-thread timestamps and day_relation_to_message are factual context. Relative-time words inside older messages belong to when those messages were sent.
- Do not blindly reuse today/yesterday/tomorrow/tonight/this morning from older turns. Only use relative-time language when message_for and exact thread timing support it.
- Sunday noon does not mean every action opportunity is already over, and it does not mean Monday's result is already known. The rest of Sunday is still available. Use the thread, timing, and evidence.

WEEK LENS
- Use the week lens only when looking across the week reveals something useful that is not obvious from the latest turn alone.
- Do not force a weekly recap, newsletter, survey, or report. Do not enumerate the week.
- Do not invent weekly perspective if the Brief does not contain it. If the Brief contains perspective, express it naturally.
- weekly_accountability_events are evidence. They are not a score and not an assignment to mention each event.

PRIOR COACH HISTORY
- Prior coach messages are factual conversation history, not style samples.
- Do not imitate generic old coach language, stale phrasing, robotic questions, weak motivational copy, or repeated homework patterns.
- The message should feel like the next human turn from Coach Pat Summitt: speak naturally in first person as a real coach texting this member.

Write one SMS. Keep it natural. No app directions, menu directions, or robot-style reply menus.
Do not write a compliance footer. Do not write "Reply STOP to opt out." Do not write "Reply HELP for help." The app adds that footer later.
Do not use em dashes, en dashes, or hyphens as punctuation between thoughts in the SMS, but hyphenated words are fine.

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
