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
  acceptedSendSignalIds,
  retentionIntervalFromPrice,
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

  it("counts an open annual membership outside monthly retention", () => {
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
    expect(report.milestones[3]?.retained).toBe(0);
    expect(report.longestMembers).toEqual([]);
    expect(report.annual).toEqual({ members: 1, continuing: 1, ended: 0, unknown: 0 });
    expect(formatRetentionIntelligence(report).join("\n")).toContain("Not a renewal rate");
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
    expect(text).toContain("Monthly D30");
    expect(text).not.toContain("did not use");
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
    const text = formatRetentionIntelligence(report).join("\n");
    expect(text).not.toContain("user_a");
    expect(text).not.toContain("Annual members:");
    expect(text).not.toContain("%");
  });
});

describe("monthly and annual separation", () => {
  it("keeps annual members out of monthly D30, D60, and D90", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "month", clerkUserId: "user_month", paidStartMs: daysAgo(100) }),
          spell({ id: "year", clerkUserId: "user_year", interval: "year", paidStartMs: daysAgo(100) }),
        ],
      })
    );
    expect(report.milestones[0]?.retained).toBe(1);
    expect(report.milestones[0]?.rate).toBe("100% (1 of 1)");
    expect(report.milestones[1]?.retained).toBe(1);
    expect(report.milestones[2]?.retained).toBe(1);
    expect(report.annual).toEqual({ members: 1, continuing: 1, ended: 0, unknown: 0 });
    expect(report.unclassifiedMembers).toBe(0);
  });

  it("treats legacy and current prices with the same interval as the same group", () => {
    expect(retentionIntervalFromPrice({ recurring: { interval: "month" }, unit_amount: 1900 })).toBe(
      "month"
    );
    expect(retentionIntervalFromPrice({ recurring: { interval: "month" }, unit_amount: 2900 })).toBe(
      "month"
    );
    expect(retentionIntervalFromPrice({ recurring: { interval: "year" }, unit_amount: 12000 })).toBe(
      "year"
    );
    expect(retentionIntervalFromPrice({ recurring: { interval: "year" }, unit_amount: 24900 })).toBe(
      "year"
    );
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "legacy-month", clerkUserId: "user_legacy_month", paidStartMs: daysAgo(40) }),
          spell({ id: "current-month", clerkUserId: "user_current_month", paidStartMs: daysAgo(40) }),
          spell({
            id: "legacy-year",
            clerkUserId: "user_legacy_year",
            interval: "year",
            paidStartMs: daysAgo(40),
          }),
          spell({
            id: "current-year",
            clerkUserId: "user_current_year",
            interval: "year",
            paidStartMs: daysAgo(40),
          }),
        ],
      })
    );
    expect(report.milestones[0]?.retained).toBe(2);
    expect(report.annual.members).toBe(2);
  });

  it("classifies mixed and unknown intervals once, outside both rates", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "mix-m", clerkUserId: "user_mix", paidStartMs: daysAgo(80) }),
          spell({
            id: "mix-y",
            clerkUserId: "user_mix",
            interval: "year",
            paidStartMs: daysAgo(20),
          }),
          spell({
            id: "unknown-interval",
            clerkUserId: "user_unknown_interval",
            interval: "other",
            paidStartMs: daysAgo(80),
          }),
          spell({ id: "month", clerkUserId: "user_month", paidStartMs: daysAgo(80) }),
        ],
      })
    );
    expect(report.unclassifiedMembers).toBe(2);
    expect(report.milestones[0]?.retained).toBe(1);
    expect(report.annual.members).toBe(0);
    expect(report.milestones[0]?.ended).toBe(0);
  });

  it("counts two monthly subscriptions for one Clerk id as one member", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "first", clerkUserId: "user_a", paidStartMs: daysAgo(50) }),
          spell({ id: "second", clerkUserId: "user_a", paidStartMs: daysAgo(10) }),
        ],
      })
    );
    const d30 = report.milestones[0];
    expect((d30?.retained ?? 0) + (d30?.ended ?? 0) + (d30?.rejoined ?? 0) + (d30?.unknown ?? 0) + (d30?.immature ?? 0)).toBe(1);
    expect(d30?.retained).toBe(1);
  });

  it("includes a 45-day monthly member in D30 and leaves them out of D60 and D90", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [spell({ id: "young", clerkUserId: "user_young", paidStartMs: daysAgo(45) })],
      })
    );
    expect(report.milestones[0]?.immature).toBe(0);
    expect(report.milestones[0]?.retained).toBe(1);
    expect(report.milestones[1]?.immature).toBe(1);
    expect(report.milestones[1]?.rate).toBe("Not available");
    expect(report.milestones[2]?.immature).toBe(1);
  });

  it("counts continuing, ended, and unknown annual members without calling them churned monthly", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [
          spell({ id: "open", clerkUserId: "user_open", interval: "year", paidStartMs: daysAgo(400) }),
          spell({
            id: "ended",
            clerkUserId: "user_ended",
            interval: "year",
            paidStartMs: daysAgo(200),
            endedAtMs: daysAgo(10),
            open: false,
          }),
          spell({
            id: "unknown",
            clerkUserId: "user_unknown_end",
            interval: "year",
            paidStartMs: daysAgo(100),
            endKnown: false,
            open: false,
            endedAtMs: null,
          }),
        ],
      })
    );
    expect(report.annual).toEqual({ members: 3, continuing: 1, ended: 1, unknown: 1 });
    expect(report.milestones.every((row) => row.retained + row.ended + row.rejoined === 0)).toBe(true);
  });

  it("does not treat a missing Clerk id as monthly churn or as unclassified", () => {
    const report = buildRetentionIntelligence(
      input({
        spells: [spell({ id: "bare", clerkUserId: null, interval: "year", paidStartMs: daysAgo(80) })],
      })
    );
    expect(report.unclassifiedMembers).toBe(0);
    expect(report.annual.members).toBe(0);
    expect(report.milestones[0]?.ended).toBe(0);
    expect(report.limitations.join(" ")).toContain("no Clerk user id");
  });

  it("suppresses the evening comparison and describes survival rather than usage", () => {
    const report = buildRetentionIntelligence(
      input({
        measuredSignals: [
          { id: "evening", label: "Evening coaching text" },
          { id: "morning", label: "Morning coaching text accepted by the provider" },
          { id: "reply", label: "Any inbound SMS" },
        ],
        spells: [spell({ id: "month", clerkUserId: "user_month", paidStartMs: daysAgo(40) })],
      })
    );
    const labels = [...report.engagement, ...report.trialEngagement].map((row) => row.label);
    expect(labels).not.toContain("Evening coaching text");
    expect(labels).toContain("Morning coaching text accepted by the provider");
    expect(labels).toContain("Any inbound SMS");
    expect(acceptedSendSignalIds("evening")).toEqual(["coaching"]);
    expect(acceptedSendSignalIds("evening_checkin")).toEqual(["coaching"]);
    expect(acceptedSendSignalIds("morning")).toEqual(["coaching", "morning"]);
    const text = formatRetentionIntelligence(report).join("\n");
    expect(text).toContain("day-30 survival if recorded");
    expect(text).not.toContain("Coaching text delivered");
    expect(text).not.toContain("Replied to coaching");
  });

  it("leaves an unread signal out of the rates and does not invent Victory Room history", () => {
    const report = buildRetentionIntelligence(
      input({
        engagementGaps: ["Coaching texts could not be fully read. They are not shown as zero."],
        measuredSignals: [{ id: "ask_pat", label: "Ask Pat" }],
        spells: [spell({ id: "s1", clerkUserId: "user_a", paidStartMs: daysAgo(40) })],
      })
    );
    expect(report.engagement.map((row) => row.label)).toEqual(["Ask Pat"]);
    expect(report.engagementGaps).toEqual([
      "Coaching texts could not be fully read. They are not shown as zero.",
    ]);
    expect(report.engagementNote).toContain("left out of these percentages");
    expect(report.engagementNote).toContain("October 28, 2026");
    expect(report.engagementNote).toContain("not zero use");
    expect(report.milestones.map((row) => row.label)).toEqual(["D30", "D60", "D90", "D180", "D365"]);
    expect(report.milestones[0]?.retained).toBe(1);
    const text = formatRetentionIntelligence(report).join("\n");
    expect(text).toContain("Coaching texts could not be fully read");
    expect(text).toContain("October 28, 2026");
    expect(text).not.toContain("victory_room_visited");
    expect(text).not.toContain("film_room_played");
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
    expect(server).toContain("raw_body");
    expect(server).not.toContain("answer_text");
    expect(server).not.toContain("v2_event");
    expect(server).not.toContain("Evening coaching text");
    expect(server).not.toContain("Replied to coaching");
    expect(server).not.toContain("Coaching text delivered");
    expect(server).toContain("smsBehaviorFromRows");
    const behavior = readFileSync(join(root, "src/lib/retention-sms-behavior.ts"), "utf8");
    expect(behavior).toContain("Any inbound SMS");
    expect(behavior).toContain("acceptedSendSignalIds");
    expect(behavior).toContain("attributeMorningEveningReplies");
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
