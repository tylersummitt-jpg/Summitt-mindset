import { describe, expect, it } from "vitest";
import {
  inboundHasExplicitAccountabilityMissClause,
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  looksLikeCoachContextCorrectionOrMetaDispute,
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
