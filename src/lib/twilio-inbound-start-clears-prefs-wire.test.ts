import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");

describe("twilio inbound START clears comms prefs", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("runStartFlow calls clearCommsPreferencesOnSmsResume", () => {
    const startIdx = src.indexOf("async function runStartFlow");
    const block = src.slice(startIdx, startIdx + 800);
    expect(block).toContain("clearCommsPreferencesOnSmsResume");
  });

  it("successful START still returns restarted only after the preference clear", () => {
    const startIdx = src.indexOf("async function runStartFlow");
    const endIdx = src.indexOf("export async function POST");
    const block = src.slice(startIdx, endIdx);
    expect(block).toContain('if (preferenceClear !== "cleared") return "restarted_preferences_unconfirmed"');
    expect(block).toContain('return "restarted"');
    expect(block).toContain("syncSmsAudience");
    expect(block.indexOf("clearCommsPreferencesOnSmsResume")).toBeLessThan(block.indexOf("syncSmsAudience"));
    expect(block.indexOf("syncSmsAudience")).toBeLessThan(
      block.indexOf('return "restarted_preferences_unconfirmed"')
    );
  });

  it("an unconfirmed preference clear does not say scheduled check-ins are on", () => {
    const postIdx = src.indexOf("export async function POST");
    const handler = src.slice(postIdx);
    const startCall = handler.lastIndexOf("if (isStartCommand(body))");
    const next = handler.indexOf("const safetyTwiml", startCall);
    const block = handler.slice(startCall, next);
    expect(block).toContain("restarted_preferences_unconfirmed");
    expect(block).toContain("START_CONSENT_RESTORED_BODY");
    expect(block).toContain("return twiml(START_TWIML_BODY)");
    const unconfirmed = block.indexOf("START_CONSENT_RESTORED_BODY");
    const success = block.indexOf("return twiml(START_TWIML_BODY)");
    expect(unconfirmed).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(unconfirmed);
    expect(src).toContain("Your text messages are on again.");
    expect(src).not.toContain("Text check-ins are on again");
  });

  it("STOP/HELP/START order unchanged in main handler", () => {
    const postIdx = src.indexOf("export async function POST");
    const handler = src.slice(postIdx, postIdx + 6000);
    const stopIdx = handler.indexOf("isStopCommand(body)");
    const helpIdx = handler.indexOf("isHelpCommand(body)");
    const startIdx = handler.indexOf("isStartCommand(body)");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(helpIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(helpIdx);
  });

  it("STOP path does not clear comms prefs via helper", () => {
    const stopFlowIdx = src.indexOf("async function runStopFlow");
    const startFlowIdx = src.indexOf("async function runStartFlow");
    const stopBlock = src.slice(stopFlowIdx, startFlowIdx);
    const stopSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-canonical-stop.ts"),
      "utf8"
    );
    expect(stopBlock).not.toContain("clearCommsPreferencesOnSmsResume");
    expect(stopSrc).not.toContain("clearCommsPreferencesOnSmsResume");
  });
});
