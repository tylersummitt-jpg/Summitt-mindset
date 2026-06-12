import { describe, expect, it } from "vitest";

import {
  detectUnsupportedAccountabilityClaimInOutbound,
  evidenceAllowsOutcomeClaim,
} from "@/lib/inbound-final-body-truth-guard";
import {
  inboundHasExplicitCompletionClause,
  splitInboundClauses,
} from "@/lib/inbound-short-answer-clauses";
import {
  buildInboundMeaningFacts,
  persistenceDecisionToOutcomeEventType,
} from "@/lib/inbound-relationship-meaning";
import { isReportedCompletionRelationshipCandidate } from "@/lib/pending-plan-proof";
import {
  inferPriorQuestionType,
  resolveShortAnswerContextAuthority,
} from "@/lib/inbound-short-answer-context";
import { tryResolveAnswerToOpenQuestionTurn } from "@/lib/v3-sms-turn";
import { isStrongServerOutcomeForFailedSafePersist } from "@/lib/openai-relationship-turn-understanding-v1";
import { inferHasProofOrKnownOutcomeForDailyAccountability } from "@/lib/timing-anchor-memory";
import {
  buildDailyOutboundOcegEvidence,
  buildDailyOutboundUnifiedGuardCtx,
} from "@/lib/daily-outbound-final-guard-evidence";
import { evidenceAllowsOutcomeClaim } from "@/lib/inbound-final-body-truth-guard";
import { buildDailyC1StrategyCardV1, buildDailyC1StrategyCardContextFromSnapshot } from "@/lib/coaching-strategy-card-v1";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";

const PLAN_Q =
  "How does staying committed to taking at least 10,000 steps a day for the next 7 days feel for you? Let me know if that works or if you'd like to adjust!";

const RECOMMIT_Q =
  "Would you like to recommit to taking at least 10,000 steps a day for the next week?";

const OUTCOME_Q = "Did you get your 10,000 steps in today?";

const OUTCOME_FOLLOW_THROUGH_Q =
  "Did you follow through with your plan before your doctor appointment?";

function recentCheckSent() {
  return [
    {
      event_type: "check_sent",
      occurred_at: new Date().toISOString(),
      payload_json: {},
    },
  ] as never[];
}

function saca(inbound: string, coachQ: string, extra: Record<string, unknown> = {}) {
  return resolveShortAnswerContextAuthority({
    rawInbound: inbound,
    latestOpenQuestion: coachQ,
    latestOutboundBody: coachQ,
    ...extra,
  });
}

describe("resolveShortAnswerContextAuthority", () => {
  it("C: yes to plan confirmation — no outcome proof", () => {
    const r = saca("Yes", PLAN_Q, {
      expectedAnswerType: "proposal_yes_no",
      expectedReplySemantics: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(r.prior_question_type).toBe("plan_confirmation");
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.allowed_persistence).toBe("no_outcome_write");
    expect(r.allowed_outbound_claims.completion).toBe(false);
    expect(r.response_intent_hint).toBe("acknowledge_plan_confirmation");
  });

  it("A: yes to fresh outcome check — outcome proof eligible", () => {
    const recent = recentCheckSent();
    const r = saca("Yes", OUTCOME_Q, {
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recent,
    });
    expect(r.prior_question_type).toBe("outcome_check");
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_yes_today");
    expect(r.allowed_outbound_claims.completion).toBe(true);
  });

  it("A: Heck yeah! to fresh outcome check — outcome proof eligible", () => {
    const r = saca("Heck yeah!", OUTCOME_FOLLOW_THROUGH_Q, {
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(r.prior_question_type).toBe("outcome_check");
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_yes_today");
  });

  it("B: Absolutely to fresh outcome check — outcome proof eligible", () => {
    const r = saca("Absolutely", OUTCOME_Q, {
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_yes_today");
  });

  it("C: Sure did to fresh outcome check — outcome proof eligible", () => {
    const r = saca("Sure did", OUTCOME_Q, {
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_yes_today");
  });

  it("D: contextless Heck yeah! — no proof", () => {
    const r = saca("Heck yeah!", "", { openQuestionPending: false });
    expect(r.prior_question_type).toBe("no_recent_question");
    expect(r.outcome_proof_eligible).toBe(false);
  });

  it("E: Heck yeah! to plan confirmation — no outcome proof", () => {
    const r = saca("Heck yeah!", PLAN_Q, {
      expectedAnswerType: "proposal_yes_no",
      expectedReplySemantics: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(r.prior_question_type).toBe("plan_confirmation");
    expect(r.outcome_proof_eligible).toBe(false);
  });

  it("F: Nope to fresh outcome check — user_no eligible", () => {
    const r = saca("Nope", OUTCOME_Q, {
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_no");
  });

  it("G: contextless Nope — no user_no proof", () => {
    const r = saca("Nope", "", { openQuestionPending: false });
    expect(r.outcome_proof_eligible).toBe(false);
  });

  it("H: I got some of it done — user_partial eligible", () => {
    const r = saca("I got some of it done", OUTCOME_Q, {
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(r.outcome_proof_eligible).toBe(true);
    expect(r.allowed_persistence).toBe("write_user_partial");
  });

  it("F: contextless yes — ambiguous, no proof", () => {
    const r = saca("Yes", "", { openQuestionPending: false });
    expect(r.prior_question_type).toBe("no_recent_question");
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.allowed_outbound_claims.completion).toBe(false);
  });

  it("E: sounds good to plan — plan confirmation", () => {
    const r = saca("Sounds good", PLAN_Q, {
      expectedAnswerType: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(r.prior_question_type).toBe("plan_confirmation");
    expect(r.outcome_proof_eligible).toBe(false);
  });

  it("P0-E: Good to adjustment sound proposal — plan confirmation, no outcome", () => {
    const adjustmentQ = "How does committing to one hour of distribution per day sound?";
    const r = saca("Good", adjustmentQ, { openQuestionPending: true });
    expect(r.prior_question_type).toBe("plan_confirmation");
    expect(r.outcome_proof_eligible).toBe(false);
    expect(r.allowed_persistence).toBe("no_outcome_write");
    expect(r.response_intent_hint).toBe("acknowledge_plan_confirmation");
  });

  describe("P0-E hardening — good/fine/great proposal-ack only", () => {
    const ADJUSTMENT_Q = "How does committing to one hour of distribution per day sound?";

    it.each(["Good", "Fine", "Great"] as const)(
      "proposal + %s → plan ack, no outcome write",
      (phrase) => {
        const r = saca(phrase, ADJUSTMENT_Q, { openQuestionPending: true });
        expect(r.prior_question_type).toBe("plan_confirmation");
        expect(r.outcome_proof_eligible).toBe(false);
        expect(r.allowed_persistence).toBe("no_outcome_write");
        expect(r.response_intent_hint).toBe("acknowledge_plan_confirmation");
      }
    );

    it.each(["Good", "Fine", "Great"] as const)(
      "outcome-check + %s → no user_yes",
      (phrase) => {
        const r = saca(phrase, OUTCOME_Q, {
          expectedReplySemantics: "accountability_check",
          openQuestionPending: true,
          recentEventsNewestFirst: recentCheckSent(),
        });
        expect(r.prior_question_type).toBe("outcome_check");
        expect(r.outcome_proof_eligible).toBe(false);
        expect(r.allowed_persistence).toBe("no_outcome_write");
        expect(r.response_intent_hint).toBe("unclear_clarify");
      }
    );

    it.each(["Good", "Fine", "Great"] as const)("contextless %s → no user_yes", (phrase) => {
      const r = saca(phrase, "", { openQuestionPending: false });
      expect(r.outcome_proof_eligible).toBe(false);
      expect(r.allowed_persistence).toBe("no_outcome_write");
    });
  });
});

describe("buildInboundMeaningFacts integration", () => {
  it("C: plan yes does not persist user_yes", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: PLAN_Q,
      expectedAnswerType: "proposal_yes_no",
      expectedReplySemantics: "proposal_yes_no",
    });
    expect(persistenceDecisionToOutcomeEventType(facts.persistence_decision)).toBeNull();
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("H: explicit I did it today still persists", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I did it today",
      classifierEventType: "user_yes",
    });
    expect(facts.relationship_meaning).toBe("reported_completion");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });
});

describe("future/proposal recommit — must not persist completion", () => {
  const liveCtx = {
    expectedReplySemantics: "accountability_check" as const,
    openQuestionPending: true,
    recentEventsNewestFirst: recentCheckSent(),
  };

  it("1: Yes I will after generic recommit question → no write_user_yes_today", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes I will",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
    expect(persistenceDecisionToOutcomeEventType(facts.persistence_decision)).toBeNull();
    const sacaResult = saca("Yes I will", RECOMMIT_Q, liveCtx);
    expect(sacaResult.prior_question_type).toBe("plan_confirmation");
    expect(sacaResult.outcome_proof_eligible).toBe(false);
  });

  it("2: bare Yes after recommit with stale accountability_check metadata → no write_user_yes_today", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
    const sacaResult = saca("Yes", RECOMMIT_Q, liveCtx);
    expect(sacaResult.prior_question_type).toBe("plan_confirmation");
    expect(sacaResult.allowed_persistence).toBe("no_outcome_write");
  });

  it("3: Sounds good after recommit → plan ack not completion", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Sounds good",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedAnswerType: "proposal_yes_no",
      expectedReplySemantics: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("4: Yes after refresh fit-check → no completed outcome", () => {
    const refreshQ = "Does this bar still fit today?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes",
      classifierEventType: "user_yes",
      latestOpenQuestion: refreshQ,
      latestOutboundBody: refreshQ,
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
    expect(saca("Yes", refreshQ, { openQuestionPending: true }).prior_question_type).toBe(
      "plan_confirmation"
    );
  });

  it("5: 3pm after schedule question → not completion outcome", () => {
    const scheduleQ = "What time will you schedule the family connection tomorrow?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "3pm",
      classifierEventType: "user_partial",
      latestOpenQuestion: scheduleQ,
      latestOutboundBody: scheduleQ,
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });

  it("6: Yes I did after outcome check → write_user_yes_today", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes I did",
      classifierEventType: "user_yes",
      latestOpenQuestion: OUTCOME_Q,
      latestOutboundBody: OUTCOME_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("7: Done after outcome check → write_user_yes_today", () => {
    const workoutQ = "Did the workout happen today?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "Done",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_phrase",
      latestOpenQuestion: workoutQ,
      latestOutboundBody: workoutQ,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("8: unsolicited completion still writes", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I got my 10,000 steps in today",
      classifierEventType: "user_yes",
    });
    expect(facts.relationship_meaning).toBe("reported_completion");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("9: miss still writes user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I missed it",
      classifierEventType: "user_no",
      latestOpenQuestion: OUTCOME_Q,
      latestOutboundBody: OUTCOME_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).toBe("write_user_no");
  });

  it("10: partial still writes user_partial", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I did half",
      classifierEventType: "user_partial",
      latestOpenQuestion: OUTCOME_Q,
      latestOutboundBody: OUTCOME_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).toBe("write_user_partial");
  });
});

describe("future/proposal recommit — must not persist miss", () => {
  const liveCtx = {
    expectedReplySemantics: "accountability_check" as const,
    openQuestionPending: true,
    recentEventsNewestFirst: recentCheckSent(),
  };

  it("1: No after recommit → no write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(facts.persistence_decision).toBe("no_outcome_write");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("2: No I don't after recommit → no write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "No I don't",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("3: Not this week after recommit → no write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Not this week",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("4: No thanks after smaller-bar proposal → no write_user_no", () => {
    const proposalQ = "Do you want to try this smaller bar this week?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "No thanks",
      classifierEventType: "user_no",
      latestOpenQuestion: proposalQ,
      latestOutboundBody: proposalQ,
      expectedAnswerType: "proposal_yes_no",
      expectedReplySemantics: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("5: No after refresh fit-check → no write_user_no", () => {
    const refreshQ = "Does this bar still fit today?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: refreshQ,
      latestOutboundBody: refreshQ,
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("6: No after schedule question → no write_user_no", () => {
    const scheduleQ = "What time will you schedule the family connection tomorrow?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: scheduleQ,
      latestOutboundBody: scheduleQ,
      openQuestionPending: true,
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
  });

  it("7: No after outcome check → write_user_no", () => {
    const outcomeQ = "Did you hit 10,000 steps today?";
    const facts = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: outcomeQ,
      latestOutboundBody: outcomeQ,
      ...liveCtx,
    });
    expect(facts.persistence_decision).toBe("write_user_no");
    expect(facts.relationship_meaning).toBe("miss");
  });

  it("8: No, I didn't after outcome check → write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "No, I didn't",
      classifierEventType: "user_no",
      latestOpenQuestion: OUTCOME_Q,
      latestOutboundBody: OUTCOME_Q,
      ...liveCtx,
    });
    expect(facts.persistence_decision).toBe("write_user_no");
  });

  it("9: unsolicited I missed it → write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I missed it",
      classifierEventType: "user_no",
    });
    expect(facts.persistence_decision).toBe("write_user_no");
  });

  it("10: unsolicited Didn't happen → write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Didn't happen",
      classifierEventType: "user_no",
    });
    expect(facts.persistence_decision).toBe("write_user_no");
  });

  it("14: stale accountability_check metadata + recommit coach body + No → no write_user_no", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "No",
      classifierEventType: "user_no",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(facts.persistence_decision).not.toBe("write_user_no");
    expect(saca("No", RECOMMIT_Q, liveCtx).prior_question_type).toBe("plan_confirmation");
  });
});

describe("daily downstream — proposal ack must not support completion claim", () => {
  it("11-13: no completion server support when recommit ack does not persist user_yes", () => {
    const meaning = buildInboundMeaningFacts({
      rawInbound: "Yes I will",
      classifierEventType: "user_yes",
      latestOpenQuestion: RECOMMIT_Q,
      latestOutboundBody: RECOMMIT_Q,
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      recentEventsNewestFirst: recentCheckSent(),
    });
    expect(meaning.persistence_decision).not.toBe("write_user_yes_today");

    expect(
      inferHasProofOrKnownOutcomeForDailyAccountability({ prior_outcome: null })
    ).toBe(false);

    const guardCtx = buildDailyOutboundUnifiedGuardCtx({
      routeKind: "main_active_accountability",
      clerkUserId: "user_test",
      commitmentId: "commit_test",
      priorOutcome: null,
    });
    const oceg = buildDailyOutboundOcegEvidence(guardCtx);
    expect(oceg.shortAnswerContext.allowed_outbound_claims.completion).toBe(false);
    expect(evidenceAllowsOutcomeClaim("completion", oceg)).toBe(false);

    const dailyFacts = {
      commitment: {
        id: "commit_test",
        title: "Steps",
        behavior_statement: "10,000 steps",
        effective_ask: "10,000 steps",
        accountability_phase: "active",
        identity_anchor_allowed: false,
        identity_anchor_short: null,
      },
      thread_memory: {
        last_coach_outbound_preview: null,
        last_user_inbound_preview: "Yes I will",
        recent_transcript_snippet: null,
        coaching_memory_snippet: null,
        do_not_repeat_hints: [],
        recent_pattern_hints: null,
      },
      accountability: {
        daily_purpose: "standard_accountability_check",
        server_strategy: "standard_check",
        next_move_type: "hold_standard",
        prior_outcome: null,
        yes_streak_14d: 0,
        no_count_14d: 0,
        partial_count_14d: 0,
        blocker_preview: null,
        proof_or_milestone_signal: null,
        silence_tier: "none",
        unanswered_checks: 0,
        days_since_last_user_outcome: 0,
        reentry_active: false,
        overlay_active: false,
        evolution_pattern_hint: null,
        contract_proposal_mode: false,
      },
      suggested_coaching_move: "ask_completion",
      constraints: {
        max_chars: 300,
        one_sms: true,
        no_raw_title_or_behavior_paste: true,
        no_generic_motivation: true,
        if_unsafe_return_no_send: true,
      },
    } satisfies DailyV3RelationshipFacts;

    const card = buildDailyC1StrategyCardV1({
      ctx: buildDailyC1StrategyCardContextFromSnapshot({
        facts: dailyFacts,
        snapshot: {
          proof_and_praise_permission: {
            data: {
              can_claim_completion: false,
              can_claim_miss: false,
              can_claim_partial: false,
              can_claim_proof: false,
              can_reference_victory_room: false,
            },
          },
          open_loops_and_do_not_repeat: {
            data: {
              open_questions: [],
              satisfied_asks: [],
              do_not_repeat_asks: [],
              do_not_repeat_topics: [],
              do_not_repeat_families: [],
            },
          },
          active_pending_state: { items: [] },
          no_send_and_silence_history: null,
        },
      }),
    });
    expect(card.allowed_claims.completion).toBe(false);
  });
});

describe("compound messages", () => {
  it("K: plan + completion clause", () => {
    const inbound =
      "Yes I will continue for the next week! I also got my 10,000 steps in today!";
    expect(inboundHasExplicitCompletionClause(inbound)).toBe(true);
    expect(splitInboundClauses(inbound).length).toBeGreaterThan(1);
    const facts = buildInboundMeaningFacts({
      rawInbound: inbound,
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: PLAN_Q,
      expectedAnswerType: "proposal_yes_no",
    });
    expect(facts.relationship_meaning).toBe("reported_completion");
    expect(isStrongServerOutcomeForFailedSafePersist(inbound, "user_yes")).toBe(true);
  });

  it("M/N/O false positives", () => {
    expect(isReportedCompletionRelationshipCandidate("I wish I got 10,000 steps today")).toBe(
      false
    );
    expect(isReportedCompletionRelationshipCandidate("I plan to get 10,000 steps today")).toBe(
      false
    );
    expect(
      buildInboundMeaningFacts({
        rawInbound: "I did not get 10,000 steps",
        classifierEventType: "user_no",
      }).relationship_meaning
    ).toBe("miss");
  });
});

describe("tryResolveAnswerToOpenQuestionTurn proposal_yes_no", () => {
  it("resolves bounded yes to plan_confirmation", () => {
    const res = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "Yes",
      latestOpenQuestion: PLAN_Q,
      expectedReplySemantics: "proposal_yes_no",
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "10,000 steps",
      behaviorStatement: "10,000 steps",
    });
    expect(res?.subkind).toBe("plan_confirmation");
    expect(res?.shouldWriteOutcomeEvent).toBe(false);
  });
});

describe("unsupported accountability claim guard", () => {
  it("Q: blocks completion claim after bare yes", () => {
    const sacaResult = saca("Yes", PLAN_Q, {
      expectedAnswerType: "proposal_yes_no",
      openQuestionPending: true,
    });
    const violation = detectUnsupportedAccountabilityClaimInOutbound(
      "Great to hear you hit your 10,000 steps yesterday!",
      { rawInbound: "Yes", shortAnswerContext: sacaResult }
    );
    expect(violation?.kind).toBe("completion");
    expect(
      evidenceAllowsOutcomeClaim("completion", {
        rawInbound: "Yes",
        shortAnswerContext: sacaResult,
      })
    ).toBe(false);
  });

  it("S: allows supported today completion claim", () => {
    const inbound = "I got my 10,000 steps in today!";
    expect(
      evidenceAllowsOutcomeClaim("completion", {
        rawInbound: inbound,
        shortAnswerContext: resolveShortAnswerContextAuthority({
          rawInbound: inbound,
          latestOpenQuestion: OUTCOME_Q,
        }),
      })
    ).toBe(true);
  });
});

describe("inferPriorQuestionType", () => {
  it("detects plan_confirmation from proposal_yes_no", () => {
    expect(
      inferPriorQuestionType({
        rawInbound: "Yes",
        latestOpenQuestion: PLAN_Q,
        expectedAnswerType: "proposal_yes_no",
      })
    ).toBe("plan_confirmation");
  });
});
