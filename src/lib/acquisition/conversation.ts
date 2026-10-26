/**
 * One acquisition conversation interpreter.
 * The model returns a decision and an optional draft. It does not write to
 * Supabase and it does not call an email provider.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { resourceLabels, type AcquisitionFileKey } from "@/lib/acquisition/assets";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import { scrubOpenAiRequestErrorForCapture } from "@/lib/openai-request-error-scrub";

export const ACQUISITION_CONVERSATION_MODEL = "gpt-5.6-sol" as const;
export const ACQUISITION_CONVERSATION_OUTCOMES = [
  "accept_offer",
  "ask_question",
  "referral",
  "offer_decline",
  "unsubscribe",
  "complaint",
  "ambiguous",
  "needs_human",
] as const;

export type ConversationOutcome = (typeof ACQUISITION_CONVERSATION_OUTCOMES)[number];

export const ACQUISITION_CONVERSATION_FACTS = {
  product: "Summitt Mindset",
  trial: "$0 due today, then a 7-day free trial",
  monthly: "$29/month after the 7-day free trial",
  annual: "$249/year after the 7-day free trial",
  cancel: MEMBERSHIP_PUBLIC_OFFER.cancel,
} as const;

/** Fields a later /admin/distribution read can count. Person-level trial and paid rows are not journey causation. */
export const ACQUISITION_CONVERSATION_MEASUREMENT = {
  messages: [
    "direction",
    "provider",
    "provider_message_id",
    "person_id",
    "journey_id",
    "campaign_id",
    "occurred_at",
    "processing_status",
    "processing_error",
    "ai_outcome",
    "draft_body",
    "effect_applied_at",
    "provider_status_code",
    "provider_response_id",
  ],
  events: ["event_type", "person_id", "campaign_id", "journey_id", "occurred_at"],
  actions: ["action_type", "status", "journey_id", "person_id", "idempotency_key", "promised_offer_key", "promised_assets"],
  attribution:
    "trial_started and paid_member events join on person_id. That match does not prove a message or journey caused the subscription.",
} as const;

export type ConversationInterpreterInput = {
  person: {
    first_name: string | null;
    role: string | null;
    sport: string | null;
    geography: string | null;
    lifecycle: string;
  };
  campaign_id: string | null;
  journey_id: string | null;
  offer: { label: string | null; resources: string[] } | null;
  facts: typeof ACQUISITION_CONVERSATION_FACTS;
  history: Array<{ direction: "inbound" | "outbound"; body: string; occurred_at: string; body_complete: boolean }>;
  fulfillment: Array<{ action_type: string; status: string; label: string | null }>;
  message: { subject: string | null; body: string; occurred_at: string };
};

export type ParsedConversation = {
  outcome: ConversationOutcome;
  reason: string;
  draftSubject: string | null;
  draftBody: string | null;
  draftRejected: boolean;
  acceptedResource: string | null;
};

const OUTCOME_SET = new Set<string>(ACQUISITION_CONVERSATION_OUTCOMES);

export const ACQUISITION_CONVERSATION_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "acquisition_conversation_v1",
    strict: true as const,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: { type: "string", enum: [...ACQUISITION_CONVERSATION_OUTCOMES] },
        reason: { type: "string" },
        draft_subject: { type: ["string", "null"] },
        draft_body: { type: ["string", "null"] },
        accepted_resource: { type: ["string", "null"] },
      },
      required: ["outcome", "reason", "draft_subject", "draft_body", "accepted_resource"],
    },
  },
};

export const ACQUISITION_CONVERSATION_SYSTEM_PROMPT = `You interpret one prospect reply for Summitt Mindset and, when a reply is appropriate, draft it.

Return JSON only. You do not send email and you do not change records.

Outcomes:
- accept_offer: the sender clearly agrees to receive one resource named in this journey's offer, or clearly asks for that resource to be sent. Polite, curious, or positive wording is not acceptance. "sounds good", "thanks", "interesting", and "maybe later" are not accept_offer. Set accepted_resource to the exact offer label or exact resource string from the input. If you cannot copy one of those strings, do not use accept_offer.
- ask_question: a real question about the offered resource, the trial, or the product. accepted_resource is null.
- referral: they name someone else. Do not write to that person. accepted_resource is null.
- offer_decline: they decline this resource or this offer and do not ask to stop all contact. accepted_resource is null.
- unsubscribe: they explicitly ask to stop email or all contact. A decline of this offer is not unsubscribe. accepted_resource is null.
- complaint: they report abuse, spam, or a complaint about being emailed. accepted_resource is null.
- ambiguous: anything unclear, mixed, automated, or not covered above. accepted_resource is null. Do not use ambiguous for a clear question whose fact is missing.
- needs_human: a clear question that asks for a fact, policy, price, refund, billing rule, cancellation method, biography, or product detail that is not in the product facts or this journey's offer. draft_subject and draft_body are null. accepted_resource is null. Do not draft an answer. Do not use needs_human for unclear messages, declines, referrals, unsubscribe, complaints, or questions the product facts already answer.

Voice:
- Short, warm, and plain. Sign Tyler Summitt.
- Do not say Tyler personally opened, read, or typed the message.
- Do not invent a relationship, a meeting, a school detail, a game, a promise, or a prior conversation that is not in the input.
- Do not say a file is attached. The resource, when accepted, arrives in a separate email.
- Do not include a URL or a web address.
- Use only the product facts in the input. The public monthly price is $29/month after the 7-day free trial. The annual price is $249/year after the 7-day free trial. $0 is due today. Cancel anytime is part of the public membership offer, so you may say that. Do not quote any other price. Do not promise a refund, a billing credit, or a cancellation method.

Use needs_human when a clear question needs a fact the input does not contain. Use ambiguous when the message itself is unclear.`;

const SCHEMA_RETRY = "Your previous response did not match acquisition_conversation_v1. Return only JSON with outcome, reason, draft_subject, draft_body, and accepted_resource.";

export function conversationOwnsCampaign(args: {
  interpretation: "off" | "pilot";
  pilotCampaigns: readonly string[];
  campaignId: string | null;
}): boolean {
  if (args.interpretation !== "pilot" || !args.campaignId) return false;
  return args.pilotCampaigns.includes(args.campaignId);
}

export function providerInterestSchedulesFulfillment(args: {
  interpretation: "off" | "pilot";
  pilotCampaigns: readonly string[];
  campaignId: string | null;
}): boolean {
  if (args.interpretation !== "pilot") return true;
  if (!args.campaignId) return false;
  return !conversationOwnsCampaign(args);
}

/** Pilot labels do not change lifecycle. Missing campaign id fails closed. Legacy campaigns still apply. */
export function providerLabelMayApplyLifecycle(args: {
  interpretation: "off" | "pilot";
  pilotCampaigns: readonly string[];
  campaignId: string | null;
}): boolean {
  return providerInterestSchedulesFulfillment(args);
}

export function inboundPersistencePlan(args: {
  event: "inserted" | "duplicate" | "failed";
  message: "inserted" | "duplicate" | "failed" | "skipped";
}): "retry" | "apply_effects" | "already_recorded" {
  if (args.event === "failed" || args.message === "failed") return "retry";
  if (args.event === "inserted" || args.message === "inserted") return "apply_effects";
  return "already_recorded";
}

export type MessageClaimDecision = "claim" | "effect_only" | "leave" | "give_up";

export function nextClaimDecision(args: {
  status: string;
  claimUntil: string | null;
  attemptCount: number;
  outcome: string | null;
  effectApplied: boolean;
  now: Date;
}): MessageClaimDecision {
  if (args.status === "uncertain" || args.status === "sent" || args.status === "interpreted" || args.status === "stored" || args.status === "blocked") {
    return "leave";
  }
  if (args.effectApplied) return "leave";
  const expired = args.status === "processing" && args.claimUntil != null && Date.parse(args.claimUntil) <= args.now.getTime();
  const waiting = args.status === "pending" || args.status === "failed" || expired;
  if (!waiting) return "leave";
  if (args.outcome) return "effect_only";
  if (args.attemptCount >= 2) return "give_up";
  return "claim";
}

export type ConversationEffect =
  | { type: "schedule_asset" }
  | { type: "global_unsubscribe" }
  | { type: "global_complaint" }
  | { type: "retry"; error: "suppression_unknown" }
  | { type: "record"; error: "eligibility_stop" | "fulfillment_unproven" | null };

export function decideConversationEffect(args: {
  outcome: ConversationOutcome;
  journeyId: string | null;
  hasPromise: boolean;
  stopped: boolean;
  suppressed: boolean | null;
}): ConversationEffect {
  if (args.outcome === "unsubscribe") return { type: "global_unsubscribe" };
  if (args.outcome === "complaint") return { type: "global_complaint" };
  if (args.outcome === "offer_decline" || args.outcome === "referral" || args.outcome === "ask_question" || args.outcome === "ambiguous" || args.outcome === "needs_human") {
    return { type: "record", error: null };
  }
  if (args.suppressed == null) return { type: "retry", error: "suppression_unknown" };
  if (args.stopped || args.suppressed) return { type: "record", error: "eligibility_stop" };
  if (!args.journeyId || !args.hasPromise) return { type: "record", error: "fulfillment_unproven" };
  return { type: "schedule_asset" };
}

/** The outcome and a rejected draft are stored by the same inbound update. */
export function inboundInterpretationError(args: {
  effectError: "eligibility_stop" | "fulfillment_unproven" | null;
  draftRejected: boolean;
  draftBody: string | null;
  reviewedBody: string | null;
}): "eligibility_stop" | "fulfillment_unproven" | "draft_rejected" | null {
  if (args.effectError) return args.effectError;
  if (args.draftRejected || (args.draftBody && !args.reviewedBody)) return "draft_rejected";
  return null;
}

export function reviewConversationDraft(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) return null;
  if (/\battach(?:ed|ment|ing)\b/i.test(trimmed)) return null;
  if (/\brefunds?\b/i.test(trimmed) || /\bmoney[\s-]?back\b/i.test(trimmed) || /\bbilling credit\b/i.test(trimmed)) return null;
  return trimmed;
}

export function reviewConversationSubject(value: string | null, replySubject: string | null): string | null {
  const reviewed = value?.replace(/\u0000/g, "").trim() ?? "";
  if (reviewed && reviewed.length <= 180 && !/https?:\/\//i.test(reviewed) && !/\bwww\./i.test(reviewed)) return reviewed;
  if (!replySubject) return null;
  const fallback = `Re: ${replySubject}`.slice(0, 180).trim();
  return fallback.length > 0 ? fallback : null;
}

export function parseConversationInterpreterOutput(raw: string): ParsedConversation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.outcome !== "string" || !OUTCOME_SET.has(row.outcome)) return null;
  if (typeof row.reason !== "string" || !row.reason.trim()) return null;
  const outcome = row.outcome as ConversationOutcome;
  const reason = row.reason.trim().slice(0, 240);
  const draftAllowed = outcome === "accept_offer" || outcome === "ask_question";
  const draftBody = draftAllowed ? reviewConversationDraft(typeof row.draft_body === "string" ? row.draft_body : null) : null;
  const draftSubject = draftAllowed
    ? reviewConversationSubject(typeof row.draft_subject === "string" ? row.draft_subject : null, null)
    : null;
  const draftRejected = draftAllowed && (typeof row.draft_body === "string" && row.draft_body.trim().length > 0) && !draftBody;
  const acceptedResource = typeof row.accepted_resource === "string" && row.accepted_resource.trim()
    ? row.accepted_resource.trim().slice(0, 200)
    : null;
  return { outcome, reason, draftSubject, draftBody, draftRejected, acceptedResource };
}

/** Exact label match against this journey's offer. Not a reading of the reply text. */
export function bindAcceptanceToOffer(
  parsed: ParsedConversation,
  allowedLabels: readonly string[],
): ParsedConversation {
  if (parsed.outcome !== "accept_offer") return parsed;
  if (parsed.acceptedResource && allowedLabels.includes(parsed.acceptedResource)) return parsed;
  return {
    ...parsed,
    outcome: "ambiguous",
    draftSubject: null,
    draftBody: null,
    draftRejected: false,
    acceptedResource: null,
    reason: "The named resource did not match the resource offered on this journey.",
  };
}

export function threadReplyAuthorization(args: {
  sending: "off" | "on";
  outcome: ConversationOutcome | null;
  draftBody: string | null;
  replyToProviderMessageId: string | null;
  senderAccount: string | null;
  stopped: boolean;
  suppressed: boolean | null;
}): { send: false; reason: "sending_off" | "outcome" | "missing_draft" | "missing_reply_target" | "missing_account" | "ineligible" | "suppression_unknown" } | { send: true } {
  if (args.sending !== "on") return { send: false, reason: "sending_off" };
  if (args.outcome !== "accept_offer" && args.outcome !== "ask_question") return { send: false, reason: "outcome" };
  if (!args.draftBody) return { send: false, reason: "missing_draft" };
  if (!args.replyToProviderMessageId) return { send: false, reason: "missing_reply_target" };
  if (!args.senderAccount) return { send: false, reason: "missing_account" };
  if (args.suppressed == null) return { send: false, reason: "suppression_unknown" };
  if (args.stopped || args.suppressed) return { send: false, reason: "ineligible" };
  return { send: true };
}

export function buildConversationInterpreterInput(args: {
  firstName: string | null;
  role: string | null;
  sport: string | null;
  geography: string | null;
  lifecycle: string;
  campaignId: string | null;
  journeyId: string | null;
  offerLabel: string | null;
  offerAssets: readonly AcquisitionFileKey[] | null;
  history: ConversationInterpreterInput["history"];
  fulfillment: ConversationInterpreterInput["fulfillment"];
  subject: string | null;
  body: string;
  occurredAt: string;
}): ConversationInterpreterInput {
  return {
    person: {
      first_name: args.firstName,
      role: args.role,
      sport: args.sport,
      geography: args.geography,
      lifecycle: args.lifecycle,
    },
    campaign_id: args.campaignId,
    journey_id: args.journeyId,
    offer: args.offerAssets && args.offerAssets.length > 0
      ? { label: args.offerLabel, resources: resourceLabels(args.offerAssets) }
      : null,
    facts: ACQUISITION_CONVERSATION_FACTS,
    history: args.history,
    fulfillment: args.fulfillment,
    message: { subject: args.subject, body: args.body, occurred_at: args.occurredAt },
  };
}

export function initialInboundStatus(args: {
  hasBody: boolean;
  truncated: boolean;
  aiOwns: boolean;
}): { status: "blocked" | "pending" | "stored"; error: "missing_body" | "body_exceeds_cap" | null } {
  if (!args.hasBody) return { status: "blocked", error: "missing_body" };
  if (args.truncated) return { status: "blocked", error: "body_exceeds_cap" };
  if (args.aiOwns) return { status: "pending", error: null };
  return { status: "stored", error: null };
}

export async function runAcquisitionConversationInterpreter(args: {
  input: ConversationInterpreterInput;
  client?: OpenAI | null;
}): Promise<{ ok: true; parsed: ParsedConversation } | { ok: false; error: "openai_unavailable" | "model_failed" | "model_malformed" }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client = args.client === undefined ? (apiKey ? new OpenAI({ apiKey }) : null) : args.client;
  if (!client) return { ok: false, error: "openai_unavailable" };
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: ACQUISITION_CONVERSATION_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(args.input) },
  ];
  const create = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: ACQUISITION_CONVERSATION_MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 800,
      response_format: ACQUISITION_CONVERSATION_RESPONSE_FORMAT,
      messages: msgs,
    });
  try {
    const first = await create(messages);
    const raw = first.choices[0]?.message?.content?.trim() ?? "";
    let parsed = raw ? parseConversationInterpreterOutput(raw) : null;
    if (!parsed) {
      const second = await create([
        ...messages,
        { role: "assistant", content: raw.slice(0, 4000) },
        { role: "user", content: SCHEMA_RETRY },
      ]);
      const retry = second.choices[0]?.message?.content?.trim() ?? "";
      parsed = retry ? parseConversationInterpreterOutput(retry) : null;
    }
    if (!parsed) return { ok: false, error: "model_malformed" };
    return { ok: true, parsed };
  } catch (err) {
    console.error("[acquisition] conversation interpretation failed", scrubOpenAiRequestErrorForCapture(err));
    return { ok: false, error: "model_failed" };
  }
}
