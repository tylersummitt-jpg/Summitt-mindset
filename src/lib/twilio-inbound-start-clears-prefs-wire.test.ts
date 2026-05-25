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
    const stopBlock = src.slice(stopFlowIdx, stopFlowIdx + 600);
    expect(stopBlock).not.toContain("clearCommsPreferencesOnSmsResume");
  });
});
