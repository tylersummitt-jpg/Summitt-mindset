import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

export type InvalidateVictoryCurrentGoalSnapshotsResult = {
  ok: boolean;
  patReadDeleted: number;
  principlesDeleted: number;
  seasonSummaryDeleted: number;
  error: string | null;
};

/**
 * Delete current-goal Victory Room snapshots for one commitment.
 * Historical snapshots on other commitments are left alone.
 * Does not call OpenAI — Victory Room page load regenerates when needed.
 */
export async function invalidateVictoryCurrentGoalSnapshots(args: {
  clerkUserId: string;
  commitmentId: string;
}): Promise<InvalidateVictoryCurrentGoalSnapshotsResult> {
  const clerkUserId = args.clerkUserId.trim();
  const commitmentId = args.commitmentId.trim();
  if (!clerkUserId || !commitmentId) {
    return {
      ok: false,
      patReadDeleted: 0,
      principlesDeleted: 0,
      seasonSummaryDeleted: 0,
      error: "missing_clerk_user_id_or_commitment_id",
    };
  }

  let patReadDeleted = 0;
  let principlesDeleted = 0;
  let seasonSummaryDeleted = 0;
  const errors: string[] = [];

  const { data: patRows, error: patErr } = await supabaseServer
    .from("v2_victory_pat_read_snapshot")
    .delete()
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .select("id");

  if (patErr) {
    errors.push(`pat_read:${patErr.message}`);
  } else {
    patReadDeleted = Array.isArray(patRows) ? patRows.length : 0;
  }

  const { data: principlesRows, error: principlesErr } = await supabaseServer
    .from("v2_victory_pat_principles_snapshot")
    .delete()
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .select("id");

  if (principlesErr) {
    errors.push(`principles:${principlesErr.message}`);
  } else {
    principlesDeleted = Array.isArray(principlesRows) ? principlesRows.length : 0;
  }

  // Season summary is keyed by season but stores commitment_id; clear rows for this
  // commitment so same-season goal swaps cannot keep old current-goal summary prose.
  const { data: seasonRows, error: seasonErr } = await supabaseServer
    .from("v2_victory_season_summary_snapshot")
    .delete()
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .select("id");

  if (seasonErr) {
    errors.push(`season_summary:${seasonErr.message}`);
  } else {
    seasonSummaryDeleted = Array.isArray(seasonRows) ? seasonRows.length : 0;
  }

  if (errors.length > 0) {
    console.error("[v2-victory-snapshot-invalidation] delete failed", {
      clerk_user_id: clerkUserId,
      commitment_id: commitmentId,
      errors,
      patReadDeleted,
      principlesDeleted,
      seasonSummaryDeleted,
    });
    return {
      ok: false,
      patReadDeleted,
      principlesDeleted,
      seasonSummaryDeleted,
      error: errors.join("; "),
    };
  }

  return {
    ok: true,
    patReadDeleted,
    principlesDeleted,
    seasonSummaryDeleted,
    error: null,
  };
}

/**
 * After a successful canonical goal change: invalidate snapshots for the commitment
 * that still holds current-goal UI/SMS surface.
 * - same_season_sync: old === new → invalidate that id
 * - new_chapter: invalidate new active id (usually empty); leave old commitment history alone
 */
export async function invalidateVictorySnapshotsAfterCanonicalGoalChange(args: {
  clerkUserId: string;
  oldCommitmentId: string;
  newCommitmentId: string;
}): Promise<InvalidateVictoryCurrentGoalSnapshotsResult> {
  const newId = args.newCommitmentId.trim();
  const oldId = args.oldCommitmentId.trim();
  const targetId = newId || oldId;
  return invalidateVictoryCurrentGoalSnapshots({
    clerkUserId: args.clerkUserId,
    commitmentId: targetId,
  });
}
