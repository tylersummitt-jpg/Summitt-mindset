import { beforeEach, describe, expect, it, vi } from "vitest";

const staleAskRepairMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: staleAskRepairMock,
      },
    };
  },
}));

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
  applyInboundFinalBodyTurnUnderstandingGuardAsync,
  detectReconciledTurnUnderstandingStaleAskViolation,
  emptyInboundTurnUnderstandingContext,
  isAnsweredPriorAskCloseLoopEligible,
  paraphraseRepeatsStaleCoachAsk,
  resolveStaleAskViolationWithRepair,
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

  it("H: allows what helped you get your steps in today", () => {
    const planAsk = "how does staying committed to this plan feel for the rest of the week";
    expect(
      paraphraseRepeatsStaleCoachAsk("What helped you get your steps in today?", planAsk)
    ).toBe(false);
  });

  it("K: blocks stale plan continuation ask", () => {
    const planAsk = "how does staying committed to this plan feel for the rest of the week";
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "How do you feel about continuing the plan for the rest of the week?",
        planAsk
      )
    ).toBe(true);
  });
});

describe("P0 Step A — recovery/outcome-close stale-ask exemption", () => {
  const DIST_PRIOR =
    "What actually happened with your distribution plan since your last check-in?";

  it("1: allows miss recovery after distribution outcome ask", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Missing a day happens. What do you think led to that? Let's explore how you can get back on track with your distribution plan.",
        DIST_PRIOR
      )
    ).toBe(false);
  });

  it("2: allows got in the way recovery", () => {
    expect(paraphraseRepeatsStaleCoachAsk("What got in the way yesterday?", DIST_PRIOR)).toBe(false);
  });

  it("3: blocks exact repeat of distribution outcome ask", () => {
    expect(paraphraseRepeatsStaleCoachAsk(DIST_PRIOR, DIST_PRIOR)).toBe(true);
  });

  it("4: blocks near-repeat of distribution outcome ask", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "What happened with your distribution plan since your last check-in?",
        DIST_PRIOR
      )
    ).toBe(true);
  });

  it("blocks plan-confirmation re-ask after user confirmed", () => {
    const planAsk = "How does committing to one hour of distribution per day sound?";
    expect(paraphraseRepeatsStaleCoachAsk(planAsk, planAsk)).toBe(true);
    expect(
      paraphraseRepeatsStaleCoachAsk("How does staying committed to this plan feel?", planAsk)
    ).toBe(true);
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

describe("answered-prior-ask close-loop eligibility", () => {
  it("eligible when last_ask_satisfied yes and user answered scheduling detail", () => {
    const tu = reconciledFamily();
    const det = buildInboundMeaningFacts({
      rawInbound: "3pm",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "What time will you schedule the family connection?",
    });
    expect(
      isAnsweredPriorAskCloseLoopEligible({
        reconciled: tu,
        inboundMeaning: det,
        rawInbound: "3pm",
        latestAnswerAfterOpenQuestion: "3pm",
      })
    ).toBe(true);
  });

  it("not eligible for trivial short acknowledgement", () => {
    const tu = reconciledFamily();
    expect(
      isAnsweredPriorAskCloseLoopEligible({
        reconciled: tu,
        rawInbound: "ok",
        currentInboundIsShortAcknowledgement: true,
      })
    ).toBe(false);
  });

  it("not eligible when prior ask was not answered", () => {
    const det = buildInboundMeaningFacts({
      rawInbound: "maybe later",
      classifierEventType: "user_partial",
    });
    const tu = reconcileTurnUnderstanding({
      proposal: {
        ...familyProposal(),
        relationship_meaning: "unclear",
        last_ask_satisfied: "no",
        answered_last_coach_ask: "no",
        stale_ask_risk: true,
        do_not_repeat_asks: [],
        response_intent: "unclear_clarify",
        confidence: 0.9,
      },
      deterministicMeaning: det,
      latestCoachQuestion: CALENDAR_ASK,
    });
    expect(
      isAnsweredPriorAskCloseLoopEligible({
        reconciled: tu,
        inboundMeaning: det,
        rawInbound: "maybe later",
      })
    ).toBe(false);
  });
});

describe("resolveStaleAskViolationWithRepair — close-loop", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    staleAskRepairMock.mockReset();
  });

  it("repairs satisfied-ask stale re-ask without hard-coded SMS", async () => {
    staleAskRepairMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "Sounds good — afternoon works for that connection.",
              used_strategy: "close_loop",
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const tu = reconciledFamily();
    const violation = detectReconciledTurnUnderstandingStaleAskViolation(
      "When will you put family on the calendar?",
      { reconciled: tu, latestOpenQuestion: CALENDAR_ASK }
    );
    expect(violation.violation).toBe(true);

    const resolved = await resolveStaleAskViolationWithRepair({
      body: "When will you put family on the calendar?",
      violation,
      reconciled: tu,
      latestOpenQuestion: CALENDAR_ASK,
      rawInbound: "Yes. Visiting family in Ohio with plans tomorrow.",
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Yes. Visiting family in Ohio with plans tomorrow.",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: CALENDAR_ASK,
      }),
      recheckStaleAsk: (candidate) =>
        detectReconciledTurnUnderstandingStaleAskViolation(candidate, {
          reconciled: tu,
          latestOpenQuestion: CALENDAR_ASK,
        }),
    });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.body.length).toBeGreaterThan(8);
      expect(resolved.body.toLowerCase()).not.toMatch(/put.*calendar/);
      expect(resolved.repairMeta.answered_prior_ask_close_loop_repair_eligible).toBe(true);
      expect(resolved.repairMeta.answered_prior_ask_close_loop_repair_succeeded).toBe(true);
    }

    const systemMsg = staleAskRepairMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("CLOSE-LOOP REPAIR");
    expect(systemMsg).not.toContain("Got it — 3pm");
  });

  it("still no-sends when repair keeps re-asking stale ask", async () => {
    staleAskRepairMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "Are you ready to schedule that family connection?",
              used_strategy: "close_loop",
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const tu = reconciledFamily();
    const violation = detectReconciledTurnUnderstandingStaleAskViolation(
      "Let me know when you put family time on your calendar.",
      { reconciled: tu, latestOpenQuestion: CALENDAR_ASK }
    );

    const resolved = await resolveStaleAskViolationWithRepair({
      body: "Let me know when you put family time on your calendar.",
      violation,
      reconciled: tu,
      latestOpenQuestion: CALENDAR_ASK,
      rawInbound: "Yes. Visiting family in Ohio with plans tomorrow.",
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Yes. Visiting family in Ohio with plans tomorrow.",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: CALENDAR_ASK,
      }),
      recheckStaleAsk: (candidate) =>
        detectReconciledTurnUnderstandingStaleAskViolation(candidate, {
          reconciled: tu,
          latestOpenQuestion: CALENDAR_ASK,
        }),
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.repairMeta.turn_understanding_stale_ask_repair_succeeded).toBe(false);
  });

  it("applyInboundFinalBodyTurnUnderstandingGuardAsync close-loop repairs before truth guard", async () => {
    staleAskRepairMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "Sounds like family time tomorrow is covered — enjoy Ohio.",
              used_strategy: "close_loop",
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const tu = reconciledFamily();
    const ctx = {
      ...emptyInboundTurnUnderstandingContext(),
      didRun: true,
      reconciled: tu,
      inboundMeaningForPersist: buildInboundMeaningFacts({
        rawInbound:
          "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: CALENDAR_ASK,
      }),
    };

    const r = await applyInboundFinalBodyTurnUnderstandingGuardAsync({
      body: "When will you put family on the calendar?",
      context: ctx,
      latestOpenQuestion: CALENDAR_ASK,
      rawInbound:
        "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.",
      inboundMeaning: ctx.inboundMeaningForPersist,
      stage: "pre_truth_guard",
    });

    expect(r.shouldSend).toBe(true);
    expect(r.noSendReason).toBeNull();
    expect(r.metadata.answered_prior_ask_close_loop_repair_succeeded).toBe(true);
    expect(r.metadata.final_body_guard_stage).toBe("pre_truth_guard");
    expect(r.body.toLowerCase()).not.toMatch(/put.*calendar/);
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
