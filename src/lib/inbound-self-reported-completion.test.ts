import { describe, expect, it } from "vitest";
import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  evaluateCompletionAlignmentForProof,
  evaluateSemanticCompletionAlignmentFromTurnUnderstanding,
  isCommitmentAlignedRoutineStatusUpdateCompletion,
  isSubstantiveSelfReportedCompletionForProof,
} from "@/lib/inbound-self-reported-completion";
import {
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  reconcileTurnUnderstanding,
  type OpenAIRelationshipTurnUnderstandingV1,
} from "@/lib/openai-relationship-turn-understanding-v1";

const TYLER_DISTRIBUTION_COMPLETION =
  "I got my distribution done today! I hit the goal! Woo hoo!";

const BROOKE_STEPS_COMPLETION =
  "I got my 10,000 steps today though! And I did it before we had a birthday party to go to";

const TENNESSEE_FUTURE_CONFIDENCE =
  "We're heading to Tennessee on Thursday. We live in Ohio and we're driving to Tennessee with all three kids so it'll throw us off our routine a little bit but I should still be able to hit the goals";

describe("isSubstantiveSelfReportedCompletionForProof", () => {
  const trueCases = [
    "I hit my goal today",
    "I hit the goal",
    "I got my distribution done today",
    "I got my workout done today",
    "I completed my run today",
    "I completed today's commitment",
    "I finished my goal",
    "I got it done",
    "Finished my goal",
    "Did my hour",
    "Just finished another 2 miles",
    TYLER_DISTRIBUTION_COMPLETION,
    BROOKE_STEPS_COMPLETION,
    "I got my 10,000 steps today",
    "I got my 10,000 steps in today",
    "I got my steps in today",
    "I got in 2 miles today",
    "I got my 2 miles in",
    "I got the 2 miles done",
    "I got my workout in",
    "I got my run in",
    "I got my walk in",
    "I got my calls done",
    "I got my distribution done",
    "I'm going to run 2 miles again in the morning. I completed my run today.",
  ];

  it.each(trueCases)("%s → true", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text)).toBe(true);
  });

  const falseCases = [
    "Yes",
    "Yep",
    "OK",
    "Sounds good",
    "Love it",
    "Done",
    "I'll hit it later",
    "I'm going to do it",
    "I will get it done",
    "I plan to finish tomorrow",
    "I want to change my goal",
    "I need to cancel my subscription",
    "STOP",
    TENNESSEE_FUTURE_CONFIDENCE,
    "I should still be able to hit the goals",
    "I should be able to hit the goal",
    "I will hit the goal",
    "I'm going to hit the goal",
    "I plan to hit it tomorrow",
    "I should be able to get it done",
    "I'll get it done later",
    "I haven't hit it yet",
  ];

  it.each(falseCases)("%s → false", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text)).toBe(false);
  });
});

describe("isCommitmentAlignedRoutineStatusUpdateCompletion", () => {
  const wakeCommitment = {
    commitmentBehaviorStatement: "Wake up on time without snoozing",
    effectiveAsk: "Get out of bed when the alarm goes off",
  };
  const readingCommitment = {
    commitmentBehaviorStatement: "Read for 30 minutes before bed",
    effectiveAsk: "Read tonight",
  };
  const statusText = "Getting up, showered, and ready for the day";

  it("allows wake-up/shower routine status when commitment aligns", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: statusText,
        ...wakeCommitment,
      })
    ).toBe(true);
    expect(isSubstantiveSelfReportedCompletionForProof(statusText, wakeCommitment)).toBe(true);
  });

  it("blocks the same status update when commitment does not align", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: statusText,
        ...readingCommitment,
      })
    ).toBe(false);
    expect(isSubstantiveSelfReportedCompletionForProof(statusText, readingCommitment)).toBe(false);
  });

  it("blocks future-intent routine phrasing", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: "I will get up and shower later",
        ...wakeCommitment,
      })
    ).toBe(false);
  });

  it("blocks scheduling/time answer Yes at 2pm", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: "Yes at 2pm",
        ...wakeCommitment,
      })
    ).toBe(false);
    expect(isSubstantiveSelfReportedCompletionForProof("Yes at 2pm", wakeCommitment)).toBe(false);
  });
});

describe("completion alignment with active step commitment", () => {
  const stepCommitment = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  it.each([
    "I got my 10,000 steps today",
    "I walked 10,000 steps",
    "I got 10,000 steps by cleaning",
  ])("%s → substantive + aligned", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text, stepCommitment)).toBe(true);
    expect(evaluateCompletionAlignmentForProof(text, stepCommitment).aligned).toBe(true);
  });

  it.each([
    "I brushed my teeth today",
    "Well I hit my goal of brushing my teeth",
    "I completed my goal of brushing my teeth",
    "I met my goal of brushing my teeth",
  ])("%s → not substantive or not aligned", (text) => {
    const substantive = isSubstantiveSelfReportedCompletionForProof(text, stepCommitment);
    const alignment = evaluateCompletionAlignmentForProof(text, stepCommitment);
    expect(substantive || alignment.aligned).toBe(false);
    if (/\bgoal\s+of\b/i.test(text)) {
      expect(alignment.skipReason).toBe("off_goal_completion_claim");
    }
  });
});

describe("Brooke coalesced step completion", () => {
  const stepCommitment = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  const BROOKE_COALESCED =
    "I got my goal this morning while walking the dogs\nI hit 10000 steps already";

  it("Brooke exact coalesced body is substantive aligned completion", () => {
    expect(isSubstantiveSelfReportedCompletionForProof(BROOKE_COALESCED, stepCommitment)).toBe(
      true
    );
    expect(evaluateCompletionAlignmentForProof(BROOKE_COALESCED, stepCommitment).aligned).toBe(
      true
    );
  });

  it("I hit 10000 steps already alone is substantive for step commitment", () => {
    expect(
      isSubstantiveSelfReportedCompletionForProof("I hit 10000 steps already", stepCommitment)
    ).toBe(true);
  });

  it("got my goal this morning alone without step metric is not substantive", () => {
    expect(
      isSubstantiveSelfReportedCompletionForProof(
        "I got my goal this morning while walking the dogs",
        stepCommitment
      )
    ).toBe(false);
  });
});

describe("evaluateSemanticCompletionAlignmentFromTurnUnderstanding", () => {
  const prayerCtx = {
    commitmentBehaviorStatement: "Pray for 10 minutes each morning",
    effectiveAsk: "Did you pray today?",
    commitmentTitle: "Morning prayer",
  };

  function tuFor(raw: string, overrides?: Partial<OpenAIRelationshipTurnUnderstandingV1>) {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const proposal: OpenAIRelationshipTurnUnderstandingV1 = {
      version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
      user_turn_summary: "User prayed today.",
      evidence_quotes: [raw],
      relationship_meaning: "reported_completion",
      answered_last_coach_ask: "yes",
      last_ask_satisfied: "no",
      satisfaction_kind: "not_satisfied",
      do_not_repeat_asks: [],
      stale_ask_risk: false,
      commitment_outcome_recommendation: "write_user_yes_today",
      persistence_safety: "safe_to_write",
      response_intent: "acknowledge_completion",
      temporal_scope: "today",
      reported_for_day_key: null,
      confidence: 0.92,
      uncertainty_flags: [],
      route_priority_recommendation: "none",
      safety_or_support_flags: [],
      ...overrides,
    };
    return reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: inboundMeaning,
      inboundBody: raw,
    });
  }

  it("returns high-confidence aligned completed_today for I prayed today", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw),
      deterministicMeaning: inboundMeaning,
    });
    expect(result).toMatchObject({
      checked: true,
      completion_claimed: true,
      alignment: "aligned",
      confidence: "high",
      tense: "completed_today",
    });
  });

  it("blocks medium-confidence TU completion", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { confidence: 0.65 }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.completion_claimed).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.reason).toBe("tu_confidence_medium");
  });

  it("does not check when deterministic already write_user_yes_today", () => {
    const raw = "I got my faith time in today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.checked).toBe(false);
    expect(result.reason).toBe("deterministic_write_user_yes_already");
  });

  it("blocks high-confidence TU when evidence quotes are missing", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { evidence_quotes: [] }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.reason).toBe("tu_evidence_not_grounded_in_inbound");
    expect(result.completion_claimed).toBe(false);
  });

  it("blocks high-confidence TU when evidence quote is not present in inbound body", () => {
    const raw = "I thought about praying.";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { evidence_quotes: ["I prayed today."] }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.reason).toBe("tu_evidence_not_grounded_in_inbound");
    expect(result.completion_claimed).toBe(false);
  });

  it("blocks high-confidence TU when evidence is model-invented paraphrase not in inbound", () => {
    const raw = "I got time with the Lord this morn";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, {
        evidence_quotes: ["I spent time with God this morning"],
      }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.reason).toBe("tu_evidence_not_grounded_in_inbound");
    expect(result.completion_claimed).toBe(false);
  });

  it("blocks semantic unlock when TU confidence is missing", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const tu = { ...tuFor(raw), confidence: Number.NaN };
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tu,
      deterministicMeaning: inboundMeaning,
    });
    expect(result.completion_claimed).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.reason).toBe("tu_confidence_low");
  });

  it("blocks semantic unlock at confidence 0.74 (below high threshold)", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { confidence: 0.74 }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.completion_claimed).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.reason).toBe("tu_confidence_medium");
  });

  it("blocks semantic unlock when temporal_scope is missing or unclear", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { temporal_scope: "unclear" }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.reason).toBe("tu_temporal_unclear");
    expect(result.completion_claimed).toBe(false);
  });

  it("blocks semantic unlock when persistence_safety is not safe_to_write", () => {
    const raw = "I prayed today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const result = evaluateSemanticCompletionAlignmentFromTurnUnderstanding({
      rawBody: raw,
      ...prayerCtx,
      reconciledTurnUnderstanding: tuFor(raw, { persistence_safety: "defer_to_server" }),
      deterministicMeaning: inboundMeaning,
    });
    expect(result.reason).toBe("tu_persistence_defer_to_server");
    expect(result.completion_claimed).toBe(false);
  });
});
