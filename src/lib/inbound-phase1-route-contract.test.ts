import { describe, expect, it } from "vitest";

import {
  buildInboundRouteAllowedClaims,
  detectPlanCommitmentCloseLoopBackstop,
  detectProofAnswerCloseLoopBackstop,
  detectPureAcknowledgmentCloser,
  detectReadinessCloseLoopBackstop,
  detectWinCloseLoopBackstop,
  looksLikeRealHelpRequest,
  mapTurnUnderstandingToInboundRouteContract,
  type ReconciledTurnUnderstanding,
} from "@/lib/openai-relationship-turn-understanding-v1";

function minimalReconciled(
  overrides: Partial<ReconciledTurnUnderstanding> = {}
): ReconciledTurnUnderstanding {
  return {
    proposal: null,
    reconciled_relationship_meaning: "unclear",
    reconciled_response_intent: "unclear_clarify",
    reconciled_persistence_decision: "no_outcome_write",
    reconciled_do_not_repeat_asks: [],
    last_ask_satisfied: "unclear",
    satisfaction_kind: "unclear",
    stale_ask_risk: false,
    confidence: 0.8,
    disagreement_flags: [],
    interpreter_failed_reason: null,
    stale_ask_avoided: false,
    persistence_note: "test",
    reconciled_goal_change_intent: null,
    ...overrides,
  };
}

describe("Victory Room allowed claims via route mapper", () => {
  it("Thanks for the advice is pure acknowledgment, not help_request", () => {
    expect(looksLikeRealHelpRequest("Thanks for the advice")).toBe(false);
    expect(detectPureAcknowledgmentCloser("Thanks for the advice")).toBe(true);
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: "Thanks for the advice",
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("acknowledgment_no_reply");
    expect(contract.should_reply).toBe(false);
    expect(contract.phase1_authoritative).toBe(true);
    expect(contract.outcome_to_persist).toBe("none");
  });

  it("Okay / Good / Sounds good are acknowledgment_no_reply", () => {
    for (const text of ["Okay", "Good", "Sounds good"]) {
      const contract = mapTurnUnderstandingToInboundRouteContract({
        rawInbound: text,
        reconciled: minimalReconciled(),
      });
      expect(contract.route).toBe("acknowledgment_no_reply");
      expect(contract.should_reply).toBe(false);
    }
  });

  it("compliments win maps to win_close_loop", () => {
    const text = "And I gave them compliments today. So we hit the goal!";
    expect(detectWinCloseLoopBackstop(text)).toBe(true);
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("win_close_loop");
    expect(contract.should_reply).toBe(true);
    expect(contract.close_loop).toBe(true);
    expect(contract.max_questions).toBe(0);
    expect(contract.should_persist).toBe(true);
  });

  it("gratitude list after gratitude ask maps to proof_answer_close_loop", () => {
    const text =
      "Our family is healthy. We are provided with everything we need. My wife's family is doing well health wise.";
    const openQ = "What are three things you are grateful for today?";
    expect(
      detectProofAnswerCloseLoopBackstop({
        rawInbound: text,
        openQuestionPending: true,
        latestOpenQuestion: openQ,
      })
    ).toBe(true);
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
      openQuestionPending: true,
      latestOpenQuestion: openQ,
    });
    expect(contract.route).toBe("proof_answer_close_loop");
    expect(contract.prior_ask_satisfied).toBe(true);
    expect(contract.should_reply).toBe(true);
    expect(contract.max_questions).toBe(0);
  });

  it("real help question stays legacy_other", () => {
    const text = "What should I do if I'm struggling with motivation?";
    expect(looksLikeRealHelpRequest(text)).toBe(true);
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("legacy_other");
    expect(contract.phase1_authoritative).toBe(false);
    expect(contract.should_reply).toBe(true);
  });
});

describe("outcome beats pure acknowledgment no-reply", () => {
  it("Thanks for the advice remains acknowledgment_no_reply", () => {
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: "Thanks for the advice",
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("acknowledgment_no_reply");
    expect(contract.should_reply).toBe(false);
  });

  it.each([
    "Thanks, we hit the goal!",
    "Thank you, I did it.",
    "Okay, I got it done.",
  ])("%s routes win_close_loop", (text) => {
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("win_close_loop");
    expect(contract.should_reply).toBe(true);
    expect(contract.should_persist).toBe(true);
    expect(detectPureAcknowledgmentCloser(text)).toBe(false);
  });

  it.each([
    "Good, I finished half.",
    "Thanks, I missed it today.",
    "Thanks, what should I do next?",
    "Okay, I'm struggling with motivation.",
  ])("%s does not route acknowledgment_no_reply", (text) => {
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
    });
    expect(contract.route).not.toBe("acknowledgment_no_reply");
    expect(detectPureAcknowledgmentCloser(text)).toBe(false);
  });

  it("gratitude list after gratitude ask still routes proof_answer_close_loop", () => {
    const text =
      "Our family is healthy. We are provided with everything we need. My wife's family is doing well health wise.";
    const openQ = "What are three things you are grateful for today?";
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
      openQuestionPending: true,
      latestOpenQuestion: openQ,
    });
    expect(contract.route).toBe("proof_answer_close_loop");
    expect(contract.prior_ask_satisfied).toBe(true);
  });

  it("real help request still routes legacy_other with should_reply", () => {
    const text = "What should I do if I'm struggling with motivation?";
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: text,
      reconciled: minimalReconciled(),
    });
    expect(contract.route).toBe("legacy_other");
    expect(contract.should_reply).toBe(true);
  });
});

describe("Victory Room allowed claims via route mapper", () => {
  it("allows Victory Room only after persistence success", () => {
    const allowed = buildInboundRouteAllowedClaims({
      routeContract: mapTurnUnderstandingToInboundRouteContract({
        rawInbound: "I did it today",
        reconciled: minimalReconciled(),
      }),
      proofPersistedBeforeWriter: true,
      proofPersistedEventType: "user_yes",
    });
    expect(allowed.can_reference_victory_room).toBe(true);
  });

  it("forbids Victory Room hard reference without persistence (metaphor_only still possible)", () => {
    const allowed = buildInboundRouteAllowedClaims({
      routeContract: mapTurnUnderstandingToInboundRouteContract({
        rawInbound: "I did it today",
        reconciled: minimalReconciled(),
      }),
      proofPersistedBeforeWriter: false,
    });
    expect(allowed.can_reference_victory_room).toBe(false);
    expect(allowed.victory_room_language_mode).not.toBe("recorded_allowed");
    expect(allowed.victory_room_language_mode).toBe("metaphor_only");
  });
});

describe("P2b meaningful non-outcome close-loop routes", () => {
  const PLAN_ASK = "Make a short list of your next life story steps for tomorrow";

  it.each([
    "Good suggestion & have made a list.",
    "Sounds like a great plan I'm committed.",
    "That's what I'm doing.",
    "Ready.",
  ])("%s → proof_answer_close_loop, max_questions 0, should_reply, no persist", (body) => {
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: body,
      reconciled: minimalReconciled({
        confidence: 0.2,
        reconciled_response_intent: "unclear_clarify",
        last_ask_satisfied: "unclear",
      }),
      openQuestionPending: true,
      latestOpenQuestion: PLAN_ASK,
      lastCoachOutbound: PLAN_ASK,
    });
    expect(contract.route).toBe("proof_answer_close_loop");
    expect(contract.max_questions).toBe(0);
    expect(contract.should_reply).toBe(true);
    expect(contract.should_persist).toBe(false);
    expect(contract.close_loop).toBe(true);
    expect(contract.prior_ask_satisfied).toBe(true);
    expect(contract.outcome_to_persist).toBe("none");
    expect(contract.forbidden_moves.some((m) => /stopped|got in the way/i.test(m))).toBe(true);
  });

  it("Ready. does not use acknowledgment_no_reply silence when prior ask pending", () => {
    expect(detectPureAcknowledgmentCloser("Ready.")).toBe(false);
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: "Ready.",
      reconciled: minimalReconciled({
        reconciled_response_intent: "close_loop_no_new_action",
        last_ask_satisfied: "yes",
        confidence: 0.9,
      }),
      openQuestionPending: true,
      latestOpenQuestion: PLAN_ASK,
    });
    expect(contract.route).toBe("proof_answer_close_loop");
    expect(contract.should_reply).toBe(true);
  });

  it("explicit miss still does not take readiness close-loop", () => {
    const contract = mapTurnUnderstandingToInboundRouteContract({
      rawInbound: "Ready. Wait I missed it.",
      reconciled: minimalReconciled({ confidence: 0.2 }),
      openQuestionPending: true,
      latestOpenQuestion: PLAN_ASK,
    });
    // Too long / miss language → readiness backstop false; may be legacy or other
    expect(detectReadinessCloseLoopBackstop({
      rawInbound: "Ready. Wait I missed it.",
      openQuestionPending: true,
      latestOpenQuestion: PLAN_ASK,
    })).toBe(false);
    expect(contract.route).not.toBe("acknowledgment_no_reply");
  });
});
