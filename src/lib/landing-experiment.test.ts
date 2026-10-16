import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
} from "@/lib/admin-subscriber-growth-pure";
import { growthPeriodUtcMs } from "@/lib/admin-subscriber-growth-pure";
import {
  APPROVED_LANDING_DESTINATIONS,
  assignProudTestVariant,
  decideHomepageSplit,
  isExperimentDocumentRequest,
  decideLandingEntry,
  decideProudTestEntry,
  cohortInvoiceAnchorMs,
  experimentInvoiceWindow,
  exposureMatchesDestination,
  isLandingExperimentEntryPath,
  isLikelyBotUserAgent,
  landingAssignmentFromInput,
  parseLandingAssignments,
  parseProudTestAssignment,
  PROUD_TEST_DEFINITION,
  PROUD_TEST_EXPERIMENT_ID,
  PROUD_TEST_TRIAL_WINDOW_MS,
  serializeProudTestAssignment,
  summarizeProudTest,
} from "@/lib/landing-experiment";
import { parseExperimentDefinition } from "@/lib/operating-experiments";

const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLERK = "user_proud";
const EXPOSED = Date.parse("2026-10-12T15:00:00.000Z");
const NOW = EXPOSED + 10 * 24 * 60 * 60 * 1000;

function growth() {
  return {
    range: "last_7" as const,
    source: "all" as const,
    timezone: "America/New_York" as const,
    asOfNowLabel: "Oct 12, 2026, 8:00 AM",
    snapshot: emptyUnknownSnapshot(),
    latestTrials: [],
    warnings: [],
    adSpendEntries: [],
    activationQueryComplete: true,
    latestTrialsActivationComplete: true,
    adSpendQueryComplete: true,
    todayDateKey: "2026-10-12",
    stripeWeek: emptyStripeWeekMovement(),
    currentFreeTrials: emptyCurrentFreeTrials(),
    recentActivity: null,
    recentActivityPaymentFailedIncluded: false,
    trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
    visitorCohortTable: emptyVisitorCohortTable(),
    homepageVideo: emptyHomepageVideoReport(),
  };
}

describe("proud test assignment", () => {
  it("keeps the same visitor on the same variant", () => {
    const first = assignProudTestVariant(VISITOR);
    expect(assignProudTestVariant(VISITOR)).toBe(first);
    expect(assignProudTestVariant(VISITOR, PROUD_TEST_EXPERIMENT_ID)).toBe(first);
  });

  it("splits a large sample without requiring an exact half", () => {
    let control = 0;
    for (let index = 0; index < 2000; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      if (assignProudTestVariant(id) === "control") control += 1;
    }
    expect(control).toBeGreaterThan(800);
    expect(control).toBeLessThan(1200);
  });

  it("sends a returning visitor to the stored variant", () => {
    const challengerVisitor = OTHER;
    const natural = assignProudTestVariant(challengerVisitor);
    const stored = natural === "control" ? "challenger" : "control";
    const decision = decideProudTestEntry({
      status: "running",
      visitorId: challengerVisitor,
      existingVariant: stored,
      userAgent: "Mozilla/5.0",
      prefetch: false,
    });
    expect(decision.created).toBe(false);
    expect(decision.variant).toBe(stored);
    expect(decision.destination).toBe(stored === "control" ? "/" : "/become-proud");
  });

  it("does not assign when the test is paused, completed, planned, or unreadable", () => {
    for (const status of ["paused", "completed", "planned", "missing", "unavailable"] as const) {
      const decision = decideProudTestEntry({
        status,
        visitorId: VISITOR,
        existingVariant: null,
        userAgent: "Mozilla/5.0",
        prefetch: false,
      });
      expect(decision.destination).toBe("/");
      expect(decision.created).toBe(false);
    }
  });

  it("keeps an already assigned visitor on that variant when new assignment is stopped", () => {
    const decision = decideProudTestEntry({
      status: "paused",
      visitorId: VISITOR,
      existingVariant: "challenger",
      userAgent: "Mozilla/5.0",
      prefetch: false,
    });
    expect(decision.destination).toBe("/become-proud");
    expect(decision.created).toBe(false);
  });

  it("falls back to the homepage for bots, prefetch, and a missing visitor", () => {
    expect(isLikelyBotUserAgent("Googlebot")).toBe(true);
    expect(
      decideProudTestEntry({
        status: "running",
        visitorId: VISITOR,
        existingVariant: null,
        userAgent: "curl/8.0",
        prefetch: false,
      }).created
    ).toBe(false);
    expect(
      decideProudTestEntry({
        status: "running",
        visitorId: VISITOR,
        existingVariant: null,
        userAgent: "Mozilla/5.0",
        prefetch: true,
      }).destination
    ).toBe("/");
    expect(
      decideProudTestEntry({
        status: "running",
        visitorId: null,
        existingVariant: null,
        userAgent: "Mozilla/5.0",
        prefetch: false,
      }).destination
    ).toBe("/");
  });

  it("assigns a new eligible visitor only while the test is running", () => {
    const decision = decideProudTestEntry({
      status: "running",
      visitorId: VISITOR,
      existingVariant: null,
      userAgent: "Mozilla/5.0",
      prefetch: false,
    });
    expect(decision.created).toBe(true);
    expect(decision.variant).toBe(assignProudTestVariant(VISITOR));
    expect(parseProudTestAssignment(serializeProudTestAssignment(decision.variant!))?.variant).toBe(
      decision.variant
    );
  });
});

describe("proud test outcomes", () => {
  it("counts one exposure, one trial, and one confirmed payment on the exposed variant", () => {
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      trialsReadable: true,
      paymentsReadable: true,
      signalsReadable: true,
      status: "running",
      startOn: "2026-10-01",
      nowMs: NOW,
      exposures: [
        { visitorId: VISITOR, variant: "control", occurredAtMs: EXPOSED },
        { visitorId: VISITOR, variant: "control", occurredAtMs: EXPOSED + 1000 },
        { visitorId: OTHER, variant: "challenger", occurredAtMs: EXPOSED },
      ],
      identities: [{ clerkUserId: CLERK, visitorId: VISITOR }],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 60_000,
          trialEndMs: EXPOSED + 8 * 24 * 60 * 60 * 1000,
          status: "active",
        },
      ],
      payments: [{ clerkUserId: CLERK, paidAtMs: EXPOSED + 8 * 24 * 60 * 60 * 1000 }],
      signals: [
        { visitorId: VISITOR, kind: "click", occurredAtMs: EXPOSED + 1000 },
        { visitorId: VISITOR, kind: "checkout", occurredAtMs: EXPOSED + 2000 },
      ],
    });
    const control = report.rows.find((row) => row.variant === "control");
    const challenger = report.rows.find((row) => row.variant === "challenger");
    expect(control?.exposed).toBe(1);
    expect(control?.trials).toBe(1);
    expect(control?.trialRate).toBe("100.0%");
    expect(control?.paid).toBe(1);
    expect(control?.matureRate).toBe("100.0%");
    expect(control?.clicks).toBe(1);
    expect(control?.checkouts).toBe(1);
    expect(challenger?.exposed).toBe(1);
    expect(challenger?.trials).toBe(0);
    expect(challenger?.paid).toBe(0);
    expect(report.difference).toContain("not a winner");
    expect(report.coverage).not.toContain(VISITOR);
  });

  it("does not credit a redirect, a conflicting identity, a split visitor, or a late trial", () => {
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      trialsReadable: true,
      paymentsReadable: true,
      signalsReadable: true,
      status: "running",
      nowMs: NOW,
      exposures: [
        { visitorId: VISITOR, variant: "control", occurredAtMs: EXPOSED },
        { visitorId: VISITOR, variant: "challenger", occurredAtMs: EXPOSED + 1000 },
      ],
      identities: [
        { clerkUserId: CLERK, visitorId: VISITOR },
        { clerkUserId: CLERK, visitorId: OTHER },
        { clerkUserId: "user_late", visitorId: OTHER },
      ],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 60_000,
          trialEndMs: EXPOSED + 8 * 24 * 60 * 60 * 1000,
          status: "active",
        },
        {
          clerkUserId: "user_late",
          trialStartMs: EXPOSED + PROUD_TEST_TRIAL_WINDOW_MS + 60_000,
          trialEndMs: null,
          status: "trialing",
        },
        {
          clerkUserId: "user_unrelated",
          trialStartMs: EXPOSED,
          trialEndMs: EXPOSED + 1000,
          status: "canceled",
        },
      ],
      payments: [],
    });
    expect(report.rows.every((row) => row.trials === 0)).toBe(true);
    expect(report.unknownTrials).toBe(1);
    expect(report.coverage).toContain("both variants");
  });

  it("leaves a running trial out of the mature rate and does not treat past_due as paid", () => {
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      trialsReadable: true,
      paymentsReadable: true,
      signalsReadable: true,
      status: "running",
      nowMs: EXPOSED + 2 * 24 * 60 * 60 * 1000,
      exposures: [
        { visitorId: VISITOR, variant: "challenger", occurredAtMs: EXPOSED },
        { visitorId: OTHER, variant: "control", occurredAtMs: EXPOSED },
      ],
      identities: [
        { clerkUserId: CLERK, visitorId: VISITOR },
        { clerkUserId: "user_due", visitorId: OTHER },
      ],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 1000,
          trialEndMs: EXPOSED + 8 * 24 * 60 * 60 * 1000,
          status: "trialing",
        },
        {
          clerkUserId: "user_due",
          trialStartMs: EXPOSED + 1000,
          trialEndMs: EXPOSED + 24 * 60 * 60 * 1000,
          status: "past_due",
        },
      ],
      payments: [],
    });
    const challenger = report.rows.find((row) => row.variant === "challenger");
    const control = report.rows.find((row) => row.variant === "control");
    expect(challenger?.trials).toBe(1);
    expect(challenger?.paid).toBe(0);
    expect(challenger?.matureRate).toBe("Not available");
    expect(control?.paid).toBe(0);
    expect(control?.matureRate).toBe("0.0%");
  });

  it("stores the decision rules and does not start the test from the definition", () => {
    const definition = parseExperimentDefinition(PROUD_TEST_DEFINITION);
    expect(definition.primaryOutcome).toContain("per unique eligible assigned visitor");
    expect(definition.decisionCriteria).toContain("100 assigned visitors");
    expect(definition.decisionCriteria).toContain("does not select a winner");
    expect(definition.decisionCriteria.length).toBeLessThanOrEqual(2000);
    expect(PROUD_TEST_DEFINITION.nextAction).toContain("Eligible anonymous visitors to /");
  });

  it("keeps an assigned visitor in the trial denominator when the exposure is missing", () => {
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      paymentsReadable: true,
      trialsReadable: true,
      signalsReadable: true,
      assignmentsReadable: true,
      accountsReadable: true,
      behaviorsReadable: true,
      status: "running",
      assignments: [
        {
          visitorId: VISITOR,
          variant: "control",
          occurredAtMs: EXPOSED,
          campaign: "sm_cold",
          device: "mobile",
          os: "ios",
          browser: "safari",
          inApp: "none",
          synthetic: false,
        },
        {
          visitorId: OTHER,
          variant: "challenger",
          occurredAtMs: EXPOSED,
          campaign: "sm_cold",
          device: "desktop",
          os: "other",
          browser: "chrome",
          inApp: "none",
          synthetic: false,
        },
      ],
      exposures: [],
      identities: [{ clerkUserId: CLERK, visitorId: VISITOR }],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 60_000,
          trialEndMs: null,
          status: "trialing",
        },
      ],
      payments: [],
      signals: [],
      nowMs: NOW,
    });
    const control = report.rows.find((row) => row.variant === "control");
    expect(control?.assigned).toBe(1);
    expect(control?.exposed).toBe(0);
    expect(control?.trials).toBe(1);
    expect(control?.trialRate).toBe("100.0%");
    expect(control?.exposedTrialRate).toBe("Not available");
    expect(report.evidenceState).toBe("Collecting Data");
  });

  it("keeps open trial windows and unlinked Stripe trials out of the winner math", () => {
    const recent = NOW - 24 * 60 * 60 * 1000;
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      paymentsReadable: true,
      trialsReadable: true,
      signalsReadable: true,
      assignmentsReadable: true,
      accountsReadable: true,
      status: "running",
      startOn: "2026-10-12",
      assignments: [
        {
          visitorId: VISITOR,
          variant: "control",
          occurredAtMs: recent,
          campaign: "",
          device: "desktop",
          os: "other",
          browser: "other",
          inApp: "none",
          synthetic: false,
        },
      ],
      exposures: [{ visitorId: VISITOR, variant: "control", occurredAtMs: recent }],
      accounts: [
        { visitorId: VISITOR, occurredAtMs: recent - 60_000 },
        { visitorId: VISITOR, occurredAtMs: recent + 60_000 },
      ],
      identities: [
        { clerkUserId: CLERK, visitorId: VISITOR },
        { clerkUserId: "user_elsewhere", visitorId: OTHER },
      ],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: recent + 8 * 24 * 60 * 60 * 1000,
          trialEndMs: null,
          status: "trialing",
        },
        {
          clerkUserId: null,
          trialStartMs: recent,
          trialEndMs: null,
          status: "trialing",
        },
        {
          clerkUserId: "user_elsewhere",
          trialStartMs: recent,
          trialEndMs: null,
          status: "trialing",
        },
      ],
      payments: [],
      signals: [],
      nowMs: NOW,
    });
    const control = report.rows.find((row) => row.variant === "control");
    expect(control?.assigned).toBe(1);
    expect(control?.trials).toBe(0);
    expect(control?.trialRate).toBe("0.0%");
    expect(control?.accounts).toBe(0);
    expect(control?.priorAccounts).toBe(1);
    expect(report.unknownTrials).toBe(0);
    expect(report.evidenceState).toBe("Collecting Data");
    expect(report.coverage).toContain("still inside the 7-day trial window");
    expect(report.coverage).toContain("1 with no visitor link");
    expect(report.coverage).toContain("1 linked to people outside this test");
    expect(report.coverage).toContain("not subtracted from either page");
    expect(report.coverage).toContain("Apple memberships are excluded");
    expect(report.deviceNote).toContain("Unknown");
    expect(report.deviceNote).not.toContain("other");
    expect(report.campaignNote).toContain("Unknown");
  });

  it("does not call a winner when page-view coverage differs sharply", () => {
    const closedAt = NOW - 20 * 24 * 60 * 60 * 1000;
    const assignments = [];
    const exposures = [];
    const identities = [];
    const trials = [];
    for (let i = 0; i < 100; i += 1) {
      const controlId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const challengerId = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
      assignments.push(
        {
          visitorId: controlId,
          variant: "control" as const,
          occurredAtMs: closedAt,
          campaign: "shared",
          device: "mobile" as const,
          os: "ios" as const,
          browser: "safari" as const,
          inApp: "none" as const,
          synthetic: false,
        },
        {
          visitorId: challengerId,
          variant: "challenger" as const,
          occurredAtMs: closedAt,
          campaign: "shared",
          device: "mobile" as const,
          os: "ios" as const,
          browser: "safari" as const,
          inApp: "none" as const,
          synthetic: false,
        }
      );
      exposures.push({ visitorId: controlId, variant: "control" as const, occurredAtMs: closedAt });
      if (i < 40) {
        const clerk = `user_gap_${i}`;
        identities.push({ clerkUserId: clerk, visitorId: controlId });
        trials.push({
          clerkUserId: clerk,
          trialStartMs: closedAt + 60_000,
          trialEndMs: null,
          status: "trialing",
        });
      }
    }
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      paymentsReadable: true,
      trialsReadable: true,
      signalsReadable: true,
      assignmentsReadable: true,
      status: "running",
      startOn: "2026-08-01",
      assignments,
      exposures,
      identities,
      trials,
      payments: [],
      signals: [],
      nowMs: NOW,
    });
    expect(report.rows.find((row) => row.variant === "control")?.assigned).toBe(100);
    expect(report.rows.find((row) => row.variant === "control")?.trials).toBe(40);
    expect(report.evidenceState).toBe("Measurement Problem");
    expect(report.evidenceNote).toContain("not confirming page views at a similar rate");
  });

  it("does not credit a trial when the exposure disagrees with the assignment", () => {
    const report = summarizeProudTest({
      loaded: true,
      exposuresReadable: true,
      paymentsReadable: true,
      trialsReadable: true,
      signalsReadable: true,
      assignmentsReadable: true,
      status: "running",
      assignments: [
        {
          visitorId: VISITOR,
          variant: "control",
          occurredAtMs: EXPOSED,
          campaign: null,
          device: null,
          os: null,
          browser: null,
          inApp: null,
          synthetic: false,
        },
      ],
      exposures: [{ visitorId: VISITOR, variant: "challenger", occurredAtMs: EXPOSED }],
      identities: [{ clerkUserId: CLERK, visitorId: VISITOR }],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 60_000,
          trialEndMs: null,
          status: "trialing",
        },
      ],
      payments: [],
      signals: [],
      nowMs: NOW,
    });
    expect(report.rows.every((row) => row.trials === 0)).toBe(true);
    expect(report.unknownTrials).toBe(1);
  });
});

describe("reusable landing destinations", () => {
  it("accepts any two different approved pages and rejects everything else", () => {
    expect(
      landingAssignmentFromInput({
        entrySlug: "coach-test",
        controlPath: "/",
        challengerPath: "/become-proud",
      })
    ).toEqual({
      entrySlug: "coach-test",
      controlPath: "/",
      challengerPath: "/become-proud",
    });
    expect(
      landingAssignmentFromInput({ entrySlug: "", controlPath: "", challengerPath: "" })
    ).toBeNull();
    for (const input of [
      { entrySlug: "bad", controlPath: "https://evil.test", challengerPath: "/" },
      { entrySlug: "bad", controlPath: "/checkout/start", challengerPath: "/leadership" },
      { entrySlug: "bad", controlPath: "/", challengerPath: "/" },
      { entrySlug: "bad", controlPath: "/leadership", challengerPath: "/become-proud" },
      { entrySlug: "bad", controlPath: "/daily-coaching", challengerPath: "/" },
      { entrySlug: "bad", controlPath: "/", challengerPath: "/life-worth-remembering" },
      { entrySlug: "Bad Slug", controlPath: "/", challengerPath: "/leadership" },
      { entrySlug: "only-slug", controlPath: "", challengerPath: "" },
    ]) {
      expect(() => landingAssignmentFromInput(input)).toThrow(/approved pages/i);
    }
    expect(parseLandingAssignments(`${PROUD_TEST_EXPERIMENT_ID}.control.https://evil.test`)).toEqual(
      []
    );
  });

  it("assigns a running pair and keeps a returning visitor on that pair", () => {
    const destinations = landingAssignmentFromInput({
      entrySlug: "coach-test",
      controlPath: "/",
      challengerPath: "/become-proud",
    });
    const created = decideLandingEntry({
      experimentId: PROUD_TEST_EXPERIMENT_ID,
      status: "running",
      visitorId: VISITOR,
      existingVariant: null,
      destinations,
      userAgent: "Mozilla/5.0",
      prefetch: false,
    });
    expect(APPROVED_LANDING_DESTINATIONS).toContain(created.destination);
    expect(created.destination === "/" || created.destination === "/become-proud").toBe(true);
    const returning = decideLandingEntry({
      experimentId: PROUD_TEST_EXPERIMENT_ID,
      status: "paused",
      visitorId: VISITOR,
      existingVariant: "challenger",
      destinations,
      userAgent: "Mozilla/5.0",
      prefetch: false,
    });
    expect(returning.destination).toBe("/become-proud");
    expect(returning.created).toBe(false);
    expect(
      decideLandingEntry({
        experimentId: PROUD_TEST_EXPERIMENT_ID,
        status: "running",
        visitorId: VISITOR,
        existingVariant: null,
        destinations: null,
        userAgent: "Mozilla/5.0",
        prefetch: false,
      }).destination
    ).toBe("/");
  });

  it("counts an exposure only when the viewed page is the assigned destination", () => {
    expect(
      exposureMatchesDestination({ viewedPath: "/become-proud", officialPath: "/become-proud" })
    ).toBe(true);
    expect(
      exposureMatchesDestination({ viewedPath: "/", officialPath: "/become-proud" })
    ).toBe(false);
    expect(
      exposureMatchesDestination({ viewedPath: "/leadership", officialPath: "/leadership" })
    ).toBe(false);
    expect(
      exposureMatchesDestination({ viewedPath: "https://evil.test", officialPath: "/become-proud" })
    ).toBe(false);
  });

  it("starts the payment window at the earlier assignment when no page view was saved", () => {
    const assignedAt = EXPOSED - 4 * 24 * 60 * 60 * 1000;
    expect(
      cohortInvoiceAnchorMs({
        exposures: [{ occurredAtMs: EXPOSED }],
        assignments: [
          { occurredAtMs: assignedAt, synthetic: false },
          { occurredAtMs: assignedAt - 86_400_000, synthetic: true },
        ],
      })
    ).toBe(assignedAt);
    expect(cohortInvoiceAnchorMs({ exposures: [], assignments: [] })).toBeNull();
  });

  it("keeps confirmed payments on the exposure cohort across dashboard ranges", () => {
    const window = experimentInvoiceWindow({ earliestExposureMs: EXPOSED, nowMs: NOW });
    const today = growthPeriodUtcMs("today", "2026-10-12");
    const week = growthPeriodUtcMs("last_7", "2026-10-12");
    const allTime = growthPeriodUtcMs("all_time", "2026-10-12");
    expect(today?.startMs).not.toBe(week?.startMs);
    expect(week?.startMs).not.toBe(allTime?.startMs);
    expect(window.startMs).toBe(EXPOSED - 24 * 60 * 60 * 1000);
    expect(window.endMs).toBe(NOW);
    expect(window.startMs).not.toBe(today?.startMs);
    const payments = [{ clerkUserId: CLERK, paidAtMs: EXPOSED + 8 * 24 * 60 * 60 * 1000 }];
    const input = {
      loaded: true,
      exposuresReadable: true,
      trialsReadable: true,
      paymentsReadable: true,
      signalsReadable: true,
      status: "running" as const,
      nowMs: NOW,
      destinations: { control: "/" as const, challenger: "/become-proud" as const },
      exposures: [{ visitorId: VISITOR, variant: "control" as const, occurredAtMs: EXPOSED }],
      identities: [{ clerkUserId: CLERK, visitorId: VISITOR }],
      trials: [
        {
          clerkUserId: CLERK,
          trialStartMs: EXPOSED + 60_000,
          trialEndMs: EXPOSED + 8 * 24 * 60 * 60 * 1000,
          status: "active",
        },
      ],
      payments,
    };
    const first = summarizeProudTest(input);
    const second = summarizeProudTest(input);
    expect(first.rows.find((row) => row.variant === "control")?.paid).toBe(1);
    expect(first.rows.find((row) => row.variant === "control")?.path).toBe("/");
    expect(second.rows.find((row) => row.variant === "control")?.paid).toBe(1);
    expect(first.coverage).toContain("dashboard date range");
    expect(first.coverage).not.toContain("selected date range");
  });
});

describe("proud test stays off the homepage and Brooke's page", () => {
  it("does not change the homepage, landing copy, or subscriber growth", () => {
    const root = process.cwd();
    const home = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    const become = readFileSync(join(root, "src/app/become-proud/page.tsx"), "utf8");
    const brooke = readFileSync(join(root, "src/app/admin/subscriber-growth/page.tsx"), "utf8");
    const layout = readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8");
    const route = readFileSync(join(root, "src/app/go/[experimentSlug]/route.ts"), "utf8");
    const screen = readFileSync(join(root, "src/app/admin/operating-screen.tsx"), "utf8");
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    expect(home).not.toContain("proud-test");
    expect(home).not.toContain("assignProudTestVariant");
    expect(home).toContain("marketingAcquisitionHref");
    expect(home).toContain('"/checkout/start?plan=annual"');
    expect(become).not.toContain("proud-test");
    expect(brooke).not.toContain("Controlled landing test");
    expect(brooke).not.toContain("proud-test");
    expect(layout).not.toContain("/go/proud-test");
    expect(route).not.toContain(".insert(");
    expect(route).not.toContain("recordLandingExposures");
    expect(route).toContain("recordLandingAssignment");
    expect(route).toContain("slug === \"proud-test\"");
    expect(route).toContain("decideLandingEntry");
    expect(middleware).toContain("applyHomepageExperiment");
    expect(route).not.toContain("searchParams.get");
    expect(middleware).toContain('"/go/(.*)"');
    expect(isLandingExperimentEntryPath("/go/proud-test")).toBe(true);
    expect(isLandingExperimentEntryPath("/go/coach-test")).toBe(true);
    expect(isLandingExperimentEntryPath("/go/https://evil.test")).toBe(false);
    expect(() => readFileSync(join(root, "src/app/go/proud-test/route.ts"), "utf8")).toThrow();
    expect(screen).toContain("Controlled landing test");
    expect(screen).toContain("Automatic homepage traffic — /");
    const retentionAt = screen.indexOf("function RetentionBody");
    const retention = screen.slice(retentionAt);
    expect(screen.slice(0, retentionAt)).toContain("How this works");
    expect(screen.slice(0, retentionAt)).toContain("two landing pages");
    expect(screen).toContain("does not pick a winner");
    expect(retention).toContain("How this works");
    expect(retention).toContain("paid membership");
    expect(retention).not.toContain("Controlled landing test");
    expect(retention).not.toContain("five landing pages");
  });

  it("includes the controlled test in the shared report without an action while it is unloaded", () => {
    const data = growth();
    data.snapshot.notes.sourceTrackingUnavailable = false;
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
    });
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.report).toContain("CONTROLLED LANDING TEST");
    expect(snapshot.report).toContain("were not loaded");
    expect(snapshot.report).not.toMatch(/\bwon\b/i);
  });
});

describe("homepage split", () => {
  const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
  const stay = {
    action: "ignore" as const,
    created: false,
    variant: null,
    destination: "/" as const,
  };

  it("keeps every homepage visitor on /, including a stored challenger", () => {
    for (const status of ["running", "paused", "completed", "unavailable"] as const) {
      for (const existingVariant of [null, "control", "challenger"] as const) {
        expect(
          decideHomepageSplit({
            signedIn: false,
            nativeApp: false,
            status,
            visitorId: VISITOR,
            existingVariant,
            userAgent: browser,
            prefetch: false,
          })
        ).toEqual(stay);
      }
    }
    expect(
      decideHomepageSplit({
        signedIn: true,
        nativeApp: false,
        status: "running",
        visitorId: null,
        existingVariant: "challenger",
        userAgent: "curl/8.7.1",
        prefetch: true,
      })
    ).toEqual(stay);
  });

  it("still hashes other landing assignments without using them on the homepage", () => {
    let control = 0;
    for (let index = 0; index < 400; index += 1) {
      const visitorId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      if (assignProudTestVariant(visitorId) === "control") control += 1;
    }
    expect(control).toBeGreaterThan(150);
    expect(control).toBeLessThan(250);
    expect(
      decideHomepageSplit({
        signedIn: false,
        nativeApp: false,
        status: "running",
        visitorId: VISITOR,
        existingVariant: null,
        userAgent: browser,
        prefetch: false,
      }).destination
    ).toBe("/");
  });

  it("does not treat curl, HEAD, or resource fetches as a page that can be exposed", () => {
    const html = "text/html,application/xhtml+xml";
    expect(
      isExperimentDocumentRequest({ method: "GET", accept: html, fetchDest: "document" })
    ).toBe(true);
    expect(
      isExperimentDocumentRequest({ method: "GET", accept: html, fetchDest: null })
    ).toBe(true);
    expect(
      isExperimentDocumentRequest({ method: "HEAD", accept: html, fetchDest: "document" })
    ).toBe(false);
    expect(
      isExperimentDocumentRequest({ method: "GET", accept: "*/*", fetchDest: null })
    ).toBe(false);
    expect(
      isExperimentDocumentRequest({ method: "GET", accept: html, fetchDest: "empty" })
    ).toBe(false);
  });
});

describe("become proud redirect", () => {
  it("sends /become-proud to / and keeps query parameters without a loop", async () => {
    const redirects = await nextConfig.redirects();
    const become = redirects.find((rule) => rule.source === "/become-proud");
    expect(become).toMatchObject({ destination: "/", permanent: false });
    expect(become?.destination).not.toContain("?");
    expect(redirects.some((rule) => rule.source === "/")).toBe(false);

    function nextPath(pathname: string): string | null {
      const rule = redirects.find((item) => item.source === pathname);
      if (!rule || typeof rule.destination !== "string") return null;
      return new URL(rule.destination, "https://summittmindset.com").pathname;
    }

    function follow(start: string): string[] {
      const hops = [start];
      let current = start;
      for (let hop = 0; hop < 5; hop += 1) {
        const next = nextPath(current);
        if (!next) return hops;
        expect(hops).not.toContain(next);
        hops.push(next);
        current = next;
      }
      return hops;
    }

    expect(follow("/")).toEqual(["/"]);
    expect(follow("/become-proud")).toEqual(["/become-proud", "/"]);
    expect(follow("/leadership")).toEqual(["/leadership", "/become-proud", "/"]);
    expect(follow("/daily-coaching")).toEqual(["/daily-coaching", "/become-proud", "/"]);
    expect(follow("/life-worth-remembering")).toEqual([
      "/life-worth-remembering",
      "/become-proud",
      "/",
    ]);

    const search = "?utm_source=facebook&utm_medium=paid&fbclid=IwAR123&gclid=Cj0KC";
    const destination = new URL(String(become?.destination), "https://summittmindset.com");
    expect(destination.pathname + (destination.search || search)).toBe(`/${search}`);
  });
});
