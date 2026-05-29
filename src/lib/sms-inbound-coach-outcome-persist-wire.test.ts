import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("sms-inbound-coach — inbound accountability outcome persist (Phase 1)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports shared persist helper and orchestration", () => {
    expect(src).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(src).toContain("@/lib/v2-inbound-accountability-outcome-persist");
    expect(src).toContain("shouldPersistInboundAccountabilityOutcome");
    expect(src).toContain("persistInboundAccountabilityOutcomeEvent");
  });

  it("persists before send on open-question lane", () => {
    const blockStart = src.indexOf("if (v3Resolution) {");
    const blockEnd = src.indexOf("open_question_answer_lane_sent");
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = src.slice(blockStart, blockEnd);
    expect(block).toContain('branch: "open_question"');
    expect(block).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend")).toBeLessThan(
      block.lastIndexOf("commitAndSendInboundRelationshipCoachReply")
    );
  });

  it("persists before send on central brain pivot lane", () => {
    const blockStart = src.indexOf("const centralBrainPivotThreadMemoryCtx = {");
    expect(blockStart).toBeGreaterThan(0);
    const block = src.slice(blockStart, blockStart + 1500);
    expect(block).toContain('branch: "central_pivot"');
    expect(block).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend")).toBeLessThan(
      block.lastIndexOf("commitAndSendInboundRelationshipCoachReply")
    );
  });

  it("persists before send on arc clarify lane with arc_clarify_only exclusion", () => {
    expect(src).toContain('branch: "arc_clarify"');
    expect(src).toContain("arcClarifyLaneExclusion");
    expect(src).toContain("isClearAccountabilityCompletionReply(userMessage)");
  });

  it("main path uses shared persist helper instead of inline-only insert gate", () => {
    const spineIdx = src.indexOf("// 6) Accountability event spine");
    const sendIdx = src.indexOf("// 7) Job reply");
    expect(spineIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(spineIdx);
    const spineBlock = src.slice(spineIdx, sendIdx);
    expect(spineBlock).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(spineBlock).toContain('branch: "main"');
    expect(spineBlock).not.toContain('from("v2_commitment_event").insert');
  });

  it("logs persist attempts via inbound-outcome-persist helper", () => {
    expect(src).toContain("logInboundOutcomePersistAttempt");
  });
});
