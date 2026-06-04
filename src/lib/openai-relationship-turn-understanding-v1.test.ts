import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => openAiCreate(...args),
      },
    };
  },
}));

import {
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  parseOpenAIRelationshipTurnUnderstandingV1,
  reconcileTurnUnderstanding,
  runInboundRelationshipTurnUnderstanding,
  resolveInboundTurnUnderstandingSkipReason,
  shouldSkipInboundTurnUnderstandingRoute,
  type OpenAIRelationshipTurnUnderstandingV1,
} from "@/lib/openai-relationship-turn-understanding-v1";
import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";

function makeValidProposal(
  overrides: Partial<OpenAIRelationshipTurnUnderstandingV1> = {}
): OpenAIRelationshipTurnUnderstandingV1 {
  return {
    version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    user_turn_summary: "User visiting family with plans tomorrow.",
    evidence_quotes: ["visiting with family in Ohio"],
    relationship_meaning: "prior_ask_satisfied",
    answered_last_coach_ask: "yes",
    last_ask_satisfied: "yes",
    satisfaction_kind: "currently_happening",
    do_not_repeat_asks: ["put one family connection on the calendar for tomorrow"],
    stale_ask_risk: true,
    commitment_outcome_recommendation: "no_outcome_write",
    persistence_safety: "defer_to_server",
    response_intent: "acknowledge_prior_ask_satisfied",
    temporal_scope: "today",
    reported_for_day_key: null,
    confidence: 0.88,
    uncertainty_flags: [],
    route_priority_recommendation: "none",
    safety_or_support_flags: [],
    ...overrides,
  };
}

function meaningFor(text: string) {
  return buildInboundMeaningFacts({
    rawInbound: text,
    classifierEventType: "user_yes",
    classifierNormalizedHint: null,
  });
}

describe("parseOpenAIRelationshipTurnUnderstandingV1", () => {
  it("validates a complete schema object", () => {
    const p = makeValidProposal();
    expect(parseOpenAIRelationshipTurnUnderstandingV1(p as unknown as Record<string, unknown>)).toEqual(
      p
    );
  });

  it("rejects invalid enum values", () => {
    const raw = {
      ...makeValidProposal(),
      relationship_meaning: "not_a_real_meaning",
    };
    expect(parseOpenAIRelationshipTurnUnderstandingV1(raw as unknown as Record<string, unknown>)).toBe(
      null
    );
  });

  it("rejects confidence outside 0–1", () => {
    const raw = { ...makeValidProposal(), confidence: 1.5 };
    expect(parseOpenAIRelationshipTurnUnderstandingV1(raw as unknown as Record<string, unknown>)).toBe(
      null
    );
  });

  it("trims evidence_quotes to at most two", () => {
    const raw = {
      ...makeValidProposal(),
      evidence_quotes: ["a", "b", "c"],
    };
    const parsed = parseOpenAIRelationshipTurnUnderstandingV1(raw as unknown as Record<string, unknown>);
    expect(parsed?.evidence_quotes).toEqual(["a", "b"]);
  });

  it("trims do_not_repeat_asks to at most six", () => {
    const raw = {
      ...makeValidProposal(),
      do_not_repeat_asks: ["1", "2", "3", "4", "5", "6", "7", "8"],
    };
    const parsed = parseOpenAIRelationshipTurnUnderstandingV1(raw as unknown as Record<string, unknown>);
    expect(parsed?.do_not_repeat_asks).toHaveLength(6);
  });

  it("rejects empty user_turn_summary", () => {
    const raw = { ...makeValidProposal(), user_turn_summary: "  " };
    expect(parseOpenAIRelationshipTurnUnderstandingV1(raw as unknown as Record<string, unknown>)).toBe(
      null
    );
  });
});

describe("reconcileTurnUnderstanding", () => {
  it("does not allow OpenAI to persist user_yes alone", () => {
    const det = meaningFor(
      "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow."
    );
    const proposal = makeValidProposal({
      commitment_outcome_recommendation: "write_user_yes_today",
      persistence_safety: "safe_to_write",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
    });
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
    expect(r.disagreement_flags).toContain("server_rejected_openai_persistence");
  });

  it("hard route priority overrides proposal", () => {
    const det = meaningFor("STOP");
    const proposal = makeValidProposal({
      response_intent: "acknowledge_prior_ask_satisfied",
      commitment_outcome_recommendation: "write_user_yes_today",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      routePriority: { compliance_or_stop: true },
    });
    expect(r.disagreement_flags).toContain("hard_route_priority_override");
    expect(r.reconciled_response_intent).not.toBe("acknowledge_prior_ask_satisfied");
  });

  it("low confidence clarifies", () => {
    const det = meaningFor("yes");
    const proposal = makeValidProposal({
      confidence: 0.4,
      response_intent: "ask_next_specific_step",
      stale_ask_risk: true,
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "How did your bedtime routine go last night?",
    });
    expect(r.reconciled_response_intent).toBe("unclear_clarify");
    expect(r.disagreement_flags).toContain("low_confidence_clarify");
  });

  it("last_ask_satisfied adds do_not_repeat_asks but no proof write", () => {
    const det = meaningFor("Yes already on");
    const proposal = makeValidProposal({
      last_ask_satisfied: "yes",
      response_intent: "acknowledge_prior_ask_satisfied",
      commitment_outcome_recommendation: "write_user_yes_today",
      persistence_safety: "safe_to_write",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
    });
    expect(r.reconciled_do_not_repeat_asks.length).toBeGreaterThan(0);
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
  });

  it("defers persistence when persistence_safety is not safe_to_write", () => {
    const det = meaningFor("All good for now");
    const proposal = makeValidProposal({
      commitment_outcome_recommendation: "write_user_yes_today",
      persistence_safety: "do_not_write_but_acknowledge",
      response_intent: "close_loop_no_new_action",
      last_ask_satisfied: "yes",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
    });
    expect(r.disagreement_flags).toContain("openai_outcome_write_declined");
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
  });
});

describe("runInboundRelationshipTurnUnderstanding", () => {
  beforeEach(() => {
    openAiCreate.mockReset();
  });

  it("falls back when OpenAI fails without throwing", async () => {
    openAiCreate.mockRejectedValue(new Error("network down"));
    const r = await runInboundRelationshipTurnUnderstanding({
      inboundBody: "Yes already on",
      timezone: "America/Chicago",
      receivedAtIso: new Date().toISOString(),
      classifierEventType: "user_yes",
      classifierNormalizedHint: null,
      effectiveAsk: "Family connection on calendar",
      behaviorStatement: "Connect with family weekly",
      lastCoachOutbound: "put one family connection on the calendar for tomorrow",
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
      latestAnswerAfterOpenQuestion: null,
      openQuestionPending: true,
      expectedReplySemantics: "proposal_yes_no",
      recentThreadExcerpt: "Coach: calendar | User: Yes already on",
      temporalContract: null,
      proofCalloutClaimSavedAllowed: false,
    });
    expect(r).not.toBeNull();
    expect(r?.interpreter_failed_reason).toBeTruthy();
    expect(r?.reconciled_persistence_decision).toBeDefined();
  });

  it("uses abort signal and returns timeout reason on abort", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    openAiCreate.mockImplementation(
      (_opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        })
    );
    const r = await runInboundRelationshipTurnUnderstanding({
      inboundBody: "Yes already on",
      timezone: "America/Chicago",
      receivedAtIso: new Date().toISOString(),
      classifierEventType: "user_yes",
      classifierNormalizedHint: null,
      effectiveAsk: "Family connection",
      behaviorStatement: "Connect weekly",
      lastCoachOutbound: "calendar tomorrow",
      latestOpenQuestion: "calendar tomorrow",
      latestAnswerAfterOpenQuestion: null,
      openQuestionPending: true,
      expectedReplySemantics: null,
      recentThreadExcerpt: "",
      temporalContract: null,
      proofCalloutClaimSavedAllowed: false,
    });
    expect(r?.interpreter_failed_reason).toMatch(/timeout|abort|failed/i);
  });

  it("skips interpreter for STOP hard route", async () => {
    const r = await runInboundRelationshipTurnUnderstanding({
      inboundBody: "STOP",
      timezone: "America/Chicago",
      receivedAtIso: new Date().toISOString(),
      classifierEventType: "user_yes",
      classifierNormalizedHint: null,
      routePriority: { compliance_or_stop: true },
      effectiveAsk: "ask",
      behaviorStatement: "behavior",
      lastCoachOutbound: null,
      latestOpenQuestion: null,
      latestAnswerAfterOpenQuestion: null,
      openQuestionPending: false,
      expectedReplySemantics: null,
      recentThreadExcerpt: "",
      temporalContract: null,
      proofCalloutClaimSavedAllowed: false,
    });
    expect(r).toBeNull();
    expect(openAiCreate).not.toHaveBeenCalled();
  });
});

describe("resolveInboundTurnUnderstandingSkipReason", () => {
  it("R: returns explicit hard_route labels", () => {
    expect(
      resolveInboundTurnUnderstandingSkipReason({
        routePurpose: "normal_inbound_reply",
        routePriority: { compliance_or_stop: true },
      })
    ).toBe("hard_route_compliance_or_stop");
    expect(
      resolveInboundTurnUnderstandingSkipReason({
        routePurpose: "open_question_answer",
        routePriority: {},
      })
    ).toBe("hard_route_route_purpose_open_question_answer");
  });
});

describe("shouldSkipInboundTurnUnderstandingRoute", () => {
  it("skips crisis route priority", () => {
    expect(
      shouldSkipInboundTurnUnderstandingRoute({
        routePurpose: "normal_inbound_reply",
        routePriority: { crisis_or_safety: true },
      })
    ).toBe(true);
  });

  it("skips pending resolution and contract consent", () => {
    expect(
      shouldSkipInboundTurnUnderstandingRoute({
        routePurpose: "normal_inbound_reply",
        routePriority: { pending_resolution: true },
      })
    ).toBe(true);
    expect(
      shouldSkipInboundTurnUnderstandingRoute({
        routePurpose: "normal_inbound_reply",
        routePriority: { contract_consent: true },
      })
    ).toBe(true);
  });
});

describe("integration scenarios — reconciled intent", () => {
  it("A family visiting: acknowledge_prior_ask_satisfied, no write", () => {
    const body =
      "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.";
    const det = meaningFor(body);
    const r = reconcileTurnUnderstanding({
      proposal: makeValidProposal({
        user_turn_summary: "Visiting family; plans tomorrow; prior calendar ask satisfied.",
        response_intent: "acknowledge_prior_ask_satisfied",
        last_ask_satisfied: "yes",
        commitment_outcome_recommendation: "no_outcome_write",
        persistence_safety: "defer_to_server",
      }),
      deterministicMeaning: det,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
    });
    expect(r.reconciled_response_intent).toBe("acknowledge_prior_ask_satisfied");
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
    expect(r.reconciled_do_not_repeat_asks.length).toBeGreaterThan(0);
  });

  it("D sleep metric: acknowledge_result_and_next_standard", () => {
    const body =
      "I slept 7 hrs 18 minutes. I feel pretty good. Id like to have 2 nights in a row of more than 7 hrs of sleep";
    const det = meaningFor(body);
    const r = reconcileTurnUnderstanding({
      proposal: makeValidProposal({
        relationship_meaning: "reported_metric_or_result",
        response_intent: "acknowledge_result_and_next_standard",
        last_ask_satisfied: "yes",
        satisfaction_kind: "answered_no",
        commitment_outcome_recommendation: "no_outcome_write",
        persistence_safety: "defer_to_server",
        do_not_repeat_asks: ["bedtime routine protected partial missed"],
      }),
      deterministicMeaning: det,
      latestCoachQuestion: "How did your bedtime routine go last night — protected, partial, or missed?",
    });
    expect(r.reconciled_response_intent).toBe("acknowledge_result_and_next_standard");
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
  });

  it("E still need calendar: not satisfied", () => {
    const det = meaningFor("Still need to put it on calendar");
    const r = reconcileTurnUnderstanding({
      proposal: makeValidProposal({
        relationship_meaning: "plan_made",
        last_ask_satisfied: "no",
        satisfaction_kind: "not_satisfied",
        response_intent: "reinforce_plan_without_proof",
        stale_ask_risk: false,
      }),
      deterministicMeaning: det,
    });
    expect(r.last_ask_satisfied).toBe("no");
    expect(r.reconciled_response_intent).toBe("reinforce_plan_without_proof");
  });
});
