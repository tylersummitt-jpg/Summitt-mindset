import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

describe("SMS No-Why cleanup — life_desires removed from runtime", () => {
  it("daily-sms route no longer selects life_desires in buildDailySmsContent", () => {
    const src = readSrc("src/app/api/cron/daily-sms/route.ts");
    const fnStart = src.indexOf("async function buildDailySmsContent");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnBody = src.slice(fnStart, fnStart + 120_000);
    expect(fnBody).not.toMatch(/life_desires/);
    expect(fnBody).not.toMatch(/\blifeDesires\b/);
  });

  it("sms-inbound-coach main profile query omits life_desires", () => {
    const src = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");
    const inboundProfile = src.match(
      /const \{ data: inboundProfileRow \}[\s\S]*?\.maybeSingle\(\);/
    )?.[0];
    expect(inboundProfile).toBeDefined();
    expect(inboundProfile).not.toMatch(/life_desires/);
  });

  it("sms-inbound-coach blocker profile query omits life_desires", () => {
    const src = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");
    const blockerProfile = src.match(
      /const \{ data: blockerProfileRow \}[\s\S]*?\.maybeSingle\(\);/
    )?.[0];
    expect(blockerProfile).toBeDefined();
    expect(blockerProfile).not.toMatch(/life_desires/);
  });

  it("sms-inbound-coach does not pass non-null lifeDesires to buildInboundNorthStarContextPacket", () => {
    const src = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");
    expect(src).not.toMatch(/lifeDesires:\s*blocker/);
    expect(src).not.toMatch(/lifeDesires,\s*\n/);
    expect(src).not.toMatch(/lifeDesires:\s*lifeDesires/);
    const nsCalls = src.match(/buildInboundNorthStarContextPacket\(\{[\s\S]*?\}\);/g) ?? [];
    expect(nsCalls.length).toBeGreaterThan(0);
    for (const call of nsCalls) {
      if (call.includes("lifeDesires")) {
        expect(call).toMatch(/lifeDesires:\s*null/);
      }
    }
  });

  it("shadowRelParts no longer includes lifeDesires", () => {
    const src = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");
    expect(src).toContain("const shadowRelParts = [peopleSummary, responsibility]");
    expect(src).not.toMatch(/shadowRelParts\s*=\s*\[lifeDesires/);
  });

  it("sms-relationship-memory-packet SELECT omits life_desires", () => {
    const src = readSrc("src/lib/sms-relationship-memory-packet.ts");
    expect(src).toMatch(/\.select\("preferred_name, people_summary/);
    expect(src).not.toMatch(/life_desires/);
  });

  it("v2-sms-conversation-context profile SELECT omits life_desires", () => {
    const src = readSrc("src/lib/v2-sms-conversation-context.ts");
    const selectBlock = src.match(/from\("user_profiles"\)[\s\S]*?\.maybeSingle\(\)/)?.[0];
    expect(selectBlock).toBeDefined();
    expect(selectBlock).not.toMatch(/life_desires/);
  });

  it("north-star-coach-sms-openai fact pack no longer emits life_desires=", () => {
    const src = readSrc("src/lib/north-star-coach-sms-openai.ts");
    expect(src).not.toMatch(/life_desires=/);
  });

  it("sms-victory-background reads pat principles snapshot read-only without writers or Victory Room view", () => {
    const src = readSrc("src/lib/sms-victory-background-context.ts");
    expect(src).toContain("v2_victory_pat_principles_snapshot");
    expect(src).toContain("living_well_title, living_well_text, living_well_evidence_ids");
    expect(src).not.toContain("loadPatPrinciplesForVictoryRoom");
    expect(src).not.toContain("loadVictoryRoomView");
    expect(src).not.toContain(".upsert(");
    expect(src).not.toContain("v2_commitment_event");
    expect(src).not.toContain("v2_victory_season_summary_snapshot");
    expect(src).not.toContain("input_bundle_json");
    expect(src).not.toContain("source_hash");
  });

  it("SMS cron routes do not reference My Why or purpose field onboarding labels in runtime", () => {
    for (const rel of [
      "src/app/api/cron/daily-sms/route.ts",
      "src/app/api/cron/sms-inbound-coach/route.ts",
      "src/app/api/cron/weekly-sms/route.ts",
    ]) {
      const src = readSrc(rel);
      expect(src).not.toMatch(/My Why/i);
      expect(src).not.toMatch(/needs_why/);
      expect(src).not.toMatch(/purpose_field/);
    }
  });
});
