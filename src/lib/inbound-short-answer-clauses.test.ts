import { describe, expect, it } from "vitest";
import {
  inboundHasExplicitAccountabilityMissClause,
  inboundHasExplicitMissClause,
  looksLikeCoachContextCorrectionOrMetaDispute,
} from "@/lib/inbound-short-answer-clauses";

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
