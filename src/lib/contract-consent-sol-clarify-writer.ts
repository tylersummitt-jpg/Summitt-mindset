/**
 * Isolated Sol writer for the exclusive ambiguous overlay-consent clarification lane.
 * Server already knows the inbound is not a clear YES/NO and the proposal is still pending.
 * This writes one clarification SMS. It does not decide consent or mutate overlay state.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AdaptiveConsentClarificationInboundParse } from "@/lib/v2-adaptive-proposal-ambiguous-consent-gate";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";

export const CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL = "gpt-5.6-sol" as const;
export const CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT = "low" as const;
export const CONTRACT_CONSENT_SOL_CLARIFY_WRITER_TEMPERATURE = null;
export const CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MAX_COMPLETION_TOKENS = 1200 as const;
export const CONTRACT_CONSENT_SOL_CLARIFY_WRITER_PROMPT_PATH =
  "contract_consent_sol_clarify_writer_v1" as const;

export const CONTRACT_CONSENT_SOL_CLARIFY_JSON_REMINDER =
  'Return strict JSON only: {"body":"<nonempty sms text>"}. No other keys. No markdown.';

export const CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT = `You are Coach Pat writing ONE outbound SMS that asks for a clear decision on a pending proposed adjustment.

The server already determined:
- a proposed adjustment is still pending
- the member did not clearly accept or decline it
- no overlay, Current Goal, identity, or commitment state has changed

You do not decide meaning or state. You write natural language only.

Laws:
- Answer the immediate consent-clarification interaction only.
- Sound like Coach Pat in an ongoing relationship — short, human, direct.
- Make it clear the current bar has not changed yet.
- Ask at most one clear question: do they want the adjusted ask, or keep the current bar.
- You may naturally use the words yes or no in that question. Do not use robot Reply YES / Reply NO / text YES menus or phone-tree phrasing.
- Do not imply the proposal was accepted or declined.
- Do not create a new proposal or invent new terms.
- Do not pivot into Current Goal coaching, pep talks, or unrelated life content.
- Do not claim future messaging cadence or check-ins the system does not actually control.
- Do not use internal jargon: overlay, RPC, mutation, contract proposal, adaptive overlay, pending resolution, Victory Room.
- Do not quote Pat Summitt or invent quotes.
- Honor required_meaning.

Write one SMS. Return strict JSON only:
{"body":"<sms text>"}
The body must be nonempty. No other keys.`;

export type ContractConsentSolClarifyWriterCapture = {
  model: typeof CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL;
  temperature: null;
  reasoning_effort: typeof CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT;
  prompt_path: typeof CONTRACT_CONSENT_SOL_CLARIFY_WRITER_PROMPT_PATH;
  raw_response: string | null;
  raw_retry_response: string | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type ContractConsentSolClarifyWriterSuccess = {
  ok: true;
  body: string;
  capture: ContractConsentSolClarifyWriterCapture;
};

export type ContractConsentSolClarifyWriterFailure = {
  ok: false;
  body: null;
  error: "openai_unavailable" | "openai_request_failed" | "invalid_json" | "empty_body";
  capture: ContractConsentSolClarifyWriterCapture;
};

export type ContractConsentSolClarifyWriterResult =
  | ContractConsentSolClarifyWriterSuccess
  | ContractConsentSolClarifyWriterFailure;

export type ContractConsentSolClarifyWriterInput = {
  inboundRaw: string;
  proposalText: string;
  currentBar: string;
  inboundParse: AdaptiveConsentClarificationInboundParse;
  preferredName: string | null;
  requiredMeaning: string;
  latestOutboundBody: string | null;
};

export function buildContractConsentSolClarifyUserPrompt(
  args: ContractConsentSolClarifyWriterInput
): string {
  return [
    "Write the SMS body only.",
    "Clarification facts (do not paste field names into the SMS):",
    JSON.stringify(
      {
        proposal_still_pending: true,
        server_action_taken: "none",
        inbound_parse: args.inboundParse,
        preferred_name: args.preferredName,
        proposed_adjustment: args.proposalText,
        current_bar: args.currentBar,
        latest_inbound_text: args.inboundRaw,
        latest_outbound_preview: args.latestOutboundBody,
        required_meaning: args.requiredMeaning,
      },
      null,
      0
    ),
    "Required meaning: the proposed adjustment is still pending. Do not treat this inbound as a decision. Ask whether they want the adjusted ask or to keep the current bar.",
    CONTRACT_CONSENT_SOL_CLARIFY_JSON_REMINDER,
  ].join("\n");
}

export function buildContractConsentSolClarifyWriterMessages(
  args: ContractConsentSolClarifyWriterInput
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT },
    { role: "user", content: buildContractConsentSolClarifyUserPrompt(args) },
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
}): ContractConsentSolClarifyWriterCapture {
  return {
    model: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL,
    temperature: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_TEMPERATURE,
    reasoning_effort: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT,
    prompt_path: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_PROMPT_PATH,
    raw_response: args.raw_response,
    raw_retry_response: args.raw_retry_response,
    error: args.error,
    openai_error: args.openai_error ?? null,
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

const RETRY_FOLLOW_UP_USER = `Your previous response was invalid JSON or did not parse. ${CONTRACT_CONSENT_SOL_CLARIFY_JSON_REMINDER}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON. Do not change coaching content — fix format only.`;

export async function writeContractConsentSolClarifyBody(args: {
  input: ContractConsentSolClarifyWriterInput;
  client?: OpenAI | null;
}): Promise<ContractConsentSolClarifyWriterResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    args.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : args.client;

  const fail = (
    error: ContractConsentSolClarifyWriterFailure["error"],
    capture: ContractConsentSolClarifyWriterCapture
  ): ContractConsentSolClarifyWriterFailure => ({
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

  const messages = buildContractConsentSolClarifyWriterMessages(args.input);
  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL,
      reasoning_effort: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT,
      max_completion_tokens: CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MAX_COMPLETION_TOKENS,
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
