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
