import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { buildCommitmentChangeInboundFactsFromWave4 } from "@/lib/v3-inbound-relationship-lane";

function baseCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_facts",
    clerk_user_id: "user_facts",
    status: "active",
    behavior_statement: "Phone away at dinner",
    title: "Phone",
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

describe("buildCommitmentChangeInboundFactsFromWave4 — Slice A3", () => {
  it("includes bootstrap candidate preview and server summary", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.9,
      },
      commitment: baseCommitment(),
      effectiveAsk: "Phone away at dinner",
      userMessage: "change my goal to walking after dinner",
      messageSid: "SMfacts1",
      wave4: { pendingApplied: true, pendingKind: "commitment_replace", skipReason: null },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview: "stub",
      bootstrapResult: {
        promoted: true,
        candidatePreview: "walking after dinner",
      },
    });
    expect(f.candidate_new_bar_preview).toBe("walking after dinner");
    expect(f.server_state_transition_summary).toContain("bootstrap:awaiting_confirmation");
    expect(f.pending_resolution_created).toBe(true);
  });

  it("sms_raise_bar_request guardrail forbids claiming goal changed", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: {
        intent: "sms_raise_bar_request",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.85,
      },
      commitment: baseCommitment(),
      effectiveAsk: "Phone away at dinner",
      userMessage: "this goal is too easy",
      messageSid: "SMfacts2",
      wave4: { pendingApplied: true, pendingKind: "commitment_replace", skipReason: null },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview: "stub",
    });
    expect(f.detected_intent_type).toBe("sms_raise_bar_request");
    expect(f.required_meaning_summary).toMatch(/do not claim the goal was raised/i);
    expect(f.required_meaning_summary).toMatch(/written commitment row already changed/);
  });

  it("Slice 2B shell facts ask for new bar and forbid stale clarify wording", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: {
        intent: "sms_change_unspecified",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.9,
      },
      commitment: baseCommitment(),
      effectiveAsk: "Walk 20 minutes after dinner",
      userMessage: "Yes we need to amend or re-state old goals.",
      messageSid: "SMfacts3",
      wave4: { pendingApplied: true, pendingKind: "commitment_replace", skipReason: null },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview: "stub",
      tuShellHandoff: {
        mode: "awaiting_candidate_shell",
        priorGoalChangeAskSatisfied: true,
        staleAskGoalChangeBridgeEligible: true,
      },
    });
    expect(f.pending_resolution_created).toBe(true);
    expect(f.required_meaning_summary).toMatch(/awaiting_candidate shell/i);
    expect(f.required_meaning_summary).toMatch(/new daily bar/i);
    expect(f.required_meaning_summary).toMatch(/has NOT changed yet/i);
    expect(f.forbidden_substrings).toContain("what specific changes");
    expect(f.forbidden_substrings).toContain("changes or adjustments");
  });
});
