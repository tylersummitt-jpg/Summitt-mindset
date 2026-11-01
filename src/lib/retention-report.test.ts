import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
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
  formatCompleteRetentionFacts,
  type RetentionIntelligenceInput,
} from "@/lib/retention-intelligence";
import {
  canPublishRetentionReport,
  claimIsAvailable,
  interpretRetentionReportRead,
  publishOwnsRun,
  RETENTION_REPORT_CLAIM_STALE_MS,
  retentionReportHasPrivateContent,
} from "@/lib/retention-report";

const NOW = Date.parse("2026-11-01T16:00:00.000Z");

function input(patch: Partial<RetentionIntelligenceInput> = {}): RetentionIntelligenceInput {
  return {
    nowMs: NOW,
    partial: false,
    partialReason: null,
    withheld: null,
    spells: [],
    activeWithoutPayment: 0,
    appleRows: null,
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

describe("retention report publication", () => {
  it("uses the existing calculator and does not publish a withheld invoice read", () => {
    const ready = buildRetentionIntelligence(
      input({
        engagementReadable: false,
        engagementGaps: ["Ask Pat could not be fully read. It is not shown as zero."],
      })
    );
    const withheld = buildRetentionIntelligence(
      input({
        withheld: "Paid invoices stopped before the full history, newest first.",
        partial: true,
      })
    );
    expect(canPublishRetentionReport(ready)).toBe(true);
    expect(canPublishRetentionReport(withheld)).toBe(false);
    expect(ready.engagement).toEqual([]);
    const facts = formatCompleteRetentionFacts(ready, {
      asOfLabel: "Nov 1, 2026, 11:00 AM ET",
      rangeLabel: "Last 30 days",
      cohortCalculatedAt: "Nov 1, 2026, 10:00 AM ET",
      generationNote: "The last generation failed and did not replace this report.",
      payingMembers: "12",
      trialsConverted: "1",
      cancelledDuringTrial: "0",
      finishedTrialWithoutPaid: "Not available",
      paidMembershipsEnded: "2",
      churn: "Not available",
      pastDueNow: "0",
      paymentFailedInRange: "0",
      freeWeekNow: "3",
      stripeRevenue: "$10.00",
    });
    expect(facts).toContain("Ask Pat could not be fully read");
    expect(facts).toContain("not shown as zero");
    expect(facts).toContain("Current counts observed at: Nov 1, 2026, 11:00 AM ET");
    expect(facts).toContain("Last 30 days");
    expect(facts).toContain("Retention cohorts calculated at: Nov 1, 2026, 10:00 AM ET");
    expect(facts).toContain("did not replace this report");
    expect(retentionReportHasPrivateContent(ready)).toBe(false);
    expect(retentionReportHasPrivateContent({ ...ready, raw_body: "private text" })).toBe(true);
  });

  it("lets one fresh claim own the job and recovers an expired claim", () => {
    const row = { state: "idle", started_at: null as string | null, run_token: null as string | null, report: "kept" };
    expect(claimIsAvailable(row, NOW)).toBe(true);
    row.state = "running";
    row.started_at = new Date(NOW).toISOString();
    row.run_token = "first";
    expect(claimIsAvailable(row, NOW + 1_000)).toBe(false);
    expect(publishOwnsRun(row, "second")).toBe(false);
    expect(row.report).toBe("kept");
    expect(claimIsAvailable(row, NOW + RETENTION_REPORT_CLAIM_STALE_MS)).toBe(true);
    expect(publishOwnsRun({ state: "running", run_token: "first" }, "first")).toBe(true);
  });

  it("reads a saved report after reload and survives a missing table", () => {
    const ready = buildRetentionIntelligence(input());
    const saved = interpretRetentionReportRead({
      error: null,
      nowMs: NOW,
      row: {
        report: ready,
        calculated_at: "2026-11-01T15:00:00.000Z",
        schema_version: 1,
        state: "idle",
        started_at: null,
        error: null,
      },
    });
    expect(saved.intelligence.milestones.map((milestone) => milestone.label)).toEqual(
      ready.milestones.map((milestone) => milestone.label)
    );
    expect(saved.cohortCalculatedAt).toContain("2026");
    expect(saved.generationNote).toBeNull();

    const missing = interpretRetentionReportRead({
      error: { code: "PGRST205", message: "retention_report" },
      row: null,
      nowMs: NOW,
    });
    expect(missing.intelligence.status).toBe("unreadable");
    expect(missing.intelligence.definition).toContain("could not be read");
    expect(missing.intelligence.definition).toContain("not");
    const snapshot = buildOperatingSnapshot({
      growth: {
        range: "last_7",
        source: "all",
        timezone: "America/New_York",
        asOfNowLabel: "Nov 1, 2026, 11:00 AM",
        snapshot: emptyUnknownSnapshot(),
        latestTrials: [],
        warnings: [],
        adSpendEntries: [],
        activationQueryComplete: true,
        latestTrialsActivationComplete: true,
        adSpendQueryComplete: true,
        todayDateKey: "2026-11-01",
        stripeWeek: emptyStripeWeekMovement(),
        currentFreeTrials: emptyCurrentFreeTrials(),
        recentActivity: null,
        recentActivityPaymentFailedIncluded: false,
        trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
        visitorCohortTable: emptyVisitorCohortTable(),
        homepageVideo: emptyHomepageVideoReport(),
      } satisfies SubscriberGrowthDashboardData,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: missing.intelligence,
    });
    expect(snapshot.retentionIntelligence.status).toBe("unreadable");
    expect(snapshot.report).toContain("could not be read");
    expect(snapshot.retention.payingMembers).toBeTypeOf("string");
  });

  it("keeps the page path, ceilings, and migration inside the approved scope", () => {
    const root = process.cwd();
    const loader = readFileSync(join(root, "src/lib/retention-intelligence.server.ts"), "utf8");
    const page = readFileSync(join(root, "src/lib/admin-operating-snapshot.server.ts"), "utf8");
    const route = readFileSync(join(root, "src/app/api/admin/retention-report/route.ts"), "utf8");
    const migration = readFileSync(
      join(root, "supabase/migrations/20261101120000_retention_report.sql"),
      "utf8"
    );
    const vercel = readFileSync(join(root, "vercel.json"), "utf8");
    const screen = readFileSync(join(root, "src/app/admin/operating-screen.tsx"), "utf8");
    expect(loader).toContain("const MAX_PAGES = 100");
    expect(loader).toContain("const ENGAGEMENT_MEMBER_CEILING = 4000");
    expect(loader).toContain("const CHUNK = 80");
    expect(loader).toContain("buildRetentionIntelligence");
    expect(page).not.toContain("loadRetentionIntelligence");
    expect(page).toContain("readSavedRetentionReport");
    expect(route).toContain("maxDuration = 300");
    expect(route).toContain("loadRetentionIntelligence");
    const budgetAt = route.indexOf("Date.now() + RETENTION_REPORT_TIME_BUDGET_MS");
    const subsAt = route.indexOf("loadRetentionSubscriptionInputs(deadlineMs)");
    expect(budgetAt).toBeGreaterThan(-1);
    expect(budgetAt).toBeLessThan(subsAt);
    const readChunked = loader.slice(loader.indexOf("async function readChunked"));
    const engagementPage = readChunked.indexOf("for (let page = 0; page < maxPages; page += 1)");
    expect(readChunked.slice(engagementPage, engagementPage + 180)).toContain("deadlineMs");
    const visitors = loader.slice(loader.indexOf("async function readVisitorEvents"));
    const visitorPage = visitors.indexOf("for (let page = 0; page < 4; page += 1)");
    expect(visitors.slice(visitorPage, visitorPage + 180)).toContain("deadlineMs");
    expect(loader).toContain("loadAcquisition(clerkIds, deadlineMs)");
    const growth = readFileSync(join(root, "src/lib/admin-subscriber-growth.ts"), "utf8");
    const subscriptions = growth.slice(growth.indexOf("async function listStripeSubscriptions"));
    const subscriptionPage = subscriptions.indexOf("for (let page = 0; page < STRIPE_MAX_PAGES; page += 1)");
    expect(subscriptions.slice(subscriptionPage, subscriptionPage + 180)).toContain("deadlineMs");
    expect(route).toContain("session.userId !== tylerId");
    expect(route).not.toContain("buildRetentionIntelligence");
    expect(migration).not.toContain("CREATE INDEX");
    expect(migration).toContain("retention_report");
    expect(vercel).not.toContain("retention-report");
    expect(screen).toContain('label="Copy Complete Facts Report"');
    expect(screen).toContain("GenerateRetentionReportButton");
    expect(screen).toContain("<CopyBusinessReportButton report={snapshot.report} />");
  });
});
