/**
 * Best-effort inbound turn telemetry — no migration; uses existing v2_commitment_event.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION } from "@/lib/openai-relationship-turn-understanding-v1";
import { slimShortAnswerContextForTelemetry } from "@/lib/inbound-short-answer-context";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import { INBOUND_NOTEBOOK_OBSERVABILITY_KEYS } from "@/lib/sms-inbound-notebook-telemetry";

/** Compact inbound reply brief telemetry (Phase 1 — telemetry only, not writer input). */
export const INBOUND_REPLY_BRIEF_TELEMETRY_KEYS = [
  "inbound_reply_brief_version",
  "inbound_reply_brief_turn_type",
  "inbound_reply_brief_move",
  "inbound_reply_brief_max_questions",
  "inbound_followup_question_used_today",
  "inbound_answered_prior_question",
  "inbound_goal_status_from_latest_message",
  "inbound_false_premise_challenge_detected",
  "inbound_help_request_detected",
  "inbound_thanks_acknowledgment_detected",
  "inbound_repeated_question_complaint_detected",
  "inbound_time_of_day_forward_only_detected",
  "inbound_writer_prompt_path",
  "inbound_writer_openai_messages_hash",
  "inbound_relationship_packet_char_count",
  "inbound_writer_capture_message_count",
  "inbound_writer_prompt_mode",
  "inbound_brief_max_questions_guard_applied",
  "inbound_brief_max_questions_guard_repaired",
  "inbound_brief_max_questions_guard_fallback_used",
  "inbound_brief_max_questions_guard_reason",
  "inbound_brief_max_questions_guard_original_body_preview",
  "inbound_brief_max_questions_guard_final_body_preview",
  "inbound_reply_brief_char_count",
] as const;

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
  "semantic_completion_checked",
  "semantic_completion_source",
  "semantic_completion_claimed",
  "semantic_completion_alignment",
  "semantic_completion_confidence",
  "semantic_completion_tense",
  "semantic_completion_object_preview",
  "proof_persist_decision_reason",
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
  "inbound_sol_interpreter_model",
  "inbound_sol_writer_model",
  "inbound_sol_reasoning_effort",
  "inbound_sol_thread_hash",
  "inbound_sol_inbound_hash",
  "inbound_sol_inbound_preview",
  "inbound_sol_body_hash",
  "inbound_sol_body_preview",
  "inbound_sol_persist_status",
  "inbound_sol_persist_skip_reason",
  "inbound_sol_persist_event_type",
  "inbound_sol_win_persisted",
  "inbound_sol_win_attempted",
  "inbound_sol_primary_move",
  "inbound_sol_goal_role",
  "inbound_sol_answer_priority",
  "inbound_sol_coaching_after_answer",
  "inbound_sol_requires_pat_personal_knowledge",
  "inbound_sol_user_is_correcting_coach",
  "inbound_sol_accountability_outcome",
  "inbound_sol_accountability_relevance",
  "inbound_sol_accountability_confidence",
  "inbound_sol_meaningful_win_relationship",
  "inbound_sol_durable_user_evidence_returned",
  "inbound_sol_durable_user_evidence_persist_status",
  "inbound_sol_historical_evidence_count",
  "inbound_sol_most_alive_preview",
  "inbound_sol_retry_interpreter",
  "inbound_sol_retry_writer",
  "inbound_sol_no_send_reason",
  "inbound_sol_brief_version",
] as const;

/** Writer finish/usage + stage body previews for malformed-reply diagnosis. */
export const INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS = [
  "writer_model",
  "writer_finish_reason",
  "writer_output_tokens",
  "writer_prompt_tokens",
  "writer_candidate_preview",
  "post_north_star_body_preview",
  "post_fvg_body_preview",
  "final_body_before_integrity_preview",
  "final_body_after_integrity_preview",
  "final_sentence_integrity_checked",
  "final_sentence_integrity_ok",
  "final_sentence_integrity_reason",
  "final_sentence_integrity_repair_applied",
  "final_sentence_integrity_fallback_used",
] as const;

export function capInboundStageBodyPreview(body: string, max = 200): string {
  return body.trim().slice(0, max);
}

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
  /** North Star / FVG / integrity stage previews (capped). */
  stageTelemetry?: Record<string, unknown> | null;
};

export function compactInboundReplyBriefTelemetry(
  laneMetadata?: Record<string, unknown> | null
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  if (laneMetadata == null || typeof laneMetadata !== "object") return merged;
  for (const key of INBOUND_REPLY_BRIEF_TELEMETRY_KEYS) {
    if (laneMetadata[key] !== undefined) {
      merged[key] = laneMetadata[key];
    }
  }
  return merged;
}

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
    for (const key of INBOUND_NOTEBOOK_OBSERVABILITY_KEYS) {
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

export function compactInboundTurnWriterObservability(args: {
  laneMetadata?: Record<string, unknown> | null;
  stageTelemetry?: Record<string, unknown> | null;
  guardMetadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const absorb = (src: Record<string, unknown> | null | undefined) => {
    if (src == null || typeof src !== "object") return;
    for (const key of INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS) {
      if (src[key] !== undefined && merged[key] === undefined) {
        merged[key] = src[key];
      }
    }
  };
  absorb(args.laneMetadata);
  absorb(args.stageTelemetry);
  absorb(args.guardMetadata);
  return merged;
}

/**
 * P2a — top-level satisfied-ask fields for daily-satisfied-ask-context.
 * Additive; older rows without these keys remain readable via defaults / fallbacks.
 */
export function satisfiedAskTelemetryFieldsFromReconciled(
  reconciled: ReconciledTurnUnderstanding | null | undefined
): {
  turn_understanding_last_ask_satisfied: "yes" | "no" | "unclear";
  do_not_repeat_asks: string[];
} | Record<string, never> {
  if (!reconciled) return {};
  const lastAsk = reconciled.last_ask_satisfied;
  const last =
    lastAsk === "yes" || lastAsk === "no" || lastAsk === "unclear" ? lastAsk : "unclear";
  const dnr = Array.isArray(reconciled.reconciled_do_not_repeat_asks)
    ? reconciled.reconciled_do_not_repeat_asks
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    turn_understanding_last_ask_satisfied: last,
    do_not_repeat_asks: dnr,
  };
}

export async function insertInboundTurnTelemetryBestEffort(
  args: InboundTurnTelemetryArgs
): Promise<void> {
  const messageSid = args.messageSid.trim();
  const commitmentId = args.commitmentId.trim();
  if (!messageSid || !commitmentId) return;

  const laneFields = compactInboundTurnTelemetryLaneFields(args);
  const truthFields = compactInboundTurnTruthTelemetry(args.laneMetadata, args.preWriterTelemetry);
  const replyBriefFields = compactInboundReplyBriefTelemetry(args.laneMetadata);
  const writerObservability = compactInboundTurnWriterObservability({
    laneMetadata: args.laneMetadata,
    stageTelemetry: args.stageTelemetry,
    guardMetadata: args.truthGuardMetadata,
  });

  const satisfiedAskFields = satisfiedAskTelemetryFieldsFromReconciled(
    args.turnUnderstandingReconciled
  );

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
    ...replyBriefFields,
    ...writerObservability,
    ...(args.truthGuardMetadata ?? {}),
    ...(args.tuGuardMetadata ?? {}),
    // P2a: always win with reconciled TU fields so daily-satisfied-ask-context can read them.
    ...satisfiedAskFields,
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
