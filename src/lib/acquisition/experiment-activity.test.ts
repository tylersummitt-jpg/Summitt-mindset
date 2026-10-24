import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAcquisitionDashboard, formatAcquisitionReport } from "@/lib/acquisition/dashboard";
import { continueAfterRangePage } from "@/lib/acquisition/backfill";
import {
  experimentHistoryMetrics,
  experimentTrialMetrics,
  foldEligibility,
  foldExperimentActivity,
  formatExperimentSections,
  presentExperimentActivity,
  type ActivityActionRow,
  type ActivityEventRow,
} from "@/lib/acquisition/experiment-activity";
import { buildOperatingSnapshot, DAILY_NEW_TRIAL_GOAL } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
  growthPeriodUtcMs,
} from "@/lib/admin-subscriber-growth-pure";

const START = Date.parse("2026-10-24T04:00:00.000Z");
const END = Date.parse("2026-10-25T04:00:00.000Z");

function event(patch: Partial<ActivityEventRow> & Pick<ActivityEventRow, "eventType">): ActivityEventRow {
  return {
    personId: "person-1",
    provider: "instantly",
    providerEventId: `${patch.eventType}-1`,
    occurredAt: "2026-10-24T12:00:00.000Z",
    ...patch,
  };
}

function action(patch: Partial<ActivityActionRow> = {}): ActivityActionRow {
  return {
    personId: "person-1",
    actionType: "send_asset",
    status: "accepted",
    updatedAt: "2026-10-24T12:00:00.000Z",
    deliveredAt: null,
    ...patch,
  };
}

function fold(events: ActivityEventRow[], actions: ActivityActionRow[] = [], startMs: number | null = START, endMs = END) {
  return foldExperimentActivity({ events, actions, startMs, endMs });
}

describe("distribution experiment activity", () => {
  it("uses America/New_York day bounds, including the start and excluding the next midnight", () => {
    const period = growthPeriodUtcMs("today", "2026-10-24");
    expect(period).toEqual({ startMs: START, endMs: END });
    const counts = fold([
      event({ eventType: "email_sent", providerEventId: "before", occurredAt: "2026-10-24T03:59:59.000Z" }),
      event({ eventType: "email_sent", providerEventId: "start", occurredAt: "2026-10-24T04:00:00.000Z" }),
      event({ eventType: "email_sent", providerEventId: "end", occurredAt: "2026-10-25T03:59:59.000Z" }),
      event({ eventType: "email_sent", providerEventId: "next", occurredAt: "2026-10-25T04:00:00.000Z" }),
    ], [], period!.startMs, period!.endMs);
    expect(counts.coldEmailsSent).toEqual({ events: 2, people: 1 });
  });

  it("keeps a last-7 window on local midnights", () => {
    const period = growthPeriodUtcMs("last_7", "2026-10-24");
    expect(period?.startMs).toBe(Date.parse("2026-10-18T04:00:00.000Z"));
    expect(period?.endMs).toBe(END);
    const counts = fold([
      event({ eventType: "reply_received", providerEventId: "early", occurredAt: "2026-10-18T03:59:59.000Z" }),
      event({ eventType: "reply_received", providerEventId: "in", occurredAt: "2026-10-18T04:00:00.000Z" }),
    ], [], period!.startMs, period!.endMs);
    expect(counts.repliesReceived).toEqual({ events: 1, people: 1 });
  });

  it("counts historical events separately from the current lifecycle headcount", () => {
    const dashboard = buildAcquisitionDashboard({
      automation: "off",
      people: [{ id: "person-1", firstName: "A", lastName: null, lifecycle: "cold_active", requestedAsset: null }],
      actions: [],
      videoEvents: [],
      senders: [],
    });
    expect(dashboard.counts?.cold_active).toBe(1);
    expect(dashboard.counts?.cold_prospects).toBe(1);
    expect(dashboard.note).toContain("date range does not filter");
    expect(formatAcquisitionReport(dashboard)[0]).toBe("CURRENT PROSPECT STATUS — ALL TIME");
    const counts = fold([
      event({ eventType: "email_sent" }),
      event({ eventType: "reply_received", providerEventId: "reply-1" }),
    ]);
    expect(counts.coldEmailsSent.events).toBe(1);
    expect(counts.repliesReceived.events).toBe(1);
    expect(dashboard.counts?.reply_needs_review).toBe(0);
  });

  it("counts one provider event once and keeps events separate from people", () => {
    const counts = fold([
      event({ eventType: "email_sent", providerEventId: "same", personId: "person-1" }),
      event({ eventType: "email_sent", providerEventId: "same", personId: "person-1" }),
      event({ eventType: "email_sent", providerEventId: "other", personId: "person-1" }),
      event({ eventType: "email_sent", providerEventId: "third", personId: "person-2" }),
      event({ eventType: "email_sent", provider: "resend", providerEventId: "same", personId: "person-3" }),
    ]);
    expect(counts.coldEmailsSent).toEqual({ events: 3, people: 2 });
  });

  it("does not count lead interest, opens, or scheduled actions as replies or accepted resources", () => {
    const counts = fold(
      [
        event({ eventType: "lead_interested", providerEventId: "interest" }),
        event({ eventType: "email_opened", providerEventId: "open" }),
        event({ eventType: "auto_reply_received", providerEventId: "auto" }),
        event({ eventType: "lead_not_interested", providerEventId: "no" }),
        event({ eventType: "reply_received", providerEventId: "real" }),
      ],
      [
        action({ status: "scheduled", updatedAt: "2026-10-24T12:00:00.000Z" }),
        action({ status: "claimed", updatedAt: "2026-10-24T12:00:00.000Z" }),
        action({ status: "accepted", updatedAt: "2026-10-24T12:00:00.000Z", personId: "person-9" }),
        action({
          status: "delivered",
          updatedAt: "2026-10-24T13:00:00.000Z",
          deliveredAt: "2026-10-24T18:00:00.000Z",
          personId: "person-8",
        }),
        action({
          status: "delivered",
          updatedAt: "2026-10-24T15:00:00.000Z",
          deliveredAt: "2026-10-25T05:00:00.000Z",
          personId: "person-6",
        }),
        action({
          status: "delivered",
          updatedAt: "2026-10-23T15:00:00.000Z",
          deliveredAt: "2026-10-24T16:00:00.000Z",
          personId: "person-5",
        }),
        action({ actionType: "send_video", status: "accepted", personId: "person-7" }),
      ],
    );
    expect(counts.repliesReceived).toEqual({ events: 1, people: 1 });
    expect(counts.resourcesAccepted).toEqual({ events: 3, people: 3 });
    expect(counts.resourcesDelivered).toEqual({ events: 2, people: 2 });
    expect(counts.prospectsInEvents).toBe(1);
  });

  it("shows a true zero only after a complete read, and hides a failed or capped read", () => {
    const ready = { eventsFailed: false, actionsFailed: false, eventsComplete: true, actionsComplete: true };
    const zero = presentExperimentActivity({ counts: fold([]), ...ready });
    expect(experimentHistoryMetrics(zero)[0]?.value).toBe("0 events, 0 people");
    const failed = presentExperimentActivity({
      counts: fold([event({ eventType: "email_sent" })]),
      eventsFailed: true,
      actionsFailed: true,
      eventsComplete: false,
      actionsComplete: false,
    });
    expect(failed.counts).toBeNull();
    expect(experimentHistoryMetrics(failed)[0]?.value).toBe("Not available events, Not available people");
    const capped = presentExperimentActivity({
      counts: fold([event({ eventType: "email_sent" })]),
      eventsFailed: false,
      actionsFailed: false,
      eventsComplete: false,
      actionsComplete: false,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.counts).toBeNull();
    expect(experimentHistoryMetrics(capped)[0]?.value).not.toContain("1 events");
    const actionsFailed = presentExperimentActivity({
      counts: fold([event({ eventType: "email_sent" })], [action()]),
      eventsFailed: false,
      actionsFailed: true,
      eventsComplete: true,
      actionsComplete: false,
    });
    expect(experimentHistoryMetrics(actionsFailed)[0]?.value).toBe("1 events, 1 people");
    expect(experimentHistoryMetrics(actionsFailed).find((metric) => metric.label.startsWith("Resource emails accepted"))?.value)
      .toBe("Not available events, Not available people");
    const page = continueAfterRangePage({ pageNumber: 50, pageCap: 50, rowCount: 1000, pageSize: 1000 });
    expect(page).toEqual({ continue: false, complete: false, error: "people_page_cap" });
  });

  it("classifies eligible, stopped, and unknown prospects without double counting", () => {
    const report = foldEligibility({
      people: [
        { email: "active@example.com", lifecycle: "cold_active" },
        { email: "active@example.com", lifecycle: "cold_active" },
        { email: "stopped@example.com", lifecycle: "trial_started" },
        { email: "listed@example.com", lifecycle: "cold_active" },
        { email: "both@example.com", lifecycle: "unsubscribed" },
        { email: "odd@example.com", lifecycle: "not_a_state" },
      ],
      suppressedEmails: ["listed@example.com", "both@example.com", "orphan@example.com"],
      peopleComplete: true,
      suppressionComplete: true,
    });
    expect(report.eligible).toBe(1);
    expect(report.stopped).toBe(3);
    expect(report.unknown).toBe(1);
    const hidden = foldEligibility({
      people: [{ email: "active@example.com", lifecycle: "cold_active" }],
      suppressedEmails: [],
      peopleComplete: true,
      suppressionComplete: false,
    });
    expect(hidden.eligible).toBeNull();
    expect(hidden.stopped).toBeNull();
    expect(hidden.truncated).toBe(true);
    const capped = foldEligibility({
      people: [{ email: "active@example.com", lifecycle: "cold_active" }],
      suppressedEmails: [],
      peopleComplete: false,
      suppressionComplete: true,
    });
    expect(capped.eligible).toBeNull();
    expect(capped.truncated).toBe(true);
  });

  it("does not invent campaign attribution or add acquisition trials to the company total", () => {
    const counts = fold([
      event({
        provider: "stripe",
        eventType: "trial_started",
        providerEventId: "sub_1",
        campaignId: "campaign-1",
      }),
    ]);
    expect(counts.acquisitionTrials).toEqual({ events: 1, people: 1 });
    expect(counts.prospectsInEvents).toBe(0);
    const activity = presentExperimentActivity({
      counts,
      eventsFailed: false,
      actionsFailed: false,
      eventsComplete: true,
      actionsComplete: true,
    });
    expect(activity.campaignAttributedTrials).toBeNull();
    const trials = experimentTrialMetrics({ companyTrialStarts: "10", activity });
    expect(trials[0]?.value).toBe("10");
    expect(trials[1]?.label).toBe("Acquisition trial links recorded");
    expect(trials[1]?.value).toBe("1 events, 1 people");
    expect(trials[1]?.note).toBe("Counted when the acquisition system recorded a Stripe trial link. This may differ from actual trial-start timing and may include test accounts.");
    expect(trials[2]?.value).toBe("Not available");
    expect(trials[2]?.note).toContain("source_campaign is not used");
    const snapshot = emptyUnknownSnapshot();
    snapshot.period = { ...snapshot.period, freeTrialsStarted: 10 };
    const operating = buildOperatingSnapshot({
      growth: {
        range: "last_7",
        source: "all",
        timezone: "America/New_York",
        asOfNowLabel: "Oct 24, 2026, 11:00 AM",
        snapshot,
        latestTrials: [],
        warnings: [],
        adSpendEntries: [],
        activationQueryComplete: true,
        latestTrialsActivationComplete: true,
        adSpendQueryComplete: true,
        todayDateKey: "2026-10-24",
        stripeWeek: emptyStripeWeekMovement(),
        currentFreeTrials: emptyCurrentFreeTrials(),
        recentActivity: null,
        recentActivityPaymentFailedIncluded: false,
        trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
        visitorCohortTable: emptyVisitorCohortTable(),
        homepageVideo: emptyHomepageVideoReport(),
      },
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      experimentActivity: activity,
      eligibility: foldEligibility({
        people: [{ email: "active@example.com", lifecycle: "cold_active" }],
        suppressedEmails: [],
        peopleComplete: true,
        suppressionComplete: true,
      }),
    });
    expect(operating.distribution.trialStarts).toBe("10");
    expect(operating.distribution.trialsPerDay).toContain("1.4");
    expect(operating.distribution.goal).toContain(String(DAILY_NEW_TRIAL_GOAL));
    expect(operating.report).toContain("All Summitt Mindset trial starts: 10");
    expect(operating.report).toContain("Acquisition trial links recorded: 1 events, 1 people");
    expect(operating.report).toContain("Counted when the acquisition system recorded a Stripe trial link.");
    expect(operating.report).toContain("Campaign or journey attributed trial starts: Not available");
    expect(operating.report).not.toContain("13");
    expect(operating.report).not.toMatch(/@/);
    const lines = formatExperimentSections({
      rangeLabel: "Today",
      timezone: "America/New_York",
      companyTrialStarts: "10",
      activity,
      eligibility: operating.eligibility,
    });
    expect(lines.join("\n")).not.toMatch(/conversion rate/i);
  });

  it("keeps the dashboard page and leaves Brooke's page alone", () => {
    const screen = readFileSync(join(process.cwd(), "src/app/admin/operating-screen.tsx"), "utf8");
    const brooke = readFileSync(join(process.cwd(), "src/app/admin/subscriber-growth/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/lib/acquisition/experiment-activity.server.ts"), "utf8");
    expect(screen).toContain("Current prospect status — all time");
    expect(screen).toContain("Historical acquisition activity");
    expect(screen).toContain("Current eligibility — all time");
    expect(screen).toContain("snapshot.distribution.goal");
    expect(brooke).not.toContain("experiment-activity");
    expect(brooke).not.toContain("loadOperatingSnapshot");
    expect(loader).not.toContain("source_campaign");
    expect(loader).not.toContain("lead_interested");
    expect(loader).not.toContain("instantly-email-read");
    expect(loader).not.toContain("clerk");
    expect(loader).toContain("continueAfterRangePage");
  });
});
