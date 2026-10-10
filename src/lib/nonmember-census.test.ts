import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildOperatingSnapshot, formatOperatingReport } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";
import { CHECKOUT_LIST_NOT_BEFORE_MS } from "@/lib/checkout-tracking";
import {
  censusCoverage,
  judgeCensusAccount,
  NONMEMBER_CENSUS_MAX_PAGES,
  NONMEMBER_CENSUS_PAGE_SIZE,
  type CensusAccountInput,
} from "@/lib/nonmember-census";
import { classifySummittMembership } from "@/lib/summitt-subscription-membership";

function account(partial: Partial<CensusAccountInput> = {}): CensusAccountInput {
  return {
    createdAtMs: CHECKOUT_LIST_NOT_BEFORE_MS + 86_400_000,
    hasEmail: false,
    apple: "no_grant",
    stripe: "no_subscription_id",
    sessions: [],
    unreadSessionIds: 0,
    creationFailed: false,
    eventsComplete: true,
    ...partial,
  };
}

describe("nonmember census judgments", () => {
  it("does not call a Stripe, Apple, trial, paused, or past-due member a nonmember", () => {
    expect(classifySummittMembership({ status: "trialing" })).toBe("entitled");
    expect(classifySummittMembership({ status: "active" })).toBe("entitled");
    expect(
      classifySummittMembership({ status: "active", pause_collection: { behavior: "mark_uncollectible" } })
    ).toBe("paused_recoverable");
    expect(classifySummittMembership({ status: "past_due" })).toBe("past_due_recoverable");

    for (const stripe of ["entitled", "paused_recoverable", "past_due_recoverable"] as const) {
      expect(judgeCensusAccount(account({ stripe })).kind).toBe("member");
    }
    expect(judgeCensusAccount(account({ apple: "grant", stripe: "ended" })).kind).toBe("member");
    expect(
      judgeCensusAccount(
        account({
          sessions: [{ outcome: "completed_trial", subscription: "entitled" }],
        })
      ).kind
    ).toBe("member");
  });

  it("does not call unknown entitlement a nonmember", () => {
    expect(judgeCensusAccount(account({ apple: "unreadable" }))).toEqual({
      kind: "unknown",
      reason: "verification",
    });
    expect(judgeCensusAccount(account({ stripe: "lookup_failed" }))).toEqual({
      kind: "unknown",
      reason: "verification",
    });
    expect(judgeCensusAccount(account({ stripe: "not_retrieved" }))).toEqual({
      kind: "unknown",
      reason: "verification",
    });
    expect(
      judgeCensusAccount(
        account({
          sessions: [{ outcome: "completed_trial", subscription: "none" }],
        })
      )
    ).toEqual({ kind: "unknown", reason: "unverified_trial" });
    expect(judgeCensusAccount(account({ unreadSessionIds: 1 }))).toEqual({
      kind: "unknown",
      reason: "unverified_trial",
    });
  });

  it("keeps pre-tracking accounts out of the checkout-abandoner categories", () => {
    expect(
      judgeCensusAccount(
        account({ createdAtMs: CHECKOUT_LIST_NOT_BEFORE_MS - 86_400_000 })
      )
    ).toEqual({ kind: "nonmember", category: "insufficient_history" });
  });

  it("labels pending, expired, failed, and never-recorded checkouts only with evidence", () => {
    expect(
      judgeCensusAccount(
        account({ sessions: [{ outcome: "pending", subscription: "none" }] })
      )
    ).toEqual({ kind: "nonmember", category: "checkout_pending" });
    expect(
      judgeCensusAccount(
        account({ sessions: [{ outcome: "expired", subscription: "none" }] })
      )
    ).toEqual({ kind: "nonmember", category: "checkout_expired" });
    expect(judgeCensusAccount(account({ creationFailed: true }))).toEqual({
      kind: "nonmember",
      category: "checkout_creation_failed",
    });
    expect(judgeCensusAccount(account())).toEqual({
      kind: "nonmember",
      category: "checkout_never_recorded",
    });
    expect(judgeCensusAccount(account({ stripe: "ended" }))).toEqual({
      kind: "nonmember",
      category: "previously_subscribed",
    });
    expect(
      judgeCensusAccount(
        account({ sessions: [{ outcome: "unknown", subscription: "other_non_blocking" }] })
      )
    ).toEqual({ kind: "nonmember", category: "checkout_completed_without_trial" });
  });

  it("shows a full page at the scan cap as partial, not complete", () => {
    expect(
      censusCoverage({
        pageLengths: [NONMEMBER_CENSUS_PAGE_SIZE, NONMEMBER_CENSUS_PAGE_SIZE],
        pageSize: NONMEMBER_CENSUS_PAGE_SIZE,
        maxPages: NONMEMBER_CENSUS_MAX_PAGES,
        clerkTotal: 500,
      })
    ).toEqual({ coverage: "partial", examined: 200 });
    expect(
      censusCoverage({
        pageLengths: [40],
        pageSize: NONMEMBER_CENSUS_PAGE_SIZE,
        maxPages: NONMEMBER_CENSUS_MAX_PAGES,
        clerkTotal: 40,
      })
    ).toEqual({ coverage: "complete", examined: 40 });
  });
});

function growth(): SubscriberGrowthDashboardData {
  const snapshot = emptyUnknownSnapshot();
  snapshot.notes.sourceTrackingUnavailable = false;
  return {
    range: "last_7",
    source: "all",
    timezone: "America/New_York",
    asOfNowLabel: "Oct 10, 2026, 8:00 AM",
    snapshot,
    latestTrials: [],
    warnings: [],
    adSpendEntries: [],
    activationQueryComplete: true,
    latestTrialsActivationComplete: true,
    adSpendQueryComplete: true,
    todayDateKey: "2026-10-10",
    stripeWeek: emptyStripeWeekMovement(),
    currentFreeTrials: emptyCurrentFreeTrials(),
    recentActivity: null,
    recentActivityPaymentFailedIncluded: false,
    trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
    visitorCohortTable: emptyVisitorCohortTable(),
    homepageVideo: emptyHomepageVideoReport(),
  };
}

describe("census report and boundaries", () => {
  it("puts census counts in the shared report and leaves out the account list", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growth(),
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      census: {
        coverage: "partial",
        examined: 200,
        clerkTotal: 480,
        members: 10,
        nonmembers: 4,
        unknownEntitlement: 1,
        unverifiedTrial: 1,
        withEmail: 12,
        categories: {
          checkout_never_recorded: 1,
          checkout_pending: 1,
          checkout_expired: 1,
          checkout_creation_failed: 0,
          checkout_completed_without_trial: 0,
          previously_subscribed: 1,
          insufficient_history: 0,
          unknown: 0,
        },
        rows: [
          {
            clerkUserId: "user_secret_row",
            createdAtMs: CHECKOUT_LIST_NOT_BEFORE_MS,
            category: "checkout_expired",
          },
        ],
      },
    });
    expect(snapshot.census.nonmembers).toBe("4");
    expect(snapshot.census.rows[0]?.clerkUserId).toBe("user_secret_row");
    expect(snapshot.report).toContain("ACCOUNTS WITHOUT MEMBERSHIP");
    expect(snapshot.report).toContain("Confirmed nonmembers in this scan: 4");
    expect(snapshot.report).toContain("Advance marketing opt-in is not required");
    expect(snapshot.report).toContain("Marketing suppression status is not verified");
    expect(snapshot.report).not.toContain("user_secret_row");
    expect(snapshot.report).not.toMatch(/@/);
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    expect(snapshot.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "clerk-census-partial",
        "census-verification-incomplete",
        "census-unverified-trial",
      ])
    );
    expect(snapshot.actions.map((action) => action.id)).not.toContain("contact-nonmember");
  });

  it("does not send email, SMS, or change Brooke's page", () => {
    const server = readFileSync("src/lib/nonmember-census.server.ts", "utf8");
    const pure = readFileSync("src/lib/nonmember-census.ts", "utf8");
    const screen = readFileSync("src/app/admin/operating-screen.tsx", "utf8");
    for (const src of [server, pure, screen]) {
      expect(src).not.toMatch(/resend|twilio|sendSms|sessions\.create/i);
    }
    expect(server).toContain("listClerkUsers");
    expect(server).toContain("classifySummittMembership");
    expect(server).toContain("isAppleRowCurrentlyGranting");
    const brooke = readFileSync("src/app/admin/subscriber-growth/page.tsx", "utf8");
    expect(brooke).not.toContain("nonmember");
    expect(brooke).toContain("loadSubscriberGrowthDashboard");
    const distribution = screen.indexOf("<AccountsWithoutMembership");
    const retention = screen.indexOf("function RetentionBody");
    expect(distribution).toBeGreaterThan(-1);
    expect(distribution).toBeLessThan(retention);
  });
});
