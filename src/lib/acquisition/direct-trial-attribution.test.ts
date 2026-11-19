import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  acquisitionCampaignTrialUrl,
  acquisitionSubscriptionCredit,
  campaignIdFromStripeMetadata,
  directTrialIdentity,
  mergeSubscriptionCredit,
  readSignedAcquisitionCampaignId,
  readSignedAcquisitionJourneyId,
  signAcquisitionCampaignId,
  signAcquisitionJourneyId,
  subscriptionLedgerDecision,
  type AcquisitionSubscriptionCredit,
} from "@/lib/acquisition/email-acquired-member-notice";

const SECRET = "test-secret-at-least-16";
const CAMPAIGN = "camp_pat_direct";
const OTHER = "camp_other";
const JOURNEY = "11111111-1111-4111-8111-111111111111";

describe("direct trial campaign attribution", () => {
  it("signs one reusable campaign link and rejects a tampered token", () => {
    const token = signAcquisitionCampaignId(CAMPAIGN, SECRET);
    const url = acquisitionCampaignTrialUrl(CAMPAIGN, SECRET);
    expect(token).toBeTruthy();
    expect(url).toBe(`https://summittmindset.com/checkout/start?ac=${encodeURIComponent(token ?? "")}`);
    expect(readSignedAcquisitionCampaignId(token, SECRET)).toBe(CAMPAIGN);
    expect(readSignedAcquisitionCampaignId(`${CAMPAIGN}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, SECRET)).toBeNull();
    expect(readSignedAcquisitionCampaignId(token, "another-secret-16c")).toBeNull();
    expect(readSignedAcquisitionCampaignId(CAMPAIGN, SECRET)).toBeNull();
    expect(signAcquisitionCampaignId("bad campaign", SECRET)).toBeNull();
    const journey = signAcquisitionJourneyId(JOURNEY, SECRET);
    expect(readSignedAcquisitionCampaignId(journey, SECRET)).toBeNull();
    expect(readSignedAcquisitionJourneyId(token, SECRET)).toBeNull();
  });

  it("credits a valid campaign link as a trial and the later payment", () => {
    const trial = acquisitionSubscriptionCredit({ verifiedJourney: null, campaignLinkId: CAMPAIGN });
    const paid = acquisitionSubscriptionCredit({ verifiedJourney: null, campaignLinkId: CAMPAIGN });
    expect(trial).toEqual({ attribution: "campaign_link", campaignId: CAMPAIGN, journeyId: null });
    expect(paid).toEqual(trial);
    expect(directTrialIdentity({ personFound: true, credit: trial })).toMatchObject({
      record: true,
      linkPerson: true,
    });
  });

  it("keeps the same subscription event id so a webhook retry is not a second trial or payment", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const trial = store.slice(
      store.indexOf("export async function noteAcquisitionTrial"),
      store.indexOf("export async function noteAcquisitionClerk"),
    );
    const paid = store.slice(
      store.indexOf("export async function noteAcquisitionPaid"),
      store.indexOf("export async function noteAcquisitionClosed"),
    );
    const recorder = store.slice(
      store.indexOf("async function recordSubscriptionEvent"),
      store.indexOf("async function linkTrialSignal"),
    );
    expect(trial).toContain("`trial:subscription:${args.subscriptionId}`");
    expect(paid).toContain("`paid:subscription:${args.subscriptionId}`");
    expect(trial).toContain("recordSubscriptionEvent");
    expect(paid).toContain("recordSubscriptionEvent");
    expect(recorder.indexOf("stripeProviderEvent")).toBeLessThan(recorder.indexOf("insertEvent"));
    expect(recorder).toContain("subscriptionLedgerDecision");
    expect(recorder).toContain("attachStripeSubscriptionEvent");
    expect(trial).not.toContain("ensurePerson");
    expect(paid).not.toContain("ensurePerson");
  });

  it("attributes a payment from campaign metadata when the trial note never stored the subscription", () => {
    const credit = acquisitionSubscriptionCredit({ verifiedJourney: null, campaignLinkId: CAMPAIGN });
    const identity = directTrialIdentity({ personFound: true, credit });
    expect(identity.linkPerson).toBe(true);
    expect(identity.credit.campaignId).toBe(CAMPAIGN);
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const paid = store.slice(
      store.indexOf("export async function noteAcquisitionPaid"),
      store.indexOf("export async function noteAcquisitionClosed"),
    );
    expect(paid.indexOf("findPersonByEmail")).toBeGreaterThan(-1);
    expect(paid).toContain("stripe_subscription_id: args.subscriptionId");
  });

  it("does not let a campaign link override a verified journey", () => {
    const credit = acquisitionSubscriptionCredit({
      verifiedJourney: { journeyId: JOURNEY, campaignId: OTHER },
      campaignLinkId: CAMPAIGN,
    });
    expect(credit).toEqual({ attribution: "journey", campaignId: OTHER, journeyId: JOURNEY });
  });

  it("leaves a checkout with no valid campaign unattributed", () => {
    const credit = acquisitionSubscriptionCredit({ verifiedJourney: null, campaignLinkId: null });
    expect(credit.attribution).toBe("unattributed");
    expect(directTrialIdentity({ personFound: false, credit }).record).toBe(false);
    expect(directTrialIdentity({ personFound: true, credit })).toMatchObject({ record: true, linkPerson: true });
  });

  it("records a campaign trial without inventing a person when the checkout email does not match", () => {
    const credit = acquisitionSubscriptionCredit({ verifiedJourney: null, campaignLinkId: CAMPAIGN });
    expect(directTrialIdentity({ personFound: false, credit })).toEqual({
      record: true,
      linkPerson: false,
      credit,
    });
  });

  it("does not link a subscription that already belongs to a different person record", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    expect(store).toContain("person.stripe_subscription_id === args.subscriptionId");
    const session = readFileSync("src/app/api/stripe/create-checkout-session/route.ts", "utf8");
    expect(session.indexOf("isTruthySubscribed")).toBeLessThan(
      session.indexOf("sessionMetadata[ACQUISITION_CAMPAIGN_METADATA_KEY]"),
    );
    expect(session).toContain('src === "coach"');
  });

  it("carries the verified campaign through both checkout paths and Stripe metadata", () => {
    const signedIn = readFileSync("src/app/api/stripe/create-checkout-session/route.ts", "utf8");
    const loggedOut = readFileSync("src/app/api/checkout/stripe-first/start/route.ts", "utf8");
    const hosted = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    const reconcile = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    for (const source of [signedIn, loggedOut]) {
      expect(source).toContain("verifiedAcquisitionCampaignId");
    }
    expect(hosted.match(/ACQUISITION_CAMPAIGN_METADATA_KEY/g)?.length).toBeGreaterThanOrEqual(2);
    expect(signedIn.match(/ACQUISITION_CAMPAIGN_METADATA_KEY/g)?.length).toBeGreaterThanOrEqual(2);
    expect(webhook).toContain("campaignId: campaignIdFromStripeMetadata(subscription.metadata)");
    expect(reconcile).toContain("campaignId: campaignIdFromStripeMetadata(proof.subscription.metadata)");
    expect(campaignIdFromStripeMetadata({ acquisitionCampaignId: CAMPAIGN })).toBe(CAMPAIGN);
    expect(campaignIdFromStripeMetadata({ acquisitionCampaignId: "bad campaign" })).toBeNull();
  });
});

const CAMPAIGN_CREDIT: AcquisitionSubscriptionCredit = {
  attribution: "campaign_link",
  campaignId: CAMPAIGN,
  journeyId: null,
};
const JOURNEY_CREDIT: AcquisitionSubscriptionCredit = {
  attribution: "journey",
  campaignId: OTHER,
  journeyId: JOURNEY,
};
const SAME_EMAIL = "coach@example.com";

describe("subscription event order", () => {
  it("does not consume the trial key when the subscription update arrives before checkout", () => {
    expect(subscriptionLedgerDecision({
      email: null,
      personLinkable: false,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "ignore" });
  });

  it("links the person when checkout arrives first and ignores the later subscription update", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: true });
    expect(subscriptionLedgerDecision({
      email: null,
      personLinkable: true,
      existing: "linked",
      existingCheckoutEmail: SAME_EMAIL,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "ignore" });
  });

  it("ignores a repeated webhook after the person is linked", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "linked",
      existingCheckoutEmail: SAME_EMAIL,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "ignore" });
  });

  it("does not record a trial when the email and the person are both missing", () => {
    expect(subscriptionLedgerDecision({
      email: null,
      personLinkable: false,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: { attribution: "unattributed", campaignId: null, journeyId: null },
    })).toEqual({ action: "ignore" });
  });

  it("links the same email as the prospect", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: true });
  });

  it("records a different checkout email without linking a person", () => {
    expect(subscriptionLedgerDecision({
      email: "payer@example.com",
      personLinkable: false,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: false });
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "unlinked",
      existingCheckoutEmail: "payer@example.com",
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "ignore" });
  });

  it("attaches a later matching email to the unlinked trial without a second event", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "unlinked",
      existingCheckoutEmail: SAME_EMAIL,
      credit: JOURNEY_CREDIT,
    })).toEqual({ action: "attach" });
    expect(mergeSubscriptionCredit(CAMPAIGN_CREDIT, JOURNEY_CREDIT)).toEqual(JOURNEY_CREDIT);
    expect(mergeSubscriptionCredit(JOURNEY_CREDIT, CAMPAIGN_CREDIT)).toEqual(JOURNEY_CREDIT);
  });

  it("records a payment before the trial is linked, and still links the trial when the email matches", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: true });
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "unlinked",
      existingCheckoutEmail: SAME_EMAIL,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "attach" });
  });

  it("does not attach a subscription that already belongs to another person record", () => {
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: false,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: false });
    expect(subscriptionLedgerDecision({
      email: SAME_EMAIL,
      personLinkable: true,
      existing: "linked",
      existingCheckoutEmail: SAME_EMAIL,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "ignore" });
  });

  it("can record the trial after the subscription id is already saved on the person", () => {
    expect(subscriptionLedgerDecision({
      email: null,
      personLinkable: true,
      existing: "absent",
      existingCheckoutEmail: null,
      credit: CAMPAIGN_CREDIT,
    })).toEqual({ action: "insert", linkPerson: true });
  });
});
