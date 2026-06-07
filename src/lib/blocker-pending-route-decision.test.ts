import { describe, expect, it } from "vitest";
import {
  evaluateBlockerPendingRouteDecision,
  isBareYesNoAfterBlockerQuestion,
} from "@/lib/blocker-pending-route-decision";
import type { InboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { shouldBypassBlockerCaptureForProposalAck } from "@/lib/blocker-capture-proposal-ack-bypass";
import { resolveShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";

function baseArgs(rawInbound: string, overrides: Record<string, unknown> = {}) {
  const classification = classifyV2InboundReply(rawInbound);
  return {
    rawInbound,
    blockerCapturePendingActive: true,
    blockerCaptureAfterEvent: "user_no",
    blockerCaptureExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    lastCoachBody: "What was the real block today?",
    latestOpenQuestion: "What was the real block today?",
    blockerClassification: classification,
    turnUnderstandingContext: { didRun: false, skippedReason: null, failedReason: null, reconciled: null },
    ...overrides,
  };
}

function tuCtx(reconciled: Partial<ReconciledTurnUnderstanding>): InboundTurnUnderstandingContext {
  return {
    didRun: true,
    skippedReason: null,
    failedReason: null,
    reconciled: {
      reconciled_relationship_meaning: "unclear",
      reconciled_response_intent: "unclear_clarify",
      reconciled_persistence_decision: "no_outcome_write",
      reconciled_do_not_repeat_asks: [],
      last_ask_satisfied: "unclear",
      satisfaction_kind: "unclear",
      confidence: 0.9,
      disagreement_flags: [],
      stale_ask_risk: false,
      stale_ask_avoided: false,
      ...reconciled,
    } as ReconciledTurnUnderstanding,
  };
}

describe("evaluateBlockerPendingRouteDecision", () => {
  it("1: time got away from me → actual_blocker_capture", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("time got away from me"));
    expect(r.decision).toBe("actual_blocker_capture");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(true);
    expect(r.source).toBe("deterministic_signal");
  });

  it("2: time → actual_blocker_capture", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("time"));
    expect(r.decision).toBe("actual_blocker_capture");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(true);
  });

  it("3: Good after proposal → proposal_ack, not blocker", () => {
    const coach =
      "How does committing to a 10-minute walk after dinner sound? Reply YES or NO if you want this adjusted ask.";
    const stepE = shouldBypassBlockerCaptureForProposalAck({
      rawInbound: "Good",
      latestOutboundBody: coach,
      latestOpenQuestion: "How does committing to a 10-minute walk after dinner sound?",
      openQuestionPending: true,
    });
    const r = evaluateBlockerPendingRouteDecision(
      baseArgs("Good", { stepEProposalAck: stepE })
    );
    expect(r.decision).toBe("proposal_ack");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
    expect(r.shouldRunNormalInbound).toBe(true);
    expect(r.source).toBe("step_e");
  });

  it("4: Good, time got away from me → actual_blocker_capture", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("Good, time got away from me"));
    expect(r.decision).toBe("actual_blocker_capture");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(true);
  });

  it("5: I did it today → outcome_answer, not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("I did it today"));
    expect(r.decision).toBe("outcome_answer");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
    expect(r.source).toBe("explicit_outcome");
  });

  it("6: I missed it yesterday → outcome_answer, not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("I missed it yesterday"));
    expect(r.decision).toBe("outcome_answer");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
  });

  it("7: I need to change the goal → adjustment_request, not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("I need to change the goal"));
    expect(r.decision).toBe("adjustment_request");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
  });

  it("8: hmm → unclear, not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("hmm"));
    expect(r.decision).toBe("unclear");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
    expect(r.source).toBe("fallback");
  });

  it("9: TU fail + time got away → deterministic actual_blocker_capture", () => {
    const r = evaluateBlockerPendingRouteDecision(
      baseArgs("time got away from me", {
        turnUnderstandingContext: {
          didRun: true,
          failedReason: "openai_timeout",
          skippedReason: null,
          reconciled: null,
        },
      })
    );
    expect(r.decision).toBe("actual_blocker_capture");
    expect(r.source).toBe("deterministic_signal");
  });

  it("10: TU fail + Good (no proposal) → not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(
      baseArgs("Good", {
        turnUnderstandingContext: {
          didRun: true,
          failedReason: "openai_timeout",
          skippedReason: null,
          reconciled: null,
        },
      })
    );
    expect(r.decision).not.toBe("actual_blocker_capture");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
  });

  it("11: bare yes after blocker question → unclear, classification override", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("yes"));
    expect(r.decision).toBe("unclear");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
    expect(r.normalInboundClassificationOverride?.eventType).toBe("user_partial");
    expect(r.normalInboundClassificationOverride?.normalizedHint).toBe(
      "blocker_pending_bare_yes_no"
    );
  });

  it("12: bare no after blocker question → unclear, not user_no", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("no"));
    expect(r.decision).toBe("unclear");
    expect(r.normalInboundClassificationOverride?.eventType).toBe("user_partial");
  });

  it("13: no problem → not blocker", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("no problem"));
    expect(r.decision).toBe("unclear");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
  });

  it("mixed miss + blocker routes normal for outcome truth", () => {
    const r = evaluateBlockerPendingRouteDecision(
      baseArgs("No, I missed because I was sick")
    );
    expect(r.decision).toBe("outcome_answer");
    expect(r.shouldRunProcessV2BlockerCapture).toBe(false);
    expect(r.shouldRunNormalInbound).toBe(true);
  });

  it("TU blocker_detail → actual_blocker_capture when no explicit outcome", () => {
    const r = evaluateBlockerPendingRouteDecision(
      baseArgs("work ran late", {
        turnUnderstandingContext: tuCtx({
          reconciled_relationship_meaning: "blocker_detail",
          reconciled_response_intent: "identify_blocker",
          reconciled_persistence_decision: "no_outcome_write",
        }),
      })
    );
    expect(r.decision).toBe("actual_blocker_capture");
    expect(r.source).toBe("turn_understanding");
  });

  it("telemetry includes required fields", () => {
    const r = evaluateBlockerPendingRouteDecision(baseArgs("time"));
    expect(r.telemetry.blocker_pending_active).toBe(true);
    expect(r.telemetry.blocker_route_decision).toBe("actual_blocker_capture");
    expect(r.telemetry.blocker_route_decision_source).toBe("deterministic_signal");
    expect(r.telemetry.did_processV2BlockerCapture_run).toBe(true);
    expect(r.telemetry.did_normal_inbound_run).toBe(false);
  });
});

describe("isBareYesNoAfterBlockerQuestion", () => {
  it("detects bare yes/no", () => {
    expect(
      isBareYesNoAfterBlockerQuestion("yes", { eventType: "user_yes" as V2InboundEventType })
    ).toBe(true);
    expect(
      isBareYesNoAfterBlockerQuestion("I did it today", {
        eventType: "user_yes" as V2InboundEventType,
      })
    ).toBe(false);
  });
});
