import { describe, expect, it } from "vitest";

import {
  aggregateTrafficSourceRows,
  adSpendDisplayStatus,
  blendedCostPerPaidCents,
  buildLatestTrialRows,
  computeGrowthSnapshot,
  conversionRate,
  countActivePaidMembers,
  formatAdvertisingSpendDisplay,
  formatCostPerPaidDisplay,
  formatLatestTrialSignedUp,
  formatPersonFlag,
  formatUnknownableCount,
  formatUnknownablePercent,
  formatUnknownableUsdFromCents,
  growthPeriodUtcMs,
  isStripePaidActive,
  LATEST_TRIALS_LIMIT,
  mrrCentsFromStripePriceAmount,
  organicSocialPlatformLabel,
  selectLatestTrialSeeds,
  NO_LABEL,
  NOT_AVAILABLE,
  SPEND_NOT_ENTERED,
  UNKNOWN_METRIC,
  YES_LABEL,
  type GrowthAppleRow,
  type GrowthStripeSubscription,
  type MarketingAttributionRow,
  type MarketingEventRow,
} from "@/lib/admin-subscriber-growth-pure";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "@/lib/summitt-membership-entitlement";
import { getDateKeyInTimezone } from "@/lib/timezone";

const NOW = new Date("2026-09-01T16:00:00.000Z");
const NOW_UNIX = Math.floor(NOW.getTime() / 1000);
const RECOGNIZED = new Set(["price_monthly_current", "price_annual_current"]);

function stripeSub(
  partial: Partial<GrowthStripeSubscription> & { id: string; status: string }
): GrowthStripeSubscription {
  return {
    customer: `cus_${partial.id}`,
    metadata: { userId: `user_${partial.id}` },
    items: {
      data: [
        {
          price: {
            id: "price_monthly_current",
            unit_amount: 2900,
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...partial,
  };
}

function appleGranting(
  partial: Partial<GrowthAppleRow> & { clerk_user_id: string }
): GrowthAppleRow {
  return {
    product_id: APPLE_IAP_MONTHLY_PRODUCT_ID,
    status: "active",
    expires_at: "2026-10-01T00:00:00.000Z",
    auto_renew_enabled: true,
    ...partial,
  };
}

function snapshot(args: {
  stripeSubs?: GrowthStripeSubscription[];
  appleGranting?: GrowthAppleRow[];
  appleCancel?: GrowthAppleRow[];
  startMs?: number | null;
  endMs?: number;
  accountsCreated?: number | null;
  stripeRevenueCents?: number | null;
  stripeListComplete?: boolean;
  appleQueryComplete?: boolean;
}) {
  return computeGrowthSnapshot({
    stripeSubs: args.stripeSubs ?? [],
    appleGranting: args.appleGranting ?? [],
    appleCancelRequestedStillActive: args.appleCancel ?? [],
    recognizedPriceIds: RECOGNIZED,
    nowUnix: NOW_UNIX,
    startMs: args.startMs ?? 0,
    endMs: args.endMs ?? NOW.getTime() + 86_400_000,
    accountsCreated: args.accountsCreated ?? null,
    stripeRevenueCents: args.stripeRevenueCents ?? null,
    stripeListComplete: args.stripeListComplete ?? true,
    appleQueryComplete: args.appleQueryComplete ?? true,
  });
}

describe("unknown metrics render as em dash, not 0", () => {
  it("formats null as — and measured zero as 0", () => {
    expect(formatUnknownableCount(null)).toBe(UNKNOWN_METRIC);
    expect(formatUnknownableCount(0)).toBe("0");
    expect(formatUnknownablePercent(null)).toBe(UNKNOWN_METRIC);
    expect(formatUnknownablePercent(0)).toBe("0.0%");
    expect(formatUnknownableUsdFromCents(null)).toBe(UNKNOWN_METRIC);
    expect(formatUnknownableUsdFromCents(0)).toBe("$0.00");
    expect(UNKNOWN_METRIC).toBe("—");
  });

  it("conversion rate is — when either side is unknown or denominator is 0", () => {
    expect(conversionRate(null, 10)).toBeNull();
    expect(conversionRate(4, null)).toBeNull();
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(2, 4)).toBe(0.5);
  });
});

describe("slice 1 display language", () => {
  it("uses Yes/No for person flags, not —", () => {
    expect(formatPersonFlag(true)).toBe(YES_LABEL);
    expect(formatPersonFlag(false)).toBe(NO_LABEL);
    expect(formatPersonFlag(false)).not.toBe(UNKNOWN_METRIC);
  });

  it("shows Spend not entered only when the spend list is complete and empty", () => {
    expect(adSpendDisplayStatus({ queryComplete: true, entryCount: 0 })).toBe("empty");
    expect(adSpendDisplayStatus({ queryComplete: false, entryCount: 0 })).toBe(
      "unavailable"
    );
    expect(adSpendDisplayStatus({ queryComplete: true, entryCount: 2 })).toBe("entered");
    expect(formatAdvertisingSpendDisplay(0, "empty")).toBe(SPEND_NOT_ENTERED);
    expect(formatAdvertisingSpendDisplay(0, "unavailable")).toBe(NOT_AVAILABLE);
    expect(formatAdvertisingSpendDisplay(1250, "entered")).toBe("$12.50");
    expect(formatCostPerPaidDisplay(5000, "empty")).toBe(UNKNOWN_METRIC);
    expect(formatCostPerPaidDisplay(5000, "unavailable")).toBe(NOT_AVAILABLE);
    expect(formatCostPerPaidDisplay(5000, "entered")).toBe("$50.00");
  });

  it("does not change blended cost-per-paid math", () => {
    expect(blendedCostPerPaidCents(10000, 2)).toBe(5000);
    expect(blendedCostPerPaidCents(0, 2)).toBe(0);
    expect(blendedCostPerPaidCents(10000, 0)).toBeNull();
  });
});

describe("global active paid helper", () => {
  it("counts Stripe paid + Apple granting and ignores trials", () => {
    expect(
      countActivePaidMembers({
        stripeSubs: [
          stripeSub({ id: "paid", status: "active" }),
          stripeSub({ id: "trial", status: "trialing" }),
        ],
        appleGranting: [appleGranting({ clerk_user_id: "apple_user" })],
        recognizedPriceIds: RECOGNIZED,
        stripeListComplete: true,
        appleQueryComplete: true,
      })
    ).toBe(2);
  });

  it("returns null when Stripe or Apple lists are incomplete", () => {
    expect(
      countActivePaidMembers({
        stripeSubs: [stripeSub({ id: "paid", status: "active" })],
        appleGranting: [],
        recognizedPriceIds: RECOGNIZED,
        stripeListComplete: false,
        appleQueryComplete: true,
      })
    ).toBeNull();
  });

  it("stays global even when a source-filtered snapshot is smaller", () => {
    const all = [
      stripeSub({ id: "paid", status: "active", metadata: { userId: "a" } }),
      stripeSub({ id: "other", status: "active", metadata: { userId: "b" } }),
    ];
    const filtered = [all[0]!];
    const filteredSnap = snapshot({ stripeSubs: filtered });
    expect(filteredSnap.asOfNow.activePaid).toBe(1);
    expect(
      countActivePaidMembers({
        stripeSubs: all,
        appleGranting: [],
        recognizedPriceIds: RECOGNIZED,
        stripeListComplete: true,
        appleQueryComplete: true,
      })
    ).toBe(2);
  });
});

describe("active paid classification", () => {
  it("excludes Stripe trialing", () => {
    expect(
      isStripePaidActive(stripeSub({ id: "trial", status: "trialing" }))
    ).toBe(false);
    const result = snapshot({
      stripeSubs: [stripeSub({ id: "trial", status: "trialing" })],
    });
    expect(result.asOfNow.activePaid).toBe(0);
  });

  it("includes Stripe active and excludes paused", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({ id: "paid", status: "active" }),
        stripeSub({
          id: "paused",
          status: "active",
          pause_collection: { behavior: "void" },
        }),
      ],
    });
    expect(result.asOfNow.activePaid).toBe(1);
    expect(result.asOfNow.activeMonthly).toBe(1);
  });

  it("includes Apple granting identities in active paid", () => {
    const result = snapshot({
      stripeSubs: [stripeSub({ id: "paid", status: "active" })],
      appleGranting: [appleGranting({ clerk_user_id: "apple_user" })],
    });
    expect(result.asOfNow.activePaid).toBe(2);
  });

  it("does not double-count the same Clerk identity across Stripe and Apple", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "paid",
          status: "active",
          metadata: { userId: "same_user" },
        }),
      ],
      appleGranting: [appleGranting({ clerk_user_id: "same_user" })],
    });
    expect(result.asOfNow.activePaid).toBe(1);
    expect(result.asOfNow.activeMonthly).toBe(1);
    expect(result.asOfNow.activeAnnual).toBe(0);
  });
});

describe("plan mix", () => {
  it("counts Stripe monthly and annual from live interval, Apple as monthly only", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({ id: "m", status: "active" }),
        stripeSub({
          id: "y",
          status: "active",
          metadata: { userId: "user_y", plan: "annual" },
          items: {
            data: [
              {
                price: {
                  id: "price_annual_current",
                  unit_amount: 24900,
                  recurring: { interval: "year" },
                },
              },
            ],
          },
        }),
      ],
      appleGranting: [appleGranting({ clerk_user_id: "apple_only" })],
    });
    expect(result.asOfNow.activeMonthly).toBe(2);
    expect(result.asOfNow.activeAnnual).toBe(1);
    expect(result.asOfNow.monthlyShare).toBeCloseTo(2 / 3);
    expect(result.asOfNow.annualShare).toBeCloseTo(1 / 3);
  });
});

describe("MRR from live Stripe Price amounts", () => {
  it("uses $19.99 monthly, $29 monthly, $120 annual / 12, and $249 annual / 12", () => {
    expect(
      mrrCentsFromStripePriceAmount(
        stripeSub({
          id: "legacy_m",
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_legacy_m",
                  unit_amount: 1999,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        })
      )
    ).toBe(1999);
    expect(
      mrrCentsFromStripePriceAmount(
        stripeSub({
          id: "current_m",
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_monthly_current",
                  unit_amount: 2900,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        })
      )
    ).toBe(2900);
    expect(
      mrrCentsFromStripePriceAmount(
        stripeSub({
          id: "legacy_y",
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_legacy_y",
                  unit_amount: 12000,
                  recurring: { interval: "year" },
                },
              },
            ],
          },
        })
      )
    ).toBe(1000);
    expect(
      mrrCentsFromStripePriceAmount(
        stripeSub({
          id: "current_y",
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_annual_current",
                  unit_amount: 24900,
                  recurring: { interval: "year" },
                },
              },
            ],
          },
        })
      )
    ).toBe(2075);
  });

  it("sums live amounts and does not invent Apple MRR", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "m",
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_monthly_current",
                  unit_amount: 1999,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        }),
      ],
      appleGranting: [appleGranting({ clerk_user_id: "apple_only" })],
    });
    expect(result.asOfNow.stripeMrrCents).toBe(1999);
    expect(result.notes.appleMrrUnavailable).toBe(true);
  });
});

describe("period vs snapshot", () => {
  it("does not change as-of-now paid counts when the period changes", () => {
    const subs = [stripeSub({ id: "paid", status: "active" })];
    const apple = [appleGranting({ clerk_user_id: "apple_user" })];
    const today = snapshot({
      stripeSubs: subs,
      appleGranting: apple,
      startMs: NOW.getTime() - 3_600_000,
      endMs: NOW.getTime() + 3_600_000,
    });
    const last30 = snapshot({
      stripeSubs: subs,
      appleGranting: apple,
      startMs: NOW.getTime() - 30 * 86_400_000,
      endMs: NOW.getTime() + 86_400_000,
    });
    expect(today.asOfNow.activePaid).toBe(2);
    expect(last30.asOfNow.activePaid).toBe(2);
    expect(today.asOfNow.activeMonthly).toBe(last30.asOfNow.activeMonthly);
  });

  it("uses America/New_York calendar-day last-7 bounds", () => {
    const todayKey = getDateKeyInTimezone(NOW, "America/New_York");
    const period = growthPeriodUtcMs("last_7", todayKey);
    expect(period).not.toBeNull();
    const spanDays = (period!.endMs - period!.startMs!) / 86_400_000;
    expect(spanDays).toBeGreaterThan(6.5);
    expect(spanDays).toBeLessThan(8.5);
  });
});

describe("trial cohort metrics", () => {
  it("counts mature converted trials and cancelled-during-trial in period", () => {
    const trialEnd = NOW_UNIX - 2 * 86_400;
    const trialStart = trialEnd - 7 * 86_400;
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "converted",
          status: "active",
          trial_start: trialStart,
          trial_end: trialEnd,
        }),
        stripeSub({
          id: "canceled_trial",
          status: "canceled",
          trial_start: trialStart,
          trial_end: trialEnd,
          canceled_at: trialEnd - 86_400,
        }),
        stripeSub({
          id: "finished_unpaid",
          status: "incomplete_expired",
          trial_start: trialStart,
          trial_end: trialEnd,
        }),
      ],
    });
    expect(result.period.freeTrialsStarted).toBe(3);
    expect(result.period.trialsConvertedToPaid).toBe(1);
    expect(result.period.trialToPaidRate).toBeCloseTo(1 / 3);
    expect(result.period.cancelledDuringTrial).toBe(1);
    expect(result.period.finishedTrialWithoutPaid).toBe(1);
    expect(result.period.paidFullyEnded).toBe(0);
    expect(result.period.funnelConversions[4]).toBeNull();
  });

  it("still counts trial-to-paid when the user later canceled", () => {
    const trialEnd = NOW_UNIX - 10 * 86_400;
    const trialStart = trialEnd - 7 * 86_400;
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "converted_then_canceled",
          status: "canceled",
          trial_start: trialStart,
          trial_end: trialEnd,
          canceled_at: trialEnd + 2 * 86_400,
          ended_at: trialEnd + 2 * 86_400,
        }),
      ],
    });
    expect(result.period.trialsConvertedToPaid).toBe(1);
    expect(result.period.cancelledDuringTrial).toBe(0);
    expect(result.period.finishedTrialWithoutPaid).toBe(0);
    expect(result.period.paidFullyEnded).toBe(1);
  });

  it("excludes immature trials from conversion", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "immature",
          status: "trialing",
          trial_start: NOW_UNIX - 86_400,
          trial_end: NOW_UNIX + 6 * 86_400,
        }),
      ],
    });
    expect(result.period.freeTrialsStarted).toBe(1);
    expect(result.period.trialsConvertedToPaid).toBe(0);
    expect(result.period.trialToPaidRate).toBeNull();
  });
});

describe("slice 1 unknowns stay unknown until measured", () => {
  it("leaves ads, activation, and visitors as null when not supplied", () => {
    const result = snapshot({
      stripeSubs: [stripeSub({ id: "paid", status: "active" })],
      accountsCreated: 4,
    });
    expect(result.period.costPerPaid).toBeNull();
    expect(result.period.advertisingSpend).toBeNull();
    expect(result.period.newPaidAttributedToAds).toBeNull();
    expect(result.period.uniqueVisitors).toBeNull();
    expect(result.period.freeTrialButtonClicks).toBeNull();
    expect(result.period.activatedWithin24h).toBeNull();
    expect(result.period.accountsCreated).toBe(4);
    expect(result.period.reactivated).toBe(0);
  });

  it("returns — snapshot metrics when Stripe or Apple queries are incomplete", () => {
    const incomplete = snapshot({
      stripeSubs: [stripeSub({ id: "paid", status: "active" })],
      stripeListComplete: false,
    });
    expect(incomplete.asOfNow.activePaid).toBeNull();
    expect(incomplete.period.freeTrialsStarted).toBeNull();
    expect(incomplete.period.paidChurnRate).toBeNull();
  });
});

describe("paid churn and reactivation", () => {
  it("computes Stripe opening-book churn and excludes trial-only cancel", () => {
    const periodStartUnix = NOW_UNIX - 7 * 86_400;
    const result = snapshot({
      startMs: periodStartUnix * 1000,
      stripeSubs: [
        stripeSub({
          id: "ended",
          status: "canceled",
          start_date: periodStartUnix - 30 * 86_400,
          created: periodStartUnix - 30 * 86_400,
          canceled_at: periodStartUnix + 86_400,
          ended_at: periodStartUnix + 86_400,
        }),
        stripeSub({
          id: "still_paid",
          status: "active",
          start_date: periodStartUnix - 10 * 86_400,
          created: periodStartUnix - 10 * 86_400,
        }),
        stripeSub({
          id: "trial_cancel",
          status: "canceled",
          trial_start: periodStartUnix - 3 * 86_400,
          trial_end: periodStartUnix + 4 * 86_400,
          canceled_at: periodStartUnix + 86_400,
        }),
      ],
    });
    expect(result.period.paidChurnRate).toBeCloseTo(0.5);
    expect(result.period.cancelledDuringTrial).toBe(1);
    expect(result.notes.stripeChurnOnly).toBe(true);
  });

  it("does not treat pause as churn", () => {
    const periodStartUnix = NOW_UNIX - 7 * 86_400;
    const result = snapshot({
      startMs: periodStartUnix * 1000,
      stripeSubs: [
        stripeSub({
          id: "paused",
          status: "active",
          start_date: periodStartUnix - 20 * 86_400,
          created: periodStartUnix - 20 * 86_400,
          pause_collection: { behavior: "void" },
        }),
      ],
    });
    expect(result.period.paidFullyEnded).toBe(0);
    expect(result.period.paidChurnRate).toBe(0);
  });

  it("counts reactivation after a prior paid terminal end", () => {
    const periodStartUnix = NOW_UNIX - 7 * 86_400;
    const result = snapshot({
      startMs: periodStartUnix * 1000,
      stripeSubs: [
        stripeSub({
          id: "old",
          status: "canceled",
          metadata: { userId: "same_user" },
          start_date: periodStartUnix - 40 * 86_400,
          created: periodStartUnix - 40 * 86_400,
          canceled_at: periodStartUnix - 10 * 86_400,
          ended_at: periodStartUnix - 10 * 86_400,
        }),
        stripeSub({
          id: "new",
          status: "active",
          metadata: { userId: "same_user" },
          start_date: periodStartUnix + 86_400,
          created: periodStartUnix + 86_400,
        }),
      ],
    });
    expect(result.period.reactivated).toBe(1);
  });

  it("does not count past_due recovery or trial retry without prior paid", () => {
    const periodStartUnix = NOW_UNIX - 7 * 86_400;
    const result = snapshot({
      startMs: periodStartUnix * 1000,
      stripeSubs: [
        stripeSub({
          id: "past_due",
          status: "past_due",
          start_date: periodStartUnix - 20 * 86_400,
          created: periodStartUnix - 20 * 86_400,
        }),
        stripeSub({
          id: "trial_retry_a",
          status: "canceled",
          metadata: { userId: "trial_user" },
          trial_start: periodStartUnix - 20 * 86_400,
          trial_end: periodStartUnix - 13 * 86_400,
          canceled_at: periodStartUnix - 14 * 86_400,
        }),
        stripeSub({
          id: "trial_retry_b",
          status: "trialing",
          metadata: { userId: "trial_user" },
          trial_start: periodStartUnix + 86_400,
          trial_end: periodStartUnix + 8 * 86_400,
        }),
      ],
    });
    expect(result.period.reactivated).toBe(0);
    expect(result.period.paidFullyEnded).toBe(0);
  });
});

describe("CPS and traffic rows", () => {
  it("blended CPS is spend / paid-attributed and never Infinity", () => {
    expect(blendedCostPerPaidCents(10000, 2)).toBe(5000);
    expect(blendedCostPerPaidCents(10000, 0)).toBeNull();
    expect(blendedCostPerPaidCents(null, 2)).toBeNull();
  });

  it("does not distribute campaign spend onto content-specific rows", () => {
    const rows = aggregateTrafficSourceRows({
      events: [
        {
          event_type: "page_viewed",
          visitor_id: "v1",
          occurred_at: "2026-09-01T00:00:00.000Z",
          source_normalized: "meta",
          is_paid_acquisition: true,
          utm_source: "facebook",
          utm_campaign: "spring",
          utm_content: "ad1",
          clerk_user_id: null,
        },
      ],
      attributions: [
        {
          clerk_user_id: "u1",
          visitor_id: "v1",
          source_normalized: "meta",
          is_paid_acquisition: true,
          source_detail: null,
          utm_source: "facebook",
          utm_campaign: "spring",
          utm_content: "ad1",
        },
      ],
      trialClerkIds: ["u1"],
      activatedClerkIds: ["u1"],
      paidConversionClerkIds: ["u1"],
      adSpend: [{ source_normalized: "meta", utm_campaign: "spring", amount_cents: 5000 }],
      sourceFilter: "all",
    });
    const content = rows.find((r) => r.utmContent === "ad1");
    const campaign = rows.find((r) => r.utmContent === "" && r.utmCampaign === "spring");
    expect(content?.platform).toBe("");
    expect(content?.advertisingSpendCents).toBeNull();
    expect(content?.costPerPaidCents).toBeNull();
    expect(campaign?.advertisingSpendCents).toBe(5000);
    expect(campaign?.paidConversions).toBe(0);
  });

  it("does not report Infinity CPS when attributed paid conversions are 0", () => {
    const result = snapshot({
      stripeSubs: [stripeSub({ id: "paid", status: "active" })],
    });
    const withSpend = computeGrowthSnapshot({
      stripeSubs: [stripeSub({ id: "paid", status: "active" })],
      appleGranting: [],
      appleCancelRequestedStillActive: [],
      recognizedPriceIds: RECOGNIZED,
      nowUnix: NOW_UNIX,
      startMs: 0,
      endMs: NOW.getTime() + 86_400_000,
      accountsCreated: null,
      stripeRevenueCents: 0,
      stripeListComplete: true,
      appleQueryComplete: true,
      advertisingSpend: 9900,
      newPaidAttributedToAds: 0,
    });
    expect(result.period.costPerPaid).toBeNull();
    expect(withSpend.period.costPerPaid).toBeNull();
    expect(withSpend.period.advertisingSpend).toBe(9900);
  });
});

describe("privacy of dashboard snapshot output", () => {
  it("does not include email, name, phone, or message bodies", () => {
    const result = snapshot({
      stripeSubs: [
        stripeSub({
          id: "paid",
          status: "active",
          metadata: { userId: "user_paid" },
        }),
      ],
      appleGranting: [appleGranting({ clerk_user_id: "apple_user" })],
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/email/i);
    expect(json).not.toMatch(/phone/i);
    expect(json).not.toMatch(/sms/i);
    expect(json).not.toMatch(/Victory Room/i);
  });
});

describe("organic social platform grain", () => {
  function pageView(partial: Partial<MarketingEventRow> & { visitor_id: string }): MarketingEventRow {
    return {
      event_type: "page_viewed",
      occurred_at: "2026-09-01T00:00:00.000Z",
      source_normalized: "organic_social",
      is_paid_acquisition: false,
      utm_source: null,
      utm_campaign: "organic",
      utm_content: "bio",
      clerk_user_id: null,
      ...partial,
    };
  }

  function accountCreated(
    partial: Partial<MarketingEventRow> & { visitor_id: string; clerk_user_id: string }
  ): MarketingEventRow {
    return {
      event_type: "account_created",
      occurred_at: "2026-09-01T01:00:00.000Z",
      source_normalized: "organic_social",
      is_paid_acquisition: false,
      utm_source: null,
      utm_campaign: "organic",
      utm_content: "bio",
      ...partial,
    };
  }

  function attr(
    partial: Partial<MarketingAttributionRow> & { clerk_user_id: string; visitor_id: string }
  ): MarketingAttributionRow {
    return {
      source_normalized: "organic_social",
      is_paid_acquisition: false,
      source_detail: null,
      utm_source: null,
      utm_campaign: "organic",
      utm_content: "bio",
      ...partial,
    };
  }

  it("maps organic aliases to display platforms only", () => {
    expect(organicSocialPlatformLabel("organic_social", "instagram")).toBe("Instagram");
    expect(organicSocialPlatformLabel("organic_social", "ig")).toBe("Instagram");
    expect(organicSocialPlatformLabel("organic_social", "facebook")).toBe("Facebook");
    expect(organicSocialPlatformLabel("organic_social", "fb")).toBe("Facebook");
    expect(organicSocialPlatformLabel("organic_social", "tiktok")).toBe("TikTok");
    expect(organicSocialPlatformLabel("organic_social", "x")).toBe("X");
    expect(organicSocialPlatformLabel("organic_social", "twitter")).toBe("X");
    expect(organicSocialPlatformLabel("organic_social", null)).toBe("");
    expect(organicSocialPlatformLabel("organic_social", "<script>")).toBe("");
    expect(organicSocialPlatformLabel("meta", "facebook")).toBe("");
    expect(organicSocialPlatformLabel("google", "google")).toBe("");
    expect(organicSocialPlatformLabel("direct", null)).toBe("");
    expect(organicSocialPlatformLabel("referral", "instagram")).toBe("");
  });

  it("keeps Instagram and Facebook organic bio as separate rows", () => {
    const rows = aggregateTrafficSourceRows({
      events: [
        pageView({ visitor_id: "v_ig", utm_source: "instagram" }),
        pageView({ visitor_id: "v_fb", utm_source: "facebook" }),
        pageView({
          visitor_id: "v_ig_story",
          utm_source: "instagram",
          utm_content: "story_psm047",
        }),
        pageView({ visitor_id: "v_tt", utm_source: "tiktok" }),
        pageView({ visitor_id: "v_x", utm_source: "x" }),
        pageView({ visitor_id: "v_tw", utm_source: "twitter" }),
        pageView({ visitor_id: "v_ig_alias", utm_source: "ig" }),
        pageView({ visitor_id: "v_fb_alias", utm_source: "fb" }),
        pageView({ visitor_id: "v_old", utm_source: null }),
        accountCreated({
          visitor_id: "v_ig",
          clerk_user_id: "u_ig",
          utm_source: "instagram",
        }),
        accountCreated({
          visitor_id: "v_ig2",
          clerk_user_id: "u_ig2",
          utm_source: "instagram",
        }),
        accountCreated({
          visitor_id: "v_fb",
          clerk_user_id: "u_fb",
          utm_source: "facebook",
        }),
        accountCreated({
          visitor_id: "v_ig",
          clerk_user_id: "u_ig",
          utm_source: "instagram",
        }),
      ],
      attributions: [
        attr({ clerk_user_id: "u_ig", visitor_id: "v_ig", utm_source: "instagram" }),
        attr({ clerk_user_id: "u_ig2", visitor_id: "v_ig2", utm_source: "instagram" }),
        attr({ clerk_user_id: "u_fb", visitor_id: "v_fb", utm_source: "facebook" }),
        attr({
          clerk_user_id: "u_ig_story",
          visitor_id: "v_ig_story",
          utm_source: "instagram",
          utm_content: "story_psm047",
        }),
        attr({ clerk_user_id: "u_tt", visitor_id: "v_tt", utm_source: "tiktok" }),
        attr({ clerk_user_id: "u_x", visitor_id: "v_x", utm_source: "x" }),
        attr({ clerk_user_id: "u_old", visitor_id: "v_old", utm_source: null }),
      ],
      trialClerkIds: ["u_ig", "u_fb", "u_ig_story"],
      activatedClerkIds: ["u_ig", "u_fb"],
      paidConversionClerkIds: ["u_ig"],
      adSpend: [],
      sourceFilter: "all",
    });

    const igBio = rows.find(
      (r) => r.platform === "Instagram" && r.utmContent === "bio"
    );
    const fbBio = rows.find(
      (r) => r.platform === "Facebook" && r.utmContent === "bio"
    );
    const igStory = rows.find(
      (r) => r.platform === "Instagram" && r.utmContent === "story_psm047"
    );
    const tiktok = rows.find((r) => r.platform === "TikTok");
    const xRow = rows.find((r) => r.platform === "X" && r.utmContent === "bio");
    const oldOrganic = rows.find(
      (r) => r.sourceNormalized === "organic_social" && r.platform === "" && r.utmContent === "bio"
    );

    expect(igBio).toMatchObject({
      sourceNormalized: "organic_social",
      platform: "Instagram",
      utmCampaign: "organic",
      utmContent: "bio",
      visitors: 2,
      accounts: 2,
      trialsStarted: 1,
      activated: 1,
      paidConversions: 1,
    });
    expect(fbBio).toMatchObject({
      sourceNormalized: "organic_social",
      platform: "Facebook",
      utmCampaign: "organic",
      utmContent: "bio",
      visitors: 2,
      accounts: 1,
      trialsStarted: 1,
      activated: 1,
      paidConversions: 0,
    });
    expect(igStory).toMatchObject({
      platform: "Instagram",
      utmCampaign: "organic",
      utmContent: "story_psm047",
      visitors: 1,
      accounts: 0,
      trialsStarted: 1,
    });
    expect(tiktok).toMatchObject({
      platform: "TikTok",
      utmCampaign: "organic",
      utmContent: "bio",
      visitors: 1,
    });
    expect(xRow).toMatchObject({
      platform: "X",
      utmCampaign: "organic",
      utmContent: "bio",
      visitors: 2,
    });
    expect(oldOrganic).toMatchObject({
      sourceNormalized: "organic_social",
      platform: "",
      utmCampaign: "organic",
      utmContent: "bio",
      visitors: 1,
      accounts: 0,
    });
    expect(igBio).not.toEqual(fbBio);
  });

  it("leaves paid Meta, Google, and Direct platform blank and does not reclassify them", () => {
    const rows = aggregateTrafficSourceRows({
      events: [
        pageView({
          visitor_id: "v_meta",
          source_normalized: "meta",
          is_paid_acquisition: true,
          utm_source: "facebook",
          utm_campaign: "spring",
          utm_content: "ad1",
        }),
        pageView({
          visitor_id: "v_google",
          source_normalized: "google",
          is_paid_acquisition: true,
          utm_source: "google",
          utm_campaign: "brand",
          utm_content: "ad-a",
        }),
        pageView({
          visitor_id: "v_direct",
          source_normalized: "direct",
          utm_source: null,
          utm_campaign: null,
          utm_content: null,
        }),
        pageView({
          visitor_id: "v_coach",
          source_normalized: "referral",
          utm_source: "instagram",
          utm_campaign: null,
          utm_content: null,
        }),
        accountCreated({
          visitor_id: "v_meta",
          clerk_user_id: "u_meta",
          source_normalized: "meta",
          is_paid_acquisition: true,
          utm_source: "facebook",
          utm_campaign: "spring",
          utm_content: "ad1",
        }),
      ],
      attributions: [
        attr({
          clerk_user_id: "u_meta",
          visitor_id: "v_meta",
          source_normalized: "meta",
          is_paid_acquisition: true,
          utm_source: "facebook",
          utm_campaign: "spring",
          utm_content: "ad1",
        }),
        attr({
          clerk_user_id: "u_google",
          visitor_id: "v_google",
          source_normalized: "google",
          is_paid_acquisition: true,
          utm_source: "google",
          utm_campaign: "brand",
          utm_content: "ad-a",
        }),
        attr({
          clerk_user_id: "u_direct",
          visitor_id: "v_direct",
          source_normalized: "direct",
          is_paid_acquisition: false,
          utm_source: null,
          utm_campaign: null,
          utm_content: null,
        }),
        attr({
          clerk_user_id: "u_coach",
          visitor_id: "v_coach",
          source_normalized: "referral",
          source_detail: "coach",
          utm_source: "instagram",
          utm_campaign: null,
          utm_content: null,
        }),
      ],
      trialClerkIds: ["u_meta", "u_google", "u_direct", "u_coach"],
      activatedClerkIds: ["u_meta", "u_google"],
      paidConversionClerkIds: ["u_meta"],
      adSpend: [],
      sourceFilter: "all",
    });

    const meta = rows.find((r) => r.sourceNormalized === "meta" && r.utmContent === "ad1");
    const google = rows.find((r) => r.sourceNormalized === "google");
    const direct = rows.find((r) => r.sourceNormalized === "direct");
    const coach = rows.find((r) => r.sourceNormalized === "referral");

    expect(meta).toMatchObject({
      sourceNormalized: "meta",
      platform: "",
      utmCampaign: "spring",
      utmContent: "ad1",
      visitors: 1,
      accounts: 1,
      trialsStarted: 1,
      activated: 1,
      paidConversions: 1,
    });
    expect(google).toMatchObject({
      sourceNormalized: "google",
      platform: "",
      utmCampaign: "brand",
      visitors: 1,
      trialsStarted: 1,
      activated: 1,
    });
    expect(direct).toMatchObject({
      sourceNormalized: "direct",
      platform: "",
      visitors: 1,
      trialsStarted: 1,
    });
    expect(coach).toMatchObject({
      sourceNormalized: "referral",
      platform: "",
      visitors: 1,
      trialsStarted: 1,
    });
  });

  it("counts distinct visitors and clerk accounts on first-touch grain only", () => {
    const rows = aggregateTrafficSourceRows({
      events: [
        pageView({ visitor_id: "same", utm_source: "instagram" }),
        pageView({ visitor_id: "same", utm_source: "instagram" }),
        accountCreated({
          visitor_id: "v1",
          clerk_user_id: "u_ig",
          utm_source: "instagram",
        }),
        accountCreated({
          visitor_id: "v1b",
          clerk_user_id: "u_ig",
          utm_source: "instagram",
        }),
        accountCreated({
          visitor_id: "orphan",
          clerk_user_id: "u_missing",
          utm_source: "instagram",
        }),
      ],
      attributions: [
        attr({ clerk_user_id: "u_ig", visitor_id: "v1", utm_source: "instagram" }),
      ],
      trialClerkIds: ["u_ig", "u_missing"],
      activatedClerkIds: ["u_ig"],
      paidConversionClerkIds: ["u_ig"],
      adSpend: [],
      sourceFilter: "all",
    });
    const ig = rows.find((r) => r.platform === "Instagram");
    expect(ig?.visitors).toBe(1);
    expect(ig?.accounts).toBe(1);
    expect(ig?.trialsStarted).toBe(1);
    expect(ig?.activated).toBe(1);
    expect(ig?.paidConversions).toBe(1);
  });
});

describe("latest trial seeds and rows", () => {
  const recognized = RECOGNIZED;

  it("keeps the 20 newest unique people and newest-first order", () => {
    const subs = Array.from({ length: 21 }, (_, i) =>
      stripeSub({
        id: `sub_${i}`,
        status: "trialing",
        metadata: { userId: `user_${i}` },
        trial_start: 1_700_000_000 + i,
        trial_end: 1_700_000_000 + i + 7 * 86_400,
      })
    );
    const seeds = selectLatestTrialSeeds(subs, recognized);
    expect(LATEST_TRIALS_LIMIT).toBe(20);
    expect(seeds).toHaveLength(20);
    expect(seeds.map((s) => s.clerkUserId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `user_${20 - i}`)
    );
    expect(seeds[0]?.trialStartUnix).toBeGreaterThan(seeds[19]?.trialStartUnix ?? 0);
  });

  it("shows a repeated Clerk user once using the newest trial_start", () => {
    const seeds = selectLatestTrialSeeds(
      [
        stripeSub({
          id: "older",
          status: "canceled",
          metadata: { userId: "user_same" },
          trial_start: 1_700_000_100,
          trial_end: 1_700_600_100,
        }),
        stripeSub({
          id: "newer",
          status: "trialing",
          metadata: { userId: "user_same" },
          trial_start: 1_700_900_100,
          trial_end: 1_701_500_100,
        }),
        stripeSub({
          id: "other",
          status: "trialing",
          metadata: { userId: "user_other" },
          trial_start: 1_700_800_100,
          trial_end: 1_701_400_100,
        }),
      ],
      recognized
    );
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatchObject({
      clerkUserId: "user_same",
      trialStartUnix: 1_700_900_100,
      sub: expect.objectContaining({ id: "newer" }),
    });
    expect(seeds[1]?.clerkUserId).toBe("user_other");
  });

  it("skips Apple-only people, missing Clerk ids, and subscriptions without trial_start", () => {
    const seeds = selectLatestTrialSeeds(
      [
        stripeSub({
          id: "no_trial",
          status: "active",
          metadata: { userId: "user_paid" },
        }),
        stripeSub({
          id: "no_clerk",
          status: "trialing",
          metadata: {},
          trial_start: NOW_UNIX,
          trial_end: NOW_UNIX + 7 * 86_400,
        }),
      ],
      recognized
    );
    expect(seeds).toEqual([]);
  });

  it("does not apply a date or source filter", () => {
    const oldStart = NOW_UNIX - 400 * 86_400;
    const seeds = selectLatestTrialSeeds(
      [
        stripeSub({
          id: "ancient",
          status: "trialing",
          metadata: { userId: "user_old" },
          trial_start: oldStart,
          trial_end: oldStart + 7 * 86_400,
        }),
      ],
      recognized
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.clerkUserId).toBe("user_old");
  });

  it("maps first-touch attribution, emails, 24h activation set, and person-level paid", () => {
    const trialing = stripeSub({
      id: "still_trial",
      status: "trialing",
      metadata: { userId: "user_ig" },
      trial_start: NOW_UNIX - 3600,
      trial_end: NOW_UNIX + 6 * 86_400,
    });
    const converted = stripeSub({
      id: "converted",
      status: "active",
      metadata: { userId: "user_paid" },
      trial_start: NOW_UNIX - 10 * 86_400,
      trial_end: NOW_UNIX - 3 * 86_400,
    });
    const canceledTrial = stripeSub({
      id: "canceled_trial",
      status: "canceled",
      metadata: { userId: "user_cancel" },
      trial_start: NOW_UNIX - 5 * 86_400,
      trial_end: NOW_UNIX + 2 * 86_400,
      canceled_at: NOW_UNIX - 86_400,
    });
    const unattributed = stripeSub({
      id: "unknown",
      status: "trialing",
      metadata: { userId: "user_none" },
      trial_start: NOW_UNIX - 120,
      trial_end: NOW_UNIX + 7 * 86_400,
    });
    const seeds = selectLatestTrialSeeds(
      [trialing, converted, canceledTrial, unattributed],
      recognized
    );
    const rows = buildLatestTrialRows({
      seeds,
      attributionsByClerkId: new Map([
        [
          "user_ig",
          {
            clerk_user_id: "user_ig",
            visitor_id: "v_ig",
            source_normalized: "organic_social",
            is_paid_acquisition: false,
            source_detail: null,
            utm_source: "instagram",
            utm_campaign: "organic",
            utm_content: "story_psm047",
          },
        ],
      ]),
      emailsByClerkId: new Map([
        ["user_ig", "jane@example.com"],
        ["user_paid", "paid@example.com"],
        ["user_cancel", "cancel@example.com"],
      ]),
      activatedClerkIds: new Set(["user_ig"]),
      paidInvoiceSubIds: new Set<string>(),
    });

    const ig = rows.find((r) => r.personEmail === "jane@example.com");
    expect(ig).toMatchObject({
      sourceNormalized: "organic_social",
      utmSource: "instagram",
      utmCampaign: "organic",
      utmContent: "story_psm047",
      activated: true,
      paid: false,
    });
    expect(organicSocialPlatformLabel(ig?.sourceNormalized, ig?.utmSource)).toBe(
      "Instagram"
    );

    const paid = rows.find((r) => r.personEmail === "paid@example.com");
    expect(paid?.activated).toBe(false);
    expect(paid?.paid).toBe(true);

    const canceled = rows.find((r) => r.personEmail === "cancel@example.com");
    expect(canceled?.paid).toBe(false);

    const missing = rows.find((r) => r.trialStartUnix === NOW_UNIX - 120);
    expect(missing).toMatchObject({
      personEmail: null,
      sourceNormalized: null,
      utmSource: null,
      utmCampaign: null,
      utmContent: null,
      activated: false,
      paid: false,
    });
  });

  it("formats Signed Up in America/New_York", () => {
    const unix = Math.floor(Date.parse("2026-09-10T00:43:00.000Z") / 1000);
    const label = formatLatestTrialSignedUp(unix);
    expect(label).toContain("Sep 9, 2026");
    expect(label).toContain("8:43 PM");
  });
});

