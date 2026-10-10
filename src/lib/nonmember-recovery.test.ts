import { readFileSync } from "node:fs";

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
} from "@/lib/admin-subscriber-growth-pure";
import {
  emptyCategoryCounts,
  failedNonmemberCensus,
  type NonmemberCensusData,
} from "@/lib/nonmember-census";
import { buildNonmemberRecovery, formatNonmemberRecovery } from "@/lib/nonmember-recovery";

function census(patch: Partial<NonmemberCensusData> = {}): NonmemberCensusData {
  return {
    coverage: "partial",
    examined: 200,
    clerkTotal: 480,
    members: 20,
    nonmembers: 8,
    unknownEntitlement: 3,
    unverifiedTrial: 1,
    withEmail: 30,
    categories: {
      ...emptyCategoryCounts(),
      checkout_never_recorded: 2,
      checkout_creation_failed: 1,
      checkout_pending: 1,
      checkout_expired: 1,
      checkout_completed_without_trial: 1,
      previously_subscribed: 2,
    },
    rows: [{ clerkUserId: "user_private_account", createdAtMs: null, category: "checkout_expired" }],
    ...patch,
  };
}

describe("nonmember recovery", () => {
  it("keeps former members and unknown membership out of the prospect count", () => {
    const recovery = buildNonmemberRecovery(census());
    expect(recovery.verifiedNonmembers).toBe("8");
    expect(recovery.formerMembersExcluded).toBe("2");
    expect(recovery.currentMembersExcluded).toBe("20");
    expect(recovery.potentialProspects).toContain("6.");
    expect(recovery.potentialProspects).toContain("Not send-ready");
    expect(recovery.suppressionUnverified).toContain("6.");
    expect(recovery.suppressionUnverified).toContain("not zero unsubscribes");
    expect(recovery.doNotEmail).toContain("Not available");
    expect(recovery.doNotEmail).toContain("not zero");
    expect(recovery.notEligible).toContain("25.");
    expect(recovery.uncertainMembership).toBe("3");
    expect(recovery.outsideCoverage).toBe("280");
    expect(recovery.noVerifiedTrial).toBe("6");
    expect(recovery.smsPermission).toContain("different rules");
    expect(recovery.sendReady).toContain("not send-ready");
  });

  it("does not turn a failed census into zero nonmembers", () => {
    const recovery = buildNonmemberRecovery(failedNonmemberCensus());
    expect(recovery.verifiedNonmembers).toBe("Not available");
    expect(recovery.potentialProspects).toContain("Not available");
    expect(recovery.suppressionUnverified).toContain("Not available");
    expect(recovery.notEligible).toContain("Not available");
    expect(recovery.outsideCoverage).toBe("Not available");
    expect(recovery.coverage).toContain("not zero");
  });

  it("withholds a prospect count when former members exceed nonmembers", () => {
    const recovery = buildNonmemberRecovery(
      census({
        nonmembers: 1,
        categories: { ...emptyCategoryCounts(), previously_subscribed: 4 },
      })
    );
    expect(recovery.potentialProspects).toContain("Not available");
  });

  it("shares one report without personal identifiers and does not send", () => {
    const growth = growthFixture();
    const snapshot = buildOperatingSnapshot({
      growth,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
      census: census(),
    });
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    const block = formatNonmemberRecovery(snapshot.nonmemberRecovery).join("\n");
    expect(report).toContain(block);
    expect(report).toContain("NONMEMBER RECOVERY");
    expect(report).not.toContain("user_private_account");
    expect(report).not.toMatch(/@/);
    expect(snapshot.actions.map((action) => action.id)).not.toContain("send-recovery");
    expect(snapshot.nonmemberRecovery.sending).toContain("No recovery email");
    const screen = readFileSync("src/app/admin/operating-screen.tsx", "utf8");
    const panel = readFileSync("src/app/admin/nonmember-recovery-panel.tsx", "utf8");
    const pure = readFileSync("src/lib/nonmember-recovery.ts", "utf8");
    expect(screen.indexOf("<NonmemberRecoveryPanel")).toBeLessThan(
      screen.indexOf("function RetentionBody")
    );
    expect(readFileSync("src/app/admin/subscriber-growth/page.tsx", "utf8")).not.toContain(
      "nonmember-recovery"
    );
    expect(readFileSync("src/lib/landing-experiment.server.ts", "utf8")).not.toContain(
      "nonmember recovery"
    );
    for (const src of [screen, panel, pure]) {
      expect(src).not.toMatch(/resend|twilio|sendSms|sessions\.create/i);
    }
    expect(pure).not.toContain("operating_experiments");
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
