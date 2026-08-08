import { describe, expect, it } from "vitest";
import {
  buildInboundSeasonTransitionFacts,
  mapSmsGoalSeasonMutationRpcRow,
  type SmsGoalSeasonMutationResult,
} from "@/lib/v2-sms-goal-season-mutation";

function successMutation(
  overrides: Partial<SmsGoalSeasonMutationResult> = {}
): SmsGoalSeasonMutationResult {
  return {
    ok: true,
    rpcResult: "applied",
    seasonMode: "new_chapter",
    commitmentReplaceApplied: true,
    oldCommitmentId: "cmt_old",
    newCommitmentId: "cmt_new",
    seasonTransitionApplied: true,
    seasonTransitionAction: "new_chapter",
    oldSeasonId: "season-uuid-old",
    newSeasonId: "season-uuid-new",
    oldSeasonName: "Morning Focus",
    newSeasonName: "Stronger Steps",
    sameSeasonGoalSnapshotSynced: false,
    idempotentReplay: false,
    warningCode: null,
    ...overrides,
  };
}

describe("mapSmsGoalSeasonMutationRpcRow", () => {
  it("normalizes legacy same_season_sync RPC rows to new_chapter truth", () => {
    const mapped = mapSmsGoalSeasonMutationRpcRow(
      {
        result: "applied",
        commitment_replace_applied: true,
        old_commitment_id: "cmt_1",
        new_commitment_id: "cmt_2",
        season_transition_applied: true,
        season_transition_action: "same_season_sync",
        old_season_id: null,
        new_season_id: "s2",
        old_season_name: null,
        new_season_name: "Season 2",
        same_season_goal_snapshot_synced: true,
        idempotent_replay: false,
        warning_code: null,
      },
      "same_season_sync",
      "cmt_1"
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.seasonMode).toBe("new_chapter");
      expect(mapped.seasonTransitionAction).toBe("new_chapter");
      expect(mapped.sameSeasonGoalSnapshotSynced).toBe(false);
    }
  });
});

describe("buildInboundSeasonTransitionFacts", () => {
  it("returns null when mutation failed or missing", () => {
    expect(buildInboundSeasonTransitionFacts(null)).toBeNull();
    expect(buildInboundSeasonTransitionFacts(undefined)).toBeNull();
  });

  it("never claims same-chapter bar raise after saved goal law", () => {
    const facts = buildInboundSeasonTransitionFacts(
      successMutation({
        seasonMode: "new_chapter",
        seasonTransitionAction: "new_chapter",
        sameSeasonGoalSnapshotSynced: false,
      })
    );
    expect(facts).toEqual({
      chapter_changed: true,
      user_facing_transition: "new_chapter",
      bar_raised_in_same_chapter: false,
      old_season_name: "Morning Focus",
      new_season_name: "Stronger Steps",
    });
    expect(JSON.stringify(facts)).not.toMatch(
      /same_season_sync|snapshot|sync|old_season_id|new_season_id|commitment_id/i
    );
  });

  it("uses none when no chapter change signaled", () => {
    const facts = buildInboundSeasonTransitionFacts(
      successMutation({
        seasonTransitionApplied: false,
        sameSeasonGoalSnapshotSynced: false,
      })
    );
    expect(facts?.user_facing_transition).toBe("none");
    expect(facts?.bar_raised_in_same_chapter).toBe(false);
  });
});
