import { describe, expect, it } from "vitest";

import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  reconcileTurnUnderstanding,
  resolveInboundTurnUnderstandingSkipReason,
  type OpenAIRelationshipTurnUnderstandingV1,
} from "@/lib/openai-relationship-turn-understanding-v1";
import { buildInterpreterFailedSafeReconciled } from "@/lib/openai-relationship-turn-understanding-v1";
import {
  applyInboundFinalBodyTurnUnderstandingGuard,
  detectReconciledTurnUnderstandingStaleAskViolation,
  emptyInboundTurnUnderstandingContext,
  paraphraseRepeatsStaleCoachAsk,
} from "@/lib/inbound-turn-understanding-context";

const CALENDAR_ASK =
  "let me know if you're ready to put one family connection on the calendar for tomorrow";

function familyProposal(): OpenAIRelationshipTurnUnderstandingV1 {
  return {
    version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    user_turn_summary: "Visiting family; plans tomorrow.",
    evidence_quotes: ["visiting with family in Ohio"],
    relationship_meaning: "already_scheduled_or_happening",
    answered_last_coach_ask: "yes",
    last_ask_satisfied: "yes",
    satisfaction_kind: "already_scheduled",
    do_not_repeat_asks: [CALENDAR_ASK],
    stale_ask_risk: true,
    commitment_outcome_recommendation: "no_outcome_write",
    persistence_safety: "do_not_write_but_acknowledge",
    response_intent: "acknowledge_prior_ask_satisfied",
    temporal_scope: "today",
    reported_for_day_key: null,
    confidence: 0.88,
    uncertainty_flags: [],
    route_priority_recommendation: "none",
    safety_or_support_flags: [],
  };
}

function reconciledFamily() {
  const det = buildInboundMeaningFacts({
    rawInbound:
      "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.",
    classifierEventType: "user_yes",
    openQuestionPending: true,
    latestOpenQuestion: CALENDAR_ASK,
  });
  return reconcileTurnUnderstanding({
    proposal: familyProposal(),
    deterministicMeaning: det,
    latestCoachQuestion: CALENDAR_ASK,
  });
}

describe("resolveInboundTurnUnderstandingSkipReason", () => {
  it("returns hard_route_pending_resolution", () => {
    expect(
      resolveInboundTurnUnderstandingSkipReason({
        routePurpose: "normal_inbound_reply",
        routePriority: { pending_resolution: true },
      })
    ).toBe("hard_route_pending_resolution");
  });
});

describe("stale ask paraphrase detection", () => {
  it("N: blocks calendar paraphrase let me know when", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Let me know when you put family time on your calendar.",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("O: blocks are you ready to schedule family connection", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Are you ready to schedule that family connection?",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("P: blocks when will you put it on the calendar", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk("When will you put it on the calendar?", CALENDAR_ASK)
    ).toBe(true);
  });

  it("Q: allows unrelated useful follow-up", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Enjoy your time with family in Ohio — what felt best about today?",
        CALENDAR_ASK
      )
    ).toBe(false);
  });

  it("blocks do you still want calendar paraphrase", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Do you still want to put that family connection on the calendar?",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("blocks what time will you put family on calendar", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "What time will you put family on the calendar?",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("blocks should we get family time scheduled", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Should we get that family time scheduled?",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("blocks want to put family connection on calendar now", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Want to put that family connection on the calendar now?",
        CALENDAR_ASK
      )
    ).toBe(true);
  });

  it("allows enjoy family time reflection follow-up", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Enjoy the family time tomorrow — after it, tell me what you noticed.",
        CALENDAR_ASK
      )
    ).toBe(false);
  });

  it("allows presence reflection follow-up", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "What do you want to be most present for while you're with them?",
        CALENDAR_ASK
      )
    ).toBe(false);
  });

  it("allows intentional family follow-up", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "What would make tomorrow's family time feel intentional?",
        CALENDAR_ASK
      )
    ).toBe(false);
  });

  it("allows how to show up with family", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "How do you want to show up with your family tomorrow?",
        CALENDAR_ASK
      )
    ).toBe(false);
  });
});

describe("final body guard", () => {
  const tu = reconciledFamily();
  const ctx = {
    ...emptyInboundTurnUnderstandingContext(),
    didRun: true,
    reconciled: tu,
    proposal: tu.proposal,
  };

  it("K: blocks North Star-style stale calendar re-ask", () => {
    const r = applyInboundFinalBodyTurnUnderstandingGuard({
      body: "When you get a chance, let me know if you're ready to put one family connection on the calendar for tomorrow.",
      context: ctx,
      latestOpenQuestion: CALENDAR_ASK,
      stage: "post_north_star",
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.turn_understanding_final_body_guard_ran).toBe(true);
    expect(r.metadata.final_body_stale_ask_blocked).toBe(true);
  });

  it("T: allows clean acknowledgment", () => {
    const r = applyInboundFinalBodyTurnUnderstandingGuard({
      body: "You're with family in Ohio today — enjoy tomorrow with them.",
      context: ctx,
      latestOpenQuestion: CALENDAR_ASK,
      stage: "post_final_voice_gate",
    });
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.turn_understanding_final_body_violation_detected).toBe(false);
  });
});

describe("interpreter failed-safe fallback", () => {
  const familyBody =
    "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.";

  it("A: failed-safe blocks stale calendar on final guard", () => {
    const det = buildInboundMeaningFacts({
      rawInbound: familyBody,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: CALENDAR_ASK,
    });
    const safe = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: det,
      latestCoachQuestion: CALENDAR_ASK,
      openQuestionPending: true,
      rawInbound: familyBody,
      classifierEventType: "user_yes",
    });
    const ctx = {
      ...emptyInboundTurnUnderstandingContext(),
      didRun: true,
      reconciled: safe,
      failedReason: "timeout",
    };
    const r = applyInboundFinalBodyTurnUnderstandingGuard({
      body: "Do you still want to put that family connection on the calendar?",
      context: ctx,
      latestOpenQuestion: CALENDAR_ASK,
      stage: "failed_safe_pre_send",
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.final_body_stale_ask_blocked).toBe(true);
    expect(r.metadata.turn_understanding_final_body_guard_ran).toBe(true);
  });

  it("B: failed-safe no fake user_yes on family/plans substantive reply", () => {
    const det = buildInboundMeaningFacts({
      rawInbound: familyBody,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: CALENDAR_ASK,
    });
    const safe = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "no_openai_key",
      proposal: null,
      deterministicMeaning: det,
      latestCoachQuestion: CALENDAR_ASK,
      openQuestionPending: true,
      rawInbound: familyBody,
      classifierEventType: "user_yes",
    });
    expect(safe.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(safe.turn_understanding_failed_safe_fallback).toBe(true);
  });
});

describe("detectReconciledTurnUnderstandingStaleAskViolation", () => {
  it("detects violation from reconciled only (no full facts)", () => {
    const tu = reconciledFamily();
    const v = detectReconciledTurnUnderstandingStaleAskViolation(
      "Are you ready to schedule that family connection?",
      { reconciled: tu, latestOpenQuestion: CALENDAR_ASK }
    );
    expect(v.violation).toBe(true);
  });
});
