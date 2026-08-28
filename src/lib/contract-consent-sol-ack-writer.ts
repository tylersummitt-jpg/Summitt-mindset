/**
 * Isolated Sol writer for the exclusive contract-consent ack lane.
 * Server already owns consent meaning and overlay mutation; this writes one SMS body.
 * Not the inbound relationship interpreter/writer turn.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ContractConsentAckIntent } from "@/lib/v2-contract-consent-ack-send";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";

export const CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL = "gpt-5.6-sol" as const;
export const CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT = "low" as const;
export const CONTRACT_CONSENT_SOL_ACK_WRITER_TEMPERATURE = null;
export const CONTRACT_CONSENT_SOL_ACK_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const CONTRACT_CONSENT_SOL_ACK_WRITER_PROMPT_PATH =
  "contract_consent_sol_ack_writer_v1" as const;

export const CONTRACT_CONSENT_SOL_ACK_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT = `You are Coach Pat writing ONE outbound SMS that acknowledges a consent decision the server already recorded.

You do not decide meaning or state. You write natural language only.

Laws:
- Answer the immediate consent interaction only.
- Sound like Coach Pat in an ongoing relationship — short, human, direct.
- Do not pivot into Current Goal or unrelated coaching.
- Do not add extra coaching, pep talks, or a next-step plan beyond the consent result.
- Do not ask a question unless the facts require a clarification you cannot already satisfy. Usually ask none.
- Do not claim future messaging cadence, silence, or check-ins the system does not actually control.
- Do not invent overlay terms, new commitments, proof, streaks, or emotions.
- Do not use internal jargon: overlay, RPC, mutation, contract proposal, adaptive overlay, pending resolution, Victory Room.
- Do not use Reply YES / Reply NO / text YES menus or phone-tree phrasing.
- Do not quote Pat Summitt or invent quotes.
- Do not re-ask YES/NO or invent new terms.
- If optional_binding_hint is set, include that exact substring in the SMS.
- Honor required_meaning.

Write one SMS. Return strict JSON only:
{"body":"<sms text>"}
The body must be nonempty. No other keys.`;

export type ContractConsentSolAckWriterCapture = {
  model: typeof CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL;
  temperature: null;
  reasoning_effort: typeof CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT;
  prompt_path: typeof CONTRACT_CONSENT_SOL_ACK_WRITER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type ContractConsentSolAckWriterSuccess = {
  ok: true;
  body: string;
  capture: ContractConsentSolAckWriterCapture;
};

export type ContractConsentSolAckWriterFailure = {
  ok: false;
  body: null;
  error: "openai_unavailable" | "openai_request_failed" | "invalid_json" | "empty_body";
  capture: ContractConsentSolAckWriterCapture;
};

export type ContractConsentSolAckWriterResult =
  | ContractConsentSolAckWriterSuccess
  | ContractConsentSolAckWriterFailure;

export function buildContractConsentSolAckUserPrompt(args: {
  intent: ContractConsentAckIntent;
  inboundRaw: string;
  latestOutboundBody: string | null;
}): string {
  const { intent } = args;
  return [
    "Write the SMS body only.",
    "Consent decision facts (do not paste field names into the SMS):",
    JSON.stringify(
      {
        user_said: intent.consent_parse === "user_yes" ? "yes" : "no",
        overlay_action: intent.overlay_action,
        rpc_result: intent.rpc_result,
        contract_kind: intent.contract_kind,
        proposal_digest: intent.proposal_text_digest,
        effective_ask: intent.effective_ask,
        behavior_statement: intent.behavior_statement,
        required_meaning: intent.required_meaning_summary,
        optional_binding_hint: intent.optional_binding_hint,
        latest_inbound_text: args.inboundRaw,
        latest_outbound_preview: args.latestOutboundBody,
      },
      null,
      0
    ),
    intent.consent_parse === "user_yes"
      ? "Required meaning: acknowledge their yes; confirm the standard/commitment is held for the next 7 days when overlay was activated. Do not claim a fresh activation when overlay_action is noop_already_applied, noop_not_found, or noop_state_conflict."
      : "Required meaning: acknowledge their no; the proposed adjustment is not applied; current written commitment remains the anchor. Do not imply acceptance.",
    intent.legacy_meaning_anchor_preview
      ? `Internal meaning anchor (NON-SPEAKABLE — do NOT copy verbatim): ${intent.legacy_meaning_anchor_preview}`
      : "",
    CONTRACT_CONSENT_SOL_ACK_JSON_REMINDER,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContractConsentSolAckWriterMessages(args: {
  intent: ContractConsentAckIntent;
  inboundRaw: string;
  latestOutboundBody: string | null;
}): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildContractConsentSolAckUserPrompt(args),
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
}): ContractConsentSolAckWriterCapture {
  return {
    model: CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL,
    temperature: CONTRACT_CONSENT_SOL_ACK_WRITER_TEMPERATURE,
    reasoning_effort: CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT,
    prompt_path: CONTRACT_CONSENT_SOL_ACK_WRITER_PROMPT_PATH,
    raw_response: args.raw_response,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

const RETRY_FOLLOW_UP_USER = `Your previous response was invalid JSON or did not parse. ${CONTRACT_CONSENT_SOL_ACK_JSON_REMINDER}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON. Do not change coaching content — fix format only.`;

export async function writeContractConsentSolAckBody(args: {
  intent: ContractConsentAckIntent;
  inboundRaw: string;
  latestOutboundBody: string | null;
  client?: OpenAI | null;
}): Promise<ContractConsentSolAckWriterResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    args.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : args.client;

  const fail = (
    error: ContractConsentSolAckWriterFailure["error"],
    capture: ContractConsentSolAckWriterCapture
  ): ContractConsentSolAckWriterFailure => ({
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

  const messages = buildContractConsentSolAckWriterMessages({
    intent: args.intent,
    inboundRaw: args.inboundRaw,
    latestOutboundBody: args.latestOutboundBody,
  });
  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL,
      reasoning_effort: CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT,
      max_completion_tokens: CONTRACT_CONSENT_SOL_ACK_WRITER_MAX_COMPLETION_TOKENS,
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
