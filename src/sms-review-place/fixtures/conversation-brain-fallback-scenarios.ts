import type { SmsReviewScenario } from "@/sms-review-place/types";

export const LEGACY_FALLBACK_TEMPLATE_PREVIEW_STUB =
  "INTERNAL_STUB_DO_NOT_SPEAK_LEGACY_DETERMINISTIC_TEMPLATE";

const CHECK_Q = "Did you hit two hours of deep work before noon?";

export const CONVERSATION_BRAIN_FALLBACK_SCENARIOS: SmsReviewScenario[] = [
  {
    id: "legacy-fallback-completion-safe",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "User reports completion; conversation brain unavailable; legacy fallback lane.",
    transcriptLines: [`Coach: ${CHECK_Q}`, "User: Yes — got the two hours in before noon"],
    memorySummary: "Completion on legacy fallback path; no Strategy Card.",
    expectedBehavior: "Ack completion naturally; no template preview spoken; final guard passes.",
    bugCategory: "legacy_fallback",
    expectClean: true,
    legacyFallback: {
      assertNoStrategyCard: true,
      assertFinalGuardRan: true,
      assertRoutePurpose: "conversation_brain_unavailable",
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "legacy-fallback-completion-safe:inbound",
        userReply: "Yes — got the two hours in before noon",
      },
    ],
  },
  {
    id: "legacy-fallback-miss-safe",
    personaId: "jordan",
    enabled: true,
    timezone: "America/New_York",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "User reports miss; legacy fallback asks blocker/recovery without proof overreach.",
    transcriptLines: [`Coach: ${CHECK_Q}`, "User: No — couldn't find the time today"],
    memorySummary: "Miss on legacy fallback path.",
    expectedBehavior: "Blocker/recovery tone; no fake proof/Victory; no template spoken.",
    bugCategory: "legacy_fallback",
    expectClean: true,
    legacyFallback: {
      assertNoStrategyCard: true,
      assertFinalGuardRan: true,
      assertRoutePurpose: "conversation_brain_unavailable",
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "legacy-fallback-miss-safe:inbound",
        userReply: "No — couldn't find the time today",
      },
    ],
  },
  {
    id: "legacy-fallback-template-preview-non-speakable",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Legacy fallback with deterministic template preview stub — must not be spoken.",
    transcriptLines: [`Coach: ${CHECK_Q}`, "User: Yes — got the two hours in before noon"],
    memorySummary: "Template preview non-speakable constraint.",
    expectedBehavior: "Humane reply without quoting internal deterministic template preview.",
    bugCategory: "legacy_fallback",
    expectClean: true,
    legacyFallback: {
      assertNoStrategyCard: true,
      assertFinalGuardRan: true,
      assertTemplatePreviewNonSpeakable: true,
      assertRoutePurpose: "conversation_brain_unavailable",
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "legacy-fallback-template-preview-non-speakable:inbound",
        userReply: "Yes — got the two hours in before noon",
      },
    ],
  },
  {
    id: "legacy-fallback-tu-suppresses-fallback",
    personaId: "alex",
    enabled: true,
    timezone: "America/Chicago",
    goalTitle: "Morning focus",
    behaviorStatement: "Two hours of deep work before noon",
    effectiveAsk: "Two hours of deep work before noon",
    threadSummary: "Authoritative TU overrides fallback suggested move.",
    transcriptLines: [`Coach: ${CHECK_Q}`, "User: Yes already done this morning"],
    memorySummary: "TU suppresses conversation_brain_fallback coaching move.",
    expectedBehavior: "TU-safe acknowledgment; fallback move suppressed in facts.",
    bugCategory: "legacy_fallback",
    expectClean: true,
    legacyFallback: {
      assertNoStrategyCard: true,
      assertFinalGuardRan: true,
      assertTuSuppressesFallback: true,
      assertRoutePurpose: "conversation_brain_unavailable",
    },
    steps: [
      {
        lane: "inbound",
        mockKey: "legacy-fallback-tu-suppresses-fallback:inbound",
        userReply: "Yes already done this morning",
      },
    ],
  },
];
