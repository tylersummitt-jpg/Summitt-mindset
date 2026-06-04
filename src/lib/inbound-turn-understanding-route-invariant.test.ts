import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("inbound turn understanding route invariants", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("every tryPersist passes turnUnderstandingContext", () => {
    const calls = [...src.matchAll(/tryPersistInboundAccountabilityOutcomeBeforeSend\(\{[\s\S]*?\}\);/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const m of calls) {
      expect(m[0]).toContain("turnUnderstandingContext:");
    }
  });

  it("main path runs final TU guard before persisting reply body", () => {
    const idx = src.indexOf("const tuFinalMain = applyInboundFinalBodyTurnUnderstandingGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 8000);
    expect(block).toContain("finalReplyBody = tuFinalMain.body");
    const replyBodyIdx = block.indexOf("reply_body:");
    if (replyBodyIdx >= 0) {
      expect(block.indexOf("tuFinalMain")).toBeLessThan(replyBodyIdx);
    }
  });

  it("open-question path runs final TU guard", () => {
    expect(src).toContain("const tuFinalOq = applyInboundFinalBodyTurnUnderstandingGuard");
  });

  it("central pivot and arc paths run final TU guard", () => {
    expect(src).toContain("const tuFinalPivot = applyInboundFinalBodyTurnUnderstandingGuard");
    expect(src).toContain("const tuFinalArc = applyInboundFinalBodyTurnUnderstandingGuard");
  });

  it("legacy fallback path runs final TU guard before reply_ready and send", () => {
    const idx = src.indexOf("const tuFinalLegacy = applyInboundFinalBodyTurnUnderstandingGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 4500);
    expect(block).toContain("legacyFinalBody");
    expect(block).toContain('status: "reply_ready"');
    const sendIdx = src.indexOf("commitAndSendInboundRelationshipCoachReply", idx);
    expect(sendIdx).toBeGreaterThan(idx);
    expect(block.indexOf("tuFinalLegacy")).toBeLessThan(block.indexOf("legacyFinalBody"));
  });

  it("conversation brain control defers when TU is authoritative", () => {
    expect(src).toContain("isInboundTurnUnderstandingContextAuthoritative(inboundTurnUnderstandingCtx)");
    expect(src).toContain("brain_gate_skipped_turn_understanding_authoritative");
  });
});
