import { describe, expect, it } from "vitest";

import {
  aggregateTrafficSourceRows,
  blendedCostPerPaidCents,
  computeGrowthSnapshot,
  conversionRate,
  formatUnknownableCount,
  formatUnknownablePercent,
  formatUnknownableUsdFromCents,
  growthPeriodUtcMs,
  isStripePaidActive,
  mrrCentsFromStripePriceAmount,
  UNKNOWN_METRIC,
  type GrowthAppleRow,
  type GrowthStripeSubscription,
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
