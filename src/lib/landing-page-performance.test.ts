import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
} from "@/lib/admin-subscriber-growth-pure";
import {
  LANDING_FIRST_PAYMENT_WINDOW_MS,
  LANDING_PAGE_MEASUREMENT_CUTOVER_MS,
  summarizeLandingPagePerformance,
  toLandingBilling,
  type LandingBillingInput,
  type LandingIdentityLink,
  type LandingTrialSeed,
} from "@/lib/landing-page-performance";
import {
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  trialCtaSurfaceFromHref,
  isMarketingPageViewPath,
} from "@/lib/marketing-attribution-pure";

const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AFTER = LANDING_PAGE_MEASUREMENT_CUTOVER_MS + 60_000;

function growth() {
  return {
    range: "last_7" as const,
    source: "all" as const,
    timezone: "America/New_York" as const,
    asOfNowLabel: "Oct 10, 2026, 8:00 AM",
    snapshot: emptyUnknownSnapshot(),
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

describe("landing page measurement", () => {
  it("counts a refreshed visitor once and does not treat a click as a trial", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 1000 },
        { kind: "cta_click", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 2000 },
        { kind: "cta_click", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 3000 },
      ],
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    expect(leadership?.visitors).toBe(1);
    expect(leadership?.ctaClicks).toBe(1);
    expect(leadership?.ctaRate).toBe("100.0%");
    expect(leadership?.trials).toBe("Not available");
    expect(leadership?.paid).toBe("Not available");
    expect(summary.note).toContain("not a controlled experiment");
  });

  it("gives one later checkout to the first measured page only", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: VISITOR, path: "/daily-coaching", occurredAtMs: AFTER + 1000 },
        { kind: "checkout", visitorId: VISITOR, path: null, occurredAtMs: AFTER + 2000 },
        { kind: "checkout", visitorId: OTHER, path: null, occurredAtMs: AFTER },
      ],
    });
    expect(summary.rows.find((row) => row.id === "homepage")?.checkoutStarts).toBe(1);
    expect(summary.rows.find((row) => row.id === "daily_coaching")?.checkoutStarts).toBe(0);
    expect(summary.rows.every((row) => row.trials === "Not available")).toBe(true);
  });

  it("ignores new-page history before the instrumentation cutover", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        {
          kind: "page_view",
          visitorId: VISITOR,
          path: "/become-proud",
          occurredAtMs: LANDING_PAGE_MEASUREMENT_CUTOVER_MS - 1000,
        },
      ],
    });
    expect(summary.rows.find((row) => row.id === "become_proud")?.visitors).toBe(0);
  });

  it("does not call the analytics unreadable when the read succeeded with zero rows", () => {
    const data = growth();
    data.snapshot.notes.sourceTrackingUnavailable = false;
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
    });
    expect(snapshot.actions.map((action) => action.id)).not.toContain(
      "landing-page-analytics-unreadable"
    );
    expect(snapshot.report).toContain("LANDING PAGE PERFORMANCE");
    expect(snapshot.report).toContain("Attributed trials: Not available");
    expect(snapshot.report).not.toMatch(/\bwon\b/i);
  });

  it("keeps the original first-touch source after a later landing page", () => {
    const first = resolveMarketingCookies({
      pathname: "/",
      search: "utm_source=google&utm_medium=cpc",
      nowIso: "2026-10-10T12:00:00.000Z",
      generatedVisitorId: VISITOR,
    });
    const later = resolveMarketingCookies({
      pathname: "/leadership",
      search: "utm_source=facebook&utm_medium=cpc",
      existingVisitor: first?.visitorId,
      existingAcqRaw: serializeAcquisitionCookie(first!.payload),
      nowIso: "2026-10-11T12:00:00.000Z",
      generatedVisitorId: OTHER,
    });
    expect(later?.visitorId).toBe(VISITOR);
    expect(later?.payload.source_normalized).toBe(first?.payload.source_normalized);
    expect(isMarketingPageViewPath("/leadership")).toBe(true);
    expect(isMarketingPageViewPath("/leadership/extra")).toBe(false);
    expect(trialCtaSurfaceFromHref("/sign-up?redirect_url=%2Fcheckout%2Fstart", "/leadership")).toBe(
      "landing_leadership"
    );
  });
});

const CLERK = "user_landing";
const DAY = 24 * 60 * 60 * 1000;

function readyBilling(
  trials: LandingTrialSeed[],
  payments: LandingBillingInput["payments"] = []
): LandingBillingInput {
  return {
    subscriptionsReadable: true,
    paymentsReadable: true,
    trials,
    payments,
  };
}

function link(visitorId = VISITOR, clerkUserId = CLERK): LandingIdentityLink {
  return { clerkUserId, visitorId, acquisitionSource: "meta" };
}

describe("landing page trial and paid attribution", () => {
  it("credits one trial to the first page and then one confirmed payment", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 8 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: VISITOR, path: "/daily-coaching", occurredAtMs: AFTER + DAY },
        { kind: "checkout", visitorId: VISITOR, path: null, occurredAtMs: AFTER + DAY },
      ],
      identities: [link()],
      billing: readyBilling(
        [
          {
            clerkUserId: CLERK,
            trialStartMs: AFTER + 2 * DAY,
            trialEndMs: AFTER + 9 * DAY,
            status: "active",
          },
          {
            clerkUserId: CLERK,
            trialStartMs: AFTER + 4 * DAY,
            trialEndMs: AFTER + 11 * DAY,
            status: "trialing",
          },
        ],
        [{ clerkUserId: CLERK, paidAtMs: AFTER + 9 * DAY }]
      ),
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    const daily = summary.rows.find((row) => row.id === "daily_coaching");
    expect(leadership?.trials).toBe(1);
    expect(leadership?.visitorToTrial).toBe("100.0%");
    expect(leadership?.paid).toBe(1);
    expect(leadership?.trialToPaid).toBe("100.0%");
    expect(daily?.trials).toBe(0);
    expect(daily?.paid).toBe(0);
    expect(summary.note).toContain("no reliable landing page: 0");
    expect(leadership?.gap).toContain("meta 1");
  });

  it("keeps a trial unattributed when the account link is missing or conflicts", () => {
    const trial: LandingTrialSeed = {
      clerkUserId: CLERK,
      trialStartMs: AFTER + DAY,
      trialEndMs: AFTER + 8 * DAY,
      status: "trialing",
    };
    const missing = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 2 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/become-proud", occurredAtMs: AFTER },
      ],
      identities: [],
      billing: readyBilling([trial]),
    });
    expect(missing.note).toContain("no reliable landing page: 1");
    expect(missing.rows.every((row) => row.trials === 0)).toBe(true);

    const conflict = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 2 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/become-proud", occurredAtMs: AFTER },
      ],
      identities: [link(VISITOR), link(OTHER)],
      billing: readyBilling([trial]),
    });
    expect(conflict.note).toContain("no reliable landing page: 1");
    expect(conflict.rows.every((row) => row.trials === 0)).toBe(true);
  });

  it("does not move credit to a page visited after the trial starts", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 2 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/life-worth-remembering", occurredAtMs: AFTER + DAY },
      ],
      identities: [link()],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER,
          trialEndMs: AFTER + 7 * DAY,
          status: "trialing",
        },
      ]),
    });
    expect(summary.note).toContain("no reliable landing page: 1");
    expect(summary.rows.every((row) => row.trials === 0)).toBe(true);
  });

  it("leaves a running trial out of the mature paid rate", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 2 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/", occurredAtMs: AFTER },
      ],
      identities: [link()],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER + DAY,
          trialEndMs: AFTER + 8 * DAY,
          status: "trialing",
        },
      ]),
    });
    const home = summary.rows.find((row) => row.id === "homepage");
    expect(home?.trials).toBe(1);
    expect(home?.paid).toBe(0);
    expect(home?.trialToPaid).toBe("Not available");
    expect(home?.gap).toContain("Trials still running: 1");
  });

  it("does not call past_due or an ended trial without a payment paid", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 10 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: OTHER, path: "/daily-coaching", occurredAtMs: AFTER },
      ],
      identities: [
        link(VISITOR, CLERK),
        { clerkUserId: "user_other", visitorId: OTHER, acquisitionSource: null },
      ],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER + DAY,
          trialEndMs: AFTER + 8 * DAY,
          status: "past_due",
        },
        {
          clerkUserId: "user_other",
          trialStartMs: AFTER + DAY,
          trialEndMs: AFTER + 8 * DAY,
          status: "canceled",
        },
      ]),
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    const daily = summary.rows.find((row) => row.id === "daily_coaching");
    expect(leadership?.paid).toBe(0);
    expect(leadership?.trialToPaid).toBe("0.0%");
    expect(leadership?.gap).toContain("ended without a confirmed payment: 1");
    expect(daily?.paid).toBe(0);
    expect(daily?.trialToPaid).toBe("0.0%");
  });

  it("does not treat an active subscription without a successful payment as paid", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 10 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
      ],
      identities: [link()],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER + DAY,
          trialEndMs: AFTER + 8 * DAY,
          status: "active",
        },
      ]),
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    expect(leadership?.paid).toBe(0);
    expect(leadership?.trialToPaid).toBe("Not available");
    expect(leadership?.gap).toContain("Paid outcome unknown: 1");
    expect(leadership?.gap).toContain("Apple memberships are not included");
  });

  it("ignores a renewal and an Apple-only payment", () => {
    const trialEnd = AFTER + 8 * DAY;
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: trialEnd + LANDING_FIRST_PAYMENT_WINDOW_MS + DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
      ],
      identities: [link()],
      billing: readyBilling(
        [
          {
            clerkUserId: CLERK,
            trialStartMs: AFTER + DAY,
            trialEndMs: trialEnd,
            status: "active",
          },
        ],
        [
          { clerkUserId: CLERK, paidAtMs: trialEnd + LANDING_FIRST_PAYMENT_WINDOW_MS + 1000 },
          { clerkUserId: "apple_only", paidAtMs: AFTER + 9 * DAY },
        ]
      ),
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    expect(leadership?.trials).toBe(1);
    expect(leadership?.paid).toBe(0);
    expect(summary.rows.reduce((sum, row) => sum + (row.paid === "Not available" ? 0 : row.paid), 0)).toBe(0);
  });

  it("excludes an earlier page view from the visitor-to-trial rate", () => {
    const periodStart = AFTER + 2 * DAY;
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 4 * DAY,
      periodStartMs: periodStart,
      periodEndMs: AFTER + 5 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: periodStart + 1000 },
      ],
      attributionViews: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 1000 },
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: periodStart + 1000 },
      ],
      identities: [link()],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER + 3 * DAY,
          trialEndMs: AFTER + 10 * DAY,
          status: "trialing",
        },
      ]),
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    expect(leadership?.visitors).toBe(1);
    expect(leadership?.trials).toBe(1);
    expect(leadership?.visitorToTrial).toBe("0.0%");
    expect(leadership?.gap).toContain("not in the visitor-to-trial rate");
  });

  it("does not use a pre-cutover page view or a checkout as a trial", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + DAY,
      observations: [
        {
          kind: "page_view",
          visitorId: VISITOR,
          path: "/leadership",
          occurredAtMs: LANDING_PAGE_MEASUREMENT_CUTOVER_MS - 1000,
        },
        { kind: "checkout", visitorId: OTHER, path: null, occurredAtMs: AFTER },
      ],
      identities: [link()],
      billing: readyBilling([
        {
          clerkUserId: CLERK,
          trialStartMs: AFTER,
          trialEndMs: AFTER + 7 * DAY,
          status: "trialing",
        },
      ]),
    });
    expect(summary.rows.every((row) => row.trials === 0)).toBe(true);
    expect(summary.note).toContain("no reliable landing page: 1");
  });

  it("maps a Stripe trial and a paid invoice without counting a customer id as payment", () => {
    const billing = toLandingBilling({
      subscriptionsReadable: true,
      paymentsReadable: true,
      recognizedPriceIds: new Set(["price_123"]),
      subs: [
        {
          id: "sub_trial",
          status: "trialing",
          trial_start: 100,
          trial_end: 200,
          metadata: { userId: CLERK },
        },
        {
          id: "sub_other",
          status: "active",
          trial_start: 100,
          metadata: {},
          customer: "cus_123",
        },
      ],
      paidInvoices: [{ subscriptionId: "sub_trial", paidAtUnix: 180 }],
    });
    expect(billing.trials).toEqual([
      {
        clerkUserId: CLERK,
        trialStartMs: 100000,
        trialEndMs: 200000,
        status: "trialing",
      },
    ]);
    expect(billing.payments).toEqual([{ clerkUserId: CLERK, paidAtMs: 180000 }]);
    expect(toLandingBilling({
      subscriptionsReadable: false,
      paymentsReadable: false,
      recognizedPriceIds: new Set(),
      subs: [],
      paidInvoices: [],
    }).subscriptionsReadable).toBe(false);
  });

  it("puts the same trial and paid lines in the shared report", () => {
    const landing = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      nowMs: AFTER + 8 * DAY,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
      ],
      identities: [link()],
      billing: readyBilling(
        [
          {
            clerkUserId: CLERK,
            trialStartMs: AFTER + DAY,
            trialEndMs: AFTER + 8 * DAY,
            status: "active",
          },
        ],
        [{ clerkUserId: CLERK, paidAtMs: AFTER + 8 * DAY }]
      ),
    });
    const data = growth();
    data.snapshot.notes.sourceTrackingUnavailable = false;
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      landingPages: landing,
    });
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.report).toContain("Attributed trials: 1");
    expect(snapshot.report).toContain("Confirmed paid conversions: 1");
    expect(snapshot.report).toContain("Trial-to-paid, mature trials: 100.0%");
    expect(snapshot.report).not.toMatch(/\bwon\b/i);
    expect(snapshot.report).not.toContain(CLERK);
    expect(snapshot.report).not.toContain(VISITOR);
  });
});

describe("landing pages stay off the homepage and Brooke's page", () => {
  it("does not replace the homepage or subscriber growth", () => {
    const root = process.cwd();
    const home = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    const brooke = readFileSync(join(root, "src/app/admin/subscriber-growth/page.tsx"), "utf8");
    const layout = readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8");
    const screen = readFileSync(join(root, "src/app/admin/operating-screen.tsx"), "utf8");
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    expect(home).not.toContain("AudienceLandingRoute");
    expect(home).not.toContain("/leadership");
    expect(brooke).not.toContain("Landing Page Performance");
    expect(layout).not.toContain("/leadership");
    expect(screen).toContain("Landing Page Performance");
    expect(screen.slice(screen.indexOf("function RetentionBody"))).not.toContain(
      "Landing Page Performance"
    );
    const copy = readFileSync(join(root, "src/lib/audience-landing-pages.ts"), "utf8");
    const view = readFileSync(join(root, "src/components/audience-landing-page.tsx"), "utf8");
    expect(copy).toContain("Pat Summitt's lessons. In your corner every day.");
    expect(copy).toContain("Build a life you're proud of. One day at a time.");
    expect(copy).toContain("Real accountability. One text at a time.");
    expect(copy).toContain("Be proud of your life. Remember how you got there.");
    expect(copy).toContain("Example conversation");
    expect(view).toContain("marketingAcquisitionHref");
    expect(view).toContain("MEMBERSHIP_PUBLIC_OFFER");
    expect(view).toContain("You do not pay the monthly price and the yearly price together.");
    expect(view).toContain("Pat Summitt is not personally sending");
    for (const path of [
      "/leadership",
      "/become-proud",
      "/daily-coaching",
      "/life-worth-remembering",
    ]) {
      expect(middleware).toContain(`"${path}"`);
      const page = readFileSync(join(root, `src/app${path}/page.tsx`), "utf8");
      expect(page).toContain("AudienceLandingRoute");
      expect(page).toContain("audienceLandingMetadata");
    }
  });
});
