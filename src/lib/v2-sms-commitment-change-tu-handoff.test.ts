import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { ReconciledGoalChangeIntent } from "@/lib/openai-relationship-turn-understanding-v1";
import {
  deriveIntentPackFromReconciledGoalChange,
  evaluateTuGoalChangePendingHandoff,
  shouldOpenTuGoalChangePendingHandoff,
  validateTuProposedGoalBarText,
} from "@/lib/v2-sms-commitment-change";

function baseCommitment(
  overrides: Partial<ActiveV2CommitmentRow> = {}
): ActiveV2CommitmentRow {
  return {
    id: "c1",
    clerk_user_id: "u1",
    status: "active",
    behavior_statement: "Walk 20 minutes after dinner",
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
    accountability_phase: "active",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-06-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ActiveV2CommitmentRow;
}

function tuIntent(
  overrides: Partial<ReconciledGoalChangeIntent> = {}
): ReconciledGoalChangeIntent {
  return {
    authoritative: true,
    detected: true,
    adjustment_type: "replace",
    source: "user_requested",
    requires_confirmation: true,
    proposed_new_goal_text: "run 3 miles every day",
    evidence_quote: "run 3 miles every day",
    confidence: "high",
    goal_change_not_outcome_write: true,
    goal_change_no_state_mutation_without_confirmation: true,
    ...overrides,
  };
}

describe("TU concrete goal-change → Wave4 handoff gate (Slice 2A)", () => {
  it("opens pending handoff for concrete replace/new_goal with proposed bar", () => {
    const intent = tuIntent({ adjustment_type: "new_goal" });
    expect(
      shouldOpenTuGoalChangePendingHandoff({
        reconciledGoalChangeIntent: intent,
        commitment: baseCommitment(),
        userMessage: "I want to change my goal to run 3 miles every day.",
        plannedInterruptionActionable: false,
        classificationEventType: null,
      })
    ).toBe(true);

    const pack = deriveIntentPackFromReconciledGoalChange({
      intent,
      validatedProposedBar: "run 3 miles every day",
    });
    expect(pack?.intent).toBe("sms_replace_request");
    expect(pack?.candidateNewBar).toBe("run 3 miles every day");
  });

  it("maps raise with concrete bar to sms_raise_bar_request", () => {
    const intent = tuIntent({
      adjustment_type: "raise",
      proposed_new_goal_text: "run 3 miles a day",
    });
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: intent,
      commitment: baseCommitment(),
      userMessage: "This is too easy. Let's make it 3 miles a day.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.intentPack?.intent).toBe("sms_raise_bar_request");
    expect(evalResult.intentPack?.candidateNewBar).toMatch(/3 miles/i);
  });

  it("maps shrink/lower with concrete bar to sms_tighten_request", () => {
    const intent = tuIntent({
      adjustment_type: "shrink",
      proposed_new_goal_text: "walk 10 minutes a day",
    });
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: intent,
      commitment: baseCommitment(),
      userMessage: "This is too hard. Make it 10 minutes a day.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.intentPack?.intent).toBe("sms_tighten_request");
    expect(evalResult.intentPack?.candidateTightenedBar).toMatch(/10 minutes/i);
  });

  it("does not open pending for amend/restate without bar (Slice 2B deferred)", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "amend",
        proposed_new_goal_text: null,
      }),
      commitment: baseCommitment(),
      userMessage: "Yes we need to amend or re-state old goals.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("deferred_slice_2b_type");
  });

  it("does not open pending for general goal talk", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        authoritative: false,
        adjustment_type: "unspecified",
        proposed_new_goal_text: null,
        confidence: "low",
      }),
      commitment: baseCommitment(),
      userMessage: "I was thinking about goals generally.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("not_authoritative");
  });

  it("rejects vague or unsafe proposed bars", () => {
    expect(
      validateTuProposedGoalBarText({
        proposedText: "be better",
        currentBehaviorStatement: "Walk daily",
      }).skipReason
    ).toBe("vague_candidate");
    expect(
      evaluateTuGoalChangePendingHandoff({
        reconciledGoalChangeIntent: tuIntent({ proposed_new_goal_text: "be better" }),
        commitment: baseCommitment(),
        userMessage: "change goal to be better",
        plannedInterruptionActionable: false,
        classificationEventType: null,
      }).skipReason
    ).toBe("vague_candidate");
  });

  it("blocks new pending when existing pending is active", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent(),
      commitment: baseCommitment({
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: "2026-06-01T00:00:00.000Z",
        pending_resolution_expires_at: "2027-06-01T00:00:00.000Z",
        pending_resolution_payload: {
          source: "sms_inbound",
          detected_intent: "sms_replace_request",
          raw_user_text: "prior",
          inbound_message_sid: "SM_OLD",
          ai_confidence: null,
        },
      }),
      userMessage: "I want to change my goal to run 3 miles every day.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("existing_pending");
  });

  it("rejects proposed bar identical to current behavior", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        proposed_new_goal_text: "Walk 20 minutes after dinner",
      }),
      commitment: baseCommitment(),
      userMessage: "Change my goal to walk 20 minutes after dinner",
      plannedInterruptionActionable: false,
      classificationEventType: null,
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("identical_to_current_bar");
  });
});
