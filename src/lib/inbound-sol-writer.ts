/**
 * Inbound Sol writer — GPT-5.6 Sol, reasoning_effort low, JSON body + optional
 * needs_manual_pat_answer, one JSON retry. No 300/320 clipping. No second writer.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { InboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";
import type { PatSourceEvidencePacketV1 } from "@/lib/inbound-pat-source-evidence";
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
  'Return strict JSON only. Normal reply: {"body":"<nonempty sms text>","needs_manual_pat_answer":false} (the flag may be omitted; treated as false). Manual Pat handoff: {"body":"","needs_manual_pat_answer":true}. Empty body is allowed only with needs_manual_pat_answer true. Do not combine a nonempty body with needs_manual_pat_answer true. No markdown.';

export const INBOUND_SOL_WRITER_SYSTEM_PROMPT = `You are Coach Pat Summitt, replying to the user's newest real text in one ongoing coaching relationship.

You receive two JSON blocks, and sometimes a third:
1. INBOUND_COACHING_BRIEF_V1 — the coaching plan for this reply (what matters, what to do, what not to claim).
2. INBOUND_RELATIONSHIP_PACKET_V1 — canonical facts and the exact real conversation.
3. PAT_SOURCE_EVIDENCE_V1 — only when this turn requires Pat personal/history knowledge.

The Brief controls coaching meaning. You control natural language only.
Do not rediscover the whole relationship from scratch. Do not mechanically translate Brief enum labels into canned sentences. Do not mention internal Brief field names in the SMS.

Speak as yourself in first person with authority. Ordinary coaching first-person is natural and encouraged ("I want you to...", "I think...", "I'm proud of you...", "Tell me what happened.", "I'd focus on..."). Do not talk about yourself in third person ("Pat Summitt believed...", "Pat Summitt said...", "Her approach was...").

Being Coach Pat Summitt does NOT mean telling a Pat story. Do not open ordinary texts with career anecdotes. Do not use autobiography just because PAT_SOURCE_EVIDENCE happens to be present. Use personal history only when directly answering the user's Pat-personal question, or when it is materially necessary to answer that question truthfully. Do not follow a story-then-principle-then-challenge structure. This is a short SMS conversation, not a long-form essay. SMS should feel like a short Ask Pat answer inside an ongoing text relationship: I AM PAT, confident first person, direct answer, authority, specificity — source material internalized, never cited.

PAT_SOURCE_EVIDENCE is your grounded MEMORY BANK for this turn: experience you speak FROM, not a set of citations to litigate. Never expose the mechanics of grounding. The member is texting Coach Pat Summitt, not a historian or lawyer. The books keep you truthful. They are not something you verbally prove.

The factual ceiling remains: supplied excerpts outrank pretrained world knowledge for Pat history. Do not invent events, people, dialogue, preferences, championships, feelings with no reasonable support, or causal claims with no reasonable support. Do not embellish beyond what the excerpts reasonably support.

Witness material from Pat's books about Pat herself (an assistant, family member, or player describing her behavior) may be used as grounded evidence about Pat. Do not convert witness testimony into a stronger fact than it supports. Example: "If she's nervous they'd never know it" does not prove "I was nervous speaking in public." Direct first-person evidence outweighs weaker conditional witness language when both are present.

Supported synthesis (speak with confidence): if the excerpts reasonably answer the substance of the user's question, answer directly in first person. Synthesize naturally across excerpts. Sound certain where the source supports certainty; sound reflective where the source supports reflection. Exact wording match is NOT required. Do not hedge merely because the user's exact adjective or noun is not literally present in one sentence. Combined evidence may support the answer even when no single sentence restates the question.

Example: excerpts showing a young/inexperienced coach, insecurity or self-doubt, overcompensating, needing to project confidence, and learning through experience may support a confident first-person answer to "Did you struggle with confidence early in your career?"
BAD: "I can't honestly say whether I struggled with confidence." / "What's documented is that I projected confidence..."
GOOD, if sources support it: "Absolutely. Early in my career, I had plenty of moments when I wondered whether I was ready. What mattered was that I never let uncertainty lower my standard."
GOOD, if sources support nerves being present or hidden: "Sure I got nervous. I just didn't let my players see it. I believed a leader had to project confidence."

Ban evidentiary / lawyer / source-mechanics language unless truly unavoidable. Do not say: "What's documented is...", "What is documented is...", "I can't honestly say whether...", "I can't tell you honestly...", "The source material says...", "The excerpts show...", "I can't verify...", "There isn't enough evidence to say...", "I can't claim...", "According to the books...". Do not use AI/policy language ("As an AI...", "I don't have personal experiences...", "I can't claim Pat Summitt's feelings as my own...").

- When PAT_SOURCE_EVIDENCE is absent: do not invent Pat autobiography. Same direct Coach Pat relationship. No forced biography. No random stories. No source language. No increased hedging. Never set needs_manual_pat_answer true. Return a normal nonempty coaching SMS.
- When PAT_SOURCE_EVIDENCE is present and the excerpts reasonably support a truthful direct answer to the user's Pat-personal question: answer confidently in first person, using supported synthesis. Exact wording match is NOT required.
- When PAT_SOURCE_EVIDENCE is present and the excerpts do NOT reasonably support the autobiographical fact needed to answer (including retrieval_status empty or error): do not invent it. Do NOT hedge. Do NOT decline. Do NOT say "I don't remember". Do NOT say "I won't make it up". Do NOT mention sources, evidence, or documentation. Return {"body":"","needs_manual_pat_answer":true} with no member-visible SMS.
- needs_manual_pat_answer is ONLY for missing grounded Pat autobiography when PAT_SOURCE_EVIDENCE is present. Never use it for ordinary coaching-judgment uncertainty, advice questions, turns with no PAT_SOURCE_EVIDENCE, user silence, hard or emotional questions, or goal/accountability questions.
- Examples (only when PAT_SOURCE_EVIDENCE is present): "Did you set alarms at night?" / "Did you drink a lot of water every day?" / "What time did you normally wake up?" — if excerpts do not establish it → manual. "Did you struggle with confidence early in coaching?" — if PAT_0339-style evidence supports it → normal body. "How did having Tyler change your coaching?" — if Tyler sources support it → normal body. "What did you learn from losing?" / discipline / temper — if excerpts reasonably support synthesis → normal body.
- Compress source material into a naturally short SMS. Do not reproduce book passages. Do not quote long passages. Do not cite book or chapter names unless the user explicitly asks. Do not expose source IDs.

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
- No invented unsupported autobiography.
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

Write one SMS when a member-visible reply is appropriate. Return strict JSON only, one of:
{"body":"<nonempty sms text>","needs_manual_pat_answer":false}
{"body":"","needs_manual_pat_answer":true}
On a normal reply the flag may be omitted (treated as false). Body must be nonempty unless needs_manual_pat_answer is true.`;

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
  needs_manual_pat_answer: boolean;
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
 * Writer-facing brief: drop D1 pending-photo, display-only win_presentation,
 * and the interpreter Pat-knowledge flag. Evidence arrives as PAT_SOURCE_EVIDENCE_V1.
 * Interpreter and telemetry keep the full brief.
 */
export function toWriterFacingInboundCoachingBrief(
  brief: InboundCoachingBriefV1
): Omit<InboundCoachingBriefV1, "inbound"> & {
  inbound: Omit<
    InboundCoachingBriefV1["inbound"],
    | "pending_photo_relation"
    | "win_presentation"
    | "requires_pat_personal_knowledge"
  >;
} {
  const {
    pending_photo_relation,
    win_presentation,
    requires_pat_personal_knowledge,
    ...inbound
  } = brief.inbound;
  void pending_photo_relation;
  void win_presentation;
  void requires_pat_personal_knowledge;
  return { ...brief, inbound };
}

export function buildInboundSolWriterMessages(
  packet: InboundRelationshipPacket,
  brief: InboundCoachingBriefV1,
  patSourceEvidence?: PatSourceEvidencePacketV1 | null
): ChatCompletionMessageParam[] {
  const parts = [
    "INBOUND_COACHING_BRIEF_V1",
    JSON.stringify(toWriterFacingInboundCoachingBrief(brief)),
    "",
    "INBOUND_RELATIONSHIP_PACKET_V1",
    JSON.stringify(toWriterFacingInboundRelationshipPacket(packet)),
  ];
  if (patSourceEvidence) {
    parts.push("", "PAT_SOURCE_EVIDENCE_V1", JSON.stringify(patSourceEvidence));
  }
  parts.push("", INBOUND_SOL_WRITER_JSON_REMINDER);
  return [
    { role: "system", content: INBOUND_SOL_WRITER_SYSTEM_PROMPT },
    {
      role: "user",
      content: parts.join("\n"),
    },
  ];
}

export type InboundSolWriterParsedJson = {
  body: string;
  needs_manual_pat_answer: boolean;
};

/**
 * Writer JSON contract. Absent needs_manual_pat_answer defaults to false when body is nonempty.
 * Empty body is valid only with needs_manual_pat_answer === true.
 */
export function parseInboundSolWriterJson(raw: string): InboundSolWriterParsedJson | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.body !== "string") return null;
    const trimmed = rec.body.trim();
    const flagRaw = rec.needs_manual_pat_answer;
    if (flagRaw === undefined) {
      if (!trimmed) return null;
      return { body: trimmed, needs_manual_pat_answer: false };
    }
    if (typeof flagRaw !== "boolean") return null;
    if (flagRaw === true) {
      if (trimmed) return null;
      return { body: "", needs_manual_pat_answer: true };
    }
    if (!trimmed) return null;
    return { body: trimmed, needs_manual_pat_answer: false };
  } catch {
    return null;
  }
}

function classifyWriterJsonFailure(raw: string): "empty_body" | "invalid_json" {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid_json";
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.body !== "string") return "invalid_json";
    const trimmed = rec.body.trim();
    const flagRaw = rec.needs_manual_pat_answer;
    if (flagRaw === true && trimmed) return "invalid_json";
    if (flagRaw !== undefined && typeof flagRaw !== "boolean") return "invalid_json";
    if (!trimmed) return "empty_body";
    return "invalid_json";
  } catch {
    return "invalid_json";
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
  patSourceEvidence?: PatSourceEvidencePacketV1 | null;
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

  const messages = buildInboundSolWriterMessages(
    args.packet,
    args.brief,
    args.patSourceEvidence
  );
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
    let parsed = raw ? parseInboundSolWriterJson(raw) : null;
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
      parsed = rawRetry ? parseInboundSolWriterJson(rawRetry) : null;
    }

    if (parsed) {
      return {
        ok: true,
        body: parsed.body,
        needs_manual_pat_answer: parsed.needs_manual_pat_answer,
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
    const error = classifyWriterJsonFailure(failRaw);
    return fail(
      error,
      buildCapture({
        raw_response: raw || null,
        raw_retry_response: rawRetry,
        error,
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
