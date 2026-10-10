import { describe, expect, it } from "vitest";

import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  buildOperatingSnapshot,
  DAILY_NEW_TRIAL_GOAL,
  formatOperatingReport,
  NO_CONTROLLED_EXPERIMENTS,
} from "@/lib/admin-operating-snapshot";
import {
  conversionRate,
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
  formatUnknownablePercent,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";

function growth(
  patch: Partial<SubscriberGrowthDashboardData["snapshot"]["period"]> = {},
  extras: Partial<SubscriberGrowthDashboardData> = {}
): SubscriberGrowthDashboardData {
  const snapshot = emptyUnknownSnapshot();
  snapshot.period = { ...snapshot.period, ...patch };
  return {
    range: "last_7",
    source: "all",
    timezone: "America/New_York",
    asOfNowLabel: "Oct 10, 2026, 8:00 AM",
    snapshot,
    latestTrials: [],
    warnings: ["hidden person@example.com"],
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
    ...extras,
  };
}

const noExtras = {
  challengeAttention: 0,
  deletions: null,
  deletionsAvailable: true,
};

describe("operating snapshot", () => {
  it("reuses the existing visitor-to-trial and trial-to-paid rates", () => {
    const data = growth({
      uniqueVisitors: 40,
      freeTrialsStarted: 10,
      trialToPaidRate: 0.25,
      trialsConvertedToPaid: 2,
    });
    const snapshot = buildOperatingSnapshot({ growth: data, ...noExtras });
    expect(snapshot.distribution.visitorToTrial).toBe(
      formatUnknownablePercent(conversionRate(10, 40))
    );
    expect(snapshot.distribution.trialToPaid).toBe(formatUnknownablePercent(0.25));
    expect(snapshot.distribution.newPayingMembers).toBe("2");
    expect(snapshot.distribution.goal).toContain(String(DAILY_NEW_TRIAL_GOAL));
    expect(snapshot.distribution.goal).toContain("target");
  });

  it("keeps missing counts unavailable", () => {
    const snapshot = buildOperatingSnapshot({ growth: growth(), ...noExtras });
    expect(snapshot.distribution.visitors).toBe("—");
    expect(snapshot.distribution.visitorToTrial).toBe("—");
    expect(snapshot.distribution.trialToPaid).toBe("—");
    expect(snapshot.retention.payingMembers).toBe("—");
    expect(snapshot.retention.churn).toBe("—");
    expect(snapshot.report).toContain("D30, D60, and D90");
    expect(snapshot.report).toContain("not available");
    expect(snapshot.report).toContain("Historical Stripe webhook completion is unverified");
    expect(snapshot.report).toContain("Instrumentation version 1");
    expect(snapshot.report).toContain("not unique people");
    expect(snapshot.report).not.toContain("Checkout abandonment is not measured yet");
  });

  it("does not invent actions when nothing is recorded", () => {
    const data = growth();
    data.snapshot.notes.sourceTrackingUnavailable = false;
    const snapshot = buildOperatingSnapshot({ growth: data, ...noExtras });
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.experiments).toEqual({ available: true, records: [] });
    expect(snapshot.report).toContain(NO_CONTROLLED_EXPERIMENTS);
    expect(snapshot.report).toContain("does not calculate a winner");
    expect(snapshot.report).toContain("Nothing recorded needs action");
  });

  it("turns recorded challenge and payment problems into the same action queue", () => {
    const data = growth({ paymentFailed: 3 });
    data.snapshot.asOfNow.paymentFailed = 1;
    data.snapshot.notes.sourceTrackingUnavailable = true;
    data.snapshot.notes.trackingFromNote = "Tracking from Oct 1, 2026";
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 2,
      deletions: {
        totalVisible: 4,
        inProgress: 1,
        failedRetryable: 1,
        failedTerminal: 0,
        completed: 2,
        structurallyInconsistent: 0,
        currentlyDiscoverable: 1,
      },
      deletionsAvailable: true,
    });
    const ids = snapshot.actions.map((action) => action.id);
    expect(ids).toContain("challenge-attention");
    expect(ids).toContain("stripe-payment-failed-period");
    expect(ids).toContain("stripe-past-due-now");
    expect(ids).toContain("account-deletion-failures");
    expect(ids).toContain("source-tracking");
    const tracking = snapshot.actions.find((action) => action.id === "source-tracking");
    expect(tracking?.kind).toBe("limitation");
    expect(snapshot.report).not.toContain("person@example.com");
    expect(snapshot.report).not.toMatch(/@/);
  });

  it("builds one report both pages can copy", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growth({ freeTrialsStarted: 14, uniqueVisitors: 70 }),
      ...noExtras,
    });
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    expect(formatOperatingReport(rest)).toBe(formatOperatingReport(rest));
    expect(snapshot.distribution.trialsPerDay).toContain("2.0");
  });

  it("does not show a daily average for all time", () => {
    const data = growth({ freeTrialsStarted: 100 });
    data.range = "all_time";
    const snapshot = buildOperatingSnapshot({ growth: data, ...noExtras });
    expect(snapshot.distribution.trialsPerDay).toContain("All time");
  });

  it("puts both areas in one report and does not treat completion as a win", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growth(),
      ...noExtras,
      experiments: {
        available: true,
        records: [
          {
            id: "exp-distribution",
            name: "Homepage paid conversion",
            area: "distribution",
            hypothesis: "A shorter homepage increases paid conversion.",
            control: "Current homepage",
            challenger: "Shorter homepage",
            primaryOutcome: "Eventual paid conversion",
            decisionCriteria: "Decide only after enough paid outcomes, not clicks.",
            secondaryOutcomes: null,
            startOn: "2026-10-01",
            endOn: "2026-10-10",
            decisionOn: "2026-10-10",
            status: "completed",
            evidence: "directional",
            conclusion: "The difference is only directional.",
            nextAction: "Keep the current homepage.",
            limitations: "The paid cohort is still small.",
            entrySlug: null,
            controlPath: null,
            challengerPath: null,
            amendments: [],
          },
          {
            id: "exp-retention",
            name: "Week two reminder",
            area: "retention",
            hypothesis: "A reminder changes week-two retention.",
            control: "No extra reminder",
            challenger: "One reminder",
            primaryOutcome: "Mature week-two retention",
            decisionCriteria: "Wait until the cohort is mature.",
            secondaryOutcomes: null,
            startOn: null,
            endOn: null,
            decisionOn: null,
            status: "planned",
            evidence: "not_yet_tested",
            conclusion: null,
            nextAction: "Start when the cohort definition is ready.",
            limitations: null,
            entrySlug: null,
            controlPath: null,
            challengerPath: null,
            amendments: [],
          },
        ],
      },
    });
    const experiments = snapshot.report.split("EXPERIMENTS\n")[1]?.split("\nUNKNOWNS")[0] ?? "";
    expect(experiments).toContain("Homepage paid conversion");
    expect(experiments).toContain("Week two reminder");
    expect(experiments).toContain("Directional");
    expect(experiments).toContain("Not yet tested");
    expect(experiments).toContain("Keep the current homepage.");
    expect(experiments).toContain("Start when the cohort definition is ready.");
    expect(experiments).toContain(NO_CONTROLLED_EXPERIMENTS);
    expect(experiments).not.toContain("Proven");
    expect(experiments).not.toMatch(/\bwon\b/i);
    expect(experiments).not.toContain("successful");
    expect(snapshot.report).not.toMatch(/@/);
  });

  it("says the registry is unknown when it cannot be read", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growth(),
      ...noExtras,
      experiments: { available: false, records: [] },
    });
    expect(snapshot.report).not.toContain(NO_CONTROLLED_EXPERIMENTS);
    expect(snapshot.report).toContain("could not be read");
    expect(snapshot.report).toContain("Do not treat that as zero experiments.");
    expect(snapshot.actions.map((action) => action.id)).toContain(
      "experiment-registry-unreadable"
    );
  });
});
