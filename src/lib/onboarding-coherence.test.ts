import { describe, expect, it } from "vitest";
import { computeGoalCoherence, shouldShowReviewCoachPatNote } from "@/lib/onboarding-coherence";

describe("computeGoalCoherence", () => {
  it("uses master-plan enum values", () => {
    const r = computeGoalCoherence({
      identityAnchor: "I am becoming a steadier leader at home",
      goalTitle: "Be present after work",
      goalBehavior:
        "I will put my phone away for the first 30 minutes after I get home today.",
      selectedAreaId: "family_parenting",
    });
    expect(["high", "medium", "low", "unknown"]).toContain(r.coherenceStatus);
    expect(["strong", "acceptable", "weak"]).toContain(r.smsSuitability);
  });
});

describe("shouldShowReviewCoachPatNote", () => {
  it("requires high confidence and note text", () => {
    expect(
      shouldShowReviewCoachPatNote({
        coherence_status: "high",
        direct_connection_likely: true,
        confidence: 80,
        coach_pat_note_text: "Aligned goal.",
      })
    ).toBe(true);
    expect(
      shouldShowReviewCoachPatNote({
        coherence_status: "medium",
        direct_connection_likely: true,
        confidence: 80,
        coach_pat_note_text: "Aligned goal.",
      })
    ).toBe(false);
  });
});
