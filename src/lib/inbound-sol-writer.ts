/**
 * Inbound Sol writer — GPT-5.6 Sol, reasoning_effort low, body-only JSON, one JSON retry.
 * No 300/320 clipping. No second writer.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { InboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
import { HISTORICAL_EVIDENCE_HISTORY_LAW } from "@/lib/historical-evidence";

export const INBOUND_SOL_WRITER_MODEL = "gpt-5.6-sol" as const;
export const INBOUND_SOL_WRITER_REASONING_EFFORT = "low" as const;
export const INBOUND_SOL_WRITER_TEMPERATURE = null;
export const INBOUND_SOL_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const INBOUND_SOL_WRITER_PROMPT_PATH = "inbound_sol_writer_v1" as const;

export const INBOUND_SOL_WRITER_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const INBOUND_SOL_WRITER_SYSTEM_PROMPT = `You are replying to the user's newest real text in one ongoing Coach Pat relationship.

You receive two JSON blocks:
1. INBOUND_COACHING_BRIEF_V1 — the coaching plan for this reply (what matters, what to do, what not to claim).
2. INBOUND_RELATIONSHIP_PACKET_V1 — canonical facts and the exact real conversation.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the whole relationship from scratch. Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Writer law:
- Relationship first.
- Reply to the user's newest real text (packet.latest_inbound_text). Do not answer a stale earlier topic instead.
- Answer a direct question first when answer_priority is first or primary_move is answer. Do not redirect to Current Goal before answering.
- Follow goal_role_today. Current Goal is context, not compulsory.
- A human moment may outrank goal.
- Honor already_acknowledged, answered_question, do_not_repeat, stale_or_exhausted_topics.
- At most one useful question. Often none.
- If user_is_correcting_coach is true: accept the correction. Do not defend a stale interpretation.
- Product/admin questions: answer honestly from available Brief/context. Do not force accountability.
- Keep naturally short by judgment only. Do not pad. Do not clip to a character budget.

Forbidden:
- No fake Pat quotes.
- No invented Pat first-person memory.
- No invented facts, emotions, proof, consistency, or goal changes.
- No robot Reply YES/NO instructions.
- No app-menu instructions.
- No unsupported live search claims.
- Do not claim a photo or picture was saved, attached, added, or stored.
- Do not repeatedly paraphrase an already-understood request.
- Do not ask how to help after help was already requested.
- Prior Coach messages are factual conversation history, NOT style examples.

HISTORICAL EVIDENCE
${HISTORICAL_EVIDENCE_HISTORY_LAW}

Write one SMS. Return strict JSON only:
{"body":"<sms text>"}
The body must be nonempty. No other keys.`;

export type InboundSolWriterCapture = {
  model: typeof INBOUND_SOL_WRITER_MODEL;
  temperature: null;
  reasoning_effort: typeof INBOUND_SOL_WRITER_REASONING_EFFORT;
  prompt_path: typeof INBOUND_SOL_WRITER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type InboundSolWriterSuccess = {
  ok: true;
  body: string;
  capture: InboundSolWriterCapture;
};

export type InboundSolWriterFailure = {
  ok: false;
  body: null;
  error: "openai_unavailable" | "openai_request_failed" | "invalid_json" | "empty_body";
  capture: InboundSolWriterCapture;
};

export type InboundSolWriterResult = InboundSolWriterSuccess | InboundSolWriterFailure;

/**
 * Writer-facing packet: drop D1 pending-photo facts.
 * Interpreter and the claim scheduler keep the full packet.
 */
export function toWriterFacingInboundRelationshipPacket(
  packet: InboundRelationshipPacket
): Omit<InboundRelationshipPacket, "pending_media_context"> {
  const { pending_media_context, ...rest } = packet;
  void pending_media_context;
  return rest;
}

/**
 * Writer-facing brief: drop D1 pending_photo_relation.
 * Interpreter and the claim scheduler keep the full brief.
 */
export function toWriterFacingInboundCoachingBrief(
  brief: InboundCoachingBriefV1
): Omit<InboundCoachingBriefV1, "inbound"> & {
  inbound: Omit<InboundCoachingBriefV1["inbound"], "pending_photo_relation">;
} {
  const { pending_photo_relation, ...inbound } = brief.inbound;
  void pending_photo_relation;
  return { ...brief, inbound };
}

export function buildInboundSolWriterMessages(
  packet: InboundRelationshipPacket,
  brief: InboundCoachingBriefV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: INBOUND_SOL_WRITER_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "INBOUND_COACHING_BRIEF_V1",
        JSON.stringify(toWriterFacingInboundCoachingBrief(brief)),
        "",
        "INBOUND_RELATIONSHIP_PACKET_V1",
        JSON.stringify(toWriterFacingInboundRelationshipPacket(packet)),
        "",
        INBOUND_SOL_WRITER_JSON_REMINDER,
      ].join("\n"),
    },
  ];
}

function parseWriterJson(raw: string): { body: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const body = (parsed as { body?: unknown }).body;
    if (typeof body !== "string") return null;
    const trimmed = body.trim();
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
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
}): InboundSolWriterCapture {
  return {
    model: INBOUND_SOL_WRITER_MODEL,
    temperature: INBOUND_SOL_WRITER_TEMPERATURE,
    reasoning_effort: INBOUND_SOL_WRITER_REASONING_EFFORT,
    prompt_path: INBOUND_SOL_WRITER_PROMPT_PATH,
    raw_response: args.raw_response,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

const RETRY_FOLLOW_UP_USER = `Your previous response was invalid JSON or did not parse. ${INBOUND_SOL_WRITER_JSON_REMINDER}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON. Do not change coaching content — fix format only.`;

export async function writeInboundSolBody(args: {
  packet: InboundRelationshipPacket;
  brief: InboundCoachingBriefV1;
  client?: OpenAI | null;
}): Promise<InboundSolWriterResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    args.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : args.client;

  const fail = (
    error: InboundSolWriterFailure["error"],
    capture: InboundSolWriterCapture
  ): InboundSolWriterFailure => ({
    ok: false,
    body: null,
    error,
    capture,
  });

  if (!client) {
    return fail(
      "openai_unavailable",
      buildCapture({
        raw_response: null,
        raw_retry_response: null,
        error: "openai_unavailable",
        retry_occurred: false,
        retry_succeeded: null,
      })
    );
  }

  const messages = buildInboundSolWriterMessages(args.packet, args.brief);
  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: INBOUND_SOL_WRITER_MODEL,
      reasoning_effort: INBOUND_SOL_WRITER_REASONING_EFFORT,
      max_completion_tokens: INBOUND_SOL_WRITER_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
      messages: msgs,
    });

  try {
    const first = await solCreate(messages);
    const raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseWriterJson(raw) : null;
    let rawRetry: string | null = null;
    let retryOccurred = false;

    if (!parsed) {
      retryOccurred = true;
      const retryMessages: ChatCompletionMessageParam[] = [
        { role: "assistant", content: raw.slice(0, 8000) },
        { role: "user", content: RETRY_FOLLOW_UP_USER },
      ];
      const second = await solCreate([...messages, ...retryMessages]);
      rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
      parsed = rawRetry ? parseWriterJson(rawRetry) : null;
    }

    if (parsed?.body) {
      return {
        ok: true,
        body: parsed.body,
        capture: buildCapture({
          raw_response: raw || null,
          raw_retry_response: rawRetry,
          error: null,
          retry_occurred: retryOccurred,
          retry_succeeded: retryOccurred ? true : null,
        }),
      };
    }

    const failRaw = rawRetry ?? raw;
    const empty = isEmptyBodyJson(failRaw) || isEmptyBodyJson(raw);
    return fail(
      empty ? "empty_body" : "invalid_json",
      buildCapture({
        raw_response: raw || null,
        raw_retry_response: rawRetry,
        error: empty ? "empty_body" : "invalid_json",
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? false : null,
      })
    );
  } catch (err) {
    return fail(
      "openai_request_failed",
      buildCapture({
        raw_response: null,
        raw_retry_response: null,
        error: "openai_request_failed",
        openai_error: scrubOpenAiRequestErrorForCapture(err),
        retry_occurred: false,
        retry_succeeded: null,
      })
    );
  }
}
