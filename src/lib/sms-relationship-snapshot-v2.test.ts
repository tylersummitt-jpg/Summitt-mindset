import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import {
  RELATIONSHIP_SNAPSHOT_AUTHORITY_HIERARCHY,
  RELATIONSHIP_SNAPSHOT_V2_VERSION,
  buildRelationshipSnapshotV2,
  buildRelationshipSnapshotV2PromptGuidance,
  normalizeStructuredRecentExactThread72hForV2,
} from "@/lib/sms-relationship-snapshot-v2";
import { buildActivePendingStateFromCommitmentRow } from "@/lib/sms-active-pending-state";
import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  DEFAULT_RELATIONSHIP_PACKET_BUDGET,
} from "@/lib/sms-relationship-packet-v1";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";

function make72hMessage(
  partial: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "role" | "body">
): RecentExactThread72hMessage {
  return {
    at: "2026-05-18T11:00:00.000Z",
    at_local: "May 18, 6:00 AM",
    at_local_timezone: "America/Chicago",
    local_day_key: "2026-05-18",
    message_kind: null,
    source_table: "sms_inbound_messages",
    message_sid: null,
    delivery_status: "sent",
    is_exact_body: true,
    ...partial,
  };
}

describe("normalizeStructuredRecentExactThread72hForV2", () => {
  it("returns empty structured section with fallback metadata when thread missing", () => {
    const section = normalizeStructuredRecentExactThread72hForV2(null);
    expect(section.data.messages).toEqual([]);
    expect(section.data.thread_fallback_used).toBe(true);
    expect(section.data.thread_fallback_source).toBe("missing_thread");
    expect(section.data).not.toHaveProperty("legacy_fallback_lines");
  });

  it("strips legacy line fallback from v2 data while flagging fallback", () => {
    const section = normalizeStructuredRecentExactThread72hForV2({
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: false,
        had_system_no_send: false,
        legacy_fallback_lines: ["Coach: old line"],
        legacy_fallback_source: "recent_transcript_lines",
      },
    });
    expect(section.data.messages).toEqual([]);
    expect(section.data.thread_fallback_used).toBe(true);
    expect(section.data).not.toHaveProperty("legacy_fallback_lines");
  });

  it("preserves structured messages without prose fallback", () => {
    const section = normalizeStructuredRecentExactThread72hForV2({
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [make72hMessage({ role: "coach", body: "Exact sent body" })],
        message_count: 1,
        had_preview_messages: false,
        had_system_no_send: false,
      },
    });
    expect(section.data.messages[0]?.body).toBe("Exact sent body");
    expect(section.data.thread_fallback_used).toBe(false);
  });
});

describe("buildRelationshipSnapshotV2", () => {
  it("has version 2.0, authority_hierarchy, and finalization_context", () => {
    const packet = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: {
        route_purpose: "normal_inbound_reply",
        user: {
          clerk_user_id: "u",
          preferred_name: null,
          timezone: "America/Chicago",
          local_time_iso: "2026-05-12T09:00:00.000Z",
          relationship_profile_summary: null,
        },
        commitment: {
          id: "c",
          title: "T",
          behavior_statement: "B",
          effective_ask: "B",
          accountability_phase: "active_accountability",
        },
        thread: {
          latest_inbound_raw: "yes",
          coalesced_inbound_text: "yes",
          suppressed_message_sids: [],
          recent_transcript_lines: [],
          latest_outbound_coach_sms: null,
          latest_open_question: null,
          latest_answer_after_open_question: null,
          expected_reply_semantics: "unknown",
          memory_authority: {
            open_question_source: "none",
            answer_source: "none",
            projection_used: false,
          },
          do_not_repeat_hints: [],
          rejected_time_candidates: [],
          unavailable_windows: [],
          current_inbound_is_already_told_you_correction: false,
          current_inbound_is_short_acknowledgement: false,
          most_recent_substantive_prior_user_message: null,
          most_recent_coach_question: null,
          memory_correction_should_use_prior_user_answer: false,
          short_ack_should_not_reask_question: false,
          memory_packet: {
            recent_exact_thread_72h: {
              messages: [make72hMessage({ role: "coach", body: "Check in?" })],
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 1,
              had_preview_messages: false,
              had_system_no_send: false,
            },
          },
        },
        v2_accountability: {
          deterministic_classifier_event: "user_yes",
          gated_mode: "use_deterministic",
          final_event_type: "user_yes",
          should_write_outcome_event: true,
          reply_style: "normal_outcome",
          proof_signal: false,
          miss_signal: false,
          blocker_signal: false,
          today_completed: false,
          future_intent_hint: null,
          supplement_commitment_change_guidance: false,
          proof_callout_hint: null,
        },
        legacy_suggestions: {
          conversation_brain: { enabled: false },
          forced_future_stretch_intent_active: false,
          accountability_proof_hint: null,
        },
        constraints: {
          max_chars: 320,
          one_sms: true,
          no_generic_motivation: true,
          no_quoted_or_truncated_echo_of_inbound: true,
          if_unsafe_return_no_send: true,
          forbidden_substrings: [],
        },
        inbound_meaning: {
          raw_inbound: "yes",
          classifier_event_type: "user_yes",
          relationship_meaning: "outcome_reported",
          response_intent: "acknowledge_outcome",
          persistence_decision: "write_outcome",
          do_not_repeat_asks: [],
          stale_ask_risk: false,
          confidence: 0.8,
          persistence_note: "test",
        },
        suggested_coaching_move: "ack_outcome",
      } as never,
    }).packet;

    const { snapshot } = buildRelationshipSnapshotV2({
      packet,
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      surface: "inbound",
      lane: "inbound",
    });

    expect(snapshot.version).toBe(RELATIONSHIP_SNAPSHOT_V2_VERSION);
    expect(snapshot.authority_hierarchy).toEqual(RELATIONSHIP_SNAPSHOT_AUTHORITY_HIERARCHY);
    expect(snapshot.current_turn).toBeTruthy();
    expect(snapshot.canonical_state).toBeTruthy();
    expect(snapshot.active_pending_state.authority).toBe("server_state_authoritative");
    expect(snapshot.recent_exact_thread_72h.data.messages.length).toBe(1);
    expect(snapshot.finalization_context.note).toBe("server_validates_send_separately");
  });
});

describe("buildRelationshipSnapshotV2PromptGuidance", () => {
  it("states recent exact thread beats older memory and low-confidence hints are background only", () => {
    const guidance = buildRelationshipSnapshotV2PromptGuidance();
    expect(guidance).toMatch(/recent_exact_thread_72h beats relationship_memory_7d/i);
    expect(guidance).toMatch(/relationship_memory_7d beats relationship_memory_30d/i);
    expect(guidance).toMatch(/low_confidence_hints/i);
    expect(guidance).toMatch(/server validates send separately/i);
  });

  it("is included in combined packet prompt guidance", () => {
    expect(buildRelationshipPacketPromptGuidance()).toMatch(/RELATIONSHIP_SNAPSHOT_V2_AUTHORITY/i);
  });
});

describe("buildRelationshipPacketForOpenAI snapshot v2 integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches snapshot v2 to inbound/daily/weekly user prompts", () => {
    const inbound = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: {
        route_purpose: "normal_inbound_reply",
        user: {
          clerk_user_id: "u",
          preferred_name: null,
          timezone: "America/Chicago",
          local_time_iso: "2026-05-12T09:00:00.000Z",
          relationship_profile_summary: null,
        },
        commitment: {
          id: "c",
          title: "T",
          behavior_statement: "B",
          effective_ask: "B",
          accountability_phase: "active_accountability",
        },
        thread: {
          latest_inbound_raw: "yes",
          coalesced_inbound_text: "yes",
          suppressed_message_sids: [],
          recent_transcript_lines: ["Coach: legacy"],
          latest_outbound_coach_sms: null,
          latest_open_question: null,
          latest_answer_after_open_question: null,
          expected_reply_semantics: "unknown",
          memory_authority: {
            open_question_source: "none",
            answer_source: "none",
            projection_used: false,
          },
          do_not_repeat_hints: [],
          rejected_time_candidates: [],
          unavailable_windows: [],
          current_inbound_is_already_told_you_correction: false,
          current_inbound_is_short_acknowledgement: false,
          most_recent_substantive_prior_user_message: null,
          most_recent_coach_question: null,
          memory_correction_should_use_prior_user_answer: false,
          short_ack_should_not_reask_question: false,
          memory_packet: {
            recent_exact_thread_72h: {
              messages: [make72hMessage({ role: "coach", body: "Structured coach" })],
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 1,
              had_preview_messages: false,
              had_system_no_send: false,
            },
          },
        },
        v2_accountability: {
          deterministic_classifier_event: "user_yes",
          gated_mode: "use_deterministic",
          final_event_type: "user_yes",
          should_write_outcome_event: true,
          reply_style: "normal_outcome",
          proof_signal: false,
          miss_signal: false,
          blocker_signal: false,
          today_completed: false,
          future_intent_hint: null,
          supplement_commitment_change_guidance: false,
          proof_callout_hint: null,
        },
        legacy_suggestions: {
          conversation_brain: { enabled: false },
          forced_future_stretch_intent_active: false,
          accountability_proof_hint: null,
        },
        constraints: {
          max_chars: 320,
          one_sms: true,
          no_generic_motivation: true,
          no_quoted_or_truncated_echo_of_inbound: true,
          if_unsafe_return_no_send: true,
          forbidden_substrings: [],
        },
        inbound_meaning: {
          raw_inbound: "yes",
          classifier_event_type: "user_yes",
          relationship_meaning: "outcome_reported",
          response_intent: "acknowledge_outcome",
          persistence_decision: "write_outcome",
          do_not_repeat_asks: [],
          stale_ask_risk: false,
          confidence: 0.8,
          persistence_note: "test",
        },
        suggested_coaching_move: "ack_outcome",
      } as never,
    });

    expect(inbound.snapshotV2.version).toBe("2.0");
    expect(inbound.userPromptJson).toContain("RELATIONSHIP_SNAPSHOT_V2");
    expect(inbound.snapshotV2.recent_exact_thread_72h.data.messages[0]?.body).toBe("Structured coach");
    expect(inbound.userPromptJson.length).toBeLessThanOrEqual(DEFAULT_RELATIONSHIP_PACKET_BUDGET);
    expect(inbound.snapshotV2Meta.included_thread_window_hours).toBe(72);
  });

  it("missing thread yields empty v2 section without prose fallback in snapshot", () => {
    const result = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: {
        route_purpose: "normal_inbound_reply",
        user: {
          clerk_user_id: "u",
          preferred_name: null,
          timezone: "America/Chicago",
          local_time_iso: "2026-05-12T09:00:00.000Z",
          relationship_profile_summary: null,
        },
        commitment: {
          id: "c",
          title: "T",
          behavior_statement: "B",
          effective_ask: "B",
          accountability_phase: "active_accountability",
        },
        thread: {
          latest_inbound_raw: "yes",
          coalesced_inbound_text: "yes",
          suppressed_message_sids: [],
          recent_transcript_lines: ["Coach: legacy only line"],
          latest_outbound_coach_sms: null,
          latest_open_question: null,
          latest_answer_after_open_question: null,
          expected_reply_semantics: "unknown",
          memory_authority: {
            open_question_source: "none",
            answer_source: "none",
            projection_used: false,
          },
          do_not_repeat_hints: [],
          rejected_time_candidates: [],
          unavailable_windows: [],
          current_inbound_is_already_told_you_correction: false,
          current_inbound_is_short_acknowledgement: false,
          most_recent_substantive_prior_user_message: null,
          most_recent_coach_question: null,
          memory_correction_should_use_prior_user_answer: false,
          short_ack_should_not_reask_question: false,
          memory_packet: null,
        },
        v2_accountability: {
          deterministic_classifier_event: "user_yes",
          gated_mode: "use_deterministic",
          final_event_type: "user_yes",
          should_write_outcome_event: true,
          reply_style: "normal_outcome",
          proof_signal: false,
          miss_signal: false,
          blocker_signal: false,
          today_completed: false,
          future_intent_hint: null,
          supplement_commitment_change_guidance: false,
          proof_callout_hint: null,
        },
        legacy_suggestions: {
          conversation_brain: { enabled: false },
          forced_future_stretch_intent_active: false,
          accountability_proof_hint: null,
        },
        constraints: {
          max_chars: 320,
          one_sms: true,
          no_generic_motivation: true,
          no_quoted_or_truncated_echo_of_inbound: true,
          if_unsafe_return_no_send: true,
          forbidden_substrings: [],
        },
        inbound_meaning: {
          raw_inbound: "yes",
          classifier_event_type: "user_yes",
          relationship_meaning: "outcome_reported",
          response_intent: "acknowledge_outcome",
          persistence_decision: "write_outcome",
          do_not_repeat_asks: [],
          stale_ask_risk: false,
          confidence: 0.8,
          persistence_note: "test",
        },
        suggested_coaching_move: "ack_outcome",
      } as never,
    });

    expect(result.snapshotV2.recent_exact_thread_72h.data.messages).toEqual([]);
    expect(result.snapshotV2.recent_exact_thread_72h.data.thread_fallback_used).toBe(true);
    expect(JSON.stringify(result.snapshotV2)).not.toContain("legacy_fallback_lines");
  });

  it("budget trim preserves authority_hierarchy and active_pending_state", () => {
    const huge = "z".repeat(9000);
    const result = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: {
        route_purpose: "normal_inbound_reply",
        user: {
          clerk_user_id: "u",
          preferred_name: null,
          timezone: "America/Chicago",
          local_time_iso: "2026-05-12T09:00:00.000Z",
          relationship_profile_summary: huge,
        },
        commitment: {
          id: "c",
          title: "T",
          behavior_statement: "B",
          effective_ask: "B",
          accountability_phase: "active_accountability",
        },
        thread: {
          latest_inbound_raw: "yes",
          coalesced_inbound_text: "yes",
          suppressed_message_sids: [],
          recent_transcript_lines: [],
          latest_outbound_coach_sms: null,
          latest_open_question: "Still open?",
          latest_answer_after_open_question: null,
          expected_reply_semantics: "unknown",
          memory_authority: {
            open_question_source: "none",
            answer_source: "none",
            projection_used: false,
          },
          do_not_repeat_hints: [],
          rejected_time_candidates: [],
          unavailable_windows: [],
          current_inbound_is_already_told_you_correction: false,
          current_inbound_is_short_acknowledgement: false,
          most_recent_substantive_prior_user_message: null,
          most_recent_coach_question: null,
          memory_correction_should_use_prior_user_answer: false,
          short_ack_should_not_reask_question: false,
          memory_packet: {
            recent_exact_thread_72h: {
              messages: Array.from({ length: 8 }, (_, i) =>
                make72hMessage({
                  role: i % 2 === 0 ? "coach" : "user",
                  body: `msg ${i} ${huge.slice(0, 200)}`,
                  at: `2026-05-1${i % 8}T11:00:00.000Z`,
                })
              ),
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 8,
              had_preview_messages: false,
              had_system_no_send: false,
            },
            relationship_memory_7d: {
              window_days: 7,
              built_at: "2026-05-18T12:00:00.000Z",
              outcome_counts: { yes: 1, no: 0, partial: 0, blockers: 0, checks_sent: 1 },
              wins: [],
              misses: [],
              partials: [],
              comebacks: [],
              blockers: [],
              proof_moments: [],
              open_loops: [],
              direct_answer_history: [],
              context_flags: {},
              meta: { item_count: 0, sources_used: [] },
            },
            relationship_memory_30d: {
              window_days: 30,
              built_at: "2026-05-18T12:00:00.000Z",
              commitment_id: "c",
              season: null,
              outcome_counts_30d: {
                yes: 1,
                no: 0,
                partial: 0,
                blockers: 0,
                checks_sent: 1,
                overlay_activated: 0,
                overlay_declined: 0,
                reactivation_yes: 0,
              },
              recurring_blockers: [],
              meaningful_proof: [],
              adjustments: [],
              goal_changes: [],
              comebacks: [],
              voice_preferences: null,
              pat_read_snapshot: [],
              meta: { item_count: 0, sources_used: [] },
            },
          },
        },
        v2_accountability: {
          deterministic_classifier_event: "user_yes",
          gated_mode: "use_deterministic",
          final_event_type: "user_yes",
          should_write_outcome_event: true,
          reply_style: "normal_outcome",
          proof_signal: false,
          miss_signal: false,
          blocker_signal: false,
          today_completed: false,
          future_intent_hint: null,
          supplement_commitment_change_guidance: false,
          proof_callout_hint: null,
        },
        legacy_suggestions: {
          conversation_brain: { enabled: false },
          forced_future_stretch_intent_active: false,
          accountability_proof_hint: null,
        },
        constraints: {
          max_chars: 320,
          one_sms: true,
          no_generic_motivation: true,
          no_quoted_or_truncated_echo_of_inbound: true,
          if_unsafe_return_no_send: true,
          forbidden_substrings: [],
        },
        inbound_meaning: {
          raw_inbound: "yes",
          classifier_event_type: "user_yes",
          relationship_meaning: "outcome_reported",
          response_intent: "acknowledge_outcome",
          persistence_decision: "write_outcome",
          do_not_repeat_asks: [],
          stale_ask_risk: false,
          confidence: 0.8,
          persistence_note: "test",
        },
        suggested_coaching_move: "ack_outcome",
      } as never,
      totalCharBudget: DEFAULT_RELATIONSHIP_PACKET_BUDGET,
    });

    expect(result.userPromptJson).toContain("authority_hierarchy");
    expect(result.snapshotV2.active_pending_state).toBeTruthy();
    expect(result.snapshotV2.authority_hierarchy.length).toBeGreaterThan(0);
    expect(result.userPromptJson.length).toBeLessThanOrEqual(DEFAULT_RELATIONSHIP_PACKET_BUDGET);
  });
});
