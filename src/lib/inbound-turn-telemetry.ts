/**
 * Best-effort inbound turn telemetry — no migration; uses existing v2_commitment_event.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION } from "@/lib/openai-relationship-turn-understanding-v1";
import { slimShortAnswerContextForTelemetry } from "@/lib/inbound-short-answer-context";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";

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
};

export async function insertInboundTurnTelemetryBestEffort(
  args: InboundTurnTelemetryArgs
): Promise<void> {
  const messageSid = args.messageSid.trim();
  const commitmentId = args.commitmentId.trim();
  if (!messageSid || !commitmentId) return;

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
