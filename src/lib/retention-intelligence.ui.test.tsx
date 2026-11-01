/** @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperatingScreen } from "@/app/admin/operating-screen";
import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";
import {
  buildRetentionIntelligence,
  RETENTION_DAY_MS,
  RETENTION_NOT_LOADED,
  type RetentionIntelligenceInput,
  type RetentionSpell,
} from "@/lib/retention-intelligence";

vi.mock("@/lib/supabase-server", () => ({ supabaseServer: {} }));
vi.mock("@/lib/operating-experiments.server", () => ({}));
vi.mock("@/app/admin/experiment-actions", () => ({}));
vi.mock("@/app/admin/experiment-registry", () => ({
  ExperimentRegistryPanel: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function spell(): RetentionSpell {
  return {
    id: "s1",
    clerkUserId: "user_private_lookup",
    paidStartMs: NOW - 40 * RETENTION_DAY_MS,
    endedAtMs: null,
    endKnown: true,
    open: true,
    interval: "month",
    cancellationReason: null,
    trialStartMs: NOW - 47 * RETENTION_DAY_MS,
  };
}

function input(): RetentionIntelligenceInput {
  return {
    nowMs: NOW,
    partial: false,
    partialReason: null,
    withheld: null,
    spells: [spell()],
    activeWithoutPayment: 0,
    appleRows: 2,
    customerFeedbackCount: 0,
    engagementReadable: true,
    hits: [],
    measuredSignals: [{ id: "ask_pat", label: "Ask Pat" }],
    acquisitionReadable: true,
    landingReadable: true,
    experimentReadable: true,
    acquisition: [
      {
        clerkUserId: "user_private_lookup",
        source: null,
        campaign: null,
        content: null,
        landing: null,
        experiment: null,
      },
    ],
  };
}

function growth(): SubscriberGrowthDashboardData {
  return {
    range: "last_30",
    source: "all",
    timezone: "America/New_York",
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

describe("retention intelligence on the admin pages", () => {
  it("keeps How this works collapsed and shares one report", () => {
    const intel = buildRetentionIntelligence(input());
    const snapshot = buildOperatingSnapshot({
      growth: growth(),
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: intel,
    });
    const retention = render(
      <OperatingScreen focus="retention" snapshot={snapshot} canGenerateReport />
    );
    const details = retention.container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("How this works");
    expect(retention.container.textContent).toContain("Copy Complete Facts Report");
    expect(retention.container.textContent).toContain("Generate Report");
    expect(retention.container.textContent).toContain("Retention cohorts have not been calculated.");
    expect(retention.container.textContent).toContain("Monthly D30");
    expect(retention.container.textContent).toContain("Annual subscribers");
    expect(retention.container.textContent).toContain("Unclassified members");
    expect(retention.container.textContent).not.toContain("Subscriber stops — all time");
    expect(retention.container.textContent).not.toContain("Evening coaching text");
    expect(retention.container.textContent).not.toContain("Coaching text delivered");
    expect(retention.container.textContent).not.toContain("Replied to coaching");
    expect(retention.container.textContent).not.toContain("did not use");
    expect(retention.container.textContent).toContain("user_private_lookup");
    expect(details?.textContent).toContain(
      "Cohort calculations are updated when Tyler clicks Generate Report."
    );
    expect(details?.textContent).toContain(
      "shows the last successfully generated results until another report completes."
    );
    expect(details?.textContent).not.toContain("when it loads");
    expect(details?.textContent).toContain("An annual membership stays active until it ends.");
    expect(details?.textContent).not.toContain("five landing pages");
    expect(snapshot.report).toContain("RETENTION INTELLIGENCE");
    expect(snapshot.report).not.toContain("user_private_lookup");
    expect(snapshot.report).not.toContain("person@example.com");
    retention.unmount();

    const distribution = render(<OperatingScreen focus="distribution" snapshot={snapshot} />);
    expect(screen.getByText("Connection to retention")).toBeTruthy();
    expect(distribution.container.textContent).toContain("Open Retention");
    expect(distribution.container.textContent).not.toContain("Generate Report");
    expect(distribution.container.textContent).toContain(
      "Retention cohorts have not been calculated. They are not shown as zero."
    );
    expect(distribution.container.textContent).toContain("Subscriber stops — all time");
    expect(distribution.container.textContent).toContain("Not a confirmed Instantly block.");
    expect(distribution.container.textContent).toContain("Native Instantly blocking");
    expect(distribution.container.textContent).not.toContain("user_private_lookup");
    expect(distribution.container.querySelector("summary")?.textContent).toBe("How this works");
  });

  it("shows live counts and hides cohort numbers before a report exists", () => {
    const data = growth();
    data.snapshot = {
      ...data.snapshot,
      asOfNow: { ...data.snapshot.asOfNow, activePaid: 2500 },
    };
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: RETENTION_NOT_LOADED,
    });
    const view = render(<OperatingScreen focus="retention" snapshot={snapshot} canGenerateReport />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Current paying members");
    expect(text).toContain("2500");
    expect(text).toContain("Last 7 days");
    expect(text).toContain("Retention cohorts have not been calculated.");
    expect(text).toContain("Paid membership cohorts were not calculated in this snapshot.");
    expect(text).not.toContain("Annual members:");
    expect(text).not.toContain("Unclassified members:");
    expect(text).not.toContain("Completed paid periods:");
    expect(text).not.toContain("Member-requested 0");
    expect(text).not.toContain("Monthly D30");
    expect(text).not.toContain("Monthly retention");
    view.unmount();
  });
});
