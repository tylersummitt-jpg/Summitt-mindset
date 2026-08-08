import { describe, expect, it } from "vitest";
import {
  USER_FACING_GOAL_UNAVAILABLE,
  formatUserFacingGoal,
} from "@/lib/v2-user-facing-goal";

describe("formatUserFacingGoal", () => {
  it("returns behavior_statement and never title", () => {
    expect(
      formatUserFacingGoal({
        behaviorStatement: "Lift weights for 30 minutes a day",
      })
    ).toBe("Lift weights for 30 minutes a day");
  });

  it("does not fall back to title when behavior missing", () => {
    expect(formatUserFacingGoal({ behaviorStatement: null })).toBe(
      USER_FACING_GOAL_UNAVAILABLE
    );
    expect(formatUserFacingGoal({ behaviorStatement: "   " })).toBe(
      USER_FACING_GOAL_UNAVAILABLE
    );
  });
});
