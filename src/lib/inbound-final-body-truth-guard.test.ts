import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  reconcileTurnUnderstanding,
  type OpenAIRelationshipTurnUnderstandingV1,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  applyInboundCoachFinalBodyGuards,
  detectUnsupportedAccountabilityClaimInOutbound,
  evidenceAllowsOutcomeClaim,
} from "@/lib/inbound-final-body-truth-guard";
import {
  emptyInboundTurnUnderstandingContext,
  paraphraseRepeatsStaleCoachAsk,
} from "@/lib/inbound-turn-understanding-context";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);

const PLAN_STALE_ASK =
  "how does staying committed to this plan feel for the rest of the week";

function stepsCompletionProposal(): OpenAIRelationshipTurnUnderstandingV1 {
  return {
    version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    user_turn_summary: "Got steps in today playing basketball.",
    evidence_quotes: ["I got my steps in today"],
    relationship_meaning: "reported_completion",
    answered_last_coach_ask: "yes",
    last_ask_satisfied: "yes",
    satisfaction_kind: "reported_outcome",
    do_not_repeat_asks: [PLAN_STALE_ASK],
    stale_ask_risk: true,
    commitment_outcome_recommendation: "write_user_yes_today",
    persistence_safety: "safe_to_write",
    response_intent: "acknowledge_completion",
    temporal_scope: "today",
    reported_for_day_key: null,
    confidence: 0.92,
    uncertainty_flags: [],
    route_priority_recommendation: "none",
    safety_or_support_flags: [],
  };
}

function reconciledStepsCompletion(rawInbound: string) {
  const det = buildInboundMeaningFacts({
    rawInbound,
    classifierEventType: "user_yes",
    openQuestionPending: true,
    latestOpenQuestion: PLAN_STALE_ASK,
  });
  return reconcileTurnUnderstanding({
    proposal: stepsCompletionProposal(),
    deterministicMeaning: det,
    latestCoachQuestion: PLAN_STALE_ASK,
  });
}

describe("stale ask safe follow-ups", () => {
  it("H: allows what helped you get your steps in today", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "What helped you get your steps in today?",
        PLAN_STALE_ASK
      )
    ).toBe(false);
  });

  it("I: allows what will help you protect that noon call", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "Good — noon with Bond is clear. What will help you protect that call?",
        PLAN_STALE_ASK
      )
    ).toBe(false);
  });

  it("J: allows reflection follow-up about feelings", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "That sounds like you gave them space to talk. What did you notice?",
        PLAN_STALE_ASK
      )
    ).toBe(false);
  });

  it("K: blocks stale plan continuation ask", () => {
    expect(
      paraphraseRepeatsStaleCoachAsk(
        "How do you feel about continuing the plan for the rest of the week?",
        PLAN_STALE_ASK
      )
    ).toBe(true);
  });
});

describe("applyInboundCoachFinalBodyGuards stale ask repair", () => {
  beforeEach(() => {
    repairMock.mockReset();
  });

  it("E: repairs stale plan tail on completion acknowledgement", async () => {
    const raw = "I got my steps in today- I played basketball with the kids";
    const tu = reconciledStepsCompletion(raw);
    const ctx = {
      ...emptyInboundTurnUnderstandingContext(),
      didRun: true,
      reconciled: tu,
      proposal: tu.proposal,
      inboundMeaningForPersist: buildInboundMeaningFacts({
        rawInbound: raw,
        classifierEventType: "user_yes",
        latestOpenQuestion: PLAN_STALE_ASK,
      }),
    };
    const staleBody =
      "Great job getting your steps in today! How do you feel about your plan for the rest of the week?";
    repairMock.mockResolvedValueOnce({
      body: "Great job getting your steps in today playing basketball with the kids.",
      openAiOk: true,
      metadata: { used_strategy: "lane_compress" },
    });

    const r = await applyInboundCoachFinalBodyGuards({
      body: staleBody,
      turnUnderstandingContext: ctx,
      latestOpenQuestion: PLAN_STALE_ASK,
      evidence: {
        rawInbound: raw,
        latestOpenQuestion: PLAN_STALE_ASK,
        inboundMeaning: ctx.inboundMeaningForPersist,
        turnUnderstandingReconciled: tu,
        willPersistOutcomeThisTurn: true,
      },
      stage: "post_final_voice_gate",
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("rest of the week");
    expect(r.tuGuard.metadata.turn_understanding_stale_ask_repair_succeeded).toBe(true);
  });

  it("F: no-send when repair still repeats stale plan question", async () => {
    const raw = "I got my steps today";
    const tu = reconciledStepsCompletion(raw);
    const ctx = {
      ...emptyInboundTurnUnderstandingContext(),
      didRun: true,
      reconciled: tu,
      proposal: tu.proposal,
    };
    const staleBody =
      "Nice work today. How do you feel about continuing the plan for the rest of the week?";
    repairMock.mockResolvedValueOnce({
      body: "How do you feel about continuing the plan for the rest of the week?",
      openAiOk: true,
      metadata: {},
    });

    const r = await applyInboundCoachFinalBodyGuards({
      body: staleBody,
      turnUnderstandingContext: ctx,
      latestOpenQuestion: PLAN_STALE_ASK,
      evidence: { rawInbound: raw, turnUnderstandingReconciled: tu },
    });

    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("turn_understanding_stale_ask_blocked");
    expect(r.tuGuard.metadata.turn_understanding_stale_ask_repair_attempted).toBe(true);
    expect(r.tuGuard.metadata.turn_understanding_stale_ask_repair_succeeded).toBe(false);
  });

  it("G: OCEG blocks repair that introduces unsupported completion claim", async () => {
    const raw = "Sure";
    const det = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: PLAN_STALE_ASK,
    });
    const tu = reconcileTurnUnderstanding({
      proposal: {
        ...stepsCompletionProposal(),
        relationship_meaning: "plan_made",
        commitment_outcome_recommendation: "no_outcome_write",
        persistence_safety: "do_not_write_but_acknowledge",
        response_intent: "acknowledge_plan_detail",
      },
      deterministicMeaning: det,
      latestCoachQuestion: PLAN_STALE_ASK,
    });
    const ctx = {
      ...emptyInboundTurnUnderstandingContext(),
      didRun: true,
      reconciled: tu,
      proposal: tu.proposal,
      inboundMeaningForPersist: det,
    };
    repairMock
      .mockResolvedValueOnce({
        body: "Great to hear you got your steps in today!",
        openAiOk: true,
        metadata: {},
      })
      .mockResolvedValueOnce({
        body: "Thanks for confirming.",
        openAiOk: true,
        metadata: {},
      });

    const r = await applyInboundCoachFinalBodyGuards({
      body: "How do you feel about continuing the plan for the rest of the week?",
      turnUnderstandingContext: ctx,
      latestOpenQuestion: PLAN_STALE_ASK,
      evidence: {
        rawInbound: raw,
        turnUnderstandingReconciled: tu,
        inboundMeaning: det,
      },
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe("Thanks for confirming.");
    expect(r.truthGuard?.metadata.unsupported_accountability_claim_repair_succeeded).toBe(true);
  });
});

describe("evidenceAllowsOutcomeClaim", () => {
  it("allows completion claim when inbound has explicit steps clause", () => {
    expect(
      evidenceAllowsOutcomeClaim("completion", {
        rawInbound: "I got my steps today",
      })
    ).toBe(true);
  });

  it("blocks unsupported completion for contextless yes", () => {
    expect(
      evidenceAllowsOutcomeClaim("completion", {
        rawInbound: "Yes",
        inboundMeaning: buildInboundMeaningFacts({
          rawInbound: "Yes",
          classifierEventType: "user_yes",
        }),
      })
    ).toBe(false);
  });
});

describe("detectUnsupportedAccountabilityClaimInOutbound", () => {
  it("does not flag question-ending bodies", () => {
    expect(
      detectUnsupportedAccountabilityClaimInOutbound("Did you get your steps in?", {
        rawInbound: "Yes",
      })
    ).toBeNull();
  });
});
