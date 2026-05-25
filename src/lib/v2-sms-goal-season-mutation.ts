import "server-only";

import type { SmsSeasonMode } from "@/lib/v2-sms-season-mode";

export type SmsGoalSeasonMutationRpcRow = {
  result: string;
  commitment_replace_applied: boolean;
  old_commitment_id: string | null;
  new_commitment_id: string | null;
  season_transition_applied: boolean;
  season_transition_action: string | null;
  old_season_id: string | null;
  new_season_id: string | null;
  old_season_name: string | null;
  new_season_name: string | null;
  same_season_goal_snapshot_synced: boolean;
  idempotent_replay: boolean;
  warning_code: string | null;
};

export type SmsGoalSeasonMutationResult = {
  ok: true;
  rpcResult: string;
  seasonMode: SmsSeasonMode;
  commitmentReplaceApplied: boolean;
  oldCommitmentId: string;
  newCommitmentId: string;
  seasonTransitionApplied: boolean;
  seasonTransitionAction: string | null;
  oldSeasonId: string | null;
  newSeasonId: string | null;
  oldSeasonName: string | null;
  newSeasonName: string | null;
  sameSeasonGoalSnapshotSynced: boolean;
  idempotentReplay: boolean;
  warningCode: string | null;
};

export function mapSmsGoalSeasonMutationRpcRow(
  row: SmsGoalSeasonMutationRpcRow | null | undefined,
  seasonMode: SmsSeasonMode,
  fallbackOldCommitmentId: string
): SmsGoalSeasonMutationResult | { ok: false; code: string } {
  if (!row?.result) return { ok: false, code: "error" };

  const result = row.result;
  if (result !== "applied" && result !== "already_applied") {
    return { ok: false, code: result };
  }

  const oldCommitmentId =
    typeof row.old_commitment_id === "string" && row.old_commitment_id.trim()
      ? row.old_commitment_id
      : fallbackOldCommitmentId;
  const newCommitmentId =
    typeof row.new_commitment_id === "string" && row.new_commitment_id.trim()
      ? row.new_commitment_id
      : oldCommitmentId;

  return {
    ok: true,
    rpcResult: result,
    seasonMode,
    commitmentReplaceApplied: Boolean(row.commitment_replace_applied),
    oldCommitmentId,
    newCommitmentId,
    seasonTransitionApplied: Boolean(row.season_transition_applied),
    seasonTransitionAction:
      typeof row.season_transition_action === "string" ? row.season_transition_action : null,
    oldSeasonId: typeof row.old_season_id === "string" ? row.old_season_id : null,
    newSeasonId: typeof row.new_season_id === "string" ? row.new_season_id : null,
    oldSeasonName: typeof row.old_season_name === "string" ? row.old_season_name : null,
    newSeasonName: typeof row.new_season_name === "string" ? row.new_season_name : null,
    sameSeasonGoalSnapshotSynced: Boolean(row.same_season_goal_snapshot_synced),
    idempotentReplay: result === "already_applied" || Boolean(row.idempotent_replay),
    warningCode: typeof row.warning_code === "string" ? row.warning_code : null,
  };
}

/** V3-facing season transition facts — human labels only; no internal enums, IDs, or sync jargon. */
export type InboundV3SeasonTransitionFacts = {
  /** True only when a story chapter closed and a new season row started. */
  chapter_changed: boolean;
  user_facing_transition: "same_chapter" | "new_chapter" | "none";
  bar_raised_in_same_chapter: boolean;
  old_season_name: string | null;
  new_season_name: string | null;
};

export function buildInboundSeasonTransitionFacts(
  mutation: SmsGoalSeasonMutationResult | null | undefined
): InboundV3SeasonTransitionFacts | null {
  if (!mutation?.ok) return null;
  const chapterChanged =
    mutation.seasonTransitionApplied &&
    (mutation.seasonMode === "new_chapter" || mutation.seasonTransitionAction === "new_chapter");
  const barRaisedInSameChapter = !chapterChanged && mutation.sameSeasonGoalSnapshotSynced;

  let userFacingTransition: InboundV3SeasonTransitionFacts["user_facing_transition"] = "none";
  if (chapterChanged) {
    userFacingTransition = "new_chapter";
  } else if (barRaisedInSameChapter) {
    userFacingTransition = "same_chapter";
  }

  return {
    chapter_changed: chapterChanged,
    user_facing_transition: userFacingTransition,
    bar_raised_in_same_chapter: barRaisedInSameChapter,
    old_season_name: mutation.oldSeasonName,
    new_season_name: mutation.newSeasonName,
  };
}
