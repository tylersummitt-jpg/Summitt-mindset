import { describe, expect, it } from "vitest";

import {
  applyEarnedPraisePolicyToVoiceBlockedReasons,
  buildSmsPraisePolicyArgsFromDailyFacts,
  buildSmsPraisePolicyArgsFromFinalVoiceGate,
  detectSpecificAcknowledgmentInBody,
  evaluateSmsPraisePolicy,
} from "@/lib/sms-earned-praise-policy";
import {
  detectFinalVoiceBlockedReasons,
  detectRelationshipCoachingVoiceBlockedReasons,
  evaluateRelationshipVoiceWithPraisePolicy,
} from "@/lib/v3-sms-voice-ownership";

const earnedDailyArgs = {
  body: "",
  routeKind: "main_active_accountability",
  accountability: {
    prior_outcome: "user_yes" as string | null,
    proof_or_milestone_signal: "distribution_time_done",
    pending_plan_proof: null,
    yes_streak_14d: 1,
  },
  commitment: {
    effective_ask: "Protect two hours for distribution time",
    behavior_statement: "distribution time each day",
  },
  thread_memory: {
    latest_inbound_sms: "Got distribution time done today.",
    last_5_coach_questions: [] as string[],
  },
};

function dailyPolicy(body: string, threadOverrides?: Partial<typeof earnedDailyArgs.thread_memory>) {
  return evaluateSmsPraisePolicy(
    buildSmsPraisePolicyArgsFromDailyFacts({
      ...earnedDailyArgs,
      body,
      thread_memory: { ...earnedDailyArgs.thread_memory, ...threadOverrides },
    })
  );
}

describe("Earned Praise Policy v1.1", () => {
  it("A: cross-family cooldown — recent great job blocks new good work", () => {
    const body = "Good work making the calls — what helped?";
    const policy = dailyPolicy(body, {
      last_5_coach_questions: ["Great job getting the calls done."],
    });
    expect(policy.blocked_reasons).toContain("generic_praise_overused_warm_family");
  });

  it("B: cross-family cooldown — recent nice work blocks proud of you", () => {
    const body = "Proud of you for getting it done.";
    const policy = dailyPolicy(body, {
      last_5_coach_questions: ["Nice work on the two hours."],
    });
    expect(policy.blocked_reasons).toContain("generic_praise_overused_warm_family");
  });

  it("C: specific acknowledgment allowed despite recent warm praise", () => {
    const body = "That's two days in a row on the calls — what helped you start?";
    const policy = dailyPolicy(body, {
      last_5_coach_questions: ["Great job getting the calls done."],
    });
    expect(policy.blocked_reasons).toEqual([]);
    expect(policy.specific_acknowledgment_detected).toBe(true);
    expect(detectSpecificAcknowledgmentInBody(body)).toBe(true);
  });

  it("D: user_yes + specific anchor + recent warm praise blocks great job", () => {
    const body = "Great job getting the two hours done — what made it work?";
    const policy = dailyPolicy(body, {
      last_5_coach_questions: ["Good work on distribution time yesterday."],
    });
    expect(policy.blocked_reasons).toContain("generic_praise_overused_warm_family");
  });

  it("E: first warm praise after earned specific completion allowed", () => {
    const body =
      "Great job getting the two hours of distribution done — what made it work?";
    const policy = dailyPolicy(body);
    expect(policy.blocked_reasons).toEqual([]);
    expect(policy.detected_warm_praise_phrases).toContain("great_job");
  });

  it("F: momentum variant continue this momentum blocked even with streak", () => {
    const body =
      "As you continue this momentum, does two hours still fit tomorrow?";
    const policy = evaluateSmsPraisePolicy({
      body,
      laneKind: "daily",
      priorOutcome: "user_yes",
      yesStreak14d: 2,
      effectiveAsk: "two hours",
      praisePolicyContextFromLane: true,
    });
    expect(policy.blocked_reasons).toContain("generic_momentum");
  });

  it("G: v1.1 keeps generic keep momentum blocked without evidence-specific wording", () => {
    const body = "Keep this momentum going — does two hours still fit tomorrow?";
    const policy = evaluateSmsPraisePolicy({
      body,
      laneKind: "daily",
      priorOutcome: "user_yes",
      yesStreak14d: 3,
      effectiveAsk: "two hours",
      praisePolicyContextFromLane: true,
    });
    expect(policy.blocked_reasons).toContain("generic_momentum");
  });

  it("H: vague praise — great job getting it done without anchor", () => {
    const body = "Great job getting it done.";
    const policy = dailyPolicy(body);
    expect(policy.blocked_reasons).toContain("generic_praise_vague");
  });

  it("I: FVG context parity — lane and FVG agree when context embedded", () => {
    const body =
      "Great job getting the two hours done — what made it work?";
    const praisePolicy = buildSmsPraisePolicyArgsFromDailyFacts({
      ...earnedDailyArgs,
      body,
    });
    const lane = evaluateRelationshipVoiceWithPraisePolicy(body, { praisePolicy });
    const fvg = evaluateRelationshipVoiceWithPraisePolicy(body, {
      praisePolicy: buildSmsPraisePolicyArgsFromFinalVoiceGate({
        proposedBody: body,
        effectiveAsk: earnedDailyArgs.commitment.effective_ask,
        v3BrainMetadata: { praise_policy_context: praisePolicy },
      }),
    });
    expect(lane.reasons).toEqual(fvg.reasons);
    expect(lane.reasons).not.toContain("great_job");
  });

  it("FVG without context blocks warm praise strictly", () => {
    const body = "Great job getting the two hours done — what made it work?";
    const fvgMinimal = evaluateRelationshipVoiceWithPraisePolicy(body, {
      praisePolicy: buildSmsPraisePolicyArgsFromFinalVoiceGate({
        proposedBody: body,
        effectiveAsk: "Protect two hours for distribution time",
        contextPacket: { latestOutcomeType: "user_yes" },
      }),
    });
    expect(fvgMinimal.reasons).toContain("generic_praise_insufficient_context");
  });

  it("does not allow warm praise every user_yes via phrase rotation", () => {
    const bodies = [
      "Great job getting the two hours done.",
      "Good work making the calls today.",
      "Nice work on distribution time.",
    ];
    for (let i = 0; i < bodies.length; i++) {
      const recent = bodies.slice(0, i);
      const policy = dailyPolicy(bodies[i], { last_5_coach_questions: recent });
      if (i === 0) {
        expect(policy.blocked_reasons).toEqual([]);
      } else {
        expect(policy.blocked_reasons).toContain("generic_praise_overused_warm_family");
      }
    }
  });

  it("stale 7d wins alone do not authorize warm praise without fresh context", () => {
    const policy = evaluateSmsPraisePolicy({
      body: "Great job getting the two hours done.",
      laneKind: "daily",
      effectiveAsk: "Protect two hours for distribution time",
      behaviorStatement: "distribution time",
      relationshipMemory7d: {
        wins: ["completed tuesday"],
        proof_moments: [],
        comebacks: [],
        outcome_counts: { yes: 0, no: 0, partial: 0 },
        context_flags: {},
      } as never,
      praisePolicyContextFromLane: true,
    });
    expect(policy.blocked_reasons).toContain("generic_praise_unearned");
  });

  it("production candidate: great job may pass but continue this momentum blocked", () => {
    const body =
      "Tyler, great job on getting your distribution time done! As you continue this momentum, does committing to at least two hours each day for the next week still fit your schedule, or would you like to adjust?";
    const voice = evaluateRelationshipVoiceWithPraisePolicy(body, {
      praisePolicy: buildSmsPraisePolicyArgsFromDailyFacts({
        ...earnedDailyArgs,
        body,
        accountability: { ...earnedDailyArgs.accountability, yes_streak_14d: 2 },
      }),
    });
    expect(voice.reasons).toContain("generic_momentum");
    expect(voice.reasons).not.toContain("great_job");
  });

  it("Good work. What's next? blocked as vague", () => {
    const policy = dailyPolicy("Good work. What's next?");
    expect(policy.blocked_reasons).toContain("generic_praise_vague");
  });

  it("standalone great job blocked even with proof", () => {
    const policy = dailyPolicy("Great job!");
    expect(policy.blocked_reasons).toContain("generic_praise_vague");
  });

  it("unearned warm praise blocked", () => {
    const policy = evaluateSmsPraisePolicy({
      body: "Great job — keep going.",
      laneKind: "daily",
      effectiveAsk: "Protect two hours",
      behaviorStatement: "distribution time",
      praisePolicyContextFromLane: true,
    });
    expect(policy.blocked_reasons).toContain("generic_praise_unearned");
  });

  it("great job allowed after earned completion when specific (legacy A)", () => {
    const body = "Great job getting the two hours done — what made it work?";
    const policy = dailyPolicy(body);
    const raw = detectFinalVoiceBlockedReasons(body);
    expect(raw).toContain("great_job");
    const merged = applyEarnedPraisePolicyToVoiceBlockedReasons(raw, policy);
    expect(merged).not.toContain("great_job");
    expect(merged.some((r) => r.startsWith("generic_praise"))).toBe(false);
  });
});

describe("detectRelationshipCoachingVoiceBlockedReasons praise defaults", () => {
  it("without facts, relabels great_job to generic praise block", () => {
    const reasons = detectRelationshipCoachingVoiceBlockedReasons("Great job — keep going.");
    expect(
      reasons.some((r) =>
        ["generic_praise_unearned", "generic_praise_insufficient_context", "generic_praise_vague"].includes(r)
      )
    ).toBe(true);
    expect(reasons).not.toContain("great_job");
  });
});
