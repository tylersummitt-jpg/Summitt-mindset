/**
 * Phase 2.1d-A1 — contract consent no-send truth policy (lane / NS / FVG / unified guard).
 * Uses existing sms_memory_signal event_type for durable audit when state must be recorded.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundV3ContractConsentFacts } from "@/lib/v3-inbound-relationship-lane";

export type ContractConsentNoSendPolicyBranch =
  | "contract_mutation_applied"
  | "contract_declined_or_cleared"
  | "contract_noop_already_applied"
  | "contract_pending_active_clarify"
  | "rpc_failed_no_mutation";

export type ContractConsentAction =
  | "activated"
  | "declined"
  | "noop_already_applied"
  | "noop_not_found"
  | "noop_state_conflict"
  | "clarify"
  | "rpc_failed";

export type ContractConsentNoSendStage =
  | "lane"
  | "sol_writer"
  | "north_star"
  | "final_voice_gate"
  | "unified_final_guard"
  | "post_unified_truth_recheck"
  | "human_fallback_unified_guard";

export type ContractConsentNoSendTruthPolicyContext = {
  policyBranch: ContractConsentNoSendPolicyBranch;
  contractAction: ContractConsentAction;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  stateMutationCompletedBeforeSms: boolean;
  contractConsentApplied: boolean;
  proposalCleared: boolean;
  contractNoop: boolean;
  proposalStillActive: boolean;
  stateTransitionSummary?: string | null;
  proposalTextDigest?: string | null;
  bindingCritical: boolean;
};

export type PersistContractConsentTruthOnNoSendArgs = ContractConsentNoSendTruthPolicyContext & {
  noSendStage: ContractConsentNoSendStage;
  noSendReason: string;
  requiredVerbatimMissing?: string[] | null;
  contractTruthViolation?: string | null;
  stageMetadata?: Record<string, unknown>;
};

export type ContractConsentNoSendTruthTelemetry = {
  contract_consent_no_send_truth_policy: true;
  contract_no_send_policy_branch: ContractConsentNoSendPolicyBranch;
  contract_action: ContractConsentAction;
  contract_consent_applied: boolean;
  proposal_cleared: boolean;
  contract_noop: boolean;
  proposal_still_active: boolean;
  state_mutation_completed_before_sms: boolean;
  contract_consent_visible_sent: false;
  visible_sent: false;
  no_send_stage: ContractConsentNoSendStage;
  no_send_reason: string;
  contract_consent_truth_persisted: boolean;
  contract_consent_no_send_duplicate?: boolean;
  already_finalized?: boolean;
  lane_no_send_reason?: string;
  sol_writer_no_send_reason?: string;
  north_star_no_send_reason?: string;
  final_voice_gate_skip_reason?: string;
  unified_final_guard_no_send_reason?: string;
  post_unified_truth_recheck_reason?: string;
  human_fallback_unified_guard_reason?: string;
  state_transition_summary?: string | null;
  required_verbatim_missing?: string[];
  contract_truth_violation?: string | null;
};

export function deriveContractConsentAction(
  overlayAction: InboundV3ContractConsentFacts["overlay_action"]
): ContractConsentAction {
  if (overlayAction === "activated") return "activated";
  if (overlayAction === "declined") return "declined";
  if (overlayAction === "noop_already_applied") return "noop_already_applied";
  if (overlayAction === "noop_not_found") return "noop_not_found";
  if (overlayAction === "noop_state_conflict") return "noop_state_conflict";
  return "clarify";
}

export function deriveContractConsentNoSendPolicyBranch(args: {
  overlayAction: InboundV3ContractConsentFacts["overlay_action"];
}): ContractConsentNoSendPolicyBranch {
  if (args.overlayAction === "activated") return "contract_mutation_applied";
  if (args.overlayAction === "declined") return "contract_declined_or_cleared";
  if (args.overlayAction === "noop_already_applied") return "contract_noop_already_applied";
  if (args.overlayAction === "noop_not_found" || args.overlayAction === "noop_state_conflict") {
    return "contract_pending_active_clarify";
  }
  return "contract_pending_active_clarify";
}

export function buildContractConsentNoSendTruthPolicyContext(args: {
  contractConsentFacts: InboundV3ContractConsentFacts;
  stateMutationCompletedBeforeSms: boolean;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  proposalStillActive: boolean;
}): ContractConsentNoSendTruthPolicyContext {
  const overlayAction = args.contractConsentFacts.overlay_action;
  const contractAction = deriveContractConsentAction(overlayAction);
  const policyBranch = deriveContractConsentNoSendPolicyBranch({ overlayAction });
  const bindingCritical =
    Array.isArray(args.contractConsentFacts.required_verbatim_substrings) &&
    args.contractConsentFacts.required_verbatim_substrings.length > 0;

  return {
    policyBranch,
    contractAction,
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    stateMutationCompletedBeforeSms: args.stateMutationCompletedBeforeSms,
    contractConsentApplied: overlayAction === "activated",
    proposalCleared: overlayAction === "declined",
    contractNoop: overlayAction === "noop_already_applied",
    proposalStillActive:
      args.proposalStillActive ||
      overlayAction === "noop_not_found" ||
      overlayAction === "noop_state_conflict",
    stateTransitionSummary: args.contractConsentFacts.server_state_transition_summary ?? null,
    proposalTextDigest: args.contractConsentFacts.proposal_text_digest ?? null,
    bindingCritical,
  };
}

function contractNoSendStageReasonField(
  stage: ContractConsentNoSendStage,
  reason: string
): Partial<ContractConsentNoSendTruthTelemetry> {
  if (stage === "lane") return { lane_no_send_reason: reason };
  if (stage === "sol_writer") return { sol_writer_no_send_reason: reason };
  if (stage === "north_star") return { north_star_no_send_reason: reason };
  if (stage === "final_voice_gate") return { final_voice_gate_skip_reason: reason };
  if (stage === "post_unified_truth_recheck") return { post_unified_truth_recheck_reason: reason };
  if (stage === "human_fallback_unified_guard") return { human_fallback_unified_guard_reason: reason };
  return { unified_final_guard_no_send_reason: reason };
}

async function insertContractConsentNoSendTruthEvent(args: {
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
      source: "sms_v2_contract_consent_no_send",
      payload_json: {
        contract_consent_no_send_truth: true,
        inbound_resolution_message_sid: args.inboundMessageSid,
        ...args.resolutionTelemetry,
      },
      idempotency_key: `v2_sms_contract_consent_no_send:${args.inboundMessageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return { inserted: false, duplicate: true };
      console.warn("[sms-contract-consent] no_send_truth insert skipped", {
        message: error.message,
        code,
      });
      return { inserted: false, duplicate: false };
    }
    return { inserted: true, duplicate: false };
  } catch (e) {
    console.warn("[sms-contract-consent] no_send_truth insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { inserted: false, duplicate: false };
  }
}

/**
 * Branch-specific truth/state policy when contract consent visible SMS no-sends.
 */
export async function persistContractConsentTruthOnNoSend(
  args: PersistContractConsentTruthOnNoSendArgs
): Promise<ContractConsentNoSendTruthTelemetry> {
  const stageReason = contractNoSendStageReasonField(args.noSendStage, args.noSendReason);
  const stateMutationCompleted =
    args.policyBranch === "contract_mutation_applied" ||
    args.policyBranch === "contract_declined_or_cleared"
      ? true
      : args.stateMutationCompletedBeforeSms;

  const baseTelemetry: ContractConsentNoSendTruthTelemetry = {
    contract_consent_no_send_truth_policy: true,
    contract_no_send_policy_branch: args.policyBranch,
    contract_action: args.contractAction,
    contract_consent_applied: args.contractConsentApplied,
    proposal_cleared: args.proposalCleared,
    contract_noop: args.contractNoop,
    proposal_still_active: args.proposalStillActive,
    state_mutation_completed_before_sms: stateMutationCompleted,
    contract_consent_visible_sent: false,
    visible_sent: false,
    no_send_stage: args.noSendStage,
    no_send_reason: args.noSendReason,
    ...stageReason,
    ...(args.stageMetadata ?? {}),
    state_transition_summary: args.stateTransitionSummary ?? null,
    ...(args.requiredVerbatimMissing?.length
      ? { required_verbatim_missing: args.requiredVerbatimMissing }
      : {}),
    ...(args.contractTruthViolation ? { contract_truth_violation: args.contractTruthViolation } : {}),
    contract_consent_truth_persisted: false,
  };

  if (
    args.policyBranch === "contract_pending_active_clarify" ||
    args.policyBranch === "rpc_failed_no_mutation"
  ) {
    return baseTelemetry;
  }

  const resolutionPayload: ContractConsentNoSendTruthTelemetry = {
    ...baseTelemetry,
    contract_consent_truth_persisted: true,
    ...(args.policyBranch === "contract_noop_already_applied"
      ? { already_finalized: true, state_mutation_completed_before_sms: false }
      : {}),
  };

  const insertResult = await insertContractConsentNoSendTruthEvent({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    resolutionTelemetry: resolutionPayload,
  });

  return {
    ...resolutionPayload,
    contract_consent_no_send_duplicate: insertResult.duplicate,
  };
}
