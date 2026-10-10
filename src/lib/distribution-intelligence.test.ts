import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  type TrafficSourceRow,
} from "@/lib/admin-subscriber-growth-pure";
import {
  buildDistributionIntelligence,
  formatDistributionIntelligence,
} from "@/lib/distribution-intelligence";
import { buildDistributionTrackingLink } from "@/lib/distribution-tracking-link";
import {
  buildRetentionIntelligence,
  RETENTION_DAY_MS,
  type RetentionSpell,
} from "@/lib/retention-intelligence";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function traffic(patch: Partial<TrafficSourceRow>): TrafficSourceRow {
  return {
    sourceNormalized: "organic_social",
    platform: "Instagram",
    firstTouchLabel: "Instagram",
    isPaidAcquisition: false,
    sourceDetail: null,
    referrerHost: null,
    utmSource: "instagram",
    utmCampaign: "spring",
    utmContent: "post_reel_1",
    visitors: 10,
    accounts: 2,
    trialsStarted: 4,
    activated: 1,
    paidConversions: 1,
    advertisingSpendCents: null,
    costPerPaidCents: null,
    ...patch,
  };
}

describe("distribution channel and content", () => {
  it("groups rows by channel and keeps one first-touch paid count", () => {
    const intel = buildDistributionIntelligence({
      trackingReadable: true,
      spendReadable: true,
      retentionReady: true,
      rangeTrials: 5,
      rangePaid: 2,
      trafficRows: [
        traffic({ visitors: 3, trialsStarted: 1, paidConversions: 1 }),
        traffic({
          utmCampaign: "fall",
          utmContent: "post_reel_2",
          visitors: 2,
          trialsStarted: 1,
          paidConversions: 0,
        }),
      ],
      cohorts: [
        {
          channel: "Instagram",
          campaign: "spring",
          content: "post_reel_1",
          production: "Brooke-created",
          d30: { retained: 1, ended: 0, rejoined: 0, unknown: 0, immature: 2 },
          d60: { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 3 },
          d90: { retained: 0, ended: 0, rejoined: 0, unknown: 1, immature: 0 },
        },
      ],
    });
    expect(intel.channels[0]?.channel).toBe("Instagram");
    expect(intel.channels[0]?.visitors).toBe("5");
    expect(intel.channels[0]?.trials).toBe("2");
    expect(intel.channels[0]?.paid).toBe("1");
    expect(intel.channels[0]?.trialToPaid).toBe("50% (1 of 2)");
    expect(intel.channels[0]?.retention).toContain("D30 100% (1 of 1)");
    expect(intel.channels[0]?.retention).toContain("D60 Not old enough");
    expect(intel.channels[0]?.retention).toContain("Unknown 1");
    expect(intel.unattributedTrials).toBe("3");
    expect(intel.unattributedPaid).toBe("1");
    expect(intel.content.find((row) => row.content === "post_reel_1")?.production).toBe(
      "Brooke-created"
    );
  });

  it("does not treat missing spend as zero", () => {
    const intel = buildDistributionIntelligence({
      trackingReadable: true,
      spendReadable: true,
      retentionReady: false,
      rangeTrials: null,
      rangePaid: null,
      trafficRows: [traffic({ advertisingSpendCents: null })],
      cohorts: [],
    });
    expect(intel.channels[0]?.spend).toBe("Spend not recorded");
    expect(intel.channels[0]?.spend).not.toContain("$0");
    expect(intel.channels[0]?.costPerPaid).toBe("Not available");
    expect(intel.channels[0]?.retention).toBe("Not available");
    const unread = buildDistributionIntelligence({
      trackingReadable: false,
      spendReadable: false,
      retentionReady: false,
      rangeTrials: 0,
      rangePaid: 0,
      trafficRows: [],
      cohorts: [],
    });
    expect(unread.channels).toEqual([]);
    expect(unread.note).toContain("Do not treat that as zero");
  });

  it("keeps mixed production classes unknown and leaves private ids out of the report", () => {
    const intel = buildDistributionIntelligence({
      trackingReadable: true,
      spendReadable: true,
      retentionReady: true,
      rangeTrials: 1,
      rangePaid: 1,
      trafficRows: [traffic({})],
      cohorts: [
        {
          channel: "Instagram",
          campaign: "spring",
          content: "post_reel_1",
          production: "Brooke-created",
          d30: { retained: 1, ended: 0, rejoined: 0, unknown: 0, immature: 0 },
          d60: { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 1 },
          d90: { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 1 },
        },
        {
          channel: "Instagram",
          campaign: "spring",
          content: "post_reel_1",
          production: "AI-assisted",
          d30: { retained: 0, ended: 1, rejoined: 0, unknown: 0, immature: 0 },
          d60: { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 1 },
          d90: { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 1 },
        },
      ],
    });
    expect(intel.content[0]?.production).toBe("Unknown");
    const text = formatDistributionIntelligence(intel).join("\n");
    expect(text).not.toContain("user_");
    expect(text).not.toContain("@");
    expect(text).toContain("not proof");
  });
});

describe("distribution tracking links", () => {
  it("uses the existing UTM shape, approved paths, and a production param", () => {
    const built = buildDistributionTrackingLink({
      destination: "/leadership",
      platform: "instagram",
      trafficType: "organic",
      campaign: "Spring Launch",
      contentType: "post",
      contentId: "Reel 1",
      production: "brooke",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const url = new URL(built.url);
    expect(url.origin).toBe("https://summittmindset.com");
    expect(url.pathname).toBe("/leadership");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_medium")).toBe("organic_social");
    expect(url.searchParams.get("utm_campaign")).toBe("spring_launch");
    expect(url.searchParams.get("utm_content")).toBe("post_reel_1");
    expect(url.searchParams.get("sm_prod")).toBe("brooke");
  });

  it("rejects an unapproved destination and omits unknown production", () => {
    const rejected = buildDistributionTrackingLink({
      destination: "/secret",
      platform: "instagram",
      trafficType: "organic",
      campaign: "spring",
      contentType: "post",
      contentId: "one",
      production: "brooke",
    });
    expect(rejected.ok).toBe(false);
    const email = buildDistributionTrackingLink({
      destination: "/daily-coaching",
      platform: "email",
      trafficType: "organic",
      campaign: "welcome & follow up",
      contentType: "post",
      contentId: "issue 3",
      production: "unknown",
    });
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    const url = new URL(email.url);
    expect(url.pathname).toBe("/daily-coaching");
    expect(url.searchParams.get("utm_source")).toBe("email");
    expect(url.searchParams.get("utm_campaign")).toBe("welcome_follow_up");
    expect(url.searchParams.get("sm_prod")).toBeNull();
  });
});

describe("shared report and Brooke's page", () => {
  it("copies one report and does not add a poor-performance action", () => {
    const growth = growthFixture();
    growth.snapshot.notes.sourceTrackingUnavailable = false;
    growth.snapshot.trafficRows = [traffic({})];
    const spell: RetentionSpell = {
      id: "s1",
      clerkUserId: "user_private_lookup",
      paidStartMs: NOW - 40 * RETENTION_DAY_MS,
      endedAtMs: null,
      endKnown: true,
      open: true,
      interval: "month",
      cancellationReason: null,
      trialStartMs: null,
    };
    const retention = buildRetentionIntelligence({
      nowMs: NOW,
      partial: false,
      partialReason: null,
      withheld: null,
      spells: [spell],
      activeWithoutPayment: 0,
      appleRows: 0,
      customerFeedbackCount: 0,
      engagementReadable: true,
      hits: [],
      measuredSignals: [],
      acquisitionReadable: true,
      landingReadable: true,
      experimentReadable: true,
      acquisition: [
        {
          clerkUserId: "user_private_lookup",
          source: "organic_social",
          campaign: "spring",
          content: "post_reel_1",
          landing: "/leadership",
          experiment: null,
          channel: "Instagram",
          production: "brooke",
        },
      ],
    });
    const snapshot = buildOperatingSnapshot({
      growth,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      retentionIntelligence: retention,
    });
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    expect(report).toContain("CHANNEL AND CONTENT");
    expect(report).not.toContain("user_private_lookup");
    expect(snapshot.actions.map((action) => action.title).join(" ")).not.toMatch(/poor|increase spend/i);
    const brooke = readFileSync(
      join(process.cwd(), "src/app/admin/subscriber-growth/page.tsx"),
      "utf8"
    );
    const form = readFileSync(
      join(process.cwd(), "src/app/admin/subscriber-growth/tracking-link-builder.tsx"),
      "utf8"
    );
    expect(brooke).not.toContain("distribution-intelligence");
    expect(form).not.toContain("sm_prod");
    expect(form).not.toContain("Brooke-created");
  });
});

function growthFixture(): SubscriberGrowthDashboardData {
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
