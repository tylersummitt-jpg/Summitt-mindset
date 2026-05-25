import { describe, expect, it } from "vitest";
import {
  applyGoalPersonalization,
  formatGoalPersonalizationForPrompt,
  resolveGoalRelationshipTerms,
} from "@/lib/onboarding-goal-personalization";
import { buildRecommendedGoalsForArea } from "@/lib/onboarding-goal-templates";

describe("onboarding-goal-personalization", () => {
  it("uses my wife for husband identity", () => {
    const terms = resolveGoalRelationshipTerms({ ingredientIds: ["husband"] });
    expect(terms.partnerObject).toBe("my wife");
    expect(terms.partnerPronounObject).toBe("her");
  });

  it("uses my husband for wife identity", () => {
    const terms = resolveGoalRelationshipTerms({ ingredientIds: ["wife"] });
    expect(terms.partnerObject).toBe("my husband");
    expect(terms.partnerPronounObject).toBe("him");
  });

  it("uses my spouse for spouse identity", () => {
    const terms = resolveGoalRelationshipTerms({ ingredientIds: ["spouse"] });
    expect(terms.partnerObject).toBe("my spouse");
  });

  it("uses my partner for partner identity", () => {
    const terms = resolveGoalRelationshipTerms({ ingredientIds: ["partner"] });
    expect(terms.partnerObject).toBe("my partner");
  });

  it("uses one of my kids when parent has multiple children", () => {
    const terms = resolveGoalRelationshipTerms({
      ingredientIds: ["dad"],
      importantPeople: [
        { relationship_type: "child" },
        { relationship_type: "child" },
      ],
    });
    expect(terms.childObject).toBe("one of my kids");
    expect(terms.childrenCollective).toBe("my kids");
  });

  it("uses my child when parent has one child", () => {
    const terms = resolveGoalRelationshipTerms({
      ingredientIds: ["parent"],
      importantPeople: [{ relationship_type: "child" }],
    });
    expect(terms.childObject).toBe("my child");
    expect(terms.childrenCollective).toBe("my child");
  });

  it("uses grandchild terms for grandparent identity", () => {
    const terms = resolveGoalRelationshipTerms({
      ingredientIds: ["grandfather"],
      importantPeople: [{ relationship_type: "grandchild" }],
    });
    expect(terms.grandchildObject).toBe("my grandchild");
    expect(terms.grandchildrenCollective).toBe("my grandchild");
  });

  it("uses leadership terms for coach and leader chips", () => {
    expect(
      resolveGoalRelationshipTerms({ ingredientIds: ["coach"] }).leadGroupObject
    ).toBe("my players");
    expect(
      resolveGoalRelationshipTerms({ ingredientIds: ["teacher_mentor"] })
        .leadGroupObject
    ).toBe("my students");
    expect(
      resolveGoalRelationshipTerms({ ingredientIds: ["leader"] }).leadGroupObject
    ).toBe("the people I lead");
  });

  it("does not include private names in prompt formatting", () => {
    const terms = resolveGoalRelationshipTerms({
      ingredientIds: ["husband", "dad"],
      importantPeople: [
        { relationship_type: "spouse_partner" },
        { relationship_type: "child" },
      ],
    });
    const prompt = formatGoalPersonalizationForPrompt(terms);
    expect(prompt).toContain("my wife");
    expect(prompt).not.toContain("Sam");
    expect(prompt).not.toContain("display_name");
  });

  it("personalizes relationship recommendations for husband + kids", () => {
    const goals = buildRecommendedGoalsForArea("relationship", {
      ingredientIds: ["husband", "dad"],
      importantPeople: [
        { relationship_type: "child" },
        { relationship_type: "child" },
      ],
      identityAnchor: "I am a disciplined dad and steady husband.",
    });
    const appreciation = goals.find((g) => g.title === "Show appreciation");
    expect(appreciation?.behaviorStatement).toContain("my wife");
    expect(appreciation?.behaviorStatement).not.toContain("spouse or partner");
  });

  it("personalizes parenting recommendations for dad with multiple kids", () => {
    const goals = buildRecommendedGoalsForArea("parenting", {
      ingredientIds: ["dad"],
      importantPeople: [
        { relationship_type: "child" },
        { relationship_type: "child" },
      ],
      identityAnchor: "I am a disciplined dad.",
    });
    const checkIn = goals.find((g) => g.title === "Evening check-in");
    expect(checkIn?.behaviorStatement).toContain("one of my kids");
    expect(checkIn?.behaviorStatement).not.toContain("one child");
  });

  it("personalizes leadership recommendations for leader identity", () => {
    const goals = buildRecommendedGoalsForArea("leadership", {
      ingredientIds: ["leader"],
      identityAnchor: "I am a consistent leader.",
    });
    const blocker = goals.find((g) => g.title === "Remove a blocker");
    expect(blocker?.behaviorStatement).toContain("someone I lead");
    expect(blocker?.behaviorStatement).not.toContain("someone on my team");
  });

  it("keeps personalized behaviors starting with I will", () => {
    const goals = buildRecommendedGoalsForArea("relationship", {
      ingredientIds: ["wife"],
      identityAnchor: "I am a steady wife.",
    });
    for (const goal of goals) {
      expect(goal.behaviorStatement).toMatch(/^I will/i);
    }
  });

  it("applies placeholder substitution", () => {
    const terms = resolveGoalRelationshipTerms({ ingredientIds: ["wife"] });
    expect(
      applyGoalPersonalization(
        "I will tell {partnerObject} one specific thing I appreciate about {partnerPronounObject} today.",
        terms
      )
    ).toBe(
      "I will tell my husband one specific thing I appreciate about him today."
    );
  });
});
