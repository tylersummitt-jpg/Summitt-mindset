/**
 * Phase 2.1c — pending resolution opt-in unified final guard + no-send truth policy.
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
import {
  detectPendingReplacementStateTruthViolations,
  detectSeasonTransitionTruthViolations,
} from "@/lib/v3-inbound-pending-replacement-truth";

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

function pendingTransactionalEvidence(): OutcomeClaimEvidenceBundle {
  return {
    rawInbound: "yes",
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
    priorCoachBody: "Want me to lock that in?",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

describe("Phase 2.1c pending resolution unified guard — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(pendingFnStart, src.indexOf("async function processV2CoachingRefreshInbound"));
  const laneGuardStart = src.indexOf("type InboundLaneUnifiedFinalGuardConfig");
  const laneGuardBlock = src.slice(laneGuardStart, laneGuardStart + 16000);
  const helperStart = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
  const helperBlock = src.slice(helperStart, helperStart + 12000);

  it("G: pending resolution passes unifiedFinalGuard opt-in", () => {
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).toContain('routePurpose: "pending_resolution"');
    expect(pendingBlock).toContain('branchName: "sms_pending_resolution_complete"');
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).toContain("outcomeClaimEvidence: outcomeClaimEvidencePr");
  });

  it("H: refresh helper calls do NOT pass unifiedFinalGuard", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    expect(refreshIdx).toBeGreaterThan(0);
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
    expect(refreshBlock).not.toContain("unifiedFinalGuard");
  });

  it("I: memory confirmation still uses memoryNoSendTruthPolicy", () => {
    const memoryFnStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryFnStart, memoryFnStart + 12000);
    expect(memoryBlock).toContain("memoryNoSendTruthPolicy:");
    expect(memoryBlock).toContain('routePurpose: "memory_confirmation"');
  });

  it("J: helper default unchanged — guard opt-in parameter only", () => {
    expect(helperBlock).toMatch(/unifiedFinalGuard\?: InboundLaneUnifiedFinalGuardConfig/);
    expect(helperBlock).toContain("if (args.unifiedFinalGuard)");
  });

  it("K: lane no-send calls pending truth policy when configured", () => {
    expect(laneGuardBlock).toContain("runPendingResolutionNoSendTruthPolicyIfConfigured");
    expect(laneGuardBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
    const laneIdx = helperBlock.indexOf("_inbound_lane_no_send");
    expect(laneIdx).toBeGreaterThan(0);
    const laneBlock = helperBlock.slice(laneIdx - 900, laneIdx + 200);
    expect(laneBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("L: FVG no-send calls pending truth policy when configured", () => {
    const fvgIdx = helperBlock.indexOf("_final_voice_suppressed");
    expect(fvgIdx).toBeGreaterThan(0);
    const fvgBlock = helperBlock.slice(fvgIdx - 900, fvgIdx + 200);
    expect(fvgBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("M: unified guard no-send calls pending truth policy when configured", () => {
    expect(laneGuardBlock).toContain('noSendStage: "unified_final_guard"');
    const ugIdx = helperBlock.indexOf("_unified_final_guard_no_send");
    expect(ugIdx).toBeGreaterThan(0);
    const ugBlock = helperBlock.slice(ugIdx - 900, ugIdx + 200);
    expect(ugBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
  });

  it("N: post-guard pending/season truth recheck wired", () => {
    expect(laneGuardBlock).toContain("evaluatePostUnifiedGuardPendingTruthRecheck");
    expect(laneGuardBlock).toContain("detectPendingReplacementStateTruthViolations");
    expect(laneGuardBlock).toContain("detectSeasonTransitionTruthViolations");
    expect(laneGuardBlock).toContain("pending_resolution_truth_violation_after_final_guard");
    expect(laneGuardBlock).toContain("season_transition_truth_violation_after_final_guard");
  });

  it("Phase 2.2 blocker deferral unchanged", () => {
    expect(src).toContain("deferredBlockerGate");
    expect(src).toContain("logBlockerGateTransactionalHandlerConsumed");
  });
});

describe("Phase 2.1c pending resolution unified guard — guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nearDupMock.mockResolvedValue({ ...PASS_NEAR_DUP, body: "Done. Updated bar." });
    truthGuardMock.mockResolvedValue({ ...PASS_TRUTH, body: "Done. Updated bar." });
  });

  it("O: valid pending applied ack sends through transactional guard", async () => {
    const body = "Done. Updated bar: walk 10k steps. I will hold you to that tomorrow.";
    nearDupMock.mockResolvedValue({ ...PASS_NEAR_DUP, body });
    truthGuardMock.mockResolvedValue({ ...PASS_TRUTH, body });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      transactionalCoachingLimited: {
        body,
        evidence: pendingTransactionalEvidence(),
        priorCoachBody: "Want me to lock that in?",
        priorCoachSentAt: "2026-06-01T12:00:00.000Z",
        inboundRaw: "yes",
        routePurpose: "pending_resolution",
      },
    });

    expect(r.shouldSend).toBe(true);
    expect(r.checks_run).toContain("near_duplicate");
    expect(r.checks_run).toContain("unsupported_claim_oceg");
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("P: fake completion blocked by OCEG", async () => {
    truthGuardMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      transactionalCoachingLimited: {
        body: "Great job completing your goal today!",
        evidence: pendingTransactionalEvidence(),
        inboundRaw: "yes",
        routePurpose: "pending_resolution",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("Q: fake Victory Room claim blocked by OCEG", async () => {
    truthGuardMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: { blocked_claim: "victory_room" },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      transactionalCoachingLimited: {
        body: "Saved to your Victory Room.",
        evidence: pendingTransactionalEvidence(),
        inboundRaw: "yes",
        routePurpose: "pending_resolution",
      },
    });

    expect(r.shouldSend).toBe(false);
  });

  it("R: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      transactionalCoachingLimited: {
        body: "Done. Updated bar.",
        evidence: pendingTransactionalEvidence(),
        inboundRaw: "yes",
        routePurpose: "pending_resolution",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("T: post-guard pending truth detects false applied language", () => {
    const violations = detectPendingReplacementStateTruthViolations(
      "Your goal has been updated and locked in.",
      {
        pending_resolution_active: true,
        pending_resolution_kind: "commitment_replace",
        pending_resolution_sms_state: "awaiting_confirmation",
        pending_candidate_behavior_statement: "Walk 10,000 steps daily",
        pending_candidate_new_bar: "Walk 10,000 steps daily",
        canonical_behavior_statement: "Exercise 20 minutes",
        pending_resolution_applied: false,
        required_meaning_summary: "Do not say applied.",
      }
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it("U: season transition false claim detected after repair candidate", () => {
    const violations = detectSeasonTransitionTruthViolations("We closed this chapter and started a new season.", {
      chapter_changed: false,
      user_facing_transition: "same_season_sync",
      season_mode: "same_season_sync",
      season_transition_applied: false,
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});
