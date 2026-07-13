import { describe, expect, it } from "vitest";

import {
  deriveRecommitSameVisibleContractRoutePolicy,
  isPlanAffirmingDailySatisfiedAskContext,
  RECOMMIT_SAME_VISIBLE_CONTRACT_SUPPRESSION_INTERNAL,
  resolveDailySatisfiedAskContext,
  shouldSuppressSameBaseRecommitForSatisfiedPlan,
  slimDailySatisfiedAskContextForTelemetry,
  type DailySatisfiedAskContext,
} from "@/lib/daily-satisfied-ask-context";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const CALENDAR_ASK =
  "let me know if you're ready to put one family connection on the calendar for tomorrow";

function telemetryEvent(overrides?: Partial<V2EventRowForAi["payload_json"]>): V2EventRowForAi {
  return {
    event_type: "sms_memory_signal",
    occurred_at: "2026-07-06T18:00:00.000Z",
    payload_json: {
      inbound_turn_telemetry: true,
      turn_understanding_last_ask_satisfied: "yes",
      do_not_repeat_asks: [CALENDAR_ASK],
      turn_understanding_stale_ask_violation_detected: true,
      prior_question_type: null,
      turn_understanding_relationship_meaning: "plan_made",
      turn_understanding_response_intent: "acknowledge_prior_ask_satisfied",
      raw_body_preview: "Call Bond about 12PM tomorrow",
      outcome_proof_eligible: false,
      ...overrides,
    },
  };
}

function coachingFitTelemetryEvent(
  overrides?: Partial<V2EventRowForAi["payload_json"]>
): V2EventRowForAi {
  return {
    event_type: "sms_memory_signal",
    occurred_at: "2026-07-08T14:00:00.000Z",
    payload_json: {
      inbound_turn_telemetry: true,
      turn_understanding_relationship_meaning: "coaching_fit_feedback",
      turn_understanding_response_intent: "repair_coaching_fit",
      turn_understanding_last_ask_satisfied: "no",
      do_not_repeat_asks: ["Did you start the meeting with a clear agenda today?"],
      raw_body_preview: "These messages are not landing.",
      outcome_proof_eligible: false,
      ...overrides,
    },
  };
}

describe("resolveDailySatisfiedAskContext", () => {
  it("reads satisfied-ask truth from inbound_turn_telemetry events", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent()],
    });
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.do_not_repeat_asks).toContain(CALENDAR_ASK);
    expect(ctx?.evidence_preview).toMatch(/Bond/i);
    expect(ctx?.satisfied_ask_type).toBe("plan_detail");
    expect(ctx?.occurred_at).toBe("2026-07-06T18:00:00.000Z");
  });

  it("prefers inbound telemetry over lower-authority thread projection", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent()],
      latestOpenQuestion: "Different stale question?",
      latestAnswerAfterOpenQuestion: "Some other answer",
      openQuestionPending: false,
      doNotRepeatPhrases: ["different phrase"],
    });
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.do_not_repeat_asks[0]).toMatch(/family connection on the calendar/i);
  });

  it("falls back to thread projection when no telemetry", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [],
      latestOpenQuestion: CALENDAR_ASK,
      latestAnswerAfterOpenQuestion: "I'll call Bond about 12PM tomorrow",
      openQuestionPending: false,
      doNotRepeatPhrases: [],
    });
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.source).toBe("thread_projection");
    expect(ctx?.satisfied_ask_type).toBe("plan_detail");
  });

  it("does not authorize proof from satisfied-ask context alone", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent({ outcome_proof_eligible: false })],
    });
    expect(ctx?.outcome_proof_eligible).toBe(false);
    expect(ctx?.persistence_note).toMatch(/does not authorize proof/i);

    const threadCtx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [],
      latestOpenQuestion: CALENDAR_ASK,
      latestAnswerAfterOpenQuestion: "Call Bond about 12PM tomorrow",
      openQuestionPending: false,
    });
    expect(threadCtx?.outcome_proof_eligible).toBe(false);
    expect(threadCtx?.persistence_note).toMatch(/not proof/i);
  });

  it("returns null when no satisfied ask signals exist", () => {
    expect(
      resolveDailySatisfiedAskContext({
        eventsNewestFirst: [],
        openQuestionPending: true,
      })
    ).toBeNull();
  });

  it("P2a: prefers top-level last_ask + DNR even when older nested guard fields differ", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [
        telemetryEvent({
          turn_understanding_last_ask_satisfied: "yes",
          do_not_repeat_asks: ["make your next life story list"],
          turn_understanding_stale_ask_violation_detected: false,
        }),
      ],
    });
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.last_ask_satisfied).toBe("yes");
    expect(ctx?.do_not_repeat_asks).toContain("make your next life story list");
  });

  it("P2a: older payloads with only DNR + stale risk still resolve", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [
        telemetryEvent({
          // simulate older writer that never set last_ask
          turn_understanding_last_ask_satisfied: undefined,
          do_not_repeat_asks: [CALENDAR_ASK],
          turn_understanding_stale_ask_violation_detected: true,
        }),
      ],
    });
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.do_not_repeat_asks).toContain(CALENDAR_ASK);
  });
});

describe("coaching_fit_feedback telemetry pass-through", () => {
  it("maps inbound_turn_telemetry coaching_fit_feedback into DailySatisfiedAskContext for daily notebook", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [coachingFitTelemetryEvent()],
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.relationship_meaning).toBe("coaching_fit_feedback");
    expect(ctx?.response_intent).toBe("repair_coaching_fit");
    expect(ctx?.evidence_preview).toBe("These messages are not landing.");
    expect(ctx?.do_not_repeat_asks).toContain(
      "Did you start the meeting with a clear agenda today?"
    );
    expect(ctx?.occurred_at).toBe("2026-07-08T14:00:00.000Z");
    expect(ctx?.persistence_note).toMatch(/not proof or outcome write/i);
  });

  it("does not treat coaching-fit context as satisfied ask, proof, or plan affirmation", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [coachingFitTelemetryEvent()],
    });

    expect(ctx?.has_satisfied_recent_ask).toBe(false);
    expect(ctx?.satisfied_ask_type).toBe("unknown");
    expect(ctx?.last_ask_satisfied).toBe("unclear");
    expect(ctx?.outcome_proof_eligible).toBe(false);
    expect(isPlanAffirmingDailySatisfiedAskContext(ctx)).toBe(false);
    expect(ctx?.prior_question_type).toBeNull();
  });

  it("uses stored TU enum fields, not raw body text — variant without relevant", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [
        coachingFitTelemetryEvent({
          raw_body_preview: "You're missing what I actually need.",
          message: "You're missing what I actually need.",
        }),
      ],
    });

    expect(ctx?.relationship_meaning).toBe("coaching_fit_feedback");
    expect(ctx?.response_intent).toBe("repair_coaching_fit");
    expect(ctx?.evidence_preview).toMatch(/missing what I actually need/i);
    expect(ctx?.evidence_preview?.toLowerCase()).not.toContain("relevant");
  });

  it("does not infer coaching fit from complaint-like preview when TU meaning is not coaching_fit_feedback", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [
        {
          event_type: "sms_memory_signal",
          occurred_at: "2026-07-08T14:00:00.000Z",
          payload_json: {
            inbound_turn_telemetry: true,
            turn_understanding_relationship_meaning: "miss",
            turn_understanding_response_intent: "tell_truth_and_recover",
            turn_understanding_last_ask_satisfied: "no",
            raw_body_preview: "These messages are not relevant.",
            outcome_proof_eligible: false,
          },
        },
      ],
    });

    expect(ctx?.relationship_meaning).not.toBe("coaching_fit_feedback");
    expect(ctx).toBeNull();
  });

  it("prefers coaching-fit telemetry over lower-authority thread projection", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [coachingFitTelemetryEvent()],
      latestOpenQuestion: CALENDAR_ASK,
      latestAnswerAfterOpenQuestion: "I'll call Bond about 12PM tomorrow",
      openQuestionPending: false,
    });

    expect(ctx?.relationship_meaning).toBe("coaching_fit_feedback");
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.has_satisfied_recent_ask).toBe(false);
  });
});

describe("shouldSuppressSameBaseRecommitForSatisfiedPlan", () => {
  const baseBar = "One hour of distribution per day";

  function planConfirmationContext(
    overrides?: Partial<DailySatisfiedAskContext>
  ): DailySatisfiedAskContext {
    return {
      has_satisfied_recent_ask: true,
      satisfied_ask_type: "plan_confirmation",
      do_not_repeat_asks: ["Does morning distribution still work for you?"],
      evidence_preview:
        "I think if I do distribution first thing in the morning, we'll get the 30 minutes done each day.",
      source: "inbound_turn_telemetry",
      occurred_at: "2026-07-06T18:00:00.000Z",
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      relationship_meaning: "plan_made",
      response_intent: "acknowledge_prior_ask_satisfied",
      prior_question_type: "plan_confirmation",
      outcome_proof_eligible: false,
      persistence_note: "no proof",
      ...overrides,
    };
  }

  it("suppresses same-base recommit_same when plan_confirmation satisfied", () => {
    const r = shouldSuppressSameBaseRecommitForSatisfiedPlan({
      nextMoveType: "recommit_same",
      satisfiedAskContext: planConfirmationContext(),
      proposedBarText: baseBar,
      baseBehaviorStatement: baseBar,
    });
    expect(r.suppress).toBe(true);
    expect(r.reason).toBe("satisfied_plan_already_affirmed");
  });

  it("does not suppress shrink_ask or hold_standard", () => {
    const ctx = planConfirmationContext();
    expect(
      shouldSuppressSameBaseRecommitForSatisfiedPlan({
        nextMoveType: "shrink_ask",
        satisfiedAskContext: ctx,
        proposedBarText: baseBar,
        baseBehaviorStatement: baseBar,
      }).suppress
    ).toBe(false);
    expect(
      shouldSuppressSameBaseRecommitForSatisfiedPlan({
        nextMoveType: "hold_standard",
        satisfiedAskContext: ctx,
        proposedBarText: baseBar,
        baseBehaviorStatement: baseBar,
      }).suppress
    ).toBe(false);
  });

  it("does not suppress recommit_same without satisfied plan context", () => {
    expect(
      shouldSuppressSameBaseRecommitForSatisfiedPlan({
        nextMoveType: "recommit_same",
        satisfiedAskContext: null,
        proposedBarText: baseBar,
        baseBehaviorStatement: baseBar,
      }).suppress
    ).toBe(false);
  });

  it("does not suppress when proposed bar differs from base", () => {
    expect(
      shouldSuppressSameBaseRecommitForSatisfiedPlan({
        nextMoveType: "recommit_same",
        satisfiedAskContext: planConfirmationContext(),
        proposedBarText: "Thirty minutes of distribution per day",
        baseBehaviorStatement: baseBar,
      }).suppress
    ).toBe(false);
  });

  it("does not suppress outcome_answer satisfied context", () => {
    expect(
      shouldSuppressSameBaseRecommitForSatisfiedPlan({
        nextMoveType: "recommit_same",
        satisfiedAskContext: planConfirmationContext({
          satisfied_ask_type: "outcome_answer",
          prior_question_type: "outcome_check",
          relationship_meaning: "reported_completion",
          evidence_preview: "Yes I got it done yesterday.",
        }),
        proposedBarText: baseBar,
        baseBehaviorStatement: baseBar,
      }).suppress
    ).toBe(false);
    expect(
      isPlanAffirmingDailySatisfiedAskContext(
        planConfirmationContext({
          satisfied_ask_type: "outcome_answer",
          prior_question_type: "outcome_check",
        })
      )
    ).toBe(false);
  });
});

describe("deriveRecommitSameVisibleContractRoutePolicy", () => {
  const baseBar = "One hour of distribution per day";

  function planConfirmationContext(): DailySatisfiedAskContext {
    return {
      has_satisfied_recent_ask: true,
      satisfied_ask_type: "plan_confirmation",
      do_not_repeat_asks: ["Does morning distribution still work for you?"],
      evidence_preview:
        "I think if I do distribution first thing in the morning, we'll get the 30 minutes done each day.",
      source: "inbound_turn_telemetry",
      occurred_at: "2026-07-06T18:00:00.000Z",
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      relationship_meaning: "plan_made",
      response_intent: "acknowledge_prior_ask_satisfied",
      prior_question_type: "plan_confirmation",
      outcome_proof_eligible: false,
      persistence_note: "no proof",
    };
  }

  it("recommit_same is always internal-only with no satisfied context", () => {
    const r = deriveRecommitSameVisibleContractRoutePolicy({
      nextMoveType: "recommit_same",
      satisfiedAskContext: null,
      proposedBarText: baseBar,
      baseBehaviorStatement: baseBar,
    });
    expect(r.recommitProposalMode).toBe(false);
    expect(r.recommitSameVisibleContractSuppressed).toBe(true);
    expect(r.recommitSameVisibleContractSuppressionReason).toBe(
      RECOMMIT_SAME_VISIBLE_CONTRACT_SUPPRESSION_INTERNAL
    );
    expect(r.useHoldStandardOutboundNextMove).toBe(true);
    expect(r.recommitSameSuppressedForSatisfiedPlan).toBe(false);
  });

  it("recommit_same + plan_confirmation uses satisfied_plan metadata reason", () => {
    const ctx = planConfirmationContext();
    const r = deriveRecommitSameVisibleContractRoutePolicy({
      nextMoveType: "recommit_same",
      satisfiedAskContext: ctx,
      proposedBarText: baseBar,
      baseBehaviorStatement: baseBar,
    });
    expect(r.recommitProposalMode).toBe(false);
    expect(r.recommitSameVisibleContractSuppressed).toBe(true);
    expect(r.recommitSameVisibleContractSuppressionReason).toBe("satisfied_plan_already_affirmed");
    expect(r.recommitSameSuppressedForSatisfiedPlan).toBe(true);
    expect(r.recommitSameSuppressionReason).toBe("satisfied_plan_already_affirmed");
    expect(ctx.has_satisfied_recent_ask).toBe(true);
    expect(ctx.stale_ask_risk).toBe(true);
  });

  it("shrink_ask does not trigger visible recommit suppression policy", () => {
    const r = deriveRecommitSameVisibleContractRoutePolicy({
      nextMoveType: "shrink_ask",
      satisfiedAskContext: planConfirmationContext(),
      proposedBarText: baseBar,
      baseBehaviorStatement: baseBar,
    });
    expect(r.recommitProposalMode).toBe(false);
    expect(r.recommitSameVisibleContractSuppressed).toBe(false);
    expect(r.useHoldStandardOutboundNextMove).toBe(false);
  });

  it("satisfied ask context remains available for C1 fallback when recommit_same is internal", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [
        {
          event_type: "sms_memory_signal",
          occurred_at: "2026-07-06T18:00:00.000Z",
          payload_json: {
            inbound_turn_telemetry: true,
            turn_understanding_last_ask_satisfied: "yes",
            do_not_repeat_asks: ["Does morning distribution still work for you?"],
            prior_question_type: "plan_confirmation",
            turn_understanding_relationship_meaning: "plan_made",
            raw_body_preview:
              "I think if I do distribution first thing in the morning, we're good.",
            outcome_proof_eligible: false,
          },
        },
      ],
    });
    const policy = deriveRecommitSameVisibleContractRoutePolicy({
      nextMoveType: "recommit_same",
      satisfiedAskContext: ctx,
      proposedBarText: baseBar,
      baseBehaviorStatement: baseBar,
    });
    expect(policy.recommitProposalMode).toBe(false);
    expect(policy.recommitSameVisibleContractSuppressed).toBe(true);
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.satisfied_ask_type).toBe("plan_confirmation");
    expect(ctx?.do_not_repeat_asks.length).toBeGreaterThan(0);
  });
});

describe("slimDailySatisfiedAskContextForTelemetry", () => {
  it("emits compact observability fields", () => {
    const ctx: DailySatisfiedAskContext = {
      has_satisfied_recent_ask: true,
      satisfied_ask_type: "plan_detail",
      do_not_repeat_asks: [CALENDAR_ASK],
      evidence_preview: "Call Bond about 12PM tomorrow",
      source: "inbound_turn_telemetry",
      occurred_at: "2026-07-06T18:00:00.000Z",
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      relationship_meaning: "plan_made",
      response_intent: "acknowledge_prior_ask_satisfied",
      prior_question_type: "plan_confirmation",
      outcome_proof_eligible: false,
      persistence_note: "no proof",
    };
    expect(slimDailySatisfiedAskContextForTelemetry(ctx)).toEqual({
      has_satisfied_recent_ask: true,
      satisfied_ask_type: "plan_detail",
      do_not_repeat_asks_count: 1,
      daily_satisfied_ask_context_source: "inbound_turn_telemetry",
      evidence_preview: "Call Bond about 12PM tomorrow",
      occurred_at: "2026-07-06T18:00:00.000Z",
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      prior_question_type: "plan_confirmation",
      outcome_proof_eligible: false,
    });
  });
});
