import { beforeEach, describe, expect, it, vi } from "vitest";
import { V3_REFINE_ONLY_GATED } from "@/lib/v3-sms-machine-refine";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { buildV2ActiveReplyContext } from "@/lib/v2-active-reply-context";
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
  shouldApplySubstantiveCompletionBaselinePersistOverride,
  inboundTruthPersistPayloadFromShouldResult,
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

  function failedSafePersistCase(args: {
    body: string;
    classifierEventType: "user_yes" | "user_no" | "user_partial";
    sid: string;
  }) {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: args.body,
      classifierEventType: args.classifierEventType,
    });
    const tu = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: "openai_request_failed",
      proposal: null,
      deterministicMeaning: inboundMeaning,
      rawInbound: args.body,
      classifierEventType: args.classifierEventType,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: args.sid,
      commitmentId: "commit-1",
      rawBody: args.body,
      classifierEventType: args.classifierEventType,
      gatedDecision: defaultGatedDecision(args.classifierEventType, "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });
    return { tu, result };
  }

  it.each([
    { body: "Completed.", type: "user_yes" as const, sid: "SM_fs_completed" },
    { body: "Done.", type: "user_yes" as const, sid: "SM_fs_done" },
    { body: "Yes, I did it.", type: "user_yes" as const, sid: "SM_fs_yes_did" },
  ])("$body → user_yes allowed under failed-safe", ({ body, type, sid }) => {
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: type,
      sid,
    });
    expect(tu.reconciled_persistence_decision).toBe("write_user_yes_today");
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it.each([
    {
      body: "No, I missed it because I got distracted.",
      type: "user_no" as const,
      sid: "SM_fs_miss_because",
    },
    {
      body: "I didn't get it done because Netflix distracted me.",
      type: "user_partial" as const,
      sid: "SM_fs_netflix",
    },
  ])("$body → user_no allowed under failed-safe", ({ body, type, sid }) => {
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: type,
      sid,
    });
    expect(tu.reconciled_persistence_decision).toBe("write_user_no");
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });

  it.each([
    { body: "Partially.", type: "user_partial" as const, sid: "SM_fs_partially" },
    { body: "I did part of it.", type: "user_partial" as const, sid: "SM_fs_part_of" },
  ])("$body → user_partial allowed under failed-safe", ({ body, type, sid }) => {
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: type,
      sid,
    });
    expect(tu.reconciled_persistence_decision).toBe("write_user_partial");
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_partial");
  });

  it("No, wrong… removed this goal → no_outcome_write, no user_no, correction flags", () => {
    const body = "No, wrong. Mindset we removed this accountability goal.";
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: "user_no",
      sid: "SM_fs_stale_goal",
    });
    expect(tu.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(tu.correction_language_detected).toBe(true);
    expect(tu.blocked_outcome_reason).toBe("goal_or_context_correction");
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(["meaning_no_outcome_write", "goal_or_context_correction"]).toContain(
        result.skipReason
      );
    }
  });

  it.each([
    "Good suggestion & have made a list.",
    "Sounds like a great plan I'm committed.",
    "Ready.",
  ])("%s with OpenAI failed → no_outcome_write", (body) => {
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: "user_partial",
      sid: `SM_fs_ctx_${body.slice(0, 12).replace(/\W+/g, "_")}`,
    });
    expect(tu.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(result.persist).toBe(false);
  });

  it.each([
    { body: "No, that's not right.", type: "user_no" as const },
    { body: "That's not my goal anymore.", type: "user_partial" as const },
  ])("$body → no_outcome_write under failed-safe", ({ body, type }) => {
    const { tu, result } = failedSafePersistCase({
      body,
      classifierEventType: type,
      sid: `SM_fs_corr_${body.slice(0, 12).replace(/\W+/g, "_")}`,
    });
    expect(tu.reconciled_persistence_decision).toBe("no_outcome_write");
    expect(tu.correction_language_detected).toBe(true);
    expect(tu.blocked_outcome_reason).toBe("goal_or_context_correction");
    expect(result.persist).toBe(false);
  });

  it("evaluateUserNoPersistBackstop blocks stale-goal even if meaning says write_user_no", () => {
    const body = "No, wrong. Mindset we removed this accountability goal.";
    const inboundMeaning: ReturnType<typeof buildInboundMeaningFacts> = {
      ...buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: "user_no",
      }),
      persistence_decision: "write_user_no",
    };
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_fs_backstop_stale",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("goal_or_context_correction");
    }
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

  it("Brooke coalesced burst body without live prompt → persist user_yes", () => {
    const BROOKE_COALESCED =
      "I got my goal this morning while walking the dogs\nI hit 10000 steps already";
    const inboundMeaning = substantiveCompletionMeaning(BROOKE_COALESCED);
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SMf529d49a0b59295aba7d4c292c7e3a4b",
      commitmentId: "commit-1",
      rawBody: BROOKE_COALESCED,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
      commitmentBehaviorStatement: "Walk 10,000 steps every day",
      effectiveAsk: "Did you get your 10,000 steps today?",
      commitmentTitle: "10,000 steps",
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

describe("no-send truth persistence hardening", () => {
  const noLivePromptCtx = {
    has_live_accountability_prompt: false,
    self_contained_accountability_answer: false,
  };

  const STRETCHING_COMPLETION =
    "I did my stretching and exercising early today";

  function stretchingMeaning() {
    return buildInboundMeaningFacts({
      rawInbound: STRETCHING_COMPLETION,
      classifierEventType: "user_partial",
      classifierNormalizedHint: "unclear",
    });
  }

  it("substantive stretching completion persists without live prompt", () => {
    const inboundMeaning = stretchingMeaning();
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_stretch_pre_writer",
      commitmentId: "commit-1",
      rawBody: STRETCHING_COMPLETION,
      classifierEventType: "user_partial",
      classifierNormalizedHint: "unclear",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
    if (result.persist) {
      expect(inboundTruthPersistPayloadFromShouldResult(result)).toMatchObject({
        server_allows_persistence_at_no_send: true,
        inbound_truth_persist_event_type: "user_yes",
      });
    }
  });

  it("substantive completion survives TU narrow via baseline override", () => {
    const inboundMeaning = stretchingMeaning();
    expect(inboundMeaning.persistence_decision).toBe("write_user_yes_today");
    const tu = reconcileTurnUnderstanding({
      proposal: {
        version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
        user_turn_summary: "User reported stretching and exercise done early today.",
        evidence_quotes: [STRETCHING_COMPLETION.slice(0, 40)],
        relationship_meaning: "reported_completion",
        answered_last_coach_ask: "yes",
        last_ask_satisfied: "yes",
        satisfaction_kind: "evidence_provided",
        do_not_repeat_asks: ["Did you stretch today?"],
        stale_ask_risk: true,
        commitment_outcome_recommendation: "no_outcome_write",
        persistence_safety: "do_not_write_but_acknowledge",
        response_intent: "close_loop_no_new_action",
        temporal_scope: "today",
        reported_for_day_key: null,
        confidence: 0.9,
        uncertainty_flags: [],
        route_priority_recommendation: "none",
        safety_or_support_flags: [],
      },
      deterministicMeaning: inboundMeaning,
      latestCoachQuestion: "Did you stretch today?",
    });
    tu.reconciled_persistence_decision = "no_outcome_write";

    const baseline = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_stretch_base",
      commitmentId: "commit-1",
      rawBody: STRETCHING_COMPLETION,
      classifierEventType: "user_partial",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    const narrowed = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_stretch_base",
      commitmentId: "commit-1",
      rawBody: STRETCHING_COMPLETION,
      classifierEventType: "user_partial",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
    });

    expect(baseline.persist).toBe(true);
    expect(narrowed.persist).toBe(true);
    if (narrowed.persist) {
      expect(narrowed.baselinePersistOverride).toBe("substantive_completion");
      expect(narrowed.baselinePersistOverrideReason).toBe(
        "baseline_substantive_completion_survives_tu_narrow"
      );
    }
    expect(
      shouldApplySubstantiveCompletionBaselinePersistOverride({
        rawBody: STRETCHING_COMPLETION,
        inboundMeaning,
        baselineResult: baseline,
        narrowedResult: {
          persist: false,
          skipReason: "meaning_no_outcome_write",
        },
      })
    ).toBe(true);
  });

  it("commitment-aligned routine status update survives TU narrow when wake-up commitment aligns", () => {
    const body = "Getting up, showered, and ready for the day";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const meaningForPersist: typeof inboundMeaning = {
      ...inboundMeaning,
      persistence_decision: "write_user_yes_today",
      relationship_meaning: "reported_completion",
    };
    const tu = reconcileTurnUnderstanding({
      proposal: {
        version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
        user_turn_summary: "User reported morning routine progress.",
        evidence_quotes: [body.slice(0, 40)],
        relationship_meaning: "reported_completion",
        answered_last_coach_ask: "yes",
        last_ask_satisfied: "yes",
        satisfaction_kind: "evidence_provided",
        do_not_repeat_asks: ["How are you feeling about waking up on time?"],
        stale_ask_risk: true,
        commitment_outcome_recommendation: "no_outcome_write",
        persistence_safety: "do_not_write_but_acknowledge",
        response_intent: "close_loop_no_new_action",
        temporal_scope: "today",
        reported_for_day_key: null,
        confidence: 0.9,
        uncertainty_flags: [],
        route_priority_recommendation: "none",
        safety_or_support_flags: [],
      },
      deterministicMeaning: meaningForPersist,
      latestCoachQuestion: "How are you feeling about waking up on time?",
    });
    tu.reconciled_persistence_decision = "no_outcome_write";

    const persistArgs = {
      messageSid: "SM_routine_status",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial" as const,
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none" as const,
      activeReplyContext: noLivePromptCtx,
      inboundMeaning: meaningForPersist,
      commitmentBehaviorStatement: "Wake up on time without snoozing",
      effectiveAsk: "Get out of bed when the alarm goes off",
    };
    const baseline = shouldPersistInboundAccountabilityOutcome(persistArgs);
    const narrowed = shouldPersistInboundAccountabilityOutcome({
      ...persistArgs,
      turnUnderstandingReconciled: tu,
    });
    expect(baseline.persist).toBe(true);
    expect(narrowed.persist).toBe(true);
    if (narrowed.persist) {
      expect(narrowed.baselinePersistOverride).toBe("substantive_completion");
    }
  });

  it("same routine status update does not persist when commitment does not align", () => {
    const body = "Getting up, showered, and ready for the day";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_routine_mismatch",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning: {
        ...inboundMeaning,
        persistence_decision: "write_user_yes_today",
        relationship_meaning: "reported_completion",
      },
      commitmentBehaviorStatement: "Read for 30 minutes before bed",
      effectiveAsk: "Read tonight",
    });
    expect(result.persist).toBe(false);
  });

  it("Yes at 2pm scheduling answer does not persist user_yes", () => {
    const body = "Yes at 2pm";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "Does 2pm work for your call?",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_yes_2pm",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      commitmentBehaviorStatement: "Weekly family connection",
      effectiveAsk: "Put one family connection on the calendar",
    });
    expect(result.persist).toBe(false);
  });

  it("future plan Will do more cardio later does not persist user_yes", () => {
    const body = "Will do more cardio later";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_partial",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_future_plan",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("onboarding meta dispute does not persist user_no", () => {
    const body = "Did onboarding matter? You didn't ask me about what I chose.";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_onboarding_meta",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(false);
  });

  it("bare Yes without context remains guarded", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_bare_yes",
      commitmentId: "commit-1",
      rawBody: "Yes",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Yes",
        classifierEventType: "user_yes",
        openQuestionPending: false,
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("pre-writer then no-send fallback duplicate is safe", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: { id: "evt-dup" }, error: null }),
      }),
    });
    const body = STRETCHING_COMPLETION;
    const inboundMeaning = stretchingMeaning();
    const args = {
      messageSid: "SM_pre_then_nosend",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial" as const,
      classifierNormalizedHint: "unclear" as const,
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none" as const,
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
    };
    const should = shouldPersistInboundAccountabilityOutcome(args);
    expect(should.persist).toBe(true);

    const first = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_pre_then_nosend",
      rawBody: body,
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_partial",
      classifierNormalizedHint: "unclear",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      liveAccountabilityPromptDetected: false,
      overrideGatedNoWrite: true,
      proofMeta: null,
      payloadJson: { inbound_truth_persist_stage: "before_writer" },
    });
    expect(first.status).toBe("inserted");

    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      }),
    });
    const second = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_pre_then_nosend",
      rawBody: body,
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_partial",
      classifierNormalizedHint: "unclear",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      liveAccountabilityPromptDetected: false,
      overrideGatedNoWrite: true,
      proofMeta: null,
      payloadJson: { lane_no_send_before_final_guard: true },
      idempotencyKey: "v2_user_yes:SM_pre_then_nosend",
    });
    expect(second.status).toBe("duplicate");
  });
});

describe("goal-change outcome persist guard", () => {
  it("does not persist user_yes when authoritative goal-change intent is present", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_goal_change_001",
      commitmentId: "commit-1",
      rawBody: "Yes we need to amend or re-state old goals",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      turnUnderstandingReconciled: {
        proposal: null,
        reconciled_relationship_meaning: "goal_adjustment_request",
        reconciled_response_intent: "clarify_goal_change",
        reconciled_persistence_decision: "no_outcome_write",
        reconciled_do_not_repeat_asks: [],
        last_ask_satisfied: "yes",
        satisfaction_kind: "unclear",
        stale_ask_risk: true,
        confidence: 0.82,
        disagreement_flags: ["goal_change_not_outcome_write"],
        interpreter_failed_reason: null,
        stale_ask_avoided: true,
        persistence_note: "test",
        reconciled_goal_change_intent: {
          authoritative: true,
          detected: true,
          adjustment_type: "amend",
          source: "user_requested",
          requires_confirmation: true,
          proposed_new_goal_text: null,
          evidence_quote: "amend or re-state old goals",
          confidence: "high",
          goal_change_not_outcome_write: true,
          goal_change_no_state_mutation_without_confirmation: true,
        },
      },
    });
    expect(result.persist).toBe(false);
    expect(result.skipReason).toBe("goal_change_not_outcome_write");
  });
});

describe("proof spine safety — commitment alignment and same-day duplicate suppress", () => {
  const noLivePromptCtx = {
    has_live_accountability_prompt: false,
    self_contained_accountability_answer: false,
  };

  const STEP_COMMITMENT = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  const TZ = "America/New_York";

  function stepCompletionMeaning(rawBody: string) {
    return buildInboundMeaningFacts({
      rawInbound: rawBody,
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      openQuestionPending: true,
      latestOpenQuestion: "Did you get your steps in today?",
      routePriority: { open_question_owns_turn: true },
    });
  }

  function shouldPersistStepProof(args: {
    rawBody: string;
    messageSid: string;
    commitmentId?: string;
    inboundMeaning?: ReturnType<typeof buildInboundMeaningFacts>;
    recentEventsNewestFirst?: { event_type: string; occurred_at: string; payload_json: Record<string, unknown> }[];
  }) {
    const inboundMeaning = args.inboundMeaning ?? stepCompletionMeaning(args.rawBody);
    return shouldPersistInboundAccountabilityOutcome({
      messageSid: args.messageSid,
      commitmentId: args.commitmentId ?? "commit-steps",
      rawBody: args.rawBody,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: noLivePromptCtx,
      inboundMeaning,
      ...STEP_COMMITMENT,
      recentEventsNewestFirst: args.recentEventsNewestFirst,
      timezone: TZ,
    });
  }

  function priorUserYesTodayEvent() {
    return {
      event_type: "user_yes",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    };
  }

  it("step commitment + I got my 10,000 steps today → persist user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I got my 10,000 steps today",
      messageSid: "SM_steps_1",
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("step commitment + I walked 10,000 steps → persist user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I walked 10,000 steps",
      messageSid: "SM_steps_2",
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("step commitment + I got 10,000 steps by cleaning → persist user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I got 10,000 steps by cleaning",
      messageSid: "SM_steps_3",
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("step commitment + I brushed my teeth today → no user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I brushed my teeth today",
      messageSid: "SM_teeth_status",
    });
    expect(result.persist).toBe(false);
  });

  it("step commitment + Well I hit my goal of brushing my teeth → no user_yes (off_goal)", () => {
    const result = shouldPersistStepProof({
      rawBody: "Well I hit my goal of brushing my teeth",
      messageSid: "SM_teeth_goal",
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("off_goal_completion_claim");
      expect(result.proofSpineTelemetry?.completion_alignment_skip_reason).toBe(
        "off_goal_completion_claim"
      );
    }
  });

  it("step commitment + I completed my goal of brushing my teeth → no user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I completed my goal of brushing my teeth",
      messageSid: "SM_teeth_completed_goal",
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("off_goal_completion_claim");
    }
  });

  it("existing same-day user_yes + repeated steps proof → no second user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I got my 10,000 steps today",
      messageSid: "SM_steps_repeat",
      recentEventsNewestFirst: [priorUserYesTodayEvent()],
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("same_day_user_yes_already_recorded");
      expect(result.proofSpineTelemetry?.same_day_user_yes_already_recorded).toBe(true);
    }
  });

  it("existing same-day user_yes + detail message → no second user_yes", () => {
    const result = shouldPersistStepProof({
      rawBody: "I did it by cleaning my house!",
      messageSid: "SM_steps_detail",
      recentEventsNewestFirst: [priorUserYesTodayEvent()],
    });
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("same_day_user_yes_already_recorded");
    }
  });

  it("different commitment_id same day with no prior events for that commitment → still persist", () => {
    const result = shouldPersistStepProof({
      rawBody: "I got my 10,000 steps today",
      messageSid: "SM_other_commit",
      commitmentId: "commit-other",
      recentEventsNewestFirst: [],
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("user_no and user_partial persist paths are not blocked by alignment gate", () => {
    const missMeaning = buildInboundMeaningFacts({
      rawInbound: "No, I missed my steps today",
      classifierEventType: "user_no",
      openQuestionPending: true,
      latestOpenQuestion: "Did you get your steps?",
    });
    const missResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_miss_steps",
      commitmentId: "commit-steps",
      rawBody: "No, I missed my steps today",
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: missMeaning,
      ...STEP_COMMITMENT,
      timezone: TZ,
    });
    expect(missResult).toMatchObject({ persist: true, resolvedEventType: "user_no" });

    const partialMeaning = buildInboundMeaningFacts({
      rawInbound: "I did half",
      classifierEventType: "user_partial",
      openQuestionPending: true,
      latestOpenQuestion: "Did you get your steps?",
    });
    const partialResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_partial_steps",
      commitmentId: "commit-steps",
      rawBody: "I did half",
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: partialMeaning,
      ...STEP_COMMITMENT,
      timezone: TZ,
    });
    expect(partialResult).toMatchObject({ persist: true, resolvedEventType: "user_partial" });
  });

  it("live prompt + did it still persists user_yes", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_did_it_live",
      commitmentId: "commit-steps",
      rawBody: "I did it!",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "I did it!",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: "Did you get your 10,000 steps today?",
      }),
      ...STEP_COMMITMENT,
      timezone: TZ,
    });
    expect(result).toMatchObject({ persist: true, resolvedEventType: "user_yes" });
  });

  it("telemetry includes alignment fields on aligned persist", () => {
    const result = shouldPersistStepProof({
      rawBody: "I got my 10,000 steps today",
      messageSid: "SM_telemetry",
    });
    expect(result.persist).toBe(true);
    if (result.persist) {
      expect(result.proofSpineTelemetry).toMatchObject({
        completion_alignment_checked: true,
        completion_alignment_result: "aligned",
      });
      const payload = inboundTruthPersistPayloadFromShouldResult(result);
      expect(payload.completion_alignment_checked).toBe(true);
      expect(payload.completion_alignment_result).toBe("aligned");
    }
  });
});

describe("semantic turn-understanding completion alignment", () => {
  type CommitmentCtx = {
    commitmentBehaviorStatement: string;
    effectiveAsk: string;
    commitmentTitle: string;
  };

  function reconciledCompletionTu(
    rawBody: string,
    ctx: CommitmentCtx,
    overrides?: Partial<OpenAIRelationshipTurnUnderstandingV1>
  ) {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: rawBody,
      classifierEventType: "user_yes",
      behaviorStatement: ctx.commitmentBehaviorStatement,
      effectiveAsk: ctx.effectiveAsk,
      commitmentTitle: ctx.commitmentTitle,
    });
    const proposal: OpenAIRelationshipTurnUnderstandingV1 = {
      version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
      user_turn_summary: `User completed today's commitment.`,
      evidence_quotes: [rawBody],
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
    return {
      inboundMeaning,
      tu: reconcileTurnUnderstanding({
        proposal,
        deterministicMeaning: inboundMeaning,
        inboundBody: rawBody,
      }),
    };
  }

  const noLivePromptCtx = {
    has_live_accountability_prompt: false,
    self_contained_accountability_answer: false,
  };

  function semanticPersistArgs(
    rawBody: string,
    ctx: CommitmentCtx,
    tu: ReturnType<typeof reconcileTurnUnderstanding>,
    inboundMeaning: ReturnType<typeof buildInboundMeaningFacts>,
    extra?: Partial<Parameters<typeof shouldPersistInboundAccountabilityOutcome>[0]>
  ) {
    return {
      messageSid: "SM_semantic_test",
      commitmentId: "commit-1",
      rawBody,
      classifierEventType: "user_yes" as const,
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none" as const,
      activeReplyContext: livePromptCtx,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
      commitmentBehaviorStatement: ctx.commitmentBehaviorStatement,
      effectiveAsk: ctx.effectiveAsk,
      commitmentTitle: ctx.commitmentTitle,
      ...extra,
    };
  }

  function semanticPersistArgsNoLive(
    rawBody: string,
    ctx: CommitmentCtx,
    tu: ReturnType<typeof reconcileTurnUnderstanding>,
    inboundMeaning: ReturnType<typeof buildInboundMeaningFacts>,
    extra?: Partial<Parameters<typeof shouldPersistInboundAccountabilityOutcome>[0]>
  ) {
    return semanticPersistArgs(rawBody, ctx, tu, inboundMeaning, {
      activeReplyContext: noLivePromptCtx,
      ...extra,
    });
  }

  const prayerCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Pray for 10 minutes each morning",
    effectiveAsk: "Did you pray today?",
    commitmentTitle: "Morning prayer",
  };

  const readingCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Read 10 pages each day",
    effectiveAsk: "Did you read today?",
    commitmentTitle: "Daily reading",
  };

  const ptCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Do PT mobility exercises every morning",
    effectiveAsk: "Did you do your mobility exercises?",
    commitmentTitle: "PT mobility",
  };

  const relationshipCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Have a 10-minute conversation with Kay",
    effectiveAsk: "Did you talk to Kay today?",
    commitmentTitle: "Kay conversation",
  };

  const daughterCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Check in with my daughter daily",
    effectiveAsk: "Did you check in with your daughter?",
    commitmentTitle: "Daughter check-in",
  };

  const leadershipCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Have players use positive words during drills",
    effectiveAsk: "Did the team use positive words today?",
    commitmentTitle: "Positive words",
  };

  const stepsCtx: CommitmentCtx = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  it("prayer: I got my faith time in today persists via deterministic path", () => {
    const raw = "I got my faith time in today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
  });

  it("prayer: I prayed today persists via high-confidence TU semantic alignment", () => {
    const raw = "I prayed today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({
      resolvedEventType: "user_yes",
      baselinePersistOverride: "semantic_turn_understanding",
    });
    if (result.persist) {
      expect(result.proofSpineTelemetry?.semantic_completion_source).toBe("turn_understanding");
    }
  });

  it("prayer: I spent time with God this morning persists via TU semantic alignment", () => {
    const raw = "I spent time with God this morning";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
  });

  it("prayer: I thought about praying does not persist", () => {
    const raw = "I thought about praying";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
      relationship_meaning: "unclear",
      commitment_outcome_recommendation: "no_outcome_write",
      persistence_safety: "defer_to_server",
      temporal_scope: "today",
      confidence: 0.4,
      evidence_quotes: ["thought about praying"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("prayer: I will pray later does not persist", () => {
    const raw = "I'll pray later";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
      temporal_scope: "future",
      commitment_outcome_recommendation: "no_outcome_write",
      evidence_quotes: ["I'll pray later"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("reading: I read today persists via TU semantic alignment", () => {
    const raw = "I read today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, readingCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, readingCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
  });

  it("reading: I got my pages in persists via TU semantic alignment", () => {
    const raw = "I got my pages in";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, readingCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, readingCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
  });

  it("reading: I will read tonight does not persist", () => {
    const raw = "I'll read tonight";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, readingCtx, {
      temporal_scope: "future",
      commitment_outcome_recommendation: "no_outcome_write",
      evidence_quotes: ["I'll read tonight"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, readingCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("PT: I did my mobility persists via TU semantic alignment", () => {
    const raw = "I did my mobility";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, ptCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, ptCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
  });

  it("PT: I stretched persists when TU aligns to mobility commitment", () => {
    const raw = "I stretched";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, ptCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, ptCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
  });

  it("PT: I will do it after dinner does not persist", () => {
    const raw = "I'll do it after dinner";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, ptCtx, {
      temporal_scope: "future",
      commitment_outcome_recommendation: "no_outcome_write",
      evidence_quotes: ["I'll do it after dinner"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, ptCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("relationship: I talked to Kay persists via TU semantic alignment", () => {
    const raw = "I talked to Kay";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, relationshipCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, relationshipCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
  });

  it("relationship: I checked in with my daughter persists when commitment matches", () => {
    const raw = "I checked in with my daughter";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, daughterCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, daughterCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
  });

  it("relationship: I thought about calling her does not persist", () => {
    const raw = "I thought about calling her";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, daughterCtx, {
      relationship_meaning: "unclear",
      commitment_outcome_recommendation: "no_outcome_write",
      confidence: 0.4,
      evidence_quotes: ["thought about calling her"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, daughterCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("leadership: The players used positive words persists via TU semantic alignment", () => {
    const raw = "The players used positive words";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, leadershipCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, leadershipCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
  });

  it("leadership: I will do it at practice does not persist", () => {
    const raw = "I'll do it at practice";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, leadershipCtx, {
      temporal_scope: "future",
      commitment_outcome_recommendation: "no_outcome_write",
      evidence_quotes: ["I'll do it at practice"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, leadershipCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("regression: steps I hit 10000 steps today still user_yes deterministically", () => {
    const raw = "I hit 10000 steps today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, stepsCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, stepsCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(true);
    expect(result).toMatchObject({ resolvedEventType: "user_yes" });
    if (result.persist) {
      expect(result.baselinePersistOverride).not.toBe("semantic_turn_understanding");
    }
  });

  it("regression: steps I brushed my teeth still no user_yes", () => {
    const raw = "I brushed my teeth today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, stepsCtx, {
      relationship_meaning: "reported_completion",
      evidence_quotes: ["I brushed my teeth today"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, stepsCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("regression: steps brushing-teeth goal phrase still no user_yes", () => {
    const raw = "I hit my goal of brushing my teeth";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, stepsCtx, {
      evidence_quotes: ["I hit my goal of brushing my teeth"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, stepsCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  function priorUserYesTodayEvent() {
    return {
      event_type: "user_yes",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    };
  }

  it("regression: same-day duplicate user_yes still suppressed for semantic path", () => {
    const raw = "I prayed today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning, {
        recentEventsNewestFirst: [priorUserYesTodayEvent()],
        timezone: "America/New_York",
      })
    );
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.skipReason).toBe("same_day_user_yes_already_recorded");
    }
  });

  it("regression: bare yes without live prompt still no user_yes", () => {
    const raw = "yes";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: raw,
      classifierEventType: "user_yes",
      ...prayerCtx,
    });
    const tu = reconciledCompletionTu(raw, prayerCtx, {
      evidence_quotes: ["yes"],
    }).tu;
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_bare_yes",
      commitmentId: "commit-1",
      rawBody: raw,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: {
        has_live_accountability_prompt: false,
        self_contained_accountability_answer: false,
      },
      inboundMeaning,
      turnUnderstandingReconciled: tu,
      ...prayerCtx,
    });
    expect(result.persist).toBe(false);
  });

  it("medium-confidence TU completion does not persist", () => {
    const raw = "I prayed today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
      confidence: 0.65,
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  it("high-confidence TU off-goal completion does not persist", () => {
    const raw = "I brushed my teeth today";
    const { inboundMeaning, tu } = reconciledCompletionTu(raw, stepsCtx, {
      evidence_quotes: ["I brushed my teeth today"],
    });
    const result = shouldPersistInboundAccountabilityOutcome(
      semanticPersistArgs(raw, stepsCtx, tu, inboundMeaning)
    );
    expect(result.persist).toBe(false);
  });

  describe("evidence grounding", () => {
    it("high-confidence TU with missing evidence quote does not persist user_yes", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        evidence_quotes: [],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("high-confidence TU with evidence not in inbound body does not persist user_yes", () => {
      const raw = "I thought about praying.";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        evidence_quotes: ["I prayed today."],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("high-confidence TU with model-invented paraphrase evidence does not persist user_yes", () => {
      const raw = "I got time with the Lord this morn";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        evidence_quotes: ["I spent time with God this morning"],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });
  });

  describe("no-live-prompt semantic policy", () => {
    it("prayer: I prayed today persists without live prompt via semantic alignment", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(true);
      expect(result).toMatchObject({
        resolvedEventType: "user_yes",
        baselinePersistOverride: "semantic_turn_understanding",
      });
    });

    it("reading: I read today persists without live prompt via semantic alignment", () => {
      const raw = "I read today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, readingCtx);
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, readingCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(true);
      expect(result).toMatchObject({
        resolvedEventType: "user_yes",
        baselinePersistOverride: "semantic_turn_understanding",
      });
    });

    it("bare yes without live prompt does not persist user_yes", () => {
      const raw = "yes";
      const inboundMeaning = buildInboundMeaningFacts({
        rawInbound: raw,
        classifierEventType: "user_yes",
        ...prayerCtx,
      });
      const tu = reconciledCompletionTu(raw, prayerCtx, {
        evidence_quotes: ["yes"],
      }).tu;
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("I did it without live prompt does not broaden via semantic unlock", () => {
      const raw = "I did it";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        evidence_quotes: ["I did it"],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, prayerCtx, tu, inboundMeaning)
      );
      if (inboundMeaning.persistence_decision === "write_user_yes_today") {
        expect(result.persist).toBe(true);
        expect(result.baselinePersistOverride).not.toBe("semantic_turn_understanding");
      } else {
        expect(result.persist).toBe(false);
      }
    });

    it("I'll pray later without live prompt does not persist user_yes", () => {
      const raw = "I'll pray later";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        temporal_scope: "future",
        commitment_outcome_recommendation: "no_outcome_write",
        evidence_quotes: ["I'll pray later"],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("steps: I brushed my teeth off-goal TU does not persist user_yes", () => {
      const raw = "I brushed my teeth";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, stepsCtx, {
        evidence_quotes: ["I brushed my teeth"],
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgsNoLive(raw, stepsCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });
  });

  describe("missing TU fields fail closed", () => {
    it("TU missing confidence does not unlock semantic persist", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx);
      const tuMissingConfidence = { ...tu, confidence: Number.NaN };
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tuMissingConfidence, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("TU confidence 0.74 does not unlock semantic persist", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        confidence: 0.74,
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("TU missing temporal_scope does not unlock semantic persist", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        temporal_scope: "unclear",
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });

    it("TU persistence_safety defer_to_server does not unlock semantic persist", () => {
      const raw = "I prayed today";
      const { inboundMeaning, tu } = reconciledCompletionTu(raw, prayerCtx, {
        persistence_safety: "defer_to_server",
      });
      const result = shouldPersistInboundAccountabilityOutcome(
        semanticPersistArgs(raw, prayerCtx, tu, inboundMeaning)
      );
      expect(result.persist).toBe(false);
    });
  });
});

describe("Phase 2C-1 — slot-aware accountability spine", () => {
  const distributionCtx = {
    commitmentTitle: "Distribution",
    behaviorStatement: "Spend an hour on distribution for the SaaS app.",
    effectiveAsk: "Spend an hour on distribution for the SaaS app.",
  };

  const eveningThenMorningEvents = [
    {
      event_type: "check_sent",
      occurred_at: "2026-07-07T23:00:00.000Z",
      payload_json: {
        send_slot: "evening_checkin",
        body_preview: "Evening check — did you follow through on distribution today?",
      },
    },
    {
      event_type: "user_yes",
      occurred_at: "2026-07-07T15:00:00.000Z",
      payload_json: {},
    },
    {
      event_type: "check_sent",
      occurred_at: "2026-07-07T14:00:00.000Z",
      payload_json: {
        send_slot: "morning",
        body_preview: "Morning check — distribution hour today?",
      },
    },
  ] as never[];

  function slotPersistArgs(
    rawBody: string,
    activeReplyContext: ReturnType<typeof buildV2ActiveReplyContext>,
    overrides?: Partial<OpenAIRelationshipTurnUnderstandingV1>
  ) {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: rawBody,
      classifierEventType: "user_yes",
      behaviorStatement: distributionCtx.behaviorStatement,
      effectiveAsk: distributionCtx.effectiveAsk,
      commitmentTitle: distributionCtx.commitmentTitle,
    });
    const proposal: OpenAIRelationshipTurnUnderstandingV1 = {
      version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
      user_turn_summary: rawBody,
      evidence_quotes: [rawBody],
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
    const tu = reconcileTurnUnderstanding({
      proposal,
      deterministicMeaning: inboundMeaning,
      inboundBody: rawBody,
    });
    return {
      messageSid: "SM_slot_test",
      commitmentId: "commit-slot",
      rawBody,
      classifierEventType: "user_yes" as const,
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none" as const,
      activeReplyContext,
      inboundMeaning,
      turnUnderstandingReconciled: tu,
      commitmentBehaviorStatement: distributionCtx.behaviorStatement,
      effectiveAsk: distributionCtx.effectiveAsk,
      commitmentTitle: distributionCtx.commitmentTitle,
    };
  }

  it("will do after morning-only live prompt does not persist user_yes", () => {
    const morningOnlyEvents = [
      {
        event_type: "check_sent",
        occurred_at: "2026-07-07T14:00:00.000Z",
        payload_json: { send_slot: "morning", body_preview: "Morning check" },
      },
    ] as never[];
    const activeReplyContext = buildV2ActiveReplyContext({
      inboundText: "I'll do it after dinner",
      eventsNewestFirst: morningOnlyEvents,
      ...distributionCtx,
    });
    expect(activeReplyContext.latest_outbound_send_slot).toBe("morning");
    expect(activeReplyContext.active_check_sent_send_slot).toBe("morning");

    const result = shouldPersistInboundAccountabilityOutcome(
      slotPersistArgs("I'll do it after dinner", activeReplyContext, {
        temporal_scope: "future",
        commitment_outcome_recommendation: "no_outcome_write",
        relationship_meaning: "plan_or_intent",
        response_intent: "acknowledge_plan",
      })
    );
    expect(result.persist).toBe(false);
  });

  it("done after evening check can persist when evening prompt is live", () => {
    const activeReplyContext = buildV2ActiveReplyContext({
      inboundText: "done",
      eventsNewestFirst: eveningThenMorningEvents,
      nowMs: Date.parse("2026-07-07T23:30:00.000Z"),
      ...distributionCtx,
    });
    expect(activeReplyContext.latest_outbound_send_slot).toBe("evening_checkin");
    expect(activeReplyContext.active_check_sent_send_slot).toBe("evening_checkin");
    expect(activeReplyContext.has_live_accountability_prompt).toBe(true);

    const result = shouldPersistInboundAccountabilityOutcome(
      slotPersistArgs("done", activeReplyContext, {
        evidence_quotes: ["done"],
        commitment_outcome_recommendation: "write_user_yes_today",
      })
    );
    expect(result.persist).toBe(true);
    expect(result.resolvedEventType).toBe("user_yes");
  });
});
