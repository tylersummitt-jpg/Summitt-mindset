import { describe, expect, it } from "vitest";

import {
  attributionLevel,
  cohortEconomics,
  outboundCtr,
  recommend,
  type AdLabAdCard,
  type AdLabExperimentView,
  type AdLabOutcomePerson,
} from "@/lib/ad-lab-product-pure";

const ads = [
  { metaAdId: "1111111111", campaignId: "2222222222" },
  { metaAdId: "3333333333", campaignId: "2222222222" },
];

describe("ad lab attribution", () => {
  it("matches a trial to an ad only when first-touch content is that ad id", () => {
    expect(
      attributionLevel({ utmContent: "1111111111", utmCampaign: "2222222222" }, ads)
    ).toEqual({ level: "ad", metaAdId: "1111111111" });
  });

  it("does not treat a human label or fbclid as an ad", () => {
    expect(attributionLevel({ utmContent: "hook-a", utmCampaign: "spring" }, ads)).toEqual({
      level: "none",
    });
    expect(attributionLevel({ utmContent: "fb.1.123", utmCampaign: null }, ads).level).toBe("none");
  });

  it("keeps a numeric campaign id at campaign level when it is not an ad id", () => {
    expect(attributionLevel({ utmContent: "hook-a", utmCampaign: "2222222222" }, ads)).toEqual({
      level: "campaign",
      campaignId: "2222222222",
    });
  });

  it("leaves outbound CTR empty when impressions were not reported", () => {
    expect(outboundCtr(4, null)).toBeNull();
    expect(outboundCtr(0, 100)).toBe(0);
  });
});

describe("ad lab recommendation", () => {
  it("does not invent a next ad when delivery has not been stored", () => {
    const result = recommend({
      ads: [],
      experiments: [],
      stale: false,
      lastImportedAt: null,
      adAttributedTrials: 0,
      campaignOnlyTrials: 0,
      unattributedTrials: 0,
      paymentsKnown: true,
      subscriptionsComplete: true,
      attributionComplete: true,
    });
    expect(result.next).toMatch(/next import/i);
  });

  it("holds a comparison that does not have enough evidence", () => {
    const card = {
      trials: 0,
      stillTrialing: 0,
      impressions: 10,
      outboundClicks: 1,
      landingPageViews: 1,
      status: "ACTIVE",
      paidMonthly: 0,
      paidAnnual: 0,
    } as AdLabAdCard;
    const experiment = {
      status: "active",
      evidence: "Not enough evidence",
      comparisonNote: "Still too small.",
      hypothesis: "The first line is the difference.",
      variableTested: "",
    } as AdLabExperimentView;
    const result = recommend({
      ads: [card],
      experiments: [experiment],
      stale: false,
      lastImportedAt: "2026-11-12T12:00:00.000Z",
      adAttributedTrials: 0,
      campaignOnlyTrials: 0,
      unattributedTrials: 0,
      paymentsKnown: true,
      subscriptionsComplete: true,
      attributionComplete: true,
    });
    expect(result.next).toMatch(/Hold this comparison/);
  });
});

describe("ad lab cohort economics", () => {
  const identities = [{ metaAdId: "1111111111", campaignId: "2222222222" }];
  const days = [
    {
      metaAdId: "1111111111",
      spendDate: "2026-11-10",
      spendCents: 1000,
      impressions: 100,
      outboundClicks: 10,
      landingPageViews: 8,
    },
  ];

  function person(start: string, trialing: boolean): AdLabOutcomePerson {
    const unix = Math.floor(Date.parse(`${start}T16:00:00.000Z`) / 1000);
    return {
      clerkUserId: start,
      utmContent: "1111111111",
      utmCampaign: "2222222222",
      trialStartUnix: unix,
      trialEndUnix: unix + 7 * 86400,
      trialing,
      paid: trialing ? false : true,
      interval: "month",
    };
  }

  it("does not divide this period's spend by a trial that started later", () => {
    const economics = cohortEconomics({
      days,
      metaAdId: "1111111111",
      since: "2026-11-10",
      until: "2026-11-10",
      people: [person("2026-11-12", false)],
      identities,
      timezone: "America/New_York",
      paymentsKnown: true,
      reliable: true,
      covered: true,
    });
    expect(economics.trials).toBe(0);
    expect(economics.trialsAfterWindow).toBe(1);
    expect(economics.costPerTrialCents).toBeNull();
    expect(economics.costPerPaidCents).toBeNull();
  });

  it("uses spend and trial start from the same dates, and waits to price a paying subscriber", () => {
    const economics = cohortEconomics({
      days,
      metaAdId: "1111111111",
      since: "2026-11-10",
      until: "2026-11-10",
      people: [person("2026-11-10", true)],
      identities,
      timezone: "America/New_York",
      paymentsKnown: true,
      reliable: true,
      covered: true,
    });
    expect(economics.trials).toBe(1);
    expect(economics.costPerTrialCents).toBe(1000);
    expect(economics.costPerPaidCents).toBeNull();
    expect(economics.economicsNote).toMatch(/still trialing/i);
  });
});
