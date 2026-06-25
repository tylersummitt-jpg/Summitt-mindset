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
  deriveAwaitingCandidateIntentPackFromReconciledGoalChange,
  deriveIntentPackFromReconciledGoalChange,
  evaluateTuGoalChangePendingHandoff,
  shouldOpenTuGoalChangePendingHandoff,
  validateTuProposedGoalBarText,
} from "@/lib/v2-sms-commitment-change";
import { inferMinimalGoalChangeIntentFromInbound } from "@/lib/openai-relationship-turn-understanding-v1";

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

describe("TU goal-change → Wave4 handoff gate (Slice 2A concrete bar)", () => {
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

  it("maps raise with concrete bar to sms_raise_bar_request (concrete_bar_pending)", () => {
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
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("concrete_bar_pending");
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
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("concrete_bar_pending");
    expect(evalResult.intentPack?.intent).toBe("sms_tighten_request");
    expect(evalResult.intentPack?.candidateTightenedBar).toMatch(/10 minutes/i);
  });

  it("rejects vague or unsafe proposed bars without opening shell", () => {
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

describe("TU goal-change awaiting_candidate shell (Slice 2B)", () => {
  it("amend/restate opens awaiting_candidate shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "amend",
        proposed_new_goal_text: null,
        evidence_quote: "amend or re-state old goals",
      }),
      commitment: baseCommitment(),
      userMessage: "Yes we need to amend or re-state old goals.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
      priorGoalChangeAskSatisfied: true,
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.intentPack?.intent).toBe("sms_change_unspecified");
    expect(evalResult.intentPack?.candidateNewBar).toBeNull();
    expect(evalResult.pendingShellReason).toBe("goal_change_without_concrete_bar");
    expect(evalResult.shellMetadata?.tu_goal_change_type).toBe("amend");
    expect(evalResult.shellMetadata?.stale_ask_goal_change_bridge_eligible).toBe(true);
  });

  it("reset old goal opens awaiting_candidate shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "reset",
        proposed_new_goal_text: null,
        evidence_quote: "reset the old goal",
      }),
      commitment: baseCommitment(),
      userMessage: "Can we reset the old goal?",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.intentPack?.intent).toBe("sms_change_unspecified");
  });

  it("no-longer-fits opens awaiting_candidate shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: "goal no longer fits",
      }),
      commitment: baseCommitment(),
      userMessage: "This goal no longer fits.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.intentPack?.intent).toBe("sms_change_unspecified");
  });

  it("too easy without bar opens shell when authoritative goal adjustment", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "raise",
        proposed_new_goal_text: null,
        evidence_quote: "this is too easy",
      }),
      commitment: baseCommitment(),
      userMessage: "This is too easy.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.intentPack?.intent).toBe("sms_raise_bar_request");
  });

  it("too hard without bar opens shell when authoritative goal adjustment", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "shrink",
        proposed_new_goal_text: null,
        evidence_quote: "this is too hard",
      }),
      commitment: baseCommitment(),
      userMessage: "This is too hard.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.intentPack?.intent).toBe("sms_tighten_request");
  });

  it("blocker_focus without bar opens shell when user frames blocker as target", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "blocker_focus",
        proposed_new_goal_text: null,
        evidence_quote: "phone keeps derailing me",
        source: "user_requested",
      }),
      commitment: baseCommitment(),
      userMessage: "My phone keeps derailing me. Maybe that is the goal.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.shellMetadata?.tu_goal_change_type).toBe("blocker_focus");
  });

  it("ordinary avoidance does NOT open shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        authoritative: false,
        adjustment_type: "unspecified",
        proposed_new_goal_text: null,
        confidence: "low",
      }),
      commitment: baseCommitment(),
      userMessage: "I don't feel like doing it today.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "miss",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("not_authoritative");
  });

  it("miss-only too hard without goal-change intent does NOT open shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "shrink",
        proposed_new_goal_text: null,
        evidence_quote: "hard day",
      }),
      commitment: baseCommitment(),
      userMessage: "Today was really hard.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "miss",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("shell_deferred_avoidance_or_miss_only");
  });

  it("general goal talk does NOT open shell", () => {
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

  it("multiple goals deferred", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "new_goal",
        proposed_new_goal_text: null,
        evidence_quote: "add nutrition",
      }),
      commitment: baseCommitment(),
      userMessage: "I want to add nutrition too.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("shell_deferred_multiple_goals");
  });

  it("proactive consistency_signal does NOT open shell (Slice 3 deferred)", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "raise",
        proposed_new_goal_text: null,
        source: "consistency_signal",
        evidence_quote: "keeps hitting goal",
      }),
      commitment: baseCommitment(),
      userMessage: "I've been crushing it lately.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "reported_completion",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("shell_deferred_proactive_source");
  });

  it("deriveAwaitingCandidateIntentPack maps lower/shrink to sms_tighten_request", () => {
    const pack = deriveAwaitingCandidateIntentPackFromReconciledGoalChange({
      intent: tuIntent({ adjustment_type: "lower", proposed_new_goal_text: null }),
    });
    expect(pack.intent).toBe("sms_tighten_request");
    expect(pack.candidateTightenedBar).toBeNull();
  });
});

describe("completed goal / move-on → awaiting_candidate shell", () => {
  function wakeUpCommitment(): ActiveV2CommitmentRow {
    return baseCommitment({
      behavior_statement: "Get out of bed at planned wake time without snoozing",
      title: "Wake up",
    });
  }

  it("inferMinimalGoalChangeIntentFromInbound detects move on from this goal", () => {
    const intent = inferMinimalGoalChangeIntentFromInbound("Let's move on from this goal");
    expect(intent?.detected).toBe(true);
    expect(intent?.source).toBe("user_requested");
    expect(intent?.adjustment_type).toBe("replace");
    expect(intent?.proposed_new_goal_text).toBeNull();
  });

  it("Let's move on from this goal opens awaiting_candidate_shell", () => {
    const backstop = inferMinimalGoalChangeIntentFromInbound("Let's move on from this goal");
    expect(backstop).not.toBeNull();
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: {
        authoritative: true,
        detected: true,
        adjustment_type: backstop!.adjustment_type,
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: backstop!.evidence_quote,
        confidence: "medium",
        goal_change_not_outcome_write: true,
        goal_change_no_state_mutation_without_confirmation: true,
      },
      commitment: wakeUpCommitment(),
      userMessage: "Let's move on from this goal",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.pendingShellReason).toBe("user_completed_goal_wants_new_bar");
  });

  it("I've completed that goal does not open concrete pending without a bar", () => {
    const msg = "I've completed that goal";
    const backstop = inferMinimalGoalChangeIntentFromInbound(msg);
    expect(backstop?.detected).toBe(true);
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: {
        authoritative: true,
        detected: true,
        adjustment_type: "replace",
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: msg,
        confidence: "medium",
        goal_change_not_outcome_write: true,
        goal_change_no_state_mutation_without_confirmation: true,
      },
      commitment: wakeUpCommitment(),
      userMessage: msg,
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.shellMetadata?.no_outcome_write).toBe(true);
  });

  it("I've accomplished this goal and would like to move on opens user_requested handoff", () => {
    const msg = "I've accomplished this goal and would like to move on";
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: msg,
      }),
      commitment: wakeUpCommitment(),
      userMessage: msg,
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.pendingShellReason).toBe("user_completed_goal_wants_new_bar");
    expect(evalResult.shellMetadata?.tu_goal_change_source).toBe("user_requested");
  });

  it("not focusing on wake up anymore opens completed-goal shell", () => {
    const msg = "I'm not focusing on my wake up time anymore";
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: msg,
      }),
      commitment: wakeUpCommitment(),
      userMessage: msg,
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.pendingShellReason).toBe("user_completed_goal_wants_new_bar");
  });

  it("Self discipline through daily tasks opens shell instead of vague_candidate skip", () => {
    const msg = "Self discipline through daily tasks";
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: "self discipline through daily tasks",
        evidence_quote: msg,
      }),
      commitment: wakeUpCommitment(),
      userMessage: msg,
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
    expect(evalResult.skipReason).toBeNull();
    expect(evalResult.pendingShellReason).toBe("vague_theme_needs_concrete_bar");
  });

  it("concrete new daily bar still opens concrete_bar_pending (2A)", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: "finish one task before bed every night",
        evidence_quote: "finish one task before bed every night",
      }),
      commitment: wakeUpCommitment(),
      userMessage: "finish one task before bed every night",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("concrete_bar_pending");
    expect(evalResult.validatedProposedBar).toMatch(/finish one task/i);
  });

  it("bare yes without goal-transition context stays blocked", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: "yes",
        confidence: "low",
        authoritative: false,
      }),
      commitment: wakeUpCommitment(),
      userMessage: "yes",
      plannedInterruptionActionable: false,
      classificationEventType: "user_yes",
      relationshipMeaning: "reported_completion",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("not_authoritative");
  });

  it("yes with prior goal-change context and authoritative replace intent can open shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: "ready to move on",
      }),
      commitment: wakeUpCommitment(),
      userMessage: "Yes, I'm ready",
      plannedInterruptionActionable: false,
      classificationEventType: "user_yes",
      relationshipMeaning: "goal_adjustment_request",
      priorGoalChangeAskSatisfied: true,
      recentThreadContext: "I've accomplished this goal and would like to move on",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
  });

  it("user_no does not open goal-change handoff", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({ proposed_new_goal_text: null }),
      commitment: wakeUpCommitment(),
      userMessage: "no not today",
      plannedInterruptionActionable: false,
      classificationEventType: "user_no",
      relationshipMeaning: "miss",
    });
    expect(evalResult.open).toBe(false);
  });
});

describe("same-day goal proof vs move-on handoff", () => {
  function wakeUpCommitment(): ActiveV2CommitmentRow {
    return baseCommitment({
      behavior_statement: "Get out of bed at planned wake time without snoozing",
      title: "Wake up",
    });
  }

  function evalHandoffForMessage(msg: string) {
    const backstop = inferMinimalGoalChangeIntentFromInbound(msg);
    return evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: backstop
        ? {
            authoritative: true,
            detected: true,
            adjustment_type: backstop.adjustment_type,
            source: "user_requested",
            requires_confirmation: true,
            proposed_new_goal_text: backstop.proposed_new_goal_text,
            evidence_quote: backstop.evidence_quote,
            confidence: backstop.confidence,
            goal_change_not_outcome_write: true,
            goal_change_no_state_mutation_without_confirmation: true,
          }
        : null,
      commitment: wakeUpCommitment(),
      userMessage: msg,
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
  }

  const sameDayProof = [
    "I finished my goal today",
    "I completed my goal today",
    "I accomplished my goal today",
    "I finished today's goal",
  ];

  it.each(sameDayProof)("same-day proof does not open awaiting_candidate_shell: %s", (msg) => {
    expect(inferMinimalGoalChangeIntentFromInbound(msg)).toBeNull();
    const evalResult = evalHandoffForMessage(msg);
    expect(evalResult.open).toBe(false);
  });

  it("I got my 10,000 steps today does not open goal-change shell", () => {
    const msg = "I got my 10,000 steps today";
    expect(inferMinimalGoalChangeIntentFromInbound(msg)).toBeNull();
    expect(evalHandoffForMessage(msg).open).toBe(false);
  });

  it("I finished this goal and want to move on opens awaiting_candidate_shell", () => {
    const msg = "I finished this goal and want to move on";
    const evalResult = evalHandoffForMessage(msg);
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
  });

  it("I accomplished this goal and would like to move on opens awaiting_candidate_shell", () => {
    const msg = "I've accomplished this goal and would like to move on";
    const evalResult = evalHandoffForMessage(msg);
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
  });

  it("not focusing on wake up anymore still opens goal-transition shell", () => {
    const msg = "I'm not focusing on my wake up time anymore";
    const evalResult = evalHandoffForMessage(msg);
    expect(evalResult.open).toBe(true);
    expect(evalResult.pendingShellReason).toBe("user_completed_goal_wants_new_bar");
  });

  it("bare yes without transition still blocked", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: null,
        evidence_quote: "yes",
        confidence: "low",
        authoritative: false,
      }),
      commitment: wakeUpCommitment(),
      userMessage: "yes",
      plannedInterruptionActionable: false,
      classificationEventType: "user_yes",
      relationshipMeaning: "reported_completion",
    });
    expect(evalResult.open).toBe(false);
  });

  it("concrete new daily bar still opens concrete_bar_pending (2A)", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({
        adjustment_type: "replace",
        proposed_new_goal_text: "finish one task before bed every night",
        evidence_quote: "finish one task before bed every night",
      }),
      commitment: wakeUpCommitment(),
      userMessage: "finish one task before bed every night",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("concrete_bar_pending");
  });
});
