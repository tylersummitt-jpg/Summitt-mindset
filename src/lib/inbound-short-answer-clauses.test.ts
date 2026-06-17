import { describe, expect, it } from "vitest";
import {
  inboundHasExplicitAccountabilityMissClause,
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  looksLikeCoachContextCorrectionOrMetaDispute,
  looksLikeOnboardingProcessDispute,
} from "@/lib/inbound-short-answer-clauses";

describe("inbound-short-answer-clauses — explicit completion expansion", () => {
  const completionCases = [
    "I hit the goal",
    "I hit my goal today",
    "I hit today's goal",
    "I got my distribution done today",
    "I got the goal done",
    "I got it done",
    "I completed my run today",
    "I completed today's commitment",
    "I finished my goal",
    "Did my hour today",
    "Just finished another 2 miles",
    "I got my 10,000 steps today",
    "I got my 10,000 steps in today",
    "I got my steps in today",
    "I got in 2 miles today",
    "I got my run in",
    "I got my workout in",
    "I did it before we had a birthday party",
  ];

  it.each(completionCases)("%s has explicit completion clause", (text) => {
    expect(inboundHasExplicitCompletionClause(text)).toBe(true);
  });

  it("future confidence trip does not have explicit completion clause", () => {
    const text =
      "We're heading to Tennessee on Thursday. We live in Ohio and we're driving to Tennessee with all three kids so it'll throw us off our routine a little bit but I should still be able to hit the goals";
    expect(inboundHasExplicitCompletionClause(text)).toBe(false);
  });
});

describe("inbound-short-answer-clauses — accountability miss vs meta-correction", () => {
  it("did not say is not an accountability miss clause", () => {
    const text = "I did not say I would be playing with the kids tomorrow";
    expect(inboundHasExplicitAccountabilityMissClause(text)).toBe(false);
    expect(inboundHasExplicitMissClause(text)).toBe(false);
    expect(looksLikeCoachContextCorrectionOrMetaDispute(text)).toBe(true);
  });

  it("did not do goal is an accountability miss clause", () => {
    expect(inboundHasExplicitAccountabilityMissClause("I did not do my goal today")).toBe(true);
    expect(looksLikeCoachContextCorrectionOrMetaDispute("I did not do my goal today")).toBe(false);
  });

  it("didn't hit steps is an accountability miss clause", () => {
    expect(inboundHasExplicitAccountabilityMissClause("No, I didn't hit my steps")).toBe(true);
  });

  it("didn't mean that is meta-correction not miss", () => {
    expect(inboundHasExplicitAccountabilityMissClause("I didn't mean that")).toBe(false);
    expect(looksLikeCoachContextCorrectionOrMetaDispute("I didn't mean that")).toBe(true);
  });
});

describe("inbound-short-answer-clauses — onboarding/coach-process disputes", () => {
  const ONBOARDING_DISPUTE =
    "Thanks I did 15 minutes of onboarding and you didn't ask me anything about what I chose. Did the onboarding matter?";

  it("onboarding dispute is coach/meta not accountability miss", () => {
    expect(looksLikeOnboardingProcessDispute(ONBOARDING_DISPUTE)).toBe(true);
    expect(looksLikeCoachContextCorrectionOrMetaDispute(ONBOARDING_DISPUTE)).toBe(true);
    expect(inboundHasExplicitAccountabilityMissClause(ONBOARDING_DISPUTE)).toBe(false);
  });

  it.each([
    "You didn't ask me about what I chose.",
    "Did the onboarding matter?",
    "Why didn't you ask me about my onboarding answers?",
    "You did not ask me anything about what I chose",
  ])("%s is coach/process dispute not miss", (text) => {
    expect(looksLikeCoachContextCorrectionOrMetaDispute(text)).toBe(true);
    expect(inboundHasExplicitAccountabilityMissClause(text)).toBe(false);
  });

  it.each([
    "I didn't do it today.",
    "I didn't hit my steps today.",
    "I did not get it today because this is the first day of vacation",
    "I missed it.",
    "Didn't happen.",
    "I skipped it.",
  ])("%s remains explicit accountability miss", (text) => {
    expect(inboundHasExplicitAccountabilityMissClause(text)).toBe(true);
    expect(looksLikeCoachContextCorrectionOrMetaDispute(text)).toBe(false);
  });

  it("onboarding minutes alone is not substantive goal completion", () => {
    expect(inboundHasExplicitCompletionClause("I did 15 minutes of onboarding")).toBe(false);
  });
});
