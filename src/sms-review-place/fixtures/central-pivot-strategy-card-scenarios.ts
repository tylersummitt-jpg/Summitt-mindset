import type { SmsReviewScenario } from "@/sms-review-place/types";

export const CENTRAL_PIVOT_LEGACY_TETHER_PREVIEW_STUB =
  "INTERNAL_STUB_DO_NOT_SPEAK_LEGACY_CENTRAL_TETHER_PREVIEW";

export const CENTRAL_PIVOT_STRATEGY_CARD_SCENARIOS: SmsReviewScenario[] = [
  {
    id: "central-pivot-human-conversation",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "User sends human small-talk detour; outcome scoring blocked.",
    transcriptLines: [
      "Coach: Did you hit two hours before noon?",
      "User: Hey — rough morning, kids were sick",
    ],
    memorySummary: "Human conversation pivot; no outcome write.",
    expectedBehavior: "Brief humane reply; no completion/miss scoring.",
    bugCategory: "central_pivot_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "central_brain_pivot",
      moveType: ["close_loop", "other"],
      allowedClaimsFalse: [
        "completion",
        "miss",
        "partial",
        "proof",
        "victory_room",
        "state_changed",
        "proposal_active",
      ],
      mustNotDoIncludes: [/completion, miss, or partial|score this turn/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "central-pivot-human-conversation:inbound",
        userReply: "Hey — rough morning, kids were sick",
      },
    ],
  },
  {
    id: "central-pivot-meta-confusion",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "User confused about how Summitt works; pivot clarifies without scoring.",
    transcriptLines: [
      "Coach: Did you hit two hours before noon?",
      "User: Wait — am I supposed to reply yes or no to everything?",
    ],
    memorySummary: "Meta confusion pivot; clarify once.",
    expectedBehavior: "One clarifying answer; no outcome claims.",
    bugCategory: "central_pivot_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "central_brain_pivot",
      moveType: "clarify",
      maxQuestions: 1,
      allowedClaimsFalse: ["completion", "miss", "partial", "proof", "victory_room"],
      mustNotDoIncludes: [/confusion as today's|accountability outcome/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "central-pivot-meta-confusion:inbound",
        userReply: "Wait — am I supposed to reply yes or no to everything?",
      },
    ],
  },
  {
    id: "central-pivot-legacy-tether-non-speakable",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Central pivot with legacy tether preview stub — must not be spoken.",
    transcriptLines: [
      "Coach: Did you hit two hours before noon?",
      "User: Honestly I'm not sure what you need from me",
    ],
    memorySummary: "Legacy tether preview non-speakable.",
    expectedBehavior: "Humane pivot reply without quoting legacy tether preview.",
    bugCategory: "central_pivot_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "central_brain_pivot",
      moveType: ["clarify", "close_loop", "other"],
      mustNotDoIncludes: [/prior internal coach draft preview|internal coach draft preview/i],
      avoidRepeatingIncludes: [/INTERNAL_STUB|LEGACY_CENTRAL/i],
      assertCentralPivotPreviewNonSpeakable: true,
      assertSingleStrategyAuthority: true,
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "central-pivot-legacy-tether-non-speakable:inbound",
        userReply: "Honestly I'm not sure what you need from me",
      },
    ],
  },
  {
    id: "central-pivot-advice-request",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "User asks for coaching advice; protect existing plan.",
    transcriptLines: [
      "Coach: Did you hit two hours before noon?",
      "User: Any tips for getting started when I'm dragging?",
    ],
    memorySummary: "Advice request pivot; no state change.",
    expectedBehavior: "Concise coaching anchored to commitment; no state_changed.",
    bugCategory: "central_pivot_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "central_brain_pivot",
      moveType: ["protect_existing_plan", "clarify"],
      allowedClaimsFalse: [
        "completion",
        "miss",
        "partial",
        "proof",
        "victory_room",
        "state_changed",
        "proposal_active",
      ],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "central-pivot-advice-request:inbound",
        userReply: "Any tips for getting started when I'm dragging?",
      },
    ],
  },
];
