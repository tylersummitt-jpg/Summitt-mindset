import { describe, expect, it } from "vitest";
import {
  isValidRecommendedGoalOption,
  sanitizeGoalOptions,
} from "@/lib/onboarding-goal-quality";

describe("onboarding-goal-quality", () => {
  it("rejects identity-stuffing and weak filler", () => {
    expect(
      isValidRecommendedGoalOption({
        title: "One clear daily win",
        behaviorStatement:
          "Today I will take one concrete step that matches who I am becoming — i am a dad.",
      })
    ).toBe(false);
    expect(
      isValidRecommendedGoalOption({
        title: "Be better",
        behaviorStatement: "I will be better today.",
      })
    ).toBe(false);
  });

  it("accepts concrete daily I will behaviors", () => {
    expect(
      isValidRecommendedGoalOption({
        title: "Be present after work",
        behaviorStatement:
          "I will put my phone away for the first 30 minutes after I get home.",
      })
    ).toBe(true);
  });

  it("filters invalid options and keeps valid ones", () => {
    const out = sanitizeGoalOptions(
      [
        {
          title: "Bad",
          behaviorStatement: "Today I will matches who I am becoming.",
        },
        {
          title: "Show appreciation",
          behaviorStatement:
            "I will tell my wife one specific thing I appreciate about her today.",
        },
      ],
      "I am a steady husband and disciplined dad.",
      5
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Show appreciation");
  });
});
