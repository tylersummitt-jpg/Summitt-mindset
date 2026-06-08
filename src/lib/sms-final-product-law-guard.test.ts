import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
  TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
  compactUnifiedFinalGuardForTelemetry,
} from "@/lib/sms-final-product-law-guard";
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
} from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import { emptyInboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";

vi.mock("@/lib/inbound-final-body-truth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-final-body-truth-guard")>();
  return {
    ...actual,
    applyInboundCoachFinalBodyGuards: vi.fn(),
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

import {
  applyInboundCoachFinalBodyGuards,
  applyInboundFinalBodyTruthGuard,
} from "@/lib/inbound-final-body-truth-guard";
import { applyRapidNearDuplicateCoachReplyGuard } from "@/lib/inbound-near-duplicate-reply-policy";

const delegateMock = vi.mocked(applyInboundCoachFinalBodyGuards);
const nearDupMock = vi.mocked(applyRapidNearDuplicateCoachReplyGuard);
const truthGuardMock = vi.mocked(applyInboundFinalBodyTruthGuard);

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");

const BASE_DELEGATE_RESULT = {
  body: "Clean follow-up body.",
  shouldSend: true,
  noSendReason: null,
  tuGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { turn_understanding_final_body_guard_ran: true },
  },
  prematureAdjustmentGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { premature_adjustment_guard_ran: true },
  },
  truthGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { unsupported_accountability_claim_guard_ran: true },
  },
  nearDuplicateGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    detection: {
      is_near_duplicate: false,
      reason: "not_duplicate" as const,
      within_recency_window: false,
      short_ack_inbound: false,
    },
    metadata: { rapid_near_duplicate_guard_ran: true },
  },
};

const PASS_NEAR_DUP = {
  body: "Candidate body.",
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
  body: "Candidate body.",
  shouldSend: true,
  noSendReason: null,
  metadata: { unsupported_accountability_claim_guard_ran: true },
};

function normalCoachingArgs(body = "Candidate body.") {
  return {
    body,
    turnUnderstandingContext: emptyInboundTurnUnderstandingContext(),
    evidence: { rawInbound: "Good" },
    stage: "post_final_voice_gate",
  };
}

function transactionalArgs(body = "Candidate body.") {
  return {
    body,
    evidence: { rawInbound: "blocked" },
    priorCoachBody: "Prior coach text.",
    priorCoachSentAt: new Date().toISOString(),
    inboundRaw: "blocked",
    routePurpose: "blocker_capture_ack",
  };
}

describe("applyUnifiedSmsFinalProductLawGuard", () => {
  beforeEach(() => {
    delegateMock.mockReset();
    nearDupMock.mockReset();
    truthGuardMock.mockReset();
    delegateMock.mockResolvedValue(BASE_DELEGATE_RESULT);
    nearDupMock.mockResolvedValue(PASS_NEAR_DUP);
    truthGuardMock.mockResolvedValue(PASS_TRUTH);
  });

  it("A: normal_coaching_full delegates to applyInboundCoachFinalBodyGuards", async () => {
    const normalCoachingFull = normalCoachingArgs();
    await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull,
    });

    expect(delegateMock).toHaveBeenCalledTimes(1);
    expect(delegateMock).toHaveBeenCalledWith(normalCoachingFull);
  });

  it("B: passing body remains same when delegate reports no violations", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs("Clean follow-up body."),
    });

    expect(r.should_send).toBe(true);
    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe("Clean follow-up body.");
  });

  it("C: no-send result preserves no_send_reason from delegate", async () => {
    delegateMock.mockResolvedValueOnce({
      ...BASE_DELEGATE_RESULT,
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      nearDuplicateGuard: {
        ...BASE_DELEGATE_RESULT.nearDuplicateGuard!,
        body: "",
        shouldSend: false,
        noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        metadata: {
          rapid_near_duplicate_repair_attempted: true,
          rapid_near_duplicate_repair_succeeded: false,
        },
      },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs("Duplicate proposal?"),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
    expect(r.noSendReason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("D: metadata contains guard_version / guard_mode / final_body_authority", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      preGuardBodyPreview: "Before guard",
      normalCoachingFull: normalCoachingArgs("After guard"),
    });

    expect(r.guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.guard_mode).toBe("normal_coaching_full");
    expect(r.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
    expect(r.metadata.unified_final_guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.metadata.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
    expect(r.metadata.pre_unified_guard_body_preview).toBe("Before guard");
    expect(compactUnifiedFinalGuardForTelemetry(r).unified_final_guard_mode).toBe(
      "normal_coaching_full"
    );
  });

  it("E: does not bypass delegate — repair/no-send ordering owned by delegate", async () => {
    delegateMock.mockResolvedValueOnce({
      ...BASE_DELEGATE_RESULT,
      tuGuard: {
        ...BASE_DELEGATE_RESULT.tuGuard,
        metadata: {
          turn_understanding_stale_ask_repair_attempted: true,
          turn_understanding_stale_ask_repair_succeeded: true,
        },
      },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs(),
    });

    expect(delegateMock).toHaveBeenCalledTimes(1);
    expect(r.repair_attempts).toBe(1);
    expect(r.checks_run).toContain("turn_understanding_stale_ask");
    expect(r.guard_results.inbound_coach_final_body_guards).toBeDefined();
  });

  it("F: hard_route_bypass pass-through only and does not call delegate", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "hard_route_bypass",
      surface: "inbound",
      candidateBody: "STOP acknowledged.",
    });

    expect(delegateMock).not.toHaveBeenCalled();
    expect(nearDupMock).not.toHaveBeenCalled();
    expect(r.should_send).toBe(true);
    expect(r.body).toBe("STOP acknowledged.");
    expect(r.checks_run).toEqual([]);
    expect(r.checks_skipped.every((s) => s.reason === "hard_route_bypass")).toBe(true);
  });

  it("1: transactional_coaching_limited runs near-duplicate", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(),
    });

    expect(nearDupMock).toHaveBeenCalled();
    expect(r.checks_run).toContain("near_duplicate");
    expect(r.should_send).toBe(true);
  });

  it("2: transactional_coaching_limited runs OCEG/truth guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(),
    });

    expect(truthGuardMock).toHaveBeenCalled();
    expect(r.checks_run).toContain("unsupported_claim_oceg");
  });

  it("3: transactional_coaching_limited skips TU stale with checks_skipped", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(),
    });

    expect(r.checks_skipped).toEqual(
      expect.arrayContaining([
        { check: "turn_understanding_stale_ask", reason: "no_turn_understanding_context" },
      ])
    );
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
    expect(delegateMock).not.toHaveBeenCalled();
  });

  it("4: transactional_coaching_limited skips premature adjustment with checks_skipped", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(),
    });

    expect(r.checks_skipped).toEqual(
      expect.arrayContaining([
        { check: "premature_adjustment", reason: "no_miss_adjustment_policy" },
      ])
    );
    expect(r.prematureAdjustmentGuard).toBeNull();
  });

  it("5: transactional_coaching_limited preserves near-duplicate no-send reason", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: { rapid_near_duplicate_repair_attempted: true, rapid_near_duplicate_repair_succeeded: false },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Duplicate ack?"),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
    expect(truthGuardMock).not.toHaveBeenCalled();
  });

  it("6: OCEG repair triggers near-duplicate recheck", async () => {
    nearDupMock
      .mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Before OCEG repair." })
      .mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "After OCEG repair." });
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "After OCEG repair.",
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Before OCEG repair."),
    });

    expect(nearDupMock).toHaveBeenCalledTimes(2);
    expect(r.checks_run).toContain("near_duplicate_post_oceg_recheck");
    expect(r.body).toBe("After OCEG repair.");
  });

  it("7: normal_coaching_full behavior remains unchanged", async () => {
    await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs(),
    });

    expect(delegateMock).toHaveBeenCalledTimes(1);
    expect(nearDupMock).not.toHaveBeenCalled();
    expect(truthGuardMock).not.toHaveBeenCalled();
  });

  it("8: unimplemented outbound_daily/outbound_weekly modes still throw", async () => {
    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        mode: "outbound_daily",
        surface: "daily",
        candidateBody: "test",
      })
    ).rejects.toThrow(/not activated in PR 2.1b/);

    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        mode: "outbound_weekly",
        surface: "weekly",
        candidateBody: "test",
      })
    ).rejects.toThrow(/not activated in PR 2.1b/);
  });

  it("transactional OCEG no-send preserves unsupported_accountability_claim reason", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: { unsupported_accountability_claim_repair_attempted: true, unsupported_accountability_claim_repair_succeeded: false },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("You nailed it today."),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("valid transactional body passes through unchanged when guards pass", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      body: "Thanks for sharing that blocker.",
    });
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "Thanks for sharing that blocker.",
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "blocker_capture_ack",
      branchName: "blocker_capture_ack",
      transactionalCoachingLimited: transactionalArgs("Thanks for sharing that blocker."),
    });

    expect(r.should_send).toBe(true);
    expect(r.body).toBe("Thanks for sharing that blocker.");
    expect(r.guard_mode).toBe("transactional_coaching_limited");
    expect(compactUnifiedFinalGuardForTelemetry(r).unified_final_guard_route_purpose).toBe(
      "blocker_capture_ack"
    );
  });
});

describe("PR 2.1b route wiring invariants", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("10: blocker_capture_ack uses applyUnifiedSmsFinalProductLawGuard", () => {
    const idx = src.indexOf("const unifiedGuardBlockerAck = await applyUnifiedSmsFinalProductLawGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 800);
    expect(block).toContain('routePurpose: "blocker_capture_ack"');
    expect(block).toContain('mode: "transactional_coaching_limited"');
  });

  it("11: central_brain_blocker_pivot uses applyUnifiedSmsFinalProductLawGuard", () => {
    const idx = src.indexOf("const unifiedGuardBlockerPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 800);
    expect(block).toContain('routePurpose: "central_brain_blocker_pivot"');
    expect(block).toContain('mode: "transactional_coaching_limited"');
  });

  it("12: blocker ack no longer calls applyRapidNearDuplicateCoachReplyGuard directly", () => {
    expect(src).not.toContain("const nearDupAckGuard = await applyRapidNearDuplicateCoachReplyGuard");
    expect(src).not.toContain("applyRapidNearDuplicateCoachReplyGuard");
  });

  it("13: persistInboundV3RelationshipLaneReplyReadyAndSend uses opt-in unified guard for memory only", () => {
    const helperBlock = src.slice(
      src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend"),
      src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend") + 12000
    );
    expect(helperBlock).toContain("if (args.unifiedFinalGuard)");
    expect(helperBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(helperBlock).toMatch(/unifiedFinalGuard\?: InboundLaneUnifiedFinalGuardConfig/);
  });

  it("14: daily/weekly are still not wired", () => {
    expect(src).not.toContain('surface: "daily"');
    expect(src).not.toContain('surface: "weekly"');
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const weeklySrc = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    expect(dailySrc).not.toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(weeklySrc).not.toContain("applyUnifiedSmsFinalProductLawGuard");
  });

  it("15: contract + adaptive clarify wired via dedicated pipelines; pending uses opt-in helper guard", () => {
    const forbiddenDirectPurposes = [
      "pending_resolution_inbound",
      "commitment_change_handoff",
      "refresh_session_inbound",
    ];
    for (const purpose of forbiddenDirectPurposes) {
      const idx = src.indexOf(`routePurpose: "${purpose}"`);
      if (idx >= 0) {
        const block = src.slice(idx - 300, idx + 600);
        expect(block).not.toContain("applyUnifiedSmsFinalProductLawGuard");
      }
    }
    const contractIdx = src.indexOf("async function runContractConsentNoSendTruthPolicy");
    expect(contractIdx).toBeGreaterThan(0);
    const contractBlock = src.slice(
      contractIdx,
      src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend")
    );
    expect(contractBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(contractBlock).toContain("persistContractConsentTruthOnNoSend");

    const adaptiveIdx = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
    expect(adaptiveIdx).toBeGreaterThan(0);
    const adaptiveBlock = src.slice(
      adaptiveIdx,
      src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend")
    );
    expect(adaptiveBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(adaptiveBlock).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");

    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
    expect(refreshBlock).not.toContain("unifiedFinalGuard");

    const pendingIdx = src.indexOf("async function processV2SmsInboundPendingResolution");
    expect(pendingIdx).toBeGreaterThan(0);
    const pendingBlock = src.slice(
      pendingIdx,
      src.indexOf("async function processV2CoachingRefreshInbound")
    );
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).not.toMatch(
      /processV2SmsInboundPendingResolution[\s\S]{0,3500}applyUnifiedSmsFinalProductLawGuard/
    );
  });

  it("22: no-send includes unified_final_guard metadata and persists blocker truth", () => {
    expect(src).toContain(
      "blockerAckUnifiedGuardTelemetry = compactUnifiedFinalGuardForTelemetry(unifiedGuardBlockerAck)"
    );
    const idx = src.indexOf("blocker_ack_unified_final_guard_blocked");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx - 200, idx + 200);
    expect(block).toContain("blocker_ack_no_send_truth_persisted: true");
    expect(block).not.toMatch(/blocker_ack_unified_final_guard_blocked[\s\S]{0,120}\s*return;/);
    const insertIdx = src.indexOf('event_type: "blocker_captured"', idx);
    expect(insertIdx).toBeGreaterThan(idx);
  });

  it("23: reply_body equals unified guard body on blocker ack send", () => {
    const idx = src.indexOf("gatedAckBody = unifiedGuardBlockerAck.body");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 400);
    expect(block).toContain("reply_body: gatedAckBody");
  });

  it("24: PR 2.1a five full paths still use normal_coaching_full", () => {
    const fullGuardCalls = [
      "const finalGuardsMain = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsOq = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsPivot = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsArc = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard",
    ];
    for (const call of fullGuardCalls) {
      const idx = src.indexOf(call);
      expect(idx).toBeGreaterThan(0);
      const block = src.slice(idx, idx + 300);
      expect(block).toContain('mode: "normal_coaching_full"');
    }
  });

  it("31: no Twilio/send wiring changes in blocker paths", () => {
    const pivotIdx = src.indexOf("commitAndSendInboundRelationshipCoachReply(freshPv, userId, blockerPivotThreadMemoryCtx)");
    expect(pivotIdx).toBeGreaterThan(0);
    const pivotBlock = src.slice(pivotIdx - 2000, pivotIdx + 200);
    expect(pivotBlock).toContain("unifiedGuardBlockerPivot");
    expect(pivotBlock).not.toContain("twilio");
  });

  it("32: proposal ack bypass unaffected", () => {
    expect(src).toContain("shouldBypassBlockerCaptureForProposalAck");
  });
});
