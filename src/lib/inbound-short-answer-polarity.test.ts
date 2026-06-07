import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: vi.fn(),
    }),
  },
}));

import {
  buildInboundMeaningFacts,
  persistenceDecisionToOutcomeEventType,
} from "@/lib/inbound-relationship-meaning";
import {
  detectNormalizedShortAnswerPolarity,
  normalizeShortAnswerText,
  shortAnswerDisqualifiesOutcomeProof,
} from "@/lib/inbound-short-answer-polarity";
import { resolveShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { shouldPersistInboundAccountabilityOutcome } from "@/lib/v2-inbound-accountability-outcome-persist";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";

const PLAN_Q =
  "How does staying committed to taking at least 10,000 steps a day for the next 7 days feel for you? Let me know if that works or if you'd like to adjust!";

const OUTCOME_Q = "Did you follow through with your plan before your doctor appointment?";

function recentCheckSent() {
  return [
    {
      event_type: "check_sent",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    },
  ] as never[];
}

function freshOutcomeSaca(inbound: string, extra: Record<string, unknown> = {}) {
  return resolveShortAnswerContextAuthority({
    rawInbound: inbound,
    latestOpenQuestion: OUTCOME_Q,
    latestOutboundBody: OUTCOME_Q,
    expectedReplySemantics: "accountability_check",
    recentEventsNewestFirst: recentCheckSent(),
    ...extra,
  });
}

function contextlessSaca(inbound: string) {
  return resolveShortAnswerContextAuthority({
    rawInbound: inbound,
    openQuestionPending: false,
  });
}

function planSaca(inbound: string) {
  return resolveShortAnswerContextAuthority({
    rawInbound: inbound,
    latestOpenQuestion: PLAN_Q,
    expectedAnswerType: "proposal_yes_no",
    expectedReplySemantics: "proposal_yes_no",
    openQuestionPending: true,
  });
}

const livePromptCtx = {
  has_live_accountability_prompt: true,
  self_contained_accountability_answer: false,
};

function meaningForOutcome(inbound: string, extra: Record<string, unknown> = {}) {
  return buildInboundMeaningFacts({
    rawInbound: inbound,
    classifierEventType: "user_partial",
    expectedReplySemantics: "accountability_check",
    openQuestionPending: true,
    latestOpenQuestion: OUTCOME_Q,
    latestOutboundBody: OUTCOME_Q,
    recentEventsNewestFirst: recentCheckSent(),
    ...extra,
  });
}

describe("normalizeShortAnswerText", () => {
  it("collapses repeated letters and fuses spellings", () => {
    expect(normalizeShortAnswerText("yessss").normalized).toBe("yes");
    expect(normalizeShortAnswerText("yeahhh").normalized).toBe("yeah");
    expect(normalizeShortAnswerText("yezzir").normalized).toBe("yessir");
    expect(normalizeShortAnswerText("yessir").normalized).toBe("yessir");
    expect(normalizeShortAnswerText("yes-sir").normalized).toBe("yes sir");
  });

  it("detects question shape before stripping", () => {
    expect(normalizeShortAnswerText("yeah?").is_question).toBe(true);
    expect(detectNormalizedShortAnswerPolarity("yeah?")).toBe("unclear");
  });
});

describe("fresh outcome_check affirm matrix → user_yes", () => {
  const affirmatives = [
    "hell yeah",
    "hecks yeah",
    "hells yeah",
    "yeah buddy",
    "yessir",
    "yes sir",
    "yezzir",
    "yeppers",
    "yep yep",
    "yessss",
    "yeahhh",
    "100%",
    "100 percent",
    "absolutely",
    "for sure",
    "sure did",
    "totally",
    "definitely",
    "Heck yeah!",
  ];

  it.each(affirmatives)("%s → outcome proof eligible", (phrase) => {
    const r = freshOutcomeSaca(phrase);
    expect(r.prior_question_type).toBe("outcome_check");
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_yes_today");
    expect(r.reason).toBe("short_affirm_to_fresh_outcome_check");
  });

  it.each(affirmatives)("%s contextless → no user_yes", (phrase) => {
    const r = contextlessSaca(phrase);
    expect(r.outcome_proof_eligible).toBe(false);
    expect(
      persistenceDecisionToOutcomeEventType(
        buildInboundMeaningFacts({ rawInbound: phrase, openQuestionPending: false }).persistence_decision
      )
    ).toBeNull();
  });

  it.each(affirmatives)("%s plan_confirmation → no user_yes", (phrase) => {
    const r = planSaca(phrase);
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.response_intent_hint).toBe("acknowledge_plan_confirmation");
  });
});

describe("false-positive guards on fresh outcome_check", () => {
  const falsePositives = [
    "yeah?",
    "hell yeah I want to do it tomorrow",
    "yes sir, tomorrow",
    "yep, planning to",
    "sure, I'll do it later",
    "no problem",
    "sure thing",
  ];

  it.each(falsePositives)("%s → no outcome proof", (phrase) => {
    const r = freshOutcomeSaca(phrase);
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.allowed_persistence).toBe("no_outcome_write");
  });
});

describe("fresh outcome_check negative matrix", () => {
  it.each([
    ["nope", "write_user_no"],
    ["no way", "write_user_no"],
    ["not today", "write_user_no"],
    ["didn't get to it", "write_user_no"],
    ["couldn't", "write_user_no"],
    ["not yet", "write_user_no"],
  ] as const)("%s → %s", (phrase, persist) => {
    const r = freshOutcomeSaca(phrase);
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe(persist);
  });

  it("contextless nope → no user_no proof", () => {
    expect(contextlessSaca("nope").outcome_proof_eligible).toBe(false);
  });
});

describe("fresh outcome_check partial matrix", () => {
  it.each([
    "some of it",
    "got some done",
    "almost",
    "started but didn't finish",
    "close",
    "a little",
    "kind of",
  ])("%s → user_partial", (phrase) => {
    const r = freshOutcomeSaca(phrase);
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_partial");
  });

  it("almost is not user_yes", () => {
    const facts = meaningForOutcome("almost");
    expect(facts.persistence_decision).toBe("write_user_partial");
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });
});

describe("OpenAI TU polarity fallback hook", () => {
  it("uses tuAnsweredLastCoachAsk when deterministic is unclear", () => {
    const r = freshOutcomeSaca("maybe-ish", { tuAnsweredLastCoachAsk: "yes" });
    expect(r.short_answer_polarity).toBe("affirm");
    expect(r.outcome_proof_eligible).toBe(true);
  });

  it("TU affirm loses to future-plan disqualifier", () => {
    const r = freshOutcomeSaca("sure, I'll do it later", { tuAnsweredLastCoachAsk: "yes" });
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.reason).toMatch(/disqualified/);
  });
});

describe("no-send persistence with normalized affirmatives", () => {
  it("lane no-send + yessir after outcome_check → user_yes", () => {
    const body = "yessir";
    const meaning = meaningForOutcome(body);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_yessir",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: meaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("final-guard no-send + 100% after outcome_check → user_yes", () => {
    const body = "100%";
    const meaning = meaningForOutcome(body);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_100",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: { ...defaultGatedDecision("user_partial", "test"), should_write_outcome_event: false },
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: meaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("contextless yessir no-send → no persist", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_ctx_yessir",
      commitmentId: "commit-1",
      rawBody: "yessir",
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "yessir",
        classifierEventType: "user_partial",
        openQuestionPending: false,
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("plan-confirmation yeppers no-send → no persist", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan_yeppers",
      commitmentId: "commit-1",
      rawBody: "yeppers",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "yeppers",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: PLAN_Q,
        expectedReplySemantics: "proposal_yes_no",
      }),
    });
    expect(result.persist).toBe(false);
  });
});

describe("disqualifier unit cases", () => {
  it("flags acknowledgement-only phrases", () => {
    expect(shortAnswerDisqualifiesOutcomeProof("no problem").disqualified).toBe(true);
    expect(shortAnswerDisqualifiesOutcomeProof("sure thing").disqualified).toBe(true);
  });
});
