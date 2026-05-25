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
 */
export async function applyCanonicalGoalChangeWithSeasonMutation(
  args: ApplyCanonicalGoalChangeArgs
): Promise<ApplyCanonicalGoalChangeResult> {
  if (isUnsafeSmsGoalCandidateText(args.behaviorStatement)) {
    return { ok: false, code: "unsafe_goal_content" };
  }

  const { data, error } = await supabaseServer.rpc("v2_apply_sms_goal_change_with_season_mutation", {
    p_old_commitment_id: args.commitment.id,
    p_clerk_user_id: args.clerkUserId,
    p_new_behavior_statement: args.behaviorStatement,
    p_season_mode: args.seasonMode,
    p_expected_old_updated_at: args.commitment.updated_at,
    p_idempotency_key: args.idempotencyKey,
    p_now: new Date().toISOString(),
  });
  if (error) return { ok: false, code: `rpc_error:${error.message}` };

  const row = Array.isArray(data) ? data[0] : null;
  const mapped = mapSmsGoalSeasonMutationRpcRow(row, args.seasonMode, args.commitment.id);
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

  return mapped;
}
