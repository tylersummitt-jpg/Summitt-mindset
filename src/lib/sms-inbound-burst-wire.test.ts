import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INBOUND_ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const COACH_CRON = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("twilio inbound — burst quiet window wire", () => {
  const src = fs.readFileSync(INBOUND_ROUTE, "utf8");

  it("imports burst-pace enqueue helper", () => {
    expect(src).toContain('from "@/lib/sms-inbound-burst-pace"');
    expect(src).toContain("enqueueNormalCoachJobWithBurstQuiet");
  });

  it("STOP/HELP/START return before coach job enqueue", () => {
    const postStart = src.indexOf("export async function POST");
    const postSlice = src.slice(postStart);
    const stopIdx = postSlice.indexOf("isStopCommand(body)");
    const helpIdx = postSlice.indexOf("isHelpCommand(body)");
    const startIdx = postSlice.indexOf("isStartCommand(body)");
    const coachIdx = postSlice.indexOf("ensureCoachJobPresent");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(helpIdx).toBeLessThan(coachIdx);
    expect(startIdx).toBeLessThan(coachIdx);
  });

  it("safety short-circuit returns before coach job enqueue", () => {
    const safetyReturn = src.indexOf("if (safetyTwiml)");
    const coachIdx = src.indexOf("ensureCoachJobPresent", safetyReturn);
    const between = src.slice(safetyReturn, coachIdx);
    expect(between).toContain("return safetyTwiml");
  });

  it("does not import burst quiet into STOP/HELP/START handlers", () => {
    const stopBlock = src.slice(src.indexOf("async function runStopFlow"), src.indexOf("async function runStartFlow"));
    expect(stopBlock).not.toContain("enqueueNormalCoachJobWithBurstQuiet");
  });
});

describe("sms-inbound-coach cron — burst gate wire", () => {
  const src = fs.readFileSync(COACH_CRON, "utf8");

  it("imports per-user in-flight and newer-pending defer helpers", () => {
    expect(src).toContain('from "@/lib/sms-inbound-burst-pace"');
    expect(src).toContain("findUserInFlightCoachJobMessageSid");
    expect(src).toContain("deferCoachJobForUserInFlight");
    expect(src).toContain("findNewerReadyPendingCoachJobMessageSid");
    expect(src).toContain("deferCoachJobForNewerPendingBurst");
  });

  it("runs in-flight gate before claim update", () => {
    const loopStart = src.indexOf("for (const row of candidates");
    const claimUpdate = src.indexOf('status: "processing"', loopStart);
    const gateBlock = src.slice(loopStart, claimUpdate);
    expect(gateBlock).toContain("findUserInFlightCoachJobMessageSid");
    expect(gateBlock).toContain("deferCoachJobForUserInFlight");
    expect(gateBlock).toContain("findNewerReadyPendingCoachJobMessageSid");
  });

  it("still uses split coalesce at process time", () => {
    expect(src).toContain("coalesceOlderPendingSplitJobsForClaimedJob");
  });
});
