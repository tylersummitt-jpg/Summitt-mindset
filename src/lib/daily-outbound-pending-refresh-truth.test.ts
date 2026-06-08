import { describe, expect, it } from "vitest";

import { buildDailyOutboundUnifiedGuardCtx } from "@/lib/daily-outbound-final-guard-evidence";
import {
  DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
  DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND,
  DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
  DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND,
  DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND,
  evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck,
} from "@/lib/daily-outbound-pending-refresh-truth";

const candidate = "30 minutes of deep work before noon";
const baseBehavior = "60 minutes of deep work every morning";
const identityAnchor = "I am a focused builder";
const effectiveAsk = "60 minutes of deep work every morning";

function pendingCtx() {
  return buildDailyOutboundUnifiedGuardCtx({
    routeKind: "pending_resolution",
    clerkUserId: "u",
    commitmentId: "c",
    pendingResolutionFacts: {
      resolutionKind: "commitment_tighten",
      smsState: "awaiting_confirmation",
      candidateSnippet: candidate,
      awaitingUserConfirmation: true,
      canonicalBehaviorStatement: baseBehavior,
      requiredVerbatimSubstrings: [candidate],
    },
  });
}

function refreshIdentityCtx() {
  return buildDailyOutboundUnifiedGuardCtx({
    routeKind: "refresh_identity",
    clerkUserId: "u",
    commitmentId: "c",
    refreshGuardFacts: {
      refreshStep: "identity_first",
      identityAnchorText: identityAnchor,
      requiredVerbatimSubstrings: [identityAnchor],
    },
  });
}

function refreshCommitmentCtx() {
  return buildDailyOutboundUnifiedGuardCtx({
    routeKind: "refresh_commitment",
    clerkUserId: "u",
    commitmentId: "c",
    refreshGuardFacts: {
      refreshStep: "commitment_daily",
      effectiveAskForBar: effectiveAsk,
      requiredVerbatimSubstrings: [effectiveAsk],
    },
  });
}

describe("evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck", () => {
  it("valid pending reminder passes", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Let's finish the commitment update. I'm holding this candidate: ${candidate}. Should I make that the new bar?`,
      dailyRouteKind: "pending_resolution",
      dailyGuardCtx: pendingCtx(),
    });
    expect(r.blocked).toBe(false);
  });

  it("false pending resolved blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Pending is resolved — ${candidate} is now your bar.`,
      dailyRouteKind: "pending_resolution",
      dailyGuardCtx: pendingCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("false goal changed blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Your goal has been updated to ${candidate}.`,
      dailyRouteKind: "pending_resolution",
      dailyGuardCtx: pendingCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("missing candidate verbatim blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: "Let's finish the commitment update when you can.",
      dailyRouteKind: "pending_resolution",
      dailyGuardCtx: pendingCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("valid refresh identity passes", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Quick alignment — does this still fit who you're becoming? "${identityAnchor}" Same vibe, or life shifted?`,
      dailyRouteKind: "refresh_identity",
      dailyGuardCtx: refreshIdentityCtx(),
    });
    expect(r.blocked).toBe(false);
  });

  it("false identity updated blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Your identity has been updated. "${identityAnchor}"`,
      dailyRouteKind: "refresh_identity",
      dailyGuardCtx: refreshIdentityCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("false refresh complete blocked on identity", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Refresh is complete. "${identityAnchor}"`,
      dailyRouteKind: "refresh_identity",
      dailyGuardCtx: refreshIdentityCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("missing identity anchor verbatim blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: "Does this still fit who you're becoming?",
      dailyRouteKind: "refresh_identity",
      dailyGuardCtx: refreshIdentityCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND);
  });

  it("valid refresh commitment passes", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Does this commitment still fit, or does it need to get smaller or change? Today's bar: ${effectiveAsk} Tell me keep, smaller, or new goal.`,
      dailyRouteKind: "refresh_commitment",
      dailyGuardCtx: refreshCommitmentCtx(),
    });
    expect(r.blocked).toBe(false);
  });

  it("false commitment changed blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Your commitment has been updated. Today's bar: ${effectiveAsk}`,
      dailyRouteKind: "refresh_commitment",
      dailyGuardCtx: refreshCommitmentCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("false refresh complete blocked on commitment", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Refresh is complete. Today's bar: ${effectiveAsk}`,
      dailyRouteKind: "refresh_commitment",
      dailyGuardCtx: refreshCommitmentCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("internal label blocked", () => {
    const r = evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck({
      body: `Finish the update — reply user_yes when ready. ${candidate}`,
      dailyRouteKind: "pending_resolution",
      dailyGuardCtx: pendingCtx(),
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND);
  });
});
