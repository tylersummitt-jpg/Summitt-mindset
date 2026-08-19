import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();

function liveGenerateSrc() {
  const src = readFileSync(join(REPO, "src/lib/tyler-text-overview-weekly-generate.ts"), "utf8");
  return src.slice(src.indexOf("export async function generateTylerTextOverviewWeeklyDraftForUser"));
}

describe("weekly TTO Sol W1 wire", () => {
  it("live generate is exactly packet → interpreter → writer → block-only → persist", () => {
    const live = liveGenerateSrc();
    expect(live).toContain("loadWeeklyRelationshipPacket");
    expect(live).toContain("runWeeklyBriefInterpreterV1");
    expect(live).toContain("writeWeeklyTtoBody");
    expect(live).toContain("evaluateWeeklySolBlockOnlyBody");
    expect(live).toContain("persistMorningTtoGeneration");
    expect(live.indexOf("runWeeklyBriefInterpreterV1")).toBeLessThan(live.indexOf("writeWeeklyTtoBody"));
    expect(live.indexOf("writeWeeklyTtoBody")).toBeLessThan(live.indexOf("evaluateWeeklySolBlockOnlyBody"));
  });

  it("does not call old proof AI, V3 weekly lane, FVG repair, or anti-repeat repair", () => {
    const live = liveGenerateSrc();
    for (const forbidden of [
      "generateV2WeeklyProofSmsBody",
      "buildDeterministicWeeklyProofBody",
      "buildV2WeeklyProofPack",
      "produceWeeklyV3RelationshipSms",
      "buildWeeklyV3OutboundFactsForV2WeeklyProof",
      "buildSmsRelationshipMemoryPacket",
      "buildV2SmsConversationContextPack",
      "repairV3RelationshipLaneBodyWithOpenAI",
      "applyFinalVoiceOwnershipGate",
      "finalizeNorthStarCoachSmsAsync",
      "detectSmsMemoryRepeatViolation",
      "gpt-4o-mini",
    ]) {
      expect(live).not.toContain(forbidden);
    }
  });

  it("does not keep a fallback writer, shadow mode, feature flag, or third semantic call", () => {
    const live = liveGenerateSrc();
    expect(live).not.toContain("FEATURE_");
    expect(live).not.toMatch(/shadow/i);
    expect(live).not.toContain("writeMorningTtoBody");
    expect(live).not.toContain("produceWeeklyV3");
    expect(live).toContain('coaching_stack: "shared_sol_v1"');
    expect(live).toContain("weekly_v3_lane_used: false");
    expect(live).toContain("currentDraftProtected ? false : true");
    expect(live).toContain('currentDraftProtected ? "current_draft_protected" : null');
  });

  it("interpreter and writer modules are gpt-5.6-sol with no temperature on the OpenAI create call", () => {
    const interpreter = readFileSync(join(REPO, "src/lib/weekly-tto-brief-interpreter.ts"), "utf8");
    const writer = readFileSync(join(REPO, "src/lib/weekly-tto-writer.ts"), "utf8");
    expect(interpreter).toContain("WEEKLY_BRIEF_INTERPRETER_MODEL = MORNING_BRIEF_INTERPRETER_MODEL");
    expect(interpreter).toContain("MORNING_BRIEF_INTERPRETER_MODEL");
    expect(writer).toContain('WEEKLY_TTO_WRITER_MODEL = "gpt-5.6-sol"');
    const interpreterSol = interpreter.indexOf("const solCreate");
    const writerSol = writer.indexOf("const solCreate");
    const interpreterCreate = interpreter.slice(
      interpreterSol,
      interpreter.indexOf("try {", interpreterSol)
    );
    const writerCreate = writer.slice(writerSol, writer.indexOf("try {", writerSol));
    expect(interpreterCreate).not.toContain("temperature");
    expect(writerCreate).not.toContain("temperature");
    expect(interpreter).toContain("reasoning_effort");
    expect(writer).toContain("reasoning_effort");
    expect(writer).toContain('"should_send" in rec');
    expect(interpreter).toContain("MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT");
  });

  it("send, footer, inbound Sol, and Morning/Evening writers are not edited by live generate", () => {
    const live = liveGenerateSrc();
    expect(live).not.toContain("WEEKLY_TTO_COMPLIANCE_FOOTER");
    expect(live).not.toContain("appendPreservedSmsSuffix");
    expect(live).not.toContain("sms_weekly_send_events");
    expect(live).not.toContain("runInboundSolRelationshipTurn");
    expect(live).not.toContain("writeMorningTtoBody");
  });
});
