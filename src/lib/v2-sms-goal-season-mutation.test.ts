import { describe, expect, it } from "vitest";
import {
  buildInboundSeasonTransitionFacts,
  type SmsGoalSeasonMutationResult,
} from "@/lib/v2-sms-goal-season-mutation";

function successMutation(
  overrides: Partial<SmsGoalSeasonMutationResult> = {}
): SmsGoalSeasonMutationResult {
  return {
    ok: true,
    rpcResult: "applied",
    seasonMode: "same_season_sync",
    commitmentReplaceApplied: false,
    oldCommitmentId: "cmt_old",
    newCommitmentId: "cmt_old",
    seasonTransitionApplied: true,
    seasonTransitionAction: "same_season_sync",
    oldSeasonId: "season-uuid-old",
    newSeasonId: "season-uuid-old",
    oldSeasonName: "Morning Focus",
    newSeasonName: "Morning Focus",
    sameSeasonGoalSnapshotSynced: true,
    idempotentReplay: false,
    warningCode: null,
    ...overrides,
  };
}

describe("buildInboundSeasonTransitionFacts", () => {
  it("returns null when mutation failed or missing", () => {
    expect(buildInboundSeasonTransitionFacts(null)).toBeNull();
    expect(buildInboundSeasonTransitionFacts(undefined)).toBeNull();
  });

  it("sanitizes same_chapter facts without internal labels or UUIDs", () => {
    const facts = buildInboundSeasonTransitionFacts(
      successMutation({
        seasonMode: "same_season_sync",
        seasonTransitionAction: "same_season_sync",
        sameSeasonGoalSnapshotSynced: true,
      })
    );
    expect(facts).toEqual({
      chapter_changed: false,
      user_facing_transition: "same_chapter",
      bar_raised_in_same_chapter: true,
      old_season_name: "Morning Focus",
      new_season_name: "Morning Focus",
    });
    expect(JSON.stringify(facts)).not.toMatch(
      /same_season_sync|snapshot|sync|season_mode|season_transition|uuid|season-uuid/i
    );
  });

  it("sanitizes new_chapter facts for natural chapter language without IDs", () => {
    const facts = buildInboundSeasonTransitionFacts(
      successMutation({
        seasonMode: "new_chapter",
        seasonTransitionAction: "new_chapter",
        commitmentReplaceApplied: true,
        newCommitmentId: "cmt_new",
        oldSeasonName: "Phone Discipline",
        newSeasonName: "Walking Every Morning",
        sameSeasonGoalSnapshotSynced: false,
      })
    );
    expect(facts).toEqual({
      chapter_changed: true,
      user_facing_transition: "new_chapter",
      bar_raised_in_same_chapter: false,
      old_season_name: "Phone Discipline",
      new_season_name: "Walking Every Morning",
    });
    expect(JSON.stringify(facts)).not.toMatch(
      /same_season_sync|snapshot|sync|old_season_id|new_season_id|commitment_id/i
    );
  });

  it("uses none when no chapter change and no same-chapter bar raise", () => {
    const facts = buildInboundSeasonTransitionFacts(
      successMutation({
        seasonTransitionApplied: false,
        sameSeasonGoalSnapshotSynced: false,
        seasonMode: "same_season_sync",
      })
    );
    expect(facts?.user_facing_transition).toBe("none");
    expect(facts?.bar_raised_in_same_chapter).toBe(false);
  });
});
