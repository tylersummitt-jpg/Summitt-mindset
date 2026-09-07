/**
 * Phase 2.1e — commitment change handoff unified final guard + no-send truth policy.
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
import { evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck } from "@/lib/v2-commitment-handoff-post-unified-truth";

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

function handoffEvidence(): OutcomeClaimEvidenceBundle {
  return {
    rawInbound: "Make it smaller",
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
    priorCoachBody: "Two hours deep work before noon.",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

describe("Phase 2.1e commitment handoff — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const adaptiveStart = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
  const adaptiveEnd = src.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound");
  const adaptiveBlock = src.slice(adaptiveStart, adaptiveEnd);
  const contractStart = src.indexOf("async function runContractConsentNoSendTruthPolicy");
  const contractBlock = src.slice(contractStart, adaptiveStart);

  it("18: dead V3 handoff writer is gone", () => {
    expect(src).not.toContain("persistCommitmentChangeHandoffLaneAndSend");
    expect(src).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(src).not.toContain("persistCommitmentHandoffTruthOnNoSend");
    expect(src).not.toContain("cancelCommitmentHandoffNoSend");
    expect(src).toContain("await runSolGoalChangePendingOpenForInbound");
  });

  it("28: contract A1/A2 unchanged", () => {
    expect(contractBlock).toContain("trySendContractConsentBodyAfterUnifiedGuard");
    expect(contractBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(adaptiveBlock).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
    expect(adaptiveBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
  });

  it("29: pending unchanged", () => {
    const pendingStart = src.indexOf("async function processV2SmsInboundPendingResolution");
    const pendingBlock = src.slice(
      pendingStart,
      src.indexOf("async function processV2CoachingRefreshInbound")
    );
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
  });

  it("30: memory unchanged", () => {
    const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryStart, memoryStart + 6000);
    expect(memoryBlock).toContain("unifiedFinalGuard:");
    expect(memoryBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
  });

  it("31: refresh identity uses refresh recheck not handoff recheck", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 5000);
    expect(refreshBlock).toContain("refreshNoSendTruthPolicy");
    expect(refreshBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
    expect(src).toContain("evaluatePostUnifiedGuardRefreshTruthRecheck");
  });

  it("32: daily/weekly untouched", () => {
    expect(src).not.toContain('surface: "daily"');
    expect(src).not.toContain('surface: "weekly"');
  });

  it("33: blocker deferral untouched", () => {
    expect(src).toContain("if (deferredBlockerGate)");
    const blockerIdx = src.indexOf("blocker_ack_unified_final_guard_blocked");
    expect(blockerIdx).toBeGreaterThan(-1);
    const blockerBlock = src.slice(blockerIdx - 500, blockerIdx + 500);
    expect(blockerBlock).not.toContain("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck");
  });
});

describe("Phase 2.1e commitment handoff — guard behavior", () => {
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

  it("near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "commitment_change_handoff",
      branchName: "commitment_change_handoff",
      transactionalCoachingLimited: {
        body: "I hear you want a smaller bar — reply YES when ready.",
        evidence: handoffEvidence(),
        inboundRaw: "Make it smaller",
      },
    });

    expect(r.shouldSend).toBe(false);
  });

  it("OCEG fake completion blocked", async () => {
    truthGuardMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "commitment_change_handoff",
      branchName: "commitment_change_handoff",
      transactionalCoachingLimited: {
        body: "Great job completing your goal today!",
        evidence: handoffEvidence(),
        inboundRaw: "Make it smaller",
        routePurpose: "commitment_change_handoff",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("post-unified recheck blocks false goal changed", () => {
    const recheck = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Your goal has been updated.",
      commitmentChangeFacts: {
        detected_intent_type: "sms_tighten_request",
        current_commitment_snapshot: "snap",
        requested_change_summary: "smaller",
        pending_resolution_created: true,
        pending_resolution_type: "commitment_tighten",
        pending_resolution_skip_reason: null,
        pending_resolution_apply_exception: null,
        existing_pending_resolution: false,
        candidate_tightened_bar_preview: "20 min",
        candidate_new_bar_preview: null,
        server_state_transition_summary: "pending_resolution_upserted:commitment_tighten",
        required_meaning_summary: "Pending.",
        legacy_commitment_change_reply_preview: "preview",
        append_note_preview: null,
        inbound_message_sid: "SM1",
      },
    });

    expect(recheck.blocked).toBe(true);
  });
});
