/**
 * Phase 2.1f-B1/B2 — refresh identity + commitment no-send truth policy.
 */

import { supabaseServer } from "@/lib/supabase-server";

export type RefreshNoSendPolicyBranch =
  | "refresh_mutation_applied"
  | "refresh_pending_or_handoff_created"
  | "refresh_cleared_or_aborted"
  | "refresh_active_clarify"
  | "refresh_noop_already_applied"
  | "refresh_failed_before_mutation";

export type RefreshNoSendStage =
  | "lane"
  | "north_star"
  | "final_voice_gate"
  | "unified_final_guard"
  | "post_unified_truth_recheck";

export type RefreshIdentityLaneIntent =
  | "identity_still_commitment_prompt"
  | "identity_change_handoff"
  | "identity_clarify_prompt"
  | "identity_aborted_unclear"
  | "identity_already_applied"
  | "identity_inactive_step";

export type RefreshCommitmentLaneIntent =
  | "commitment_keep_ack"
  | "commitment_tighten_handoff"
  | "commitment_new_handoff"
  | "commitment_clarify_prompt"
  | "commitment_aborted_unclear"
  | "commitment_already_applied"
  | "commitment_inactive_step";

export type RefreshLaneIntent = RefreshIdentityLaneIntent | RefreshCommitmentLaneIntent;

type RefreshNoSendTruthPolicyContextBase = {
  branch: RefreshNoSendPolicyBranch;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  refreshSessionId?: string | null;
  stateMutationCompletedBeforeSms: boolean;
  pendingCreatedBeforeSms?: boolean;
  refreshClearedBeforeSms?: boolean;
  refreshClarificationConsumedBeforeSms?: boolean;
  stateTransitionSummary?: string | null;
  sideEffectsRecordedBeforeSms?: boolean;
};

export type RefreshIdentityNoSendTruthPolicyContext = RefreshNoSendTruthPolicyContextBase & {
  refreshFamily: "identity";
  refreshIntent: RefreshIdentityLaneIntent;
  refreshSessionAdvancedBeforeSms?: boolean;
  identityUpdatedBeforeSms?: boolean;
  commitmentPromptDeliveredBeforeSms?: boolean;
};

export type RefreshCommitmentNoSendTruthPolicyContext = RefreshNoSendTruthPolicyContextBase & {
  refreshFamily: "commitment";
  refreshIntent: RefreshCommitmentLaneIntent;
  commitmentUpdatedBeforeSms?: boolean;
  commitmentKeepRecordedBeforeSms?: boolean;
  pendingResolutionKind?: string | null;
};

export type RefreshNoSendTruthPolicyContext =
  | RefreshIdentityNoSendTruthPolicyContext
  | RefreshCommitmentNoSendTruthPolicyContext;

export type PersistRefreshTruthOnNoSendArgs = RefreshNoSendTruthPolicyContext & {
  noSendStage: RefreshNoSendStage;
  noSendReason: string;
  requiredVerbatimMissing?: string[] | null;
  refreshTruthViolation?: string | null;
  sendTimeEngagementRecordedBeforeSms?: boolean;
  stageMetadata?: Record<string, unknown>;
};

export type RefreshNoSendTruthTelemetry = {
  refresh_no_send_truth_policy: true;
  refresh_no_send_policy_branch: RefreshNoSendPolicyBranch;
  refresh_intent: string;
  refresh_family: "identity" | "commitment";
  state_mutation_completed_before_sms: boolean;
  refresh_session_advanced_before_sms?: boolean;
  identity_updated_before_sms?: boolean;
  commitment_updated_before_sms?: boolean;
  commitment_keep_recorded_before_sms?: boolean;
  pending_created_before_sms?: boolean;
  pending_resolution_kind?: string | null;
  refresh_cleared_before_sms?: boolean;
  commitment_prompt_delivered_before_sms?: boolean;
  refresh_clarification_consumed_before_sms?: boolean;
  refresh_visible_sent: false;
  visible_sent: false;
  no_send_stage: RefreshNoSendStage;
  no_send_reason: string;
  refresh_truth_persisted: boolean;
  refresh_no_send_duplicate?: boolean;
  refresh_session_id?: string | null;
  lane_no_send_reason?: string;
  north_star_no_send_reason?: string;
  final_voice_gate_skip_reason?: string;
  unified_final_guard_no_send_reason?: string;
  post_unified_truth_recheck_reason?: string;
  state_transition_summary?: string | null;
  required_verbatim_missing?: string[];
  refresh_truth_violation?: string | null;
  send_time_engagement_recorded_before_sms?: boolean;
  side_effects_recorded_before_sms?: boolean;
};

const IDENTITY_INTENT_BRANCH: Record<RefreshIdentityLaneIntent, RefreshNoSendPolicyBranch> = {
  identity_still_commitment_prompt: "refresh_mutation_applied",
  identity_change_handoff: "refresh_pending_or_handoff_created",
  identity_clarify_prompt: "refresh_active_clarify",
  identity_aborted_unclear: "refresh_cleared_or_aborted",
  identity_already_applied: "refresh_noop_already_applied",
  identity_inactive_step: "refresh_failed_before_mutation",
};

const COMMITMENT_INTENT_BRANCH: Record<RefreshCommitmentLaneIntent, RefreshNoSendPolicyBranch> = {
  commitment_keep_ack: "refresh_mutation_applied",
  commitment_tighten_handoff: "refresh_pending_or_handoff_created",
  commitment_new_handoff: "refresh_pending_or_handoff_created",
  commitment_clarify_prompt: "refresh_active_clarify",
  commitment_aborted_unclear: "refresh_cleared_or_aborted",
  commitment_already_applied: "refresh_noop_already_applied",
  commitment_inactive_step: "refresh_failed_before_mutation",
};

const DURABLE_AUDIT_BRANCHES = new Set<RefreshNoSendPolicyBranch>([
  "refresh_mutation_applied",
  "refresh_pending_or_handoff_created",
  "refresh_cleared_or_aborted",
]);

export function isRefreshIdentityLaneIntent(intent: string): intent is RefreshIdentityLaneIntent {
  return intent in IDENTITY_INTENT_BRANCH;
}

export function isRefreshCommitmentLaneIntent(intent: string): intent is RefreshCommitmentLaneIntent {
  return intent in COMMITMENT_INTENT_BRANCH;
}

export function deriveRefreshIdentityNoSendPolicyBranch(
  intent: RefreshIdentityLaneIntent
): RefreshNoSendPolicyBranch {
  return IDENTITY_INTENT_BRANCH[intent];
}

export function deriveRefreshCommitmentNoSendPolicyBranch(
  intent: RefreshCommitmentLaneIntent
): RefreshNoSendPolicyBranch {
  return COMMITMENT_INTENT_BRANCH[intent];
}

export function buildRefreshIdentityRequiredMeaningSummary(
  intent: RefreshIdentityLaneIntent
): string {
  switch (intent) {
    case "identity_still_commitment_prompt":
      return "Acknowledge identity still fits; transition to asking whether today's commitment bar still fits. Do not claim identity changed or that refresh is fully complete.";
    case "identity_change_handoff":
      return "Direct user to update identity in the app when ready; do not claim identity or goal already changed.";
    case "identity_clarify_prompt":
      return "Ask for clarification on whether identity line still fits or should change; do not claim identity confirmed or changed.";
    case "identity_aborted_unclear":
      return "Close alignment check without saving ambiguous context; do not claim identity confirmed or changed.";
    case "identity_already_applied":
      return "Reassure this thread was already handled; do not claim a fresh mutation from this reply.";
    case "identity_inactive_step":
      return "No active identity refresh step matched; do not claim mutation occurred.";
  }
}

export function buildRefreshCommitmentRequiredMeaningSummary(
  intent: RefreshCommitmentLaneIntent
): string {
  switch (intent) {
    case "commitment_keep_ack":
      return "Acknowledge the current commitment bar stays; normal checks resume. Do not claim commitment changed or that refresh is still waiting on commitment.";
    case "commitment_tighten_handoff":
      return "Direct user to tighten the bar in the app; do not claim commitment already tightened or goal already changed.";
    case "commitment_new_handoff":
      return "Direct user to update accountability focus in the app; do not claim new commitment already active.";
    case "commitment_clarify_prompt":
      return "Ask whether to keep, tighten, or replace the commitment; do not claim mutation applied or refresh complete.";
    case "commitment_aborted_unclear":
      return "Close commitment alignment without saving ambiguous change; do not claim commitment changed.";
    case "commitment_already_applied":
      return "Reassure this thread was already handled; do not claim a fresh mutation from this reply.";
    case "commitment_inactive_step":
      return "No active commitment refresh step matched; do not claim mutation occurred.";
  }
}

export function buildRefreshIdentityNoSendTruthPolicyContext(args: {
  refreshIntent: RefreshIdentityLaneIntent;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  refreshSessionId?: string | null;
  stateMutationCompletedBeforeSms: boolean;
  refreshSessionAdvancedBeforeSms?: boolean;
  identityUpdatedBeforeSms?: boolean;
  pendingCreatedBeforeSms?: boolean;
  refreshClearedBeforeSms?: boolean;
  commitmentPromptDeliveredBeforeSms?: boolean;
  refreshClarificationConsumedBeforeSms?: boolean;
  stateTransitionSummary?: string | null;
}): RefreshIdentityNoSendTruthPolicyContext {
  return {
    branch: deriveRefreshIdentityNoSendPolicyBranch(args.refreshIntent),
    refreshIntent: args.refreshIntent,
    refreshFamily: "identity",
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    refreshSessionId: args.refreshSessionId ?? null,
    stateMutationCompletedBeforeSms: args.stateMutationCompletedBeforeSms,
    refreshSessionAdvancedBeforeSms: args.refreshSessionAdvancedBeforeSms,
    identityUpdatedBeforeSms: args.identityUpdatedBeforeSms,
    pendingCreatedBeforeSms: args.pendingCreatedBeforeSms,
    refreshClearedBeforeSms: args.refreshClearedBeforeSms,
    commitmentPromptDeliveredBeforeSms: args.commitmentPromptDeliveredBeforeSms,
    refreshClarificationConsumedBeforeSms: args.refreshClarificationConsumedBeforeSms,
    stateTransitionSummary: args.stateTransitionSummary ?? null,
  };
}

export function buildRefreshCommitmentNoSendTruthPolicyContext(args: {
  refreshIntent: RefreshCommitmentLaneIntent;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  refreshSessionId?: string | null;
  stateMutationCompletedBeforeSms: boolean;
  commitmentUpdatedBeforeSms?: boolean;
  commitmentKeepRecordedBeforeSms?: boolean;
  pendingCreatedBeforeSms?: boolean;
  pendingResolutionKind?: string | null;
  refreshClearedBeforeSms?: boolean;
  refreshClarificationConsumedBeforeSms?: boolean;
  sideEffectsRecordedBeforeSms?: boolean;
  stateTransitionSummary?: string | null;
}): RefreshCommitmentNoSendTruthPolicyContext {
  return {
    branch: deriveRefreshCommitmentNoSendPolicyBranch(args.refreshIntent),
    refreshIntent: args.refreshIntent,
    refreshFamily: "commitment",
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    refreshSessionId: args.refreshSessionId ?? null,
    stateMutationCompletedBeforeSms: args.stateMutationCompletedBeforeSms,
    commitmentUpdatedBeforeSms: args.commitmentUpdatedBeforeSms,
    commitmentKeepRecordedBeforeSms: args.commitmentKeepRecordedBeforeSms,
    pendingCreatedBeforeSms: args.pendingCreatedBeforeSms,
    pendingResolutionKind: args.pendingResolutionKind ?? null,
    refreshClearedBeforeSms: args.refreshClearedBeforeSms,
    refreshClarificationConsumedBeforeSms: args.refreshClarificationConsumedBeforeSms,
    sideEffectsRecordedBeforeSms: args.sideEffectsRecordedBeforeSms,
    stateTransitionSummary: args.stateTransitionSummary ?? null,
  };
}

function refreshNoSendStageReasonField(
  stage: RefreshNoSendStage,
  reason: string
): Partial<RefreshNoSendTruthTelemetry> {
  if (stage === "lane") return { lane_no_send_reason: reason };
  if (stage === "north_star") return { north_star_no_send_reason: reason };
  if (stage === "final_voice_gate") return { final_voice_gate_skip_reason: reason };
  if (stage === "post_unified_truth_recheck") return { post_unified_truth_recheck_reason: reason };
  return { unified_final_guard_no_send_reason: reason };
}

async function insertRefreshNoSendTruthEvent(args: {
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
      source: "sms_v2_refresh_no_send",
      payload_json: {
        refresh_no_send_truth: true,
        inbound_resolution_message_sid: args.inboundMessageSid,
        ...args.resolutionTelemetry,
      },
      idempotency_key: `v2_sms_refresh_no_send:${args.inboundMessageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return { inserted: false, duplicate: true };
      console.warn("[sms-refresh] no_send_truth insert skipped", {
        message: error.message,
        code,
      });
      return { inserted: false, duplicate: false };
    }
    return { inserted: true, duplicate: false };
  } catch (e) {
    console.warn("[sms-refresh] no_send_truth insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { inserted: false, duplicate: false };
  }
}

/**
 * Branch-specific truth/state policy when refresh visible SMS no-sends.
 */
export async function persistRefreshTruthOnNoSend(
  args: PersistRefreshTruthOnNoSendArgs
): Promise<RefreshNoSendTruthTelemetry> {
  const stageReason = refreshNoSendStageReasonField(args.noSendStage, args.noSendReason);

  const baseTelemetry: RefreshNoSendTruthTelemetry = {
    refresh_no_send_truth_policy: true,
    refresh_no_send_policy_branch: args.branch,
    refresh_intent: args.refreshIntent,
    refresh_family: args.refreshFamily,
    state_mutation_completed_before_sms:
      args.branch === "refresh_mutation_applied" ||
      args.branch === "refresh_cleared_or_aborted" ||
      args.stateMutationCompletedBeforeSms,
    refresh_visible_sent: false,
    visible_sent: false,
    no_send_stage: args.noSendStage,
    no_send_reason: args.noSendReason,
    ...stageReason,
    ...(args.stageMetadata ?? {}),
    state_transition_summary: args.stateTransitionSummary ?? null,
    refresh_session_id: args.refreshSessionId ?? null,
    ...(args.refreshFamily === "identity" && args.refreshSessionAdvancedBeforeSms !== undefined
      ? { refresh_session_advanced_before_sms: args.refreshSessionAdvancedBeforeSms }
      : {}),
    ...(args.refreshFamily === "identity" && args.identityUpdatedBeforeSms !== undefined
      ? { identity_updated_before_sms: args.identityUpdatedBeforeSms }
      : {}),
    ...(args.refreshFamily === "commitment" && args.commitmentUpdatedBeforeSms !== undefined
      ? { commitment_updated_before_sms: args.commitmentUpdatedBeforeSms }
      : {}),
    ...(args.refreshFamily === "commitment" && args.commitmentKeepRecordedBeforeSms !== undefined
      ? { commitment_keep_recorded_before_sms: args.commitmentKeepRecordedBeforeSms }
      : {}),
    ...(args.pendingCreatedBeforeSms !== undefined
      ? { pending_created_before_sms: args.pendingCreatedBeforeSms }
      : {}),
    ...(args.refreshFamily === "commitment" && args.pendingResolutionKind !== undefined
      ? { pending_resolution_kind: args.pendingResolutionKind }
      : {}),
    ...(args.refreshClearedBeforeSms !== undefined
      ? { refresh_cleared_before_sms: args.refreshClearedBeforeSms }
      : {}),
    ...(args.refreshFamily === "identity" && args.commitmentPromptDeliveredBeforeSms !== undefined
      ? { commitment_prompt_delivered_before_sms: args.commitmentPromptDeliveredBeforeSms }
      : {}),
    ...(args.refreshClarificationConsumedBeforeSms !== undefined
      ? { refresh_clarification_consumed_before_sms: args.refreshClarificationConsumedBeforeSms }
      : {}),
    ...(args.sendTimeEngagementRecordedBeforeSms
      ? { send_time_engagement_recorded_before_sms: true }
      : {}),
    ...(args.sideEffectsRecordedBeforeSms ? { side_effects_recorded_before_sms: true } : {}),
    ...(args.requiredVerbatimMissing?.length
      ? { required_verbatim_missing: args.requiredVerbatimMissing }
      : {}),
    ...(args.refreshTruthViolation ? { refresh_truth_violation: args.refreshTruthViolation } : {}),
    refresh_truth_persisted: false,
  };

  if (!DURABLE_AUDIT_BRANCHES.has(args.branch)) {
    return baseTelemetry;
  }

  const resolutionPayload: RefreshNoSendTruthTelemetry = {
    ...baseTelemetry,
    refresh_truth_persisted: true,
  };

  const insertResult = await insertRefreshNoSendTruthEvent({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    resolutionTelemetry: resolutionPayload,
  });

  return {
    ...resolutionPayload,
    refresh_no_send_duplicate: insertResult.duplicate,
  };
}
