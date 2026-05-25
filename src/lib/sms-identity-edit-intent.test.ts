import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import {
  detectSmsIdentityEditIntent,
  hasSafeBehaviorGoalCandidateForIdentityConfusion,
  isIdentityEditLaneActive,
  shouldSuppressCommitmentChangeHandoffForIdentity,
} from "@/lib/sms-identity-edit-intent";
import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

describe("detectSmsIdentityEditIntent — explicit / review", () => {
  it.each([
    ["My identity changed.", "explicit_identity_edit"],
    ["That identity doesn't fit me.", "identity_review_request"],
    ["Change my identity to someone who keeps promises.", "explicit_identity_edit"],
    ["Can we change who I'm becoming?", "identity_review_request"],
    ["Can we change my identity?", "identity_review_request"],
    ["I'm done with this identity.", "identity_rejection"],
    ["I don't care about that identity.", "identity_rejection"],
  ])("%j -> %s", (body, category) => {
    const d = detectSmsIdentityEditIntent(body);
    expect(d.detected).toBe(true);
    expect(d.category).toBe(category);
    expect(d.shouldRouteToIdentityLane).toBe(true);
    expect(d.noIdentityMutation).toBe(true);
    expect(d.shouldInviteVictoryRoomReview).toBe(
      category === "explicit_identity_edit" || category === "identity_review_request"
    );
  });
});

describe("detectSmsIdentityEditIntent — aspiration (no lane by default)", () => {
  it.each([
    "I want to be a better dad.",
    "I want to become a better leader.",
    "I'm trying to become consistent.",
    "I'm a coach and I want to lead better.",
  ])("%j does not route to identity lane", (body) => {
    const d = detectSmsIdentityEditIntent(body);
    expect(d.category).toBe("identity_aspiration");
    expect(d.shouldRouteToIdentityLane).toBe(false);
    expect(d.noIdentityMutation).toBe(true);
  });
});

describe("detectSmsIdentityEditIntent — goal/identity confusion", () => {
  it.each([
    "I want my goal to be being a better dad.",
    "My goal should be to become more disciplined.",
    "Change my goal to be a better leader.",
  ])("%j routes when no safe behavior candidate", (body) => {
    const d = detectSmsIdentityEditIntent(body);
    expect(d.category).toBe("goal_identity_confusion");
    expect(d.goalConfusionRisk).toBe(true);
    expect(d.shouldRouteToIdentityLane).toBe(true);
    expect(hasSafeBehaviorGoalCandidateForIdentityConfusion(body)).toBe(false);
  });

  it("behavior goal edit is not goal_identity_confusion (A3 handoff wins)", () => {
    const body = "Change my goal to walking after dinner";
    expect(hasSafeBehaviorGoalCandidateForIdentityConfusion(body)).toBe(true);
    const d = detectSmsIdentityEditIntent(body);
    expect(d.category).toBe("none");
    expect(d.shouldRouteToIdentityLane).toBe(false);
  });
});

describe("detectSmsIdentityEditIntent — discouragement", () => {
  it.each([
    "I failed today. I'm not who I said I was.",
    "I'm not a disciplined person anymore.",
    "That's not me.",
    "I'm not who I'm becoming.",
  ])("%j routes with discouragement risk", (body) => {
    const d = detectSmsIdentityEditIntent(body);
    expect(d.category).toBe("identity_discouragement");
    expect(d.discouragementRisk).toBe(true);
    expect(d.shouldRouteToIdentityLane).toBe(true);
    expect(d.noIdentityMutation).toBe(true);
  });
});

describe("detectSmsIdentityEditIntent — negatives", () => {
  it.each(["done", "yes", "I did it", "walking after dinner"])("%j -> none", (body) => {
    const d = detectSmsIdentityEditIntent(body);
    expect(d.detected).toBe(false);
    expect(d.category).toBe("none");
    expect(d.shouldRouteToIdentityLane).toBe(false);
  });

  it("behavior goal edit is not identity lane", () => {
    expect(detectSmsIdentityEditIntent("Change my goal to walking after dinner").shouldRouteToIdentityLane).toBe(
      false
    );
    expect(isLikelyCommitmentChangeIntentTurn("Change my goal to walking after dinner")).toBe(true);
  });

  it("explicit identity is not commitment-change handoff heuristic", () => {
    expect(isLikelyCommitmentChangeIntentTurn("Change my identity to someone who keeps promises")).toBe(
      false
    );
    expect(
      detectSmsIdentityEditIntent("Change my identity to someone who keeps promises").shouldRouteToIdentityLane
    ).toBe(true);
  });
});

describe("isIdentityEditLaneActive", () => {
  it("defers to relationship exit", () => {
    const det = detectSmsIdentityEditIntent("My identity changed.");
    expect(
      isIdentityEditLaneActive({ detection: det, relationshipExitLaneActive: true })
    ).toBe(false);
  });

  it("suppresses handoff when identity lane active", () => {
    const det = detectSmsIdentityEditIntent("My identity changed.");
    expect(
      shouldSuppressCommitmentChangeHandoffForIdentity({
        detection: det,
        identityLaneActive: isIdentityEditLaneActive({
          detection: det,
          relationshipExitLaneActive: false,
        }),
      })
    ).toBe(true);
  });
});
