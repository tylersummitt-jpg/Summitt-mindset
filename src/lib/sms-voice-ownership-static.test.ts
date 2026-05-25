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

  it("uses V3 daily relationship lane for coaching SMS", () => {
    expect(daily).toContain("produceDailyV3RelationshipSms");
    expect(daily).toMatch(/smsBody\s*=\s*laneUnified\.body/);
    expect(daily).toMatch(/smsBodyRe\s*=\s*laneRe\.body/);
  });

  it("applies Final Voice Gate on normal coaching sends", () => {
    expect(daily).toContain("applyFinalVoiceOwnershipGate");
    expect(daily).toContain("finalizeNorthStarCoachSmsAsync");
    expect(daily).toMatch(/smsBody:\s*voiceGate\.shouldSend\s*\?\s*voiceGate\.body/);
  });

  it("does not send legacy template builder output as Twilio body", () => {
    assertNoForbiddenBuilderInSendBlocks(daily, "daily-sms");
    expect(daily).not.toMatch(/sendSMS[\s\S]{0,600}?body:\s*strat\w*\.body/);
  });

  it("uses buildV2OutboundAccountabilitySmsForStrategy for telemetry/templateId only", () => {
    expect(daily).toContain("buildV2OutboundAccountabilitySmsForStrategy");
    expect(daily).toContain('telemetryUnified.push("buildV2OutboundAccountabilitySmsForStrategy")');
    expect(daily).toMatch(/templateIdRe\s*=\s*stratRe\.templateId/);
    expect(daily).toMatch(/templateId\s*=\s*strat\.templateId/);
    expect(daily).not.toMatch(/smsBody\s*=\s*strat\.body/);
    expect(daily).not.toMatch(/smsBody\s*=\s*stratRe\.body/);
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

  it("uses V3 weekly relationship lane on V2 proof branch", () => {
    expect(weekly).toContain("produceWeeklyV3RelationshipSms");
    expect(weekly).toContain("weekly_v3_lane_used: true");
  });

  it("applies FVG with normalCoaching: true before send", () => {
    expect(weekly).toContain("applyFinalVoiceOwnershipGate");
    expect(weekly).toContain("finalizeNorthStarCoachSmsAsync");
    expect(weekly).toMatch(/normalCoaching:\s*true/);
    expect(weekly).toContain('fvg_policy_classification: "relationship_coaching"');
  });

  it("does not send deterministic weekly preview bodies via Twilio", () => {
    assertNoForbiddenBuilderInSendBlocks(weekly, "weekly-sms", ["generateV2WeeklyProofSmsBody"]);
    expect(weekly).toMatch(/deterministicPreviewBody\s*=\s*buildDeterministicWeeklyProofBody/);
    expect(weekly).toMatch(/body:\s*finalBodyV2/);
    expect(weekly).not.toMatch(/sendSMS[\s\S]{0,500}?body:\s*deterministicPreviewBody/);
    expect(weekly).not.toMatch(/sendSMS[\s\S]{0,500}?body:\s*oldProofPreviewBody/);
    expect(weekly).not.toMatch(/sendSMS[\s\S]{0,500}?body:\s*weeklyLane\.body/);
  });

  it("appends only compliance footer after FVG; thread memory uses pre-footer body", () => {
    expect(weekly).toContain("WEEKLY_SMS_COMPLIANCE_FOOTER");
    expect(weekly).toMatch(
      /appendPreservedSmsSuffix\(voiceWeeklyV2\.body,\s*WEEKLY_SMS_COMPLIANCE_FOOTER\)/
    );
    expect(weekly).toMatch(/coachBodyForMemory:\s*voiceWeeklyV2\.body/);
    expect(weekly).toContain("stripped_compliance_footer: true");
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

  it("v2-weekly-proof-sms deterministic builder is preview-only in weekly route", () => {
    const lib = readSrc("src/lib/v2-weekly-proof-sms.ts");
    expect(lib).toContain("buildDeterministicWeeklyProofBody");
    const weekly = readSrc("src/app/api/cron/weekly-sms/route.ts");
    expect(weekly).toContain("deterministicWeeklyBodyPreview");
    assertNoForbiddenBuilderInSendBlocks(weekly, "weekly-sms (deterministic preview guard)");
  });

  it("v2-proof-moment uses V3 hint builder — no deterministic append helper", () => {
    const proof = readSrc("src/lib/v2-proof-moment.ts");
    expect(proof).toContain("buildInboundProofCalloutHint");
    expect(proof).toContain("decideVictoryRoomSmsCalloutEligibility");
    expect(proof).not.toContain("applyVictoryCalloutAfterSpineInsert");
    expect(proof).not.toContain("pickVictoryCalloutLine");
  });
});
