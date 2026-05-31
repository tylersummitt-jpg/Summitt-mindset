import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) },
}));

import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  DEFAULT_RELATIONSHIP_PACKET_BUDGET,
  RELATIONSHIP_PACKET_VERSION,
} from "@/lib/sms-relationship-packet-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { RecentExactThread72hMessage, RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";

function make72hMessage(
  partial: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "role" | "body">
): RecentExactThread72hMessage {
  return {
    at: "2026-05-18T11:00:00.000Z",
    at_local: "May 18, 6:00 AM",
    at_local_timezone: "America/Chicago",
    message_kind: null,
    source_table: "sms_inbound_messages",
    message_sid: null,
    delivery_status: "sent",
    is_exact_body: true,
    ...partial,
  };
}

function makeThread72h(messages: RecentExactThread72hMessage[]): RecentExactThread72hResult {
  return {
    messages,
    window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
    message_count: messages.length,
    had_preview_messages: messages.some((m) => m.delivery_status === "preview"),
    had_system_no_send: messages.some((m) => m.role === "system_no_send"),
    oldest_at: messages[0]?.at,
    newest_at: messages[messages.length - 1]?.at,
  };
}

function minimalInboundFacts(overrides?: Partial<InboundV3RelationshipFacts>): InboundV3RelationshipFacts {
  const thread72h = makeThread72h([
    make72hMessage({
      role: "coach",
      body: "Stretch at lunch?",
      source_table: "sms_inbound_coach_jobs",
      message_kind: "coach",
    }),
    make72hMessage({
      role: "user",
      body: "did that at lunch",
      at: "2026-05-18T11:05:00.000Z",
    }),
  ]);

  const base: InboundV3RelationshipFacts = {
    route_purpose: "normal_inbound_reply",
    user: {
      clerk_user_id: "user_pkt",
      preferred_name: "Alex",
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T09:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_pkt",
      title: "Morning focus",
      behavior_statement: "Two hours deep work before noon",
      effective_ask: "Two hours deep work before noon",
      accountability_phase: "active_accountability",
    },
    thread: {
      latest_inbound_raw: "done",
      coalesced_inbound_text: "done",
      suppressed_message_sids: [],
      recent_transcript_lines: ["Coach: How did it go?", "User: done"],
      latest_outbound_coach_sms: "How did it go?",
      latest_open_question: "How did it go?",
      latest_answer_after_open_question: null,
      expected_reply_semantics: "proposal_yes_no",
      memory_authority: {
        open_question_source: "north_star",
        answer_source: "none",
        projection_used: false,
      },
      do_not_repeat_hints: [],
      rejected_time_candidates: [],
      unavailable_windows: [],
      current_inbound_is_already_told_you_correction: false,
      current_inbound_is_short_acknowledgement: false,
      most_recent_substantive_prior_user_message: null,
      most_recent_coach_question: "How did it go?",
      memory_correction_should_use_prior_user_answer: false,
      short_ack_should_not_reask_question: false,
      memory_packet: {
        recent_exact_thread_text: "Coach: Stretch at lunch?\nUser: did that at lunch",
        recent_exact_thread_72h: thread72h,
        recent_exact_message_count: 2,
        last_outbound_full_body: null,
        last_inbound_full_body: null,
        last_substantive_user_message: null,
        last_substantive_coach_message: null,
        last_5_coach_questions: [],
        last_5_user_answers: [],
        latest_open_question: null,
        latest_answer_after_open_question: null,
        open_question_pending: false,
        open_question_source: "none",
        answer_source: "none",
        projection_used: false,
        latest_open_question_guess: null,
        latest_answer_after_open_question_guess: null,
        do_not_repeat_phrases: [],
        memory_priority_rules: [],
        coaching_memory_summary: null,
        coaching_memory_is_background_only: true,
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
      forbidden_substrings: [],
    },
    suggested_coaching_move: "ack_outcome",
  };
  return { ...base, ...overrides };
}

function minimalDailyFacts(overrides?: Partial<DailyV3RelationshipFacts>): DailyV3RelationshipFacts {
  const thread72h = makeThread72h([
    make72hMessage({ role: "coach", body: "How did yesterday land?", source_table: "sms_send_events" }),
    make72hMessage({ role: "user", body: "Rough start", at: "2026-05-18T10:05:00.000Z" }),
  ]);

  const core: DailyV3RelationshipFacts = {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-05-12",
    user: {
      clerk_user_id: "user_pkt",
      preferred_name: "Alex",
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T09:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_pkt",
      title: "Morning focus",
      behavior_statement: "Two hours of deep work before noon",
      effective_ask: "Two hours of deep work before noon",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: "How did yesterday land?",
      latest_inbound_sms: "Rough start",
      recent_transcript_or_context_block: "Coach: …\nUser: …",
      latest_open_question: null,
      do_not_repeat_hints: [],
      coaching_memory_snippet: "COACHING_MEMORY…",
      recent_pattern_hints: null,
      recent_exact_thread_text: "Coach: How did yesterday land?\nUser: Rough start",
      recent_exact_thread_72h: thread72h,
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: "user_no",
      yes_streak_14d: 1,
      no_count_14d: 2,
      partial_count_14d: 0,
      blocker_preview: "meetings",
      proof_or_milestone_signal: null,
      silence_tier: "none",
      unanswered_checks: 0,
      days_since_last_user_outcome: 1,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    suggested_coaching_move: "ask_completion",
    constraints: {
      max_chars: 300,
      one_sms: true,
      no_raw_title_or_behavior_paste: true,
      no_generic_motivation: true,
      if_unsafe_return_no_send: true,
    },
  };
  return { ...core, ...overrides };
}

function hugePad(label: string, chars: number): string {
  return `${label}:${"x".repeat(chars)}`;
}

describe("buildRelationshipPacketForOpenAI", () => {
  it("includes ordered core sections with recent_exact_thread_72h and stays under budget", () => {
    const facts = minimalInboundFacts({
      thread_freshness: {
        completed_actions: [{ text: "stretch at lunch", evidence: "did that at lunch" }],
        do_not_reask_topics: ["lunch stretch"],
        active_temporal_frame: "today",
        temporal_anchors: ["lunch"],
        recent_user_plan_or_schedule: null,
        recent_user_completion: "did that at lunch",
      },
    });

    const { packet, userPromptJson, meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
    });

    expect(packet.relationship_packet_version).toBe(RELATIONSHIP_PACKET_VERSION);
    expect(RELATIONSHIP_PACKET_VERSION).toBe("1.6");
    expect(packet.recent_exact_thread_72h?.data.messages.some((m) => /did that at lunch/i.test(m.body))).toBe(
      true
    );
    expect(packet.recent_exact_thread_72h?.data.messages[0]?.at).toBeTruthy();
    expect(packet.structured_recent_truth.data.thread_freshness?.do_not_reask_topics).toContain(
      "lunch stretch"
    );
    expect(userPromptJson).toContain("recent_exact_thread_72h");
    expect(userPromptJson.length).toBeLessThanOrEqual(DEFAULT_RELATIONSHIP_PACKET_BUDGET);
    expect(meta.included_thread_window_hours).toBe(72);
  });

  it("preserves thread_freshness when sourceFacts are oversized", () => {
    const hugeMessages = Array.from({ length: 40 }, (_, i) =>
      make72hMessage({
        role: i % 2 === 0 ? "coach" : "user",
        body: i % 2 === 0 ? `Coach Q ${i}?` : hugePad("answer", 400),
        at: new Date(Date.parse("2026-05-18T10:00:00.000Z") + i * 60_000).toISOString(),
      })
    );

    const facts = minimalInboundFacts({
      user: {
        ...minimalInboundFacts().user,
        relationship_profile_summary: hugePad("profile", 8000),
      },
      thread_freshness: {
        completed_actions: [{ text: "PRIORITY_ACTION", evidence: "user said done" }],
        do_not_reask_topics: ["PRIORITY_TOPIC"],
        active_temporal_frame: "tomorrow",
        temporal_anchors: ["tomorrow"],
        recent_user_plan_or_schedule: "early afternoon",
        recent_user_completion: null,
      },
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          recent_exact_thread_72h: makeThread72h(hugeMessages),
        },
      },
      victory_background: {
        active_season_label: "Season Alpha",
        active_season_started_at: null,
        pat_read_strength: hugePad("pat", 3000),
        pat_read_pattern: hugePad("pattern", 3000),
        pat_read_next_move: hugePad("move", 3000),
      },
    });

    const { packet, userPromptJson, meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
      totalCharBudget: 4000,
    });

    expect(userPromptJson).toContain("thread_freshness");
    expect(userPromptJson).toContain("PRIORITY_TOPIC");
    expect(packet.recent_exact_thread_72h?.data.messages.length).toBeGreaterThan(0);
    expect(userPromptJson.length).toBeLessThanOrEqual(4000);
    expect(meta.relationship_packet_truncated).toBe(true);
  });

  it("drops lower_authority before trimming recent_exact_thread_72h messages", () => {
    const messages = [
      ...Array.from({ length: 30 }, (_, i) =>
        make72hMessage({
          role: "coach",
          body: `old line ${i} ${hugePad("o", 200)}`,
          at: new Date(Date.parse("2026-05-18T08:00:00.000Z") + i * 60_000).toISOString(),
        })
      ),
      make72hMessage({
        role: "user",
        body: "RECENT_THREAD_MARKER keep-me",
        at: "2026-05-18T11:59:00.000Z",
      }),
    ];

    const facts = minimalInboundFacts({
      user: {
        ...minimalInboundFacts().user,
        relationship_profile_summary: hugePad("low_auth", 5000),
      },
      victory_background: {
        active_season_label: "Season Beta",
        active_season_started_at: null,
        pat_read_strength: hugePad("30d", 4000),
        pat_read_pattern: hugePad("30d_pat", 4000),
        pat_read_next_move: hugePad("30d_move", 4000),
      },
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          recent_exact_thread_72h: makeThread72h(messages),
        },
      },
    });

    const { packet, meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
      totalCharBudget: 3500,
    });

    expect(packet.lower_authority_background).toBeUndefined();
    expect(
      packet.recent_exact_thread_72h?.data.messages.some((m) => m.body.includes("RECENT_THREAD_MARKER"))
    ).toBe(true);
    expect(meta.truncated_sections).toEqual(
      expect.arrayContaining(["lower_authority_background", "recent_exact_thread_72h"])
    );
    const threadTruncIndex = meta.truncated_sections.indexOf("recent_exact_thread_72h");
    const lowerIndex = meta.truncated_sections.indexOf("lower_authority_background");
    expect(lowerIndex).toBeGreaterThanOrEqual(0);
    if (threadTruncIndex >= 0) {
      expect(lowerIndex).toBeLessThan(threadTruncIndex);
    }
  });

  it("uses legacy recent_exact_thread_text fallback when structured 72h absent", () => {
    const facts = minimalInboundFacts({
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          recent_exact_thread_72h: makeThread72h([]),
          recent_exact_thread_text: "Coach: legacy line\nUser: legacy answer",
        },
      },
    });

    const { packet } = buildRelationshipPacketForOpenAI({ lane: "inbound", sourceFacts: facts });
    expect(packet.recent_exact_thread_72h?.data.legacy_fallback_lines?.some((l) => /legacy answer/.test(l))).toBe(
      true
    );
  });

  it("does not invent proof_saved / can_say_saved_as_proof when hint disallows", () => {
    const facts = minimalInboundFacts({
      v2_accountability: {
        ...minimalInboundFacts().v2_accountability,
        proof_signal: true,
        proof_callout_hint: {
          eligible: true,
          surface: "victory_room",
          reason: "completion",
          instruction: null,
          proof_insert_will_attempt: true,
          proof_callout_claim_saved_allowed: false,
        },
      },
    });

    const { packet, userPromptJson } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
    });

    expect(packet.proof_victory_permission?.data.can_say_saved_as_proof).toBe(false);
    expect(userPromptJson).not.toMatch(/"can_say_saved_as_proof":\s*true/);
  });

  it("handles null conversation_brain in legacy_suggestions_summary", () => {
    const facts = minimalInboundFacts({
      legacy_suggestions: {
        ...minimalInboundFacts().legacy_suggestions,
        conversation_brain: null,
      },
    });

    const { packet } = buildRelationshipPacketForOpenAI({ lane: "inbound", sourceFacts: facts });

    expect(packet.lower_authority_background).toBeDefined();
    expect(packet.lower_authority_background?.data.legacy_suggestions_summary).toMatch(
      /conversation_brain_enabled":false/
    );
  });

  it("user prompt contains no hard-coded final SMS copy", () => {
    const { userPromptJson } = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts(),
    });
    expect(userPromptJson).not.toMatch(/what's the next concrete move/i);
    expect(userPromptJson).toContain("Write JSON only.");
  });
});

describe("buildRelationshipPacketPromptGuidance", () => {
  it("includes authority rules", () => {
    const guidance = buildRelationshipPacketPromptGuidance();
    expect(guidance).toContain("RELATIONSHIP_PACKET_AUTHORITY");
    expect(guidance).toContain("recent_exact_thread_72h");
  });
});
