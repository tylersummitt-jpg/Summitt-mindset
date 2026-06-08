import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND,
  OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND,
  buildDailyOutboundOcegEvidence,
  buildDailyOutboundUnifiedGuardCtx,
  detectDailyOutboundUnsupportedProofClaim,
  isOutboundDailyC1RoutePurpose,
} from "@/lib/daily-outbound-final-guard-evidence";
import {
  OUTBOUND_DAILY_C1_CHECKS_SKIPPED,
  SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
} from "@/lib/sms-final-product-law-guard";
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
  detectUnsupportedAccountabilityClaimInOutbound,
} from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";

vi.mock("@/lib/inbound-final-body-truth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-final-body-truth-guard")>();
  return {
    ...actual,
    applyInboundFinalBodyTruthGuard: vi.fn(),
  };
});

vi.mock("@/lib/inbound-near-duplicate-reply-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-near-duplicate-reply-policy")>();
  return {
    ...actual,
    applyRapidNearDuplicateCoachReplyGuard: vi.fn(),
  };
});

import { applyInboundFinalBodyTruthGuard } from "@/lib/inbound-final-body-truth-guard";
import { applyRapidNearDuplicateCoachReplyGuard } from "@/lib/inbound-near-duplicate-reply-policy";

const nearDupMock = vi.mocked(applyRapidNearDuplicateCoachReplyGuard);
const truthGuardMock = vi.mocked(applyInboundFinalBodyTruthGuard);

const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const INBOUND_ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

const PASS_NEAR_DUP = {
  body: "Did you get your workout in today?",
  shouldSend: true,
  noSendReason: null,
  detection: {
    is_near_duplicate: false,
    reason: "not_duplicate" as const,
    within_recency_window: false,
    short_ack_inbound: false,
  },
  metadata: { rapid_near_duplicate_guard_ran: true },
};

const PASS_TRUTH = {
  body: "Did you get your workout in today?",
  shouldSend: true,
  noSendReason: null,
  metadata: { unsupported_accountability_claim_guard_ran: true },
};

function c1GuardArgs(body = "Did you get your workout in today?", routePurpose = "main_active_accountability") {
  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: routePurpose as "main_active_accountability" | "low_pressure_reactivation",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    priorCoachBody: "Did you hit your workout yesterday?",
    priorOutcome: null,
    pendingPlanProof: null,
    proofOrMilestoneSignal: null,
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose,
    branchName: routePurpose,
    preGuardBodyPreview: body,
    outboundDaily: {
      body,
      evidence: buildDailyOutboundOcegEvidence(ctx),
      dailyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose,
    },
  };
}

describe("Phase 2.3-C1 outbound_daily unified guard", () => {
  beforeEach(() => {
    nearDupMock.mockReset();
    truthGuardMock.mockReset();
    nearDupMock.mockImplementation(async (args) => ({
      ...PASS_NEAR_DUP,
      body: args.body,
    }));
    truthGuardMock.mockImplementation(async (args) => ({
      ...PASS_TRUTH,
      body: args.body,
    }));
  });

  it("1: outbound_daily mode no longer throws for C1 body", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c1GuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_daily");
  });

  it("2: valid normal daily accountability body passes", async () => {
    const body = "Quick check — did you follow through on today's bar?";
    const r = await applyUnifiedSmsFinalProductLawGuard(c1GuardArgs(body));
    expect(r.should_send).toBe(true);
    expect(r.body).toBe(body);
  });

  it("3: valid low-pressure reactivation body passes", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("Good to see you back. Want a light check-in this week?", "low_pressure_reactivation")
    );
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_daily");
  });

  it("4: fake completion claim blocks when no evidence", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: { unsupported_accountability_claim_violation_detected: true },
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("Great to hear you completed your workout today!")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("5: fake miss claim blocks when no evidence", async () => {
    const violation = detectUnsupportedAccountabilityClaimInOutbound(
      "Since you missed yesterday, let's reset.",
      buildDailyOutboundOcegEvidence(
        buildDailyOutboundUnifiedGuardCtx({
          routeKind: "main_active_accountability",
          clerkUserId: "u",
          commitmentId: "c",
          priorOutcome: null,
        })
      )
    );
    expect(violation?.kind).toBe("miss");
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("Since you missed yesterday, let's reset.")
    );
    expect(r.should_send).toBe(false);
  });

  it("6: fake Victory / proof claim blocks", async () => {
    const ctx = buildDailyOutboundUnifiedGuardCtx({
      routeKind: "main_active_accountability",
      clerkUserId: "u",
      commitmentId: "c",
      priorOutcome: null,
    });
    expect(
      detectDailyOutboundUnsupportedProofClaim("That's proof for your Victory Room streak.", ctx)?.violation
    ).toBeTruthy();
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("That's proof for your Victory Room streak.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND);
  });

  it("7: visible internal label blocks if FVG missed it", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("Reply user_yes or user_no when you are ready.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND);
  });

  it("8: near-duplicate prior outbound body blocks", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      body: "",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(c1GuardArgs("Same check as yesterday?"));
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
    expect(truthGuardMock).not.toHaveBeenCalled();
  });

  it("9: post-repair OCEG / near-duplicate recheck still prevents unsafe body", async () => {
    nearDupMock
      .mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Did you get it done today?" })
      .mockResolvedValueOnce({
        ...PASS_NEAR_DUP,
        shouldSend: false,
        noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        body: "",
      });
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "You nailed it today — great work getting it done.",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("You nailed it today — great work getting it done.")
    );
    expect(r.should_send).toBe(false);
    expect(r.checks_run).toContain("near_duplicate_post_oceg_recheck");
  });

  it("10: non-C1 route kind not activated", async () => {
    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        ...c1GuardArgs(),
        routePurpose: "contract_prompt",
        outboundDaily: {
          ...c1GuardArgs().outboundDaily!,
          routePurpose: "contract_prompt",
        },
      })
    ).rejects.toThrow(/not activated for route/);
    expect(isOutboundDailyC1RoutePurpose("contract_prompt")).toBe(false);
    expect(isOutboundDailyC1RoutePurpose("main_active_accountability")).toBe(true);
  });

  it("metadata includes C1 skipped checks and version", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c1GuardArgs());
    expect(r.metadata.unified_final_guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.checks_skipped).toEqual(OUTBOUND_DAILY_C1_CHECKS_SKIPPED);
    expect(r.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
  });
});

describe("Phase 2.3-C1 daily route wiring invariants", () => {
  const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
  const inboundSrc = fs.readFileSync(INBOUND_ROUTE, "utf8");
  const weeklySrc = fs.readFileSync(WEEKLY_ROUTE, "utf8");
  const northStarFnStart = dailySrc.indexOf("async function withNorthStarDailyGate");
  const northStarFnEnd = dailySrc.indexOf("function dailySmsSentEventVoiceMetadata");
  const northStarBlock = dailySrc.slice(northStarFnStart, northStarFnEnd);

  it("11: main_active_accountability calls outbound_daily guard before Twilio", () => {
    expect(dailySrc).toContain('mode: "outbound_daily"');
    expect(dailySrc).toContain("isOutboundDailyC1RoutePurpose(built.dailyUnifiedGuardCtx.routeKind)");
    const twilioIdx = dailySrc.indexOf("await sendSMS({");
    const guardIdx = dailySrc.indexOf('mode: "outbound_daily"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(twilioIdx);
  });

  it("12: low_pressure_reactivation supplies dailyUnifiedGuardCtx", () => {
    expect(dailySrc).toContain('routeKind: "low_pressure_reactivation"');
    expect(dailySrc).toContain("dailyUnifiedGuardCtx:");
  });

  it("13: contract_prompt does NOT set dailyUnifiedGuardCtx in main return", () => {
    const assignIdx = dailySrc.indexOf(
      'dailyUnifiedGuardCtx:\n        routeKind === "main_active_accountability"'
    );
    expect(assignIdx).toBeGreaterThan(-1);
    const slice = dailySrc.slice(assignIdx, assignIdx + 600);
    expect(slice).not.toContain("contract_prompt");
    expect(slice).not.toContain("pending_resolution");
  });

  it("14: pending_resolution branch does not set dailyUnifiedGuardCtx", () => {
    const pendingIdx = dailySrc.indexOf('route_kind: "pending_resolution"');
    const pendingReturn = dailySrc.slice(pendingIdx, pendingIdx + 3500);
    expect(pendingReturn).not.toContain("dailyUnifiedGuardCtx");
  });

  it("15: refresh_identity / refresh_commitment do not set dailyUnifiedGuardCtx", () => {
    const refreshIdx = dailySrc.indexOf('route_kind: "refresh_identity"');
    const refreshSlice = dailySrc.slice(refreshIdx, refreshIdx + 8000);
    expect(refreshSlice).not.toContain("dailyUnifiedGuardCtx");
  });

  it("16: weekly route untouched", () => {
    expect(weeklySrc).not.toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(weeklySrc).not.toContain("outbound_daily");
  });

  it("17: inbound route untouched by C1", () => {
    expect(inboundSrc).not.toContain('mode: "outbound_daily"');
    expect(inboundSrc).not.toContain("dailyUnifiedGuardCtx");
  });

  it("18: unified guard body becomes smsBody", () => {
    expect(northStarBlock).toContain("finalReplyBody = unifiedGuard.body");
    expect(northStarBlock).toContain("smsBody: finalShouldSend ? finalReplyBody : \"\"");
  });

  it("19: no body mutation after unified guard before return", () => {
    const guardIdx = northStarBlock.indexOf('mode: "outbound_daily"');
    const returnIdx = northStarBlock.indexOf("return out", guardIdx);
    const afterGuard = northStarBlock.slice(guardIdx, returnIdx);
    expect(afterGuard).toContain("finalReplyBody = unifiedGuard.body");
    expect(afterGuard).not.toContain("applyFinalVoiceOwnershipGate");
    expect(afterGuard).not.toContain("applyDailyStaleAskGuard");
    expect(afterGuard).not.toContain("finalizeNorthStarCoachSmsAsync");
  });

  it("20: unified guard no-send metadata includes visible_sent=false", () => {
    expect(northStarBlock).toContain("visible_sent: false");
    expect(northStarBlock).toContain("twilio_send_attempted: false");
    expect(dailySrc).toContain("unified_final_guard_no_send");
  });

  it("21: C1 successful send metadata gated on unifiedGuardTelemetry", () => {
    const successBranchIdx = northStarBlock.indexOf("finalShouldSend\n        ? {");
    expect(successBranchIdx).toBeGreaterThan(-1);
    const successBranch = northStarBlock.slice(successBranchIdx, successBranchIdx + 450);
    expect(successBranch).toContain("unifiedGuardTelemetry");
    expect(successBranch).toContain("final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY");
    expect(successBranch).toContain("sent_body_equals_guard_body: true");
    expect(successBranch).toContain("unified_final_product_law_guard: unifiedGuardTelemetry");
    // Authority fields must not be set unconditionally on success.
    expect(successBranch).not.toMatch(
      /finalShouldSend\s*\?\s*\{\s*final_body_authority:\s*UNIFIED_FINAL_BODY_AUTHORITY/
    );
  });

  it("21b: C1 main_active_accountability success path sets ctx for guard telemetry", () => {
    expect(dailySrc).toContain('routeKind === "main_active_accountability"');
    expect(dailySrc).toContain("dailyUnifiedGuardCtx:");
    expect(northStarBlock).toContain("built.dailyUnifiedGuardCtx");
  });

  it("21c: C1 low_pressure_reactivation success path sets ctx for guard telemetry", () => {
    const reactivationCtxIdx = dailySrc.indexOf(
      'dailyUnifiedGuardCtx: buildDailyOutboundUnifiedGuardCtx({\n          routeKind: "low_pressure_reactivation"'
    );
    expect(reactivationCtxIdx).toBeGreaterThan(-1);
  });

  it("21d: C1 unified-guard no-send metadata includes authority and visible_sent=false", () => {
    const noSendBranchIdx = northStarBlock.indexOf(": {\n            visible_sent: false");
    expect(noSendBranchIdx).toBeGreaterThan(-1);
    const noSendBranch = northStarBlock.slice(noSendBranchIdx, noSendBranchIdx + 500);
    expect(noSendBranch).toContain("twilio_send_attempted: false");
    expect(noSendBranch).toContain("unifiedGuardTelemetry");
    expect(noSendBranch).toContain("final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY");
    expect(noSendBranch).toContain("no_send_reason: unifiedGuardNoSendReason");
  });

  it("21e: contract_prompt success does NOT unconditionally claim unified guard authority", () => {
    const mainCtxIdx = dailySrc.indexOf(
      'dailyUnifiedGuardCtx:\n        routeKind === "main_active_accountability"'
    );
    expect(mainCtxIdx).toBeGreaterThan(-1);
    const mainCtxSlice = dailySrc.slice(mainCtxIdx, mainCtxIdx + 400);
    expect(mainCtxSlice).toContain(": null");
    const successBranch = northStarBlock.slice(
      northStarBlock.indexOf("finalShouldSend\n        ? {"),
      northStarBlock.indexOf("finalShouldSend\n        ? {") + 450
    );
    expect(successBranch).toContain("unifiedGuardTelemetry");
    expect(successBranch).not.toMatch(
      /finalShouldSend\s*\?\s*\{\s*final_body_authority:\s*UNIFIED_FINAL_BODY_AUTHORITY/
    );
  });

  it("21f: pending_resolution branch does not set dailyUnifiedGuardCtx", () => {
    const pendingIdx = dailySrc.indexOf('route_kind: "pending_resolution"');
    const pendingReturn = dailySrc.slice(pendingIdx, pendingIdx + 3500);
    expect(pendingReturn).not.toContain("dailyUnifiedGuardCtx");
  });

  it("21g: refresh_identity / refresh_commitment do not set dailyUnifiedGuardCtx", () => {
    const refreshIdx = dailySrc.indexOf('route_kind: "refresh_identity"');
    const refreshSlice = dailySrc.slice(refreshIdx, refreshIdx + 8000);
    expect(refreshSlice).not.toContain("dailyUnifiedGuardCtx");
  });

  it("21h: non-C1 success does not set sent_body_equals_guard_body without unifiedGuardTelemetry", () => {
    const successBranch = northStarBlock.slice(
      northStarBlock.indexOf("finalShouldSend\n        ? {"),
      northStarBlock.indexOf("finalShouldSend\n        ? {") + 450
    );
    expect(successBranch).toContain("unifiedGuardTelemetry");
    expect(successBranch).not.toContain("sent_body_equals_guard_body: true,\n          }");
    expect(successBranch).not.toMatch(
      /\?\s*\{\s*sent_body_equals_guard_body:\s*true/
    );
  });

  it("21i: C1 body/send chain unchanged", () => {
    expect(northStarBlock).toContain("finalReplyBody = unifiedGuard.body");
    expect(northStarBlock).toContain("smsBody: finalShouldSend ? finalReplyBody : \"\"");
    const guardIdx = dailySrc.indexOf('mode: "outbound_daily"');
    const twilioIdx = dailySrc.indexOf("await sendSMS({");
    expect(guardIdx).toBeLessThan(twilioIdx);
  });

  it("21j: non-C1 body/send chain unchanged — smsBody still from withNorthStarDailyGate only", () => {
    expect(dailySrc).toContain("await withNorthStarDailyGate(builtMainRaw");
    expect(dailySrc).toContain("const smsBody = builtMain.smsBody");
    expect(dailySrc).not.toMatch(/contract_prompt[\s\S]{0,200}applyUnifiedSmsFinalProductLawGuard/);
  });

  it("22: existing daily stale ask guard remains present", () => {
    expect(dailySrc).toContain("applyDailyStaleAskGuard");
    expect(dailySrc).toContain("daily_post_final_voice_gate");
  });

  it("23: existing FVG remains present", () => {
    expect(dailySrc).toContain("applyFinalVoiceOwnershipGate");
    expect(northStarBlock.indexOf("applyFinalVoiceOwnershipGate")).toBeLessThan(
      northStarBlock.indexOf('mode: "outbound_daily"')
    );
  });

  it("24: existing lane validators remain (produceDailyV3RelationshipSms)", () => {
    expect(dailySrc).toContain("produceDailyV3RelationshipSms");
  });

  it("25: no Twilio/send internals changed in daily route", () => {
    expect(dailySrc).toContain("await sendSMS({");
    expect(dailySrc).not.toMatch(/async function sendSMS/);
  });

  it("26: no persistence enum changes in C1 guard slice", () => {
    const guardSlice = dailySrc.slice(
      dailySrc.indexOf("dailyUnifiedGuardCtx"),
      dailySrc.indexOf("dailyUnifiedGuardCtx") + 2500
    );
    expect(guardSlice).not.toMatch(/event_type:\s*"/);
  });

  it("27: no hard-coded SMS in C1 guard wiring", () => {
    expect(northStarBlock).not.toContain('smsBody: "');
    expect(northStarBlock).not.toContain('reply_body: "');
  });
});
