import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");

describe("APP-041B2a START blocked by account deletion (wire)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  const startIdx = src.indexOf("async function runStartFlow");
  const mainIdx = src.indexOf("export async function POST");
  const startBlock = src.slice(startIdx, mainIdx);
  const handler = src.slice(mainIdx);

  it("runStartFlow returns blocked_account_deleting without mutating identity", () => {
    expect(startBlock).toContain("hasUnresolvedAccountDeletionRequest");
    expect(startBlock).toContain('return "blocked_account_deleting"');
    expect(startBlock).toContain('return "restarted"');

    const guardIdx = startBlock.indexOf("hasUnresolvedAccountDeletionRequest");
    const blockedReturn = startBlock.indexOf(
      'return "blocked_account_deleting"',
      guardIdx
    );
    const identityUpdate = startBlock.indexOf(
      'from("sms_identities")',
      guardIdx
    );
    expect(blockedReturn).toBeGreaterThan(guardIdx);
    expect(identityUpdate).toBeGreaterThan(blockedReturn);
  });

  it("blocked START uses fastAckTwiml, not rejoined START_TWIML_BODY", () => {
    const occurrences: number[] = [];
    let from = 0;
    while (true) {
      const i = handler.indexOf("if (isStartCommand(body))", from);
      if (i < 0) break;
      occurrences.push(i);
      from = i + 1;
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(1);

    for (const startCall of occurrences) {
      const nextCommand = handler.indexOf("if (is", startCall + 1);
      const block = handler.slice(
        startCall,
        nextCommand > startCall ? nextCommand : startCall + 500
      );
      expect(block).toContain('startOutcome === "blocked_account_deleting"');
      expect(block).toContain("return fastAckTwiml()");
      expect(block).toContain("return twiml(START_TWIML_BODY)");
      const blockedAck = block.indexOf("return fastAckTwiml()");
      const rejoined = block.indexOf("return twiml(START_TWIML_BODY)");
      expect(blockedAck).toBeGreaterThan(0);
      expect(rejoined).toBeGreaterThan(blockedAck);
    }

    expect(src).toContain(
      "Welcome back. Text check-ins are on; Pat will text you about your commitment. Reply STOP to opt out anytime."
    );
  });

  it("STOP path remains unchanged", () => {
    const stopFlowIdx = src.indexOf("async function runStopFlow");
    const startFlowIdx = src.indexOf("async function runStartFlow");
    const stopBlock = src.slice(stopFlowIdx, startFlowIdx);
    expect(stopBlock).toContain("sms_enabled: false");
    expect(stopBlock).toContain("stopped_at:");
    expect(stopBlock).toContain("smsEnabled: false");
    expect(handler).toContain(
      'return twiml("You have been unsubscribed. Reply START to rejoin.")'
    );
  });
});
