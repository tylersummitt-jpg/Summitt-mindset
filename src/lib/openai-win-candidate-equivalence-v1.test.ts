import { describe, expect, it } from "vitest";

import {
  buildWinCandidateEquivalenceSystemPrompt,
  fallbackEquivalenceForRelationship,
  fallbackEquivalenceJudgmentsForCandidates,
  WIN_EQUIVALENCE_VERSION,
} from "@/lib/openai-win-candidate-equivalence-v1";
import type { WinCandidateV1 } from "@/lib/openai-win-recognition-v1";

describe("openai-win-candidate-equivalence-v1", () => {
  it("documents versioned JSON-only schema and denies persistence authority", () => {
    const prompt = buildWinCandidateEquivalenceSystemPrompt();
    expect(prompt).toContain(WIN_EQUIVALENCE_VERSION);
    expect(prompt).toContain('"equivalence": "same" | "distinct"');
    expect(prompt).toContain("Do not decide whether user_yes occurred");
    expect(prompt).toContain("Do not decide whether any Win should be persisted");
  });

  it("fallback prefers no duplicate goal Wins but keeps whole_life/identity", () => {
    expect(fallbackEquivalenceForRelationship("goal")).toBe("same");
    expect(fallbackEquivalenceForRelationship("mixed")).toBe("same");
    expect(fallbackEquivalenceForRelationship("whole_life")).toBe("distinct");
    expect(fallbackEquivalenceForRelationship("identity")).toBe("distinct");
  });

  it("fallback judgments preserve ordinals", () => {
    const candidates: WinCandidateV1[] = [
      {
        ordinal: 0,
        grounded_action: "Workout",
        why_meaningful: null,
        suggested_title: "Workout",
        suggested_body: "Done",
        evidence_quote: null,
        relationship_type: "goal",
        recognition_mode: "coach_recognized",
        user_expressed_pride: false,
        identity_related: false,
        sensitivity_caution: false,
        celebration_appropriate: true,
        model_confidence: 0.8,
      },
      {
        ordinal: 1,
        grounded_action: "Promotion",
        why_meaningful: null,
        suggested_title: "Promotion",
        suggested_body: "Promoted",
        evidence_quote: null,
        relationship_type: "whole_life",
        recognition_mode: "coach_recognized",
        user_expressed_pride: true,
        identity_related: false,
        sensitivity_caution: false,
        celebration_appropriate: true,
        model_confidence: 0.9,
      },
    ];
    expect(fallbackEquivalenceJudgmentsForCandidates(candidates)).toEqual([
      { ordinal: 0, equivalence: "same", confidence: null },
      { ordinal: 1, equivalence: "distinct", confidence: null },
    ]);
  });
});
