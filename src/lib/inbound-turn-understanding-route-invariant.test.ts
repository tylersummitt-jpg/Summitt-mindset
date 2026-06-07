import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

describe("inbound turn understanding route invariants", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("every tryPersist passes turnUnderstandingContext", () => {
    const calls = [...src.matchAll(/tryPersistInboundAccountabilityOutcomeBeforeSend\(\{[\s\S]*?\}\);/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const m of calls) {
      expect(m[0]).toContain("turnUnderstandingContext:");
    }
  });

  it("main path runs unified final product-law guard before persisting reply body", () => {
    const idx = src.indexOf("const finalGuardsMain = await applyUnifiedSmsFinalProductLawGuard");
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

  it("G: open-question path uses applyUnifiedSmsFinalProductLawGuard", () => {
    expect(src).toContain("const finalGuardsOq = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toContain("const finalGuardsOq = await applyInboundCoachFinalBodyGuards");
  });

  it("H/I/J/K: central pivot, arc, legacy fallback use unified guard", () => {
    expect(src).toContain("const finalGuardsPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const finalGuardsArc = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toMatch(/const finalGuardsPivot = await applyInboundCoachFinalBodyGuards/);
    expect(src).not.toMatch(/const finalGuardsArc = await applyInboundCoachFinalBodyGuards/);
    expect(src).not.toMatch(/const finalGuardsLegacy = await applyInboundCoachFinalBodyGuards/);
  });

  it("legacy fallback path runs unified guard before reply_ready and send", () => {
    const idx = src.indexOf("const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 4500);
    expect(block).toContain("legacyFinalBody");
    expect(block).toContain('status: "reply_ready"');
  });

  it("L: PR 2.1b-pr2a wires memory confirmation via opt-in helper guard only", () => {
    const helperBlock = src.slice(
      src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend"),
      src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend") + 12000
    );
    expect(helperBlock).toContain("if (args.unifiedFinalGuard)");
    expect(helperBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(helperBlock).toContain('mode: "transactional_coaching_limited"');

    expect(src).toContain('memoryConfirmationBranch: "ambiguous"');
    expect(src).toContain('memoryConfirmationBranch: "decline"');
    expect(src).toContain('memoryConfirmationBranch: "yes"');

    expect(src).toContain("const unifiedGuardBlockerAck = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const unifiedGuardBlockerPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).not.toContain("const nearDupAckGuard = await applyRapidNearDuplicateCoachReplyGuard");
    expect(src).not.toContain("applyRapidNearDuplicateCoachReplyGuard");
  });

  it("M: daily and weekly routes are NOT wired to unified guard in PR 2.1b", () => {
    expect(src).not.toContain('surface: "daily"');
    expect(src).not.toContain('surface: "weekly"');
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const weeklySrc = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    expect(dailySrc).not.toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(weeklySrc).not.toContain("applyUnifiedSmsFinalProductLawGuard");
  });

  it("conversation brain control defers when TU is authoritative", () => {
    expect(src).toContain("isInboundTurnUnderstandingContextAuthoritative(inboundTurnUnderstandingCtx)");
    expect(src).toContain("brain_gate_skipped_turn_understanding_authoritative");
  });
});
