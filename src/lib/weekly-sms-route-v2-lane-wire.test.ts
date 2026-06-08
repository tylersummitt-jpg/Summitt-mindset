import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";

const REPO = path.join(__dirname, "..", "..");

describe("weekly-sms V2 proof branch — Phase 4.2B wire (static + NS)", () => {
  it("route imports and calls produceWeeklyV3RelationshipSms for V2 weekly proof path", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("produceWeeklyV3RelationshipSms");
    expect(src).toContain("buildWeeklyV3OutboundFactsForV2WeeklyProof");
    expect(src).toContain('replySource: "v3_weekly_relationship_lane"');
  });

  it("V2 weekly branch does not call overlay or pending resolution mutations", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const v2 = src.slice(v2Start, legacyStart);
    expect(v2).not.toMatch(/setPendingResolution\s*\(/);
    expect(v2).not.toMatch(/insertSmsPlannedInterruptionMemorySignal/);
    expect(v2).not.toMatch(/contractProposalMode/);
    expect(v2).toContain("buildWeeklyV3OutboundFactsForV2WeeklyProof");
  });

  it("V2 weekly branch loads planned interruption before weekly facts build", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const v2 = src.slice(v2Start, legacyStart);
    expect(v2).toContain("loadRecentPlannedInterruptionSignalForCommitment");
    expect(v2).toContain("plannedInterruption: plannedInterruptionRow");
    const loadIdx = v2.indexOf("loadRecentPlannedInterruptionSignalForCommitment");
    const factsIdx = v2.indexOf("buildWeeklyV3OutboundFactsForV2WeeklyProof");
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(factsIdx).toBeGreaterThan(loadIdx);
  });

  it("weekly-sms route does not use refineMachineSmsBodyWithV3RefineLane (Phase 4.2C legacy deprecated)", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).not.toContain("refineMachineSmsBodyWithV3RefineLane");
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    expect(v2Start).toBeGreaterThanOrEqual(0);
    expect(legacyStart).toBeGreaterThan(v2Start);
    const v2Slice = src.slice(v2Start, legacyStart);
    expect(v2Slice).not.toContain("PAT_PAUSE_INTROS");
    expect(v2Slice).not.toContain("weekly_pat_pause");
  });

  it("V2 weekly proof segment passes weekly lane body to North Star (not precomposed Pat Pause + proof)", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toMatch(/proposedBody:\s*weeklyLane\.body\.trim\(\)/);
    expect(src).not.toMatch(/preGateWeeklyV2/);
  });

  it("North Star OpenAI full finalizer is skipped for v3_weekly_relationship_lane on weekly_sms (telemetry)", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Lane body from weekly V3 relationship lane.",
      channel: "weekly_sms",
      replySource: "v3_weekly_relationship_lane",
      contextPacket: { source: "weekly_sms", effectiveAskText: "Morning hour" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("sms_weekly_send_events insert + duplicate skip patterns unchanged in route source", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain('.from("sms_weekly_send_events")');
    expect(src).toContain('status: "reserved"');
    expect(src).toContain("skippedV2WeeklyDuplicate");
  });
});

describe("weekly-sms V2 branch — durable thread memory projection wire", () => {
  function v2WeeklySlice(src: string): string {
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    expect(v2Start).toBeGreaterThanOrEqual(0);
    expect(legacyStart).toBeGreaterThan(v2Start);
    return src.slice(v2Start, legacyStart);
  }

  it("imports upsert and defines writeV2SmsThreadMemoryAfterWeeklyV3Outbound", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("upsertCommitmentSmsThreadMemoryFromOutbound");
    expect(src).toContain("writeV2SmsThreadMemoryAfterWeeklyV3Outbound");
    expect(src).toContain('source: "weekly_sms"');
  });

  it("calls projection helper after sendSMS with guardedWeeklyBody (not finalBodyV2)", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2 = v2WeeklySlice(src);
    const sendIdx = v2.indexOf("await sendSMS(");
    const memIdx = v2.indexOf("writeV2SmsThreadMemoryAfterWeeklyV3Outbound");
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(sendIdx);
    expect(v2).toMatch(/coachBodyForMemory:\s*guardedWeeklyBody/);
    expect(v2).not.toMatch(/coachBodyForMemory:\s*finalBodyV2/);
  });

  it("still appends compliance footer to finalBodyV2 for Twilio send after unified guard", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2 = v2WeeklySlice(src);
    expect(v2).toContain("appendPreservedSmsSuffix(guardedWeeklyBody, WEEKLY_SMS_COMPLIANCE_FOOTER)");
    expect(v2).toMatch(/body:\s*finalBodyV2/);
    expect(v2).toContain('mode: "outbound_weekly"');
  });

  it("records thread memory projection metadata on successful send update", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2 = v2WeeklySlice(src);
    expect(v2).toContain("thread_memory_projection_written: mem.ok");
    expect(v2).toContain("thread_memory_projection_error: mem.ok ? null : mem.error");
    expect(v2).toContain('thread_memory_projection_source: "weekly_sms"');
    expect(v2).toContain("stripped_compliance_footer: true");
  });

  it("projection helper is warn-only and not used on no-send, dry-run, or failed send paths", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2 = v2WeeklySlice(src);

    const laneNoSendStart = v2.indexOf("if (!weeklyLane.shouldSend)");
    const laneNoSendEnd = v2.indexOf("const gatedWeeklyV2");
    expect(laneNoSendStart).toBeGreaterThanOrEqual(0);
    expect(laneNoSendEnd).toBeGreaterThan(laneNoSendStart);
    expect(v2.slice(laneNoSendStart, laneNoSendEnd)).not.toContain(
      "writeV2SmsThreadMemoryAfterWeeklyV3Outbound"
    );

    const fvgNoSendStart = v2.indexOf("if (!voiceWeeklyV2.shouldSend)");
    const fvgNoSendEnd = v2.indexOf("const finalBodyV2");
    expect(fvgNoSendStart).toBeGreaterThanOrEqual(0);
    expect(fvgNoSendEnd).toBeGreaterThan(fvgNoSendStart);
    expect(v2.slice(fvgNoSendStart, fvgNoSendEnd)).not.toContain(
      "writeV2SmsThreadMemoryAfterWeeklyV3Outbound"
    );

    const dryRunStart = v2.indexOf("if (!isTwilioReady() || SMS_DRY_RUN)");
    const sendTryStart = v2.indexOf("const messageV2 = await sendSMS");
    expect(dryRunStart).toBeGreaterThanOrEqual(0);
    expect(sendTryStart).toBeGreaterThan(dryRunStart);
    expect(v2.slice(dryRunStart, sendTryStart)).not.toContain(
      "writeV2SmsThreadMemoryAfterWeeklyV3Outbound"
    );

    const catchStart = v2.indexOf('status: "send_failed"');
    expect(catchStart).toBeGreaterThanOrEqual(0);
    expect(v2.slice(catchStart)).not.toContain("writeV2SmsThreadMemoryAfterWeeklyV3Outbound");

    const fullSrc = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(fullSrc).toContain("v2_sms_thread_memory_outbound_upsert_failed");
    const helperStart = fullSrc.indexOf("async function writeV2SmsThreadMemoryAfterWeeklyV3Outbound");
    const helperEnd = fullSrc.indexOf("export async function GET");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(fullSrc.slice(helperStart, helperEnd)).not.toMatch(/\bthrow\b/);
  });

  it("legacy deprecated branch does not call projection helper", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const legacy = src.slice(legacyStart);
    expect(legacy).not.toContain("writeV2SmsThreadMemoryAfterWeeklyV3Outbound");
    expect(legacy).not.toContain('source: "weekly_sms"');
  });

  it("duplicate reservation skip path does not call projection helper", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2 = v2WeeklySlice(src);
    const dupStart = v2.indexOf("if (v2ResErr)");
    const dupEnd = v2.indexOf("const pack = await buildV2WeeklyProofPack");
    expect(dupStart).toBeGreaterThanOrEqual(0);
    expect(dupEnd).toBeGreaterThan(dupStart);
    expect(v2.slice(dupStart, dupEnd)).not.toContain("writeV2SmsThreadMemoryAfterWeeklyV3Outbound");
  });
});
