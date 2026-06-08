/**
 * Phase 2.1f-B1/B2 — refresh identity + commitment unified final guard + no-send truth policy.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  applyUnifiedSmsFinalProductLawGuard,
  TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED,
} from "@/lib/sms-final-product-law-guard";
import type { OutcomeClaimEvidenceBundle } from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import { evaluatePostUnifiedGuardRefreshTruthRecheck } from "@/lib/v2-refresh-post-unified-truth";

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

function refreshEvidence(): OutcomeClaimEvidenceBundle {
  return {
    rawInbound: "STILL",
    latestOpenQuestion: null,
    expectedReplySemantics: null,
    openQuestionPending: false,
    shortAnswerContext: null,
    inboundMeaning: null,
    turnUnderstandingReconciled: null,
    persistedOutcomeThisTurn: null,
    willPersistOutcomeThisTurn: false,
    missAdjustmentPolicy: null,
    finalEventType: null,
    priorCoachBody: "Does this still fit?",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

describe("Phase 2.1f-B1 refresh identity — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const refreshStart = src.indexOf("async function persistRefreshSmsLaneAndSend");
  const refreshEnd = src.indexOf("async function mergeInboundMemoryIntoSmsPendingResolution");
  const refreshBlock = src.slice(refreshStart, refreshEnd);
  const processStart = src.indexOf("async function processV2CoachingRefreshInbound");
  const processEnd = src.indexOf("async function processInboundSmsSafetyShortCircuit");
  const processBlock = src.slice(processStart, processEnd);
  const commitmentStart = processBlock.indexOf('if (session.step === "commitment")');
  const commitmentBlock = processBlock.slice(commitmentStart);
  const identityBlock = processBlock.slice(0, commitmentStart);
  const laneGuardStart = src.indexOf("async function runRefreshNoSendTruthPolicyIfConfigured");
  const laneGuardBlock = src.slice(laneGuardStart, laneGuardStart + 4000);
  const helperStart = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
  const helperBlock = src.slice(helperStart, helperStart + 32000);
  const contractStart = src.indexOf("async function runContractConsentNoSendTruthPolicy");
  const contractEnd = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
  const contractBlock = src.slice(contractStart, contractEnd);
  const handoffStart = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
  const handoffEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
  const handoffBlock = src.slice(handoffStart, handoffEnd);
  const pendingStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(pendingStart, processStart);
  const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
  const memoryBlock = src.slice(memoryStart, pendingStart);

  it("23: identity refresh path calls unified guard before reply_body", () => {
    expect(refreshBlock).toContain("unifiedFinalGuard");
    expect(refreshBlock).toContain("isRefreshIdentityLaneIntent");
    expect(helperBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(helperBlock).toContain("evaluatePostUnifiedGuardRefreshTruthRecheck");
    expect(src).toContain("persistRefreshTruthOnNoSend");
  });

  it("24: identity refresh uses transactional_coaching_limited, not normal_coaching_full", () => {
    expect(refreshBlock).toContain('mode: "transactional_coaching_limited"');
    expect(refreshBlock).not.toContain('mode: "normal_coaching_full"');
  });

  it("25: unified guard body becomes reply_body", () => {
    expect(helperBlock).toContain("gatedBody = unifiedGuard.body");
    expect(helperBlock).toContain("reply_body: gatedBody");
  });

  it("26: lane no-send after identity mutation calls refresh truth policy", () => {
    expect(laneGuardBlock).toContain("runRefreshNoSendTruthPolicyIfConfigured");
    expect(laneGuardBlock).toContain("persistRefreshTruthOnNoSend");
    expect(helperBlock).toContain('noSendStage: "lane"');
    expect(refreshBlock).toContain("refreshNoSendTruthPolicy");
  });

  it("27: FVG no-send after identity mutation calls refresh truth policy", () => {
    expect(helperBlock).toContain('noSendStage: "final_voice_gate"');
    expect(helperBlock).toContain("refresh_no_send_truth");
  });

  it("28: unified guard no-send after identity mutation calls refresh truth policy", () => {
    expect(helperBlock).toContain('noSendStage: noSendStage');
    expect(helperBlock).toContain("post_unified_truth_recheck");
  });

  it("29: post-unified truth failure calls refresh truth policy", () => {
    expect(helperBlock).toContain("refresh_truth_violation_after_final_guard");
    expect(helperBlock).toContain("refreshTruthViolation");
  });

  it("30: recordV2SendTimeProfileInboundEngagement moved post-send for identity still", () => {
    const stillIdx = identityBlock.indexOf('laneIntent: "identity_still_commitment_prompt"');
    expect(stillIdx).toBeGreaterThan(-1);
    const stillSlice = identityBlock.slice(stillIdx, stillIdx + 3500);
    const noSendReturn = stillSlice.indexOf("if (!sendStill.ok)");
    const engagementIdx = stillSlice.indexOf("recordV2SendTimeProfileInboundEngagement", noSendReturn);
    expect(noSendReturn).toBeGreaterThan(-1);
    expect(engagementIdx).toBeGreaterThan(noSendReturn);
    const preSend = stillSlice.slice(0, noSendReturn);
    expect(preSend).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("31: valid identity refresh send still sends", () => {
    expect(helperBlock).toContain("commitAndSendInboundCoachReply");
    expect(refreshBlock).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
  });

  it("32: commitment refresh intents are wired with commitmentTruthContext", () => {
    expect(refreshBlock).toContain("isRefreshCommitmentLaneIntent");
    expect(refreshBlock).toContain("buildRefreshCommitmentNoSendTruthPolicyContext");
    expect(commitmentBlock).toContain("commitmentTruthContext");
    expect(commitmentBlock).not.toContain("identityTruthContext");
    const keepIdx = commitmentBlock.indexOf('laneIntent: "commitment_keep_ack"');
    expect(keepIdx).toBeGreaterThan(-1);
    const keepSlice = commitmentBlock.slice(keepIdx - 400, keepIdx + 600);
    expect(keepSlice).toContain("commitmentTruthContext");
    expect(keepSlice).toContain("commitmentKeep");
  });

  it("33: contract/adaptive/pending/memory/handoff unchanged", () => {
    expect(contractBlock).toContain("trySendContractConsentBodyAfterUnifiedGuard");
    expect(contractBlock).not.toContain("evaluatePostUnifiedGuardRefreshTruthRecheck");
    expect(handoffBlock).toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(handoffBlock).not.toContain("evaluatePostUnifiedGuardRefreshTruthRecheck");
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).not.toContain("refreshNoSendTruthPolicy");
    expect(memoryBlock).toContain("unifiedFinalGuard:");
    expect(memoryBlock).not.toContain("refreshNoSendTruthPolicy");
  });

  it("34: blocker deferral untouched", () => {
    expect(src).toContain("if (deferredBlockerGate)");
    expect(src).toContain('handler: "refresh"');
  });

  it("35: daily/weekly untouched", () => {
    expect(refreshBlock).not.toContain('surface: "daily"');
    expect(refreshBlock).not.toContain('surface: "weekly"');
  });

  it("36: no Twilio/send changes", () => {
    expect(refreshBlock).not.toMatch(/twilio.*send.*mechanic/i);
    expect(src).toContain("commitAndSendInboundCoachReply");
  });

  it("37: no persistence enum changes in refresh block", () => {
    expect(refreshBlock).not.toMatch(/event_type:\s*"/);
  });

  it("38: no hard-coded SMS in refresh lane wiring", () => {
    expect(refreshBlock).not.toContain("reply_body:");
    expect(refreshBlock).not.toContain("twilioClient");
  });

  it("30: recordV2SendTimeProfileInboundEngagement post-send for commitment keep", () => {
    const keepIdx = commitmentBlock.indexOf('laneIntent: "commitment_keep_ack"');
    expect(keepIdx).toBeGreaterThan(-1);
    const keepSlice = commitmentBlock.slice(keepIdx, keepIdx + 2500);
    const noSendReturn = keepSlice.indexOf("if (!sendKeep.ok)");
    const engagementIdx = keepSlice.indexOf("recordV2SendTimeProfileInboundEngagement", noSendReturn);
    expect(noSendReturn).toBeGreaterThan(-1);
    expect(engagementIdx).toBeGreaterThan(noSendReturn);
    const preSend = keepSlice.slice(0, noSendReturn);
    expect(preSend).not.toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("31: identity refresh remains wired unchanged", () => {
    expect(identityBlock).toContain("identityTruthContext");
    expect(identityBlock).toContain('laneIntent: "identity_still_commitment_prompt"');
    const stillIdx = identityBlock.indexOf('laneIntent: "identity_still_commitment_prompt"');
    const stillSlice = identityBlock.slice(stillIdx, stillIdx + 2000);
    expect(stillSlice).toContain("identityStill");
    expect(stillSlice).not.toContain("commitmentTruthContext");
  });
});

describe("Phase 2.1f-B2 refresh commitment — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const refreshStart = src.indexOf("async function persistRefreshSmsLaneAndSend");
  const refreshEnd = src.indexOf("async function mergeInboundMemoryIntoSmsPendingResolution");
  const refreshBlock = src.slice(refreshStart, refreshEnd);
  const processStart = src.indexOf("async function processV2CoachingRefreshInbound");
  const processEnd = src.indexOf("async function processInboundSmsSafetyShortCircuit");
  const processBlock = src.slice(processStart, processEnd);
  const commitmentStart = processBlock.indexOf('if (session.step === "commitment")');
  const commitmentBlock = processBlock.slice(commitmentStart);
  const helperStart = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
  const helperBlock = src.slice(helperStart, helperStart + 32000);

  it("23: commitment refresh path calls unified guard before reply_body", () => {
    expect(refreshBlock).toContain("commitmentTruthContext");
    expect(refreshBlock).toContain("isRefreshCommitmentLaneIntent");
    expect(helperBlock).toContain("evaluatePostUnifiedGuardRefreshTruthRecheck");
    expect(helperBlock).toContain("refreshNoSendTruthPolicy.refreshFamily");
  });

  it("24: commitment refresh uses transactional_coaching_limited", () => {
    expect(refreshBlock).toContain('mode: "transactional_coaching_limited"');
  });

  it("25: unified guard body becomes reply_body", () => {
    expect(helperBlock).toContain("gatedBody = unifiedGuard.body");
  });

  it("26-29: commitment mutation no-send stages call refresh truth policy", () => {
    expect(helperBlock).toContain('noSendStage: "lane"');
    expect(helperBlock).toContain('noSendStage: "final_voice_gate"');
    expect(helperBlock).toContain("post_unified_truth_recheck");
    expect(helperBlock).toContain("refresh_truth_violation_after_final_guard");
  });
});

describe("Phase 2.1f-B1/B2 refresh — guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nearDupMock.mockReturnValue({ ...PASS_NEAR_DUP, body: "Good — identity still fits. Does today's bar still work?" });
    truthGuardMock.mockReturnValue({ ...PASS_TRUTH, body: "Good — identity still fits. Does today's bar still work?" });
  });

  it("22: valid identity-still ack allowed by post-unified recheck", () => {
    const recheck = evaluatePostUnifiedGuardRefreshTruthRecheck({
      body: "Good — that identity line still fits. Does today's bar still work for you?",
      refreshIntent: "identity_still_commitment_prompt",
      refreshFamily: "identity",
      mutationFlags: { identityStill: true, sessionAdvanced: true },
    });
    expect(recheck.blocked).toBe(false);
  });

  it("near-duplicate blocked with transactional_coaching_limited", async () => {
    nearDupMock.mockReturnValueOnce({
      body: "dup",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });
    truthGuardMock.mockReturnValueOnce({ ...PASS_TRUTH, body: "dup" });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "refresh_identity",
      branchName: "refresh_identity_still_commitment_prompt",
      transactionalCoachingLimited: {
        body: "dup",
        evidence: refreshEvidence(),
        priorCoachBody: "prior",
        priorCoachSentAt: "2026-06-01T12:00:00.000Z",
        inboundRaw: "STILL",
        routePurpose: "refresh_identity",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("fake proof blocked by post-unified recheck", () => {
    const recheck = evaluatePostUnifiedGuardRefreshTruthRecheck({
      body: "Great job completing your goal today — saved to Victory Room.",
      refreshIntent: "identity_still_commitment_prompt",
      refreshFamily: "identity",
      mutationFlags: { identityStill: true, sessionAdvanced: true },
    });
    expect(recheck.blocked).toBe(true);
    expect(recheck.fakeProofFailed).toBe(true);
  });

  it("commitment keep back to normal checks allowed by post-unified recheck", () => {
    const recheck = evaluatePostUnifiedGuardRefreshTruthRecheck({
      body: "Got it—keeping this same focus for accountability. Back to normal checks.",
      refreshIntent: "commitment_keep_ack",
      refreshFamily: "commitment",
      mutationFlags: { commitmentKeep: true, refreshCleared: true },
    });
    expect(recheck.blocked).toBe(false);
  });
});
