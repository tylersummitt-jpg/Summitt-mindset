/**
 * Guided contract / shrink Relationship Snapshot v2 builder (loads memory packet).
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { buildActivePendingStateFromCommitmentRow } from "@/lib/sms-active-pending-state";
import { buildSmsRelationshipMemoryPacket } from "@/lib/sms-relationship-memory-packet";
import type { RelationshipPacketV1 } from "@/lib/sms-relationship-packet-v1";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";
import {
  buildRelationshipSnapshotV2,
  userPromptAppendixFromSnapshotV2,
  type RelationshipSnapshotV2,
  type RelationshipSnapshotV2Meta,
} from "@/lib/sms-relationship-snapshot-v2";

/** Guided shrink / contract proposal — builds v2 snapshot from memory packet + commitment row. */
export async function buildGuidedContractRelationshipSnapshotV2(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
}): Promise<{
  snapshot: RelationshipSnapshotV2;
  userPromptAppendix: string;
  meta: RelationshipSnapshotV2Meta;
}> {
  const mem = await buildSmsRelationshipMemoryPacket({
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitment.id,
  });

  const thread72 = mem.recent_exact_thread_72h;
  const effectiveAsk = getEffectiveCoachingAsk(args.commitment, Date.now());

  const packet: RelationshipPacketV1 = {
    relationship_packet_version: "1.8",
    current_turn: {
      authority: "authoritative_current",
      data: {
        route_purpose: "guided_shrink_contract_prompt",
        route_kind: "guided_contract",
        timezone: args.timezone,
        suggested_coaching_move: "propose_shrink_ask_consent",
      },
    },
    structured_recent_truth: {
      authority: "structured_recent_truth",
      data: {
        latest_open_question: mem.latest_open_question,
        latest_answer_after_open_question: mem.latest_answer_after_open_question,
        open_question_pending: mem.open_question_pending,
        open_question_source: mem.open_question_source,
        answer_source: mem.answer_source,
        projection_used: mem.meta.projection_used,
        last_5_coach_questions: mem.last_5_coach_questions.slice(0, 5).map((q) => q.text),
        last_5_user_answers: mem.last_5_user_answers.slice(0, 5).map((a) => a.text),
        do_not_repeat_phrases: mem.do_not_repeat_phrases.slice(0, 8).map((h) => h.phrase),
      },
    },
    recent_exact_thread_72h: thread72
      ? {
          authority: "authoritative_recent_thread",
          data: {
            window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
            messages: thread72.messages,
            message_count: thread72.message_count,
            had_preview_messages: thread72.had_preview_messages,
            had_system_no_send: thread72.had_system_no_send,
          },
        }
      : null,
    canonical_state: {
      authority: "authoritative_current",
      data: {
        commitment_id: args.commitment.id,
        title: args.commitment.title,
        behavior_statement: args.originalBehaviorStatement.trim(),
        effective_ask: effectiveAsk,
        accountability_phase: args.commitment.accountability_phase,
        overlay_active: false,
        contract_proposal_mode: true,
        pending_resolution_active: Boolean(args.commitment.pending_resolution_kind),
      },
    },
    proof_victory_permission: {
      authority: "authoritative_current",
      data: {
        can_reference_victory_room: false,
        can_say_saved_as_proof: false,
        proof_saved: false,
      },
    },
    relationship_memory_7d: mem.relationship_memory_7d
      ? (() => {
          const { meta: _m7, ...data } = mem.relationship_memory_7d;
          void _m7;
          return { authority: "structured_background" as const, data };
        })()
      : undefined,
    relationship_memory_30d_or_season: mem.relationship_memory_30d
      ? (() => {
          const { meta: _m30, ...data } = mem.relationship_memory_30d;
          void _m30;
          return { authority: "background_summary" as const, data };
        })()
      : undefined,
    lower_authority_background: mem.coaching_memory_summary
      ? {
          authority: "low_authority_hint",
          data: { coaching_memory_snippet: mem.coaching_memory_summary.slice(0, 600) },
        }
      : undefined,
  };

  const activePending = buildActivePendingStateFromCommitmentRow(args.commitment, {
    openQuestionPending: mem.open_question_pending,
    latestOpenQuestion: mem.latest_open_question,
    contractProposalPending: true,
  });

  const built = buildRelationshipSnapshotV2({
    packet,
    activePendingState: activePending,
    surface: "guided_contract",
    timezone: args.timezone,
    proposalKind: "shrink_ask",
  });

  return {
    snapshot: built.snapshot,
    userPromptAppendix: userPromptAppendixFromSnapshotV2(built.snapshot),
    meta: built.meta,
  };
}
