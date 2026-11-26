import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();

function liveGenerateSrc() {
  const src = readFileSync(join(REPO, "src/lib/tyler-text-overview-weekly-generate.ts"), "utf8");
  return src.slice(src.indexOf("export async function generateTylerTextOverviewWeeklyDraftForUser"));
}

describe("weekly TTO Sol W1 wire", () => {
  it("live generate refuses before the packet, interpreter, writer, or persist", () => {
    const live = liveGenerateSrc();
    expect(live).toContain("weekly_delivery_retired");
    expect(live).not.toContain("loadWeeklyRelationshipPacket");
    expect(live).not.toContain("runWeeklyBriefInterpreterV1");
    expect(live).not.toContain("writeWeeklyTtoBody");
    expect(live).not.toContain("evaluateWeeklySolBlockOnlyBody");
    expect(live).not.toContain("persistMorningTtoGeneration");
    expect(live).not.toContain("sendSMS");
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
    expect(live).not.toContain('coaching_stack: "shared_sol_v1"');
    expect(live).not.toContain("weekly_v3_lane_used");
    expect(live).not.toContain("currentDraftProtected");
    expect(live).toContain("weekly_delivery_retired");
  });

  it("interpreter and writer modules are gpt-5.6-sol with no temperature on the OpenAI create call", () => {
    const interpreter = readFileSync(join(REPO, "src/lib/weekly-tto-brief-interpreter.ts"), "utf8");
    const writer = readFileSync(join(REPO, "src/lib/weekly-tto-writer.ts"), "utf8");
    expect(interpreter).toContain(
      "WEEKLY_BRIEF_INTERPRETER_MODEL = MORNING_BRIEF_INTERPRETER_MODEL"
    );
    const morning = readFileSync(join(REPO, "src/lib/morning-tto-brief-interpreter-v1.ts"), "utf8");
    expect(morning).toContain('MORNING_BRIEF_INTERPRETER_MODEL = "gpt-5.6-sol"');
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
