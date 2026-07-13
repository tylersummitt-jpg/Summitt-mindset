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
  buildInterpreterFailedSafeReconciled,
  buildReconciledGoalChangeIntent,
  callOpenAIRelationshipTurnUnderstandingV1,
  inferMinimalGoalChangeIntentFromInbound,
  isAuthoritativeReconciledGoalChangeIntent,
  parseOpenAIRelationshipTurnUnderstandingV1,
  parseTurnUnderstandingGoalChangeIntent,
  reconcileTurnUnderstanding,
  resolveFailedSafePersistenceDecision,
  runInboundRelationshipTurnUnderstanding,
  resolveInboundTurnUnderstandingSkipReason,
  scrubTurnUnderstandingErrorMessage,
  shouldSkipInboundTurnUnderstandingRoute,
  slimTurnUnderstandingMetadata,
  isCoachingFitFeedbackReconciled,
  isAmbiguousRelatedProgressReconciled,
  enrichReconciledWithInboundRouteContract,
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

function makeGoalChangeProposal(
  overrides: Partial<OpenAIRelationshipTurnUnderstandingV1> = {}
): OpenAIRelationshipTurnUnderstandingV1 {
  return makeValidProposal({
    relationship_meaning: "goal_adjustment_request",
    response_intent: "clarify_goal_change",
    commitment_outcome_recommendation: "no_outcome_write",
    persistence_safety: "do_not_write_but_acknowledge",
    answered_last_coach_ask: "yes",
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    do_not_repeat_asks: ["what specific changes or adjustments are you considering"],
    confidence: 0.82,
    goal_change_intent: {
      detected: true,
      adjustment_type: "amend",
      source: "user_requested",
      requires_confirmation: true,
      proposed_new_goal_text: null,
      evidence_quote: "amend or re-state old goals",
      confidence: "high",
    },
    ...overrides,
  });
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

function makeCoachingFitProposal(
  userSummary: string,
  evidenceQuote: string,
  overrides: Partial<OpenAIRelationshipTurnUnderstandingV1> = {}
): OpenAIRelationshipTurnUnderstandingV1 {
  return makeValidProposal({
    user_turn_summary: userSummary,
    evidence_quotes: [evidenceQuote],
    relationship_meaning: "coaching_fit_feedback",
    response_intent: "repair_coaching_fit",
    answered_last_coach_ask: "no",
    last_ask_satisfied: "no",
    satisfaction_kind: "not_satisfied",
    commitment_outcome_recommendation: "no_outcome_write",
    persistence_safety: "do_not_write_but_acknowledge",
    stale_ask_risk: true,
    do_not_repeat_asks: ["Did you start the meeting with a clear agenda today?"],
    confidence: 0.86,
    ...overrides,
  });
}

describe("coaching_fit_feedback semantic signal", () => {
  it("parses coaching_fit_feedback and repair_coaching_fit enums", () => {
    const p = makeCoachingFitProposal("User says texts miss the mark.", "not helpful");
    expect(parseOpenAIRelationshipTurnUnderstandingV1(p as unknown as Record<string, unknown>)).toEqual(
      p
    );
  });

  it.each([
    ["These messages are not relevant.", "not relevant"],
    ["This isn't helpful for what I'm dealing with.", "not helpful"],
    ["You're missing what I actually need.", "missing what I actually need"],
  ])("reconciles coaching fit from phrasing: %s", (inbound, quote) => {
    const det = meaningFor(inbound);
    const proposal = makeCoachingFitProposal(`User coaching-fit: ${inbound}`, quote);
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "Did you start the meeting with a clear agenda today?",
      inboundBody: inbound,
    });
    expect(r.reconciled_relationship_meaning).toBe("coaching_fit_feedback");
    expect(r.reconciled_response_intent).toBe("repair_coaching_fit");
    expect(r.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(r.disagreement_flags).toContain("coaching_fit_feedback_repair");
    expect(isCoachingFitFeedbackReconciled(r)).toBe(true);
  });

  it("does not phrase-route on the word relevant alone in reconcile (miss stays miss)", () => {
    const det = meaningFor("I didn't do it today");
    const proposal = makeValidProposal({
      relationship_meaning: "miss",
      response_intent: "tell_truth_and_recover",
      user_turn_summary: "User missed today.",
      evidence_quotes: ["didn't do it today"],
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: "I didn't do it today",
    });
    expect(r.reconciled_relationship_meaning).toBe("miss");
    expect(isCoachingFitFeedbackReconciled(r)).toBe(false);
  });

  it("goal-change authoritative intent wins over coaching_fit proposal", () => {
    const det = meaningFor("I want to change my goal");
    const proposal = makeCoachingFitProposal("User wants goal change.", "change my goal", {
      goal_change_intent: {
        detected: true,
        adjustment_type: "replace",
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: "change my goal",
        confidence: "high",
      },
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: "I want to change my goal",
    });
    expect(r.reconciled_relationship_meaning).toBe("goal_adjustment_request");
    expect(isCoachingFitFeedbackReconciled(r)).toBe(false);
  });

  it("enriched route contract forbids continuing same assignment for coaching fit", () => {
    const inbound = "These feel generic.";
    const reconciled = enrichReconciledWithInboundRouteContract(
      reconcileTurnUnderstanding({
        proposal: makeCoachingFitProposal("Generic coaching complaint.", "feel generic"),
        deterministicMeaning: meaningFor(inbound),
        inboundBody: inbound,
      }),
      { rawInbound: inbound, classifierEventType: "user_partial" }
    );
    expect(isCoachingFitFeedbackReconciled(reconciled)).toBe(true);
    expect(reconciled.inbound_route_contract?.allow_new_assignment).toBe(false);
    expect(reconciled.inbound_route_contract?.forbidden_moves?.join(" ")).toMatch(
      /Repair coaching fit/i
    );
  });
});

function makeAmbiguousRelatedProgressProposal(
  userSummary: string,
  evidenceQuote: string,
  overrides: Partial<OpenAIRelationshipTurnUnderstandingV1> = {}
): OpenAIRelationshipTurnUnderstandingV1 {
  return makeValidProposal({
    user_turn_summary: userSummary,
    evidence_quotes: [evidenceQuote],
    relationship_meaning: "ambiguous_related_progress",
    response_intent: "clarify_completion_or_concretize_action",
    answered_last_coach_ask: "unclear",
    last_ask_satisfied: "unclear",
    satisfaction_kind: "unclear",
    commitment_outcome_recommendation: "no_outcome_write",
    persistence_safety: "do_not_write_but_acknowledge",
    stale_ask_risk: true,
    do_not_repeat_asks: ["Did you finish one task moving the art business forward today?"],
    confidence: 0.84,
    ...overrides,
  });
}

describe("ambiguous_related_progress semantic signal", () => {
  it("parses ambiguous_related_progress and clarify_completion_or_concretize_action enums", () => {
    const p = makeAmbiguousRelatedProgressProposal(
      "User may be doing related work.",
      "busy creating"
    );
    expect(parseOpenAIRelationshipTurnUnderstandingV1(p as unknown as Record<string, unknown>)).toEqual(
      p
    );
  });

  it.each([
    ["I've been so busy creating.", "busy creating"],
    ["I spent the afternoon working on ideas for the shirts.", "working on ideas for the shirts"],
  ])("A/B reconciles goal-relative ambiguous progress: %s", (inbound, quote) => {
    const det = meaningFor(inbound);
    const proposal = makeAmbiguousRelatedProgressProposal(
      `User related effort unclear completion: ${inbound}`,
      quote
    );
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "Did you finish one task moving the art/t-shirt business forward today?",
      inboundBody: inbound,
    });
    expect(r.reconciled_relationship_meaning).toBe("ambiguous_related_progress");
    expect(r.reconciled_response_intent).toBe("clarify_completion_or_concretize_action");
    expect(r.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(r.disagreement_flags).toContain("ambiguous_related_progress_no_outcome");
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(true);
  });

  it("C — vague busyness proposal without related-progress meaning does not force the signal", () => {
    const inbound = "I've been busy.";
    const det = meaningFor(inbound);
    const proposal = makeValidProposal({
      relationship_meaning: "unclear",
      response_intent: "unclear_clarify",
      user_turn_summary: "User says they have been busy.",
      evidence_quotes: ["I've been busy."],
      commitment_outcome_recommendation: "no_outcome_write",
      persistence_safety: "defer_to_server",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: inbound,
    });
    expect(r.reconciled_relationship_meaning).not.toBe("ambiguous_related_progress");
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(false);
  });

  it("D — clear proof stays reported_completion, not ambiguous progress", () => {
    const inbound = "I finished the shirt design and posted it.";
    const det = meaningFor(inbound);
    const proposal = makeValidProposal({
      relationship_meaning: "reported_completion",
      response_intent: "acknowledge_completion",
      user_turn_summary: "User finished and posted a shirt design.",
      evidence_quotes: ["finished the shirt design and posted it"],
      last_ask_satisfied: "yes",
      satisfaction_kind: "completed",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: inbound,
    });
    expect(r.reconciled_relationship_meaning).toBe("reported_completion");
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(false);
  });

  it("E — clear miss stays miss, not ambiguous progress", () => {
    const inbound = "I didn't do it.";
    const det = meaningFor(inbound);
    const proposal = makeValidProposal({
      relationship_meaning: "miss",
      response_intent: "tell_truth_and_recover",
      user_turn_summary: "User missed the ask.",
      evidence_quotes: ["didn't do it"],
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: inbound,
    });
    expect(r.reconciled_relationship_meaning).toBe("miss");
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(false);
  });

  it("I — forces no_outcome_write even if deterministic would write partial", () => {
    const inbound = "I spent the afternoon working on ideas for the shirts.";
    const det = meaningFor(inbound);
    const proposal = makeAmbiguousRelatedProgressProposal(
      "Related shirt-business effort, completion unclear.",
      "working on ideas for the shirts",
      {
        commitment_outcome_recommendation: "write_user_partial",
        persistence_safety: "safe_to_write",
      }
    );
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      inboundBody: inbound,
    });
    expect(r.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(r.reconciled_relationship_meaning).toBe("ambiguous_related_progress");
  });

  it("J — phrase without creating still reconciles when TU says ambiguous_related_progress", () => {
    const inbound = "I spent the afternoon working on ideas for the shirts.";
    expect(inbound.toLowerCase()).not.toContain("creating");
    const r = reconcileTurnUnderstanding({
      proposal: makeAmbiguousRelatedProgressProposal(
        "Related effort without creating keyword.",
        "working on ideas for the shirts"
      ),
      deterministicMeaning: meaningFor(inbound),
      inboundBody: inbound,
    });
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(true);
  });

  it("K — coaching-fit complaint stays coaching fit, not ambiguous progress", () => {
    const inbound = "These messages aren't helpful.";
    const r = reconcileTurnUnderstanding({
      proposal: makeCoachingFitProposal("Coaching not landing.", "aren't helpful"),
      deterministicMeaning: meaningFor(inbound),
      inboundBody: inbound,
    });
    expect(isCoachingFitFeedbackReconciled(r)).toBe(true);
    expect(isAmbiguousRelatedProgressReconciled(r)).toBe(false);
  });

  it("enriched route forbids miss/proof language for ambiguous related progress", () => {
    const inbound = "I've been so busy creating.";
    const reconciled = enrichReconciledWithInboundRouteContract(
      reconcileTurnUnderstanding({
        proposal: makeAmbiguousRelatedProgressProposal(
          "Creating may relate to business goal.",
          "busy creating"
        ),
        deterministicMeaning: meaningFor(inbound),
        inboundBody: inbound,
      }),
      { rawInbound: inbound, classifierEventType: "user_partial" }
    );
    expect(isAmbiguousRelatedProgressReconciled(reconciled)).toBe(true);
    expect(reconciled.inbound_route_contract?.should_persist).toBe(false);
    expect(reconciled.inbound_route_contract?.forbidden_moves?.join(" ")).toMatch(
      /possible related progress/i
    );
    expect(reconciled.inbound_route_contract?.forbidden_moves?.join(" ")).toMatch(/proof/i);
  });
});

describe("runInboundRelationshipTurnUnderstanding", () => {
  beforeEach(() => {
    openAiCreate.mockReset();
  });

  it("falls back when OpenAI fails without throwing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
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
    expect(r?.turn_understanding_failure_diagnostics?.tu_error_code).toBe("openai_request_failed");
    expect(r?.turn_understanding_failure_diagnostics?.tu_error_message_short).toMatch(/network/i);
  });

  it("attaches scrubbed diagnostics on openai_request_failed via callOpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    openAiCreate.mockRejectedValue(
      Object.assign(new Error("Rate limit exceeded for sk-live-secretvalue12345"), {
        status: 429,
        error: { type: "rate_limit_error" },
      })
    );
    const out = await callOpenAIRelationshipTurnUnderstandingV1({
      inboundBody: "done",
      lastCoachOutbound: null,
      latestOpenQuestion: null,
      latestAnswerAfterOpenQuestion: null,
      openQuestionPending: false,
      expectedReplySemantics: null,
      effectiveAsk: "ask",
      behaviorStatement: "behavior",
      recentThreadExcerpt: "",
      routePurpose: "normal_inbound_reply",
      routePriority: {},
      temporalContract: null,
      proofCalloutClaimSavedAllowed: false,
      deterministicMeaning: buildInboundMeaningFacts({
        rawInbound: "done",
        classifierEventType: "user_yes",
      }),
      classifierEventType: "user_yes",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("openai_request_failed");
    expect(out.diagnostics.tu_error_code).toBe("openai_request_failed");
    expect(out.diagnostics.tu_error_message_short).toContain("[redacted]");
    expect(out.diagnostics.tu_error_message_short).not.toMatch(/sk-live/);
    expect(out.diagnostics.tu_sdk_status).toBe(429);
    expect(out.diagnostics.tu_sdk_type).toBe("rate_limit_error");
    expect(out.diagnostics.tu_raw_preview).toBeUndefined();
  });

  it("attaches tu_raw_preview only on schema_validation_failed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: '{"version":"not-valid"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const out = await callOpenAIRelationshipTurnUnderstandingV1({
      inboundBody: "done",
      lastCoachOutbound: null,
      latestOpenQuestion: null,
      latestAnswerAfterOpenQuestion: null,
      openQuestionPending: false,
      expectedReplySemantics: null,
      effectiveAsk: "ask",
      behaviorStatement: "behavior",
      recentThreadExcerpt: "",
      routePurpose: "normal_inbound_reply",
      routePriority: {},
      temporalContract: null,
      proofCalloutClaimSavedAllowed: false,
      deterministicMeaning: buildInboundMeaningFacts({
        rawInbound: "done",
        classifierEventType: "user_yes",
      }),
      classifierEventType: "user_yes",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("schema_validation_failed");
    expect(out.diagnostics.tu_raw_preview).toBeTruthy();
    expect((out.diagnostics.tu_raw_preview ?? "").length).toBeLessThanOrEqual(200);
  });

  it("scrubTurnUnderstandingErrorMessage redacts secrets and caps length", () => {
    const long = `Bearer ${"x".repeat(200)} plus more text ${"y".repeat(50)}`;
    const scrubbed = scrubTurnUnderstandingErrorMessage(long, 120);
    expect(scrubbed).toContain("[redacted]");
    expect(scrubbed.length).toBeLessThanOrEqual(120);
  });

  it("slimTurnUnderstandingMetadata pipes failure diagnostics + correction flags", () => {
    const meaning = buildInboundMeaningFacts({
      rawInbound: "No, that's not right.",
      classifierEventType: "user_no",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "openai_request_failed",
      proposal: null,
      deterministicMeaning: meaning,
      rawInbound: "No, that's not right.",
      classifierEventType: "user_no",
      failureDiagnostics: {
        tu_error_code: "openai_request_failed",
        tu_error_message_short: "network down",
        tu_latency_ms: 42,
        tu_sdk_status: 500,
        tu_sdk_type: "api_error",
      },
    });
    const slim = slimTurnUnderstandingMetadata(tu);
    expect(slim.tu_error_code).toBe("openai_request_failed");
    expect(slim.tu_error_message_short).toBe("network down");
    expect(slim.tu_latency_ms).toBe(42);
    expect(slim.correction_language_detected).toBe(true);
    expect(slim.blocked_outcome_reason).toBe("goal_or_context_correction");
    expect(slim.server_reconciled_persistence_decision).toBe("no_outcome_write");
  });

  it("resolveFailedSafePersistenceDecision allows Done. and blocks contextual replies", () => {
    const doneMeaning = buildInboundMeaningFacts({
      rawInbound: "Done.",
      classifierEventType: "user_yes",
    });
    expect(
      resolveFailedSafePersistenceDecision({
        deterministicMeaning: doneMeaning,
        rawInbound: "Done.",
        classifierEventType: "user_yes",
      })
    ).toBe("write_user_yes_today");

    const readyMeaning = buildInboundMeaningFacts({
      rawInbound: "Ready.",
      classifierEventType: "user_partial",
    });
    expect(
      resolveFailedSafePersistenceDecision({
        deterministicMeaning: readyMeaning,
        rawInbound: "Ready.",
        classifierEventType: "user_partial",
      })
    ).toBe("no_outcome_write");
  });

  it("P2b failed-safe close-loop for Ready / plan-committed with prior ask", () => {
    const planAsk = "Make a short list of next steps for tomorrow";
    for (const body of [
      "Ready.",
      "Good suggestion & have made a list.",
      "Sounds like a great plan I'm committed.",
    ]) {
      const meaning = buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: "user_partial",
        openQuestionPending: true,
        latestOpenQuestion: planAsk,
      });
      const tu = buildInterpreterFailedSafeReconciled({
        interpreterFailedReason: "openai_request_failed",
        proposal: null,
        deterministicMeaning: meaning,
        latestCoachQuestion: planAsk,
        openQuestionPending: true,
        rawInbound: body,
        classifierEventType: "user_partial",
      });
      expect(tu.reconciled_persistence_decision).toBe("no_outcome_write");
      expect(tu.last_ask_satisfied).toBe("yes");
      expect(tu.reconciled_do_not_repeat_asks.some((a) => /list|steps/i.test(a))).toBe(true);
      expect(["acknowledge_prior_ask_satisfied", "close_loop_no_new_action"]).toContain(
        tu.reconciled_response_intent
      );
      expect(tu.reconciled_response_intent).not.toBe("tell_truth_and_recover");
      expect(tu.reconciled_response_intent).not.toBe("identify_blocker");
    }
  });

  it("OpenAI success path still reconciles proposal persistence (not weakened)", () => {
    const proposal = makeValidProposal({
      commitment_outcome_recommendation: "ack_only",
      persistence_safety: "safe_to_write",
      relationship_meaning: "prior_ask_satisfied",
      last_ask_satisfied: "yes",
      confidence: 0.9,
    });
    const det = buildInboundMeaningFacts({
      rawInbound: "Yes already on",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
    });
    const r = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: det,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
      interpreterFailedReason: null,
      inboundBody: "Yes already on",
    });
    expect(r.interpreter_failed_reason).toBeNull();
    expect(r.turn_understanding_failed_safe_fallback).toBeFalsy();
    expect(r.reconciled_persistence_decision).not.toBe("write_user_yes_today");
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

describe("goal_change_intent schema", () => {
  it("parses goal_change_intent on amend/restate proposal", () => {
    const p = makeGoalChangeProposal();
    const parsed = parseOpenAIRelationshipTurnUnderstandingV1(
      p as unknown as Record<string, unknown>
    );
    expect(parsed?.goal_change_intent?.detected).toBe(true);
    expect(parsed?.goal_change_intent?.adjustment_type).toBe("amend");
    expect(parsed?.goal_change_intent?.requires_confirmation).toBe(true);
    expect(parsed?.goal_change_intent?.evidence_quote).toMatch(/amend|re-state/i);
  });

  it("inferMinimalGoalChangeIntentFromInbound detects amend/restate", () => {
    const intent = inferMinimalGoalChangeIntentFromInbound(
      "Yes we need to amend or re-state old goals"
    );
    expect(intent?.detected).toBe(true);
    expect(["amend", "restate"]).toContain(intent?.adjustment_type);
    expect(intent?.evidence_quote).toMatch(/amend|re-state/i);
  });

  it("inferMinimalGoalChangeIntentFromInbound detects reset", () => {
    const intent = inferMinimalGoalChangeIntentFromInbound("Can we reset the old goal?");
    expect(intent?.detected).toBe(true);
    expect(intent?.adjustment_type).toBe("reset");
  });

  it("does not treat general goal talk as goal-change", () => {
    expect(
      inferMinimalGoalChangeIntentFromInbound("I was thinking about goals generally")
    ).toBeNull();
  });

  it("reconcile preserves authoritative goal-change and blocks outcome write", () => {
    const det = meaningFor("Yes we need to amend or re-state old goals");
    const r = reconcileTurnUnderstanding({
      proposal: makeGoalChangeProposal(),
      deterministicMeaning: det,
      latestCoachQuestion: "What specific changes or adjustments are you considering?",
    });
    expect(isAuthoritativeReconciledGoalChangeIntent(r.reconciled_goal_change_intent)).toBe(true);
    expect(r.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(r.reconciled_relationship_meaning).toBe("goal_adjustment_request");
    expect(r.reconciled_response_intent).toBe("clarify_goal_change");
    expect(r.disagreement_flags).toContain("goal_change_not_outcome_write");
  });

  it("classifies raise/lower/replace goal-change types", () => {
    for (const [body, type] of [
      ["This goal is too easy", "raise"],
      ["This goal is too hard", "lower"],
      ["This goal no longer fits", "replace"],
    ] as const) {
      const intent = inferMinimalGoalChangeIntentFromInbound(body);
      expect(intent?.detected).toBe(true);
      expect(intent?.adjustment_type).toBe(type);
    }
  });

  it("buildReconciledGoalChangeIntent requires confirmation", () => {
    const intent = buildReconciledGoalChangeIntent({
      proposalIntent: parseTurnUnderstandingGoalChangeIntent({
        detected: true,
        adjustment_type: "restate",
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: "restate",
        confidence: "medium",
      }),
      relationshipMeaning: "goal_adjustment_request",
      overallConfidence: 0.7,
    });
    expect(intent?.requires_confirmation).toBe(true);
    expect(intent?.goal_change_no_state_mutation_without_confirmation).toBe(true);
  });
});
