import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");

describe("weekly-sms legacy branch — Phase 4.2C deprecated (no-send)", () => {
  function legacyPathSlice(src: string): string {
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const offsetMarker = src.indexOf("    offset += users.length");
    expect(legacyStart).toBeGreaterThanOrEqual(0);
    expect(offsetMarker).toBeGreaterThan(legacyStart);
    return src.slice(legacyStart, offsetMarker);
  }

  it("legacy path slice does not call sendSMS, NS, FVG, or refine", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const legacy = legacyPathSlice(src);
    expect(legacy).not.toMatch(/\bsendSMS\s*\(/);
    expect(legacy).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(legacy).not.toContain("applyFinalVoiceOwnershipGate");
    expect(legacy).not.toContain("refineMachineSmsBodyWithV3RefineLane");
    expect(legacy).not.toContain("PAT_PAUSE_INTROS");
    expect(legacy).not.toContain("appendPreservedSmsSuffix");
  });

  it("legacy path does not read weekly_sms_reflections or weekly_summaries for send copy", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const legacy = legacyPathSlice(src);
    expect(legacy).not.toContain("weekly_sms_reflections");
    expect(legacy).not.toContain("weekly_summaries");
  });

  it("legacy path updates sms_weekly_send_events with deprecated status and no_send_tag metadata", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const legacy = legacyPathSlice(src);
    expect(legacy).toContain('status: "skipped_legacy_weekly_deprecated"');
    expect(legacy).toContain('no_send_tag: "legacy_weekly_deprecated_until_v2"');
    expect(legacy).toContain("twilio_send_attempted: false");
    expect(legacy).toContain("legacy_weekly_branch: true");
    expect(legacy).toContain("weekly_v3_lane_used: false");
    expect(legacy).toContain("skip_reason: \"user_not_fully_on_v2\"");
    expect(legacy).toContain("relationship_lane_policy:");
  });

  it("V2 weekly proof segment unchanged: lane + v3_weekly_relationship_lane + reservation insert", () => {
    const src = fs.readFileSync(path.join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const v2Slice = src.slice(v2Start, legacyStart);
    expect(v2Slice).toContain("produceWeeklyV3RelationshipSms");
    expect(v2Slice).toContain('replySource: "v3_weekly_relationship_lane"');
    expect(v2Slice).toContain('status: "reserved"');
    expect(v2Slice).toContain("skippedV2WeeklyDuplicate");
  });
});
