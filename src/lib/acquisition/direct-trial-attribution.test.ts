import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { freePdfCheckoutHref, freePdfCoachKitHref, freePdfCoachKitPageHref } from "@/lib/free-pdf";
import {
  acquisitionCampaignDefiniteDozenUrl,
  acquisitionCampaignLeadershipKitUrl,
  acquisitionCampaignPlaybookUrl,
  acquisitionCampaignTrialUrl,
  acquisitionSubscriptionCredit,
  campaignIdFromStripeMetadata,
  directTrialIdentity,
  mergeSubscriptionCredit,
  readSignedAcquisitionCampaignId,
  readSignedAcquisitionJourneyId,
  signAcquisitionCampaignId,
  signAcquisitionJourneyId,
  signedCampaignGuideUrl,
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

  it("signs the basketball playbook for a campaign without using a journey link", () => {
    const pat = "3d63c904-1c4f-4bd2-bc95-52f9a996318d";
    const url = acquisitionCampaignPlaybookUrl(pat, SECRET);
    const token = signAcquisitionCampaignId(pat, SECRET);
    expect(url).toBe(`https://summittmindset.com/free/basketball-playbook?ac=${encodeURIComponent(token ?? "")}`);
    expect(readSignedAcquisitionCampaignId(token, SECRET)).toBe(pat);
    expect(url).not.toContain("aj=");
    expect(acquisitionCampaignPlaybookUrl(pat, "short")).toBeNull();
  });

  it("signs the Definite Dozen page for coaches and athletic directors", () => {
    const director = "camp_director";
    const soccer = "camp_soccer";
    const basketballId = "3d63c904-1c4f-4bd2-bc95-52f9a996318d";
    const token = signAcquisitionCampaignId(director, SECRET);
    const dozen = acquisitionCampaignDefiniteDozenUrl(director, SECRET);
    expect(dozen).toBe(`https://summittmindset.com/free/definite-dozen?ac=${encodeURIComponent(token ?? "")}`);
    expect(dozen).not.toContain("basketball-playbook");
    expect(dozen).not.toContain("athletic-director");
    expect(readSignedAcquisitionCampaignId(token, SECRET)).toBe(director);
    expect(readSignedAcquisitionCampaignId(`${director}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, SECRET)).toBeNull();
    expect(freePdfCheckoutHref("/checkout/start", token)).toBe(
      `/checkout/start?ac=${encodeURIComponent(token ?? "")}`,
    );
    expect(freePdfCheckoutHref("/checkout/start?plan=annual", token)).toBe(
      `/checkout/start?plan=annual&ac=${encodeURIComponent(token ?? "")}`,
    );
    expect(freePdfCheckoutHref("/checkout/start", "not a token")).toBe("/checkout/start");

    const directorLink = signedCampaignGuideUrl(director, SECRET, [
      { resources: [] },
      { resources: ["definite_dozen_ad"] },
    ]);
    const coachLink = signedCampaignGuideUrl(soccer, SECRET, [
      { resources: ["definite_dozen"] },
    ]);
    expect(directorLink).toEqual({ ok: true, url: acquisitionCampaignDefiniteDozenUrl(director, SECRET) });
    expect(coachLink).toEqual({ ok: true, url: acquisitionCampaignDefiniteDozenUrl(soccer, SECRET) });

    expect(signedCampaignGuideUrl(basketballId, SECRET, [
      { resources: ["playbook"] },
      { resources: ["definite_dozen"] },
    ])).toEqual({ ok: true, url: acquisitionCampaignPlaybookUrl(basketballId, SECRET) });
    expect(signedCampaignGuideUrl(basketballId, SECRET, [{ resources: [] }, { resources: ["playbook"] }])).toEqual({
      ok: true,
      url: acquisitionCampaignPlaybookUrl(basketballId, SECRET),
    });
    expect(signedCampaignGuideUrl(basketballId, SECRET, [])).toEqual({
      ok: true,
      url: acquisitionCampaignPlaybookUrl(basketballId, SECRET),
    });
    expect(signedCampaignGuideUrl(director, SECRET, [{ resources: ["playbook", "definite_dozen_ad"] }])).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(acquisitionCampaignDefiniteDozenUrl(director, "short")).toBeNull();
    expect(signedCampaignGuideUrl(director, "short", [{ resources: ["definite_dozen"] }])).toEqual({
      ok: false,
      reason: "unsigned",
    });
  });

  it("signs a separate Leadership Kit offer link for each letter campaign", () => {
    const campaigns = [
      "f8081c58-a0bf-46b6-9ad2-49d9456fe10d",
      "3be02e5e-6ffc-4521-a6ba-6568d6030783",
      "1825a4e6-9f9f-4e50-b1ca-f1ac52f3fa98",
      "674a4089-4df0-46c9-9e91-a3e06f257b5c",
    ];
    const urls = campaigns.map((id) => {
      const url = acquisitionCampaignLeadershipKitUrl(id, SECRET);
      const token = signAcquisitionCampaignId(id, SECRET);
      expect(url).toBe(`https://summittmindset.com/coach-leadership-kit?ac=${encodeURIComponent(token ?? "")}`);
      expect(url).not.toContain("basketball-playbook");
      expect(url).not.toContain("definite-dozen");
      expect(readSignedAcquisitionCampaignId(new URL(url ?? "").searchParams.get("ac"), SECRET)).toBe(id);
      expect(freePdfCoachKitHref(false, token)).toBe(
        `/sign-up?redirect_url=${encodeURIComponent(`/subscribe?src=coach&ac=${encodeURIComponent(token ?? "")}`)}`,
      );
      expect(freePdfCoachKitHref(true, token)).toBe(`/subscribe?src=coach&ac=${encodeURIComponent(token ?? "")}`);
      expect(freePdfCoachKitPageHref("/coach-leadership-kit/how-it-works", token)).toBe(
        `/coach-leadership-kit/how-it-works?ac=${encodeURIComponent(token ?? "")}`,
      );
      expect(readSignedAcquisitionCampaignId(`${id}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, SECRET)).toBeNull();
      return url;
    });
    expect(new Set(urls).size).toBe(4);
    expect(acquisitionCampaignLeadershipKitUrl(campaigns[0]!, "short")).toBeNull();
    expect(freePdfCoachKitHref(false, "not a token")).toBe("/sign-up?redirect_url=%2Fsubscribe%3Fsrc%3Dcoach");
    expect(freePdfCoachKitPageHref("/coach-leadership-kit", "not a token")).toBe("/coach-leadership-kit");

    const basketball = "3d63c904-1c4f-4bd2-bc95-52f9a996318d";
    expect(acquisitionCampaignPlaybookUrl(basketball, SECRET)).toBe(
      `https://summittmindset.com/free/basketball-playbook?ac=${encodeURIComponent(signAcquisitionCampaignId(basketball, SECRET) ?? "")}`,
    );
    expect(acquisitionCampaignDefiniteDozenUrl(campaigns[0]!, SECRET)).toContain("/free/definite-dozen?ac=");

    const kitPage = readFileSync("src/app/coach-leadership-kit/page.tsx", "utf8");
    const how = readFileSync("src/app/coach-leadership-kit/how-it-works/page.tsx", "utf8");
    const subscribe = readFileSync("src/app/subscribe/page.tsx", "utf8");
    const panel = readFileSync("src/app/subscribe/subscribe-checkout-panel.tsx", "utf8");
    const session = readFileSync("src/app/api/stripe/create-checkout-session/route.ts", "utf8");
    const shipping = readFileSync("src/app/api/coach/shipping/route.ts", "utf8");
    expect(kitPage).toContain("freePdfCoachKitHref");
    expect(kitPage).toContain("Pat Summitt Leadership Kit");
    expect(kitPage).toContain("Shipping is covered.");
    expect(how).toContain("The Leadership Kit is a coach bonus");
    expect(subscribe).toContain("isSubscribedFromPublicMetadata");
    expect(subscribe).toContain('redirect("/post-sign-in")');
    expect(panel).toContain("7-day free trial");
    expect(panel).toContain("Then $29/month");
    expect(panel).toContain("We reach out to ship your Leadership Kit");
    expect(panel).toContain("src: \"coach\"");
    expect(panel).toContain("acquisitionCampaignToken");
    expect(session).toContain('sessionMetadata.summittAcquisition = "coach"');
    expect(session.indexOf('if (src === "coach")')).toBeLessThan(session.indexOf("if (acquisitionCampaignId)"));
    expect(session).toContain("You already have an active Summitt Mindset membership.");
    expect(shipping).toContain('md?.acquisitionSource !== "coach"');
    expect(shipping).toContain("Finish onboarding before submitting Kit shipping.");
    expect(shipping).toContain("Address already submitted");
    expect(readFileSync("src/app/free/basketball-playbook/page.tsx", "utf8")).not.toContain("acquisitionCampaignLeadershipKitUrl");
    expect(readFileSync("src/app/api/admin/acquisition/playbook-link/route.ts", "utf8")).toContain('body?.kind === "kit"');
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
