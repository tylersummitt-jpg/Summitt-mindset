import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_OBSERVATION_WINDOW_MS,
  CHECKOUT_TRACKING_VERSION,
  checkoutListLowerBoundMs,
  classifyCheckoutSession,
  shouldStampCheckoutSession,
  summarizeCheckoutSessions,
  type CheckoutSessionView,
} from "@/lib/checkout-tracking";
import {
  buildOperatingSnapshot,
  formatOperatingReport,
} from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";

const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);
const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";

function session(partial: Partial<CheckoutSessionView> & Pick<CheckoutSessionView, "id">): CheckoutSessionView {
  return {
    created: Math.floor(NOW / 1000) - 60,
    status: "open",
    metadata: { summittCheckoutTrack: CHECKOUT_TRACKING_VERSION, userId: "user_1" },
    subscriptionTrialStart: null,
    ...partial,
  };
}

describe("checkout session classification", () => {
  it("marks only a session this request just created", () => {
    const created = Math.floor(NOW / 1000);
    expect(shouldStampCheckoutSession(created, NOW)).toBe(true);
    expect(shouldStampCheckoutSession(created - 16 * 60, NOW)).toBe(false);
    expect(shouldStampCheckoutSession(Number.NaN, NOW)).toBe(false);
  });

  it("classifies success, expiry, pending, and incomplete without double counting", () => {
    const pending = session({ id: "cs_pending" });
    const expired = session({
      id: "cs_expired",
      status: "expired",
      created: Math.floor((NOW - CHECKOUT_OBSERVATION_WINDOW_MS - 1000) / 1000),
    });
    const incomplete = session({
      id: "cs_old_open",
      created: Math.floor((NOW - CHECKOUT_OBSERVATION_WINDOW_MS) / 1000),
    });
    const completed = session({
      id: "cs_done",
      status: "complete",
      subscriptionTrialStart: Math.floor(NOW / 1000),
    });
    const completedWithoutTrial = session({
      id: "cs_no_trial",
      status: "complete",
      subscriptionTrialStart: null,
    });
    const duplicate = session({ id: "cs_pending" });
    const unmarked = session({
      id: "cs_old",
      metadata: { userId: "user_1", customer: "cus_1" },
    });

    expect(classifyCheckoutSession(pending, NOW)).toBe("pending");
    expect(classifyCheckoutSession(expired, NOW)).toBe("expired");
    expect(classifyCheckoutSession(incomplete, NOW)).toBe("incomplete");
    expect(classifyCheckoutSession(completed, NOW)).toBe("completed_trial");
    expect(classifyCheckoutSession(completedWithoutTrial, NOW)).toBe("unknown");
    expect(classifyCheckoutSession(unmarked, NOW)).toBeNull();

    const summary = summarizeCheckoutSessions(
      [pending, expired, incomplete, completed, completedWithoutTrial, duplicate, unmarked],
      NOW
    );
    if (!summary) throw new Error("summary missing");
    expect(summary).toMatchObject({
      sessions: 5,
      pending: 1,
      expired: 1,
      incomplete: 1,
      completedTrial: 1,
      unknown: 1,
    });
    expect(
      summary.completedTrial +
        summary.pending +
        summary.expired +
        summary.incomplete +
        summary.unknown
    ).toBe(summary.sessions);
  });

  it("keeps missing attribution in the total and does not invent a source", () => {
    const summary = summarizeCheckoutSessions(
      [
        session({
          id: "cs_visitor",
          metadata: {
            summittCheckoutTrack: "1",
            userId: "user_1",
            visitorId: VISITOR,
            sourceNormalized: "meta",
          },
        }),
        session({
          id: "cs_account_only",
          metadata: { summittCheckoutTrack: "1", userId: "user_2" },
        }),
        session({
          id: "cs_neither",
          metadata: { summittCheckoutTrack: "1" },
        }),
      ],
      NOW
    );
    expect(summary).toMatchObject({
      sessions: 3,
      withVisitor: 1,
      accountWithoutVisitor: 1,
      noVisitorMatch: 1,
      unknownSource: 2,
    });
  });

  it("does not list sessions from before the instrumentation bound when the range is open", () => {
    expect(checkoutListLowerBoundMs(null)).toBe(Date.UTC(2026, 9, 10));
    expect(checkoutListLowerBoundMs(Date.UTC(2026, 9, 11))).toBe(Date.UTC(2026, 9, 11));
  });
});

function growth(): SubscriberGrowthDashboardData {
  const snapshot = emptyUnknownSnapshot();
  snapshot.notes.sourceTrackingUnavailable = false;
  snapshot.period.freeTrialButtonClicks = 8;
  snapshot.period.uniqueVisitors = 20;
  snapshot.period.accountsCreated = 4;
  snapshot.period.freeTrialsStarted = 2;
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

describe("checkout funnel on the shared report", () => {
  it("copies the same checkout counts and does not alert on ordinary incomplete checkouts", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growth(),
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      checkout: {
        listComplete: true,
        eventsComplete: true,
        sessions: 5,
        completedTrial: 1,
        pending: 1,
        expired: 2,
        incomplete: 1,
        unknown: 0,
        creationFailed: 0,
        withVisitor: 3,
        accountWithoutVisitor: 2,
        noVisitorMatch: 0,
        unknownSource: 2,
        openedEvents: 5,
      },
    });
    expect(snapshot.checkout.sessions).toBe("5");
    expect(snapshot.checkout.joinClicks).toBe("8");
    expect(snapshot.checkout.stepRate).toContain("Not shown");
    expect(snapshot.report).toContain("Checkout sessions started: 5");
    expect(snapshot.report).toContain("Expired: 2");
    expect(snapshot.report).toContain("Incomplete after 24 hours: 1");
    expect(snapshot.actions.map((action) => action.id)).not.toContain("checkout-creation-failed");
    expect(snapshot.actions.map((action) => action.id)).not.toContain("checkout-outcomes-unreadable");
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
  });

  it("turns recorded creation failures and an unreadable session list into actions", () => {
    const failed = buildOperatingSnapshot({
      growth: growth(),
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      checkout: {
        listComplete: false,
        eventsComplete: true,
        sessions: null,
        completedTrial: null,
        pending: null,
        expired: null,
        incomplete: null,
        unknown: null,
        creationFailed: 2,
        withVisitor: null,
        accountWithoutVisitor: null,
        noVisitorMatch: null,
        unknownSource: null,
        openedEvents: 0,
      },
    });
    const ids = failed.actions.map((action) => action.id);
    expect(ids).toContain("checkout-creation-failed");
    expect(ids).toContain("checkout-outcomes-unreadable");
    expect(failed.report).toContain("Technical creation failures: 2");
    expect(failed.report).not.toMatch(/@/);
  });
});

const insertMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

describe("checkout tracking writes", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

  it("marks a fresh session once and still resolves when the write fails", async () => {
    const { trackFreshCheckoutSession } = await import(
      "@/lib/checkout-tracking-record.server"
    );
    const update = vi.fn().mockRejectedValue(new Error("stripe down"));
    const stripe = {
      checkout: { sessions: { update } },
    } as unknown as import("stripe").default;
    const req = new Request("http://localhost/api/stripe/create-checkout-session", {
      headers: { cookie: `sm_visitor=${VISITOR}` },
    });
    await expect(
      trackFreshCheckoutSession({
        stripe,
        session: {
          id: "cs_fresh",
          created: Math.floor(NOW / 1000),
          metadata: { userId: "user_1", plan: "monthly" },
        },
        clerkUserId: "user_1",
        plan: "monthly",
        channel: "web",
        coach: false,
        req,
        nowMs: NOW,
      })
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    const metadata = update.mock.calls[0][1].metadata as Record<string, string>;
    expect(metadata.summittCheckoutTrack).toBe("1");
    expect(metadata.userId).toBe("user_1");
    expect(metadata.visitorId).toBe(VISITOR);
    expect(JSON.stringify(metadata)).not.toMatch(/@|phone|card|email/i);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.event_type).toBe("checkout_opened");
    expect(row.metadata.checkout_session_id).toBe("cs_fresh");
    expect(JSON.stringify(row)).not.toMatch(/@/);
  });

  it("does not mark an older replay as a new checkout start", async () => {
    const { trackFreshCheckoutSession } = await import(
      "@/lib/checkout-tracking-record.server"
    );
    const update = vi.fn();
    const stripe = {
      checkout: { sessions: { update } },
    } as unknown as import("stripe").default;
    await trackFreshCheckoutSession({
      stripe,
      session: {
        id: "cs_replay",
        created: Math.floor(NOW / 1000) - 60 * 60,
        metadata: { userId: "user_1", plan: "monthly" },
      },
      clerkUserId: "user_1",
      plan: "monthly",
      channel: "web",
      coach: false,
      req: new Request("http://localhost/api/stripe/create-checkout-session"),
      nowMs: NOW,
    });
    expect(update).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("records a creation failure without throwing when the insert fails", async () => {
    insertMock.mockRejectedValue(new Error("db down"));
    const { trackCheckoutCreationFailed } = await import(
      "@/lib/checkout-tracking-record.server"
    );
    await expect(
      trackCheckoutCreationFailed({
        clerkUserId: "user_1",
        plan: "monthly",
        channel: "web",
        req: new Request("http://localhost/api/stripe/create-checkout-session"),
      })
    ).resolves.toBeUndefined();
    expect(insertMock.mock.calls[0][0].event_type).toBe("checkout_creation_failed");
    expect(insertMock.mock.calls[0][0].metadata.checkout_session_id).toBeUndefined();
  });

  it("treats a duplicate checkout_opened insert as success", async () => {
    insertMock.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    const { trackFreshCheckoutSession } = await import(
      "@/lib/checkout-tracking-record.server"
    );
    const update = vi.fn().mockResolvedValue({});
    await expect(
      trackFreshCheckoutSession({
        stripe: { checkout: { sessions: { update } } } as unknown as import("stripe").default,
        session: {
          id: "cs_dup",
          created: Math.floor(NOW / 1000),
          metadata: { userId: "user_1", plan: "monthly" },
        },
        clerkUserId: "user_1",
        plan: "monthly",
        channel: "web",
        coach: false,
        req: new Request("http://localhost/api/stripe/create-checkout-session"),
        nowMs: NOW,
      })
    ).resolves.toBeUndefined();
  });
});
