import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import {
  deriveRecentCoachGoalEvolutionInviteFromEvents,
  COACH_GOAL_EVOLUTION_INVITE_ACCEPTANCE_TTL_MS,
} from "@/lib/sms-coach-initiated-goal-evolution-invite";
import {
  evaluateCoachInviteAcceptanceContext,
} from "@/lib/sms-coach-goal-evolution-acceptance";
import {
  evaluateCoachAcceptedGoalEvolutionHandoff,
  evaluateTuGoalChangePendingHandoff,
} from "@/lib/v2-sms-commitment-change";
import type { ReconciledGoalChangeIntent } from "@/lib/openai-relationship-turn-understanding-v1";

const NOW_MS = Date.parse("2026-06-01T12:00:00.000Z");

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

function checkSentInviteEvent(
  occurredAt: string,
  inviteKind: "raise" | "shrink" | "reset" | "blocker_focus" = "raise"
): V2EventRowForAi {
  return {
    event_type: "check_sent",
    occurred_at: occurredAt,
    payload_json: {
      ai: {
        v3_brain: {
          coach_goal_evolution_action: "invite_only",
          coach_goal_evolution_invite_kind: inviteKind,
          coach_goal_evolution_invite_source: "consistency",
          coach_goal_evolution_evidence_summary: `test:${inviteKind}`,
        },
      },
    },
  };
}

function checkSentNormalEvent(occurredAt: string): V2EventRowForAi {
  return {
    event_type: "check_sent",
    occurred_at: occurredAt,
    payload_json: {
      ai: {
        v3_brain: {
          coach_goal_evolution_action: "hold_standard",
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

function deriveInvite(events: V2EventRowForAi[], commitment = baseCommitment()) {
  return deriveRecentCoachGoalEvolutionInviteFromEvents({
    eventsNewestFirst: events,
    commitment,
    nowMs: NOW_MS,
  });
}

function acceptHandoff(args: {
  inviteKind?: "raise" | "shrink" | "reset" | "blocker_focus";
  userMessage: string;
  sentAt?: string;
  events?: V2EventRowForAi[];
  classificationEventType?: "user_yes" | "user_no" | "user_partial" | null;
}) {
  const sentAt = args.sentAt ?? "2026-05-31T12:00:00.000Z";
  const events = args.events ?? [checkSentInviteEvent(sentAt, args.inviteKind ?? "raise")];
  const commitment = baseCommitment();
  const invite = deriveInvite(events, commitment);
  const acceptance = evaluateCoachInviteAcceptanceContext({
    invite,
    userMessage: args.userMessage,
    commitment,
    classificationEventType: args.classificationEventType ?? null,
    plannedInterruptionActionable: false,
    nowMs: NOW_MS,
  });
  const handoff =
    acceptance.disposition === "accepted"
      ? evaluateCoachAcceptedGoalEvolutionHandoff({
          acceptance,
          commitment,
          userMessage: args.userMessage,
          plannedInterruptionActionable: false,
          classificationEventType: args.classificationEventType ?? null,
        })
      : null;
  return { invite, acceptance, handoff };
}

describe("deriveRecentCoachGoalEvolutionInviteFromEvents", () => {
  it("finds recent invite within 72h TTL", () => {
    const invite = deriveInvite([checkSentInviteEvent("2026-05-31T12:00:00.000Z", "raise")]);
    expect(invite.found).toBe(true);
    expect(invite.ttl_valid).toBe(true);
    expect(invite.last_outbound_is_invite).toBe(true);
    expect(invite.invite_kind).toBe("raise");
  });

  it("7 — invite older than 72h is not ttl_valid", () => {
    const oldMs = NOW_MS - COACH_GOAL_EVOLUTION_INVITE_ACCEPTANCE_TTL_MS - 1000;
    const invite = deriveInvite([checkSentInviteEvent(new Date(oldMs).toISOString(), "raise")]);
    expect(invite.found).toBe(true);
    expect(invite.ttl_valid).toBe(false);
    expect(invite.skip_reason).toBe("invite_ttl_expired");
  });

  it("8 — later coach check_sent after invite blocks last_outbound_is_invite", () => {
    const invite = deriveInvite([
      checkSentNormalEvent("2026-06-01T10:00:00.000Z"),
      checkSentInviteEvent("2026-05-31T12:00:00.000Z", "raise"),
    ]);
    expect(invite.skip_reason).toBe("later_coach_outbound_after_invite");
    expect(invite.last_outbound_is_invite).toBe(false);
  });

  it("10 — goal changed since invite blocks", () => {
    const invite = deriveInvite([
      checkSentInviteEvent("2026-05-31T12:00:00.000Z", "raise"),
      goalChangeProofEvent("2026-06-01T08:00:00.000Z"),
    ]);
    expect(invite.skip_reason).toBe("goal_changed_since_invite");
  });
});

describe("Slice 3B coach invite acceptance → 2B shell", () => {
  it("1 — recent raise invite + yes → awaiting_candidate shell", () => {
    const { handoff } = acceptHandoff({ userMessage: "yes", classificationEventType: "user_yes" });
    expect(handoff?.open).toBe(true);
    expect(handoff?.mode).toBe("awaiting_candidate_shell");
    expect(handoff?.pendingShellReason).toBe("accepted_coach_goal_evolution_invite");
  });

  it("2 — recent shrink invite + yes → awaiting_candidate shell", () => {
    const { handoff } = acceptHandoff({
      inviteKind: "shrink",
      userMessage: "yeah let's do it",
    });
    expect(handoff?.mode).toBe("awaiting_candidate_shell");
    expect(handoff?.intentPack?.intent).toBe("sms_tighten_request");
  });

  it("3 — recent reset invite + yes → awaiting_candidate shell", () => {
    const { handoff } = acceptHandoff({
      inviteKind: "reset",
      userMessage: "reset it",
    });
    expect(handoff?.mode).toBe("awaiting_candidate_shell");
  });

  it("4 — recent blocker-focus invite + yes → awaiting_candidate shell", () => {
    const { handoff } = acceptHandoff({
      inviteKind: "blocker_focus",
      userMessage: "let's focus on the blocker",
    });
    expect(handoff?.mode).toBe("awaiting_candidate_shell");
  });

  it("5 — recent invite + concrete bar → concrete_bar_pending", () => {
    const { acceptance, handoff } = acceptHandoff({
      userMessage: "yes change my goal to run 3 miles every day",
    });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.concrete_bar_present).toBe(true);
    expect(handoff?.open).toBe(true);
    expect(handoff?.mode).toBe("concrete_bar_pending");
    expect(handoff?.validatedProposedBar).toMatch(/3 miles/i);
  });

  it("6 — no recent invite + bare yes → no shell", () => {
    const invite = deriveInvite([]);
    const acceptance = evaluateCoachInviteAcceptanceContext({
      invite,
      userMessage: "yes",
      commitment: baseCommitment(),
      classificationEventType: "user_yes",
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    expect(acceptance.disposition).toBe("skip");
    const handoff = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: null,
      commitment: baseCommitment(),
      userMessage: "yes",
      plannedInterruptionActionable: false,
      classificationEventType: "user_yes",
    });
    expect(handoff.open).toBe(false);
    expect(handoff.skipReason).toBe("not_authoritative");
  });

  it("9 — active pending blocks acceptance handoff", () => {
    const commitment = baseCommitment({
      pending_resolution_kind: "commitment_replace",
      pending_resolution_created_at: "2026-05-30T00:00:00.000Z",
      pending_resolution_expires_at: "2026-06-30T00:00:00.000Z",
      pending_resolution_payload: { source: "sms_inbound", raw_user_text: "x", inbound_message_sid: "SM1", detected_intent: "sms_change_unspecified" },
    });
    const invite = deriveInvite(
      [checkSentInviteEvent("2026-05-31T12:00:00.000Z")],
      commitment
    );
    const acceptance = evaluateCoachInviteAcceptanceContext({
      invite,
      userMessage: "yes",
      commitment,
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    expect(acceptance.disposition).toBe("skip");
    expect(acceptance.skip_reason).toBe("existing_pending");
  });

  it("12 — decline not now → no pending", () => {
    const { acceptance, handoff } = acceptHandoff({ userMessage: "not now" });
    expect(acceptance.disposition).toBe("declined");
    expect(handoff).toBeNull();
    expect(acceptance.telemetry.coach_goal_evolution_user_declined).toBe(true);
  });

  it("13 — ignore done today → no pending", () => {
    const { acceptance, handoff } = acceptHandoff({
      userMessage: "done today",
      classificationEventType: "user_yes",
    });
    expect(acceptance.disposition).toBe("ignored");
    expect(handoff).toBeNull();
  });

  it("14-15 — acceptance shell metadata forbids mutation/proof flags", () => {
    const { handoff } = acceptHandoff({ userMessage: "yes let's do it" });
    expect(handoff?.shellMetadata?.no_outcome_write).toBe(true);
    expect(handoff?.shellMetadata?.no_state_change_taken).toBe(true);
    expect(handoff?.shellMetadata?.coach_initiated_goal_evolution).toBe(true);
  });

  it("20 — bare yes exception only with validated invite", () => {
    const blocked = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: {
        authoritative: true,
        detected: true,
        adjustment_type: "raise",
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: "yes",
        confidence: "high",
        goal_change_not_outcome_write: true,
        goal_change_no_state_mutation_without_confirmation: true,
      },
      commitment: baseCommitment(),
      userMessage: "yes",
      plannedInterruptionActionable: false,
      classificationEventType: "user_yes",
    });
    expect(blocked.skipReason).toBe("strong_outcome_classification");

    const { handoff } = acceptHandoff({
      userMessage: "yes",
      classificationEventType: "user_yes",
    });
    expect(handoff?.open).toBe(true);
  });
});

describe("Slice 2B proactive sources remain blocked without invite acceptance", () => {
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

  it("17 — consistency_signal still blocked without invite acceptance", () => {
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

describe("user-initiated amend still works (18-19)", () => {
  it("amend without invite opens 2B shell", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: {
        authoritative: true,
        detected: true,
        adjustment_type: "amend",
        source: "user_requested",
        requires_confirmation: true,
        proposed_new_goal_text: null,
        evidence_quote: "need to amend my goal",
        confidence: "high",
        goal_change_not_outcome_write: true,
        goal_change_no_state_mutation_without_confirmation: true,
      },
      commitment: baseCommitment(),
      userMessage: "I need to amend my goal",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.open).toBe(true);
    expect(evalResult.mode).toBe("awaiting_candidate_shell");
  });

  it("concrete proposed bar still opens 2A", () => {
    const evalResult = evaluateTuGoalChangePendingHandoff({
      reconciledGoalChangeIntent: {
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
      },
      commitment: baseCommitment(),
      userMessage: "change to run 3 miles every day",
      plannedInterruptionActionable: false,
      classificationEventType: null,
      relationshipMeaning: "goal_adjustment_request",
    });
    expect(evalResult.mode).toBe("concrete_bar_pending");
  });
});

describe("freeform last-outbound goal-change invitation (TTO)", () => {
  it("detects TTO-style invite from last outbound body", () => {
    const invite = deriveRecentCoachGoalEvolutionInviteFromEvents({
      eventsNewestFirst: [],
      commitment: baseCommitment(),
      nowMs: NOW_MS,
      lastOutboundFullBody:
        "Tyler, I think it's time to change our goal. What do you think?",
      lastOutboundSentAtMs: NOW_MS - 60_000,
    });
    expect(invite.found).toBe(true);
    expect(invite.last_outbound_is_invite).toBe(true);
    expect(invite.evidence_summary).toBe("freeform_last_outbound_goal_change_invitation");
  });

  it.each(["I agree.", "yes", "sounds good"])(
    "freeform invite + %s → awaiting_candidate shell (no candidate from ack)",
    (userMessage) => {
      const invite = deriveRecentCoachGoalEvolutionInviteFromEvents({
        eventsNewestFirst: [],
        commitment: baseCommitment({
          behavior_statement: "Give each kid a genuine compliment every day",
        }),
        nowMs: NOW_MS,
        lastOutboundFullBody:
          "Tyler, I think it's time to change our goal. What do you think?",
        lastOutboundSentAtMs: NOW_MS - 60_000,
      });
      const acceptance = evaluateCoachInviteAcceptanceContext({
        invite,
        userMessage,
        commitment: baseCommitment({
          behavior_statement: "Give each kid a genuine compliment every day",
        }),
        classificationEventType: "user_yes",
        plannedInterruptionActionable: false,
        nowMs: NOW_MS,
      });
      expect(acceptance.disposition).toBe("accepted");
      expect(acceptance.concrete_bar_present).toBe(false);
      expect(acceptance.proposed_bar_text).toBeNull();
      const handoff = evaluateCoachAcceptedGoalEvolutionHandoff({
        acceptance,
        commitment: baseCommitment({
          behavior_statement: "Give each kid a genuine compliment every day",
        }),
        userMessage,
        plannedInterruptionActionable: false,
        classificationEventType: "user_yes",
      });
      expect(handoff.open).toBe(true);
      expect(handoff.mode).toBe("awaiting_candidate_shell");
      expect(handoff.validatedProposedBar).toBeNull();
      expect(handoff.pendingShellReason).toBe("accepted_coach_goal_evolution_invite");
    }
  );

  it("non-invite last outbound + I agree does not open invite acceptance", () => {
    const invite = deriveRecentCoachGoalEvolutionInviteFromEvents({
      eventsNewestFirst: [],
      commitment: baseCommitment(),
      nowMs: NOW_MS,
      lastOutboundFullBody: "Did you give each kid a genuine compliment today?",
      lastOutboundSentAtMs: NOW_MS - 60_000,
    });
    expect(invite.last_outbound_is_invite).toBe(false);
    const acceptance = evaluateCoachInviteAcceptanceContext({
      invite,
      userMessage: "I agree",
      commitment: baseCommitment(),
      classificationEventType: "user_yes",
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    expect(acceptance.disposition).toBe("skip");
  });
});
