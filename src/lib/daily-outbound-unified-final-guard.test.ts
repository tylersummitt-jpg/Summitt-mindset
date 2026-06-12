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
  isOutboundDailyC2RoutePurpose,
  isOutboundDailyC3RoutePurpose,
  isOutboundDailyWiredRoutePurpose,
} from "@/lib/daily-outbound-final-guard-evidence";
import {
  DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
  DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND,
  DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
  DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND,
  DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND,
} from "@/lib/daily-outbound-pending-refresh-truth";
import {
  DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND,
  DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND,
} from "@/lib/daily-outbound-contract-proposal-truth";
import {
  OUTBOUND_DAILY_C1_CHECKS_SKIPPED,
  OUTBOUND_DAILY_C2_CHECKS_SKIPPED,
  OUTBOUND_DAILY_C3_CHECKS_SKIPPED,
  SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
} from "@/lib/sms-final-product-law-guard";
import { GENERIC_FUTURE_RECOMMITMENT_QUESTION_NO_SEND } from "@/lib/sms-generic-future-recommitment-question-family";
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

const SHRINK_ASK = "30 minutes of deep work before noon";
const BASE_BEHAVIOR = "60 minutes of deep work every morning";

function c2GuardArgs(
  body = `Would ${SHRINK_ASK} work better for you this week — want to try that bar?`,
  proposalKind: "shrink_ask" | "recommit_same" = "shrink_ask"
) {
  const semFacts = {
    proposal_kind: proposalKind,
    duration_days: 7 as const,
    base_behavior_statement: BASE_BEHAVIOR,
    proposed_overlay_ask: proposalKind === "shrink_ask" ? SHRINK_ASK : null,
    proposed_behavior_preview: proposalKind === "shrink_ask" ? SHRINK_ASK : BASE_BEHAVIOR,
    desired_response_semantics: "natural_confirmation_or_decline_or_adjustment" as const,
    must_not_claim_goal_updated: true,
    forbidden_phrases: [] as readonly string[],
  };
  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: "contract_prompt",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    priorCoachBody: "Want to keep the same line this week?",
    priorOutcome: null,
    proposalKind,
    contractSemanticFacts: semFacts,
    canonicalProposalAskTrim: proposalKind === "shrink_ask" ? SHRINK_ASK : BASE_BEHAVIOR,
    baseBehaviorStatement: BASE_BEHAVIOR,
    proposalPending: false,
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose: "contract_prompt",
    branchName: "contract_prompt",
    preGuardBodyPreview: body,
    outboundDaily: {
      body,
      evidence: buildDailyOutboundOcegEvidence(ctx),
      dailyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose: "contract_prompt",
    },
  };
}

const PENDING_CANDIDATE = "30 minutes of deep work before noon";
const IDENTITY_ANCHOR = "I am a focused builder";
const EFFECTIVE_ASK = "60 minutes of deep work every morning";

function c3PendingGuardArgs(
  body = `Let's finish the commitment update. I'm holding this candidate: ${PENDING_CANDIDATE}. Should I make that the new bar?`
) {
  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: "pending_resolution",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    priorCoachBody: "Still waiting on your bar update.",
    priorOutcome: null,
    pendingResolutionFacts: {
      resolutionKind: "commitment_tighten",
      smsState: "awaiting_confirmation",
      candidateSnippet: PENDING_CANDIDATE,
      awaitingUserConfirmation: true,
      canonicalBehaviorStatement: EFFECTIVE_ASK,
      requiredVerbatimSubstrings: [PENDING_CANDIDATE],
    },
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose: "pending_resolution",
    branchName: "pending_resolution",
    preGuardBodyPreview: body,
    outboundDaily: {
      body,
      evidence: buildDailyOutboundOcegEvidence(ctx),
      dailyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose: "pending_resolution",
    },
  };
}

function c3RefreshIdentityGuardArgs(
  body = `Quick alignment — does this still fit who you're becoming? "${IDENTITY_ANCHOR}" Same vibe, or life shifted?`
) {
  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: "refresh_identity",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    priorCoachBody: "Prior refresh outbound.",
    priorOutcome: null,
    refreshGuardFacts: {
      refreshStep: "identity_first",
      identityAnchorText: IDENTITY_ANCHOR,
      requiredVerbatimSubstrings: [IDENTITY_ANCHOR],
    },
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose: "refresh_identity",
    branchName: "refresh_identity",
    preGuardBodyPreview: body,
    outboundDaily: {
      body,
      evidence: buildDailyOutboundOcegEvidence(ctx),
      dailyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose: "refresh_identity",
    },
  };
}

function c3RefreshCommitmentGuardArgs(
  body = `Does this commitment still fit, or does it need to get smaller or change? Today's bar: ${EFFECTIVE_ASK} Tell me keep, smaller, or new goal.`
) {
  const ctx = buildDailyOutboundUnifiedGuardCtx({
    routeKind: "refresh_commitment",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    priorCoachBody: "Prior commitment refresh.",
    priorOutcome: null,
    refreshGuardFacts: {
      refreshStep: "commitment_daily",
      effectiveAskForBar: EFFECTIVE_ASK,
      requiredVerbatimSubstrings: [EFFECTIVE_ASK],
    },
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose: "refresh_commitment",
    branchName: "refresh_commitment",
    preGuardBodyPreview: body,
    outboundDaily: {
      body,
      evidence: buildDailyOutboundOcegEvidence(ctx),
      dailyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose: "refresh_commitment",
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

  it("3b: generic next-week recommit question blocks on daily main", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c1GuardArgs("Are you ready to stay committed to your goal for the next week?")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(GENERIC_FUTURE_RECOMMITMENT_QUESTION_NO_SEND);
    expect(r.metadata.generic_recommitment_question_family_detected).toBe(true);
    expect(r.checks_run).toContain("generic_future_recommitment_question");
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

  it("10: non-wired route kind not activated", async () => {
    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        ...c1GuardArgs(),
        routePurpose: "unknown_daily_branch",
        outboundDaily: {
          ...c1GuardArgs().outboundDaily!,
          routePurpose: "unknown_daily_branch",
        },
      })
    ).rejects.toThrow(/not activated for route/);
    expect(isOutboundDailyC1RoutePurpose("contract_prompt")).toBe(false);
    expect(isOutboundDailyC2RoutePurpose("contract_prompt")).toBe(true);
    expect(isOutboundDailyC2RoutePurpose("guided_shrink_contract_prompt")).toBe(true);
    expect(isOutboundDailyC3RoutePurpose("pending_resolution")).toBe(true);
    expect(isOutboundDailyWiredRoutePurpose("main_active_accountability")).toBe(true);
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
    expect(dailySrc).toContain("isOutboundDailyWiredRoutePurpose(built.dailyUnifiedGuardCtx.routeKind)");
    const twilioIdx = dailySrc.indexOf("await sendSMS({");
    const guardIdx = dailySrc.indexOf('mode: "outbound_daily"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(twilioIdx);
  });

  it("12: low_pressure_reactivation supplies dailyUnifiedGuardCtx", () => {
    expect(dailySrc).toContain('routeKind: "low_pressure_reactivation"');
    expect(dailySrc).toContain("dailyUnifiedGuardCtx:");
  });

  it("13: contract_prompt sets dailyUnifiedGuardCtx in main return", () => {
    const contractCtxIdx = dailySrc.indexOf(
      'routeKind === "contract_prompt" &&\n              contractProposalKind'
    );
    expect(contractCtxIdx).toBeGreaterThan(-1);
    const slice = dailySrc.slice(contractCtxIdx, contractCtxIdx + 900);
    expect(slice).toContain('routeKind: "contract_prompt"');
    expect(slice).toContain("contractSemanticFacts");
    expect(slice).not.toContain("pending_resolution");
  });

  it("14: pending_resolution branch sets dailyUnifiedGuardCtx", () => {
    const pendingCtxIdx = dailySrc.indexOf(
      'dailyUnifiedGuardCtx: buildDailyOutboundUnifiedGuardCtx({\n          routeKind: "pending_resolution"'
    );
    expect(pendingCtxIdx).toBeGreaterThan(-1);
    const slice = dailySrc.slice(pendingCtxIdx, pendingCtxIdx + 700);
    expect(slice).toContain("pendingResolutionFacts");
  });

  it("15: refresh_identity / refresh_commitment set dailyUnifiedGuardCtx", () => {
    expect(dailySrc).toContain('routeKind: "refresh_identity"');
    expect(dailySrc).toContain('routeKind: "refresh_commitment"');
    expect(dailySrc).toContain("refreshGuardFacts");
  });

  it("16: weekly route wired to outbound_weekly only (daily C1 scope unchanged)", () => {
    expect(weeklySrc).toContain('mode: "outbound_weekly"');
    expect(weeklySrc).not.toContain('mode: "outbound_daily"');
    expect(weeklySrc).not.toContain("isOutboundDailyWiredRoutePurpose");
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

  it("21f: pending_resolution branch sets dailyUnifiedGuardCtx", () => {
    expect(dailySrc).toContain('routeKind: "pending_resolution"');
    expect(dailySrc).toContain("pendingResolutionFacts");
  });

  it("21g: refresh_identity / refresh_commitment set dailyUnifiedGuardCtx", () => {
    expect(dailySrc).toContain('routeKind: "refresh_identity"');
    expect(dailySrc).toContain('routeKind: "refresh_commitment"');
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

  it("21j: body/send chain — smsBody from withNorthStarDailyGate only", () => {
    expect(dailySrc).toContain("await withNorthStarDailyGate(builtMainRaw");
    expect(dailySrc).toContain("const smsBody = builtMain.smsBody");
    expect(dailySrc).toContain("onV2StandardCheckSentOutboundSendSuccess");
  });

  it("29: proposal state not written before send", () => {
    const postSendIdx = dailySrc.lastIndexOf("await onV2StandardCheckSentOutboundSendSuccess");
    const twilioIdx = dailySrc.indexOf("await sendSMS({");
    expect(postSendIdx).toBeGreaterThan(-1);
    expect(twilioIdx).toBeLessThan(postSendIdx);
  });

  it("30: onV2StandardCheckSentOutboundSendSuccess unchanged in post-send block", () => {
    expect(dailySrc).toContain("await onV2StandardCheckSentOutboundSendSuccess");
    expect(dailySrc).toContain("contractOverlayProposal:");
    expect(dailySrc).toContain('builtMain.v2ContractProposalMode ? "proposal_yes_no"');
  });

  it("22: post-FVG daily stale ask is detect-only (no OpenAI repair)", () => {
    expect(dailySrc).toContain("applyDailyPostFvgStaleAskDetectOnly");
    expect(dailySrc).toContain("daily_post_final_voice_gate");
    expect(dailySrc).not.toContain("applyDailyStaleAskGuard");
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

  it("27: no hard-coded SMS in guard wiring", () => {
    expect(northStarBlock).not.toContain('smsBody: "');
    expect(northStarBlock).not.toContain('reply_body: "');
  });
});

describe("Phase 2.3-C2 outbound_daily contract_prompt guard", () => {
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

  it("1: contract_prompt calls outbound_daily guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c2GuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_daily");
    expect(r.checks_run).toContain("contract_proposal_truth_recheck");
  });

  it("2: valid shrink proposal passes", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c2GuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.checks_skipped).toEqual(OUTBOUND_DAILY_C2_CHECKS_SKIPPED);
  });

  it("3: valid recommit proposal passes", async () => {
    const body = `Want to keep holding the same line — ${BASE_BEHAVIOR.slice(0, 30)} — for another week?`;
    const r = await applyUnifiedSmsFinalProductLawGuard(c2GuardArgs(body, "recommit_same"));
    expect(r.should_send).toBe(true);
  });

  it("4: fake completion blocked", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs("Great — you completed your workout today!")
    );
    expect(r.should_send).toBe(false);
  });

  it("5: fake Victory / proof blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs("That's proof for your Victory Room streak.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND);
  });

  it("6: goal already updated blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs(`Your goal already changed to ${SHRINK_ASK}. Sound good?`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("7: proposal active / accepted blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs(
        `Would ${SHRINK_ASK} work for you this week? You already accepted it and the proposal is active.`
      )
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("8: missing shrink proposed bar signal blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs("Want to adjust something this week?")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("9: missing recommit meaning blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs("Something different this week?", "recommit_same")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("10: robotic Reply YES blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs(`${SHRINK_ASK}. Reply YES to confirm or NO to discard.`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("11: OCEG repair that removes required proposal meaning blocked", async () => {
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "Want to adjust something this week?",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(c2GuardArgs(SHRINK_ASK));
    expect(r.should_send).toBe(false);
    expect(r.checks_run).toContain("contract_proposal_truth_recheck");
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("12: near-duplicate proposal blocked", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      body: "",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(c2GuardArgs());
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("13: internal label blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c2GuardArgs(`Try ${SHRINK_ASK} — reply user_yes if that works?`)
    );
    expect(r.should_send).toBe(false);
  });

  it("24: C2 no-send metadata fields in route", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    expect(dailySrc).toContain("proposal_state_written_before_sms: false");
    expect(dailySrc).toContain("v2_contract_proposal_kind");
    expect(dailySrc).toContain("proposal_no_send_reason");
  });

  it("28: non-C2 daily success does not falsely claim unified authority", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const northStarFnStart = dailySrc.indexOf("async function withNorthStarDailyGate");
    const northStarFnEnd = dailySrc.indexOf("function dailySmsSentEventVoiceMetadata");
    const northStarBlock = dailySrc.slice(northStarFnStart, northStarFnEnd);
    const successBranch = northStarBlock.slice(
      northStarBlock.indexOf("finalShouldSend\n        ? {"),
      northStarBlock.indexOf("finalShouldSend\n        ? {") + 450
    );
    expect(successBranch).toContain("unifiedGuardTelemetry");
    expect(successBranch).not.toMatch(
      /finalShouldSend\s*\?\s*\{\s*final_body_authority:\s*UNIFIED_FINAL_BODY_AUTHORITY/
    );
  });
});

describe("Phase 2.3-C3 outbound_daily pending/refresh guard", () => {
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

  it("1: pending_resolution calls outbound_daily guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3PendingGuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_daily");
    expect(r.checks_run).toContain("pending_refresh_truth_recheck");
    expect(r.checks_skipped).toEqual(OUTBOUND_DAILY_C3_CHECKS_SKIPPED);
  });

  it("2: refresh_identity calls outbound_daily guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3RefreshIdentityGuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.checks_run).toContain("pending_refresh_truth_recheck");
  });

  it("3: refresh_commitment calls outbound_daily guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3RefreshCommitmentGuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.checks_run).toContain("pending_refresh_truth_recheck");
  });

  it("8: valid pending reminder passes", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3PendingGuardArgs());
    expect(r.should_send).toBe(true);
  });

  it("9: false pending resolved/applied blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs(`Pending is resolved — ${PENDING_CANDIDATE} is now your bar.`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("10: false goal/commitment changed blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs(`Your goal has been updated to ${PENDING_CANDIDATE}.`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("11: missing candidate/verbatim blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs("Let's finish the commitment update when you can.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("12: OCEG repair stripping candidate meaning blocked", async () => {
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "Let's finish the commitment update when you can.",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(c3PendingGuardArgs());
    expect(r.should_send).toBe(false);
    expect(r.checks_run).toContain("pending_refresh_truth_recheck");
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("13: valid refresh identity prompt passes", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3RefreshIdentityGuardArgs());
    expect(r.should_send).toBe(true);
  });

  it("14: false identity updated blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshIdentityGuardArgs(`Your identity has been updated. "${IDENTITY_ANCHOR}"`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("15: false refresh complete blocked on identity", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshIdentityGuardArgs(`Refresh is complete. "${IDENTITY_ANCHOR}"`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("16: missing identity anchor/verbatim blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshIdentityGuardArgs("Does this still fit who you're becoming?")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("17: valid refresh commitment prompt passes", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(c3RefreshCommitmentGuardArgs());
    expect(r.should_send).toBe(true);
  });

  it("18: false commitment changed blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshCommitmentGuardArgs(
        `Your commitment has been updated. Today's bar: ${EFFECTIVE_ASK}`
      )
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("19: false refresh complete blocked on commitment", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshCommitmentGuardArgs(`Refresh is complete. Today's bar: ${EFFECTIVE_ASK}`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("20: missing effective ask/verbatim blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3RefreshCommitmentGuardArgs("Does this commitment still fit?")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("21: fake Victory / proof blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs(`That's proof for your Victory Room streak. ${PENDING_CANDIDATE}`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND);
  });

  it("22: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      body: "",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(c3PendingGuardArgs());
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("23: internal label blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs(`Finish update — reply user_yes. ${PENDING_CANDIDATE}`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND);
  });

  it("24: OCEG unsupported claim no-sends", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      c3PendingGuardArgs("Great — you completed your workout today!")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("25: C3 no-send metadata fields in route", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    expect(dailySrc).toContain("pending_state_written_before_sms: false");
    expect(dailySrc).toContain("refresh_session_written_before_sms: false");
    expect(dailySrc).toContain("pending_reminder_no_send_reason");
    expect(dailySrc).toContain("refresh_no_send_reason");
  });

  it("29: onV2RefreshOutboundSendSuccess remains after Twilio", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const postSendIdx = dailySrc.lastIndexOf("await onV2RefreshOutboundSendSuccess");
    const twilioIdx = dailySrc.indexOf("await sendSMS({");
    expect(postSendIdx).toBeGreaterThan(twilioIdx);
  });

  it("30: pending reminder does not call pending RPC on success path", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    expect(dailySrc).toContain("daily_sms_pending_resolution_reminder");
    expect(dailySrc).not.toContain("persistPendingResolutionTruthOnNoSend");
  });

  it("33: non-C3 success does not falsely claim unified authority", () => {
    const dailySrc = fs.readFileSync(DAILY_ROUTE, "utf8");
    const northStarFnStart = dailySrc.indexOf("async function withNorthStarDailyGate");
    const northStarFnEnd = dailySrc.indexOf("function dailySmsSentEventVoiceMetadata");
    const northStarBlock = dailySrc.slice(northStarFnStart, northStarFnEnd);
    const successBranch = northStarBlock.slice(
      northStarBlock.indexOf("finalShouldSend\n        ? {"),
      northStarBlock.indexOf("finalShouldSend\n        ? {") + 450
    );
    expect(successBranch).toContain("unifiedGuardTelemetry");
    expect(successBranch).not.toMatch(
      /finalShouldSend\s*\?\s*\{\s*final_body_authority:\s*UNIFIED_FINAL_BODY_AUTHORITY/
    );
  });
});
