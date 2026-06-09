import type { SmsReviewScenario } from "@/sms-review-place/types";

const ARC_CHECK_Q = "Did you hit two hours of deep work before noon?";
export const ARC_LEGACY_PREVIEW_STUB =
  "INTERNAL_STUB_DO_NOT_SPEAK_LEGACY_ARC_CLARIFICATION_TEMPLATE";

export const ARC_CLARIFY_STRATEGY_CARD_SCENARIOS: SmsReviewScenario[] = [
  {
    id: "arc-clarify-ambiguous-short",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Coach asked accountability check; user gives ambiguous short reply.",
    transcriptLines: [`Coach: ${ARC_CHECK_Q}`, "User: k"],
    memorySummary: "Ambiguous short reply; tentative yes not confirmed.",
    expectedBehavior: "One clarifying question; no outcome claims.",
    bugCategory: "arc_clarify_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "arc_clarify_ambiguous_short",
      moveType: "clarify",
      maxQuestions: 1,
      allowedClaimsFalse: ["completion", "miss", "partial", "proof", "victory_room", "state_changed", "proposal_active"],
      mustNotDoIncludes: [/tentative_outcome|tentative outcome/i],
    },
    steps: [{ lane: "inbound", mockKey: "arc-clarify-ambiguous-short:inbound", userReply: "k" }],
  },
  {
    id: "arc-clarify-legacy-preview-non-speakable",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Arc clarify with legacy internal clarification template preview stub.",
    transcriptLines: [`Coach: ${ARC_CHECK_Q}`, "User: maybe"],
    memorySummary: "Legacy clarification preview must not be spoken.",
    expectedBehavior: "Clarify without quoting legacy template preview.",
    bugCategory: "arc_clarify_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "arc_clarify_ambiguous_short",
      moveType: "clarify",
      maxQuestions: 1,
      mustNotDoIncludes: [/internal clarification template preview|clarification template preview/i],
      avoidRepeatingIncludes: [/INTERNAL_STUB|LEGACY_ARC/i],
      assertArcPreviewNonSpeakable: true,
      assertSingleStrategyAuthority: true,
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "arc-clarify-legacy-preview-non-speakable:inbound",
        userReply: "maybe",
      },
    ],
  },
  {
    id: "arc-clarify-tentative-outcome-not-scored",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Classifier tentatively read yes; arc forces clarify before scoring.",
    transcriptLines: [`Coach: ${ARC_CHECK_Q}`, "User: yep"],
    memorySummary: "Tentative user_yes must not become completion claim.",
    expectedBehavior: "Clarify; no completion/miss/partial/proof in card claims.",
    bugCategory: "arc_clarify_strategy_card",
    expectClean: true,
    strategyCard: {
      routeKind: "arc_clarify_ambiguous_short",
      moveType: "clarify",
      maxQuestions: 1,
      allowedClaimsFalse: ["completion", "miss", "partial", "proof", "victory_room"],
      mustNotDoIncludes: [/tentative_outcome|Do not claim completion/i],
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "arc-clarify-tentative-outcome-not-scored:inbound",
        userReply: "yep",
      },
    ],
  },
];
