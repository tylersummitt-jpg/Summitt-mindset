import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");
const ROUTE = path.join(REPO, "src/app/api/cron/weekly-sms/route.ts");
const SEND = path.join(REPO, "src/lib/tyler-text-overview-weekly-send.ts");
const WEEKLY_GENERATE = path.join(REPO, "src/lib/tyler-text-overview-weekly-generate.ts");

const FORBIDDEN_CRON_LIVE_BUILD = [
  "buildV2WeeklyProofPack",
  "generateV2WeeklyProofSmsBody",
  "buildDeterministicWeeklyProofBody",
  "produceWeeklyV3RelationshipSms",
  "finalizeNorthStarCoachSmsAsync",
  "applyFinalVoiceOwnershipGate",
  "applyUnifiedSmsFinalProductLawGuard",
  "generateWeeklySmsReflection",
  "buildWeeklyV3OutboundFactsForV2WeeklyProof",
  "buildSmsRelationshipMemoryPacket",
  "buildV2SmsConversationContextPack",
  "loadSmsVictoryBackgroundContext",
  "north-star-coach-sms-openai",
  "v3-weekly-outbound-relationship-lane",
  "v2-weekly-proof-sms",
];

describe("weekly-sms is Weekly TTO draft-authoritative (static)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("documents draft-authoritative invariant", () => {
    expect(src).toContain("weekly-sms is Weekly TTO draft-authoritative");
    expect(src).toContain("This route must not live-build weekly SMS bodies");
    expect(src).toContain("tto_draft_authoritative: true");
  });

  it("does not import or call live-build / OpenAI / proof / lane builders", () => {
    for (const forbidden of FORBIDDEN_CRON_LIVE_BUILD) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("uses Weekly TTO cron authority + shared send core", () => {
    expect(src).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(src).toContain("sendWeeklyTtoDraftAuthoritative");
    expect(src).toContain("WEEKLY_TTO_CRON_SEND_SOURCE");
    expect(src).toContain("getWeekKey");
  });

  it("force only bypasses Sunday noon window", () => {
    expect(src).toContain('url.searchParams.get("force") === "1"');
    expect(src).toContain("shouldSendNow");
    expect(src).toMatch(/if\s*\(\s*!force\s*&&\s*!shouldSendNow/);
    // force never skips authority
    expect(src).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
  });

  it("dryRun is side-effect free (no reserve / Twilio / finalize)", () => {
    expect(src).toContain('url.searchParams.get("dryRun") === "1"');
    expect(src).toContain("dryRunWouldSend");
    // dryRun branch must not call shared send core
    const dryStart = src.indexOf("if (dryRun)");
    expect(dryStart).toBeGreaterThanOrEqual(0);
    const dryEnd = src.indexOf("if (!isTwilioReady())", dryStart);
    expect(dryEnd).toBeGreaterThan(dryStart);
    const drySlice = src.slice(dryStart, dryEnd);
    expect(drySlice).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(drySlice).toContain("dryRunWouldSend");
    expect(drySlice).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(drySlice).not.toContain("sendSMS");
    expect(drySlice).not.toContain('from("sms_weekly_send_events")');
  });

  it("does not write sms_send_events or check_sent", () => {
    expect(src).not.toContain('from("sms_send_events")');
    expect(src).not.toContain("onV2StandardCheckSent");
    expect(src).not.toContain("v2_commitment_event");
    expect(src).not.toContain('event_type: "check_sent"');
  });

  it("does not generate Weekly TTO drafts in cron", () => {
    expect(src).not.toContain("generateTylerTextOverviewWeeklyDraft");
    expect(src).not.toContain("tyler-text-overview-weekly-generate");
  });
});

describe("weekly-sms send core still draft-authoritative", () => {
  const sendSrc = fs.readFileSync(SEND, "utf8");

  it("cron send_source is weekly_tto_cron", () => {
    expect(sendSrc).toContain('WEEKLY_TTO_CRON_SEND_SOURCE = "weekly_tto_cron"');
    expect(sendSrc).toContain("sendWeeklyTtoDraftViaCron");
    expect(sendSrc).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
  });

  it("shared core does not live-build", () => {
    for (const forbidden of [
      "buildV2WeeklyProofPack",
      "produceWeeklyV3RelationshipSms",
      "finalizeNorthStarCoachSmsAsync",
    ]) {
      expect(sendSrc).not.toContain(forbidden);
    }
  });
});

describe("weekly TTO generation may still use live builders (generation-only)", () => {
  it("weekly generate still imports proof pack / lane for draft creation", () => {
    const gen = fs.readFileSync(WEEKLY_GENERATE, "utf8");
    expect(gen).toContain("buildV2WeeklyProofPack");
    expect(gen).toContain("produceWeeklyV3RelationshipSms");
    expect(gen).toContain("Never sends SMS");
  });
});
