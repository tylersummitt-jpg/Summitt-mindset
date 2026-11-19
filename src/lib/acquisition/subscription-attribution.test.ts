import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildDistributionCommand,
  emptyInstantlyRead,
  type LedgerEvent,
  type LedgerPerson,
} from "@/lib/acquisition/distribution-command";
import {
  attributionFromVerifiedJourney,
  journeyIdFromStripeMetadata,
} from "@/lib/acquisition/email-acquired-member-notice";

const JOURNEY = "11111111-1111-4111-8111-111111111111";
const OTHER_JOURNEY = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-27T16:00:00.000Z");
const START = Date.parse("2026-10-26T04:00:00.000Z");
const END = Date.parse("2026-10-28T04:00:00.000Z");

function person(id: string, sourceCampaign: string | null): LedgerPerson {
  return {
    id,
    lifecycle: "cold_active",
    sourceCampaign,
    sport: null,
    role: null,
    geography: null,
    offerKey: null,
  };
}

function stripeEvent(patch: Partial<LedgerEvent> & Pick<LedgerEvent, "eventType" | "personId">): LedgerEvent {
  return {
    provider: "stripe",
    providerEventId: `${patch.personId}:${patch.eventType}`,
    occurredAt: "2026-10-26T12:00:00.000Z",
    campaignId: null,
    journeyId: null,
    sender: null,
    rawInstantlyType: null,
    step: null,
    ...patch,
  };
}

function report(events: LedgerEvent[], people: LedgerPerson[]) {
  return buildDistributionCommand({
    readable: true,
    truncated: false,
    rangeLabel: "Last 7 days",
    startMs: START,
    endMs: END,
    nowMs: NOW,
    people,
    events,
    actions: [],
    messages: [],
    openJourneys: 0,
    closedJourneys: 0,
    peopleWithJourney: 0,
    instantly: emptyInstantlyRead("missing", "missing_api_key"),
  });
}

describe("verified journey attribution", () => {
  it("credits the journey campaign only when that journey belongs to the person", () => {
    const journey = { id: JOURNEY, personId: "person-1", campaignId: "camp-video" };
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: JOURNEY.toUpperCase(),
      journey,
      personId: "person-1",
    })).toEqual({ journeyId: JOURNEY, campaignId: "camp-video" });
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: JOURNEY,
      journey,
      personId: "someone-else",
    })).toBeNull();
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: OTHER_JOURNEY,
      journey,
      personId: "person-1",
    })).toBeNull();
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: `${JOURNEY}.not-a-verified-token`,
      journey,
      personId: "person-1",
    })).toBeNull();
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: null,
      journey,
      personId: "person-1",
    })).toBeNull();
    expect(attributionFromVerifiedJourney({
      requestedJourneyId: JOURNEY,
      journey: { ...journey, campaignId: "  " },
      personId: "person-1",
    })).toBeNull();
    expect(journeyIdFromStripeMetadata({ acquisitionJourneyId: JOURNEY })).toBe(JOURNEY);
    expect(journeyIdFromStripeMetadata({})).toBeNull();
    expect(journeyIdFromStripeMetadata({ acquisitionJourneyId: "not-a-journey" })).toBeNull();
  });

  it("counts a verified trial and the later paid event once, on that campaign", () => {
    const built = report([
      stripeEvent({
        personId: "person-1",
        eventType: "trial_started",
        providerEventId: "trial:subscription:sub_1",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
      stripeEvent({
        personId: "person-1",
        eventType: "trial_started",
        providerEventId: "trial:evt_retry",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
      stripeEvent({
        personId: "person-1",
        eventType: "paid_member",
        providerEventId: "paid:subscription:sub_1",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
      stripeEvent({
        personId: "person-1",
        eventType: "paid_member",
        providerEventId: "paid:evt_retry",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
    ], [person("person-1", "camp-other")]);
    const video = built.campaigns.find((campaign) => campaign.id === "camp-video");
    const other = built.campaigns.find((campaign) => campaign.id === "camp-other");
    expect(video?.attributedTrials).toBe(1);
    expect(video?.attributedPaid).toBe(1);
    expect(other?.attributedTrials).toBe(0);
    expect(other?.attributedPaid).toBe(0);
    expect(other?.peopleStored).toBe(1);
    expect(built.attributedTrialPeople).toBe(1);
    expect(built.attributedPaidPeople).toBe(1);
    expect(built.emailOnlyTrialPeople).toBe(0);
  });

  it("keeps an email match, a campaign id without a journey, and a second campaign off the verified count", () => {
    const built = report([
      stripeEvent({ personId: "email-only", eventType: "trial_started" }),
      stripeEvent({
        personId: "email-only",
        eventType: "paid_member",
        providerEventId: "paid:email-only",
      }),
      stripeEvent({
        personId: "missing-journey",
        eventType: "trial_started",
        providerEventId: "trial:campaign-without-journey",
        campaignId: "camp-video",
        journeyId: null,
      }),
      stripeEvent({
        personId: "other-campaign",
        eventType: "trial_started",
        providerEventId: "trial:other",
        campaignId: "camp-other",
        journeyId: OTHER_JOURNEY,
      }),
      stripeEvent({
        personId: "outside",
        eventType: "trial_started",
        providerEventId: "trial:old",
        campaignId: "camp-video",
        journeyId: JOURNEY,
        occurredAt: "2026-10-01T12:00:00.000Z",
      }),
    ], [
      person("email-only", "camp-video"),
      person("other-campaign", "camp-video"),
    ]);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-video")?.attributedTrials).toBe(0);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-video")?.campaignLinkTrials).toBe(1);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-other")?.attributedTrials).toBe(1);
    expect(built.attributedTrialPeople).toBe(1);
    expect(built.campaignLinkTrialPeople).toBe(1);
    expect(built.emailOnlyTrialPeople).toBe(1);
    expect(built.emailOnlyPaidPeople).toBe(1);
    expect(built.attributedPaidPeople).toBe(0);
    expect(built.unlinkedCampaignTrialEvents).toBe(0);
  });
});

describe("campaign-link distribution", () => {
  it("counts journey trials and payments separately from campaign-link trials and payments", () => {
    const built = report([
      stripeEvent({
        personId: "journey-person",
        eventType: "trial_started",
        providerEventId: "trial:journey",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
      stripeEvent({
        personId: "journey-person",
        eventType: "paid_member",
        providerEventId: "paid:journey",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
      stripeEvent({
        personId: "link-person",
        eventType: "trial_started",
        providerEventId: "trial:link",
        campaignId: "camp-video",
        journeyId: null,
      }),
      stripeEvent({
        personId: "link-person",
        eventType: "paid_member",
        providerEventId: "paid:link",
        campaignId: "camp-video",
        journeyId: null,
      }),
    ], [person("journey-person", "camp-video"), person("link-person", "camp-video")]);
    const video = built.campaigns.find((campaign) => campaign.id === "camp-video");
    expect(video?.attributedTrials).toBe(1);
    expect(video?.attributedPaid).toBe(1);
    expect(video?.campaignLinkTrials).toBe(1);
    expect(video?.campaignLinkPaid).toBe(1);
    expect(built.attributedTrialPeople).toBe(1);
    expect(built.attributedPaidPeople).toBe(1);
    expect(built.campaignLinkTrialPeople).toBe(1);
    expect(built.campaignLinkPaidPeople).toBe(1);
    expect(built.emailOnlyTrialPeople).toBe(0);
    expect(built.emailOnlyPaidPeople).toBe(0);
  });

  it("counts a campaign-link checkout with no person as an event, not a prospect", () => {
    const built = report([
      stripeEvent({
        personId: null,
        eventType: "trial_started",
        providerEventId: "trial:unlinked",
        campaignId: "camp-video",
        journeyId: null,
      }),
      stripeEvent({
        personId: null,
        eventType: "paid_member",
        providerEventId: "paid:unlinked",
        campaignId: "camp-video",
        journeyId: null,
      }),
    ], []);
    const video = built.campaigns.find((campaign) => campaign.id === "camp-video");
    expect(video?.campaignLinkTrials).toBe(0);
    expect(video?.campaignLinkPaid).toBe(0);
    expect(video?.unlinkedCampaignTrialEvents).toBe(1);
    expect(video?.unlinkedCampaignPaidEvents).toBe(1);
    expect(built.campaignLinkTrialPeople).toBe(0);
    expect(built.campaignLinkPaidPeople).toBe(0);
    expect(built.unlinkedCampaignTrialEvents).toBe(1);
    expect(built.unlinkedCampaignPaidEvents).toBe(1);
    expect(built.attributedTrialPeople).toBe(0);
    expect(built.emailOnlyTrialPeople).toBe(0);
  });

  it("keeps a Stripe event with no campaign off campaign credit", () => {
    const built = report([
      stripeEvent({
        personId: "email-only",
        eventType: "trial_started",
        providerEventId: "trial:none",
        campaignId: null,
        journeyId: null,
      }),
      stripeEvent({
        personId: null,
        eventType: "paid_member",
        providerEventId: "paid:none",
        campaignId: null,
        journeyId: null,
      }),
    ], [person("email-only", null)]);
    expect(built.emailOnlyTrialPeople).toBe(1);
    expect(built.emailOnlyPaidPeople).toBe(0);
    expect(built.campaignLinkTrialPeople).toBe(0);
    expect(built.campaignLinkPaidPeople).toBe(0);
    expect(built.attributedTrialPeople).toBe(0);
    expect(built.attributedPaidPeople).toBe(0);
    expect(built.unlinkedCampaignTrialEvents).toBe(0);
    expect(built.unlinkedCampaignPaidEvents).toBe(0);
    expect(built.campaigns.every((campaign) => campaign.campaignLinkTrials === 0 && campaign.attributedTrials === 0)).toBe(true);
  });

  it("counts one conversion when the same Stripe event is delivered twice", () => {
    const trial = stripeEvent({
      personId: "link-person",
      eventType: "trial_started",
      providerEventId: "trial:subscription:sub_1",
      campaignId: "camp-video",
      journeyId: null,
    });
    const paid = stripeEvent({
      personId: "link-person",
      eventType: "paid_member",
      providerEventId: "paid:subscription:sub_1",
      campaignId: "camp-video",
      journeyId: null,
    });
    const built = report([trial, trial, paid, paid], [person("link-person", "camp-video")]);
    expect(built.campaignLinkTrialPeople).toBe(1);
    expect(built.campaignLinkPaidPeople).toBe(1);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-video")?.campaignLinkTrials).toBe(1);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-video")?.campaignLinkPaid).toBe(1);
  });

  it("keeps an older journey-verified trial out of the current range and still counts one inside it", () => {
    const built = report([
      stripeEvent({
        personId: "old-person",
        eventType: "trial_started",
        providerEventId: "trial:old",
        campaignId: "camp-video",
        journeyId: JOURNEY,
        occurredAt: "2026-10-01T12:00:00.000Z",
      }),
      stripeEvent({
        personId: "current-person",
        eventType: "trial_started",
        providerEventId: "trial:current",
        campaignId: "camp-video",
        journeyId: JOURNEY,
      }),
    ], [person("old-person", "camp-video"), person("current-person", "camp-video")]);
    expect(built.attributedTrialPeople).toBe(1);
    expect(built.campaigns.find((campaign) => campaign.id === "camp-video")?.attributedTrials).toBe(1);
    expect(built.campaignLinkTrialPeople).toBe(0);
  });
});

describe("subscription attribution wiring", () => {
  it("stores the verified journey on the trial and paid events and passes Stripe metadata through", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const trial = store.slice(
      store.indexOf("export async function noteAcquisitionTrial"),
      store.indexOf("export async function noteAcquisitionClerk"),
    );
    const paid = store.slice(
      store.indexOf("export async function noteAcquisitionPaid"),
      store.indexOf("export async function noteAcquisitionClosed"),
    );
    const helper = store.slice(
      store.indexOf("async function verifiedCampaignJourney"),
      store.indexOf("export async function noteAcquisitionTrial"),
    );
    expect(helper).toContain("attributionFromVerifiedJourney");
    expect(helper).not.toContain("source_campaign");
    expect(trial).toContain("trial:subscription:");
    expect(trial).toContain("verifiedCampaignJourney");
    expect(trial).not.toContain("source_campaign");
    expect(trial.indexOf("subscriptionLifecycleEvent")).toBeLessThan(trial.indexOf("recordSubscriptionEvent"));
    expect(paid).toContain("paid:subscription:");
    expect(paid).toContain('reason: "paid_member"');
    expect(paid).not.toContain("source_campaign");

    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(webhook.match(/journeyId: journeyIdFromStripeMetadata\(subscription\.metadata\)/g)?.length).toBe(4);
    const reconcile = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    expect(reconcile).toContain("journeyId: journeyIdFromStripeMetadata(proof.subscription.metadata)");
  });
});
