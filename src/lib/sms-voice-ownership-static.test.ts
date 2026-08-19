/**
 * SMS Voice Ownership — Slice 1 static architecture locks (tests only).
 * No runtime behavior changes. See audit: V3 lane + NS validation + FVG for relationship SMS.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PRODUCTION_SMS_SEND_CALLER_ALLOWLIST } from "./phase4-sms-send-surface-governance.test";
import {
  FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND,
  RELATIONSHIP_SMS_ROUTE_FILES,
  SMS_VOICE_OWNERSHIP_ALLOWED_DETERMINISTIC,
} from "./sms-voice-ownership-static-policy";

const REPO_ROOT = process.cwd();

const LEGACY_TEMPLATE_BODY_BUILDERS = [
  "buildV2OutboundAccountabilitySmsForStrategy",
  "buildV2InboundReplySms",
  "buildDeterministicWeeklyProofBody",
  "OUTBOUND_TEMPLATES",
] as const;

function readSrc(relPath: string): string {
  const abs = path.join(REPO_ROOT, relPath);
  expect(fs.existsSync(abs), `missing source file: ${relPath}`).toBe(true);
  return fs.readFileSync(abs, "utf8");
}

/** Extract rough `sendSMS` / `sendSMSChunked` call argument blocks for static body-source checks. */
function extractSendCallBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /(?:sendSMS|sendSMSChunked)\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    blocks.push(src.slice(start, i - 1));
  }
  return blocks;
}

function assertNoForbiddenBuilderInSendBlocks(
  src: string,
  routeLabel: string,
  extraForbidden: string[] = []
): void {
  const forbidden = [...LEGACY_TEMPLATE_BODY_BUILDERS, ...extraForbidden];
  const blocks = extractSendCallBlocks(src);
  expect(blocks.length, `${routeLabel}: expected at least one sendSMS/sendSMSChunked call`).toBeGreaterThan(0);
  for (const block of blocks) {
    for (const name of forbidden) {
      expect(
        block.includes(name),
        `${routeLabel}: send call must not use ${name} as Twilio body source`
      ).toBe(false);
    }
  }
}

describe("SMS Voice Ownership — static policy", () => {
  it("documents allowed deterministic surfaces (no temporary Victory append after Slice 2)", () => {
    expect(Object.keys(SMS_VOICE_OWNERSHIP_ALLOWED_DETERMINISTIC).length).toBeGreaterThanOrEqual(6);
    expect(FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND).toContain(
      "applyVictoryCalloutAfterSpineInsert"
    );
  });

  it("relationship routes are on the Phase 4 production sendSMS allowlist", () => {
    for (const f of RELATIONSHIP_SMS_ROUTE_FILES) {
      expect(PRODUCTION_SMS_SEND_CALLER_ALLOWLIST.has(f), `${f} must be in PRODUCTION_SMS_SEND_CALLER_ALLOWLIST`).toBe(
        true
      );
    }
  });
});

describe("SMS Voice Ownership — daily-sms route", () => {
  const daily = readSrc("src/app/api/cron/daily-sms/route.ts");
  const morningBookkeeping = readSrc("src/lib/morning-tto-post-send-bookkeeping.ts");

  it("Morning send uses exact TTO body path without the deleted Daily SMS hallway", () => {
    expect(daily).toContain("attemptMorningTtoTwilioSend");
    expect(daily).toContain("resolveMorningTtoExactBodyImmediatelyBeforeTwilio");
    expect(daily).toContain("runMorningTtoPostSendBookkeeping");
    expect(daily).toContain("runMorningTtoPreSendCanonicalStateMaintenance");
    expect(daily).not.toContain("buildDailySmsContent");
    expect(daily).not.toContain("prepareTylerTextOverviewDailyBuild");
    expect(daily).not.toContain("produceDailyV3RelationshipSms");
    expect(daily).not.toContain("applyFinalVoiceOwnershipGate");
    expect(daily).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(daily).not.toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(daily).not.toContain("resolveSilenceCadenceForDailyUser");
  });

  it("does not send legacy template builder output as Twilio body", () => {
    assertNoForbiddenBuilderInSendBlocks(daily, "daily-sms");
    expect(daily).not.toMatch(/sendSMS[\s\S]{0,600}?body:\s*strat\w*\.body/);
  });

  it("Morning post-send bookkeeping has no OpenAI or coaching-memory recompute", () => {
    expect(morningBookkeeping).not.toContain("recomputeV2CoachingMemory");
    expect(morningBookkeeping).not.toMatch(/from ["']openai["']/);
    expect(morningBookkeeping).not.toContain("OpenAI");
    expect(morningBookkeeping).not.toContain("onV2StandardCheckSentOutboundSendSuccess");
    expect(morningBookkeeping).not.toContain("yes_no_partial");
  });

  it("does not import legacy daily outbound resolution as final send path", () => {
    expect(daily).not.toContain("tryGenerateV2OutboundMessage");
    expect(daily).not.toContain("buildV2HumanDailyFallbackSms");
    expect(daily).not.toContain("resolveV2DailyOutbound");
  });
});

describe("SMS Voice Ownership — sms-inbound-coach route", () => {
  const inbound = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");

  it("uses V3 inbound relationship lane on normal coaching path", () => {
    expect(inbound).toContain("produceInboundV3RelationshipSms");
    expect(inbound).toContain("inboundRelationshipLane = laneRes");
    expect(inbound).toContain(
      "Active-commitment coaching must use `produceInboundV3RelationshipSms` above."
    );
  });

  it("gates relationship replies with FVG before persist/send (no post-FVG deterministic proof append)", () => {
    expect(inbound).toContain("applyFinalVoiceOwnershipGate");
    expect(inbound).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
    expect(inbound).toMatch(/northStarGatePersistBodyAsync/);
    expect(inbound).toMatch(/normalCoaching:\s*true/);
    for (const forbidden of FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND) {
      expect(inbound).not.toContain(forbidden);
    }
  });

  it("wires proof callout as V3 facts before produceInboundV3RelationshipSms", () => {
    expect(inbound).toContain("buildInboundProofCalloutHint");
    expect(inbound).toContain("proofCalloutHint");
    const hintIdx = inbound.indexOf("buildInboundProofCalloutHint");
    const factsIdx = inbound.indexOf("proofCalloutHint,");
    const laneIdx = inbound.indexOf("const laneRes = await produceInboundV3RelationshipSms");
    expect(hintIdx).toBeGreaterThan(0);
    expect(factsIdx).toBeGreaterThan(hintIdx);
    expect(laneIdx).toBeGreaterThan(factsIdx);
  });

  it("does not send legacy inbound template builders as Twilio body", () => {
    assertNoForbiddenBuilderInSendBlocks(inbound, "sms-inbound-coach", [
      "resolveV2InboundCoachReplyBody",
    ]);
    expect(inbound).toMatch(/buildV2InboundReplySms_deterministic_template_preview_only/);
  });

  it("uses pattern, goal adjustment, and planned interruption as facts helpers only", () => {
    expect(inbound).toContain("deriveSmsPatternSignal");
    expect(inbound).toContain("deriveSmsGoalAdjustmentSignal");
    expect(inbound).toContain("detectSmsPlannedInterruption");
    expect(inbound).not.toMatch(/sendSMS[\s\S]{0,400}?body:[\s\S]{0,120}gentleUserLine/);
    expect(inbound).not.toMatch(/sendSMS[\s\S]{0,400}?body:[\s\S]{0,120}GENTLE_LINES/);
  });

  it("patches spine with hint telemetry only after insert — not victory_room_callout_sent from append", () => {
    expect(inbound).toContain("proof_callout_hint_offered_to_model");
    expect(inbound).not.toMatch(/victory_room_callout_sent:\s*true/);
  });
});

describe("SMS Voice Ownership — weekly-sms route", () => {
  const weekly = readSrc("src/app/api/cron/weekly-sms/route.ts");
  const weeklySend = readSrc("src/lib/tyler-text-overview-weekly-send.ts");
  const weeklyLength = readSrc("src/lib/weekly-tto-length.ts");

  it("is Weekly TTO draft-authoritative (no live V3 lane / FVG in cron)", () => {
    expect(weekly).toContain("weekly-sms is Weekly TTO draft-authoritative");
    expect(weekly).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(weekly).toContain("sendWeeklyTtoDraftAuthoritative");
    expect(weekly).not.toContain("produceWeeklyV3RelationshipSms");
    expect(weekly).not.toContain("applyFinalVoiceOwnershipGate");
    expect(weekly).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(weekly).not.toContain("buildV2WeeklyProofPack");
  });

  it("does not live-build or send deterministic weekly preview bodies from cron", () => {
    expect(weekly).not.toContain("generateV2WeeklyProofSmsBody");
    expect(weekly).not.toContain("buildDeterministicWeeklyProofBody");
    expect(weekly).not.toMatch(/\bsendSMS\s*\(/);
  });

  it("footer + thread memory stay in shared send core (pre-footer memory)", () => {
    expect(weeklySend).toContain("WEEKLY_TTO_COMPLIANCE_FOOTER");
    expect(weeklySend).toContain("buildWeeklyTtoFinalBodyWithFooter");
    expect(weeklyLength).toContain("appendPreservedSmsSuffix");
    expect(weeklySend).toContain('source: "weekly_sms"');
    expect(weeklySend).toContain("sentBody: bodyWithoutFooter");
    expect(weeklySend).toContain("stripped_compliance_footer: true");
  });
});

describe("SMS Voice Ownership — legacy template libraries (must not become send surfaces)", () => {
  it("v2-sms-accountability templates are not referenced as sendSMS body in relationship routes", () => {
    for (const f of RELATIONSHIP_SMS_ROUTE_FILES) {
      const src = readSrc(f);
      expect(src).not.toContain("OUTBOUND_TEMPLATES");
    }
    const accountability = readSrc("src/lib/v2-sms-accountability.ts");
    expect(accountability).toContain("OUTBOUND_TEMPLATES");
  });

  it("v2-ai-outbound legacy fallback exists but daily cron does not call it", () => {
    const outbound = readSrc("src/lib/v2-ai-outbound.ts");
    expect(outbound).toContain("buildV2HumanDailyFallbackSms");
    expect(outbound).toContain("tryGenerateV2OutboundMessage");
    const daily = readSrc("src/app/api/cron/daily-sms/route.ts");
    expect(daily).not.toContain("tryGenerateV2OutboundMessage");
  });

  it("v2-weekly-proof-sms deterministic builder remains unused by weekly cron and live generate", () => {
    const lib = readSrc("src/lib/v2-weekly-proof-sms.ts");
    expect(lib).toContain("buildDeterministicWeeklyProofBody");
    const weekly = readSrc("src/app/api/cron/weekly-sms/route.ts");
    expect(weekly).not.toContain("buildDeterministicWeeklyProofBody");
    expect(weekly).not.toContain("deterministicWeeklyBodyPreview");
    const gen = readSrc("src/lib/tyler-text-overview-weekly-generate.ts");
    expect(gen).not.toContain("buildDeterministicWeeklyProofBody");
  });

  it("v2-proof-moment uses V3 hint builder — no deterministic append helper", () => {
    const proof = readSrc("src/lib/v2-proof-moment.ts");
    expect(proof).toContain("buildInboundProofCalloutHint");
    expect(proof).toContain("decideVictoryRoomSmsCalloutEligibility");
    expect(proof).not.toContain("applyVictoryCalloutAfterSpineInsert");
    expect(proof).not.toContain("pickVictoryCalloutLine");
  });
});
