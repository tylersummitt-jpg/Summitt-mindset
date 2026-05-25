import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deriveSeasonModeForSmsGoalChange,
  isSmsSeasonMode,
  resolveSeasonModeForGuidedCommitmentReplace,
  resolveSeasonModeForPendingReplace,
} from "@/lib/v2-sms-season-mode";

describe("deriveSeasonModeForSmsGoalChange", () => {
  it("routes explicit new chapter language to new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "I want to start a new chapter with walking",
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
    expect(r.reason).toBe("explicit_chapter_language");
  });

  it("routes switch from X to Y to new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "switch from phone discipline to walking every morning",
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Put phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
    expect(r.reason).toBe("switch_from_to");
  });

  it("routes duration tweak to same_season_sync", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "same goal but harder — walk 30 minutes each morning",
      candidateBar: "Walk 30 minutes each morning",
      currentBehaviorStatement: "Walk 10 minutes each morning",
    });
    expect(r.mode).toBe("same_season_sync");
  });

  it("defaults ambiguous replace to same_season_sync", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "change my goal to read 10 pages",
      candidateBar: "Read 10 pages before bed",
      currentBehaviorStatement: "Read 5 pages before bed",
    });
    expect(r.mode).toBe("same_season_sync");
    expect(r.reason).toBe("default_same_drill");
  });

  it("start fresh alone is not new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "start fresh",
      candidateBar: "Walk 30 minutes each morning",
      currentBehaviorStatement: "Walk 10 minutes each morning",
    });
    expect(r.mode).toBe("same_season_sync");
  });

  it("fresh start alone is not new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "fresh start",
      candidateBar: "Read 10 pages before bed",
      currentBehaviorStatement: "Read 5 pages before bed",
    });
    expect(r.mode).toBe("same_season_sync");
  });

  it("start a new season remains new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "I want to start a new season with walking",
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
  });

  it("new season with bar remains new_chapter", () => {
    const r = deriveSeasonModeForSmsGoalChange({
      rawBody: "new season: walking every morning",
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
  });
});

describe("resolveSeasonModeForPendingReplace", () => {
  it("corrects stale frozen new_chapter to same_season_sync for same-drill tweak", () => {
    const r = resolveSeasonModeForPendingReplace({
      payload: {
        raw_user_text: "start fresh",
        season_mode: "new_chapter",
        candidate_behavior_statement: "start fresh",
        candidate_new_bar: "start fresh",
      },
      candidateBar: "Walk 30 minutes each morning",
      currentBehaviorStatement: "Walk 10 minutes each morning",
    });
    expect(r.mode).toBe("same_season_sync");
  });

  it("corrects stale frozen same_season_sync to new_chapter on domain switch", () => {
    const r = resolveSeasonModeForPendingReplace({
      payload: {
        raw_user_text: "change goal",
        season_mode: "same_season_sync",
        candidate_behavior_statement: "Put phone away at 10pm",
      },
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Put phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
  });

  it("works when payload has no season_mode", () => {
    const r = resolveSeasonModeForPendingReplace({
      payload: {
        raw_user_text: "switch from phone discipline to walking every morning",
        candidate_new_bar: "Walk every morning",
      },
      candidateBar: "Walk every morning",
      currentBehaviorStatement: "Put phone away at 10pm",
    });
    expect(r.mode).toBe("new_chapter");
  });
});

describe("isSmsSeasonMode", () => {
  it("accepts known modes", () => {
    expect(isSmsSeasonMode("same_season_sync")).toBe(true);
    expect(isSmsSeasonMode("new_chapter")).toBe(true);
    expect(isSmsSeasonMode("other")).toBe(false);
  });
});

describe("resolveSeasonModeForGuidedCommitmentReplace", () => {
  it("maps coaching refresh NEW to new_chapter", () => {
    const r = resolveSeasonModeForGuidedCommitmentReplace({
      behaviorStatement: "Walk every morning",
      currentBehaviorStatement: "Phone away at 10pm",
      pendingPayload: null,
      refreshResolution: "new",
    });
    expect(r.mode).toBe("new_chapter");
    expect(r.reason).toBe("coaching_refresh_new");
  });
});
