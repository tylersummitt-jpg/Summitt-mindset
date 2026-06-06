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

  it("main path runs final body guards before persisting reply body", () => {
    const idx = src.indexOf("const finalGuardsMain = await applyInboundCoachFinalBodyGuards");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 12000);
    expect(block).toContain("finalReplyBody = finalGuardsMain.body");
    const replyBodyIdx = block.indexOf("reply_body:");
    if (replyBodyIdx >= 0) {
      expect(block.indexOf("finalGuardsMain")).toBeLessThan(replyBodyIdx);
    }
  });

  it("final guard no-send paths persist explicit outcomes before cancel", () => {
    expect(src).toContain("persistExplicitOutcomeBeforeReplyNoSend");
    expect(src).toContain("buildExplicitOutcomeBeforeNoSendTelemetry");
    const mainBlock = src.slice(
      src.indexOf("if (!finalGuardsMain.shouldSend)"),
      src.indexOf("if (!finalGuardsMain.shouldSend)") + 1200
    );
    expect(mainBlock).toContain("persistExplicitOutcomeBeforeReplyNoSend");
  });

  it("lane no-send paths persist explicit outcomes before cancel", () => {
    expect(src).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
    expect(src).toContain("lane_no_send_before_final_guard");

    const mainLaneIdx = src.indexOf('logKey: "inbound_relationship_lane_no_send"');
    expect(mainLaneIdx).toBeGreaterThan(0);
    const mainLaneBlock = src.slice(mainLaneIdx - 800, mainLaneIdx + 200);
    expect(mainLaneBlock).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");

    const oqIdx = src.indexOf('logKey: "open_question_inbound_relationship_lane_no_send"');
    expect(oqIdx).toBeGreaterThan(0);
    const oqBlock = src.slice(oqIdx - 800, oqIdx + 200);
    expect(oqBlock).toContain("cancelInboundV3LaneNoSendWithExplicitOutcomePersist");
  });

  it("open-question path runs final body guards", () => {
    expect(src).toContain("const finalGuardsOq = await applyInboundCoachFinalBodyGuards");
  });

  it("central pivot and arc paths run final body guards", () => {
    expect(src).toContain("const finalGuardsPivot = await applyInboundCoachFinalBodyGuards");
    expect(src).toContain("const finalGuardsArc = await applyInboundCoachFinalBodyGuards");
  });

  it("legacy fallback path runs final body guards before reply_ready and send", () => {
    const idx = src.indexOf("const finalGuardsLegacy = await applyInboundCoachFinalBodyGuards");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 4500);
    expect(block).toContain("legacyFinalBody");
    expect(block).toContain('status: "reply_ready"');
  });

  it("conversation brain control defers when TU is authoritative", () => {
    expect(src).toContain("isInboundTurnUnderstandingContextAuthoritative(inboundTurnUnderstandingCtx)");
    expect(src).toContain("brain_gate_skipped_turn_understanding_authoritative");
  });
});
