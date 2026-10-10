import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
import {
  buildRetentionIntelligence,
  formatRetentionIntelligence,
  RETENTION_DAY_MS,
  spellFromSubscription,
  unreadableRetentionIntelligence,
  type RetentionIntelligenceInput,
  type RetentionSpell,
} from "@/lib/retention-intelligence";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function daysAgo(days: number): number {
  return NOW - days * RETENTION_DAY_MS;
}

function spell(patch: Partial<RetentionSpell> & Pick<RetentionSpell, "id" | "clerkUserId">): RetentionSpell {
  return {
    paidStartMs: daysAgo(100),
    endedAtMs: null,
    endKnown: true,
    open: true,
    interval: "month",
    cancellationReason: null,
    trialStartMs: null,
    ...patch,
  };
}

function input(patch: Partial<RetentionIntelligenceInput> = {}): RetentionIntelligenceInput {
  return {
    nowMs: NOW,
    partial: false,
    partialReason: null,
    withheld: null,
    spells: [],
    activeWithoutPayment: 0,
    appleRows: 0,
    customerFeedbackCount: 0,
    engagementReadable: true,
    hits: [],
    measuredSignals: [],
    acquisitionReadable: true,
    landingReadable: true,
    experimentReadable: true,
    acquisition: [],
    ...patch,
  };
}

describe("paid retention cohorts", () => {
  it("leaves a 20-day member out of D30 instead of counting a failure", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [spell({ id: "s1", clerkUserId: "user_new", paidStartMs: daysAgo(20) })],
      })
    );
    const d30 = report.milestones[0];
    expect(d30?.immature).toBe(1);
    expect(d30?.ended).toBe(0);
    expect(d30?.retained).toBe(0);
    expect(d30?.rate).toBe("Not available");
  });

  it("counts only mature members at each milestone", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "s1", clerkUserId: "user_old", paidStartMs: daysAgo(200) }),
          spell({ id: "s2", clerkUserId: "user_mid", paidStartMs: daysAgo(40), endedAtMs: daysAgo(15), open: false }),
        ],
      })
    );
    expect(report.milestones.map((row) => row.label)).toEqual(["D30", "D60", "D90", "D180", "D365"]);
    const d30 = report.milestones[0];
    expect(d30?.retained).toBe(1);
    expect(d30?.ended).toBe(1);
    expect(d30?.rate).toBe("50% (1 of 2)");
    const d60 = report.milestones[1];
    expect(d60?.retained).toBe(1);
    expect(d60?.immature).toBe(1);
    expect(d60?.rate).toBe("100% (1 of 1)");
    expect(report.milestones[4]?.immature).toBe(2);
    expect(report.milestones[4]?.rate).toBe("Not available");
  });

  it("marks an ended subscription with no end time as unknown", () => {
    const built = spellFromSubscription({
      id: "s1",
      clerkUserId: "user_a",
      paidAtMs: [daysAgo(100)],
      status: "canceled",
      endedAtMs: null,
      paused: false,
      interval: "month",
      cancellationReason: "cancellation_requested",
      trialStartMs: daysAgo(107),
    });
    expect(built?.endKnown).toBe(false);
    const report = buildRetentionIntelligence(input({ spells: built ? [built] : [] }));
    expect(report.milestones[0]?.unknown).toBe(1);
    expect(report.milestones[0]?.retained).toBe(0);
    expect(report.milestones[0]?.ended).toBe(0);
    expect(report.memberRequested).toBe(0);
  });

  it("starts paid time at the paid invoice, not the trial", () => {
    const built = spellFromSubscription({
      id: "s1",
      clerkUserId: "user_a",
      paidAtMs: [daysAgo(10)],
      status: "active",
      endedAtMs: null,
      paused: false,
      interval: "month",
      cancellationReason: null,
      trialStartMs: daysAgo(17),
    });
    expect(built?.paidStartMs).toBe(daysAgo(10));
    expect(built?.trialStartMs).toBe(daysAgo(17));
    const report = buildRetentionIntelligence(input({ spells: built ? [built] : [] }));
    expect(report.milestones[0]?.immature).toBe(1);
    expect(report.activeByBand[0]?.count).toBe(1);
  });

  it("does not put an active subscription with no paid invoice into the cohort", () => {
    expect(
      spellFromSubscription({
        id: "s1",
        clerkUserId: "user_a",
        paidAtMs: [],
        status: "active",
        endedAtMs: null,
        paused: false,
        interval: "month",
        cancellationReason: null,
        trialStartMs: daysAgo(3),
      })
    ).toBeNull();
  });

  it("keeps an annual membership retained without another monthly payment", () => {
    const built = spellFromSubscription({
      id: "s1",
      clerkUserId: "user_annual",
      paidAtMs: [daysAgo(200)],
      status: "active",
      endedAtMs: null,
      paused: false,
      interval: "year",
      cancellationReason: null,
      trialStartMs: null,
    });
    const report = buildRetentionIntelligence(input({ spells: built ? [built] : [] }));
    expect(report.milestones[3]?.retained).toBe(1);
    expect(report.longestMembers[0]?.plan).toBe("Annual");
  });

  it("treats paused and past_due memberships as still entitled", () => {
    const paused = spellFromSubscription({
      id: "s1",
      clerkUserId: "user_paused",
      paidAtMs: [daysAgo(80)],
      status: "active",
      endedAtMs: null,
      paused: true,
      interval: "month",
      cancellationReason: null,
      trialStartMs: null,
    });
    const pastDue = spellFromSubscription({
      id: "s2",
      clerkUserId: "user_due",
      paidAtMs: [daysAgo(80)],
      status: "past_due",
      endedAtMs: null,
      paused: false,
      interval: "month",
      cancellationReason: "payment_failed",
      trialStartMs: null,
    });
    const report = buildRetentionIntelligence(
      input({ spells: [paused, pastDue].filter((row) => row != null) })
    );
    expect(report.milestones[0]?.retained).toBe(2);
    expect(report.paymentFailure).toBe(0);
    expect(report.activeCount).toBe(2);
  });

  it("keeps active tenure out of the completed average and median", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({
            id: "done-short",
            clerkUserId: "user_short",
            paidStartMs: daysAgo(110),
            endedAtMs: daysAgo(100),
            open: false,
          }),
          spell({
            id: "done-long",
            clerkUserId: "user_long",
            paidStartMs: daysAgo(160),
            endedAtMs: daysAgo(130),
            open: false,
          }),
          spell({ id: "still", clerkUserId: "user_now", paidStartMs: daysAgo(10) }),
        ],
      })
    );
    expect(report.completedCount).toBe(2);
    expect(report.averageCompletedDays).toBe("20 days");
    expect(report.medianCompletedDays).toBe("20 days");
    expect(report.longestCompletedDays).toBe("30 days");
    expect(report.longestActiveDays).toBe("10 days");
    expect(report.activeCount).toBe(1);
  });

  it("does not treat a later rejoin as continuous retention", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({
            id: "first",
            clerkUserId: "user_back",
            paidStartMs: daysAgo(100),
            endedAtMs: daysAgo(80),
            open: false,
            cancellationReason: "cancellation_requested",
          }),
          spell({ id: "second", clerkUserId: "user_back", paidStartMs: daysAgo(40) }),
        ],
      })
    );
    expect(report.milestones[0]?.rejoined).toBe(1);
    expect(report.milestones[0]?.retained).toBe(0);
    expect(report.milestones[0]?.coverage).toContain("not continuously retained");
    expect(report.activeCount).toBe(1);
    expect(report.memberRequested).toBe(1);
  });

  it("separates member-requested, payment, other, and unknown endings", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({
            id: "asked",
            clerkUserId: "user_asked",
            endedAtMs: daysAgo(10),
            open: false,
            cancellationReason: "cancellation_requested",
          }),
          spell({
            id: "bill",
            clerkUserId: "user_bill",
            endedAtMs: daysAgo(10),
            open: false,
            cancellationReason: "payment_failed",
          }),
          spell({
            id: "dispute",
            clerkUserId: "user_dispute",
            endedAtMs: daysAgo(10),
            open: false,
            cancellationReason: "payment_disputed",
          }),
          spell({
            id: "plain",
            clerkUserId: "user_plain",
            endedAtMs: daysAgo(10),
            open: false,
            cancellationReason: null,
          }),
        ],
        customerFeedbackCount: 0,
      })
    );
    expect(report.memberRequested).toBe(1);
    expect(report.paymentFailure).toBe(1);
    expect(report.otherKnown).toBe(1);
    expect(report.unknownReason).toBe(1);
    expect(report.churnNote).toContain("not counted as a member request");
    expect(report.churnNote).toContain("does not ask");
  });

  it("groups first-week use without calling it a cause", () => {
    const report = buildRetentionIntelligence(
      input({
        measuredSignals: [{ id: "ask_pat", label: "Ask Pat" }],
        spells: [
          spell({ id: "s1", clerkUserId: "user_used", paidStartMs: daysAgo(40) }),
          spell({
            id: "s2",
            clerkUserId: "user_quiet",
            paidStartMs: daysAgo(40),
            endedAtMs: daysAgo(20),
            open: false,
          }),
        ],
        hits: [
          { clerkUserId: "user_used", atMs: daysAgo(38), signal: "ask_pat" },
          { clerkUserId: "user_quiet", atMs: daysAgo(50), signal: "ask_pat" },
        ],
      })
    );
    const row = report.engagement[0];
    expect(row?.window).toBe("First 7 paid days");
    expect(row?.usedRetained).toBe(1);
    expect(row?.usedMature).toBe(1);
    expect(row?.unusedMature).toBe(1);
    expect(row?.small).toBe(true);
    expect(report.engagementNote).toContain("do not show that a feature caused");
    const text = formatRetentionIntelligence(report).join("\n");
    expect(text).toContain("observation");
    expect(text).not.toMatch(/Ask Pat caused|reply caused|feature made/);
  });

  it("keeps trial behavior in its own comparison", () => {
    const report = buildRetentionIntelligence(
      input({
        measuredSignals: [{ id: "reply", label: "Replied to coaching" }],
        spells: [
          spell({
            id: "s1",
            clerkUserId: "user_a",
            paidStartMs: daysAgo(40),
            trialStartMs: daysAgo(47),
          }),
        ],
        hits: [{ clerkUserId: "user_a", atMs: daysAgo(45), signal: "reply" }],
      })
    );
    expect(report.engagement[0]?.usedMature).toBe(0);
    expect(report.engagement[0]?.unusedMature).toBe(1);
    expect(report.trialEngagement[0]?.window).toBe("Free trial");
    expect(report.trialEngagement[0]?.usedMature).toBe(1);
  });

  it("joins acquisition source and keeps unknown visible", () => {
    const spells = Array.from({ length: 6 }, (_, index) =>
      spell({
        id: `lead-${index}`,
        clerkUserId: `user_lead_${index}`,
        paidStartMs: daysAgo(40),
        endedAtMs: index === 0 ? daysAgo(5) : null,
        open: index !== 0,
      })
    );
    spells.push(
      spell({
        id: "unknown",
        clerkUserId: "user_unknown",
        paidStartMs: daysAgo(40),
        endedAtMs: daysAgo(5),
        open: false,
      })
    );
    const report = buildRetentionIntelligence(
      input({
        spells,
        acquisition: [
          ...spells.slice(0, 6).map((row) => ({
            clerkUserId: row.clerkUserId ?? "",
            source: "leadership",
            campaign: "leadership-post",
            content: null,
            landing: "/leadership",
            experiment: null,
          })),
          {
            clerkUserId: "user_unknown",
            source: null,
            campaign: null,
            content: null,
            landing: null,
            experiment: null,
          },
        ],
      })
    );
    expect(report.sources.map((row) => row.label)).toContain("leadership");
    expect(report.sources.map((row) => row.label)).toContain("Unknown");
    expect(report.landings.some((row) => row.label === "/leadership")).toBe(true);
    expect(report.experiments.some((row) => row.label === "Not in a controlled experiment")).toBe(true);
    expect(report.limitations.join(" ")).toContain("not controlled experiments");
  });

  it("states Apple coverage instead of inventing Apple retention", () => {
    const report = buildRetentionIntelligence(input({ appleRows: 4, spells: [] }));
    expect(report.appleNote).toContain("Apple");
    expect(report.appleNote).toContain("not in this paid cohort");
    expect(report.milestones[0]?.retained).toBe(0);
  });

  it("does not put member identifiers in the copied report", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [spell({ id: "s1", clerkUserId: "user_private_lookup", paidStartMs: daysAgo(400) })],
        acquisition: [
          {
            clerkUserId: "user_private_lookup",
            source: "direct",
            campaign: null,
            content: null,
            landing: null,
            experiment: null,
          },
        ],
      })
    );
    expect(report.longestMembers[0]?.clerkUserId).toBe("user_private_lookup");
    const text = formatRetentionIntelligence(report).join("\n");
    expect(text).not.toContain("user_private_lookup");
    expect(text).not.toContain("@");
    expect(text).toContain("D365");
  });

  it("withholds rates when historic invoices are not reliable", () => {
    const report = buildRetentionIntelligence(
      input({
        withheld: "Paid invoices stopped early, so first payment dates are not reliable.",
        spells: [spell({ id: "s1", clerkUserId: "user_a" })],
      })
    );
    expect(report.partial).toBe(true);
    expect(report.milestones).toEqual([]);
    expect(report.withheld).toContain("not reliable");
    expect(formatRetentionIntelligence(report).join("\n")).not.toContain("user_a");
  });
});

describe("shared admin report", () => {
  it("uses one report on both pages and does not invent a retention action", () => {
    const growth = growthFixture();
    const intel = buildRetentionIntelligence(
      input({
        spells: [spell({ id: "s1", clerkUserId: "user_private_lookup", paidStartMs: daysAgo(40) })],
      })
    );
    const snapshot = buildOperatingSnapshot({
      growth,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: intel,
    });
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    expect(report).toContain("RETENTION INTELLIGENCE");
    expect(report).not.toContain("user_private_lookup");
    expect(snapshot.actions.map((action) => action.id)).not.toContain("retention-unreadable");
    expect(snapshot.retentionIntelligence.bridge).toContain("day 30");
  });

  it("adds an action only when the retention read fails", () => {
    const snapshot = buildOperatingSnapshot({
      growth: growthFixture(),
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: unreadableRetentionIntelligence(
        "Stripe subscriptions could not be read."
      ),
    });
    expect(snapshot.actions.map((action) => action.id)).toContain("retention-unreadable");
    expect(snapshot.report).not.toContain("user_private");
  });
});

describe("retention page boundaries", () => {
  it("keeps Brooke's page and the admin nav unchanged by this module", () => {
    const root = process.cwd();
    const brooke = readFileSync(join(root, "src/app/admin/subscriber-growth/page.tsx"), "utf8");
    const layout = readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8");
    const server = readFileSync(join(root, "src/lib/retention-intelligence.server.ts"), "utf8");
    expect(brooke).not.toContain("retention-intelligence");
    expect(brooke).not.toContain("retentionInputs");
    expect(layout).not.toContain("retention-intelligence");
    expect(server).not.toContain("raw_body");
    expect(server).not.toContain("answer_text");
  });
});

function growthFixture(): SubscriberGrowthDashboardData {
  return {
    range: "last_7",
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
