import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
} from "@/lib/admin-subscriber-growth-pure";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());
const loadOperatingSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));
vi.mock("@/lib/admin-operating-snapshot.server", () => ({
  loadOperatingSnapshot: (...args: unknown[]) => loadOperatingSnapshotMock(...args),
}));

const ROOT = process.cwd();

function sampleSnapshot() {
  const growth = {
    range: "last_7" as const,
    source: "all" as const,
    timezone: "America/New_York" as const,
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
  return buildOperatingSnapshot({
    growth,
    challengeAttention: 0,
    deletions: null,
    deletionsAvailable: true,
  });
}

describe("distribution and retention pages", () => {
  beforeEach(() => {
    vi.resetModules();
    requireTylerAdminMock.mockReset();
    loadOperatingSnapshotMock.mockReset();
    loadOperatingSnapshotMock.mockResolvedValue(sampleSnapshot());
  });

  it("blocks unauthorized access before loading the shared snapshot", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValue(err);
    const distribution = await import("@/app/admin/distribution/page");
    const retention = await import("@/app/admin/retention/page");
    await expect(distribution.default({})).rejects.toMatchObject({ status: 403 });
    await expect(retention.default({})).rejects.toMatchObject({ status: 403 });
    expect(loadOperatingSnapshotMock).not.toHaveBeenCalled();
  });

  it("loads one shared snapshot after Tyler is allowed", async () => {
    requireTylerAdminMock.mockResolvedValue({ userId: "tyler" });
    const distribution = await import("@/app/admin/distribution/page");
    const retention = await import("@/app/admin/retention/page");
    const params = Promise.resolve({ range: "last_7" });
    const distributionView = await distribution.default({ searchParams: params });
    const retentionView = await retention.default({ searchParams: params });
    expect(requireTylerAdminMock).toHaveBeenCalledTimes(2);
    expect(loadOperatingSnapshotMock).toHaveBeenCalledTimes(2);
    expect(distributionView).toBeTruthy();
    expect(retentionView).toBeTruthy();
    expect(loadOperatingSnapshotMock.mock.calls[0][0].searchParams.range).toBe(
      "last_7"
    );
    expect(loadOperatingSnapshotMock.mock.calls[1][0].searchParams.range).toBe(
      "last_7"
    );
  });
});

describe("new pages stay off Brooke's subscriber growth", () => {
  it("does not change Brooke's page or the shared admin navigation", () => {
    const layout = readFileSync(join(ROOT, "src/app/admin/layout.tsx"), "utf8");
    const brooke = readFileSync(
      join(ROOT, "src/app/admin/subscriber-growth/page.tsx"),
      "utf8"
    );
    const distribution = readFileSync(
      join(ROOT, "src/app/admin/distribution/page.tsx"),
      "utf8"
    );
    const retention = readFileSync(
      join(ROOT, "src/app/admin/retention/page.tsx"),
      "utf8"
    );
    const screen = readFileSync(
      join(ROOT, "src/app/admin/operating-screen.tsx"),
      "utf8"
    );
    const copyButton = readFileSync(
      join(ROOT, "src/app/admin/copy-business-report-button.tsx"),
      "utf8"
    );
    expect(layout).not.toContain("/admin/distribution");
    expect(layout).not.toContain("/admin/retention");
    expect(layout).toContain("/admin/subscriber-growth");
    expect(brooke).toContain("loadSubscriberGrowthDashboard");
    expect(brooke).not.toContain("loadOperatingSnapshot");
    expect(distribution).toContain("requireTylerAdmin");
    expect(retention).toContain("requireTylerAdmin");
    expect(distribution.indexOf("requireTylerAdmin")).toBeLessThan(
      distribution.indexOf("loadOperatingSnapshot")
    );
    expect(copyButton).toContain("Copy Business Report");
    expect(screen).toContain("CopyBusinessReportButton");
    expect(screen).toContain("NO_CONTROLLED_EXPERIMENTS");
    expect(screen).toContain("snapshot.report");
    expect(screen).toContain("ExperimentRegistryPanel");
    expect(brooke).not.toContain("operating_experiments");
    expect(brooke).not.toContain("ExperimentRegistryPanel");
    const actions = readFileSync(
      join(ROOT, "src/app/admin/experiment-actions.ts"),
      "utf8"
    );
    const createFn = actions.slice(
      actions.indexOf("export async function createOperatingExperiment")
    );
    expect(createFn.indexOf("requireTylerAdmin")).toBeGreaterThan(-1);
    expect(createFn.indexOf("requireTylerAdmin")).toBeLessThan(
      createFn.indexOf("insertPlannedExperiment")
    );
    expect(actions).not.toContain("sessions.create");
  });
});
