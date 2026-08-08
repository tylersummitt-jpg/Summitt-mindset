import "server-only";

import { clearStaleAdaptiveContractColumns } from "@/lib/v2-adaptive-contract";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { insertSmsCommitmentChangeProofEvent } from "@/lib/v2-proof-moment";
import { isUnsafeSmsGoalCandidateText } from "@/lib/sms-inbound-safety";
import { supabaseServer } from "@/lib/supabase-server";
import {
  mapSmsGoalSeasonMutationRpcRow,
  type SmsGoalSeasonMutationResult,
} from "@/lib/v2-sms-goal-season-mutation";
import type { SmsSeasonMode } from "@/lib/v2-sms-season-mode";
import { invalidateVictorySnapshotsAfterCanonicalGoalChange } from "@/lib/v2-victory-snapshot-invalidation";

export type ApplyCanonicalGoalChangeArgs = {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  behaviorStatement: string;
  seasonMode: SmsSeasonMode;
  /** Passed to RPC as p_idempotency_key (RPC prefixes sms_goal_season_bundle:). */
  idempotencyKey: string;
  /** Used for commitment_replaced proof row idempotency (v2_sms_commitment_change_proof:...). */
  proofMessageSid: string;
  memoryReasonCode: string;
  memoryReasonCodeIdempotentReplay?: string;
};

export type ApplyCanonicalGoalChangeResult =
  | SmsGoalSeasonMutationResult
  | { ok: false; code: string };

/**
 * Canonical season-aware goal change — shared by SMS confirmation, app goal-change, and guided resolution.
 * Product law: saved Current Goal change always uses new_chapter (RPC also auto-upgrades legacy same_season_sync).
 */
export async function applyCanonicalGoalChangeWithSeasonMutation(
  args: ApplyCanonicalGoalChangeArgs
): Promise<ApplyCanonicalGoalChangeResult> {
  if (isUnsafeSmsGoalCandidateText(args.behaviorStatement)) {
    return { ok: false, code: "unsafe_goal_content" };
  }

  // Callers may still pass legacy same_season_sync; mutation authority is always new_chapter.
  const seasonMode: SmsSeasonMode = "new_chapter";

  const { data, error } = await supabaseServer.rpc("v2_apply_sms_goal_change_with_season_mutation", {
    p_old_commitment_id: args.commitment.id,
    p_clerk_user_id: args.clerkUserId,
    p_new_behavior_statement: args.behaviorStatement,
    p_season_mode: seasonMode,
    p_expected_old_updated_at: args.commitment.updated_at,
    p_idempotency_key: args.idempotencyKey,
    p_now: new Date().toISOString(),
  });
  if (error) return { ok: false, code: `rpc_error:${error.message}` };

  const row = Array.isArray(data) ? data[0] : null;
  const mapped = mapSmsGoalSeasonMutationRpcRow(row, seasonMode, args.commitment.id);
  if (!mapped.ok) return mapped;

  await clearStaleAdaptiveContractColumns(mapped.newCommitmentId);

  await recomputeV2CoachingMemory(mapped.newCommitmentId, {
    reasonCode: mapped.idempotentReplay
      ? (args.memoryReasonCodeIdempotentReplay ?? `${args.memoryReasonCode}_raced_winner`)
      : args.memoryReasonCode,
  });

  if (
    mapped.seasonMode === "new_chapter" &&
    !mapped.idempotentReplay &&
    (mapped.rpcResult === "applied" || mapped.rpcResult === "already_applied")
  ) {
    await insertSmsCommitmentChangeProofEvent({
      commitmentId: mapped.newCommitmentId,
      clerkUserId: args.clerkUserId,
      messageSid: args.proofMessageSid,
      messagePreview: args.behaviorStatement,
      kind: "commitment_replaced",
    });
  }

  // Goal mutation already succeeded — never block on snapshot cleanup failure.
  // new_chapter: clears any rows on the new active id; old commitment history remains.
  try {
    const inv = await invalidateVictorySnapshotsAfterCanonicalGoalChange({
      clerkUserId: args.clerkUserId,
      oldCommitmentId: mapped.oldCommitmentId,
      newCommitmentId: mapped.newCommitmentId,
    });
    if (!inv.ok) {
      console.error("[v2-apply-canonical-goal-change] victory snapshot invalidation failed", {
        clerk_user_id: args.clerkUserId,
        old_commitment_id: mapped.oldCommitmentId,
        new_commitment_id: mapped.newCommitmentId,
        error: inv.error,
      });
    }
  } catch (e) {
    console.error("[v2-apply-canonical-goal-change] victory snapshot invalidation threw", {
      clerk_user_id: args.clerkUserId,
      old_commitment_id: mapped.oldCommitmentId,
      new_commitment_id: mapped.newCommitmentId,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return mapped;
}
