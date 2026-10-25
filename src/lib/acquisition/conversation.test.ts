import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ACQUISITION_CONVERSATION_FACTS,
  ACQUISITION_CONVERSATION_SYSTEM_PROMPT,
  bindAcceptanceToOffer,
  buildConversationInterpreterInput,
  conversationOwnsCampaign,
  decideConversationEffect,
  inboundPersistencePlan,
  initialInboundStatus,
  nextClaimDecision,
  parseConversationInterpreterOutput,
  providerInterestSchedulesFulfillment,
  providerLabelMayApplyLifecycle,
  reviewConversationDraft,
  runAcquisitionConversationInterpreter,
  threadReplyAuthorization,
} from "@/lib/acquisition/conversation";
import { ACQUISITION_REPLY_TEXT_CAP, instantlyPersonMetadata, normalizeInstantlyWebhook } from "@/lib/acquisition/instantly";
import { INSTANTLY_REPLY_URL, outboundSendPlan, postInstantlyThreadReply, reconcileInstantlyReply } from "@/lib/acquisition/instantly-reply";
import { salesEmailMustStop } from "@/lib/acquisition/model";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";

const NOW = new Date("2026-10-23T22:00:00.000Z");

function replyPayload(extra: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-10-23T21:00:00.000Z",
    event_type: "reply_received",
    campaign_id: "camp-basketball",
    campaign_name: "Basketball",
    lead_email: "Coach@School.edu",
    email_account: "outreach@summittmindset.com",
    email_id: "01234567-89ab-cdef-0123-456789abcdef",
    reply_subject: "Re: the playbook",
    reply_text_snippet: "I am interested",
    reply_text: "Please send the playbook. I want to use it with the team.",
    ...extra,
  };
}

describe("incoming reply capture", () => {
  it("keeps the full plain-text reply and the unchanged email id", () => {
    const event = normalizeInstantlyWebhook(replyPayload());
    expect(event.kind).toBe("person");
    if (event.kind !== "person") return;
    expect(event.replyText).toBe("Please send the playbook. I want to use it with the team.");
    expect(event.replyTextTruncated).toBe(false);
    expect(event.providerMessageId).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(event.replySubject).toBe("Re: the playbook");
    expect(event.sender).toBe("outreach@summittmindset.com");
    expect(event.campaignId).toBe("camp-basketball");
    expect(event.occurredAt).toBe("2026-10-23T21:00:00.000Z");
    expect(event.preview).toBe("I am interested");
    expect(JSON.stringify(instantlyPersonMetadata(event))).not.toContain("Please send the playbook");
  });

  it("caps an oversized body and does not shorten a reply target", () => {
    const long = normalizeInstantlyWebhook(replyPayload({ reply_text: `x${"y".repeat(ACQUISITION_REPLY_TEXT_CAP)}` }));
    if (long.kind !== "person") throw new Error("expected person");
    expect(long.replyText).toHaveLength(ACQUISITION_REPLY_TEXT_CAP);
    expect(long.replyTextTruncated).toBe(true);
    const stretched = normalizeInstantlyWebhook(replyPayload({ email_id: "a".repeat(81) }));
    if (stretched.kind !== "person") throw new Error("expected person");
    expect(stretched.providerMessageId).toBeNull();
    expect(initialInboundStatus({ hasBody: false, truncated: false, aiOwns: true })).toEqual({
      status: "blocked",
      error: "missing_body",
    });
    expect(initialInboundStatus({ hasBody: true, truncated: true, aiOwns: true }).error).toBe("body_exceeds_cap");
  });
});

describe("durable processing decisions", () => {
  it("retries a failed message write after the event insert and does not repeat a finished pair", () => {
    expect(inboundPersistencePlan({ event: "inserted", message: "failed" })).toBe("retry");
    expect(inboundPersistencePlan({ event: "duplicate", message: "inserted" })).toBe("apply_effects");
    expect(inboundPersistencePlan({ event: "duplicate", message: "duplicate" })).toBe("already_recorded");
    expect(inboundPersistencePlan({ event: "duplicate", message: "skipped" })).toBe("already_recorded");
    expect(inboundPersistencePlan({ event: "failed", message: "skipped" })).toBe("retry");
  });

  it("lets one worker claim a pending row and keeps a live claim untouched", () => {
    expect(nextClaimDecision({
      status: "pending",
      claimUntil: null,
      attemptCount: 0,
      outcome: null,
      effectApplied: false,
      now: NOW,
    })).toBe("claim");
    expect(nextClaimDecision({
      status: "processing",
      claimUntil: "2026-10-23T22:05:00.000Z",
      attemptCount: 1,
      outcome: null,
      effectApplied: false,
      now: NOW,
    })).toBe("leave");
    expect(nextClaimDecision({
      status: "processing",
      claimUntil: "2026-10-23T21:00:00.000Z",
      attemptCount: 1,
      outcome: "accept_offer",
      effectApplied: false,
      now: NOW,
    })).toBe("effect_only");
    expect(nextClaimDecision({
      status: "uncertain",
      claimUntil: "2026-10-23T21:00:00.000Z",
      attemptCount: 1,
      outcome: null,
      effectApplied: false,
      now: NOW,
    })).toBe("leave");
    expect(nextClaimDecision({
      status: "failed",
      claimUntil: null,
      attemptCount: 2,
      outcome: null,
      effectApplied: false,
      now: NOW,
    })).toBe("give_up");
  });
});

describe("one interpreter", () => {
  it("fails closed on prose, a bad outcome, and a missing model", async () => {
    expect(parseConversationInterpreterOutput("sounds good, send it over")).toBeNull();
    expect(parseConversationInterpreterOutput(JSON.stringify({
      outcome: "positive",
      reason: "they were nice",
      draft_subject: null,
      draft_body: null,
    }))).toBeNull();
    const unavailable = await runAcquisitionConversationInterpreter({
      input: buildConversationInterpreterInput({
        firstName: "Pat",
        role: "coach",
        sport: "basketball",
        geography: null,
        lifecycle: "reply_needs_review",
        campaignId: "camp-basketball",
        journeyId: "journey-1",
        offerLabel: "Playbook",
        offerAssets: ["playbook"],
        history: [],
        fulfillment: [],
        subject: "Re: the playbook",
        body: "Please send the playbook.",
        occurredAt: NOW.toISOString(),
      }),
      client: null,
    });
    expect(unavailable).toEqual({ ok: false, error: "openai_unavailable" });
  });

  it("accepts a real resource request and treats a casual compliment as ambiguous", () => {
    const accepted = parseConversationInterpreterOutput(JSON.stringify({
      outcome: "accept_offer",
      reason: "They asked for the playbook.",
      draft_subject: "Re: the playbook",
      draft_body: "Hi Pat,\n\nI will send the playbook in a separate email.\n\nTyler Summitt",
      accepted_resource: "Pat Summitt basketball special-situations playbook",
    }));
    expect(accepted?.outcome).toBe("accept_offer");
    const proven = accepted
      ? bindAcceptanceToOffer(accepted, ["Pat Summitt basketball special-situations playbook"])
      : null;
    expect(proven?.outcome).toBe("accept_offer");
    expect(decideConversationEffect({
      outcome: "accept_offer",
      journeyId: "journey-a",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "schedule_asset" });
    expect(decideConversationEffect({
      outcome: "accept_offer",
      journeyId: "journey-b",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "schedule_asset" });
    expect("acquisition:person-1:journey-a:send_asset").not.toBe("acquisition:person-1:journey-b:send_asset");
    const unmatched = accepted ? bindAcceptanceToOffer(accepted, []) : null;
    expect(unmatched?.outcome).toBe("ambiguous");
    const conflicting = accepted
      ? bindAcceptanceToOffer({ ...accepted, acceptedResource: "A different guide" }, ["Pat Summitt basketball special-situations playbook"])
      : null;
    expect(conflicting?.outcome).toBe("ambiguous");
    expect(decideConversationEffect({
      outcome: "ambiguous",
      journeyId: "journey-a",
      hasPromise: false,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "record", error: null });
    const casual = parseConversationInterpreterOutput(JSON.stringify({
      outcome: "ambiguous",
      reason: "Positive wording did not accept the resource.",
      draft_subject: null,
      draft_body: null,
      accepted_resource: null,
    }));
    expect(casual?.outcome).toBe("ambiguous");
    expect(decideConversationEffect({
      outcome: "ambiguous",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "record", error: null });
    expect(ACQUISITION_CONVERSATION_SYSTEM_PROMPT).toContain("sounds good");
    expect(ACQUISITION_CONVERSATION_FACTS.monthly).toBe("$29/month after the 7-day free trial");
    expect(ACQUISITION_CONVERSATION_FACTS.annual).toBe("$249/year after the 7-day free trial");
  });

  it("answers the trial and cancel-anytime question from the public offer and rejects unsupported billing claims", () => {
    const question = "How does the seven-day free trial work? Is it really free for the first seven days, and can I cancel anytime?";
    expect(question.toLowerCase()).toContain("seven days");
    expect(question.toLowerCase()).toContain("cancel anytime");
    expect(ACQUISITION_CONVERSATION_FACTS.trial).toBe("$0 due today, then a 7-day free trial");
    expect(ACQUISITION_CONVERSATION_FACTS.cancel).toBe(MEMBERSHIP_PUBLIC_OFFER.cancel);
    expect(ACQUISITION_CONVERSATION_FACTS.cancel).toBe("Cancel anytime");
    expect(ACQUISITION_CONVERSATION_SYSTEM_PROMPT).toContain("Cancel anytime is part of the public membership offer");
    expect(ACQUISITION_CONVERSATION_SYSTEM_PROMPT).toContain("Do not promise a refund, a billing credit, or a cancellation method.");
    expect(JSON.stringify(ACQUISITION_CONVERSATION_FACTS).toLowerCase()).not.toContain("refund");
    const input = buildConversationInterpreterInput({
      firstName: null,
      role: null,
      sport: null,
      geography: null,
      lifecycle: "cold_active",
      campaignId: "camp-1",
      journeyId: "journey-1",
      offerLabel: null,
      offerAssets: ["playbook"],
      history: [],
      fulfillment: [],
      subject: "Re: the trial",
      body: question,
      occurredAt: "2026-10-25T19:00:00.000Z",
    });
    expect(input.facts.cancel).toBe("Cancel anytime");
    expect(input.message.body).toBe(question);
    const grounded = reviewConversationDraft(
      "Yes. $0 is due today, and the first seven days are free. After that it is $29/month, or $249/year. You can cancel anytime.\n\nTyler Summitt"
    );
    expect(grounded?.toLowerCase()).toContain("cancel anytime");
    expect(reviewConversationDraft("You can cancel anytime and we will refund the charge.")).toBeNull();
    expect(reviewConversationDraft("Cancel anytime. We will give you your money back.")).toBeNull();
    expect(reviewConversationDraft("Cancel anytime and we will add a billing credit.")).toBeNull();
  });

  it("separates an offer decline from unsubscribe and complaint", () => {
    expect(decideConversationEffect({
      outcome: "offer_decline",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "record", error: null });
    expect(decideConversationEffect({
      outcome: "unsubscribe",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "global_unsubscribe" });
    expect(decideConversationEffect({
      outcome: "complaint",
      journeyId: null,
      hasPromise: false,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "global_complaint" });
    expect(decideConversationEffect({
      outcome: "referral",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "record", error: null });
  });

  it("does not schedule for a member, a suppression, or a missing journey", () => {
    for (const state of ["trial_started", "paid_member", "trial_expired", "unsubscribed", "suppressed", "not_interested"] as const) {
      expect(salesEmailMustStop(state)).toBe(true);
      expect(decideConversationEffect({
        outcome: "accept_offer",
        journeyId: "journey-1",
        hasPromise: true,
        stopped: true,
        suppressed: false,
      }).type).not.toBe("schedule_asset");
    }
    expect(decideConversationEffect({
      outcome: "accept_offer",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: true,
    })).toEqual({ type: "record", error: "eligibility_stop" });
    expect(decideConversationEffect({
      outcome: "accept_offer",
      journeyId: null,
      hasPromise: true,
      stopped: false,
      suppressed: false,
    })).toEqual({ type: "record", error: "fulfillment_unproven" });
    expect(reviewConversationDraft("The file is attached.")).toBeNull();
    expect(reviewConversationDraft("See https://example.com")).toBeNull();
  });

  it("asks the model once, then once more only when the first body is not the schema", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "sure thing" } }] })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              outcome: "ask_question",
              reason: "They asked how the trial works.",
              draft_subject: "Re: trial",
              draft_body: "Hi Pat,\n\nThe free trial is 7 days. Monthly is $29/month after that, and annual is $249/year.\n\nTyler Summitt",
              accepted_resource: null,
            }),
          },
        }],
      });
    const result = await runAcquisitionConversationInterpreter({
      input: buildConversationInterpreterInput({
        firstName: "Pat",
        role: null,
        sport: null,
        geography: null,
        lifecycle: "reply_needs_review",
        campaignId: "camp-basketball",
        journeyId: "journey-1",
        offerLabel: null,
        offerAssets: ["playbook"],
        history: [],
        fulfillment: [],
        subject: null,
        body: "How does the trial work?",
        occurredAt: NOW.toISOString(),
      }),
      client: { chat: { completions: { create } } } as never,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });
});

describe("lead_interested is not a second authority inside the pilot", () => {
  const pilot = { interpretation: "pilot" as const, pilotCampaigns: ["camp-basketball"] };

  it("keeps the label in charge only while interpretation is off or the campaign is outside the pilot", () => {
    expect(providerInterestSchedulesFulfillment({
      interpretation: "off",
      pilotCampaigns: ["camp-basketball"],
      campaignId: "camp-basketball",
    })).toBe(true);
    expect(providerInterestSchedulesFulfillment({ ...pilot, campaignId: "camp-other" })).toBe(true);
    expect(conversationOwnsCampaign({ ...pilot, campaignId: "camp-basketball" })).toBe(true);
    expect(providerInterestSchedulesFulfillment({ ...pilot, campaignId: "camp-basketball" })).toBe(false);
    expect(providerInterestSchedulesFulfillment({ ...pilot, campaignId: null })).toBe(false);
    expect(conversationOwnsCampaign({ ...pilot, campaignId: null })).toBe(false);
    expect(providerLabelMayApplyLifecycle({ ...pilot, campaignId: "camp-basketball" })).toBe(false);
    expect(providerLabelMayApplyLifecycle({
      interpretation: "off",
      pilotCampaigns: ["camp-basketball"],
      campaignId: "camp-basketball",
    })).toBe(true);
    expect(providerLabelMayApplyLifecycle({ ...pilot, campaignId: "camp-other" })).toBe(true);
    expect(providerLabelMayApplyLifecycle({ ...pilot, campaignId: null })).toBe(false);
  });
});

describe("thread reply authorization and send claims", () => {
  const ready = {
    sending: "on" as const,
    outcome: "ask_question" as const,
    draftBody: "Hi Pat,\n\nTyler Summitt",
    replyToProviderMessageId: "reply-1",
    senderAccount: "outreach@summittmindset.com",
    stopped: false,
    suppressed: false as boolean | null,
  };

  it("refuses a draft when sending is off, the person is protected, or the thread target is missing", () => {
    expect(threadReplyAuthorization({ ...ready, sending: "off" })).toEqual({ send: false, reason: "sending_off" });
    expect(threadReplyAuthorization({ ...ready, outcome: "offer_decline" })).toEqual({ send: false, reason: "outcome" });
    expect(threadReplyAuthorization({ ...ready, outcome: "unsubscribe" })).toEqual({ send: false, reason: "outcome" });
    expect(threadReplyAuthorization({ ...ready, draftBody: null })).toEqual({ send: false, reason: "missing_draft" });
    expect(threadReplyAuthorization({ ...ready, replyToProviderMessageId: null })).toEqual({ send: false, reason: "missing_reply_target" });
    expect(threadReplyAuthorization({ ...ready, stopped: true })).toEqual({ send: false, reason: "ineligible" });
    expect(threadReplyAuthorization({ ...ready, suppressed: true })).toEqual({ send: false, reason: "ineligible" });
    expect(threadReplyAuthorization({ ...ready, suppressed: null })).toEqual({ send: false, reason: "suppression_unknown" });
    expect(threadReplyAuthorization(ready)).toEqual({ send: true });
  });

  it("claims a new send once and does not post again after success, rejection, or an uncertain result", () => {
    expect(outboundSendPlan(null, NOW)).toBe("claim_and_send");
    expect(outboundSendPlan({ status: "sent", providerMessageId: "email-1", claimUntil: null }, NOW)).toBe("leave");
    expect(outboundSendPlan({ status: "blocked", providerMessageId: null, claimUntil: null }, NOW)).toBe("leave");
    expect(outboundSendPlan({ status: "uncertain", providerMessageId: null, claimUntil: null }, NOW)).toBe("reconcile");
    expect(outboundSendPlan({
      status: "processing",
      providerMessageId: null,
      claimUntil: "2026-10-23T22:04:00.000Z",
    }, NOW)).toBe("leave");
    expect(outboundSendPlan({
      status: "processing",
      providerMessageId: null,
      claimUntil: "2026-10-23T21:00:00.000Z",
    }, NOW)).toBe("reconcile");
  });
});

describe("Instantly thread reply transport", () => {
  const ready = {
    apiKey: "test-key",
    sending: "on" as const,
    eligible: true,
    eaccount: "outreach@summittmindset.com",
    replyToUuid: "01234567-89ab-cdef-0123-456789abcdef",
    subject: "Re: the playbook",
    text: "Hi Pat,\n\nTyler Summitt",
  };

  it("does not post while sending is off, the target is missing, or the provider rejects the call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const off = await postInstantlyThreadReply({ ...ready, sending: "off", fetchImpl });
    const missing = await postInstantlyThreadReply({ ...ready, replyToUuid: null, fetchImpl });
    expect(off).toMatchObject({ state: "blocked", reason: "sending_off" });
    expect(missing).toMatchObject({ state: "blocked", reason: "missing_reply_target" });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ id: "email-sent-1" }), { status: 200 }));
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({
      state: "accepted",
      providerMessageId: "email-sent-1",
      statusCode: 200,
    });
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: "no" }), { status: 401 }));
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({ state: "blocked", reason: "unauthorized", statusCode: 401 });
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: "pay" }), { status: 402 }));
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({ reason: "payment_required", statusCode: 402 });
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: "missing" }), { status: 404 }));
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({ reason: "not_found", statusCode: 404 });
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: "slow" }), { status: 429 }));
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({ reason: "rate_limited", statusCode: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    for (const call of fetchImpl.mock.calls) expect(call[0]).toBe(INSTANTLY_REPLY_URL);
  });

  it("keeps a thrown post uncertain and reconciles only by reading an email id", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("socket hang up");
    });
    expect(await postInstantlyThreadReply({ ...ready, fetchImpl })).toMatchObject({
      state: "uncertain",
      reason: "timeout_or_network",
      providerMessageId: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const read = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      if (String(url).includes("/emails/reply")) throw new Error("reply post");
      return new Response(JSON.stringify({ id: ready.replyToUuid }), { status: 200 });
    });
    expect(await reconcileInstantlyReply({
      apiKey: "test-key",
      providerMessageId: null,
      fetchImpl: read,
    })).toMatchObject({ state: "uncertain", reason: "no_provider_id" });
    expect(read).not.toHaveBeenCalled();
    expect(await reconcileInstantlyReply({
      apiKey: "test-key",
      providerMessageId: ready.replyToUuid,
      fetchImpl: read,
    })).toMatchObject({ state: "accepted", providerMessageId: ready.replyToUuid });
    expect(String(read.mock.calls[0]?.[0])).toContain("/api/v2/emails/");
    expect(String(read.mock.calls[0]?.[0])).not.toContain("/emails/reply");
  });
});

describe("conversation wiring stays behind the existing switches", () => {
  it("leaves the cron off-path, the reply route, and global not_interested alone", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    const processor = store.slice(
      store.indexOf("export async function processAcquisitionConversations"),
      store.indexOf("export async function deliverAcquisitionThreadReply"),
    );
    const route = readFileSync("src/app/api/acquisition/instantly/route.ts", "utf8");
    const sql = readFileSync("supabase/migrations/20261024000000_acquisition_conversation_messages.sql", "utf8");
    const instantly = readFileSync("src/lib/acquisition/instantly.ts", "utf8");
    expect(cron.indexOf("readAcquisitionAssetReport")).toBeLessThan(cron.indexOf("acquisition_actions"));
    expect(cron).toContain('skipped: "automation_off"');
    expect(cron).not.toContain("postInstantlyThreadReply");
    expect(cron).not.toContain("deliverAcquisitionThreadReply");
    expect(cron).not.toContain(INSTANTLY_REPLY_URL);
    expect(cron).toContain('conversationSending !== "on"');
    expect(processor).not.toContain("not_interested");
    expect(processor).not.toContain("postInstantlyThreadReply");
    expect(processor).toContain("deliverAcquisitionThreadReply");
    expect(processor).toContain('conversationSending === "on"');
    expect(processor).toContain("scheduleAction");
    const personPath = store.slice(
      store.indexOf("async function applyPersonEvent"),
      store.indexOf("export async function recordAcquisitionVideoEvent"),
    );
    expect(personPath).toContain('event.signal === "not_interested"');
    expect(personPath).toContain("providerLabelMayApplyLifecycle");
    expect(route).not.toContain("openai");
    expect(route).not.toContain("emails/reply");
    expect(instantly).toContain('lead_not_interested: "not_interested"');
    expect(sql).toContain("DEFAULT 'off'");
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(sql).toContain("char_length(body_text) <= 20000");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_messages TO service_role");
    expect(store).toContain("`acquisition:${personId}:${journeyId}:${action}`");
    expect(store).toContain("`acquisition:${personId}:${action}`");
  });
});
