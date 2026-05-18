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
});
