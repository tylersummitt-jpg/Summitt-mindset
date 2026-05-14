import { describe, expect, it } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";
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
});
