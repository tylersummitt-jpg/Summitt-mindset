import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

function v2WeeklySlice(src: string): string {
  const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
  const legacyStart = src.indexOf("await generateWeeklySmsReflection");
  expect(v2Start).toBeGreaterThanOrEqual(0);
  expect(legacyStart).toBeGreaterThan(v2Start);
  return src.slice(v2Start, legacyStart);
}

function twilioSuccessSlice(v2: string): string {
  const sendIdx = v2.indexOf("const messageV2 = await sendSMS");
  const catchIdx = v2.indexOf('status: "send_failed"', sendIdx);
  expect(sendIdx).toBeGreaterThanOrEqual(0);
  expect(catchIdx).toBeGreaterThan(sendIdx);
  return v2.slice(sendIdx, catchIdx);
}

describe("weekly-sms Twilio success sms_weekly_send_events metadata", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");
  const v2 = v2WeeklySlice(src);
  const success = twilioSuccessSlice(v2);

  it("metadata.sent_at uses shared server instant after Twilio success", () => {
    expect(success).toMatch(/const sentAt = new Date\(\)/);
    expect(success).toMatch(/const sentAtIso = sentAt\.toISOString\(\)/);
    expect(success).toMatch(/sent_at:\s*sentAtIso/);
    expect(success).not.toMatch(/sent_at:\s*localNow/);
  });

  it("uses the same sentAt for thread memory projection and metadata.sent_at", () => {
    expect(success).toMatch(/sentAt,\s*\n\s*\}\);[\s\S]*sent_at:\s*sentAtIso/);
    expect(success).toMatch(/writeV2SmsThreadMemoryAfterWeeklyV3Outbound\([\s\S]*sentAt,/);
  });

  it("preserves metadata.sms_body on success path", () => {
    expect(success).toContain("sms_body: finalBodyV2");
  });

  it("preserves weekly notebook verdict wiring via enrichWeeklyPersistenceMetadata", () => {
    expect(src).toContain("function enrichWeeklyPersistenceMetadata");
    expect(src).toContain("attachWeeklyNotebookVerdictToMetadata");
    expect(src).toMatch(
      /function enrichWeeklyPersistenceMetadata[\s\S]*return attachWeeklyNotebookVerdictToMetadata/
    );
    expect(success).toContain("enrichWeeklyPersistenceMetadata(v2Metadata");
  });

  it("preserves relationship_packet_observability before success update", () => {
    expect(v2).toContain("v2Metadata.relationship_packet_observability =");
    expect(v2).toContain("relationshipObservabilityFromLaneMetadata");
    const obsIdx = v2.indexOf("v2Metadata.relationship_packet_observability =");
    const sendIdx = v2.indexOf("const messageV2 = await sendSMS");
    expect(obsIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThan(obsIdx);
  });

  it("keeps message_sid and status update on success path", () => {
    expect(success).toMatch(/message_sid:\s*messageV2\.sid/);
    expect(success).toMatch(/status:\s*messageV2\.status/);
  });

  it("does not alter Twilio sendSMS call surface", () => {
    expect(success).not.toMatch(/sendSMS\([^)]*sent_at/);
  });

  it("does not write sent_at on lane no-send path", () => {
    const laneNoSendStart = v2.indexOf("if (!weeklyLane.shouldSend)");
    const laneNoSendEnd = v2.indexOf("const gatedWeeklyV2");
    expect(laneNoSendStart).toBeGreaterThanOrEqual(0);
    expect(laneNoSendEnd).toBeGreaterThan(laneNoSendStart);
    expect(v2.slice(laneNoSendStart, laneNoSendEnd)).not.toMatch(/sent_at:/);
  });

  it("does not write sent_at on final voice gate no-send path", () => {
    const fvgNoSendStart = v2.indexOf("if (!voiceWeeklyV2.shouldSend)");
    const fvgNoSendEnd = v2.indexOf("const finalBodyV2");
    expect(fvgNoSendStart).toBeGreaterThanOrEqual(0);
    expect(fvgNoSendEnd).toBeGreaterThan(fvgNoSendStart);
    expect(v2.slice(fvgNoSendStart, fvgNoSendEnd)).not.toMatch(/sent_at:/);
  });

  it("does not write sent_at on unified guard no-send path", () => {
    const guardNoSendStart = v2.indexOf("if (!unifiedGuard.shouldSend)");
    const guardNoSendEnd = v2.indexOf("const guardedWeeklyBody");
    expect(guardNoSendStart).toBeGreaterThanOrEqual(0);
    expect(guardNoSendEnd).toBeGreaterThan(guardNoSendStart);
    expect(v2.slice(guardNoSendStart, guardNoSendEnd)).not.toMatch(/sent_at:/);
  });

  it("does not write sent_at on dry-run or missing Twilio path", () => {
    const dryRunStart = v2.indexOf("if (!isTwilioReady() || SMS_DRY_RUN)");
    const sendTryStart = v2.indexOf("const messageV2 = await sendSMS");
    expect(dryRunStart).toBeGreaterThanOrEqual(0);
    expect(sendTryStart).toBeGreaterThan(dryRunStart);
    expect(v2.slice(dryRunStart, sendTryStart)).not.toMatch(/sent_at:/);
  });

  it("does not write sent_at on send_failed path", () => {
    const catchStart = v2.indexOf('status: "send_failed"');
    expect(catchStart).toBeGreaterThanOrEqual(0);
    expect(v2.slice(catchStart)).not.toMatch(/sent_at:/);
  });
});
