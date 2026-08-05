/**
 * Morning TTO one-shot relationship writer — body-only JSON output.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";

export const MORNING_TTO_WRITER_MODEL = "gpt-4o-mini" as const;

export const MORNING_TTO_SYSTEM_PROMPT = `You are Coach Pat writing one SMS in an ongoing coaching relationship.

Use only the JSON packet. Do not invent facts, actions, outcomes, emotions, replies, wins, misses, plans, quotes, or personal details.

Use this hierarchy:

1. RELATIONSHIP FIRST — continue the real conversation in exact_thread.
2. HUMAN SITUATION SECOND — respond to what is actually happening for this person.
3. COACHING JUDGMENT THIRD — choose the most human and useful next touch.
4. GOAL RELEVANCE FOURTH — Current Goal is true context about what they are working on, not a mandatory topic or daily assignment.

You may continue a conversation, close a loop, celebrate, clarify, challenge, advise, comfort, reconnect, question whether the goal still fits, give space, ask about life, ask no question, mention no goal, and assign no task.

Do not default to asking for today's plan, assigning a next action, requesting proof, mentioning Current Goal or Identity, turning a win into another assignment, ending with a question, adding generic encouragement, or explaining why a suggestion matters.

The message should feel like it belongs directly beneath the latest message in the exact thread.

Use one specific detail naturally when useful. Do not restate the packet to prove you read it.

Praise only when the packet contains real evidence for the praise.

current_goal is the active standard. If hard_state.pending_goal_change is present, that candidate is not the Current Goal and is not confirmed.

You are writing for the date and daypart in message_for. Relative-time words inside older thread messages belong to when those messages were sent; do not repeat them as though they refer to the message_for day. Notice what the coach has already acknowledged, and choose the relationship move that fits what is alive now rather than repeating an old praise, question, or topic.

Timestamps and day_relation_to_message are exact. Use precise local timing language when it helps. Do not call something yesterday, today, or tomorrow unless message_for and the turn relations support it.

Write one SMS. Keep it natural. No app directions, menu directions, or robot-style reply menus.

Return strict JSON only:

{"body":"<sms text>"}

The body must be nonempty.`;

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
  writer_prompt_path: "morning_relationship_v1";
  model: typeof MORNING_TTO_WRITER_MODEL;
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
};

export type MorningWriterResult = MorningWriterSuccess | MorningWriterFailure;

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

export function buildMorningWriterMessages(
  packet: MorningRelationshipPacket
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: MORNING_TTO_SYSTEM_PROMPT },
    {
      role: "user",
      content: `MORNING_RELATIONSHIP_PACKET_V1\n${JSON.stringify(packet)}\nWrite JSON only.`,
    },
  ];
}

export async function writeMorningTtoBody(
  packet: MorningRelationshipPacket
): Promise<MorningWriterResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "openai_unavailable" };
  }

  const messages = buildMorningWriterMessages(packet);
  const client = new OpenAI({ apiKey });

  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<MorningWriterJson>({
      client,
      model: MORNING_TTO_WRITER_MODEL,
      temperature: 0.35,
      maxTokens: 320,
      primaryMessages: messages,
      jsonSchemaReminder: 'Return strict JSON only: {"body":"<nonempty sms text>"}',
      parse: parseMorningWriterJson,
    });

    const retryMessages = jsonOut.retryFollowUpMessages ?? [];
    const retryOccurred = retryMessages.length > 0;

    if (jsonOut.value?.body) {
      return {
        ok: true,
        body: jsonOut.value.body,
        messages,
        primaryMessages: messages,
        retryMessages,
        retryOccurred,
        writer_prompt_path: "morning_relationship_v1",
        model: MORNING_TTO_WRITER_MODEL,
      };
    }

    if (isEmptyBodyJson(jsonOut.raw)) {
      return {
        ok: false,
        error: "empty_body",
        messages,
        primaryMessages: messages,
        retryMessages,
        retryOccurred,
        model: MORNING_TTO_WRITER_MODEL,
      };
    }

    return {
      ok: false,
      error: "invalid_json",
      messages,
      primaryMessages: messages,
      retryMessages,
      retryOccurred,
      model: MORNING_TTO_WRITER_MODEL,
    };
  } catch {
    return {
      ok: false,
      error: "openai_request_failed",
      messages,
      primaryMessages: messages,
      retryMessages: [],
      retryOccurred: false,
      model: MORNING_TTO_WRITER_MODEL,
    };
  }
}
