import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";
import {
  MEMORY_PRIORITY_RULES,
  slimMemoryPacketForFacts,
} from "@/lib/sms-relationship-memory-packet";
import { buildWeeklyV3OutboundFactsForV2WeeklyProof } from "@/lib/weekly-sms-v2-weekly-lane-facts";

function commitment(): ActiveV2CommitmentRow {
  return {
    id: "c1",
    clerk_user_id: "u1",
    status: "active",
    behavior_statement: "Morning hour",
    title: "Morning hour",
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
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
  };
}

function packBase(overrides?: Partial<V2WeeklyProofPack>): V2WeeklyProofPack {
  const p: V2WeeklyProofPack = {
    week_start: "2026-05-04",
    week_end: "2026-05-10",
    yes_count: 4,
    no_count: 1,
    partial_count: 1,
    check_sent_count: 5,
    blocker_count: 1,
    response_count: 6,
    silent_week: false,
    comeback_after_miss: false,
    blocker_preview_short: "meetings",
    effective_ask_preview: "Morning hour",
    coaching_summary_short: "Prefers AM",
    preferred_name: "Alex",
    identity_anchor_short: null,
    weekly_evolution_coaching_line: null,
    proof_moment_hints: ["Logged early Tuesday"],
    pattern_events_newest_first: [],
  };
  return { ...p, ...overrides };
}

describe("buildWeeklyV3OutboundFactsForV2WeeklyProof", () => {
  it("maps pack + commitment into weekly_proof_v2 facts", () => {
    const localNow = new Date("2026-05-10T17:00:00.000Z");
    const conv: V2SmsConversationContextPack = {
      recentTranscriptLines: ["Coach: Test?", "User: Ok"],
      lastOutboundPreview: "Test?",
      lastInboundPreview: "Ok",
      recentOutcomeSummary: {
        yesCount7d: 4,
        noCount7d: 1,
        partialCount7d: 0,
        blockerCount7d: 0,
        checkSentCount7d: 3,
      },
      recentRepairOrClarification: null,
      recentBlockerPattern: "afternoon drift",
      proofHighlight: null,
      comebackSignal: null,
      pendingStateSummary: null,
      safeProfileSummary: null,
      sensitiveContextAvailableButNotQuotable: false,
      evolutionRecommendationSummary: null,
      evolutionRecommendedAction: null,
      promptBlock: "",
      meta: {
        sms_context_pack_used: true,
        transcript_line_count: 2,
        recent_event_count: 0,
        proof_highlight_used: false,
        blocker_pattern_used: true,
      },
    };
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow,
      conv,
      weeklySmsThreadAppend: "Coach: Hi | User: Hey",
      oldWeeklyProofBodyPreview: "OLD PROOF BODY",
      deterministicWeeklyBodyPreview: "DET BODY",
    });
    expect(f.route.route_purpose).toBe("weekly_proof_v2");
    expect(f.route.legacy_weekly_branch).toBe(false);
    expect(f.weekly_proof.completed_count).toBe(4);
    expect(f.weekly_proof.old_weekly_proof_body_preview).toContain("OLD PROOF");
    expect(f.thread.recent_transcript_lines.length).toBeGreaterThan(0);
  });

  it("includes victory_background when provided", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      victoryBackground: {
        active_season_label: "Spring",
        active_season_started_at: null,
        pat_read_strength: "Kept the edge",
        pat_read_pattern: null,
        pat_read_next_move: null,
      },
    });
    expect(f.victory_background?.active_season_label).toBe("Spring");
    expect(f.victory_background?.pat_read_strength).toBe("Kept the edge");
  });

  it("includes pat_principles in victory_background when provided", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      victoryBackground: {
        active_season_label: null,
        active_season_started_at: null,
        pat_read_strength: null,
        pat_read_pattern: null,
        pat_read_next_move: null,
        pat_principles: {
          focus_next_title: "Discipline Yourself",
          focus_next_text: "One honest morning block.",
          living_well_title: null,
          living_well_text: null,
        },
      },
    });
    expect(f.victory_background?.pat_principles?.focus_next_title).toBe("Discipline Yourself");
  });

  it("omits victory_background when not provided", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.victory_background).toBeUndefined();
  });

  it("does not add season summary fields to weekly facts", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      victoryBackground: {
        active_season_label: "Spring",
        active_season_started_at: null,
        pat_read_strength: null,
        pat_read_pattern: null,
        pat_read_next_move: null,
        pat_principles: {
          focus_next_title: "Work Smart",
          focus_next_text: "Adjust once.",
          living_well_title: null,
          living_well_text: null,
        },
      },
    });
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/season_summary/i);
  });

  it("uses projection-backed open question/answer when memory packet provided (M2B-6)", () => {
    const localNow = new Date("2026-05-10T17:00:00.000Z");
    const conv: V2SmsConversationContextPack = {
      recentTranscriptLines: ["Coach: Transcript guess?", "User: Old answer"],
      lastOutboundPreview: "Transcript guess?",
      lastInboundPreview: "Old answer",
      recentOutcomeSummary: {
        yesCount7d: 1,
        noCount7d: 0,
        partialCount7d: 0,
        blockerCount7d: 0,
        checkSentCount7d: 1,
      },
      recentRepairOrClarification: null,
      recentBlockerPattern: null,
      proofHighlight: null,
      comebackSignal: null,
      pendingStateSummary: null,
      safeProfileSummary: null,
      sensitiveContextAvailableButNotQuotable: false,
      evolutionRecommendationSummary: null,
      evolutionRecommendedAction: null,
      promptBlock: "",
      meta: {
        sms_context_pack_used: true,
        transcript_line_count: 2,
        recent_event_count: 0,
        proof_highlight_used: false,
        blocker_pattern_used: false,
      },
    };
    const packet = slimMemoryPacketForFacts({
      clerk_user_id: "u1",
      commitment_id: "c1",
      behavior_statement: "Dictate stories",
      effective_ask: "Dictate stories",
      accountability_phase: "active_accountability",
      pending_resolution_summary: null,
      overlay_active: false,
      recent_outcomes_summary: {
        yes_7d: 0,
        no_7d: 0,
        partial_7d: 0,
        blockers_7d: 0,
        checks_sent_7d: 0,
        latest_blocker_preview: null,
        latest_proof_hint: null,
      },
      coaching_memory_summary: null,
      coaching_memory_is_background_only: true,
      relationship_profile_summary: null,
      recent_exact_messages: [],
      recent_exact_thread_text:
        "Coach: What story will you dictate today?\nUser: Sunday School, farm, songs Mother sang",
      last_outbound_full_body: "What story will you dictate today?",
      last_inbound_full_body: "Sunday School, farm, songs Mother sang",
      last_substantive_user_message: "Sunday School, farm, songs Mother sang",
      last_substantive_coach_message: "What story will you dictate today?",
      last_5_coach_questions: [
        {
          text: "What story will you dictate today?",
          asked_at: "2026-05-10T10:00:00.000Z",
          source_table: "sms_inbound_coach_jobs",
          is_preview: false,
        },
      ],
      last_5_user_answers: [
        {
          text: "Sunday School, farm, songs Mother sang",
          answered_at: "2026-05-10T11:00:00.000Z",
          source_table: "sms_inbound_coach_jobs",
        },
      ],
      latest_open_question_guess: "Transcript guess?",
      latest_answer_after_open_question_guess: "Old answer",
      latest_open_question: "What story will you dictate today?",
      latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
      open_question_pending: false,
      open_question_source: "projection",
      answer_source: "projection",
      do_not_repeat_phrases: [{ kind: "projection_dnr", phrase: "What story will you dictate today?" }],
      memory_priority_rules: [...MEMORY_PRIORITY_RULES],
      meta: {
        message_count: 2,
        thread_text_capped: false,
        sources_used: ["sms_inbound_coach_jobs"],
        built_at: localNow.toISOString(),
        projection_used: true,
        projection_load_failed: false,
      },
    });
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Dictate stories",
      pack: packBase(),
      timezone: "UTC",
      localNow,
      conv,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "OLD",
      deterministicWeeklyBodyPreview: "DET",
      relationshipMemoryPacket: packet,
    });
    expect(f.thread.memory_packet_used).toBe(true);
    expect(f.thread.projection_used).toBe(true);
    expect(f.thread.latest_open_question).toBe("What story will you dictate today?");
    expect(f.thread.latest_answer_after_open_question).toBe("Sunday School, farm, songs Mother sang");
    expect(f.thread.recent_exact_thread_text).toContain("Sunday School");
    expect(f.thread.open_question_source).toBe("projection");
  });

  it("does not set notable_pattern from a single blocker preview", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({ blocker_count: 1, blocker_preview_short: "late night TV" }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.notable_pattern).toBeNull();
  });

  it("uses gentle pattern line for notable_pattern when medium+ recurrence", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        blocker_count: 2,
        blocker_preview_short: "late night",
        pattern_events_newest_first: [
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 3 * 86400000).toISOString(),
            payload_json: { message: "up late again" },
          },
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 8 * 86400000).toISOString(),
            payload_json: { message: "late night could not sleep" },
          },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.notable_pattern).toContain("Late nights");
    expect(f.weekly_proof.notable_pattern).not.toMatch(/TV|sleep/i);
  });

  it("includes planned interruption fields when loader row passed", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({ silent_week: true, yes_count: 0, response_count: 0 }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      plannedInterruption: {
        occurredAt: "2026-05-08T12:00:00.000Z",
        memorySignal: {
          planned_interruption: true,
          reason_category: "vacation",
          resume_hint: "next week",
          confidence: "high",
        },
      },
    });
    expect(f.commitment.planned_interruption_active).toBe(true);
    expect(f.commitment.planned_interruption_reason_category).toBe("vacation");
    expect(f.commitment.planned_interruption_resume_hint).toBe("next week");
    expect(f.weekly_proof.planned_pause_week).toBe(true);
  });

  it("keeps proof counts during planned interruption", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        yes_count: 2,
        no_count: 1,
        proof_moment_hints: ["Logged early Tuesday", "Third hint"],
      }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      plannedInterruption: {
        occurredAt: "2026-05-08T12:00:00.000Z",
        memorySignal: {
          planned_interruption: true,
          reason_category: "illness",
          resume_hint: null,
          confidence: "high",
        },
      },
    });
    expect(f.weekly_proof.completed_count).toBe(2);
    expect(f.weekly_proof.missed_count).toBe(1);
    expect(f.weekly_proof.proof_moment_hints).toHaveLength(2);
    expect(f.weekly_proof.proof_moment_hints[0]).toBe("Logged early Tuesday");
  });

  it("caps proof_moment_hints to max 2", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        proof_moment_hints: ["One", "Two", "Three", "Four"],
      }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.proof_moment_hints).toEqual(["One", "Two"]);
  });

  it("does not populate repeated_blocker_hints with raw blocker preview", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        blocker_count: 3,
        blocker_preview_short: "late night TV binge",
      }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.repeated_blocker_hints).toEqual([]);
    expect(JSON.stringify(f.weekly_proof)).not.toContain("late night TV");
  });

  it("suppresses rough_week shame framing during planned interruption", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({ silent_week: true, response_count: 0, check_sent_count: 5 }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      plannedInterruption: {
        occurredAt: "2026-05-08T12:00:00.000Z",
        memorySignal: {
          planned_interruption: true,
          reason_category: "vacation",
          resume_hint: "Monday",
          confidence: "high",
        },
      },
    });
    expect(f.weekly_proof.silent_week).toBe(true);
    expect(f.weekly_proof.rough_week).toBe(false);
    expect(f.weekly_proof.planned_pause_week).toBe(true);
  });

  it("legacy thread facts default open_question_pending false without memory packet", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase(),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.thread.memory_packet_used).toBe(false);
    expect(f.thread.open_question_pending).toBe(false);
  });

  it("does not use weekly_evolution_coaching_line as notable_pattern", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        weekly_evolution_coaching_line:
          "The pattern may be telling us the bar needs to get clearer next week",
        blocker_count: 1,
      }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.notable_pattern).toBeNull();
    expect(f.weekly_proof.notable_pattern ?? "").not.toContain("clearer next week");
  });

  it("includes goal_adjustment_* when helper returns a non-keep move", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        pattern_events_newest_first: [
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 2 * 86400000).toISOString(),
            payload_json: { message: "couldn't start" },
          },
          {
            event_type: "user_no",
            occurred_at: new Date(now - 3 * 86400000).toISOString(),
            payload_json: {},
          },
          {
            event_type: "user_no",
            occurred_at: new Date(now - 5 * 86400000).toISOString(),
            payload_json: {},
          },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.commitment.goal_adjustment_move).toBeDefined();
    expect(f.commitment.goal_adjustment_move).not.toBe("keep");
    expect(f.commitment.goal_adjustment_confidence).toBeDefined();
    expect(f.commitment.goal_adjustment_requires_confirmation).toBe(true);
  });

  it("planned_interruption_active forces pause_cadence over shrink_temporary", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        no_count: 4,
        yes_count: 0,
        response_count: 4,
        pattern_events_newest_first: [
          { event_type: "user_no", occurred_at: new Date(now - 1 * 86400000).toISOString() },
          { event_type: "user_no", occurred_at: new Date(now - 2 * 86400000).toISOString() },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
      plannedInterruption: {
        occurredAt: "2026-05-08T12:00:00.000Z",
        memorySignal: {
          planned_interruption: true,
          reason_category: "vacation",
          resume_hint: "next week",
          confidence: "high",
        },
      },
    });
    expect(f.commitment.goal_adjustment_move).toBe("pause_cadence");
    expect(f.commitment.planned_interruption_active).toBe(true);
    expect(f.commitment.goal_adjustment_move).not.toBe("shrink_temporary");
  });

  it("does not set raise_bar from yes streak alone without helper criteria", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const yesEvents = Array.from({ length: 6 }, (_, i) => ({
      event_type: "user_yes" as const,
      occurred_at: new Date(now - (i + 1) * 86400000).toISOString(),
      payload_json: {},
    }));
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        yes_count: 6,
        no_count: 0,
        response_count: 6,
        pattern_events_newest_first: yesEvents,
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.commitment.goal_adjustment_move).not.toBe("raise_bar");
  });

  it("shrink_temporary facts do not add overlay or contract proposal fields", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        pattern_events_newest_first: [
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 2 * 86400000).toISOString(),
            payload_json: { message: "avoidance" },
          },
          { event_type: "user_no", occurred_at: new Date(now - 3 * 86400000).toISOString() },
          { event_type: "user_no", occurred_at: new Date(now - 5 * 86400000).toISOString() },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/contract_proposal/i);
    expect(json).not.toMatch(/binding_text_verbatim/i);
    expect(json).not.toMatch(/required_reply_semantics/i);
    if (f.commitment.goal_adjustment_move === "shrink_temporary") {
      expect(f.commitment.goal_adjustment_compatible_flow).toBe("overlay");
      expect(f.commitment.goal_adjustment_requires_confirmation).toBe(true);
    }
  });

  it("omits goal_adjustment fields when helper returns bare keep", () => {
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({ pattern_events_newest_first: [], yes_count: 0, no_count: 0, response_count: 0 }),
      timezone: "UTC",
      localNow: new Date("2026-05-10T17:00:00.000Z"),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.commitment.goal_adjustment_move).toBeUndefined();
    expect(f.commitment.goal_adjustment_mention_allowed).toBeUndefined();
  });

  it("suppresses goal_adjustment_mention_allowed when proof_moment_hints present", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        proof_moment_hints: ["Logged early Tuesday"],
        pattern_events_newest_first: [
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 2 * 86400000).toISOString(),
            payload_json: { message: "work meetings" },
          },
          { event_type: "user_no", occurred_at: new Date(now - 4 * 86400000).toISOString() },
          { event_type: "user_no", occurred_at: new Date(now - 6 * 86400000).toISOString() },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    if (f.commitment.goal_adjustment_move && f.commitment.goal_adjustment_move !== "keep") {
      expect(f.commitment.goal_adjustment_mention_allowed).toBe(false);
    }
    expect(f.weekly_proof.repeated_blocker_hints).toEqual([]);
  });

  it("notable_pattern still uses pattern helper only with goal adjustment present", () => {
    const now = new Date("2026-05-10T17:00:00.000Z").getTime();
    const f = buildWeeklyV3OutboundFactsForV2WeeklyProof({
      clerkUserId: "u1",
      commitment: commitment(),
      effectiveAsk: "Morning hour",
      pack: packBase({
        blocker_count: 2,
        weekly_evolution_coaching_line: "The bar may need to get clearer",
        pattern_events_newest_first: [
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 3 * 86400000).toISOString(),
            payload_json: { message: "up late again" },
          },
          {
            event_type: "blocker_captured",
            occurred_at: new Date(now - 8 * 86400000).toISOString(),
            payload_json: { message: "late night could not sleep" },
          },
        ],
      }),
      timezone: "UTC",
      localNow: new Date(now),
      conv: null,
      weeklySmsThreadAppend: null,
      oldWeeklyProofBodyPreview: "",
      deterministicWeeklyBodyPreview: "",
    });
    expect(f.weekly_proof.notable_pattern).toContain("Late nights");
    expect(f.weekly_proof.notable_pattern).not.toContain("clearer");
  });
});
