/**
 * Phase 2.1d-A2 — adaptive ambiguous clarify unified final guard + post-unified recheck.
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
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
  type OutcomeClaimEvidenceBundle,
} from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import { evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck } from "@/lib/v2-adaptive-consent-clarify-post-unified-truth";

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

function adaptiveEvidence(): OutcomeClaimEvidenceBundle {
  return {
    rawInbound: "maybe",
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
    priorCoachBody: "Want this tighter ask? Reply YES or NO.",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

describe("Phase 2.1d-A2 adaptive clarify — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const adaptiveStart = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
  const adaptiveEnd = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
  const adaptiveBlock = src.slice(adaptiveStart, adaptiveEnd);
  const contractStart = src.indexOf("async function runContractConsentNoSendTruthPolicy");
  const contractBlock = src.slice(contractStart, adaptiveStart);

  it("9: adaptive ambiguous clarify calls unified guard", () => {
    expect(adaptiveBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(adaptiveBlock).toContain('mode: "transactional_coaching_limited"');
    expect(adaptiveBlock).toContain('branchName: "adaptive_proposal_consent_clarification"');
    expect(adaptiveBlock).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });

  it("10: unified guard body becomes reply_body", () => {
    expect(adaptiveBlock).toContain("const gatedBody = unifiedGuard.body");
    expect(adaptiveBlock).toContain("reply_body: gatedBody");
  });

  it("11: unified guard no-send cancels job with adaptive telemetry", () => {
    expect(adaptiveBlock).toContain("adaptive_clarify_no_send: true");
    expect(adaptiveBlock).toContain("adaptive_proposal_consent_clarification_unified_guard_no_send");
    expect(adaptiveBlock).toContain('noSendStage: "unified_final_guard"');
  });

  it("12: post-unified adaptive truth failure cancels job with telemetry", () => {
    expect(adaptiveBlock).toContain("adaptive_proposal_consent_clarification_post_unified_truth_no_send");
    expect(adaptiveBlock).toContain("adaptiveTruthRecheckFailed: true");
  });

  it("17: contract A1 paths unchanged", () => {
    expect(contractBlock).toContain("trySendContractConsentBodyAfterUnifiedGuard");
    expect(contractBlock).toContain("persistContractConsentTruthOnNoSend");
    expect(contractBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });

  it("18: contract human fallback unchanged", () => {
    expect(contractBlock).toContain('bodySource: "human_fallback"');
    expect(contractBlock).toContain("prepareContractConsentHumanVoiceAckForSend");
  });

  it("19: refresh untouched", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
    expect(refreshBlock).not.toContain("unifiedFinalGuard");
    expect(refreshBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });

  it("20: pending untouched", () => {
    const pendingStart = src.indexOf("async function processV2SmsInboundPendingResolution");
    const pendingBlock = src.slice(
      pendingStart,
      src.indexOf("async function processV2CoachingRefreshInbound")
    );
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });

  it("21: memory untouched by adaptive recheck import", () => {
    const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryStart, memoryStart + 6000);
    expect(memoryBlock).toContain("unifiedFinalGuard:");
    expect(memoryBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });

  it("22: handoff wired separately (Phase 2.1e)", () => {
    const handoffStart = src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    const handoffEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
    const handoffBlock = src.slice(handoffStart, handoffEnd);
    expect(handoffBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(handoffBlock).toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(handoffBlock).not.toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
  });
});

describe("Phase 2.1d-A2 adaptive clarify — guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nearDupMock.mockImplementation(async (args: { body: string }) => ({
      ...PASS_NEAR_DUP,
      body: args.body,
    }));
    truthGuardMock.mockImplementation(async (args: { body: string }) => ({
      ...PASS_TRUTH,
      body: args.body,
    }));
  });

  it("13: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "adaptive_proposal_consent_clarification",
      branchName: "adaptive_proposal_consent_clarification",
      transactionalCoachingLimited: {
        body: "I want to make sure I understood — are you saying yes to that plan, or not yet?",
        evidence: adaptiveEvidence(),
        inboundRaw: "maybe",
      },
    });

    expect(r.shouldSend).toBe(false);
  });

  it("14: OCEG fake completion blocked", async () => {
    truthGuardMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "adaptive_proposal_consent_clarification",
      branchName: "adaptive_proposal_consent_clarification",
      transactionalCoachingLimited: {
        body: "Great job completing your goal today!",
        evidence: adaptiveEvidence(),
        inboundRaw: "maybe",
        routePurpose: "adaptive_proposal_consent_clarification",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("15: OCEG repair that claims acceptance is blocked by adaptive recheck", () => {
    const recheck = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      body: "Your plan is now active for the week.",
      adaptiveConsentClarificationFacts: {
        latest_outbound_was_proposal: true,
        pending_proposal_valid: true,
        proposal_kind: "adaptive_overlay",
        proposal_text_digest: "Morning walk",
        inbound_parse: "ambiguous",
        server_action_taken: "none",
        state_remains_pending: true,
        required_meaning_summary: "Clarify consent.",
        legacy_clarification_preview: "preview",
        inbound_message_sid: "SM1",
      },
    });

    expect(recheck.blocked).toBe(true);
    expect(recheck.adaptiveTruthViolations).toContain("clarify_but_body_claims_plan_active");
  });

  it("16: valid adaptive clarify passes guard stack recheck", () => {
    const recheck = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      body: "I want to make sure I understood — are you saying yes to that plan, or not yet?",
      adaptiveConsentClarificationFacts: {
        latest_outbound_was_proposal: true,
        pending_proposal_valid: true,
        proposal_kind: "adaptive_overlay",
        proposal_text_digest: "Morning walk",
        inbound_parse: "ambiguous",
        server_action_taken: "none",
        state_remains_pending: true,
        required_meaning_summary: "Clarify consent.",
        legacy_clarification_preview: "preview",
        inbound_message_sid: "SM1",
      },
    });

    expect(recheck.blocked).toBe(false);
  });
});
