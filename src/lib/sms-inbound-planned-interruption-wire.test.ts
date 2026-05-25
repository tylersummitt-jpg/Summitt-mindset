import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("sms-inbound-coach — planned interruption wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports planned interruption helpers", () => {
    expect(src).toContain('from "@/lib/sms-planned-interruption"');
    expect(src).toContain("detectSmsPlannedInterruption");
    expect(src).toContain("insertSmsPlannedInterruptionMemorySignal");
    expect(src).toContain("applyPlannedInterruptionGatedOverride");
  });

  it("skips low_pressure exit when planned interruption is actionable", () => {
    expect(src).toContain("if (brokePause && !plannedInterruptionActionable)");
  });

  it("applies gated override after resolveV2InboundGatedDecision", () => {
    const idxResolve = src.indexOf("resolveV2InboundGatedDecision");
    const idxOverride = src.indexOf("applyPlannedInterruptionGatedOverride");
    const idxInsert = src.indexOf("insertSmsPlannedInterruptionMemorySignal");
    expect(idxResolve).toBeGreaterThanOrEqual(0);
    expect(idxOverride).toBeGreaterThan(idxResolve);
    expect(idxInsert).toBeGreaterThan(idxResolve);
  });

  it("main path passes pattern and goal adjustment to buildInboundV3RelationshipFacts", () => {
    expect(src).toContain("patternSignalMain");
    expect(src).toContain("goalAdjustmentSignalMain");
    expect(src).toContain("plannedInterruption:");
  });
});
