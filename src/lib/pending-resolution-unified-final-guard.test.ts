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
  const helperBlock = src.slice(helperStart, helperStart + 32000);

  it("G: pending resolution passes unifiedFinalGuard opt-in", () => {
    expect(pendingBlock).toContain("unifiedFinalGuard:");
    expect(pendingBlock).toContain('routePurpose: "pending_resolution"');
    expect(pendingBlock).toContain('branchName: "sms_pending_resolution_complete"');
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).toContain("outcomeClaimEvidence: outcomeClaimEvidencePr");
  });

  it("H: refresh helper passes unifiedFinalGuard opt-in for identity intents only", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    expect(refreshIdx).toBeGreaterThan(0);
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 5000);
    expect(refreshBlock).toContain("isRefreshIdentityLaneIntent");
    expect(refreshBlock).toContain("refreshNoSendTruthPolicy");
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
    expect(helperBlock).toContain("noSendStage: noSendStage");
    expect(helperBlock).toContain("_unified_final_guard_no_send");
    expect(helperBlock).toContain("runInboundLaneNoSendTruthPoliciesIfConfigured");
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

describe("Phase 2.1g-A pending resolution — engagement-on-no-send cleanup", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(pendingFnStart, src.indexOf("async function processV2CoachingRefreshInbound"));
  const refreshBlock = src.slice(
    src.indexOf("async function processV2CoachingRefreshInbound"),
    src.indexOf("async function processV2CoachingRefreshInbound") + 80000
  );
  const handoffStart = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
  const handoffEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
  const handoffBlock = src.slice(handoffStart, handoffEnd);

  it("10: pending resolution no-send does NOT call engagement", () => {
    const idx = pendingBlock.indexOf("if (!sendStill.ok)");
    expect(idx).toBeGreaterThan(-1);
    const braceStart = pendingBlock.indexOf("{", idx);
    const braceEnd = pendingBlock.indexOf("}", braceStart);
    const noSendIfBody = pendingBlock.slice(idx, braceEnd + 1);
    expect(noSendIfBody).not.toContain("recordV2SendTimeProfileInboundEngagement");
    expect(noSendIfBody).toContain("return true");
  });

  it("11: pending resolution successful send DOES call engagement", () => {
    const sendIdx = pendingBlock.indexOf("const sendStill = await persistInboundV3RelationshipLaneReplyReadyAndSend");
    const sendSlice = pendingBlock.slice(sendIdx, sendIdx + 2200);
    const noSendReturn = sendSlice.indexOf("if (!sendStill.ok)");
    const engagementIdx = sendSlice.indexOf("recordV2SendTimeProfileInboundEngagement", noSendReturn);
    expect(noSendReturn).toBeGreaterThan(-1);
    expect(engagementIdx).toBeGreaterThan(noSendReturn);
  });

  it("12: pending mutation_applied no-send still writes pending no-send truth audit", () => {
    const pendingTruthSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-pending-resolution-no-send-truth.ts"),
      "utf8"
    );
    expect(pendingTruthSrc).toContain("persistPendingResolutionTruthOnNoSend");
    expect(pendingTruthSrc).toContain('"mutation_applied"');
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(src).toContain("runPendingResolutionNoSendTruthPolicyIfConfigured");
  });

  it("13: pending active clarify no-send behavior unchanged", () => {
    const pendingTruthSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-pending-resolution-no-send-truth.ts"),
      "utf8"
    );
    expect(pendingTruthSrc).toContain('"pending_active_clarify"');
    const activeIdx = pendingTruthSrc.indexOf('args.policyBranch === "pending_active_clarify"');
    expect(activeIdx).toBeGreaterThan(-1);
    const activeBlock = pendingTruthSrc.slice(activeIdx, activeIdx + 200);
    expect(activeBlock).toContain("return baseTelemetry");
    expect(activeBlock).not.toContain("visible_sent");
  });

  it("14: mergeInboundMemoryIntoSmsPendingResolution only runs on sendStill.ok", () => {
    const mergeIdx = pendingBlock.indexOf("mergeInboundMemoryIntoSmsPendingResolution");
    const noSendReturn = pendingBlock.indexOf("if (!sendStill.ok)");
    expect(mergeIdx).toBeGreaterThan(noSendReturn);
    const between = pendingBlock.slice(noSendReturn, mergeIdx);
    expect(between).toContain("recordV2SendTimeProfileInboundEngagement");
    expect(between).not.toContain("mergeInboundMemoryIntoSmsPendingResolution");
  });

  it("15: refresh B1/B2 engagement ordering unchanged", () => {
    const stillIdx = refreshBlock.indexOf('laneIntent: "identity_still_commitment_prompt"');
    const stillSlice = refreshBlock.slice(stillIdx, stillIdx + 3500);
    const noSendReturn = stillSlice.indexOf("if (!sendStill.ok)");
    const engagementIdx = stillSlice.indexOf("recordV2SendTimeProfileInboundEngagement", noSendReturn);
    expect(engagementIdx).toBeGreaterThan(noSendReturn);
  });

  it("16: handoff engagement ordering unchanged", () => {
    const sendIdx = handoffBlock.indexOf("await commitAndSendInboundRelationshipCoachReply");
    const engagementIdx = handoffBlock.indexOf(
      "await recordV2SendTimeProfileInboundEngagement",
      sendIdx
    );
    expect(engagementIdx).toBeGreaterThan(sendIdx);
  });

  it("17: contract/adaptive unchanged", () => {
    expect(src).toContain("persistContractConsentInboundLaneAckAndSend");
    expect(src).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
  });

  it("18: blocker unchanged", () => {
    expect(src).toContain("const unifiedGuardBlockerAck = await applyUnifiedSmsFinalProductLawGuard");
  });

  it("19: weekly wired to outbound_weekly; daily C1 only for outbound_daily", () => {
    const dailySrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    const weeklySrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts"),
      "utf8"
    );
    expect(dailySrc).toContain("isOutboundDailyWiredRoutePurpose");
    expect(weeklySrc).toContain('mode: "outbound_weekly"');
    expect(weeklySrc).not.toContain('mode: "outbound_daily"');
  });

  it("20: no Twilio/send changes in pending block", () => {
    expect(pendingBlock).not.toContain("twilioClient");
    expect(pendingBlock).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
  });

  it("21: no persistence enum changes in pending block", () => {
    expect(pendingBlock).not.toMatch(/event_type:\s*"/);
  });

  it("22: no hard-coded SMS in pending block", () => {
    expect(pendingBlock).not.toContain("reply_body:");
  });
});
