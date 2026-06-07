/**
 * Phase 2.1c — pending resolution no-send truth policy (lane / FVG / unified final guard).
 * Uses existing sms_memory_signal event_type for durable audit when state must be recorded.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundV3SeasonTransitionFacts } from "@/lib/v2-sms-goal-season-mutation";

export type PendingResolutionNoSendPolicyBranch =
  | "mutation_applied"
  | "pending_cleared_no_mutation"
  | "pending_active_clarify"
  | "pending_active_no_mutation";

export type PendingResolutionNoSendStage = "lane" | "final_voice_gate" | "unified_final_guard";

export type PendingResolutionNoSendTruthPolicyContext = {
  policyBranch: PendingResolutionNoSendPolicyBranch;
  pendingResolutionKind: "commitment_replace" | "commitment_tighten";
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  pendingResolutionApplied: boolean;
  stateMutationCompletedBeforeSms: boolean;
  pendingClearedBeforeSms: boolean;
  pendingStillActiveAfterPhase1: boolean;
  pendingProgressed?: boolean;
  stateTransitionSummary?: string | null;
  seasonTransitionFacts?: InboundV3SeasonTransitionFacts | null;
};

export type PersistPendingResolutionTruthOnNoSendArgs = PendingResolutionNoSendTruthPolicyContext & {
  noSendStage: PendingResolutionNoSendStage;
  noSendReason: string;
  stageMetadata?: Record<string, unknown>;
};

export type PendingResolutionNoSendTruthTelemetry = {
  pending_resolution_no_send_truth_policy: true;
  pending_no_send_policy_branch: PendingResolutionNoSendPolicyBranch;
  pending_resolution_kind: "commitment_replace" | "commitment_tighten";
  pending_resolution_applied: boolean;
  state_mutation_completed_before_sms: boolean;
  pending_cleared_before_sms: boolean;
  pending_still_active_after_no_send: boolean;
  pending_resolution_progressed?: boolean;
  pending_resolution_visible_sent: false;
  visible_sent: false;
  no_send_stage: PendingResolutionNoSendStage;
  no_send_reason: string;
  pending_resolution_truth_persisted: boolean;
  pending_resolution_truth_duplicate?: boolean;
  lane_no_send_reason?: string;
  final_voice_gate_skip_reason?: string;
  unified_final_guard_no_send_reason?: string;
  state_transition_summary?: string | null;
  pending_truth_recheck_failed?: boolean;
  season_transition_truth_recheck_failed?: boolean;
  required_verbatim_missing?: string[];
  clear_pending_only?: boolean;
};

function pendingNoSendStageReasonField(
  stage: PendingResolutionNoSendStage,
  reason: string
): Pick<
  PendingResolutionNoSendTruthTelemetry,
  "lane_no_send_reason" | "final_voice_gate_skip_reason" | "unified_final_guard_no_send_reason"
> {
  if (stage === "lane") return { lane_no_send_reason: reason };
  if (stage === "final_voice_gate") return { final_voice_gate_skip_reason: reason };
  return { unified_final_guard_no_send_reason: reason };
}

async function insertPendingResolutionNoSendTruthEvent(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  resolutionTelemetry: Record<string, unknown>;
}): Promise<{ inserted: boolean; duplicate: boolean }> {
  try {
    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_v2_pending_resolution_no_send",
      payload_json: {
        pending_resolution_no_send_truth: true,
        inbound_resolution_message_sid: args.inboundMessageSid,
        ...args.resolutionTelemetry,
      },
      idempotency_key: `v2_sms_pending_resolution_no_send:${args.inboundMessageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return { inserted: false, duplicate: true };
      console.warn("[sms-pending-resolution] no_send_truth insert skipped", {
        message: error.message,
        code,
      });
      return { inserted: false, duplicate: false };
    }
    return { inserted: true, duplicate: false };
  } catch (e) {
    console.warn("[sms-pending-resolution] no_send_truth insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { inserted: false, duplicate: false };
  }
}

/**
 * Branch-specific truth/state policy when pending resolution visible SMS no-sends.
 */
export async function persistPendingResolutionTruthOnNoSend(
  args: PersistPendingResolutionTruthOnNoSendArgs
): Promise<PendingResolutionNoSendTruthTelemetry> {
  const stageReason = pendingNoSendStageReasonField(args.noSendStage, args.noSendReason);
  const stateMutationCompleted =
    args.policyBranch === "mutation_applied" ? true : args.stateMutationCompletedBeforeSms;

  const baseTelemetry: PendingResolutionNoSendTruthTelemetry = {
    pending_resolution_no_send_truth_policy: true,
    pending_no_send_policy_branch: args.policyBranch,
    pending_resolution_kind: args.pendingResolutionKind,
    pending_resolution_applied: args.pendingResolutionApplied,
    state_mutation_completed_before_sms: stateMutationCompleted,
    pending_cleared_before_sms: args.pendingClearedBeforeSms,
    pending_still_active_after_no_send: args.pendingStillActiveAfterPhase1,
    ...(args.pendingProgressed !== undefined
      ? { pending_resolution_progressed: args.pendingProgressed }
      : {}),
    pending_resolution_visible_sent: false,
    visible_sent: false,
    no_send_stage: args.noSendStage,
    no_send_reason: args.noSendReason,
    ...stageReason,
    ...(args.stageMetadata ?? {}),
    state_transition_summary: args.stateTransitionSummary ?? null,
    pending_resolution_truth_persisted: false,
  };

  if (
    args.policyBranch === "pending_active_clarify" ||
    args.policyBranch === "pending_active_no_mutation"
  ) {
    return baseTelemetry;
  }

  const resolutionPayload: PendingResolutionNoSendTruthTelemetry = {
    ...baseTelemetry,
    pending_resolution_truth_persisted: true,
    ...(args.policyBranch === "pending_cleared_no_mutation" ? { clear_pending_only: true } : {}),
  };

  const insertResult = await insertPendingResolutionNoSendTruthEvent({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    resolutionTelemetry: resolutionPayload,
  });

  return {
    ...resolutionPayload,
    pending_resolution_truth_duplicate: insertResult.duplicate,
  };
}
