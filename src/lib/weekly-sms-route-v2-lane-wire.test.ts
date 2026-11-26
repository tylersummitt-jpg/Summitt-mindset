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

describe("weekly-sms delivery is retired", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("refuses before generation or provider submission, including force=1", () => {
    expect(src).toContain("weekly_delivery_retired");
    expect(src).toContain("force_ignored");
    expect(src).toContain('searchParams.get("force") === "1"');
    expect(src.indexOf("validateCronSecret")).toBeLessThan(src.indexOf("weekly_delivery_retired"));
    expect(src).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(src).not.toContain("sendSMS");
    expect(src).not.toContain("shouldSendNow");
  });

  it("does not import or call live-build / OpenAI / proof / lane builders", () => {
    for (const forbidden of FORBIDDEN_CRON_LIVE_BUILD) {
      expect(src).not.toContain(forbidden);
    }
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

  it("the retired cron does not reach send-core freshness", () => {
    const routeSrc = fs.readFileSync(ROUTE, "utf8");
    expect(routeSrc).not.toContain("ensureCurrentTtoDraftFreshForSend");
    expect(routeSrc).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(routeSrc).toContain("weekly_delivery_retired");
  });

  it("the shared send function refuses before freshness, reservation, or Twilio", () => {
    const fnStart = sendSrc.indexOf("export async function sendWeeklyTtoDraftAuthoritative");
    const fn = sendSrc.slice(fnStart);
    expect(fn).toContain("weekly_delivery_retired");
    expect(fn).not.toContain("ensureCurrentTtoDraftFreshForSend");
    expect(fn).not.toContain("await sendSMS(");
    expect(fn).not.toContain("weekly_tto_reserve_send");
  });
});

describe("weekly TTO generation uses Sol relationship brain (generation-only)", () => {
  it("weekly generate uses packet → interpreter → writer and does not call old proof/V3 brains", () => {
    const gen = fs.readFileSync(WEEKLY_GENERATE, "utf8");
    const live = gen.slice(gen.indexOf("export async function generateTylerTextOverviewWeeklyDraftForUser"));
    expect(live).toContain("weekly_delivery_retired");
    expect(live).not.toContain("loadWeeklyRelationshipPacket");
    expect(live).not.toContain("runWeeklyBriefInterpreterV1");
    expect(live).not.toContain("writeWeeklyTtoBody");
    expect(live).not.toContain("persistMorningTtoGeneration");
    expect(live).not.toContain("buildV2WeeklyProofPack");
    expect(live).not.toContain("produceWeeklyV3RelationshipSms");
    expect(live).not.toContain("generateV2WeeklyProofSmsBody");
    expect(live).not.toContain("buildDeterministicWeeklyProofBody");
    expect(gen).toContain("does not call an interpreter");
  });
});
