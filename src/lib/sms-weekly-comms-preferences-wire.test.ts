import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

describe("weekly-sms — comms preferences wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("loads prefs before weekly reservation", () => {
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const v2 = src.slice(v2Start, legacyStart);
    expect(v2).toContain("fetchV2UserSmsCommsPreferences");
    expect(v2).toContain("shouldSkipWeeklyForCommsPrefs");
    const loadIdx = v2.indexOf("fetchV2UserSmsCommsPreferences");
    const insertIdx = v2.indexOf('.from("sms_weekly_send_events")');
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(loadIdx);
  });

  it("pause skip before sms_weekly_send_events insert", () => {
    expect(src).toContain("skippedV2WeeklyUserPause");
  });

  it("weekly projection writer unchanged", () => {
    expect(src).toContain("buildV2WeeklyProofPack");
    expect(src).toContain("buildWeeklyV3OutboundFactsForV2WeeklyProof");
  });

  it("compliance footer unchanged", () => {
    expect(src).toContain("WEEKLY_SMS_COMPLIANCE_FOOTER");
    expect(src).toContain("Reply STOP to opt out");
  });
});
