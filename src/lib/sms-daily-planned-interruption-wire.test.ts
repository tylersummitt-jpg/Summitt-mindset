import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms — planned interruption wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("loads recent planned interruption signal", () => {
    expect(src).toContain("loadRecentPlannedInterruptionSignalForCommitment");
  });

  it("suppresses silence_nudge strategy during planned interruption", () => {
    expect(src).toContain("dailyServerStrategyDuringPlannedInterruption");
  });

  it("blocks low_pressure reactivation entry when planned signal active", () => {
    expect(src).toContain("plannedForPhase == null");
    expect(src).toContain("shouldEnterLowPressureReactivation");
  });

  it("passes planned_interruption facts to daily accountability", () => {
    expect(src).toContain("planned_interruption_active");
  });
});
