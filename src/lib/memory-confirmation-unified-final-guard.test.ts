/**
 * PR 2.1b-pr2a — memory confirmation opt-in unified final guard wiring + no-send truth policy.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUnifiedSmsFinalProductLawGuard,
  TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED,
} from "@/lib/sms-final-product-law-guard";
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
  type OutcomeClaimEvidenceBundle,
} from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

const nearDupMock = vi.fn();
const truthGuardMock = vi.fn();

vi.mock("@/lib/inbound-near-duplicate-reply-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-near-duplicate-reply-policy")>();
  return {
    ...actual,
    applyRapidNearDuplicateCoachReplyGuard: (...args: unknown[]) => nearDupMock(...args),
  };
});

vi.mock("@/lib/inbound-final-body-truth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-final-body-truth-guard")>();
  return {
    ...actual,
    applyInboundFinalBodyTruthGuard: (...args: unknown[]) => truthGuardMock(...args),
  };
});

const PASS_NEAR_DUP = {
  body: "",
  shouldSend: true,
  noSendReason: null,
  metadata: {},
};

const PASS_TRUTH = {
  body: "",
  shouldSend: true,
  noSendReason: null,
  metadata: {},
};

function memoryTransactionalEvidence(): OutcomeClaimEvidenceBundle {
  return {
    rawInbound: "yes",
    latestOpenQuestion: "Should I remember that?",
    expectedReplySemantics: null,
    openQuestionPending: false,
    shortAnswerContext: null,
    inboundMeaning: null,
    turnUnderstandingReconciled: null,
    persistedOutcomeThisTurn: null,
    willPersistOutcomeThisTurn: false,
    missAdjustmentPolicy: null,
    finalEventType: null,
    priorCoachBody: "Should I remember that?",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

function transactionalArgs(body: string) {
  return {
    body,
    evidence: memoryTransactionalEvidence(),
    priorCoachBody: "Should I remember that?",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
    inboundRaw: "yes",
    routePurpose: "memory_confirmation",
  };
}

describe("PR 2.1b-pr2a memory confirmation unified guard — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const memoryFnStart = src.indexOf("async function processV2MemoryConfirmationInbound");
  const memoryBlock = src.slice(memoryFnStart, memoryFnStart + 12000);
  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(
    pendingFnStart,
    src.indexOf("async function processV2CoachingRefreshInbound")
  );
  const laneGuardBlock = src.slice(
    src.indexOf("type InboundLaneUnifiedFinalGuardConfig"),
    src.indexOf("async function processV2MemoryConfirmationInbound")
  );

  const helperStart = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
  const helperBlock = src.slice(helperStart, helperStart + 12000);

  it("1: memory_confirmation yes helper call uses unified guard opt-in", () => {
    expect(memoryBlock).toContain('routePurpose: "memory_confirmation"');
    expect(memoryBlock).toContain("unifiedFinalGuard:");
    expect(memoryBlock).toContain('branch: "yes"');
    expect(memoryBlock).toContain("memoryNoSendTruthPolicy:");
  });

  it("2: memory_decline helper call uses unified guard opt-in", () => {
    expect(memoryBlock).toContain('routePurpose: "memory_decline"');
    expect(memoryBlock).toContain('branch: "decline"');
    expect(memoryBlock).toContain("memoryNoSendTruthPolicy:");
  });

  it("3: memory_clarification helper call uses unified guard opt-in", () => {
    expect(memoryBlock).toContain('routePurpose: "memory_clarification"');
    expect(memoryBlock).toContain('branch: "ambiguous"');
    expect(memoryBlock).toContain("memoryNoSendTruthPolicy:");
  });

  it("4: refresh helper calls do NOT pass unifiedFinalGuard", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    expect(refreshIdx).toBeGreaterThan(0);
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
    expect(refreshBlock).not.toContain("unifiedFinalGuard");
  });

  it("5: pending resolution helper call passes unifiedFinalGuard opt-in (Phase 2.1c)", () => {
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
  });

  it("6: helper applies guard only when unifiedFinalGuard is provided", () => {
    expect(helperBlock).toContain("if (args.unifiedFinalGuard)");
    expect(helperBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(helperBlock).toContain('mode: "transactional_coaching_limited"');
  });

  it("pr2b: lane no-send calls shared memory truth policy when configured", () => {
    expect(laneGuardBlock).toContain("runMemoryConfirmationNoSendTruthPolicyIfConfigured");
    expect(laneGuardBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
    expect(laneGuardBlock).toContain('noSendStage: "lane"');
    const laneIdx = helperBlock.indexOf("_inbound_lane_no_send");
    expect(laneIdx).toBeGreaterThan(0);
    const laneBlock = helperBlock.slice(laneIdx - 800, laneIdx + 200);
    expect(laneBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("pr2b: FVG no-send calls shared memory truth policy when configured", () => {
    expect(laneGuardBlock).toContain('noSendStage: "final_voice_gate"');
    const fvgIdx = helperBlock.indexOf("_final_voice_suppressed");
    expect(fvgIdx).toBeGreaterThan(0);
    const fvgBlock = helperBlock.slice(fvgIdx - 800, fvgIdx + 200);
    expect(fvgBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("pr2b: unified guard no-send uses shared helper not inline onNoSendTruthPersist", () => {
    expect(helperBlock).not.toContain("onNoSendTruthPersist");
    expect(laneGuardBlock).toContain('noSendStage: "unified_final_guard"');
    expect(laneGuardBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("21: refresh callers unchanged — no unifiedFinalGuard on persistRefreshSmsLaneAndSend", () => {
    expect(refreshBlockNotWired(src)).toBe(true);
  });

  it("22: pending resolution passes unifiedFinalGuard opt-in (Phase 2.1c)", () => {
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
  });

  it("23: helper not broad-wired — guard is opt-in parameter only", () => {
    expect(helperBlock).toMatch(/unifiedFinalGuard\?: InboundLaneUnifiedFinalGuardConfig/);
  });

  it("24: PR 2.1a five full paths still use normal_coaching_full", () => {
    for (const call of [
      "const finalGuardsMain = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsOq = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsPivot = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsArc = await applyUnifiedSmsFinalProductLawGuard",
      "const finalGuardsLegacy = await applyUnifiedSmsFinalProductLawGuard",
    ]) {
      const idx = src.indexOf(call);
      expect(idx).toBeGreaterThan(0);
      expect(src.slice(idx, idx + 300)).toContain('mode: "normal_coaching_full"');
    }
  });

  it("25: PR 2.1b blocker ack/pivot unchanged", () => {
    expect(src).toContain("const unifiedGuardBlockerAck = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("const unifiedGuardBlockerPivot = await applyUnifiedSmsFinalProductLawGuard");
    expect(src).toContain("blocker_ack_no_send_truth_persisted: true");
  });

  it("decline no-send persists resolution with visible_sent=false", () => {
    expect(src).toContain("persistMemoryConfirmationTruthOnNoSend");
    const memSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-memory-confirmation-sms.ts"),
      "utf8"
    );
    expect(memSrc).toContain('outcome: "declined"');
    expect(memSrc).toContain("memory_update_applied_before_sms: false");
  });

  it("yes no-send persists resolution + recompute when applied", () => {
    const memSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-memory-confirmation-sms.ts"),
      "utf8"
    );
    expect(memSrc).toContain('outcome: "confirmed"');
    expect(memSrc).toContain("recomputeV2CoachingMemory");
    expect(memSrc).toContain("memory_update_applied_before_sms: anyApplied");
  });

  it("ambiguous no-send does not insert resolution event", () => {
    const memSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-memory-confirmation-sms.ts"),
      "utf8"
    );
    const ambIdx = memSrc.indexOf('if (args.branch === "ambiguous")');
    expect(ambIdx).toBeGreaterThan(0);
    const ambBlock = memSrc.slice(ambIdx, ambIdx + 120);
    expect(ambBlock).toContain("return baseTelemetry");
    expect(ambBlock).not.toContain("insertWave11MemoryResolutionEvent");
  });

  it("idempotency key unchanged on resolution insert", () => {
    const memSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-memory-confirmation-sms.ts"),
      "utf8"
    );
    expect(memSrc).toContain("v2_wave11_memory_resolution:${args.inboundMessageSid}");
  });
});

function refreshBlockNotWired(src: string): boolean {
  const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
  const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
  return !refreshBlock.includes("unifiedFinalGuard");
}

describe("PR 2.1b-pr2a memory confirmation — guard behavior (transactional_coaching_limited)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nearDupMock.mockResolvedValue({ ...PASS_NEAR_DUP, body: "" });
    truthGuardMock.mockResolvedValue({ ...PASS_TRUTH, body: "" });
  });

  it("7: memory_confirmation yes + valid ack sends", async () => {
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Got it. I'll remember that going forward." });
    truthGuardMock.mockResolvedValueOnce({ ...PASS_TRUTH, body: "Got it. I'll remember that going forward." });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "memory_confirmation",
      branchName: "wave11_memory_confirmed",
      transactionalCoachingLimited: transactionalArgs("Got it. I'll remember that going forward."),
    });

    expect(r.should_send).toBe(true);
    expect(r.body).toBe("Got it. I'll remember that going forward.");
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("8: memory_confirmation yes + fake completion candidate OCEG no-sends", async () => {
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Great job completing your goal today!" });
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Great job completing your goal today!"),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("9: memory_confirmation yes + near-duplicate no-sends", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Got it. I'll remember that going forward."),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("10: memory_decline + valid ack sends", async () => {
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Got it — I won't save that." });
    truthGuardMock.mockResolvedValueOnce({ ...PASS_TRUTH, body: "Got it — I won't save that." });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "memory_decline",
      transactionalCoachingLimited: transactionalArgs("Got it — I won't save that."),
    });

    expect(r.should_send).toBe(true);
    expect(r.body).toBe("Got it — I won't save that.");
  });

  it("16: legitimate remember ack allowed", async () => {
    const body = "Got it. I'll remember that going forward.";
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body });
    truthGuardMock.mockResolvedValueOnce({ ...PASS_TRUTH, body });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(body),
    });

    expect(r.should_send).toBe(true);
  });

  it("17: legitimate decline allowed", async () => {
    const body = "Got it — I won't save that. We'll keep the current context.";
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body });
    truthGuardMock.mockResolvedValueOnce({ ...PASS_TRUTH, body });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs(body),
    });

    expect(r.should_send).toBe(true);
  });

  it("18: clarification question allowed", async () => {
    const body = "Should I remember that going forward, or leave the current profile as-is?";
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body });
    truthGuardMock.mockResolvedValueOnce({ ...PASS_TRUTH, body });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "memory_clarification",
      transactionalCoachingLimited: transactionalArgs(body),
    });

    expect(r.should_send).toBe(true);
  });

  it("19: fake completion blocked", async () => {
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Great job completing your goal!" });
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Great job completing your goal!"),
    });

    expect(r.should_send).toBe(false);
  });

  it("20: fake Victory/proof claim blocked", async () => {
    nearDupMock.mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Victory! You hit your goal today." });
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      transactionalCoachingLimited: transactionalArgs("Victory! You hit your goal today."),
    });

    expect(r.should_send).toBe(false);
  });
});
