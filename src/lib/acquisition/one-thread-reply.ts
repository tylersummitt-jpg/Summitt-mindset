/**
 * One authorized same-thread reply for the owner test message.
 * This module does not read the general send queue or acquisition actions.
 */

import {
  reviewConversationDraft,
  reviewConversationSubject,
} from "@/lib/acquisition/conversation";
import {
  outboundSendPlan,
  postInstantlyThreadReply,
  reconcileInstantlyReply,
  replyRowFromAttempt,
} from "@/lib/acquisition/instantly-reply";
import {
  ACQUISITION_LIFECYCLE,
  salesEmailMustStop,
  type AcquisitionLifecycle,
} from "@/lib/acquisition/model";

export const ONE_THREAD_REPLY_CAMPAIGN_ID = "856a5ef5-88c6-44c6-b001-a5b020d641f7";
export const ONE_THREAD_REPLY_INBOUND_ID = "d5bb38eb-8cc2-4115-b6e0-566b1e0ac222";
export const ONE_THREAD_REPLY_OUTBOUND_ID = `outbound:${ONE_THREAD_REPLY_INBOUND_ID}`;
export const ONE_THREAD_REPLY_SUBJECT = "Re: Summitt Mindset AI Conversation Test";
export const ONE_THREAD_REPLY_BODY = [
  "Hi,",
  "",
  "Yes\u2014it\u2019s free for the first 7 days, with $0 due today. After the trial, membership is $29/month or $249/year, depending on the plan you choose. You can cancel anytime.",
  "",
  "Tyler Summitt",
].join("\n");

export type OneThreadSettings = {
  automation: string;
  interpretation: string;
  sending: string;
  blocklist: string;
  pilotCampaigns: readonly string[];
};

export type OneThreadInbound = {
  id: string;
  campaignId: string | null;
  direction: string;
  status: string;
  outcome: string | null;
  error: string | null;
  effectApplied: boolean;
  replyBlock: string | null;
  replyToProviderMessageId: string | null;
  senderAccount: string | null;
  personId: string | null;
  journeyId: string | null;
  leadEmail: string | null;
};

export type OneThreadPerson = {
  found: boolean;
  lifecycle: string;
  suppressed: boolean | null;
  clerkSubscribed: boolean;
};

export type OneThreadOutbound = {
  status: string;
  providerMessageId: string | null;
  claimUntil: string | null;
  error: string | null;
};

export type OneThreadSnapshot = {
  readable: boolean;
  settings: OneThreadSettings;
  inbound: OneThreadInbound | null;
  person: OneThreadPerson;
  outbound: OneThreadOutbound | null;
};

export type OneThreadSendGuard = {
  replyToProviderMessageId: string;
  senderAccount: string;
  personId: string;
  journeyId: string | null;
  leadEmail: string;
};

export type OneThreadReplyResult = {
  state: "accepted" | "refused" | "uncertain" | "blocked" | "failed" | "processing";
  reason: string | null;
  providerMessageId: string | null;
};

export type OneThreadReplyDecision =
  | { action: "refuse"; reason: string }
  | { action: "leave"; state: OneThreadReplyResult["state"]; reason: string | null; providerMessageId: string | null }
  | { action: "reconcile"; providerMessageId: string | null; expectedStatus: string }
  | { action: "send"; guard: OneThreadSendGuard };

export type OneThreadReplyDeps = {
  now: Date;
  apiKey: string | null;
  read: () => Promise<OneThreadSnapshot>;
  storeDraft: (guard: OneThreadSendGuard) => Promise<number>;
  claim: (guard: OneThreadSendGuard) => Promise<"claimed" | "duplicate" | "error">;
  record: (
    patch: ReturnType<typeof replyRowFromAttempt>,
    expectedStatus: string,
  ) => Promise<boolean>;
  fetchImpl?: typeof fetch;
};

function refuse(reason: string): OneThreadReplyResult {
  return { state: "refused", reason, providerMessageId: null };
}

function token(value: string | null, max: number): value is string {
  return Boolean(value && value.length >= 1 && value.length <= max && !/\s/.test(value));
}

function senderAccount(value: string | null): value is string {
  return Boolean(value && value.length >= 3 && value.length <= 254 && value.includes("@") && !/\s/.test(value));
}

function leadEmail(value: string | null): value is string {
  return Boolean(value && value.length >= 6 && value.length <= 254 && value.includes("@") && !/\s/.test(value));
}

function knownLifecycle(value: string): value is AcquisitionLifecycle {
  return (ACQUISITION_LIFECYCLE as readonly string[]).includes(value);
}

function settingsReason(settings: OneThreadSettings): string | null {
  if (settings.automation !== "off") return "settings_automation";
  if (settings.sending !== "off") return "settings_sending";
  if (settings.interpretation !== "pilot") return "settings_interpretation";
  if (settings.pilotCampaigns.length !== 1 || settings.pilotCampaigns[0] !== ONE_THREAD_REPLY_CAMPAIGN_ID) {
    return "settings_pilot";
  }
  if (settings.blocklist !== "on") return "settings_blocklist";
  return null;
}

export function oneThreadReplyDecision(snapshot: OneThreadSnapshot, now: Date): OneThreadReplyDecision {
  if (!snapshot.readable) return { action: "refuse", reason: "unreadable" };
  const settings = settingsReason(snapshot.settings);
  if (settings) return { action: "refuse", reason: settings };
  const inbound = snapshot.inbound;
  if (!inbound || inbound.id !== ONE_THREAD_REPLY_INBOUND_ID) return { action: "refuse", reason: "message_missing" };
  if (inbound.campaignId !== ONE_THREAD_REPLY_CAMPAIGN_ID) return { action: "refuse", reason: "wrong_campaign" };
  if (!token(inbound.replyToProviderMessageId, 80)) return { action: "refuse", reason: "missing_reply_target" };
  if (!senderAccount(inbound.senderAccount)) return { action: "refuse", reason: "missing_account" };
  if (
    inbound.direction !== "inbound"
    || inbound.status !== "interpreted"
    || inbound.outcome !== "ask_question"
    || inbound.error != null
    || !inbound.effectApplied
    || inbound.replyBlock != null
    || !inbound.personId
    || !leadEmail(inbound.leadEmail)
  ) {
    return { action: "refuse", reason: "ineligible" };
  }
  const person = snapshot.person;
  if (!person.found || !knownLifecycle(person.lifecycle) || salesEmailMustStop(person.lifecycle) || person.clerkSubscribed) {
    return { action: "refuse", reason: "ineligible" };
  }
  if (person.suppressed == null) return { action: "refuse", reason: "suppression_unknown" };
  if (person.suppressed) return { action: "refuse", reason: "ineligible" };
  const outbound = snapshot.outbound;
  if (outbound) {
    const plan = outboundSendPlan({
      status: outbound.status,
      providerMessageId: outbound.providerMessageId,
      claimUntil: outbound.claimUntil,
    }, now);
    if (plan === "reconcile") {
      return {
        action: "reconcile",
        providerMessageId: outbound.providerMessageId,
        expectedStatus: outbound.status,
      };
    }
    if (outbound.status === "sent" && outbound.providerMessageId) {
      return { action: "leave", state: "accepted", reason: null, providerMessageId: outbound.providerMessageId };
    }
    if (outbound.status === "processing") {
      return { action: "leave", state: "processing", reason: "claim_held", providerMessageId: null };
    }
    if (outbound.status === "blocked" || outbound.status === "failed") {
      return {
        action: "leave",
        state: outbound.status,
        reason: outbound.error ?? "provider_error",
        providerMessageId: null,
      };
    }
    return { action: "leave", state: "refused", reason: "existing_outbound", providerMessageId: null };
  }
  return {
    action: "send",
    guard: {
      replyToProviderMessageId: inbound.replyToProviderMessageId,
      senderAccount: inbound.senderAccount,
      personId: inbound.personId,
      journeyId: inbound.journeyId,
      leadEmail: inbound.leadEmail,
    },
  };
}

function fromDecision(decision: Exclude<OneThreadReplyDecision, { action: "send" | "reconcile" }>): OneThreadReplyResult {
  if (decision.action === "refuse") return refuse(decision.reason);
  return {
    state: decision.state,
    reason: decision.reason,
    providerMessageId: decision.providerMessageId,
  };
}

function fromAttempt(attempt: Awaited<ReturnType<typeof postInstantlyThreadReply>>): OneThreadReplyResult {
  if (attempt.state === "accepted") {
    return { state: "accepted", reason: null, providerMessageId: attempt.providerMessageId };
  }
  if (attempt.state === "uncertain") {
    return { state: "uncertain", reason: attempt.reason, providerMessageId: attempt.providerMessageId };
  }
  return {
    state: attempt.reason === "provider_error" ? "failed" : "blocked",
    reason: attempt.reason,
    providerMessageId: null,
  };
}

async function reconcileExisting(
  decision: Extract<OneThreadReplyDecision, { action: "reconcile" }>,
  deps: OneThreadReplyDeps,
): Promise<OneThreadReplyResult> {
  if (!deps.apiKey) return refuse("missing_credentials");
  const attempt = await reconcileInstantlyReply({
    apiKey: deps.apiKey,
    providerMessageId: decision.providerMessageId,
    fetchImpl: deps.fetchImpl,
  });
  await deps.record(replyRowFromAttempt(attempt), decision.expectedStatus);
  return fromAttempt(attempt);
}

function approvedDraftReady(): boolean {
  return reviewConversationDraft(ONE_THREAD_REPLY_BODY) === ONE_THREAD_REPLY_BODY
    && reviewConversationSubject(ONE_THREAD_REPLY_SUBJECT, null) === ONE_THREAD_REPLY_SUBJECT;
}

export async function runOneThreadReply(deps: OneThreadReplyDeps): Promise<OneThreadReplyResult> {
  const first = oneThreadReplyDecision(await deps.read(), deps.now);
  if (first.action === "refuse" || first.action === "leave") return fromDecision(first);
  if (first.action === "reconcile") return reconcileExisting(first, deps);
  if (!deps.apiKey) return refuse("missing_credentials");
  if (!approvedDraftReady()) return refuse("draft_rejected");
  const second = oneThreadReplyDecision(await deps.read(), deps.now);
  if (second.action === "refuse" || second.action === "leave") return fromDecision(second);
  if (second.action === "reconcile") return reconcileExisting(second, deps);
  const stored = await deps.storeDraft(second.guard);
  if (stored !== 1) return refuse("not_eligible");
  const third = oneThreadReplyDecision(await deps.read(), deps.now);
  if (third.action === "refuse" || third.action === "leave") return fromDecision(third);
  if (third.action === "reconcile") return reconcileExisting(third, deps);
  const claimed = await deps.claim(third.guard);
  if (claimed === "error") return refuse("claim_failed");
  if (claimed === "duplicate") {
    const after = oneThreadReplyDecision(await deps.read(), deps.now);
    if (after.action === "send") return refuse("duplicate_send");
    if (after.action === "refuse" || after.action === "leave") return fromDecision(after);
    return reconcileExisting(after, deps);
  }
  const attempt = await postInstantlyThreadReply({
    apiKey: deps.apiKey,
    // This flag authorizes only the adapter call below. It does not change acquisition settings.
    sending: "on",
    eligible: true,
    eaccount: third.guard.senderAccount,
    replyToUuid: third.guard.replyToProviderMessageId,
    subject: ONE_THREAD_REPLY_SUBJECT,
    text: ONE_THREAD_REPLY_BODY,
    fetchImpl: deps.fetchImpl,
  });
  const recorded = await deps.record(replyRowFromAttempt(attempt), "processing");
  if (!recorded && attempt.state === "accepted") {
    return { state: "accepted", reason: "record_unconfirmed", providerMessageId: attempt.providerMessageId };
  }
  return fromAttempt(attempt);
}
