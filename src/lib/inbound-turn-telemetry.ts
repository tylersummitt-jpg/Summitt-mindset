/**
 * Best-effort inbound turn telemetry — no migration; uses existing v2_commitment_event.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION } from "@/lib/openai-relationship-turn-understanding-v1";
import { slimShortAnswerContextForTelemetry } from "@/lib/inbound-short-answer-context";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";

/** Compact resolved-truth / proof telemetry for soak SQL on sent turns. */
export const INBOUND_TURN_TELEMETRY_TRUTH_KEYS = [
  "inbound_resolved_outcome",
  "inbound_required_reply_move",
  "inbound_resolved_temporal_scope",
  "inbound_truth_max_questions_override",
  "inbound_resolved_truth_emitted",
  "inbound_truth_guardrails_applied",
  "proof_persisted_before_writer",
  "proof_persisted_event_type",
  "inbound_truth_persist_succeeded_before_writer",
  "inbound_truth_persist_event_type",
  "inbound_truth_persist_skipped_reason",
  "completion_alignment_result",
  "completion_alignment_skip_reason",
  "same_day_user_yes_already_recorded",
  "final_reply_source",
  "explicit_aligned_completion_detected",
  "completion_contradiction_guard_applied",
  "completion_contradiction_guard_reason",
] as const;

/** Compact lane / packet fields safe for soak SQL — no prompts, packets, or snapshots. */
export const INBOUND_TURN_TELEMETRY_COMPACT_KEYS = [
  "route_purpose",
  "branch_name",
  "v3_lane_reply_source",
  "reply_source",
  "strategy_card_surface",
  "strategy_card_route_kind",
  "strategy_card_move_type",
  "strategy_card_validation_status",
  "strategy_card_validation_reasons",
  "strategy_card_packet_writer_hints_stripped",
  "strategy_card_packet_stripped_fields",
  "relationship_packet_version",
  "relationship_snapshot_version",
  "relationship_packet_truncated",
  "relationship_snapshot_truncated",
  "open_loop_count",
  "do_not_repeat_ask_count",
  "recent_unanswered_question_count",
  "active_pending_state_source",
  "proof_permission_emitted",
  "can_claim_proof",
  "can_claim_miss",
  "can_claim_partial",
  "can_reference_victory_room",
  "strategy_card_can_claim_proof",
  "strategy_card_can_reference_victory_room",
  "no_send_reason",
] as const;

export type InboundTurnTelemetryArgs = {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  rawBody: string;
  replyBody: string;
  shortAnswerContext?: ShortAnswerContextAuthority | null;
  inboundMeaning?: InboundMeaningFacts | null;
  turnUnderstandingReconciled?: ReconciledTurnUnderstanding | null;
  coachingMoveSource?: string | null;
  truthGuardMetadata?: Record<string, unknown> | null;
  tuGuardMetadata?: Record<string, unknown> | null;
  branch?: string | null;
  laneMetadata?: Record<string, unknown> | null;
  packetObservability?: Record<string, unknown> | null;
  routePurpose?: string | null;
  branchName?: string | null;
  /** True when a visible send is intended immediately after telemetry insert (pre-Twilio). */
  visibleSentIntended?: boolean;
  preWriterTelemetry?: Record<string, unknown> | null;
};

export function compactInboundTurnTruthTelemetry(
  laneMetadata?: Record<string, unknown> | null,
  preWriterTelemetry?: Record<string, unknown> | null
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const absorb = (src: Record<string, unknown> | null | undefined) => {
    if (src == null || typeof src !== "object") return;
    for (const key of INBOUND_TURN_TELEMETRY_TRUTH_KEYS) {
      if (src[key] !== undefined && merged[key] === undefined) {
        merged[key] = src[key];
      }
    }
  };
  absorb(laneMetadata);
  absorb(preWriterTelemetry);
  if (preWriterTelemetry?.inbound_truth_persist_succeeded_before_writer === true) {
    merged.proof_persisted_before_writer = true;
    if (typeof preWriterTelemetry.inbound_truth_persist_event_type === "string") {
      merged.proof_persisted_event_type = preWriterTelemetry.inbound_truth_persist_event_type;
    }
  } else if (preWriterTelemetry?.inbound_truth_persist_succeeded_before_writer === false) {
    merged.proof_persisted_before_writer = false;
  }
  return merged;
}

export function compactInboundTurnTelemetryLaneFields(
  args: Pick<
    InboundTurnTelemetryArgs,
    | "laneMetadata"
    | "packetObservability"
    | "routePurpose"
    | "branchName"
    | "coachingMoveSource"
    | "visibleSentIntended"
  >
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  const absorb = (src: Record<string, unknown> | null | undefined) => {
    if (src == null || typeof src !== "object") return;
    for (const key of INBOUND_TURN_TELEMETRY_COMPACT_KEYS) {
      if (src[key] !== undefined && merged[key] === undefined) {
        merged[key] = src[key];
      }
    }
  };

  absorb(args.laneMetadata);
  absorb(args.packetObservability);

  const routePurpose = args.routePurpose?.trim();
  if (routePurpose) merged.route_purpose = routePurpose;

  const branchName = args.branchName?.trim();
  if (branchName) merged.branch_name = branchName;

  const replySource = args.coachingMoveSource?.trim();
  if (replySource) {
    merged.v3_lane_reply_source = replySource;
    merged.reply_source = replySource;
  }

  if (args.visibleSentIntended === true) {
    merged.visible_sent_intended = true;
  }

  return merged;
}

export async function insertInboundTurnTelemetryBestEffort(
  args: InboundTurnTelemetryArgs
): Promise<void> {
  const messageSid = args.messageSid.trim();
  const commitmentId = args.commitmentId.trim();
  if (!messageSid || !commitmentId) return;

  const laneFields = compactInboundTurnTelemetryLaneFields(args);
  const truthFields = compactInboundTurnTruthTelemetry(args.laneMetadata, args.preWriterTelemetry);

  const payload: Record<string, unknown> = {
    inbound_turn_telemetry: true,
    message_sid: messageSid,
    raw_body_preview: args.rawBody.trim().slice(0, 280),
    reply_body_preview: args.replyBody.trim().slice(0, 280),
    branch: args.branch ?? null,
    openai_turn_understanding_version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    short_answer_context: slimShortAnswerContextForTelemetry(args.shortAnswerContext),
    prior_question_type: args.shortAnswerContext?.prior_question_type ?? null,
    outcome_proof_eligible: args.shortAnswerContext?.outcome_proof_eligible ?? null,
    allowed_persistence: args.shortAnswerContext?.allowed_persistence ?? null,
    allowed_outbound_claims: args.shortAnswerContext?.allowed_outbound_claims ?? null,
    turn_understanding_relationship_meaning:
      args.turnUnderstandingReconciled?.reconciled_relationship_meaning ?? null,
    turn_understanding_response_intent:
      args.turnUnderstandingReconciled?.reconciled_response_intent ?? null,
    server_reconciled_persistence_decision:
      args.turnUnderstandingReconciled?.reconciled_persistence_decision ??
      args.inboundMeaning?.persistence_decision ??
      null,
    coaching_move_source: args.coachingMoveSource ?? null,
    inbound_meaning_relationship: args.inboundMeaning?.relationship_meaning ?? null,
    inbound_meaning_persistence: args.inboundMeaning?.persistence_decision ?? null,
    ...laneFields,
    ...truthFields,
    ...(args.truthGuardMetadata ?? {}),
    ...(args.tuGuardMetadata ?? {}),
  };

  try {
    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_inbound_coach",
      payload_json: payload,
      idempotency_key: `inbound_turn_telemetry:${messageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return;
      console.warn("[inbound-turn-telemetry] insert_skipped", {
        commitment_id: commitmentId,
        message_sid: messageSid,
        error: error.message,
      });
    }
  } catch (err) {
    console.warn("[inbound-turn-telemetry] insert_failed", {
      commitment_id: commitmentId,
      message_sid: messageSid,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
