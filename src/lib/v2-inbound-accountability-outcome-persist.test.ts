import { beforeEach, describe, expect, it, vi } from "vitest";
import { V3_REFINE_ONLY_GATED } from "@/lib/v3-sms-machine-refine";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { isClearAccountabilityCompletionReply } from "@/lib/v2-inbound-accountability-completion";
import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  buildInterpreterFailedSafeReconciled,
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  reconcileTurnUnderstanding,
  type OpenAIRelationshipTurnUnderstandingV1,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  persistInboundAccountabilityOutcomeEvent,
  shouldPersistInboundAccountabilityOutcome,
  resolveInboundAccountabilityOutcomeEventType,
  canBypassClarifyGateForExplicitNonYesOutcome,
} from "@/lib/v2-inbound-accountability-outcome-persist";

function familyTurnProposal(): OpenAIRelationshipTurnUnderstandingV1 {
  return {
    version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    user_turn_summary: "Visiting family; plans tomorrow.",
    evidence_quotes: ["visiting with family"],
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
    confidence: 0.9,
    uncertainty_flags: [],
    route_priority_recommendation: "none",
    safety_or_support_flags: [],
  };
}

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

const livePromptCtx = {
  has_live_accountability_prompt: true,
  self_contained_accountability_answer: false,
};

const DISTRIBUTION_OUTCOME_Q =
  "What actually happened with your distribution plan since your last check-in?";

const recentCheckSent = [
  {
    event_type: "check_sent",
    occurred_at: new Date().toISOString(),
    payload_json: {},
  },
] as never[];

const clarifyGatedNoOutcomeWrite = {
  mode: "clarify" as const,
  final_event_type: null,
  decision_reason: "clarify_no_outcome_write",
  confidence_used: 0.85,
  should_write_outcome_event: false,
  should_open_blocker_capture: false,
  reply_style: "clarification" as const,
  overrode_deterministic: true,
};

function meaningForDistributionOutcome(rawBody: string, classifierEventType: "user_no" | "user_partial" = "user_no") {
  return buildInboundMeaningFacts({
    rawInbound: rawBody,
    classifierEventType,
    expectedReplySemantics: "accountability_check",
    openQuestionPending: true,
    latestOpenQuestion: DISTRIBUTION_OUTCOME_Q,
    latestOutboundBody: DISTRIBUTION_OUTCOME_Q,
    recentEventsNewestFirst: recentCheckSent,
  });
}

describe("isClearAccountabilityCompletionReply", () => {
  it("detects I did it and similar completion phrases", () => {
    expect(isClearAccountabilityCompletionReply("I did it!")).toBe(true);
    expect(isClearAccountabilityCompletionReply("done")).toBe(true);
    expect(isClearAccountabilityCompletionReply("yes")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I got it done")).toBe(true);
    expect(isClearAccountabilityCompletionReply("nope")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I did my 10,000 steps yesterday!")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I completed it")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I made the calls")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I did the workout")).toBe(true);
  });

  it("does not treat open-ended reflection as completion", () => {
    expect(isClearAccountabilityCompletionReply("because I was tired")).toBe(false);
    expect(isClearAccountabilityCompletionReply("8")).toBe(false);
  });

  it("does not treat negation, plan, wish, or uncertainty as completion", () => {
    expect(isClearAccountabilityCompletionReply("I did not do it")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I made a plan")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I wish I did")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I did think about it")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I did?")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I almost did it")).toBe(false);
  });
});

describe("shouldPersistInboundAccountabilityOutcome", () => {

  it("persists clear user_yes even when gated should_write_outcome_event is false", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_001",
      commitmentId: "commit-1",
      rawBody: "I did it!",
      classifierEventType: "user_yes",
      gatedDecision: V3_REFINE_ONLY_GATED,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toMatchObject({
      persist: true,
      resolvedEventType: "user_yes",
      overrideGatedNoWrite: true,
    });
  });

  it("skips when classifier is not an accountability outcome type", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_002",
      commitmentId: "commit-1",
      rawBody: "what should I do?",
      classifierEventType: "user_meta" as import("@/lib/v2-sms-accountability").V2InboundEventType,
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({
      persist: false,
      skipReason: "classifier_not_accountability_outcome",
    });
  });

  it("skips arc clarify only lane for ambiguous replies", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_003",
      commitmentId: "commit-1",
      rawBody: "maybe",
      classifierEventType: "user_partial",
      gatedDecision: {
        ...defaultGatedDecision("user_partial", "test"),
        mode: "clarify",
        should_write_outcome_event: false,
      },
      laneExclusion: "arc_clarify_only",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({ persist: false, skipReason: "arc_clarify_only" });
  });

  it("skips yesterday reported completion with meaning_ack_only", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "I did my 10,000 steps yesterday!",
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_yest",
      commitmentId: "commit-1",
      rawBody: "I did my 10,000 steps yesterday!",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toEqual({ persist: false, skipReason: "meaning_ack_only" });
  });

  it("does not persist false-positive completion phrases as user_yes", () => {
    const missMeaning = buildInboundMeaningFacts({
      rawInbound: "I did not do it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
    });
    const missResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_miss",
      commitmentId: "commit-1",
      rawBody: "I did not do it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: missMeaning,
    });
    expect(missResult).toMatchObject({ persist: true, resolvedEventType: "user_no" });

    const planResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan",
      commitmentId: "commit-1",
      rawBody: "I made a plan",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "I made a plan",
        classifierEventType: "user_yes",
        classifierNormalizedHint: "completion_detail",
      }),
    });
    expect(planResult).toEqual({ persist: false, skipReason: "meaning_no_outcome_write" });
    const partialMeaning = buildInboundMeaningFacts({
      rawInbound: "I almost did it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
    });
    const partialResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_partial",
      commitmentId: "commit-1",
      rawBody: "I almost did it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: partialMeaning,
    });
    expect(partialResult).toMatchObject({ persist: true, resolvedEventType: "user_partial" });

    const cancelResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_cancel",
      commitmentId: "commit-1",
      rawBody: "I need to cancel my subscription",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "I need to cancel my subscription",
        classifierEventType: "user_yes",
        classifierNormalizedHint: "completion_detail",
      }),
    });
    expect(cancelResult).toEqual({ persist: false, skipReason: "meaning_no_outcome_write" });
  });

  it("narrows persistence when turn understanding says no_outcome_write (family visiting)", () => {
    const body =
      "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
    });
    const tu = reconcileTurnUnderstanding({
      proposal: familyTurnProposal(),
      deterministicMeaning: inboundMeaning,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
    });
    const withoutTu = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_family",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    const withTu = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_family",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    if (withoutTu.persist) {
      expect(withTu.persist).toBe(false);
      expect(withTu.turnUnderstandingPersistGuard?.persistence_narrowed_by_turn_understanding).toBe(
        true
      );
    } else {
      expect(withTu.persist).toBe(false);
    }
  });

  it("blocks expand: turn understanding cannot enable persist when baseline skipped", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "All good for now",
      classifierEventType: "user_yes",
    });
    const tu = reconcileTurnUnderstanding({
      proposal: familyTurnProposal(),
      deterministicMeaning: inboundMeaning,
    });
    tu.reconciled_persistence_decision = "write_user_yes_today";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_expand",
      commitmentId: "commit-1",
      rawBody: "All good for now",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: { has_live_accountability_prompt: false, self_contained_accountability_answer: false },
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(false);
  });

  it("skips explicit lane exclusions", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_004",
      commitmentId: "commit-1",
      rawBody: "yes",
      classifierEventType: "user_yes",
      gatedDecision: {
        mode: "commitment_change_handoff",
        final_event_type: "user_yes",
        decision_reason: "test",
        confidence_used: null,
        should_write_outcome_event: false,
        should_open_blocker_capture: false,
        reply_style: "normal_outcome",
        overrode_deterministic: false,
      },
      laneExclusion: "commitment_change_handoff",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({ persist: false, skipReason: "lane_excluded" });
  });
});

describe("future/proposal affirmative — persist backstop", () => {
  const RECOMMIT_Q =
    "Would you like to recommit to taking at least 10,000 steps a day for the next week?";
  const recentCheckSent = [
    {
      event_type: "check_sent",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    },
  ] as never[];

  it("blocks Yes I will after recommit question", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "Yes I will",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    expect(inboundMeaning.persistence_decision).not.toBe("write_user_yes_today");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_recommit_yes_i_will",
      commitmentId: "commit-1",
      rawBody: "Yes I will",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("meaning_no_outcome_write");
    }
  });

  it("blocks bare Yes after recommit with stale accountability_check metadata", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "Yes",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_recommit_bare_yes",
      commitmentId: "commit-1",
      rawBody: "Yes",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("still persists Yes I did after outcome check", () => {
    const outcomeQ = "Did you hit 10,000 steps today?";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "Yes I did",
      classifierEventType: "user_yes",
      latestOpenQuestion: outcomeQ,
      latestOutboundBody: outcomeQ,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_outcome_yes_i_did",
      commitmentId: "commit-1",
      rawBody: "Yes I did",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) {
      expect(result.resolvedEventType).toBe("user_yes");
    }
  });
});

describe("future/proposal negative — persist backstop", () => {
  const RECOMMIT_Q =
    "Would you like to recommit to taking at least 10,000 steps a day for the next week?";
  const recentCheckSent = [
    {
      event_type: "check_sent",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    },
  ] as never[];

  it("11: blocks No after recommit when meaning would write user_no", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "Not this week",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    expect(inboundMeaning.persistence_decision).not.toBe("write_user_no");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_recommit_not_this_week",
      commitmentId: "commit-1",
      rawBody: "Not this week",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("meaning_no_outcome_write");
    }
  });

  it("12: explicit miss clause bypasses backstop and persists user_no", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "I missed it",
      classifierEventType: "user_no",
    });
    expect(inboundMeaning.persistence_decision).toBe("write_user_no");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_explicit_miss",
      commitmentId: "commit-1",
      rawBody: "I missed it",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });

  it("13: backstop blocks synthetic write_user_no with plan proposal rejection evidence", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "No I won't",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    const forcedWrite: typeof inboundMeaning = {
      ...inboundMeaning,
      persistence_decision: "write_user_no",
      relationship_meaning: "miss",
    };
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_forced_no",
      commitmentId: "commit-1",
      rawBody: "No I won't",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: forcedWrite,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("plan_or_proposal_rejection_backstop");
    }
  });

  it("still persists No after true outcome check", () => {
    const outcomeQ = "Did you hit 10,000 steps today?";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: outcomeQ,
      latestOutboundBody: outcomeQ,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent,
    });
    expect(inboundMeaning.persistence_decision).toBe("write_user_no");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_outcome_no",
      commitmentId: "commit-1",
      rawBody: "No",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });
});

describe("gated clarify — explicit miss/partial bypass (P0 B)", () => {
  it("1: I missed it yesterday + clarify gated → user_no persists", () => {
    const body = "I missed it yesterday";
    const inboundMeaning = meaningForDistributionOutcome(body);
    expect(inboundMeaning.persistence_decision).toBe("write_user_no");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_missed_yesterday",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({
      persist: true,
      resolvedEventType: "user_no",
      overrideGatedNoWrite: true,
    });
    if (!result.persist) expect(result.skipReason).not.toBe("gated_non_outcome_mode");
  });

  it("2: I did not hit my goal yesterday + clarify gated → user_no persists", () => {
    const body = "I did not hit my goal yesterday";
    const inboundMeaning = meaningForDistributionOutcome(body);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_did_not_hit",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_no" });
  });

  it("3: No, I missed + clarify gated → user_no persists", () => {
    const body = "No, I missed";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_no_i_missed",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_no" });
  });

  it("4: I did half + clarify gated → user_partial persists", () => {
    const body = "I did half";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_did_half",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_partial" });
  });

  it("5: I started but didn't finish + clarify gated → user_partial persists", () => {
    const body = "I started but didn't finish";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_started_but",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_partial" });
  });

  it("6: I got my steps today regression — user_yes unchanged under clarify", () => {
    const body = "I got my steps today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_steps_regress",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("7: contextless no → no user_no", () => {
    const body = "no";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
      openQuestionPending: false,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_ctx_no",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: { has_live_accountability_prompt: false, self_contained_accountability_answer: false },
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) expect(result.skipReason).not.toBe("gated_non_outcome_mode");
  });

  it("8: contextless nope → no user_no", () => {
    const body = "nope";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
      openQuestionPending: false,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_ctx_nope",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: { has_live_accountability_prompt: false, self_contained_accountability_answer: false },
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("9: plan-confirmation no → no user_no", () => {
    const body = "no";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
      openQuestionPending: true,
      latestOpenQuestion: "Does this 7-day step plan work?",
      expectedReplySemantics: "proposal_yes_no",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan_no",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) expect(result.skipReason).toBe("meaning_no_outcome_write");
  });

  it("10: plan-confirmation nope → no user_no", () => {
    const body = "nope";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
      openQuestionPending: true,
      latestOpenQuestion: "Does this 7-day step plan work?",
      expectedReplySemantics: "proposal_yes_no",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan_nope",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("11: no problem → no user_no", () => {
    const body = "no problem";
    const inboundMeaning = meaningForDistributionOutcome(body, "user_no");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_no_problem",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    expect(canBypassClarifyGateForExplicitNonYesOutcome({
      rawBody: body,
      persistence: inboundMeaning.persistence_decision,
      inboundMeaning,
    })).toBe(false);
  });

  it("12: TU cannot expand to write_user_no without server miss evidence", () => {
    const body = "All good for now";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const tu = reconcileTurnUnderstanding({
      proposal: familyTurnProposal(),
      deterministicMeaning: inboundMeaning,
    });
    tu.reconciled_persistence_decision = "write_user_no";
    expect(
      canBypassClarifyGateForExplicitNonYesOutcome({
        rawBody: body,
        persistence: "write_user_no",
        inboundMeaning: { ...inboundMeaning, persistence_decision: "write_user_no" },
      })
    ).toBe(false);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_tu_expand_no",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(false);
  });
});

describe("turn understanding — all inbound persist branches", () => {
  const body =
    "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.";
  const inboundMeaning = buildInboundMeaningFacts({
    rawInbound: body,
    classifierEventType: "user_yes",
    openQuestionPending: true,
    latestOpenQuestion: "put one family connection on the calendar for tomorrow",
  });
  const tu = reconcileTurnUnderstanding({
    proposal: familyTurnProposal(),
    deterministicMeaning: inboundMeaning,
    latestCoachQuestion: "put one family connection on the calendar for tomorrow",
  });

  for (const branch of [
    "main",
    "open_question",
    "central_pivot",
    "arc_clarify",
    "conversation_brain_legacy_fallback",
  ] as const) {
    it(`A: family visiting no false user_yes (${branch})`, () => {
      const result = shouldPersistInboundAccountabilityOutcome({
        messageSid: `SM_branch_${branch}`,
        commitmentId: "commit-1",
        rawBody: body,
        classifierEventType: "user_yes",
        gatedDecision: defaultGatedDecision("user_yes", "test"),
        laneExclusion: "none",
        activeReplyContext: livePromptCtx,
        inboundMeaning,
        turnUnderstandingReconciled: tu,
      });
      expect(result.persist).toBe(false);
    });
  }

  it("B: yes already on no false user_yes", () => {
    const alreadyOn = "Yes already on";
    const det = buildInboundMeaningFacts({
      rawInbound: alreadyOn,
      classifierEventType: "user_yes",
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
    });
    const tuOn = reconcileTurnUnderstanding({
      proposal: familyTurnProposal(),
      deterministicMeaning: det,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_already_on_branch",
      commitmentId: "commit-1",
      rawBody: alreadyOn,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: det,
      turnUnderstandingReconciled: tuOn,
    });
    expect(result.persist).toBe(false);
  });
});

describe("interpreter failed-safe persistence", () => {
  const livePromptCtx = {
    has_live_accountability_prompt: true,
    self_contained_accountability_answer: false,
  };

  it("A: family/plans substantive — no fake user_yes", () => {
    const body =
      "Yes. Yesterday & today am actually visiting with family in Ohio. Also have family plans tomorrow.";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
      openQuestionPending: true,
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fail_family",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(false);
  });

  it("B: bare yes with open question — no fake user_yes", () => {
    const body = "yes";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "put one family connection on the calendar for tomorrow",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      latestCoachQuestion: "put one family connection on the calendar for tomorrow",
      openQuestionPending: true,
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fail_yes",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(false);
  });

  it("C: I got my steps today — can still persist with failed-safe TU", () => {
    const body = "I got my steps today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_steps_today",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("C: I did it today — can still persist", () => {
    const body = "I did it today";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      rawInbound: body,
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fail_done",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("D: No I missed — can still persist", () => {
    const body = "No, I missed";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      rawInbound: body,
      classifierEventType: "user_no",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fail_miss",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });

  it("E: I did half — partial can persist", () => {
    const body = "I did half";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "timeout",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fail_partial",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_partial");
  });
});

describe("resolveInboundAccountabilityOutcomeEventType", () => {
  it("prefers gated final_event_type when set", () => {
    expect(
      resolveInboundAccountabilityOutcomeEventType({
        classifierEventType: "user_yes",
        gatedDecision: {
          ...defaultGatedDecision("user_yes", "test"),
          mode: "use_ai_outcome",
          final_event_type: "user_partial",
        },
      })
    ).toBe("user_partial");
  });
});

describe("persistInboundAccountabilityOutcomeEvent", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("returns inserted on success", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }),
      }),
    });

    const result = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_retry_001",
      rawBody: "I did it!",
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_phrase",
      gatedDecision: defaultGatedDecision("user_yes", "use_ai_outcome"),
      liveAccountabilityPromptDetected: true,
      overrideGatedNoWrite: false,
      proofMeta: null,
      payloadJson: { ai: { message: "Nice work." } },
    });

    expect(result.status).toBe("inserted");
    if (result.status === "inserted") {
      expect(result.eventId).toBe("evt-1");
      expect(result.idempotencyKey).toBe("v2_user_yes:SM_retry_001");
    }
  });

  it("returns duplicate on Postgres 23505 without throwing", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      }),
    });

    const result = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_retry_001",
      rawBody: "I did it!",
      eventType: "user_yes",
      branch: "open_question",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_phrase",
      gatedDecision: V3_REFINE_ONLY_GATED,
      liveAccountabilityPromptDetected: true,
      overrideGatedNoWrite: true,
      proofMeta: null,
      payloadJson: {},
    });

    expect(result).toMatchObject({ status: "duplicate", eventType: "user_yes" });
  });
});

describe("coach-context correction — persist backstop", () => {
  const PRODUCTION_META_CORRECTION =
    "Yes! I was wondering why you asked it because I did not say I would be playing with the kids tomorrow";

  it("production meta-correction does not persist user_no", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: PRODUCTION_META_CORRECTION,
      classifierEventType: "user_yes",
    });
    expect(inboundMeaning.persistence_decision).toBe("no_outcome_write");
    expect(inboundMeaning.relationship_meaning).toBe("answer_to_prior_question");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_meta_correction",
      commitmentId: "commit-1",
      rawBody: PRODUCTION_META_CORRECTION,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("meaning_no_outcome_write");
    }
  });

  it("backstop blocks forced write_user_no on meta-correction", () => {
    const forcedWrite = buildInboundMeaningFacts({
      rawInbound: "Where did you get that? I didn't say that.",
      classifierEventType: "user_no",
    });
    const inboundMeaning = {
      ...forcedWrite,
      persistence_decision: "write_user_no" as const,
      relationship_meaning: "miss" as const,
    };
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_forced_meta",
      commitmentId: "commit-1",
      rawBody: "Where did you get that? I didn't say that.",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("coach_context_correction_not_miss");
    }
  });

  it("explicit miss still persists user_no after narrowing", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "I didn't hit my steps",
      classifierEventType: "user_no",
    });
    expect(inboundMeaning.persistence_decision).toBe("write_user_no");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_hit_steps_miss",
      commitmentId: "commit-1",
      rawBody: "I didn't hit my steps",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });

  it("onboarding dispute does not persist user_no", () => {
    const raw =
      "Thanks I did 15 minutes of onboarding and you didn't ask me anything about what I chose. Did the onboarding matter?";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_no",
    });
    expect(inboundMeaning.persistence_decision).toBe("no_outcome_write");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_onboarding_dispute",
      commitmentId: "commit-1",
      rawBody: raw,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("meaning_no_outcome_write");
    }
  });

  it("backstop blocks forced write_user_no on onboarding dispute", () => {
    const raw = "You didn't ask me about what I chose.";
    const forcedWrite = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_no",
    });
    const inboundMeaning = {
      ...forcedWrite,
      persistence_decision: "write_user_no" as const,
      relationship_meaning: "miss" as const,
    };
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_forced_onboarding",
      commitmentId: "commit-1",
      rawBody: raw,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(["coach_context_correction_not_miss", "onboarding_process_dispute_not_miss"]).toContain(
        result.skipReason
      );
    }
  });
});

describe("substantive self-reported completion — persist without live prompt", () => {
  const noLivePromptCtx = {
    has_live_accountability_prompt: false,
    self_contained_accountability_answer: false,
  };

  const TYLER_DISTRIBUTION_COMPLETION =
    "I got my distribution done today! I hit the goal! Woo hoo!";

  const BROOKE_STEPS_COMPLETION =
    "I got my 10,000 steps today though! And I did it before we had a birthday party to go to";

  const TENNESSEE_FUTURE_CONFIDENCE =
    "We're heading to Tennessee on Thursday. We live in Ohio and we're driving to Tennessee with all three kids so it'll throw us off our routine a little bit but I should still be able to hit the goals";

  function substantiveCompletionMeaning(rawBody: string) {
    return buildInboundMeaningFacts({
      rawInbound: rawBody,
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      openQuestionPending: true,
      latestOpenQuestion: "What happened with your distribution plan?",
      routePriority: { open_question_owns_turn: true },
    });
  }

  it("write_user_yes_today + substantive completion + no live prompt → persist user_yes", () => {
    const inboundMeaning = substantiveCompletionMeaning(TYLER_DISTRIBUTION_COMPLETION);
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_tyler_distribution",
      commitmentId: "commit-1",
      rawBody: TYLER_DISTRIBUTION_COMPLETION,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("Brooke exact string without live prompt → persist user_yes", () => {
    const inboundMeaning = substantiveCompletionMeaning(BROOKE_STEPS_COMPLETION);
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_brooke_steps",
      commitmentId: "commit-1",
      rawBody: BROOKE_STEPS_COMPLETION,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("Tennessee future-confidence trip without live prompt → no user_yes", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: TENNESSEE_FUTURE_CONFIDENCE,
      classifierEventType: "user_yes",
      routePriority: { open_question_owns_turn: true },
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_tennessee_trip",
      commitmentId: "commit-1",
      rawBody: TENNESSEE_FUTURE_CONFIDENCE,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("I hit the goal without live prompt → persist user_yes", () => {
    const body = "I hit the goal";
    const inboundMeaning = substantiveCompletionMeaning(body);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_hit_goal",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("I got my distribution done today without live prompt → persist user_yes", () => {
    const body = "I got my distribution done today";
    const inboundMeaning = substantiveCompletionMeaning(body);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_distribution_done",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("bare Yes without live prompt → persist false", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "Yes",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "Did you finish?",
      routePriority: { open_question_owns_turn: true },
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_bare_yes",
      commitmentId: "commit-1",
      rawBody: "Yes",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("meaning_no_outcome_write");
    }
  });

  it("future plan without live prompt → persist false", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "I'll do it tonight",
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_future_plan",
      commitmentId: "commit-1",
      rawBody: "I'll do it tonight",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("no commitment id unchanged", () => {
    const inboundMeaning = substantiveCompletionMeaning("I hit the goal");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_no_commit",
      commitmentId: "",
      rawBody: "I hit the goal",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toEqual({ persist: false, skipReason: "no_commitment_id" });
  });

  it("idempotency key unchanged for substantive completion", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }),
      }),
    });
    const body = "I hit the goal";
    const result = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_substantive_idem",
      rawBody: body,
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      liveAccountabilityPromptDetected: false,
      proofMeta: null,
      payloadJson: {},
    });
    expect(result).toMatchObject({ status: "inserted", eventType: "user_yes" });
    if (result.status === "inserted") {
      expect(result.idempotencyKey).toBe("v2_user_yes:SM_substantive_idem");
    }
  });
});
