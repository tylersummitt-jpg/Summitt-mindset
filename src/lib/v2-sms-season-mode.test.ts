import { describe, expect, it } from "vitest";
import {
  deriveSeasonModeForSmsGoalChange,
  isSmsSeasonMode,
  resolveSeasonModeForGuidedCommitmentReplace,
  resolveSeasonModeForPendingReplace,
} from "@/lib/v2-sms-season-mode";

describe("deriveSeasonModeForSmsGoalChange", () => {
  it("always returns new_chapter for saved Current Goal replacement", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "raise my steps from 8000 to 10000",
      candidateBar: "Walk 10,000 steps daily",
      currentBehaviorStatement: "Walk 8,000 steps daily",
    });
    expect(r.mode).toBe("new_chapter");
    expect(r.reason).toBe("saved_goal_change_always_new_chapter");
  });

  it("returns new_chapter for different life areas", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "switch from walking to lifting",
      candidateBar: "Lift weights 3x/week",
      currentBehaviorStatement: "Walk daily",
    });
    expect(r.mode).toBe("new_chapter");
  });

  it("returns new_chapter even for duration tweaks (former same_season_sync)", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "make it 20 minutes instead of 10",
      candidateBar: "Walk 20 minutes after dinner",
      currentBehaviorStatement: "Walk 10 minutes after dinner",
    });
    expect(r.mode).toBe("new_chapter");
  });
});

describe("resolveSeasonModeForPendingReplace", () => {
  it("ignores stored same_season_sync hint and returns new_chapter", () => {
    const r = resolveSeasonModeForPendingReplace({
      payload: {
        raw_user_text: "make it 20 minutes",
        season_mode: "same_season_sync",
        candidate_behavior_statement: "Walk 20 minutes after dinner",
      },
      candidateBar: "Walk 20 minutes after dinner",
      currentBehaviorStatement: "Walk 10 minutes after dinner",
    });
    expect(r.mode).toBe("new_chapter");
  });

  it("works when payload has no season_mode", () => {
    const r = resolveSeasonModeForPendingReplace({
      payload: {
        raw_user_text: "new goal walk more",
      },
      candidateBar: "Walk 30 minutes",
      currentBehaviorStatement: "Walk 10 minutes",
    });
    expect(r.mode).toBe("new_chapter");
  });
});

describe("resolveSeasonModeForGuidedCommitmentReplace", () => {
  it("always returns new_chapter", () => {
    const r = resolveSeasonModeForGuidedCommitmentReplace({
      behaviorStatement: "Read 10 pages daily",
      currentBehaviorStatement: "Walk 10 minutes",
      pendingPayload: null,
      refreshResolution: "change",
    });
    expect(r.mode).toBe("new_chapter");
  });
});

describe("isSmsSeasonMode", () => {
  it("still accepts legacy same_season_sync for payload parse compat", () => {
    expect(isSmsSeasonMode("same_season_sync")).toBe(true);
    expect(isSmsSeasonMode("new_chapter")).toBe(true);
    expect(isSmsSeasonMode("other")).toBe(false);
  });
});
