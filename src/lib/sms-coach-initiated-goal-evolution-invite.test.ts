import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { EvolutionV1EvaluationResult } from "@/lib/v2-commitment-evolution-engine-v1";
import type { SmsPatternSignalResult } from "@/lib/sms-pattern-signal";
import {
  buildCoachGoalEvolutionInviteLaneGuardrails,
  evaluateCoachInitiatedGoalEvolutionInvite,
  mapCoachGoalEvolutionInviteToDailyFacts,
} from "@/lib/sms-coach-initiated-goal-evolution-invite";
import { deriveSuggestedCoachingMoveForDailyFacts } from "@/lib/v3-daily-relationship-lane";
import { evaluateTuGoalChangePendingHandoff } from "@/lib/v2-sms-commitment-change";
import type { ReconciledGoalChangeIntent } from "@/lib/openai-relationship-turn-understanding-v1";

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

function patternSignal(
  overrides: Partial<SmsPatternSignalResult> = {}
): SmsPatternSignalResult {
  return {
    canonical: null,
    count14d: 0,
    count21d: 0,
    confidence: "low",
    mentionAllowed: false,
    internalHint: null,
    gentleUserLine: null,
    doNotRepeatKey: null,
    source: "events",
    ...overrides,
  };
}

function evolutionEval(
  action: EvolutionV1EvaluationResult["recommended_action"],
  extra?: Record<string, unknown>
): EvolutionV1EvaluationResult {
  return {
    recommended_action: action,
    evidence_json: extra ?? {},
  };
}

function checkSentInviteEvent(occurredAt: string): V2EventRowForAi {
  return {
    event_type: "check_sent",
    occurred_at: occurredAt,
    payload_json: {
      ai: {
        v3_brain: {
          coach_goal_evolution_action: "invite_only",
          coach_goal_evolution_invite_kind: "raise",
        },
      },
    },
  };
}

function goalChangeProofEvent(occurredAt: string): V2EventRowForAi {
  return {
    event_type: "user_yes",
    occurred_at: occurredAt,
    payload_json: {
      proof_moment: true,
      proof_moment_type: "commitment_replaced",
    },
  };
}

const NOW_MS = Date.parse("2026-06-01T12:00:00.000Z");

describe("evaluateCoachInitiatedGoalEvolutionInvite — final thresholds", () => {
  it("1 — yes_streak_14d = 5 invites raise", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesStreak14d: 5,
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("raise");
    expect(result.should_invite).toBe(true);
  });

  it("2 — yes7 = 5 invites raise", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesCount7d: 5,
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("raise");
    expect(result.should_invite).toBe(true);
  });

  it("3 — new_chapter requires streak >= 7, goal age >= 21d, neg14 <= 1", () => {
    const eligible = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({ started_at: "2026-05-01T00:00:00.000Z" }),
      yesStreak14d: 7,
      negativeOutcomes14d: 1,
      nowMs: NOW_MS,
    });
    expect(eligible.invite_kind).toBe("new_chapter");

    const lowStreak = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({ started_at: "2026-05-01T00:00:00.000Z" }),
      yesStreak14d: 6,
      negativeOutcomes14d: 0,
      nowMs: NOW_MS,
    });
    expect(lowStreak.invite_kind).toBe("raise");

    const tooManyMisses = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({ started_at: "2026-05-01T00:00:00.000Z" }),
      yesStreak14d: 8,
      negativeOutcomes14d: 2,
      nowMs: NOW_MS,
    });
    expect(tooManyMisses.invite_kind).toBe("raise");
  });

  it("4 — neg14 = 2 does NOT invite shrink", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 2,
      nowMs: NOW_MS,
    });
    expect(result.should_invite).toBe(false);
    expect(result.hold_standard_reason).toBe("repeated_miss_below_shrink_threshold");
  });

  it("5 — neg14 = 3 alone does NOT invite shrink", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 3,
      nowMs: NOW_MS,
    });
    expect(result.should_invite).toBe(false);
    expect(result.hold_standard_reason).toBe("repeated_miss_below_shrink_threshold");
  });

  it("6 — neg14 = 3 plus recurring blocker invites shrink", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 3,
      patternSignal: patternSignal({
        canonical: "travel",
        count21d: 3,
        count14d: 2,
        confidence: "medium",
      }),
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("shrink");
    expect(result.should_invite).toBe(true);
  });

  it("7 — neg14 = 4 invites shrink", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 4,
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("shrink");
    expect(result.should_invite).toBe(true);
  });

  it("8 — neg14 = 5 invites reset", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 5,
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("reset");
    expect(result.should_invite).toBe(true);
  });

  it("9 — noIn12 = 3 invites reset", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 1,
      evolutionEvaluation: evolutionEval("keep_commitment", {
        user_no_count_last_12_outcomes: 3,
      }),
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("reset");
    expect(result.should_invite).toBe(true);
  });

  it("10 — blocker 3 times with medium confidence does NOT invite blocker_focus", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      patternSignal: patternSignal({
        canonical: "travel",
        count21d: 3,
        count14d: 3,
        confidence: "medium",
      }),
      negativeOutcomes14d: 0,
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).not.toBe("blocker_focus");
    expect(result.should_invite).toBe(false);
  });

  it("11 — blocker 4 times in 21 days invites blocker_focus", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      patternSignal: patternSignal({
        canonical: "travel",
        count21d: 4,
        count14d: 2,
        confidence: "medium",
      }),
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("blocker_focus");
    expect(result.should_invite).toBe(true);
  });

  it("12 — blocker 3 times with high confidence and neg14 >= 2 invites blocker_focus", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 2,
      patternSignal: patternSignal({
        canonical: "travel",
        count21d: 3,
        count14d: 3,
        confidence: "high",
      }),
      nowMs: NOW_MS,
    });
    expect(result.invite_kind).toBe("blocker_focus");
    expect(result.should_invite).toBe(true);
  });

  it("13 — invite within 14 days blocks", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesStreak14d: 8,
      nowMs: NOW_MS,
      eventsNewestFirst: [checkSentInviteEvent("2026-05-28T10:00:00.000Z")],
    });
    expect(result.should_invite).toBe(false);
    expect(result.hold_standard_reason).toBe("coach_goal_evolution_invite_cooldown");
  });

  it("14 — invite older than 14 days does not block", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesStreak14d: 6,
      nowMs: NOW_MS,
      eventsNewestFirst: [checkSentInviteEvent("2026-05-15T10:00:00.000Z")],
    });
    expect(result.should_invite).toBe(true);
    expect(result.invite_kind).toBe("raise");
  });

  it("15 — recent goal change within 14 days blocks", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({ started_at: "2026-01-01T00:00:00.000Z" }),
      yesStreak14d: 8,
      nowMs: NOW_MS,
      eventsNewestFirst: [goalChangeProofEvent("2026-05-28T10:00:00.000Z")],
    });
    expect(result.should_invite).toBe(false);
    expect(result.hold_standard_reason).toBe("recent_goal_change_cooldown");
  });

  it("16 — recent goal change older than 14 days does not block if otherwise eligible", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({ started_at: "2026-01-01T00:00:00.000Z" }),
      yesStreak14d: 6,
      nowMs: NOW_MS,
      eventsNewestFirst: [goalChangeProofEvent("2026-05-10T10:00:00.000Z")],
    });
    expect(result.should_invite).toBe(true);
    expect(result.invite_kind).toBe("raise");
  });

  it("17 — one win / one miss still hold standard", () => {
    const oneWin = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesStreak14d: 1,
      yesCount7d: 1,
      nowMs: NOW_MS,
    });
    expect(oneWin.hold_standard_reason).toBe("single_win_or_insufficient_evidence");

    const oneMiss = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 1,
      nowMs: NOW_MS,
    });
    expect(oneMiss.hold_standard_reason).toBe("single_miss_or_insufficient_evidence");
  });

  it("18 — active pending still blocks", () => {
    const result = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment({
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: "2026-05-30T00:00:00.000Z",
        pending_resolution_expires_at: "2026-06-30T00:00:00.000Z",
        pending_resolution_payload: { source: "coaching_refresh_resolved" },
      }),
      yesStreak14d: 8,
      nowMs: NOW_MS,
    });
    expect(result.hold_standard_reason).toBe("active_pending");
  });

  it("19 — no pending/no mutation/no proof invariants remain true", () => {
    const invite = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      yesStreak14d: 6,
      nowMs: NOW_MS,
    });
    expect(invite.should_create_pending).toBe(false);
    expect(invite.no_state_mutation_without_user_acceptance).toBe(true);
    expect(invite.not_outcome_write).toBe(true);
    const facts = mapCoachGoalEvolutionInviteToDailyFacts(invite);
    expect(facts.should_create_pending).toBe(false);
    expect(facts.current_goal_not_changed).toBe(true);
  });

  it("evolution tighten invites shrink; replace invites reset", () => {
    const shrink = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 0,
      evolutionEvaluation: evolutionEval("tighten_commitment"),
      nowMs: NOW_MS,
    });
    expect(shrink.invite_kind).toBe("shrink");
    expect(shrink.invite_source).toBe("evolution_engine");

    const reset = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: baseCommitment(),
      negativeOutcomes14d: 0,
      evolutionEvaluation: evolutionEval("replace_commitment"),
      nowMs: NOW_MS,
    });
    expect(reset.invite_kind).toBe("reset");
    expect(reset.invite_source).toBe("evolution_engine");
  });
});

describe("daily writer guardrails", () => {
  it("new_chapter guardrail avoids official habit language", () => {
    const guardrails = buildCoachGoalEvolutionInviteLaneGuardrails();
    expect(guardrails).toMatch(/do NOT say the goal is officially a habit/i);
    expect(guardrails).toMatch(/becoming their baseline/i);
  });

  it("suggested coaching move prefers invite over hold_standard when invite active", () => {
    const inviteFacts = mapCoachGoalEvolutionInviteToDailyFacts(
      evaluateCoachInitiatedGoalEvolutionInvite({
        commitment: baseCommitment(),
        yesStreak14d: 6,
        nowMs: NOW_MS,
      })
    );
    const move = deriveSuggestedCoachingMoveForDailyFacts({
      route_kind: "main_active_accountability",
      accountability_day_key: "2026-06-01",
      user: {
        clerk_user_id: "u1",
        preferred_name: null,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-01T12:00:00.000Z",
        relationship_profile_summary: null,
      },
      commitment: {
        id: "c1",
        title: "Walk",
        behavior_statement: "Walk 20 minutes",
        effective_ask: "Walk 20 minutes",
        accountability_phase: "active",
        identity_anchor_allowed: false,
        identity_anchor_short: null,
      },
      thread_memory: {
        latest_outbound_sms: null,
        latest_inbound_sms: null,
        recent_transcript_or_context_block: null,
        latest_open_question: null,
        do_not_repeat_hints: [],
        coaching_memory_snippet: null,
        recent_pattern_hints: null,
      },
      accountability: {
        daily_purpose: "standard_accountability_check",
        server_strategy: "standard_check",
        next_move_type: "hold_standard",
        prior_outcome: null,
        yes_streak_14d: 6,
        no_count_14d: 0,
        partial_count_14d: 0,
        blocker_preview: null,
        proof_or_milestone_signal: null,
        silence_tier: "none",
        unanswered_checks: 0,
        days_since_last_user_outcome: 1,
        reentry_active: false,
        overlay_active: false,
        coach_goal_evolution_invite: inviteFacts,
      },
    });
    expect(move).toBe("invite_goal_evolution");
  });
});

describe("Slice 2B proactive sources remain blocked (20)", () => {
  function tuIntent(
    overrides: Partial<ReconciledGoalChangeIntent> = {}
  ): ReconciledGoalChangeIntent {
    return {
      authoritative: true,
      detected: true,
      adjustment_type: "raise",
      source: "user_requested",
      requires_confirmation: true,
      proposed_new_goal_text: null,
      evidence_quote: "keeps hitting goal",
      confidence: "high",
      goal_change_not_outcome_write: true,
      goal_change_no_state_mutation_without_confirmation: true,
      ...overrides,
    };
  }

  it("consistency_signal does NOT open shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: tuIntent({ source: "consistency_signal" }),
      commitment: baseCommitment(),
      userMessage: "I've been crushing it.",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "reported_completion",
    });
    expect(evalResult.open).toBe(false);
    expect(evalResult.skipReason).toBe("shell_deferred_proactive_source");
  });
});
