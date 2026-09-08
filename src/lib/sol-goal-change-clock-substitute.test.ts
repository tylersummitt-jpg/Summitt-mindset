import { describe, expect, it } from "vitest";
import {
  isSolGoalChangeClockOnlyFragment,
  resolveReplaceHallwayClockCandidate,
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-clock-substitute";

const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const NORMALIZED = "I will be in bed by 10:30 pm nightly.";

describe("sol-goal-change-clock-substitute", () => {
  it("treats trailing-punctuated 10:30. as a clock fragment", () => {
    expect(isSolGoalChangeClockOnlyFragment("10:30.")).toBe(true);
    expect(isSolGoalChangeClockOnlyFragment("10:30")).toBe(true);
    expect(isSolGoalChangeClockOnlyFragment("Something easier.")).toBe(false);
  });

  it("substitutes a clock fragment into a one-clock canonical sentence", () => {
    expect(trySubstituteClockFragmentIntoCanonical(CANONICAL, "10:30.")).toBe(NORMALIZED);
  });

  it("normalizes leftover hallway inbound 10:30. against canonical", () => {
    expect(
      resolveReplaceHallwayClockCandidate({
        canonicalBehaviorStatement: CANONICAL,
        extracted: null,
        inboundRaw: "10:30.",
      })
    ).toEqual({ status: "normalized", candidate: NORMALIZED });
  });

  it("fails closed when the canonical has no clock to substitute into", () => {
    expect(
      resolveReplaceHallwayClockCandidate({
        canonicalBehaviorStatement: "Walk 20 minutes after dinner",
        extracted: null,
        inboundRaw: "10:30.",
      })
    ).toEqual({ status: "unnormalizable" });
  });

  it("leaves non-clock inbound unchanged", () => {
    expect(
      resolveReplaceHallwayClockCandidate({
        canonicalBehaviorStatement: CANONICAL,
        extracted: null,
        inboundRaw: "Actually I had a great workout today.",
      })
    ).toEqual({ status: "unchanged" });
  });

  it("I/J: sentences containing a time are not whole-message clock fills", () => {
    for (const inbound of [
      "I think 10:30 would be better because mornings are hard",
      "Maybe change it to 10:15.",
      "Had a great workout at 10:30",
      "See you at 10:30 pm",
      "Yes, but make it 10:15.",
    ]) {
      expect(isSolGoalChangeClockOnlyFragment(inbound)).toBe(false);
      expect(
        resolveReplaceHallwayClockCandidate({
          canonicalBehaviorStatement: CANONICAL,
          extracted: null,
          inboundRaw: inbound,
        })
      ).toEqual({ status: "unchanged" });
    }
  });
});
