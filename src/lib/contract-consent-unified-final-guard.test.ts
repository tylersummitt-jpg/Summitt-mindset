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

  it("27: adaptive clarify wired separately from contract truth policy", () => {
    expect(adaptiveBlock).toContain("applyUnifiedSmsFinalProductLawGuard");
    expect(adaptiveBlock).toContain("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck");
    expect(adaptiveBlock).not.toContain("persistContractConsentTruthOnNoSend");
  });

  it("28: refresh identity opt-in wired; commitment refresh not wired", () => {
    const refreshIdx = src.indexOf("async function persistRefreshSmsLaneAndSend");
    const refreshBlock = src.slice(refreshIdx, refreshIdx + 5000);
    expect(refreshBlock).toContain("refreshNoSendTruthPolicy");
    const processStart = src.indexOf("async function processV2CoachingRefreshInbound");
    const commitmentIdx = src.indexOf('if (session.step === "commitment")', processStart);
    const commitmentBlock = src.slice(commitmentIdx, commitmentIdx + 4000);
    expect(commitmentBlock).not.toContain("identityTruthContext");
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

describe("Phase 2.1g-B1 contract consent — engagement-on-no-send cleanup", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const contractFnStart = src.indexOf("async function processV2ContractProposalConsent");
  const contractFnEnd = src.indexOf("async function fetchPreferredNameForInboundLane");
  const contractFnBlock = src.slice(contractFnStart, contractFnEnd);
  const blockerFnStart = src.indexOf("async function processV2BlockerCapture");
  const blockerFnEnd = src.indexOf("async function processV2ContractProposalConsent");
  const blockerFnBlock = src.slice(blockerFnStart, blockerFnEnd);

  function engagementIfBody(sendVar: string): string {
    const idx = contractFnBlock.indexOf(`if (${sendVar}.ok)`);
    expect(idx).toBeGreaterThan(-1);
    const braceStart = contractFnBlock.indexOf("{", idx);
    const braceEnd = contractFnBlock.indexOf("}", braceStart);
    return contractFnBlock.slice(idx, braceEnd + 1);
  }

  it("1: Contract YES applied, send returns ok false → no engagement outside if block", () => {
    const yesIdx = contractFnBlock.indexOf("const sendContractYes = await persistContractConsentInboundLaneAckAndSend");
    expect(yesIdx).toBeGreaterThan(-1);
    const yesSlice = contractFnBlock.slice(yesIdx, yesIdx + 2200);
    const noSendPath = yesSlice.slice(0, yesSlice.indexOf("if (sendContractYes.ok)"));
    expect(noSendPath).not.toContain("recordV2SendTimeProfileInboundEngagement");
    const ifBody = engagementIfBody("sendContractYes");
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("2: Contract YES applied, send returns ok true → engagement records", () => {
    const ifBody = engagementIfBody("sendContractYes");
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("3: Contract NO declined, send returns ok false → no engagement outside if block", () => {
    const declIdx = contractFnBlock.indexOf(
      "const sendContractDecline = await persistContractConsentInboundLaneAckAndSend"
    );
    expect(declIdx).toBeGreaterThan(-1);
    const declSlice = contractFnBlock.slice(declIdx, declIdx + 2200);
    const noSendPath = declSlice.slice(0, declSlice.indexOf("if (sendContractDecline.ok)"));
    expect(noSendPath).not.toContain("recordV2SendTimeProfileInboundEngagement");
    const ifBody = engagementIfBody("sendContractDecline");
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("4: Contract NO declined, send returns ok true → engagement records", () => {
    const ifBody = engagementIfBody("sendContractDecline");
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("5: Contract noop branches still do not record engagement", () => {
    for (const marker of [
      'if (act.result === "already_applied")',
      'if (act.result === "state_conflict"',
      'if (dec.result === "already_applied")',
      'if (dec.result === "state_conflict"',
    ]) {
      const idx = contractFnBlock.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      const retIdx = contractFnBlock.indexOf("return true", idx);
      const block = contractFnBlock.slice(idx, retIdx + "return true".length);
      expect(block).not.toContain("recordV2SendTimeProfileInboundEngagement");
    }
  });

  it("6: Contract no-send truth policy still runs when send ok false", () => {
    expect(src).toContain("persistContractConsentTruthOnNoSend");
    expect(src).toContain("runContractConsentNoSendTruthPolicy");
    expect(src).toContain("cancelContractConsentAckNoSend");
  });

  it("7: Contract mutation behavior unchanged (recompute before lane send)", () => {
    const yesRecompute = contractFnBlock.indexOf('reasonCode: "inbound_contract_overlay_accepted"');
    const yesSend = contractFnBlock.indexOf("const sendContractYes");
    expect(yesRecompute).toBeGreaterThan(-1);
    expect(yesSend).toBeGreaterThan(yesRecompute);
    const declRecompute = contractFnBlock.indexOf('reasonCode: "inbound_contract_overlay_declined"');
    const declSend = contractFnBlock.indexOf("const sendContractDecline");
    expect(declRecompute).toBeGreaterThan(-1);
    expect(declSend).toBeGreaterThan(declRecompute);
  });

  it("14: normal main engagement untouched", () => {
    const mainIdx = src.indexOf('branch: "main"');
    const spineIdx = src.indexOf("if (spineInsertSucceeded)", mainIdx - 5000);
    expect(spineIdx).toBeGreaterThan(-1);
    const mainSlice = src.slice(spineIdx, spineIdx + 400);
    expect(mainSlice).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("15: central pivot engagement untouched", () => {
    const pivotEngIdx = src.indexOf("const freshPivot = (await loadJob(job.message_sid))");
    expect(pivotEngIdx).toBeGreaterThan(-1);
    const pivotSlice = src.slice(pivotEngIdx - 500, pivotEngIdx);
    expect(pivotSlice).toContain("recordV2SendTimeProfileInboundEngagement");
    expect(pivotSlice).toContain('branch: "central_pivot"');
  });

  it("16: arc clarification engagement untouched", () => {
    const arcEngIdx = src.indexOf("const freshArc = (await loadJob(job.message_sid))");
    expect(arcEngIdx).toBeGreaterThan(-1);
    const arcSlice = src.slice(arcEngIdx - 500, arcEngIdx);
    expect(arcSlice).toContain("recordV2SendTimeProfileInboundEngagement");
    expect(arcSlice).toContain('branch: "arc_clarify"');
  });

  it("17: legacy fallback engagement untouched", () => {
    const legacyIdx = src.indexOf('branch: "conversation_brain_legacy_fallback"');
    expect(legacyIdx).toBeGreaterThan(-1);
    const legacySlice = src.slice(legacyIdx, legacyIdx + 3500);
    expect(legacySlice).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("18: memory/pending g-A behavior unchanged", () => {
    const memoryStart = src.indexOf("async function processV2MemoryConfirmationInbound");
    const memoryBlock = src.slice(memoryStart, src.indexOf("async function processV2SmsInboundPendingResolution"));
    const ambNoSend = memoryBlock.indexOf("if (!sendAmb.ok)");
    const ambBrace = memoryBlock.indexOf("}", ambNoSend);
    expect(memoryBlock.slice(ambNoSend, ambBrace + 1)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
    const pendingStart = src.indexOf("async function processV2SmsInboundPendingResolution");
    const pendingBlock = src.slice(pendingStart, src.indexOf("async function processV2CoachingRefreshInbound"));
    const pendNoSend = pendingBlock.indexOf("if (!sendStill.ok)");
    const pendBrace = pendingBlock.indexOf("}", pendNoSend);
    expect(pendingBlock.slice(pendNoSend, pendBrace + 1)).not.toContain(
      "recordV2SendTimeProfileInboundEngagement"
    );
  });

  it("8: Blocker ack visibleSent=false → no engagement outside if (blocker)", () => {
    const insertIdx = blockerFnBlock.indexOf('event_type: "blocker_captured"');
    const clearIdx = blockerFnBlock.indexOf("clearBlockerCapturePending", insertIdx);
    const gateIdx = blockerFnBlock.indexOf("if (visibleSent)", clearIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    const preGate = blockerFnBlock.slice(clearIdx, gateIdx);
    expect(preGate).not.toContain("recordV2SendTimeProfileInboundEngagement");
    const braceStart = blockerFnBlock.indexOf("{", gateIdx);
    const braceEnd = blockerFnBlock.indexOf("}", braceStart);
    const ifBody = blockerFnBlock.slice(gateIdx, braceEnd + 1);
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("9: Blocker ack visibleSent=true → engagement inside if (blocker)", () => {
    const ifBody = blockerFnBlock.slice(
      blockerFnBlock.indexOf("if (visibleSent)"),
      blockerFnBlock.indexOf("if (visibleSent)") + 120
    );
    expect(ifBody).toContain("recordV2SendTimeProfileInboundEngagement");
  });

  it("10: blocker_captured still persists when ack no-sends", () => {
    expect(blockerFnBlock).toContain('event_type: "blocker_captured"');
    expect(blockerFnBlock).toContain("visibleSent");
    const insertIdx = blockerFnBlock.indexOf('event_type: "blocker_captured"');
    const gateIdx = blockerFnBlock.indexOf("if (visibleSent)");
    expect(insertIdx).toBeLessThan(gateIdx);
  });

  it("11: blocker ack no-send truth observability unchanged", () => {
    expect(blockerFnBlock).toContain("buildBlockerCapturedAckObservability");
    expect(blockerFnBlock).toContain("blocker_ack_no_send_truth_persisted: true");
  });

  it("12: blocker pivot engagement unchanged", () => {
    const pivotEngIdx = blockerFnBlock.indexOf("recordV2SendTimeProfileInboundEngagement");
    expect(pivotEngIdx).toBeGreaterThan(-1);
    expect(blockerFnBlock.indexOf("central_brain_blocker_pivot")).toBeLessThan(pivotEngIdx);
  });

  it("13: blocker pivot no-send unchanged", () => {
    expect(blockerFnBlock).toContain("blocker_pivot_unified_final_guard_blocked");
    const idx = blockerFnBlock.indexOf("blocker_pivot_unified_final_guard_blocked");
    const block = blockerFnBlock.slice(idx - 400, idx + 200);
    expect(block).toContain("return;");
  });
});
