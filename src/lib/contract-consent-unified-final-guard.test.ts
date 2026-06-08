/**
 * Phase 2.1d-A1 — contract consent unified final guard + no-send truth policy.
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
import { evaluatePostUnifiedGuardContractTruthRecheck } from "@/lib/v2-contract-consent-post-unified-truth";

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

function contractEvidence(): OutcomeClaimEvidenceBundle {
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
    priorCoachBody: "Want this tighter ask?",
    priorCoachSentAt: "2026-06-01T12:00:00.000Z",
  };
}

describe("Phase 2.1d-A1 contract consent — route wiring", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const contractPipelineStart = src.indexOf("async function runContractConsentNoSendTruthPolicy");
  const contractEnd = src.indexOf("async function persistAdaptiveProposalConsentClarificationAndSend");
  const contractBlock = src.slice(contractPipelineStart, contractEnd);
  const adaptiveBlock = src.slice(
    contractEnd,
    src.indexOf("async function persistCommitmentChangeHandoffLaneAndSend")
  );

  it("15: contract YES path applies unified guard before send", () => {
    expect(contractBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(contractBlock).toContain('mode: "transactional_coaching_limited"');
    expect(contractBlock).toContain('branchName: "contract_consent_ack"');
    expect(contractBlock).toContain("trySendContractConsentBodyAfterUnifiedGuard");
    expect(contractBlock).toContain('bodySource: "v3_lane"');
  });

  it("16: contract path includes human fallback unified guard", () => {
    expect(contractBlock).toContain('bodySource: "human_fallback"');
    expect(contractBlock).toContain("prepareContractConsentHumanVoiceAckForSend");
  });

  it("17: post-unified contract truth recheck wired", () => {
    expect(contractBlock).toContain("evaluatePostUnifiedGuardContractTruthRecheck");
    expect(src).toContain("persistContractConsentTruthOnNoSend");
    expect(contractBlock).toContain("buildContractConsentNoSendTruthPolicyContext");
  });

  it("23: lane/FVG failures call contract truth policy on final no-send", () => {
    expect(contractBlock).toContain("runContractConsentNoSendTruthPolicy");
    expect(contractBlock).toContain("cancelContractConsentAckNoSend");
  });

  it("27: adaptive clarify not wired to unified guard", () => {
    expect(adaptiveBlock).not.toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(adaptiveBlock).not.toContain("persistContractConsentTruthOnNoSend");
  });

  it("28: refresh still not wired", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 4000);
    expect(refreshBlock).not.toContain("unifiedFinalGuard");
  });

  it("29: pending still uses pendingNoSendTruthPolicy only", () => {
    const pendingStart = src.indexOf("async function processV2SmsInboundPendingResolution");
    const pendingBlock = src.slice(
      pendingStart,
      src.indexOf("async function processV2CoachingRefreshInbound")
    );
    expect(pendingBlock).toContain("pendingNoSendTruthPolicy");
    expect(pendingBlock).not.toContain("buildContractConsentNoSendTruthPolicyContext");
  });
});

describe("Phase 2.1d-A1 contract consent — guard behavior", () => {
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

  it("19: OCEG fake completion blocked", async () => {
    truthGuardMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "adaptive_proposal_consent_accept",
      branchName: "contract_consent_ack",
      transactionalCoachingLimited: {
        body: "Great job completing your goal today!",
        evidence: contractEvidence(),
        inboundRaw: "yes",
        routePurpose: "adaptive_proposal_consent_accept",
      },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.checks_skipped).toEqual(TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED);
  });

  it("21: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValue({
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      metadata: {},
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: "adaptive_proposal_consent_accept",
      branchName: "contract_consent_ack",
      transactionalCoachingLimited: {
        body: "Morning walk — locked in for the week.",
        evidence: contractEvidence(),
        inboundRaw: "yes",
      },
    });

    expect(r.shouldSend).toBe(false);
  });

  it("22: post-unified recheck blocks missing verbatim after OCEG repair", () => {
    const recheck = evaluatePostUnifiedGuardContractTruthRecheck({
      body: "Locked in for the week — sharper ask starts tomorrow.",
      contractConsentFacts: {
        consent_parse: "user_yes",
        latest_outbound_was_proposal: true,
        proposal_kind: "adaptive_overlay",
        proposal_text_digest: "Morning walk",
        overlay_action: "activated",
        rpc_result: "applied",
        server_state_transition_summary: "Applied.",
        required_verbatim_substrings: ["Morning walk"],
        required_meaning_summary: "Ack acceptance.",
        legacy_contract_ack_preview: "preview",
        inbound_message_sid: "SM1",
        proposal_expires_at: null,
      },
      consentParse: "user_yes",
      proposalText: "Morning walk every day",
      contractKind: "adaptive_overlay",
      behaviorStatement: "Walk",
      effectiveAsk: "Morning walk",
      optionalBindingSubstring: "Morning walk",
      proposalStillActive: false,
    });

    expect(recheck.blocked).toBe(true);
    expect(recheck.noSendReason).toBe("contract_required_verbatim_missing_after_unified_guard");
  });
});
