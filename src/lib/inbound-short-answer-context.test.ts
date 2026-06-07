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

const PLAN_Q =
  "How does staying committed to taking at least 10,000 steps a day for the next 7 days feel for you? Let me know if that works or if you'd like to adjust!";

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
