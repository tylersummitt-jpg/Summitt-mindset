import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import {
  applySmsMemoryAntiRepeatGuard,
  buildMemoryAntiRepeatRepairInstruction,
  buildMemoryRepeatRepairContext,
  computeRepeatOverlapDiagnostics,
  detectSmsMemoryRepeatViolation,
  extractForbiddenContentTokens,
  inferRecommendedRepeatRepairStrategy,
  isMemoryRepeatRepairBlockedReason,
  isNearExactDuplicateSms,
  MIN_QUESTION_OVERLAP_CHARS,
  normalizeSmsMemoryRepeatText,
  pickAlternateRepeatRepairStrategy,
  repairBodyMatchesStrategy,
  REPEAT_GUARD_WORD_OVERLAP_THRESHOLD,
  shouldApplyClosePriorPlanLoopAntiRepeatExemption,
  SMS_MEMORY_REPEAT_REPAIR_STRATEGIES,
  SMS_MEMORY_REPEAT_REPAIR_SYSTEM,
} from "@/lib/sms-memory-anti-repeat";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);
const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
  repairMock.mockReset();
});
describe("detectSmsMemoryRepeatViolation", () => {
  it("flags exact repeated question", () => {
    const q = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: `Quick check — ${q}`,
      lastCoachQuestions: [q],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_recent_question");
    expect(v.repeatedQuestion).toMatch(/dictate today/i);
  });

  it("flags close substring repeated question", () => {
    const prior = "What specific stories are you considering for tomorrow?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "What specific stories are you considering for tomorrow?",
      lastCoachQuestions: [prior],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_recent_question");
  });

  it("ignores tiny phrases", () => {
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "Sounds good — keep going.",
      doNotRepeatPhrases: ["ok", "got it"],
      lastCoachQuestions: ["ok"],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("ignores STOP/HELP/compliance footer", () => {
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "Great — what time works? Reply STOP to opt out.",
      doNotRepeatPhrases: ["Reply STOP to opt out"],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("ignores required contract binding when passed as requiredVerbatimSubstrings", () => {
    const binding = "Reply YES to accept this tighter overlay for the next 7 days.";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: binding,
      lastCoachQuestions: [binding],
      doNotRepeatPhrases: [binding],
      requiredVerbatimSubstrings: [binding],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("does not flag acknowledgment that references prior question without re-asking", () => {
    const prior = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody:
        "You're right — you already shared Sunday School, the farm, and your mother's songs. Let's move forward from that.",
      lastCoachQuestions: [prior],
      answeredOpenQuestion: prior,
      latestAnswerText: "Sunday School, farm, songs Mother sang",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("flags re-asking answered open question", () => {
    const q = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: q,
      answeredOpenQuestion: q,
      latestAnswerText: "Sunday School, farm, songs Mother sang",
      lastCoachQuestions: [q],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_answered_open_question");
  });

  it("flags repeated do_not_repeat phrase", () => {
    const phrase = "What time will you protect for deep work tomorrow morning?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: `Checking in — ${phrase}`,
      doNotRepeatPhrases: [phrase],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_do_not_repeat_phrase");
  });
});

describe("detectSmsMemoryRepeatViolation allowed callbacks (M2B-5 hardening)", () => {
  const rbPriorQ = "What story will you dictate today?";
  const rbPriorAnswer = "Sunday School, farm, songs Mother sang";

  const rbMemoryInputs = {
    lastCoachQuestions: [rbPriorQ],
    answeredOpenQuestion: rbPriorQ,
    latestAnswerText: rbPriorAnswer,
    doNotRepeatPhrases: [rbPriorQ, rbPriorAnswer],
  };

  it("allows topical callback using prior answer without re-asking", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: "Use Sunday School or the farm today.",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows you-already-gave acknowledgment of prior answer", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody:
        "You already gave me Sunday School, the farm, and songs your mother sang.",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows forward-progress which-one follow-up question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: "Which one of those three will you start with?",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("still flags exact repeated prior question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: rbPriorQ,
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_answered_open_question");
  });
});

describe("buildMemoryAntiRepeatRepairInstruction", () => {
  it("includes answer text when repeating answered open question", () => {
    const instruction = buildMemoryAntiRepeatRepairInstruction({
      reason: "repeated_answered_open_question",
      repeatedPhrases: ["What story?"],
      repeatedQuestion: "What story will you dictate today?",
      latestAnswerText: "Sunday School lesson",
    });
    expect(instruction).toMatch(/do not ask/i);
    expect(instruction).toMatch(/Sunday School lesson/i);
  });

  it("requires changing the coaching move, not paraphrasing", () => {
    const instruction = buildMemoryAntiRepeatRepairInstruction({
      reason: "repeated_recent_question",
      repeatedPhrases: ["what nurturing action can you take"],
      repeatedQuestion:
        "As you think about being kind to yourself today, what nurturing action can you take?",
      latestAnswerText: null,
    });
    expect(instruction).toMatch(/do not paraphrase/i);
    expect(instruction).toMatch(/change the coaching move/i);
    expect(instruction).toMatch(/same thing in different words/i);
    expect(instruction).toMatch(/proof or completion check/i);
    expect(instruction).toMatch(/memory callbacks/i);
  });
});

describe("isMemoryRepeatRepairBlockedReason", () => {
  it("detects memory_repeat_question blocker", () => {
    expect(isMemoryRepeatRepairBlockedReason(["memory_repeat_question"])).toBe(true);
    expect(isMemoryRepeatRepairBlockedReason(["too_long"])).toBe(false);
  });
});

describe("nurturing self-kindness memory repeat (M2B-5 frame shift)", () => {
  const prior =
    "As you think about being kind to yourself today, what nurturing action can you take? Reflect on something that feels supportive and share your plan!";
  const paraphraseRepair =
    "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";
  const frameShiftRepair =
    "Did you take one small supportive step today — yes, partial, or not yet?";

  const inputs = {
    lastCoachQuestions: [prior],
    doNotRepeatPhrases: [prior],
  };

  it("flags paraphrase repair as still repeated", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...inputs,
      candidateBody: paraphraseRepair,
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toMatch(/repeated_/);
  });

  it("allows frame-shift repair (proof/check-in vs planning question)", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...inputs,
      candidateBody: frameShiftRepair,
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows natural memory callback without re-asking the same question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...inputs,
      candidateBody:
        "Yesterday you said afternoons are where this slips — did anything supportive actually happen today, or not yet?",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows last-time partial callback", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...inputs,
      candidateBody:
        "Last time you said partial — did you get one small supportive thing in after lunch today?",
    });
    expect(v.hasViolation).toBe(false);
  });
});

describe("normalizeSmsMemoryRepeatText", () => {
  it("strips compliance footer before compare", () => {
    const n = normalizeSmsMemoryRepeatText("What time? Reply STOP to opt out.");
    expect(n).not.toMatch(/stop/i);
    expect(n).toMatch(/what time/i);
  });
});

describe("close_prior_plan_loop anti-repeat exemption", () => {
  const priorOutbound = "Did you get your two hours done?";
  const planAnswer = "I'll do it after Brooke gets back from her workout.";
  const closeLoopInputs = {
    answeredOpenQuestion: priorOutbound,
    latestAnswerText: planAnswer,
    lastCoachQuestions: [priorOutbound],
    pendingPlanProofActive: true,
    suggestedCoachingMove: "close_prior_plan_loop",
    lastOutboundFullBody: priorOutbound,
  };

  it("Test 1 — allows close-loop despite overlap with prior accountability question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...closeLoopInputs,
      candidateBody:
        "Did that Brooke workout window happen — done, partial, or missed?",
    });
    expect(v.hasViolation).toBe(false);
    expect(v.closeLoopExemptionApplied).toBe(true);
  });

  it("Test 2 — exact duplicate of prior outbound still blocked", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...closeLoopInputs,
      candidateBody: priorOutbound,
    });
    expect(v.hasViolation).toBe(true);
    expect(isNearExactDuplicateSms(priorOutbound, priorOutbound)).toBe(true);
  });

  it("Test 3 — no exemption without pending_plan_proof / close loop move", () => {
    const v = detectSmsMemoryRepeatViolation({
      answeredOpenQuestion: priorOutbound,
      latestAnswerText: planAnswer,
      lastCoachQuestions: [priorOutbound],
      candidateBody: "Did the two hours happen?",
      pendingPlanProofActive: false,
      suggestedCoachingMove: "ask_completion",
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_answered_open_question");
  });

  it("Test 4 — proof answer does not unlock exemption for re-ask", () => {
    const v = detectSmsMemoryRepeatViolation({
      answeredOpenQuestion: priorOutbound,
      latestAnswerText: "Done.",
      lastCoachQuestions: [priorOutbound],
      candidateBody: "Did the two hours happen?",
      pendingPlanProofActive: false,
      suggestedCoachingMove: "ask_completion",
    });
    expect(v.hasViolation).toBe(true);
    expect(shouldApplyClosePriorPlanLoopAntiRepeatExemption({
      candidateBody: "Did the two hours happen?",
      pendingPlanProofActive: false,
      suggestedCoachingMove: "ask_completion",
      latestAnswerText: "Done.",
    })).toBe(false);
  });

  it("Test 5 — new plan question is not exempt", () => {
    expect(
      shouldApplyClosePriorPlanLoopAntiRepeatExemption({
        candidateBody: "What's your plan today for the two hours?",
        pendingPlanProofActive: true,
        suggestedCoachingMove: "close_prior_plan_loop",
        latestAnswerText: planAnswer,
        lastOutboundFullBody: priorOutbound,
      })
    ).toBe(false);
  });

  it("Test 6 — close-loop repair instruction avoids build-on-answer", () => {
    const instruction = buildMemoryAntiRepeatRepairInstruction({
      reason: "repeated_answered_open_question",
      repeatedPhrases: [priorOutbound],
      repeatedQuestion: priorOutbound,
      latestAnswerText: planAnswer,
      pendingPlanProofActive: true,
      suggestedCoachingMove: "close_prior_plan_loop",
    });
    expect(instruction).toMatch(/plan or intention, not proof/i);
    expect(instruction).toMatch(/done, partial, or missed/i);
    expect(instruction).not.toMatch(/build on the answer instead of re-asking/i);
    expect(instruction).toMatch(/Do NOT merely repeat the prior coach question verbatim/i);
  });
});

describe("inferRecommendedRepeatRepairStrategy", () => {
  const kathyPrior =
    "That sounds like a fantastic plan, Kathy! Enjoy your hike into the mountains and let your chosen Pat Summitt quote inspire you.";
  const kathyCandidate =
    "How did your hike go, Kathy? Did you find a Pat Summitt quote that inspired you during your time in the mountains?";

  it("Kathy hike-style recommends outcome_check or binary_truth_check", () => {
    const strategy = inferRecommendedRepeatRepairStrategy({
      blockedCandidateBody: kathyCandidate,
      violationReason: "repeated_recent_question",
      repeatedQuestion: kathyPrior,
      repeatedPhrases: [kathyPrior],
    });
    expect(["outcome_check", "binary_truth_check"]).toContain(strategy);
  });

  it("Tyler distribution-style recommends outcome_check or binary_truth_check", () => {
    const tylerPrior =
      "Tyler, it's great to see you focused on your distribution time today. After Brooke's workout, dive into those two hours and let me know how it goes.";
    const tylerCandidate =
      "After Brooke's workout, were you able to spend those two hours on distribution?";
    const strategy = inferRecommendedRepeatRepairStrategy({
      blockedCandidateBody: tylerCandidate,
      violationReason: "repeated_recent_question",
      repeatedQuestion: tylerPrior,
      repeatedPhrases: [tylerPrior],
      suggestedCoachingMove: "close_prior_plan_loop",
      pendingPlanProofActive: false,
    });
    expect(["outcome_check", "binary_truth_check"]).toContain(strategy);
  });

  it("pickAlternateRepeatRepairStrategy never returns the same strategy", () => {
    for (const primary of SMS_MEMORY_REPEAT_REPAIR_STRATEGIES) {
      const alt = pickAlternateRepeatRepairStrategy(primary);
      expect(alt).not.toBe(primary);
    }
  });

  it("binary_truth_check alternate is barrier_check or next_first_step, not reset_question", () => {
    expect(pickAlternateRepeatRepairStrategy("binary_truth_check")).toBe("barrier_check");
    expect(pickAlternateRepeatRepairStrategy("binary_truth_check")).not.toBe("reset_question");
  });

  it("huddles near-exact repeat recommends barrier_check or next_first_step, not binary_truth_check", () => {
    const prior =
      "How did the morning huddles go this week in terms of sharing positive thoughts?";
    const candidate =
      "How did the morning huddles go this week in terms of sharing positive thoughts? Did everyone feel encouraged to participate and share their observations?";
    const strategy = inferRecommendedRepeatRepairStrategy({
      blockedCandidateBody: candidate,
      violationReason: "repeated_recent_question",
      repeatedQuestion: prior,
      repeatedPhrases: [prior],
    });
    expect(["barrier_check", "next_first_step"]).toContain(strategy);
    expect(strategy).not.toBe("binary_truth_check");
  });

  it("planning prior with outcome candidate still recommends binary_truth_check", () => {
    const prior =
      "Consider what nurturing action you can take today to show yourself kindness. Your commitment to self-care is important.";
    const candidate =
      "What nurturing action did you choose to take today to show yourself kindness? Reflecting on this can help reinforce your commitment to self-care.";
    const strategy = inferRecommendedRepeatRepairStrategy({
      blockedCandidateBody: candidate,
      violationReason: "repeated_recent_question",
      repeatedQuestion: prior,
      repeatedPhrases: [prior],
    });
    expect(strategy).toBe("binary_truth_check");
  });
});

describe("buildMemoryRepeatRepairContext", () => {
  it("populates required fields from daily-shaped facts", () => {
    const prior =
      "Tyler, after Brooke's workout, dive into those two hours on distribution.";
    const candidate = "After Brooke's workout, were you able to spend those two hours on distribution?";
    const violation = detectSmsMemoryRepeatViolation({
      candidateBody: candidate,
      lastCoachQuestions: [prior],
      lastOutboundFullBody: prior,
    });
    expect(violation.hasViolation).toBe(true);

    const ctx = buildMemoryRepeatRepairContext({
      routeKind: "daily",
      blockedCandidateBody: candidate,
      violation,
      detectInput: {
        candidateBody: candidate,
        lastCoachQuestions: [prior],
        lastOutboundFullBody: prior,
      },
      factsJson: {
        commitment: { behavior_statement: "Two hours of distribution daily" },
        thread_memory: { last_outbound_full_body: prior },
      },
    });

    expect(ctx.prior_outbound_full_body).toBe(prior);
    expect(ctx.blocked_candidate_body).toBe(candidate);
    expect(ctx.repeated_question).toBeTruthy();
    expect(ctx.accountability_purpose).toMatch(/distribution/i);
    expect(ctx.recommended_repair_strategy).toBeTruthy();
    expect(ctx.forbidden_coaching_frames.length).toBeGreaterThan(0);
    expect(ctx.strategy_examples.length).toBe(2);
  });
});

describe("buildMemoryAntiRepeatRepairInstruction fresh-angle", () => {
  it("includes enum and strategy when repairContext is present", () => {
    const ctx = buildMemoryRepeatRepairContext({
      routeKind: "daily",
      blockedCandidateBody: "How did your hike go?",
      violation: {
        hasViolation: true,
        reason: "repeated_recent_question",
        repeatedQuestion: "Enjoy your hike!",
        repeatedPhrases: ["Enjoy your hike!"],
      },
      detectInput: { candidateBody: "How did your hike go?" },
      factsJson: { commitment: { behavior_statement: "Hike weekly" } },
    });
    const instruction = buildMemoryAntiRepeatRepairInstruction({
      reason: "repeated_recent_question",
      repeatedPhrases: ctx.repeated_phrases,
      repeatedQuestion: ctx.repeated_question,
      repairContext: ctx,
    });
    expect(instruction).toMatch(/used_strategy/i);
    expect(instruction).toMatch(/binary_truth_check|outcome_check/);
    expect(instruction).toMatch(/months-long/i);
  });
});

describe("applySmsMemoryAntiRepeatGuard", () => {
  const priorQ =
    "As you think about being kind to yourself today, what nurturing action can you take? Reflect on something that feels supportive and share your plan!";
  const paraphraseRepair =
    "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";
  const frameShiftRepair =
    "Did you take one small supportive step today — yes, partial, or not yet?";

  const detectInput = {
    lastCoachQuestions: [priorQ],
    doNotRepeatPhrases: [priorQ],
  };

  it("always uses strict fresh-angle repair with enum strategy", async () => {
    repairMock.mockResolvedValueOnce({
      body: frameShiftRepair,
      openAiOk: true,
      metadata: {
        lane_repair_used_strategy: "binary_truth_check",
        repeat_repair_strategy: "binary_truth_check",
      },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(repairMock.mock.calls[0]?.[0]?.repairSnapshot).toBeTruthy();
    expect(repairMock.mock.calls[0]?.[0]?.memoryRepeatRepairContext).toBeUndefined();
    expect(repairMock.mock.calls[0]?.[0]?.factsJson).toBeUndefined();
    expect(repairMock.mock.calls[0]?.[0]?.forcedRepairStrategy).toBeTruthy();
    expect(r.outcome).toBe("ok");
    expect(r.metadata.repeat_repair_system).toBe(SMS_MEMORY_REPEAT_REPAIR_SYSTEM);
    expect(SMS_MEMORY_REPEAT_REPAIR_SYSTEM).toBe("fresh_angle_v2");
  });

  it("rejects invalid used_strategy", async () => {
    repairMock.mockResolvedValueOnce(null);

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("no_send");
    expect(r.metadata.repeat_repair_failed_reason).toBe("repair_failed");
    expect(r.metadata.repeat_repair_system).toBe(SMS_MEMORY_REPEAT_REPAIR_SYSTEM);
    expect(SMS_MEMORY_REPEAT_REPAIR_SYSTEM).toBe("fresh_angle_v2");
  });

  it("succeeds with valid fresh-angle repair", async () => {
    repairMock.mockResolvedValueOnce({
      body: frameShiftRepair,
      openAiOk: true,
      metadata: {
        lane_repair_used_strategy: "binary_truth_check",
        repeat_repair_strategy: "binary_truth_check",
      },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("ok");
    expect(r.metadata.repeat_repair_succeeded).toBe(true);
    expect(r.metadata.repeat_repair_strategy).toBe("binary_truth_check");
    expect(r.metadata.repeat_detected).toBe(true);
  });

  it("triggers second repair when first still repeats", async () => {
    repairMock
      .mockResolvedValueOnce({
        body: paraphraseRepair,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: "What got in the way of taking a supportive step today?",
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(2);
    expect(r.outcome).toBe("ok");
    expect(r.metadata.forced_second_repair_attempted).toBe(true);
  });

  it("runs validateAfterRepair after successful repeat repair", async () => {
    repairMock.mockResolvedValueOnce({
      body: frameShiftRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "binary_truth_check" },
    });
    const validateAfterRepair = vi.fn(async () => ({ ok: true as const }));

    await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: {},
      detectInput,
      enabled: true,
      validateAfterRepair,
    });

    expect(validateAfterRepair).toHaveBeenCalledTimes(1);
    expect(validateAfterRepair).toHaveBeenCalledWith(frameShiftRepair);
  });

  describe("openAiRepairEnabled", () => {
    it("no-sends without OpenAI repair when openAiRepairEnabled is false", async () => {
      const r = await applySmsMemoryAntiRepeatGuard({
        routeKind: "daily",
        routePurpose: "main_active_accountability",
        body: paraphraseRepair,
        factsJson: { commitment: { behavior_statement: "Self-care daily" } },
        detectInput,
        enabled: true,
        openAiRepairEnabled: false,
        validateAfterRepair: async () => ({ ok: true }),
      });

      expect(repairMock).not.toHaveBeenCalled();
      expect(r.outcome).toBe("no_send");
      expect(r.noSendReason).toBe("thread_memory_repeat_blocked");
      expect(r.metadata.memory_repeat_no_send_reason).toBe("repair_disabled_zero_question_mode");
      expect(r.metadata.memory_repeat_repair_skipped_zero_question_mode).toBe(true);
      expect(r.metadata.memory_repeat_repair_skipped_reason).toBe(
        "repair_disabled_zero_question_mode"
      );
      expect(r.metadata.repeat_repair_attempted).toBe(false);
    });

    it("preserves existing repair path when openAiRepairEnabled is true", async () => {
      repairMock.mockResolvedValueOnce({
        body: frameShiftRepair,
        openAiOk: true,
        metadata: {
          lane_repair_used_strategy: "binary_truth_check",
          repeat_repair_strategy: "binary_truth_check",
        },
      });

      const r = await applySmsMemoryAntiRepeatGuard({
        routeKind: "daily",
        routePurpose: "main_active_accountability",
        body: paraphraseRepair,
        factsJson: { commitment: { behavior_statement: "Self-care daily" } },
        detectInput,
        enabled: true,
        openAiRepairEnabled: true,
        validateAfterRepair: async () => ({ ok: true }),
      });

      expect(repairMock).toHaveBeenCalledTimes(1);
      expect(r.outcome).toBe("ok");
    });

    it("preserves existing repair path when openAiRepairEnabled is undefined", async () => {
      repairMock.mockResolvedValueOnce({
        body: frameShiftRepair,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      });

      const r = await applySmsMemoryAntiRepeatGuard({
        routeKind: "daily",
        routePurpose: "main_active_accountability",
        body: paraphraseRepair,
        factsJson: {},
        detectInput,
        enabled: true,
        validateAfterRepair: async () => ({ ok: true }),
      });

      expect(repairMock).toHaveBeenCalledTimes(1);
      expect(r.outcome).toBe("ok");
    });

    it("passes through clean body when openAiRepairEnabled is false", async () => {
      const clean = "Today protect two hours of deep work before noon — that is the standard.";
      const r = await applySmsMemoryAntiRepeatGuard({
        routeKind: "daily",
        routePurpose: "main_active_accountability",
        body: clean,
        factsJson: {},
        detectInput,
        enabled: true,
        openAiRepairEnabled: false,
        validateAfterRepair: async () => ({ ok: true }),
      });

      expect(repairMock).not.toHaveBeenCalled();
      expect(r.outcome).toBe("ok");
      expect(r.body).toBe(clean);
      expect(r.metadata.memory_repeat_guard_attempted).toBe(false);
    });
  });
});

describe("fresh_angle_v2 repeat repair", () => {
  const priorQ =
    "Consider what nurturing action you can take today to show yourself kindness. Your commitment to self-care is important.";
  const paraphraseRepair =
    "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";
  const frameShiftRepair =
    "Did you take one small supportive step today — yes, partial, or not yet?";

  const detectInput = {
    lastCoachQuestions: [priorQ],
    doNotRepeatPhrases: [priorQ],
  };

  it("repeat guard thresholds unchanged", () => {
    expect(MIN_QUESTION_OVERLAP_CHARS).toBe(18);
    expect(REPEAT_GUARD_WORD_OVERLAP_THRESHOLD).toBe(0.45);
  });

  it("self-care repair passes with fresh binary frame", async () => {
    repairMock.mockResolvedValueOnce({
      body: frameShiftRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "binary_truth_check" },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(frameShiftRepair);
    expect(r.metadata.repeat_repair_recommended_strategy).toBe("binary_truth_check");
    expect(r.metadata.repeat_repair_final_strategy).toBe("binary_truth_check");
    expect(repairBodyMatchesStrategy(frameShiftRepair, "binary_truth_check")).toBe(true);
  });

  it("extractForbiddenContentTokens includes phone/computer/away for device case", () => {
    const prior =
      "What specific steps will you take today to ensure you put your phone and computer away after your immediate work?";
    const candidate =
      "Payton, how did it go putting your phone and computer away after practice? Staying focused at home is key for your progress.";
    const tokens = extractForbiddenContentTokens({
      repeatedQuestion: prior,
      repeatedPhrases: [prior],
      blockedCandidateBody: candidate,
    });
    expect(tokens.some((t) => /phone/.test(t))).toBe(true);
    expect(tokens.some((t) => /computer/.test(t))).toBe(true);
    expect(tokens.some((t) => /away/.test(t))).toBe(true);
  });

  it("buildMemoryRepeatRepairContext includes forbidden_content_tokens", () => {
    const prior =
      "What specific steps will you take today to ensure you put your phone and computer away after your immediate work?";
    const candidate =
      "Payton, how did it go putting your phone and computer away after practice?";
    const violation = detectSmsMemoryRepeatViolation({
      candidateBody: candidate,
      lastCoachQuestions: [prior],
    });
    const ctx = buildMemoryRepeatRepairContext({
      routeKind: "daily",
      blockedCandidateBody: candidate,
      violation,
      detectInput: { candidateBody: candidate, lastCoachQuestions: [prior] },
      factsJson: {},
    });
    expect(ctx.forbidden_content_tokens.length).toBeGreaterThan(0);
    expect(ctx.forbidden_content_tokens.some((t) => /phone|computer/.test(t))).toBe(true);
  });

  it("attempt 2 receives overlap diagnostics when attempt 1 still repeats", async () => {
    repairMock
      .mockResolvedValueOnce({
        body: paraphraseRepair,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: "What got in the way of taking a supportive step today?",
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: { commitment: { behavior_statement: "Self-care daily" } },
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(2);
    expect(repairMock.mock.calls[0]?.[0]?.repairSnapshot?.repair_kind).toBe("memory_repeat");
    expect(repairMock.mock.calls[1]?.[0]?.repairSnapshot?.repair_kind).toBe("memory_repeat");
    expect(repairMock.mock.calls[1]?.[0]?.repairSnapshot?.violation.forced_repair_strategy).toBe(
      "barrier_check"
    );
    const secondInstruction = repairMock.mock.calls[1]?.[0]?.systemInstruction as string;
    expect(secondInstruction).toMatch(/Overlapping tokens|still matched prior phrase|First repair body/i);
    expect(r.outcome).toBe("ok");
    expect(r.metadata.repeat_repair_attempt_1_strategy).toBe("binary_truth_check");
    expect(r.metadata.repeat_repair_attempt_2_strategy).toBe("barrier_check");
    expect(r.metadata.forced_second_repair_attempted).toBe(true);
  });

  it("rejects repair when body does not match strategy label and tries alternate", async () => {
    const mismatchedBody =
      "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";
    repairMock
      .mockResolvedValueOnce({
        body: mismatchedBody,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: "What got in the way of follow-through today?",
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: {},
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(2);
    expect(r.outcome).toBe("ok");
  });

  it("still no-sends when both repairs stay repetitive", async () => {
    repairMock
      .mockResolvedValueOnce({
        body: paraphraseRepair,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: "What got in the way of taking that nurturing action to show kindness to yourself today?",
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphraseRepair,
      factsJson: {},
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("no_send");
    expect(r.metadata.repeat_repair_failed_reason).toBe("still_repeated_after_repair");
    expect(r.metadata.repeat_repair_still_repeated_phrase).toBeTruthy();
  });

  it("repairBodyMatchesStrategy rejects fake reset_question label", () => {
    expect(repairBodyMatchesStrategy("How did you do today?", "reset_question")).toBe(false);
    expect(repairBodyMatchesStrategy("Do we need to reset the window?", "reset_question")).toBe(true);
  });

  it("accepts clear completion repair when strategy label mismatches but body is non-repetitive", async () => {
    const repeatedQ = "Have you started your commitment to take at least 10,000 steps today?";
    const detectInput = {
      candidateBody: repeatedQ,
      lastCoachQuestions: [repeatedQ],
      latestAnswerText: "I did my 10,000 steps yesterday!",
      suggestedCoachingMove: "acknowledge_completion",
      clearCompletionInbound: true,
      latestInboundText: "I did my 10,000 steps yesterday!",
    };
    repairMock.mockResolvedValueOnce({
      body: "Solid work yesterday — that's real follow-through on the bar. What's one honest move for today?",
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "proof_check" },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "inbound",
      routePurpose: "normal_inbound_reply",
      body: repeatedQ,
      factsJson: {},
      detectInput,
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("ok");
    expect(r.body.toLowerCase()).not.toContain("have you started");
  });

  it("computeRepeatOverlapDiagnostics finds overlapping tokens", () => {
    const prior =
      "Consider what nurturing action you can take today to show yourself kindness.";
    const repeated = paraphraseRepair;
    const violation = detectSmsMemoryRepeatViolation({
      candidateBody: repeated,
      lastCoachQuestions: [prior],
    });
    const diag = computeRepeatOverlapDiagnostics({ candidateBody: repeated, violation });
    expect(diag.triggeringPhrase).toBeTruthy();
    expect(diag.overlapTokens.some((t) => /nurturing|kindness|action/.test(t))).toBe(true);
  });
});

describe("strategy label mismatch soft-accept (B/C hybrid)", () => {
  const eveningPrior = "How did your evening wind-down go?";
  const eveningCandidate = `${eveningPrior} Let's keep focusing on that consistency to hit your 9:30 goal.`;
  const eveningBarrierRepair =
    "What challenges came up that might have affected your plan to be in bed by 9:30 pm?";

  const devicePrior =
    "What specific steps will you take today to ensure you put your phone and computer away after your immediate work?";
  const deviceCandidate =
    "Payton, how did it go putting your phone and computer away after practice? Staying focused at home is key.";
  const deviceFocusRepair =
    "How did your focus environment feel today — did you find it easier to stay on task, or were there distractions?";

  it("A: soft-accepts clean barrier-like repair when strategy label regex mismatches", async () => {
    repairMock.mockResolvedValueOnce({
      body: eveningBarrierRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "barrier_check" },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: eveningCandidate,
      factsJson: {},
      detectInput: { lastCoachQuestions: [eveningPrior], candidateBody: eveningCandidate },
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(eveningBarrierRepair);
    expect(repairBodyMatchesStrategy(eveningBarrierRepair, "barrier_check")).toBe(false);
    expect(r.metadata.repeat_repair_strategy_label_soft_accepted).toBe(true);
    expect(r.metadata.repeat_repair_strategy_label_mismatch).toBe(true);
    expect(r.metadata.memory_repeat_no_send_reason).toBeNull();
    expect(r.metadata.repeat_repair_failed_reason).toBeNull();
  });

  it("B: soft-accepts clean focus-environment repair when binary_truth_check label mismatches", async () => {
    repairMock.mockResolvedValueOnce({
      body: deviceFocusRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "binary_truth_check" },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: deviceCandidate,
      factsJson: {},
      detectInput: { lastCoachQuestions: [devicePrior], candidateBody: deviceCandidate },
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(deviceFocusRepair);
    expect(repairBodyMatchesStrategy(deviceFocusRepair, "binary_truth_check")).toBe(false);
    expect(r.metadata.repeat_repair_strategy_label_soft_accepted).toBe(true);
  });

  it("C: still-repeated mismatch repair does not soft-accept", async () => {
    const prior =
      "Consider what nurturing action you can take today to show yourself kindness.";
    const paraphrase =
      "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";

    repairMock
      .mockResolvedValueOnce({
        body: paraphrase,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: "What got in the way of taking that nurturing action to show kindness to yourself today?",
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphrase,
      factsJson: {},
      detectInput: { lastCoachQuestions: [prior], candidateBody: paraphrase },
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(r.outcome).toBe("no_send");
    expect(r.metadata.repeat_repair_failed_reason).toBe("still_repeated_after_repair");
    expect(r.metadata.repeat_repair_strategy_label_soft_accepted).toBeFalsy();
  });

  it("D: validateAfterRepair failure no-sends with lane reason, not strategy mismatch", async () => {
    repairMock.mockResolvedValueOnce({
      body: eveningBarrierRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "barrier_check" },
    });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: eveningCandidate,
      factsJson: {},
      detectInput: { lastCoachQuestions: [eveningPrior], candidateBody: eveningCandidate },
      enabled: true,
      validateAfterRepair: async () => ({
        ok: false,
        noSendReason: "temporal_wording_blocked",
      }),
    });

    expect(r.outcome).toBe("no_send");
    expect(r.noSendReason).toBe("temporal_wording_blocked");
    expect(r.metadata.memory_repeat_no_send_reason).toBe("post_repair_validation_failed");
    expect(r.metadata.repeat_repair_strategy_label_soft_accepted).toBeFalsy();
  });

  it("E: attempt 1 clean mismatch soft-accepted without second OpenAI call", async () => {
    repairMock.mockResolvedValueOnce({
      body: eveningBarrierRepair,
      openAiOk: true,
      metadata: { lane_repair_used_strategy: "barrier_check" },
    });

    await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: eveningCandidate,
      factsJson: {},
      detectInput: { lastCoachQuestions: [eveningPrior] },
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
  });

  it("F: attempt 1 still-repeats, attempt 2 clean mismatch soft-accepts", async () => {
    const prior =
      "Consider what nurturing action you can take today to show yourself kindness.";
    const paraphrase =
      "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";
    const frameShift = "Did you take one small supportive step today — yes, partial, or not yet?";

    repairMock
      .mockResolvedValueOnce({
        body: paraphrase,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "binary_truth_check" },
      })
      .mockResolvedValueOnce({
        body: frameShift,
        openAiOk: true,
        metadata: { lane_repair_used_strategy: "barrier_check" },
      });

    const r = await applySmsMemoryAntiRepeatGuard({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      body: paraphrase,
      factsJson: {},
      detectInput: { lastCoachQuestions: [prior], candidateBody: paraphrase },
      enabled: true,
      validateAfterRepair: async () => ({ ok: true }),
    });

    expect(repairMock).toHaveBeenCalledTimes(2);
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(frameShift);
    expect(r.metadata.repeat_repair_attempt_1_strategy).toBe("binary_truth_check");
    expect(r.metadata.repeat_repair_attempt_2_strategy).toBe("barrier_check");
    expect(r.metadata.repeat_repair_strategy_label_soft_accepted).toBe(true);
    expect(r.metadata.forced_second_repair_attempted).toBe(true);
  });
});
