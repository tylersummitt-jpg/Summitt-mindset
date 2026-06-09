import type { SmsReviewScenario } from "@/sms-review-place/types";

const OQ_REFLECTION_Q =
  "What would need to be true for the strength session after Brooke's workout to actually happen?";
const OQ_PLAN_Q = "Want to lock in a strength session right after Brooke's workout?";
const OLD_PREVIEW_STUB =
  "INTERNAL_STUB_DO_NOT_SPEAK_LEGACY_PREVIEW_TEXT from prior writer path";

export const OPEN_QUESTION_STRATEGY_CARD_SCENARIOS: SmsReviewScenario[] = [
  {
    id: "open-question-clear-answer",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Coach asked open reflection question; user answers clearly.",
    transcriptLines: [
      `Coach: ${OQ_REFLECTION_Q}`,
      "User: I'd need to eat before Brooke's workout so I'm not running on empty",
    ],
    memorySummary: "Open question pending; clear answer inbound.",
    expectedBehavior: "Close loop; do not re-ask; no false outcome claims.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      moveType: "close_loop",
      mustNotDoIncludes: [/re-ask the same open question/i],
      avoidRepeatingIncludes: [/need to be true|eat before Brooke/i],
      allowedClaimsFalse: ["completion", "miss", "partial", "proof"],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-clear-answer:inbound",
        userReply: "I'd need to eat before Brooke's workout so I'm not running on empty",
      },
    ],
  },
  {
    id: "open-question-unclear-answer",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Coach asked open reflection question; user gives unclear partial answer.",
    transcriptLines: [`Coach: ${OQ_REFLECTION_Q}`, "User: I'm not really sure yet — depends how Brooke's workout goes"],
    memorySummary: "Open question pending; ambiguous answer.",
    expectedBehavior: "One clarifying question; no pile-on; no resolved claim.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      moveType: "clarify",
      maxQuestions: 1,
      mustNotDoIncludes: [/pile on unrelated|claim the open question is resolved/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-unclear-answer:inbound",
        userReply: "I'm not really sure yet — depends how Brooke's workout goes",
      },
    ],
  },
  {
    id: "open-question-plan-ack",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Coach proposed plan timing; user confirms briefly.",
    transcriptLines: [`Coach: ${OQ_PLAN_Q}`, "User: Sounds good"],
    memorySummary: "Plan acknowledgment; not outcome proof.",
    expectedBehavior: "Protect plan; no blocker ask; no completion/proof claims.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      moveType: ["protect_existing_plan", "close_loop"],
      forbiddenMoves: ["ask_blocker", "ack_completion"],
      allowedClaimsFalse: ["completion", "miss", "partial", "proof", "victory_room"],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-plan-ack:inbound",
        userReply: "Sounds good",
      },
    ],
  },
  {
    id: "open-question-satisfied-no-repeat",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Open question already satisfied in thread memory.",
    transcriptLines: [
      `Coach: ${OQ_REFLECTION_Q}`,
      "User: I'd need to eat before Brooke's workout so I'm not running on empty",
    ],
    memorySummary: "Answer recorded; open_question_pending false.",
    expectedBehavior: "Close loop; avoid repeating satisfied question.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      moveType: ["close_loop", "protect_existing_plan"],
      mustNotDoIncludes: [/re-ask the satisfied open question|re-ask the same open question/i],
      avoidRepeatingIncludes: [/need to be true|eat before Brooke/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-satisfied-no-repeat:inbound",
        userReply: "I'd need to eat before Brooke's workout so I'm not running on empty",
      },
    ],
  },
  {
    id: "open-question-not-delivered",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Open question exists but prior coach ask was preview-only (not delivered).",
    transcriptLines: [`Coach: ${OQ_REFLECTION_Q}`],
    memorySummary: "Preview-only coach ask; may naturally re-ask.",
    expectedBehavior: "Clarify or close; do not imply user ignored the question.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      moveType: ["clarify", "close_loop"],
      mustNotDoIncludes: [/ignored the earlier question/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-not-delivered:inbound",
        userReply: "I'd need to eat before Brooke's workout so I'm not running on empty",
      },
    ],
  },
  {
    id: "open-question-old-preview-non-speakable",
    personaId: "brooke",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Workout",
    behaviorStatement: "Strength session after Brooke's workout",
    effectiveAsk: "Strength session after Brooke's workout",
    threadSummary: "Open question facts include legacy internal coach preview stub.",
    transcriptLines: [
      `Coach: ${OQ_REFLECTION_Q}`,
      "User: I'd need to eat before Brooke's workout so I'm not running on empty",
    ],
    memorySummary: "Legacy preview present; must stay non-speakable in card.",
    expectedBehavior: "Strategy card carries non-speakable constraint; preview not user-facing copy.",
    bugCategory: "open_question_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "open_question_answer",
      assertOldPreviewNonSpeakable: true,
      assertSingleStrategyAuthority: true,
      mustNotDoIncludes: [/prior internal coach draft preview/i],
      avoidRepeatingIncludes: [/INTERNAL_STUB_DO_NOT_SPEAK/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "open-question-old-preview-non-speakable:inbound",
        userReply: "I'd need to eat before Brooke's workout so I'm not running on empty",
      },
    ],
  },
];

export const OLD_PREVIEW_STUB_TEXT = OLD_PREVIEW_STUB;
