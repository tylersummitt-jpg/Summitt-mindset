/**
 * Phase 2.1e — commitment change handoff no-send truth policy (lane / NS / FVG / unified guard).
 * Uses existing sms_memory_signal event_type for durable audit when Wave4 pending was created before SMS.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundV3CommitmentChangeFacts } from "@/lib/v3-inbound-relationship-lane";

export type CommitmentHandoffNoSendPolicyBranch =
  | "handoff_pending_created"
  | "handoff_no_mutation"
  | "handoff_failed_before_mutation"
  | "handoff_clarify_pending"
  | "handoff_noop";

export type CommitmentHandoffNoSendStage =
  | "lane"
  | "north_star"
  | "final_voice_gate"
  | "unified_final_guard"
  | "post_unified_truth_recheck";

export type CommitmentHandoffNoSendTruthPolicyContext = {
  policyBranch: CommitmentHandoffNoSendPolicyBranch;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  pendingResolutionCreated: boolean;
  pendingResolutionKind: "commitment_replace" | "commitment_tighten" | null;
  bootstrapPromoted: boolean;
  stateMutationCompletedBeforeSms: boolean;
  stateTransitionSummary: string | null;
};

export type PersistCommitmentHandoffTruthOnNoSendArgs = CommitmentHandoffNoSendTruthPolicyContext & {
  noSendStage: CommitmentHandoffNoSendStage;
  noSendReason: string;
  pendingResolutionId?: string | null;
  pendingSourceMessageSid?: string | null;
  sideEffectsRecordedBeforeSms?: boolean;
  memoryMergedIntoPendingBeforeSms?: boolean;
  sendTimeEngagementRecordedBeforeSms?: boolean;
  requiredVerbatimMissing?: string[] | null;
  handoffTruthViolation?: string | null;
  stageMetadata?: Record<string, unknown>;
};

export type CommitmentHandoffNoSendTruthTelemetry = {
  commitment_handoff_no_send_truth_policy: true;
  handoff_no_send_policy_branch: CommitmentHandoffNoSendPolicyBranch;
  handoff_pending_created: boolean;
  pending_resolution_kind: "commitment_replace" | "commitment_tighten" | null;
  state_mutation_completed_before_sms: boolean;
  bootstrap_promoted?: boolean;
  commitment_handoff_visible_sent: false;
  visible_sent: false;
  no_send_stage: CommitmentHandoffNoSendStage;
  no_send_reason: string;
  commitment_handoff_truth_persisted: boolean;
  commitment_handoff_no_send_duplicate?: boolean;
  pending_resolution_id?: string | null;
  pending_source_message_sid?: string | null;
  side_effects_recorded_before_sms?: boolean;
  memory_merged_into_pending_before_sms?: boolean;
  send_time_engagement_recorded_before_sms?: boolean;
  lane_no_send_reason?: string;
  north_star_no_send_reason?: string;
  final_voice_gate_skip_reason?: string;
  unified_final_guard_no_send_reason?: string;
  post_unified_truth_recheck_reason?: string;
  state_transition_summary?: string | null;
  required_verbatim_missing?: string[];
  handoff_truth_violation?: string | null;
};

export function deriveCommitmentHandoffNoSendPolicyBranch(args: {
  pendingResolutionCreated: boolean;
  existingPendingResolution: boolean;
  pendingResolutionApplyException: string | null;
}): CommitmentHandoffNoSendPolicyBranch {
  if (args.pendingResolutionCreated) return "handoff_pending_created";
  if (args.pendingResolutionApplyException?.trim()) return "handoff_failed_before_mutation";
  if (args.existingPendingResolution) return "handoff_clarify_pending";
  return "handoff_no_mutation";
}

export function buildCommitmentHandoffNoSendTruthPolicyContext(args: {
  commitmentChangeFacts: InboundV3CommitmentChangeFacts;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
}): CommitmentHandoffNoSendTruthPolicyContext {
  const bootstrapPromoted = args.commitmentChangeFacts.server_state_transition_summary.includes(
    "bootstrap:awaiting_confirmation"
  );
  const policyBranch = deriveCommitmentHandoffNoSendPolicyBranch({
    pendingResolutionCreated: args.commitmentChangeFacts.pending_resolution_created,
    existingPendingResolution: args.commitmentChangeFacts.existing_pending_resolution,
    pendingResolutionApplyException: args.commitmentChangeFacts.pending_resolution_apply_exception,
  });

  return {
    policyBranch,
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    pendingResolutionCreated: args.commitmentChangeFacts.pending_resolution_created,
    pendingResolutionKind: args.commitmentChangeFacts.pending_resolution_type,
    bootstrapPromoted,
    stateMutationCompletedBeforeSms: args.commitmentChangeFacts.pending_resolution_created,
    stateTransitionSummary: args.commitmentChangeFacts.server_state_transition_summary ?? null,
  };
}

function handoffNoSendStageReasonField(
  stage: CommitmentHandoffNoSendStage,
  reason: string
): Partial<CommitmentHandoffNoSendTruthTelemetry> {
  if (stage === "lane") return { lane_no_send_reason: reason };
  if (stage === "north_star") return { north_star_no_send_reason: reason };
  if (stage === "final_voice_gate") return { final_voice_gate_skip_reason: reason };
  if (stage === "post_unified_truth_recheck") return { post_unified_truth_recheck_reason: reason };
  return { unified_final_guard_no_send_reason: reason };
}

async function insertCommitmentHandoffNoSendTruthEvent(args: {
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
      source: "sms_v2_commitment_handoff_no_send",
      payload_json: {
        commitment_handoff_no_send_truth: true,
        inbound_resolution_message_sid: args.inboundMessageSid,
        ...args.resolutionTelemetry,
      },
      idempotency_key: `v2_sms_commitment_handoff_no_send:${args.inboundMessageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return { inserted: false, duplicate: true };
      console.warn("[sms-commitment-handoff] no_send_truth insert skipped", {
        message: error.message,
        code,
      });
      return { inserted: false, duplicate: false };
    }
    return { inserted: true, duplicate: false };
  } catch (e) {
    console.warn("[sms-commitment-handoff] no_send_truth insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { inserted: false, duplicate: false };
  }
}

/**
 * Branch-specific truth/state policy when commitment handoff visible SMS no-sends.
 */
export async function persistCommitmentHandoffTruthOnNoSend(
  args: PersistCommitmentHandoffTruthOnNoSendArgs
): Promise<CommitmentHandoffNoSendTruthTelemetry> {
  const stageReason = handoffNoSendStageReasonField(args.noSendStage, args.noSendReason);
  const stateMutationCompleted =
    args.policyBranch === "handoff_pending_created"
      ? true
      : args.stateMutationCompletedBeforeSms;

  const baseTelemetry: CommitmentHandoffNoSendTruthTelemetry = {
    commitment_handoff_no_send_truth_policy: true,
    handoff_no_send_policy_branch: args.policyBranch,
    handoff_pending_created: args.pendingResolutionCreated,
    pending_resolution_kind: args.pendingResolutionKind,
    state_mutation_completed_before_sms: stateMutationCompleted,
    commitment_handoff_visible_sent: false,
    visible_sent: false,
    no_send_stage: args.noSendStage,
    no_send_reason: args.noSendReason,
    ...stageReason,
    ...(args.stageMetadata ?? {}),
    state_transition_summary: args.stateTransitionSummary ?? null,
    ...(args.pendingResolutionId != null ? { pending_resolution_id: args.pendingResolutionId } : {}),
    ...(args.pendingSourceMessageSid != null
      ? { pending_source_message_sid: args.pendingSourceMessageSid }
      : {}),
    ...(args.sideEffectsRecordedBeforeSms
      ? { side_effects_recorded_before_sms: true }
      : {}),
    ...(args.memoryMergedIntoPendingBeforeSms
      ? { memory_merged_into_pending_before_sms: true }
      : {}),
    ...(args.sendTimeEngagementRecordedBeforeSms
      ? { send_time_engagement_recorded_before_sms: true }
      : {}),
    ...(args.requiredVerbatimMissing?.length
      ? { required_verbatim_missing: args.requiredVerbatimMissing }
      : {}),
    ...(args.handoffTruthViolation ? { handoff_truth_violation: args.handoffTruthViolation } : {}),
    commitment_handoff_truth_persisted: false,
  };

  if (
    args.policyBranch === "handoff_no_mutation" ||
    args.policyBranch === "handoff_failed_before_mutation" ||
    args.policyBranch === "handoff_clarify_pending" ||
    args.policyBranch === "handoff_noop"
  ) {
    return baseTelemetry;
  }

  const resolutionPayload: CommitmentHandoffNoSendTruthTelemetry = {
    ...baseTelemetry,
    commitment_handoff_truth_persisted: true,
    handoff_pending_created: true,
    ...(args.bootstrapPromoted ? { bootstrap_promoted: true } : {}),
  };

  const insertResult = await insertCommitmentHandoffNoSendTruthEvent({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    resolutionTelemetry: resolutionPayload,
  });

  return {
    ...resolutionPayload,
    commitment_handoff_no_send_duplicate: insertResult.duplicate,
  };
}
