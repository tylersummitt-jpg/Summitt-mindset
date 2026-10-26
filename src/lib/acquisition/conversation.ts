/**
 * One acquisition conversation interpreter.
 * The model returns a decision and an optional draft. It does not write to
 * Supabase and it does not call an email provider.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { resourceLabels, type AcquisitionFileKey } from "@/lib/acquisition/assets";
import { LEADERSHIP_KIT_CLAIM } from "@/lib/acquisition/email-knowledge";
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

/**
 * Public facts Tyler approved for every acquisition reply.
 * The physical Leadership Kit is not here. It enters a reply only through
 * approved knowledge scoped to that campaign or offer.
 * Pat's record is the public coaching record from the University of Tennessee
 * and the Women's Basketball Hall of Fame, not a personal family story.
 */
export const ACQUISITION_VERIFIED_CONTEXT = {
  tyler: [
    "Tyler Summitt is Pat Summitt's son.",
    "Tyler is building Summitt Mindset.",
    "Tyler cares deeply about continuing Pat Summitt's leadership principles and legacy.",
    "Summitt Mindset is intended to help people develop goals, accountability, consistency, and meaningful lives.",
  ],
  pat: [
    "Pat Summitt was the head coach of the University of Tennessee Lady Vols.",
    "She coached Tennessee for 38 seasons, from 1974 to 2012.",
    "She earned 1,098 career wins.",
    "Her teams won eight NCAA national championships.",
    "She coached the 1984 U.S. women's Olympic basketball team to a gold medal.",
    "She received the Presidential Medal of Freedom in 2012.",
    "Her coaching principles emphasized discipline, accountability, hard work, respect, teamwork, communication, preparation, and integrity.",
    "Her influence extended beyond basketball to personal character and leadership.",
  ],
  product: [
    "Summitt Mindset is a personal coach who texts you to help you reach your goals and build a life you're proud of.",
    "Along the way, Coach Pat helps members recognize victories and special moments so they can remember them.",
    "The promise is: Build a life you're proud of. And remember it.",
    "Coach Pat provides ongoing SMS-based accountability, encouragement, and conversation.",
    "Members can identify the person they want to become, set a Current Goal, receive coaching texts, complete Morning, Evening, and Weekly reflections, recognize Goal Wins and Proud Moments, revisit progress in the Victory Room, ask Pat questions, explore Film Room content, and access Programs.",
    "Coach Pat is an AI-powered coaching experience created by Summitt Mindset and inspired by Pat Summitt. It is not literally Pat Summitt communicating.",
  ],
  audience: [
    "Summitt Mindset is not exclusively for basketball coaches.",
    "It can be relevant to coaches in any sport, athletic directors, teachers, school administrators, parents, students and athletes where membership eligibility permits, business leaders, and people pursuing personal accountability.",
  ],
  membership: {
    trial: "Seven-day free trial.",
    dueToday: "$0 due today.",
    monthly: "$29/month for the monthly plan after the trial.",
    annual: "$249/year for the annual plan.",
    cancel: "Cancel anytime. Cancellation stops future recurring billing.",
  },
  withheld: [
    "Refund eligibility, automatic money-back guarantees, and billing credits.",
    "The screens or steps used to cancel.",
    "Special discounts, a different trial length, and unapproved team pricing.",
    "Any personal story, meeting, or memory that is not in this input.",
    "The physical Leadership Kit, unless approved_knowledge includes it for this campaign or offer.",
    "Shipping, a delivery date, a country, a quantity limit, when a Kit ships, whether monthly and annual members qualify equally, and whether a member keeps a Kit after cancellation.",
  ],
} as const;

export type ApprovedKnowledgeFact = {
  id: string;
  topic: string;
  category: string;
  statement: string;
};

export function conversationCalendar(now: Date, timeZone = "America/New_York"): { date: string; weekday: string } {
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now),
  };
}

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
  verified: typeof ACQUISITION_VERIFIED_CONTEXT;
  approved_knowledge: ApprovedKnowledgeFact[];
  knowledge_conflicts: string[];
  today: { date: string; weekday: string } | null;
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
- needs_human: a clear question that asks for a fact, policy, price, refund, billing rule, cancellation method, biography, product detail, discount, partnership, personal anecdote, or Leadership Kit fulfillment term that is not in verified, this journey's offer, or approved_knowledge. Also use needs_human when knowledge_conflicts names a topic the question depends on. draft_subject and draft_body are null. accepted_resource is null. Do not draft an answer. Do not choose between conflicting facts. Do not use needs_human for unclear messages, declines, referrals, unsubscribe, complaints, or questions the verified facts already answer.

Voice, as Tyler Summitt:
- Sound warm, happy, enthusiastic, personal, and genuinely encouraging. Exclamation points are welcome in ordinary mail. Vary the greeting. Do not reuse one template.
- Use the person's name, role, or coaching title only when that field is present. Do not assume the sender is a coach.
- Answer the question before mentioning an offer. Ordinary replies are usually 50 to 130 words. Explain more only when the question needs it.
- Sign ordinary acquisition emails "Tyler Summitt".
- Mention a weekday only when today is present and the weekday equals today.weekday. Never invent the day.
- A complaint or a serious concern gets calm empathy and few exclamation points. Do not draft unsubscribe or complaint replies.
- Do not say Tyler personally opened, read, or typed the message. If asked whether a human or AI is responding, say truthfully that the message is AI-assisted, written in Tyler's approved voice, and limited to approved facts.
- Do not invent a relationship, a meeting, a school detail, a game, a shared memory, or a personal experience that is not in the input.
- Do not say the literal Pat Summitt is sending messages or texts. Coach Pat is an AI-powered experience inspired by her.
- Do not say a file is attached. An accepted digital resource arrives in a separate email. Do not call a digital guide the physical Leadership Kit.
- Do not include a URL or a web address.
- Do not use robotic wording such as "I'd be delighted to assist you" or "As an AI language model".
- Use only verified, this journey's offer, and approved_knowledge. The public monthly price is $29/month after the 7-day free trial. The annual price is $249/year after the 7-day free trial. $0 is due today. Cancel anytime is part of the public membership offer, so you may say that cancellation stops future recurring billing. Do not quote any other price. Do not promise a refund, a billing credit, or a cancellation method.
- Do not mention the Leadership Kit unless approved_knowledge contains it for this campaign or offer. Do not add shipping, a delivery date, a country, a quantity, trial shipment, or what happens to a Kit after cancellation.

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

const UNAPPROVED_COMMERCE = /\bfree shipping\b|\bshipping\b|\bshipment\b|\bships\b|\bdelivery date\b|\bdiscount\b|\bcoupon\b|\b% off\b|\bpercent off\b/i;
const MISLEADING_IDENTITY = /\bi (?:personally )?(?:typed|wrote) (?:this|every)\b|\bas an ai language model\b|\bi'd be delighted to assist\b|\bpat summitt (?:is|will be) (?:texting|emailing|writing)\b/i;
const INVENTED_MEMORY = /\bwhen I was\b|\bmy childhood\b|\bI remember when\b|\bgrowing up\b/i;
const PUBLIC_PRICE = new Set(["$0", "$29", "$249"]);

function unapprovedPrice(text: string, allowLeadershipKit: boolean): boolean {
  const amounts = text.match(/\$\d+(?:\.\d+)?/g) ?? [];
  return amounts.some((amount) => {
    if (PUBLIC_PRICE.has(amount)) return false;
    return !(allowLeadershipKit && amount === "$400");
  });
}

export function reviewConversationDraft(
  value: string | null,
  options?: { allowLeadershipKit?: boolean },
): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) return null;
  if (/\battach(?:ed|ment|ing)\b/i.test(trimmed)) return null;
  if (/\brefunds?\b/i.test(trimmed) || /\bmoney[\s-]?back\b/i.test(trimmed) || /\bbilling credit\b/i.test(trimmed)) return null;
  if (UNAPPROVED_COMMERCE.test(trimmed) || MISLEADING_IDENTITY.test(trimmed) || INVENTED_MEMORY.test(trimmed)) return null;
  if (unapprovedPrice(trimmed, Boolean(options?.allowLeadershipKit))) return null;
  if (!options?.allowLeadershipKit && LEADERSHIP_KIT_CLAIM.test(trimmed)) return null;
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
  approvedKnowledge?: readonly ApprovedKnowledgeFact[];
  knowledgeConflicts?: readonly string[];
  today?: { date: string; weekday: string } | null;
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
    verified: ACQUISITION_VERIFIED_CONTEXT,
    approved_knowledge: [...(args.approvedKnowledge ?? [])],
    knowledge_conflicts: [...(args.knowledgeConflicts ?? [])],
    today: args.today ?? null,
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
