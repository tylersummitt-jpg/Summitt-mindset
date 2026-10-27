import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ACQUISITION_JOURNEY_LINK_LIFETIME,
  acquisitionTrialCheckoutUrl,
  buildEmailAcquiredMemberNotice,
  confirmedPreviousOutreach,
  decideNoticeClaim,
  decideOutreachHistoryNotice,
  deliverEmailAcquiredMemberNotice,
  describeResendResource,
  groupHistoryByJourney,
  journeyIdFromStripeMetadata,
  readSignedAcquisitionJourneyId,
  resendResourceCountsAsSent,
  signAcquisitionJourneyId,
  type EmailAcquiredMemberNoticeInput,
  type OutreachHistoryDecision,
} from "@/lib/acquisition/email-acquired-member-notice";

const SECRET = "test-secret-at-least-16";
const JOURNEY_A = "11111111-1111-4111-8111-111111111111";
const JOURNEY_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_B = "33333333-3333-4333-8333-333333333333";

function history(overrides: Partial<OutreachHistoryDecision> = {}): OutreachHistoryDecision {
  return {
    ownerCanary: false,
    exactEmailConfirmed: true,
    signedJourneyConfirmed: false,
    ...overrides,
  };
}

function notice(overrides: Partial<EmailAcquiredMemberNoticeInput> = {}): EmailAcquiredMemberNoticeInput {
  return {
    memberName: "Riley Coach",
    memberEmail: "riley@school.example",
    sections: [
      {
        association: "exact_email",
        acquisitionName: "Riley Coach",
        acquisitionEmail: "riley@school.example",
        campaigns: [{
          id: CAMPAIGN_B,
          name: "Tennessee coaches",
          entries: [
            {
              at: "2026-10-22T13:02:50.000Z",
              kind: "instantly_outreach",
              sender: "one@trysummittmindset.com",
              subject: null,
              body: null,
              detail: "Step 1.",
            },
            {
              at: "2026-10-23T15:00:00.000Z",
              kind: "inbound_reply",
              sender: "Prospect",
              subject: "Re: practice",
              body: "Can you send the guide?",
              detail: null,
            },
            {
              at: "2026-10-23T16:00:00.000Z",
              kind: "ai_reply",
              sender: "one@trysummittmindset.com",
              subject: "Re: practice",
              body: "The guide is on its way.",
              detail: "Stored AI outcome: send_asset.",
            },
            {
              at: "2026-10-23T16:05:00.000Z",
              kind: "resend_resource",
              sender: "Resend",
              subject: null,
              body: null,
              detail: "Resend accepted this send. Delivery has not been recorded. Resource: Definite Dozen.",
            },
          ],
        }],
      },
    ],
    outreachUnreadable: false,
    repliesUnreadable: false,
    resourcesUnreadable: false,
    truncated: false,
    ...overrides,
  };
}

describe("new member outreach history", () => {
  it("sends one history email when the member email has confirmed outreach", async () => {
    const send = vi.fn(async () => ({ state: "sent" as const, providerMessageId: "re_123" }));
    const claim = vi.fn(async () => "send" as const);
    const record = vi.fn(async () => undefined);
    const outcome = await deliverEmailAcquiredMemberNotice({
      history: history(),
      notice: notice(),
      subscriptionId: "sub_new",
      credentialsReady: true,
      claim,
      send,
      record,
    });
    expect(outcome).toBe("sent");
    expect(claim).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0][0];
    expect(message.subject).toBe("Previous outreach — Riley Coach");
    expect(message.text).toContain("Previously contacted through email outreach. This does not establish that email caused the subscription.");
    expect(message.text).toContain("Exact email match.");
    expect(message.text).toContain("Riley Coach");
    expect(message.text).toContain("riley@school.example");
    expect(message.text).toContain("Tennessee coaches");
    expect(message.text).toContain(CAMPAIGN_B);
    expect(message.text).toContain("Can you send the guide?");
    expect(message.text).toContain("The guide is on its way.");
    expect(message.text).toContain("Instantly outreach");
    expect(message.text).toContain("Prospect reply");
    expect(message.text).toContain("Automated AI reply");
    expect(message.text).toContain("Resend resource");
    expect(message.text).toContain("Body: not stored. This line is not a reconstructed email.");
    expect(message.text).toContain("Review whether a Leadership Kit is appropriate.");
    expect(message.text).not.toContain("amount_paid");
    expect(message.text).not.toContain("This is not an exact email match.");
    expect(message.text.indexOf("Instantly outreach")).toBeLessThan(message.text.indexOf("Prospect reply"));
    expect(message.text.indexOf("Prospect reply")).toBeLessThan(message.text.indexOf("Automated AI reply"));
    expect(send.mock.calls[0][1]).toBe("email-campaign-member-sub_new");
    expect(record).toHaveBeenCalledWith("accepted", "re_123");
  });

  it("does not treat a missing Instantly send as proof that no contact happened", () => {
    expect(confirmedPreviousOutreach({
      emailSent: 0,
      inboundReplies: 1,
      sentOutboundReplies: 0,
      acceptedOrDeliveredResources: 0,
    })).toBe(true);
    expect(confirmedPreviousOutreach({
      emailSent: 0,
      inboundReplies: 0,
      sentOutboundReplies: 1,
      acceptedOrDeliveredResources: 0,
    })).toBe(true);
  });

  it("does not send when the address is only an imported lead or an unsent draft", () => {
    expect(confirmedPreviousOutreach({
      emailSent: 0,
      inboundReplies: 0,
      sentOutboundReplies: 0,
      acceptedOrDeliveredResources: 0,
    })).toBe(false);
    expect(decideOutreachHistoryNotice(history({
      exactEmailConfirmed: false,
      signedJourneyConfirmed: false,
    }))).toEqual({ send: false, reason: "no_confirmed_outreach" });
    expect(confirmedPreviousOutreach({
      emailSent: 1,
      inboundReplies: 0,
      sentOutboundReplies: 0,
      acceptedOrDeliveredResources: 0,
    })).toBe(true);
    expect(resendResourceCountsAsSent("scheduled", null)).toBe(false);
    expect(resendResourceCountsAsSent("claimed", null)).toBe(false);
  });

  it("labels a different email as a signed journey, not an email match", () => {
    const built = buildEmailAcquiredMemberNotice(notice({
      sections: [
        {
          association: "signed_journey",
          acquisitionName: "Riley Prospect",
          acquisitionEmail: "riley@prospect.example",
          campaigns: [{
            id: CAMPAIGN_B,
            name: null,
            entries: [notice().sections[0].campaigns[0].entries[0]],
          }],
        },
      ],
    }));
    expect(built.text).toContain("Signed journey link.");
    expect(built.text).toContain("This is not an exact email match.");
    expect(built.text).toContain("riley@prospect.example");
    expect(built.text).toContain("campaign name not stored");
    expect(built.text).toContain(CAMPAIGN_B);
    expect(built.text).not.toContain("Exact email match.");
    expect(decideOutreachHistoryNotice(history({
      exactEmailConfirmed: false,
      signedJourneyConfirmed: true,
    })).send).toBe(true);
  });

  it("sends no history email for a Meta or Google member without confirmed outreach", () => {
    expect(journeyIdFromStripeMetadata({
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "prospecting",
      sourceNormalized: "meta",
    })).toBeNull();
    expect(decideOutreachHistoryNotice(history({
      exactEmailConfirmed: false,
      signedJourneyConfirmed: false,
    })).send).toBe(false);
  });

  it("does not send for the owner canary", () => {
    expect(decideOutreachHistoryNotice(history({ ownerCanary: true })).send).toBe(false);
  });

  it("keeps a second campaign's history out of the first campaign", () => {
    const reply = notice().sections[0].campaigns[0].entries[1];
    const send = notice().sections[0].campaigns[0].entries[0];
    const otherCampaign = "44444444-4444-4444-8444-444444444444";
    const grouped = groupHistoryByJourney(
      [
        { id: JOURNEY_B, campaignId: CAMPAIGN_B, name: "Tennessee coaches" },
        { id: JOURNEY_A, campaignId: otherCampaign, name: "Kentucky coaches" },
      ],
      [
        { at: reply.at, journeyId: JOURNEY_B, campaignId: CAMPAIGN_B, entry: reply },
        { at: send.at, journeyId: JOURNEY_A, campaignId: otherCampaign, entry: send },
        {
          at: "2026-10-21T12:00:00.000Z",
          journeyId: null,
          campaignId: CAMPAIGN_B,
          entry: { ...send, at: "2026-10-21T12:00:00.000Z" },
        },
      ],
    );
    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe(CAMPAIGN_B);
    expect(grouped[0].name).toBe("Tennessee coaches");
    expect(grouped[0].entries.map((entry) => entry.at)).toEqual([
      "2026-10-21T12:00:00.000Z",
      reply.at,
    ]);
    expect(grouped[1].id).toBe(otherCampaign);
    expect(grouped[1].name).toBe("Kentucky coaches");
    expect(grouped[1].entries).toHaveLength(1);
    const built = buildEmailAcquiredMemberNotice(notice({
      sections: [{
        association: "exact_email",
        acquisitionName: "Riley Coach",
        acquisitionEmail: "riley@school.example",
        campaigns: grouped,
      }],
    }));
    expect(built.text.indexOf("Can you send the guide?")).toBeLessThan(built.text.indexOf("Kentucky coaches"));
    expect(built.text.indexOf("Kentucky coaches")).toBeLessThan(built.text.lastIndexOf("Instantly outreach"));
  });

  it("labels missing outreach bodies as not reconstructed", () => {
    const section = notice().sections[0];
    const built = buildEmailAcquiredMemberNotice(notice({
      sections: [
        {
          ...section,
          campaigns: [{
            ...section.campaigns[0],
            entries: [section.campaigns[0].entries[0]],
          }],
        },
      ],
    }));
    expect(built.incomplete).toBe(true);
    expect(built.text).toContain("Part of this history is missing.");
    expect(built.text).toContain("Instantly outreach bodies are not stored.");
    expect(built.text).toContain("Body: not stored. This line is not a reconstructed email.");
    expect(built.text).not.toContain("I wrote this email");
  });

  it("does not send a second copy after the claim already exists", async () => {
    const send = vi.fn(async () => ({ state: "sent" as const, providerMessageId: "re_123" }));
    const outcome = await deliverEmailAcquiredMemberNotice({
      history: history(),
      notice: notice(),
      subscriptionId: "sub_new",
      credentialsReady: true,
      claim: async () => "skip",
      send,
      record: async () => undefined,
    });
    expect(outcome).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("returns failed when Resend fails and does not throw", async () => {
    const record = vi.fn(async () => undefined);
    const outcome = await deliverEmailAcquiredMemberNotice({
      history: history(),
      notice: notice(),
      subscriptionId: "sub_new",
      credentialsReady: true,
      claim: async () => "send",
      send: async () => {
        throw new Error("resend down");
      },
      record,
    });
    expect(outcome).toBe("failed");
    expect(record).toHaveBeenCalledWith("failed", null);
  });

  it("releases a failed claim so a later attempt can send, and keeps an accepted claim closed", () => {
    const now = Date.parse("2026-10-27T16:00:00.000Z");
    expect(decideNoticeClaim({ state: "failed", claimUntilMs: null, resendId: null }, now)).toBe("takeover");
    expect(decideNoticeClaim({
      state: "claim",
      claimUntilMs: now - 1000,
      resendId: null,
    }, now)).toBe("takeover");
    expect(decideNoticeClaim({
      state: "claim",
      claimUntilMs: now + 60_000,
      resendId: null,
    }, now)).toBe("skip");
    expect(decideNoticeClaim({
      state: "accepted",
      claimUntilMs: null,
      resendId: "re_123",
    }, now)).toBe("skip");
  });

  it("distinguishes scheduled, accepted, and delivered resources", () => {
    const scheduled = describeResendResource({ status: "scheduled", resource: "Definite Dozen", deliveredAt: null });
    const accepted = describeResendResource({ status: "accepted", resource: "Definite Dozen", deliveredAt: null });
    const delivered = describeResendResource({ status: "accepted", resource: "Definite Dozen", deliveredAt: "2026-10-23T16:10:00.000Z" });
    expect(scheduled).toContain("Resend has not accepted it");
    expect(scheduled).toContain("Delivery has not been recorded");
    expect(scheduled).not.toContain("Delivery was recorded");
    expect(accepted).toContain("Resend accepted this send");
    expect(accepted).toContain("Delivery has not been recorded");
    expect(delivered).toContain("Delivery was recorded.");
    expect(resendResourceCountsAsSent("scheduled", null)).toBe(false);
    expect(resendResourceCountsAsSent("claimed", null)).toBe(false);
    expect(resendResourceCountsAsSent("accepted", null)).toBe(true);
    expect(resendResourceCountsAsSent("delivered", null)).toBe(true);
    expect(ACQUISITION_JOURNEY_LINK_LIFETIME).toBe("rechecked_at_checkout_and_payment");
  });

  it("keeps the existing New Member email and does not send history on a renewal invoice", () => {
    const existing = readFileSync("src/lib/notify-member-subscribed.ts", "utf8");
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    const server = readFileSync("src/lib/acquisition/email-acquired-member-notice.server.ts", "utf8");
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const reconcile = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    const invoice = webhook.slice(webhook.indexOf('event.type === "invoice.paid"'));
    expect(existing).toContain("Reach out to new member — ${resolveSubjectLabel(args)}");
    expect(existing).toContain("Reach out to new member.");
    expect(existing).not.toContain("Previous outreach");
    expect(webhook.indexOf("await notifyMemberSubscribedInternal")).toBeLessThan(webhook.indexOf("await maybeNotifyEmailAcquiredMember"));
    expect(invoice).not.toContain("maybeNotifyEmailAcquiredMember");
    expect(activate.indexOf("await notifyConfirmedStripeFirstTrial")).toBeLessThan(activate.indexOf("await maybeNotifyEmailAcquiredMember"));
    expect(reconcile.indexOf("await notifyConfirmedStripeFirstTrial")).toBeLessThan(reconcile.indexOf("await maybeNotifyEmailAcquiredMember"));
    expect(server).toContain('eq("email_normalized", email)');
    expect(server).toContain('eq("event_type", "email_sent")');
    expect(server).not.toContain("instantly_lead_observed");
    expect(server).not.toContain("amountPaid");
    expect(server).not.toContain("otherChannelBlocksEmailNotice");
    expect(server).not.toContain("recovery_suppressions");
    expect(server).toContain("acquisition_journey_playbook_pins");
    expect(server).toContain("COACH_KIT_NOTIFY_EMAIL");
  });

  it("puts a signed journey on the trial link and leaves an unsigned link plain", () => {
    const token = signAcquisitionJourneyId(JOURNEY_B, SECRET);
    expect(readSignedAcquisitionJourneyId(token, SECRET)).toBe(JOURNEY_B);
    expect(readSignedAcquisitionJourneyId(token?.replace(/.$/, "x") ?? "", SECRET)).toBeNull();
    expect(readSignedAcquisitionJourneyId(JOURNEY_A, SECRET)).toBeNull();
    expect(acquisitionTrialCheckoutUrl(JOURNEY_B, SECRET)).toContain("/checkout/start?aj=");
    expect(acquisitionTrialCheckoutUrl(null, SECRET)).toBe("https://summittmindset.com/checkout/start");
    expect(acquisitionTrialCheckoutUrl(JOURNEY_B, "short")).toBe("https://summittmindset.com/checkout/start");
  });
});
