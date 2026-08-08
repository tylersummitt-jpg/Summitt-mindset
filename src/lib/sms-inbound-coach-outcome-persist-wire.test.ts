import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

function sliceToCommitSend(
  src: string,
  startMarker: string,
  commitCallSnippet: string
): string {
  const start = src.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const sendIdx = src.indexOf(commitCallSnippet, start);
  expect(sendIdx).toBeGreaterThan(start);
  return src.slice(start, sendIdx + commitCallSnippet.length);
}

describe("sms-inbound-coach — inbound accountability outcome persist (Phase 1)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports shared persist helper and orchestration", () => {
    expect(src).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(src).toContain("@/lib/v2-inbound-accountability-outcome-persist");
    expect(src).toContain("shouldPersistInboundAccountabilityOutcome");
    expect(src).toContain("persistInboundAccountabilityOutcomeEvent");
  });

  it("persists before send on open-question lane with confirmedUserYes Win ensure", () => {
    const blockStart = src.indexOf("if (v3Resolution) {");
    const blockEnd = src.indexOf("open_question_answer_lane_sent");
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = src.slice(blockStart, blockEnd);
    expect(block).toContain('branch: "open_question"');
    expect(block).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(block).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(block).toContain("confirmedUserYes:");
    expect(block).toContain("inboundMessage: userMessage");
    expect(block).toContain("commitAndSendInboundRelationshipCoachReply");
    expect(block.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend")).toBeLessThan(
      block.lastIndexOf("commitAndSendInboundRelationshipCoachReply")
    );
  });

  it("persists before send on central brain pivot lane with confirmedUserYes Win ensure", () => {
    const full = sliceToCommitSend(
      src,
      "const centralBrainPivotThreadMemoryCtx = {",
      "commitAndSendInboundRelationshipCoachReply(freshPivot"
    );
    expect(full).toContain('branch: "central_pivot"');
    expect(full).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(full).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(full).toContain('branch: "central_brain_pivot"');
    expect(full).toContain("confirmedUserYes:");
    expect(full).toContain("inboundMessage: userMessage");
    expect(full.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend")).toBeLessThan(
      full.indexOf("commitAndSendInboundRelationshipCoachReply(freshPivot")
    );
  });

  it("persists before send on arc clarify lane with confirmedUserYes Win ensure", () => {
    const full = sliceToCommitSend(
      src,
      "const arcClarifyLaneExclusion:",
      "commitAndSendInboundRelationshipCoachReply(freshArc"
    );
    expect(full).toContain('branch: "arc_clarify"');
    expect(full).toContain("arcClarifyLaneExclusion");
    expect(full).toContain("isClearAccountabilityCompletionReply(userMessage)");
    expect(full).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(full).toContain("confirmedUserYes:");
    expect(full).toContain("inboundMessage: userMessage");
  });

  it("conversation_brain_legacy_fallback send path wires confirmedUserYes Win ensure", () => {
    const full = sliceToCommitSend(
      src,
      "const legacyOutcomePersist = await persistConversationBrainLegacyDisabledServerOutcome(",
      "commitAndSendInboundRelationshipCoachReply(freshFb"
    );
    expect(full).toContain("legacyConfirmedUserYes");
    expect(full).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(full).toContain('branch: "conversation_brain_legacy_fallback"');
    expect(full).toContain("confirmedUserYes: legacyConfirmedUserYes");
  });

  it("main path uses shared persist helper and confirmedUserYes Win ensure", () => {
    const spineIdx = src.indexOf("// 6) Accountability event spine");
    const sendIdx = src.indexOf("// 7) Job reply");
    expect(spineIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(spineIdx);
    const spineBlock = src.slice(spineIdx, sendIdx);
    expect(spineBlock).toContain("tryPersistInboundAccountabilityOutcomeBeforeSend");
    expect(spineBlock).toContain('branch: "main"');
    expect(spineBlock).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(spineBlock).toContain("confirmedUserYes:");
    expect(spineBlock).toContain("inboundMessage: userMessage");
    expect(spineBlock).not.toContain('from("v2_commitment_event").insert');
  });

  it("no-send explicit outcome path wires confirmedUserYes Win ensure", () => {
    const start = src.indexOf("async function persistExplicitOutcomeBeforeReplyNoSend");
    const next = src.indexOf("\nasync function ", start + 10);
    const fn = src.slice(start, next > start ? next : start + 8000);
    expect(fn).toContain("maybePersistInboundWinRecognitionBundle");
    expect(fn).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(fn).toContain("confirmedUserYes:");
    expect(fn).toContain("inboundMessage: args.userMessage");
  });

  it("logs persist attempts via inbound-outcome-persist helper", () => {
    expect(src).toContain("logInboundOutcomePersistAttempt");
  });
});
