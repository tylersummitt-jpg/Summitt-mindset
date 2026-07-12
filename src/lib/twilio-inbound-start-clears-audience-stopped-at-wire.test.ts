import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const SYNC = path.join(process.cwd(), "src/lib/sms-audience-sync.ts");

describe("twilio inbound START clears sms_audience.stopped_at", () => {
  const routeSrc = fs.readFileSync(ROUTE, "utf8");
  const syncSrc = fs.readFileSync(SYNC, "utf8");

  it("A: runStartFlow passes stoppedAt null so audience stopped_at is cleared", () => {
    const startIdx = routeSrc.indexOf("async function runStartFlow");
    const stopIdx = routeSrc.indexOf("/* =====", startIdx + 1);
    const block = routeSrc.slice(startIdx, stopIdx > startIdx ? stopIdx : startIdx + 900);
    expect(block).toContain("syncSmsAudience");
    expect(block).toContain("smsEnabled: true");
    expect(block).toContain("stoppedAt: null");
    expect(block).toContain('sms_enabled: true');
    expect(block).toContain("stopped_at: null");
    expect(block).toContain("smsEnabled: true");
    expect(block).toContain("smsRestartedAt");
  });

  it("syncSmsAudience writes stopped_at when stoppedAt is explicitly null", () => {
    expect(syncSrc).toContain("stoppedAt !== undefined");
    expect(syncSrc).toContain("payload.stopped_at = stoppedAt");
    expect(syncSrc).toContain("applyStoppedAtToAudiencePayload");
  });

  it("B: runStopFlow still sets stoppedAt timestamp and disables SMS", () => {
    const stopFlowIdx = routeSrc.indexOf("async function runStopFlow");
    const startFlowIdx = routeSrc.indexOf("async function runStartFlow");
    const block = routeSrc.slice(stopFlowIdx, startFlowIdx);
    expect(block).toContain("sms_enabled: false");
    expect(block).toContain("stopped_at:");
    expect(block).toContain("smsEnabled: false");
    expect(block).toContain("stoppedAt: new Date().toISOString()");
  });

  it("C: exact START returns before ensureCoachJobPresent", () => {
    const postIdx = routeSrc.indexOf("export async function POST");
    const handler = routeSrc.slice(postIdx);
    // Primary path: START return before coach enqueue
    const startCall = handler.indexOf("if (isStartCommand(body))");
    const startReturn = handler.indexOf("return twiml(START_TWIML_BODY)", startCall);
    const ensureIdx = handler.indexOf("ensureCoachJobPresent", startReturn);
    expect(startCall).toBeGreaterThanOrEqual(0);
    expect(startReturn).toBeGreaterThan(startCall);
    expect(ensureIdx).toBeGreaterThan(startReturn);
    const between = handler.slice(startReturn, ensureIdx);
    // No coach enqueue between START twiml return and later ensure (return wins)
    expect(between).not.toContain("ensureCoachJobPresent(");
  });

  it("D: non-exact natural language is not a START command", () => {
    function normalizeBody(input: string) {
      return (input || "").trim().replace(/\s+/g, " ");
    }
    function isStartCommand(text: string) {
      const t = normalizeBody(text).toLowerCase();
      return ["start", "unstop"].includes(t);
    }
    expect(isStartCommand("please start texting me again")).toBe(false);
    expect(isStartCommand("START")).toBe(true);
    expect(isStartCommand("unstop")).toBe(true);
  });
});
