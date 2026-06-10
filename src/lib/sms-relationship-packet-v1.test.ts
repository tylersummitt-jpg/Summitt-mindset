import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) },
}));

import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  buildWriterUserPromptWithStrategyCard,
  DEFAULT_RELATIONSHIP_PACKET_BUDGET,
  RELATIONSHIP_PACKET_VERSION,
  relationshipObservabilityFromLaneMetadata,
  relationshipPacketMetaForLaneTelemetry,
  stripCardSupersededWriterStrategyHintsFromUserPrompt,
} from "@/lib/sms-relationship-packet-v1";
import {
  buildInboundNormalStrategyCardV1,
  buildStrategyCardContextFromSnapshot,
  strategyCardV1MetaForTelemetry,
  validateAndRepairInboundNormalStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import type { RecentExactThread72hMessage, RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";
import {
  RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
  type RelationshipMemory7dResult,
} from "@/lib/sms-relationship-memory-7d";
import {
  RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
  type RelationshipMemory30dResult,
} from "@/lib/sms-relationship-memory-30d";

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

function makeSampleMemory7d(overrides?: Partial<RelationshipMemory7dResult>): RelationshipMemory7dResult {
  return {
    window_days: RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
    built_at: "2026-05-18T12:00:00.000Z",
    outcome_counts: { yes: 2, no: 1, partial: 0, blockers: 1, checks_sent: 3 },
    wins: [
      {
        summary: "user_yes",
        evidence: "Done two hours",
        at: "2026-05-18T10:00:00.000Z",
        source: "v2_commitment_event:user_yes",
        message_sid: null,
        is_exact_body: true,
      },
    ],
    misses: [
      {
        summary: "user_no",
        evidence: "Missed today",
        at: "2026-05-17T10:00:00.000Z",
        source: "v2_commitment_event:user_no",
        message_sid: null,
        is_exact_body: true,
      },
    ],
    partials: [],
    comebacks: [],
    blockers: [
      {
        summary: "blocker_captured",
        evidence: "Meetings stacked",
        at: "2026-05-16T10:00:00.000Z",
        source: "v2_commitment_event:blocker_captured",
        message_sid: null,
        is_exact_body: true,
      },
    ],
    proof_moments: [],
    open_loops: [],
    direct_answer_history: [],
    context_flags: {},
    meta: { item_count: 3, sources_used: ["v2_commitment_event"] },
    ...overrides,
  };
}

function makeSampleMemory30d(overrides?: Partial<RelationshipMemory30dResult>): RelationshipMemory30dResult {
  return {
    window_days: RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
    built_at: "2026-05-18T12:00:00.000Z",
    commitment_id: "cmt_pkt",
    season: {
      label: "Spring Focus",
      started_at: "2026-01-01T00:00:00Z",
      source: "user_accountability_season",
    },
    outcome_counts_30d: {
      yes: 8,
      no: 3,
      partial: 1,
      blockers: 2,
      checks_sent: 12,
      overlay_activated: 1,
      overlay_declined: 0,
      reactivation_yes: 0,
    },
    recurring_blockers: [
      {
        canonical: "phone_pull",
        evidence_count: 2,
        examples: [
          {
            evidence: "scrolling on phone",
            at: "2026-05-17T10:00:00.000Z",
            source: "v2_commitment_event:blocker_captured:phone_pull",
            message_sid: null,
            commitment_id: "cmt_pkt",
            is_exact_body: true,
          },
        ],
        last_seen_at: "2026-05-18T10:00:00.000Z",
        confidence: "low",
        commitment_id: "cmt_pkt",
      },
    ],
    meaningful_proof: [
      {
        summary: "first clear yes on this bar",
        proof_type: "first_completion",
        evidence: "first clear yes on this bar",
        at: "2026-05-10T10:00:00.000Z",
        source: "v2_commitment_event:proof_moment:user_yes",
        message_sid: null,
        commitment_id: "cmt_pkt",
        is_exact_body: false,
      },
    ],
    adjustments: [],
    goal_changes: [],
    comebacks: [],
    voice_preferences: null,
    pat_read_snapshot: [
      {
        field: "pattern",
        text: "Evening drift",
        source: "v2_victory_pat_read_snapshot",
        is_ai_snapshot: true,
        commitment_id: "cmt_pkt",
      },
    ],
    meta: { item_count: 3, sources_used: ["v2_commitment_event"] },
    ...overrides,
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
        relationship_memory_7d: makeSampleMemory7d(),
        relationship_memory_30d: makeSampleMemory30d(),
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
      one_sms: true,
      no_generic_motivation: true,
      no_quoted_or_truncated_echo_of_inbound: true,
      if_unsafe_return_no_send: true,
      forbidden_substrings: [],
    },
    inbound_meaning: buildInboundMeaningFacts({
      rawInbound: "done",
      classifierEventType: "user_yes",
    }),
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
      relationship_memory_7d: makeSampleMemory7d(),
      relationship_memory_30d: makeSampleMemory30d(),
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

function minimalWeeklyFacts(overrides?: Partial<WeeklyV3OutboundFacts>): WeeklyV3OutboundFacts {
  const thread72h = makeThread72h([
    make72hMessage({ role: "coach", body: "How did the week land?", source_table: "sms_send_events" }),
    make72hMessage({ role: "user", body: "Morning blocks held", at: "2026-05-10T10:05:00.000Z" }),
  ]);

  const core: WeeklyV3OutboundFacts = {
    user: {
      clerk_user_id: "user_weekly_pkt",
      preferred_name: "Jordan",
      timezone: "America/Chicago",
      local_date: "2026-05-10",
      local_time: "12:05",
      sms_engagement_summary: "Replied to 3 checks this week",
    },
    commitment: {
      active_commitment_id: "cmt_w1",
      behavior_statement: "Protect one hour for deep work before noon",
      effective_ask: "Protect one hour for deep work before noon",
      commitment_state: "active_accountability",
      identity_anchor: null,
    },
    thread: {
      latest_outbound_preview: null,
      latest_inbound_preview: null,
      recent_transcript_lines: [],
      recent_exact_thread_text: "Coach: How did the week land?\nUser: Morning blocks held",
      last_outbound_full_body: null,
      last_inbound_full_body: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      latest_open_question: null,
      latest_answer_after_open_question: null,
      open_question_pending: false,
      open_question_source: null,
      answer_source: null,
      projection_used: false,
      memory_packet_used: true,
      recent_exact_message_count: 2,
      do_not_repeat_hints: [],
      coaching_memory_snippet: null,
      memory_priority_rules: [],
      recent_exact_thread_72h: thread72h,
      relationship_memory_7d: makeSampleMemory7d(),
      relationship_memory_30d: makeSampleMemory30d(),
    },
    weekly_proof: {
      week_start: "2026-05-04",
      week_end: "2026-05-10",
      completed_count: 4,
      missed_count: 1,
      partial_count: 0,
      blocker_count: 0,
      proof_moment_hints: ["Showed up after a miss"],
      win_hints: [],
      comeback_hints: [],
      repeated_blocker_hints: [],
      notable_pattern: null,
      silent_week: true,
      rough_week: true,
      strong_week: false,
      planned_pause_week: true,
      old_weekly_proof_body_preview: null,
      deterministic_weekly_body_preview: null,
      legacy_reflection_preview: null,
      legacy_template_preview: null,
    },
    route: {
      route_purpose: "weekly_proof_v2",
      fully_on_v2: true,
      reason_for_send: "sunday_weekly_touchpoint",
      legacy_weekly_branch: false,
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
    expect(RELATIONSHIP_PACKET_VERSION).toBe("1.8");
    expect(packet.relationship_memory_7d?.data.window_days).toBe(7);
    expect(packet.relationship_memory_30d_or_season?.data.window_days).toBe(30);
    expect(packet.recent_exact_thread_72h?.data.messages.some((m) => /did that at lunch/i.test(m.body))).toBe(
      true
    );
    expect(packet.recent_exact_thread_72h?.data.messages[0]?.at).toBeTruthy();
    expect(packet.structured_recent_truth.data.thread_freshness?.do_not_reask_topics).toContain(
      "lunch stretch"
    );
    expect(userPromptJson).toContain("recent_exact_thread_72h");
    expect(userPromptJson).toContain("RELATIONSHIP_SNAPSHOT_V2");
    expect(userPromptJson).toContain("relationship_memory_7d");
    expect(userPromptJson).toContain("relationship_memory_30d_or_season");
    expect(userPromptJson).not.toContain("coaching_summary");
    expect(userPromptJson.length).toBeLessThanOrEqual(DEFAULT_RELATIONSHIP_PACKET_BUDGET);
    expect(meta.included_thread_window_hours).toBe(72);
    expect(meta.included_memory_7d_window_days).toBe(7);
    expect(meta.included_memory_30d_window_days).toBe(30);
  });

  it("includes turn_understanding in structured_recent_truth when facts carry reconciled understanding", () => {
    const facts = minimalInboundFacts();
    const { packet, userPromptJson } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: {
        ...facts,
        turn_understanding: {
          proposal: null,
          reconciled_relationship_meaning: "prior_ask_satisfied",
          reconciled_response_intent: "acknowledge_prior_ask_satisfied",
          reconciled_persistence_decision: "no_outcome_write",
          reconciled_do_not_repeat_asks: ["calendar for tomorrow"],
          last_ask_satisfied: "yes",
          satisfaction_kind: "already_scheduled",
          stale_ask_risk: true,
          confidence: 0.9,
          disagreement_flags: [],
          interpreter_failed_reason: null,
          stale_ask_avoided: true,
          persistence_note: "server persistence unchanged: no_outcome_write",
        },
      },
    });
    expect(packet.structured_recent_truth.data.turn_understanding?.response_intent).toBe(
      "acknowledge_prior_ask_satisfied"
    );
    expect(userPromptJson).toContain("turn_understanding");
  });

  it("daily packet includes satisfied-ask turn_understanding from daily_satisfied_ask_context", () => {
    const { packet, userPromptJson } = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts({
        daily_satisfied_ask_context: {
          has_satisfied_recent_ask: true,
          satisfied_ask_type: "plan_detail",
          do_not_repeat_asks: [
            "let me know if you're ready to put one family connection on the calendar for tomorrow",
          ],
          evidence_preview: "Call Bond about 12PM tomorrow",
          source: "inbound_turn_telemetry",
          occurred_at: "2026-06-04T18:00:00.000Z",
          last_ask_satisfied: "yes",
          stale_ask_risk: true,
          relationship_meaning: "plan_made",
          response_intent: "acknowledge_prior_ask_satisfied",
          prior_question_type: "plan_confirmation",
          outcome_proof_eligible: false,
          persistence_note:
            "Satisfied-ask context only — does not authorize proof, user_yes, or Victory claims without server outcome evidence.",
        },
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          do_not_repeat_hints: ["generic lower authority hint"],
        },
      }),
    });
    expect(packet.structured_recent_truth.data.turn_understanding?.last_ask_satisfied).toBe("yes");
    expect(packet.structured_recent_truth.data.turn_understanding?.do_not_repeat_asks?.[0]).toMatch(
      /family connection on the calendar/i
    );
    expect(packet.structured_recent_truth.data.daily_satisfied_ask_context?.source).toBe(
      "inbound_turn_telemetry"
    );
    expect(packet.structured_recent_truth.data.turn_understanding?.persistence_note).toMatch(
      /does not authorize proof/i
    );
    expect(packet.structured_recent_truth.data.turn_understanding?.authority).toBe(
      "authoritative_current"
    );
    expect(userPromptJson).toContain("daily_satisfied_ask_context");
  });

  it("inbound and daily share the same relationship_memory_30d_or_season shape", () => {
    const memory30d = makeSampleMemory30d();
    const inbound = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_packet: {
            ...minimalInboundFacts().thread.memory_packet!,
            relationship_memory_30d: memory30d,
          },
        },
      }),
    });
    const daily = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts({
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          relationship_memory_30d: memory30d,
        },
      }),
    });

    expect(inbound.packet.relationship_memory_30d_or_season?.data.window_days).toBe(30);
    expect(daily.packet.relationship_memory_30d_or_season?.data.window_days).toBe(30);
    expect(inbound.packet.relationship_memory_30d_or_season?.data.outcome_counts_30d).toEqual(
      daily.packet.relationship_memory_30d_or_season?.data.outcome_counts_30d
    );
    expect(daily.packet.relationship_memory_30d_or_season?.data.runtime_hints?.evolution_pattern_hint).toBeNull();
  });

  it("inbound and daily share the same relationship_memory_7d shape", () => {
    const memory7d = makeSampleMemory7d();
    const inbound = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_packet: {
            ...minimalInboundFacts().thread.memory_packet!,
            relationship_memory_7d: memory7d,
          },
        },
      }),
    });
    const daily = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts({
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          relationship_memory_7d: memory7d,
        },
      }),
    });

    expect(inbound.packet.relationship_memory_7d?.data.window_days).toBe(7);
    expect(daily.packet.relationship_memory_7d?.data.window_days).toBe(7);
    expect(inbound.packet.relationship_memory_7d?.data.outcome_counts).toEqual(
      daily.packet.relationship_memory_7d?.data.outcome_counts
    );
    expect(daily.packet.relationship_memory_7d?.data.context_flags.reentry_active).toBe(false);
  });

  it("trims relationship_memory_30d before relationship_memory_7d and recent_exact_thread_72h", () => {
    const hugeMemory30d = makeSampleMemory30d({
      recurring_blockers: Array.from({ length: 4 }, (_, i) => ({
        canonical: "phone_pull",
        evidence_count: 4,
        examples: [
          {
            evidence: hugePad(`blocker_${i}`, 200),
            at: new Date(Date.parse("2026-05-18T10:00:00.000Z") - i * 60_000).toISOString(),
            source: "v2_commitment_event:blocker_captured:phone_pull",
            message_sid: null,
            commitment_id: "cmt_pkt",
            is_exact_body: false,
          },
        ],
        last_seen_at: "2026-05-18T10:00:00.000Z",
        confidence: "high" as const,
        commitment_id: "cmt_pkt",
      })),
      meta: { item_count: 4, sources_used: ["v2_commitment_event"] },
    });

    const messages = [
      make72hMessage({
        role: "user",
        body: "RECENT_THREAD_MARKER keep-me",
        at: "2026-05-18T11:59:00.000Z",
      }),
    ];

    const facts = minimalInboundFacts({
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          relationship_memory_30d: hugeMemory30d,
          relationship_memory_7d: makeSampleMemory7d(),
          recent_exact_thread_72h: makeThread72h(messages),
        },
      },
    });

    const { packet, meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
      totalCharBudget: 3500,
    });

    expect(
      packet.recent_exact_thread_72h?.data.messages.some((m) => m.body.includes("RECENT_THREAD_MARKER"))
    ).toBe(true);
    expect(meta.truncated_sections).toEqual(expect.arrayContaining(["relationship_memory_30d_or_season"]));
    const mem30Index = meta.truncated_sections.indexOf("relationship_memory_30d_or_season");
    const mem7Index = meta.truncated_sections.indexOf("relationship_memory_7d");
    const threadIndex = meta.truncated_sections.indexOf("recent_exact_thread_72h");
    expect(mem30Index).toBeGreaterThanOrEqual(0);
    if (mem7Index >= 0) expect(mem30Index).toBeLessThan(mem7Index);
    if (threadIndex >= 0 && mem7Index >= 0) expect(mem7Index).toBeLessThan(threadIndex);
  });

  it("trims relationship_memory_7d before recent_exact_thread_72h under budget pressure", () => {
    const hugeMemory7d = makeSampleMemory7d({
      wins: Array.from({ length: 8 }, (_, i) => ({
        summary: "user_yes",
        evidence: hugePad(`win_${i}`, 200),
        at: new Date(Date.parse("2026-05-18T10:00:00.000Z") - i * 60_000).toISOString(),
        source: "v2_commitment_event:user_yes",
        message_sid: null,
        is_exact_body: false,
      })),
      meta: { item_count: 8, sources_used: ["v2_commitment_event"] },
    });

    const messages = [
      make72hMessage({
        role: "user",
        body: "RECENT_THREAD_MARKER keep-me",
        at: "2026-05-18T11:59:00.000Z",
      }),
    ];

    const facts = minimalInboundFacts({
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          relationship_memory_7d: hugeMemory7d,
          relationship_memory_30d: makeSampleMemory30d(),
          recent_exact_thread_72h: makeThread72h(messages),
        },
      },
    });

    const { packet, meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
      totalCharBudget: 3500,
    });

    expect(
      packet.recent_exact_thread_72h?.data.messages.some((m) => m.body.includes("RECENT_THREAD_MARKER"))
    ).toBe(true);
    expect(meta.truncated_sections).toEqual(expect.arrayContaining(["relationship_memory_7d"]));
    const mem7Index = meta.truncated_sections.indexOf("relationship_memory_7d");
    const threadIndex = meta.truncated_sections.indexOf("recent_exact_thread_72h");
    expect(mem7Index).toBeGreaterThanOrEqual(0);
    if (threadIndex >= 0) {
      expect(mem7Index).toBeLessThan(threadIndex);
    }
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
      totalCharBudget: DEFAULT_RELATIONSHIP_PACKET_BUDGET,
    });

    expect(userPromptJson).toContain("thread_freshness");
    expect(userPromptJson).toContain("PRIORITY_TOPIC");
    expect(packet.recent_exact_thread_72h?.data.messages.length).toBeGreaterThan(0);
    expect(userPromptJson).toContain("RELATIONSHIP_SNAPSHOT_V2");
    expect(userPromptJson.length).toBeLessThanOrEqual(DEFAULT_RELATIONSHIP_PACKET_BUDGET);
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
      thread: {
        ...minimalInboundFacts().thread,
        memory_packet: {
          ...minimalInboundFacts().thread.memory_packet!,
          relationship_memory_30d: makeSampleMemory30d({
            pat_read_snapshot: [
              {
                field: "strength",
                text: hugePad("30d_strength", 4000),
                source: "v2_victory_pat_read_snapshot",
                is_ai_snapshot: true,
                commitment_id: "cmt_pkt",
              },
            ],
          }),
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

  it("weekly lane is supported with current_turn flags and core sections", () => {
    const { packet, userPromptJson, meta } = buildRelationshipPacketForOpenAI({
      lane: "weekly",
      sourceFacts: minimalWeeklyFacts(),
    });

    expect(packet.relationship_packet_version).toBe(RELATIONSHIP_PACKET_VERSION);
    expect(packet.current_turn.data.route_kind).toBe("weekly");
    expect(packet.current_turn.data.planned_pause_week).toBe(true);
    expect(packet.current_turn.data.silent_week).toBe(true);
    expect(packet.current_turn.data.rough_week).toBe(true);
    expect(packet.current_turn.data.week_start).toBe("2026-05-04");
    expect(packet.recent_exact_thread_72h?.data.messages.some((m) => /Morning blocks held/i.test(m.body))).toBe(
      true
    );
    expect(packet.relationship_memory_7d?.data.window_days).toBe(7);
    expect(packet.relationship_memory_30d_or_season?.data.window_days).toBe(30);
    expect(packet.canonical_state.data.constraints?.weekly_anti_shame?.anti_shame_required).toBe(true);
    expect(userPromptJson).toContain("RELATIONSHIP_PACKET_V1");
    expect(userPromptJson).not.toContain("WEEKLY_FACTS_JSON");
    expect(meta.included_thread_window_hours).toBe(RECENT_EXACT_THREAD_WINDOW_HOURS);
    expect(meta.included_memory_7d_window_days).toBe(RELATIONSHIP_MEMORY_7D_WINDOW_DAYS);
    expect(meta.included_memory_30d_window_days).toBe(RELATIONSHIP_MEMORY_30D_WINDOW_DAYS);
  });

  it("weekly packet trims relationship_memory_30d before thread under budget pressure", () => {
    const hugeMemory30d = makeSampleMemory30d({
      recurring_blockers: Array.from({ length: 4 }, (_, i) => ({
        canonical: "phone_pull",
        evidence_count: 4,
        examples: [
          {
            evidence: hugePad(`weekly_blocker_${i}`, 200),
            at: new Date(Date.parse("2026-05-18T10:00:00.000Z") - i * 60_000).toISOString(),
            source: "v2_commitment_event:blocker_captured:phone_pull",
            message_sid: null,
            commitment_id: "cmt_w1",
            is_exact_body: false,
          },
        ],
        last_seen_at: "2026-05-18T10:00:00.000Z",
        confidence: "high" as const,
        commitment_id: "cmt_w1",
      })),
      meta: { item_count: 4, sources_used: ["v2_commitment_event"] },
    });

    const { packet, meta } = buildRelationshipPacketForOpenAI({
      lane: "weekly",
      sourceFacts: minimalWeeklyFacts({
        thread: {
          ...minimalWeeklyFacts().thread,
          relationship_memory_30d: hugeMemory30d,
        },
      }),
      totalCharBudget: 3500,
    });

    expect(
      packet.recent_exact_thread_72h?.data.messages.some((m) => /Morning blocks held/i.test(m.body))
    ).toBe(true);
    expect(meta.truncated_sections).toEqual(expect.arrayContaining(["relationship_memory_30d_or_season"]));
  });

  it("passes commitmentRow into row-authoritative active_pending_state for inbound", () => {
    const commitmentRow = {
      id: "cmt_row",
      clerk_user_id: "user_1",
      status: "active",
      behavior_statement: "Deep work",
      title: "Focus",
      success_criteria: null,
      blocker_capture_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      blocker_capture_after_event: "user_no",
      adaptive_ask_text: null,
      adaptive_ask_active_from: null,
      adaptive_ask_expires_at: null,
      adaptive_proposal_text: null,
      adaptive_proposal_created_at: null,
      adaptive_proposal_expires_at: null,
      accountability_phase: "active_accountability",
      reactivation_entered_at: null,
      reactivation_last_sent_at: null,
      reactivation_entry_reason_code: null,
      refresh_session: { step: "identity_first" },
      commitment_refresh_last_prompted_at: null,
      pending_resolution_kind: null,
      pending_resolution_created_at: null,
      pending_resolution_expires_at: null,
      pending_resolution_payload: null,
      updated_at: null,
      started_at: null,
    };

    const { snapshotV2, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: minimalInboundFacts(),
      commitmentRow,
    });

    expect(snapshotV2.active_pending_state.items.some((i) => i.kind === "blocker_capture")).toBe(true);
    expect(snapshotV2.active_pending_state.items.some((i) => i.kind === "refresh_session")).toBe(true);
    expect(snapshotV2Meta.active_pending_state_has_commitment_row).toBe(true);
    expect(snapshotV2Meta.row_authoritative_pending_kinds).toContain("blocker_capture");
    expect(snapshotV2Meta.row_authoritative_pending_kinds).toContain("refresh_session");
  });

  it("daily snapshot uses commitment row telemetry when row provided", () => {
    const row = {
      id: "cmt_daily",
      clerk_user_id: "user_1",
      status: "active",
      behavior_statement: "Walk",
      title: "Walk",
      success_criteria: null,
      blocker_capture_expires_at: null,
      blocker_capture_after_event: null,
      adaptive_ask_text: null,
      adaptive_ask_active_from: null,
      adaptive_ask_expires_at: null,
      adaptive_proposal_text: null,
      adaptive_proposal_created_at: null,
      adaptive_proposal_expires_at: null,
      accountability_phase: "active_accountability",
      reactivation_entered_at: null,
      reactivation_last_sent_at: null,
      reactivation_entry_reason_code: null,
      refresh_session: { step: "commitment" },
      commitment_refresh_last_prompted_at: null,
      pending_resolution_kind: null,
      pending_resolution_created_at: null,
      pending_resolution_expires_at: null,
      pending_resolution_payload: null,
      updated_at: null,
      started_at: null,
    };

    const { snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts(),
      commitmentRow: row,
    });

    expect(snapshotV2Meta.active_pending_state_has_commitment_row).toBe(true);
    expect(snapshotV2Meta.row_authoritative_pending_kinds).toContain("refresh_session");
  });
});

describe("relationshipObservabilityFromLaneMetadata", () => {
  it("extracts packet and repair keys for SQL observability", () => {
    const { meta, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts(),
    });
    const obs = relationshipObservabilityFromLaneMetadata({
      ...relationshipPacketMetaForLaneTelemetry(meta, snapshotV2Meta),
      repair_snapshot_kind: "thread_freshness",
      repair_snapshot_version: "1.0",
      repair_snapshot_chars: 1200,
      repair_snapshot_truncated: false,
      thread_freshness_repair_succeeded: true,
      lane_stage: "post_validate_repaired",
      route_purpose: "standard_check",
    });
    expect(obs.relationship_packet_version).toBe(RELATIONSHIP_PACKET_VERSION);
    expect(obs.relationship_packet_truncated).toBeDefined();
    expect(obs.included_thread_message_count).toBeDefined();
    expect(obs.included_thread_window_hours).toBeDefined();
    expect(obs.repair_snapshot_kind).toBe("thread_freshness");
    expect(obs.repair_snapshot_repair_succeeded).toBe(true);
    expect(obs.lane_stage).toBe("post_validate_repaired");
  });

  it("includes open-loop snapshot telemetry counts and sources without question bodies", () => {
    const { meta, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_packet: {
            ...minimalInboundFacts().thread.memory_packet!,
            open_question_pending: true,
            latest_open_question: "Did you protect focus today?",
          },
        },
      }),
    });
    expect(snapshotV2Meta.open_loop_count).toBeDefined();
    expect(snapshotV2Meta.satisfied_ask_count).toBeDefined();
    expect(snapshotV2Meta.do_not_repeat_ask_count).toBeDefined();
    expect(snapshotV2Meta.recent_unanswered_question_count).toBeDefined();
    expect(Array.isArray(snapshotV2Meta.open_loops_sources)).toBe(true);

    const laneMeta = relationshipPacketMetaForLaneTelemetry(meta, snapshotV2Meta);
    const obs = relationshipObservabilityFromLaneMetadata(laneMeta);
    expect(obs.open_loop_count).toBe(snapshotV2Meta.open_loop_count);
    expect(obs.satisfied_ask_count).toBe(snapshotV2Meta.satisfied_ask_count);
    expect(obs.do_not_repeat_ask_count).toBe(snapshotV2Meta.do_not_repeat_ask_count);
    expect(obs.recent_unanswered_question_count).toBe(snapshotV2Meta.recent_unanswered_question_count);
    expect(obs.open_loops_sources).toEqual(snapshotV2Meta.open_loops_sources);
    expect(obs.open_loops_truncated).toBe(snapshotV2Meta.open_loops_truncated);
    expect(JSON.stringify(obs)).not.toMatch(/Did you protect focus today/i);
  });

  it("includes proof permission snapshot telemetry counts and sources without evidence quotes", () => {
    const { meta, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: minimalInboundFacts({
        v2_accountability: {
          ...minimalInboundFacts().v2_accountability,
          proof_callout_hint: {
            eligible: true,
            surface: "victory_room",
            reason: "first_completion",
            instruction: null,
            proof_callout_claim_saved_allowed: false,
          },
        },
      }),
    });

    expect(snapshotV2Meta.proof_permission_emitted).toBe(true);
    expect(snapshotV2Meta.can_claim_proof).toBeDefined();
    expect(snapshotV2Meta.can_reference_victory_room).toBeDefined();
    expect(snapshotV2Meta.proof_evidence_count).toBeDefined();
    expect(Array.isArray(snapshotV2Meta.proof_permission_sources)).toBe(true);

    const laneMeta = relationshipPacketMetaForLaneTelemetry(meta, snapshotV2Meta);
    const obs = relationshipObservabilityFromLaneMetadata(laneMeta);

    expect(obs.proof_permission_emitted).toBe(true);
    expect(obs.can_claim_completion).toBe(snapshotV2Meta.can_claim_completion);
    expect(obs.can_claim_miss).toBe(snapshotV2Meta.can_claim_miss);
    expect(obs.can_claim_partial).toBe(snapshotV2Meta.can_claim_partial);
    expect(obs.can_claim_proof).toBe(snapshotV2Meta.can_claim_proof);
    expect(obs.can_reference_victory_room).toBe(snapshotV2Meta.can_reference_victory_room);
    expect(obs.proof_evidence_count).toBe(snapshotV2Meta.proof_evidence_count);
    expect(obs.proof_permission_sources).toEqual(snapshotV2Meta.proof_permission_sources);
    expect(obs.proof_permission_has_legacy_v1).toBe(snapshotV2Meta.proof_permission_has_legacy_v1);

    const obsJson = JSON.stringify(obs);
    expect(obsJson).not.toMatch(/first_completion/i);
    expect(obsJson).not.toMatch(/"quote"/i);
    expect(obsJson).not.toMatch(/Did you protect focus/i);
  });

  it("includes no-send silence snapshot telemetry counts and tier without question bodies", () => {
    const { meta, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "daily",
      sourceFacts: minimalDailyFacts(),
    });

    expect(snapshotV2Meta.no_send_silence_history_emitted).toBe(true);
    expect(snapshotV2Meta.silence_tier).toBeDefined();
    expect(typeof snapshotV2Meta.recent_questions_not_delivered_count).toBe("number");
    expect(typeof snapshotV2Meta.recent_questions_delivered_unanswered_count).toBe("number");

    const laneMeta = relationshipPacketMetaForLaneTelemetry(meta, snapshotV2Meta);
    const obs = relationshipObservabilityFromLaneMetadata(laneMeta);

    expect(obs.no_send_silence_history_emitted).toBe(true);
    expect(obs.silence_tier).toBe(snapshotV2Meta.silence_tier);
    expect(obs.recent_questions_not_delivered_count).toBe(
      snapshotV2Meta.recent_questions_not_delivered_count
    );
    expect(obs.recent_questions_delivered_unanswered_count).toBe(
      snapshotV2Meta.recent_questions_delivered_unanswered_count
    );

    const obsJson = JSON.stringify(obs);
    expect(obsJson).not.toMatch(/"quote"/i);
    expect(obsJson).not.toMatch(/no_send_reason/i);
    expect(obsJson).not.toMatch(/skipped_no_safe_v3_voice/i);
  });

  it("returns empty object for null/undefined metadata", () => {
    expect(relationshipObservabilityFromLaneMetadata(null)).toEqual({});
    expect(relationshipObservabilityFromLaneMetadata(undefined)).toEqual({});
  });

  it("includes Strategy Card telemetry keys without SMS body or user text", () => {
    const facts = minimalInboundFacts();
    const { meta, snapshotV2, snapshotV2Meta } = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
    });
    const ctx = buildStrategyCardContextFromSnapshot({ facts, snapshot: snapshotV2 });
    const validated = validateAndRepairInboundNormalStrategyCardV1(
      buildInboundNormalStrategyCardV1({ ctx }),
      ctx
    );
    const obs = relationshipObservabilityFromLaneMetadata({
      ...relationshipPacketMetaForLaneTelemetry(meta, snapshotV2Meta),
      ...strategyCardV1MetaForTelemetry(validated),
    });
    expect(obs.strategy_card_version).toBe("1.0");
    expect(obs.strategy_card_surface).toBe("inbound");
    expect(obs.strategy_card_route_kind).toBe("normal_inbound_reply");
    expect(obs.strategy_card_move_type).toBeDefined();
    expect(obs.strategy_card_can_claim_proof).toBeDefined();
    expect(obs.strategy_card_can_reference_victory_room).toBeDefined();
    expect(obs.strategy_card_legacy_suggested_coaching_move).toBeDefined();
    expect(JSON.stringify(obs)).not.toMatch(/two hours deep work before noon/i);
    expect(JSON.stringify(obs)).not.toMatch(/Nice — what made/i);
  });
});

describe("stripCardSupersededWriterStrategyHintsFromUserPrompt (Phase 4.9a)", () => {
  it("strips suggested_coaching_move from inbound writer prompt when card active", () => {
    const facts = minimalInboundFacts();
    const built = buildRelationshipPacketForOpenAI({ lane: "inbound", sourceFacts: facts });
    expect(built.userPromptJson).toMatch(/"suggested_coaching_move":/);

    const stripped = stripCardSupersededWriterStrategyHintsFromUserPrompt(built.userPromptJson, {
      lane: "inbound",
    });
    expect(stripped.stripped_fields).toContain("suggested_coaching_move");
    expect(stripped.prompt).not.toMatch(/"suggested_coaching_move":/);
    expect(stripped.prompt).toContain("RELATIONSHIP_SNAPSHOT_V2");
    expect(stripped.prompt).toContain("route_purpose");
  });

  it("strips server_strategy from daily writer prompt when card active", () => {
    const facts = minimalDailyFacts();
    const built = buildRelationshipPacketForOpenAI({ lane: "daily", sourceFacts: facts });
    expect(built.userPromptJson).toMatch(/"server_strategy":/);

    const stripped = stripCardSupersededWriterStrategyHintsFromUserPrompt(built.userPromptJson, {
      lane: "daily",
    });
    expect(stripped.stripped_fields).toContain("server_strategy");
    expect(stripped.prompt).not.toMatch(/"server_strategy":/);
    expect(stripped.prompt).toContain("route_kind");
    expect(stripped.prompt).toContain("daily_purpose");
  });

  it("weekly lane strip is a no-op for move hints", () => {
    const facts = minimalWeeklyFacts();
    const built = buildRelationshipPacketForOpenAI({ lane: "weekly", sourceFacts: facts });
    const stripped = stripCardSupersededWriterStrategyHintsFromUserPrompt(built.userPromptJson, {
      lane: "weekly",
    });
    expect(stripped.stripped_fields).toEqual([]);
    expect(stripped.prompt).toContain("weekly_week_summary");
  });

  it("buildWriterUserPromptWithStrategyCard appends STRATEGY_CARD_V1 after strip", () => {
    const facts = minimalInboundFacts();
    const built = buildRelationshipPacketForOpenAI({ lane: "inbound", sourceFacts: facts });
    const card = '{"move":{"type":"ask_blocker"}}';
    const out = buildWriterUserPromptWithStrategyCard({
      userPromptJson: built.userPromptJson,
      strategyCardAppendix: `STRATEGY_CARD_V1 (primary coaching move — follow exactly; do not invent a different move):\n${card}`,
      stripWhenCardActive: { lane: "inbound" },
    });
    expect(out.prompt).toContain("STRATEGY_CARD_V1");
    expect(out.prompt).not.toMatch(/"suggested_coaching_move":/);
    expect(out.stripped_fields).toContain("suggested_coaching_move");
  });
});

describe("buildRelationshipPacketPromptGuidance", () => {
  it("includes snapshot v2 authority rules", () => {
    const guidance = buildRelationshipPacketPromptGuidance();
    expect(guidance).toContain("RELATIONSHIP_SNAPSHOT_V2_AUTHORITY");
  });

  it("includes authority rules", () => {
    const guidance = buildRelationshipPacketPromptGuidance();
    expect(guidance).toContain("RELATIONSHIP_PACKET_AUTHORITY");
    expect(guidance).toContain("recent_exact_thread_72h");
    expect(guidance).toContain("relationship_memory_7d");
    expect(guidance).toContain("relationship_memory_30d_or_season");
    expect(guidance).toContain("relationship_memory_7d beats relationship_memory_30d_or_season");
    expect(guidance).toContain("continuity only");
    expect(guidance).toContain("is_ai_snapshot");
  });
});
