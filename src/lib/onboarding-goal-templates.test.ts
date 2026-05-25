import { describe, expect, it } from "vitest";
import {
  buildRecommendedGoalsForArea,
  getVisibleFocusAreas,
  inferFocusAreasFromIdentity,
} from "@/lib/onboarding-goal-templates";

const IDENTITY_DAD =
  "I am a disciplined dad, steady husband, and consistent business leader.";
const IDENTITY_SPOUSE = "I am a steady husband who keeps his word and follows through.";
const IDENTITY_BUSINESS =
  "I am an entrepreneur and leader who completes my top priority before checking messages.";
const IDENTITY_DISCIPLINE = "I am choosing discipline, consistency, and focused follow-through.";

function assertGoalList(
  areaId: Parameters<typeof buildRecommendedGoalsForArea>[0],
  context: Parameters<typeof buildRecommendedGoalsForArea>[1] = {}
) {
  const goals = buildRecommendedGoalsForArea(areaId, context);
  expect(goals.length).toBe(5);
  for (const goal of goals) {
    expect(goal.title.length).toBeGreaterThan(0);
    expect(goal.behaviorStatement).toMatch(/^I will/i);
    expect(goal.behaviorStatement).not.toMatch(/\s i \s/i);
    expect(goal.behaviorStatement.toLowerCase()).not.toContain("matches who i am becoming");
    expect(goal.behaviorStatement.toLowerCase()).not.toContain("life_desires");
    expect(goal.behaviorStatement.toLowerCase()).not.toContain("my why");
  }
  return goals;
}

describe("onboarding-goal-templates", () => {
  it("infers 4-8 relevant focus areas and includes Something else", () => {
    const areas = getVisibleFocusAreas(IDENTITY_DAD, false);
    expect(areas.length).toBeGreaterThanOrEqual(4);
    expect(areas.length).toBeLessThanOrEqual(8);
    expect(areas.some((a) => a.label === "Something else")).toBe(true);
  });

  it("show more expands the focus area list", () => {
    const collapsed = getVisibleFocusAreas(IDENTITY_DAD, false);
    const expanded = getVisibleFocusAreas(IDENTITY_DAD, true);
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });

  it("family and parenting recommendations are concrete and daily", () => {
    const goals = assertGoalList("parenting", {
      identityAnchor: IDENTITY_DAD,
      ingredientIds: ["dad"],
    });
    expect(goals.some((g) => g.title === "Be present after work")).toBe(true);
  });

  it("marriage and relationship recommendations are concrete and daily", () => {
    const goals = assertGoalList("relationship", {
      identityAnchor: IDENTITY_SPOUSE,
      ingredientIds: ["husband"],
    });
    expect(goals.some((g) => g.behaviorStatement.includes("my wife"))).toBe(true);
  });

  it("discipline recommendations are concrete and daily", () => {
    assertGoalList("discipline", { identityAnchor: IDENTITY_DISCIPLINE });
  });

  it("business identity produces concrete daily business behaviors", () => {
    const goals = assertGoalList("business", {
      identityAnchor: IDENTITY_BUSINESS,
      ingredientIds: ["entrepreneur"],
    });
    expect(goals.some((g) => g.behaviorStatement.toLowerCase().includes("business"))).toBe(true);
  });

  it("does not blend full identity into behavior statements", () => {
    const goals = buildRecommendedGoalsForArea("parenting", {
      identityAnchor: IDENTITY_DAD,
      ingredientIds: ["dad"],
    });
    for (const goal of goals) {
      expect(goal.behaviorStatement).not.toContain(IDENTITY_DAD);
    }
  });

  it("ranks parenting and business areas for mixed identity", () => {
    const ranked = inferFocusAreasFromIdentity(IDENTITY_DAD.toLowerCase());
    expect(ranked).toContain("parenting");
    expect(ranked.length).toBeGreaterThanOrEqual(4);
  });
});
