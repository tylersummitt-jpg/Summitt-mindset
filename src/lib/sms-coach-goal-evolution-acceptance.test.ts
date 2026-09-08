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
  isSubstantiveGoalChangeInviteContinuation,
} from "@/lib/sms-coach-goal-evolution-acceptance";

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
  return { invite, acceptance };
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

describe("Slice 3B coach invite acceptance (classification only; dead TU handoff retired)", () => {
  it("1 — recent raise invite + bare yes → unclear, not accepted", () => {
    const { acceptance } = acceptHandoff({
      userMessage: "yes",
      classificationEventType: "user_yes",
    });
    expect(acceptance.disposition).toBe("ignored");
    expect(acceptance.reply_meaning).toBe("unclear");
  });

  it("2 — recent shrink invite + make it smaller → accepted change", () => {
    const { acceptance } = acceptHandoff({
      inviteKind: "shrink",
      userMessage: "make it smaller",
    });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("change_goal");
  });

  it("3 — recent reset invite + reset it → accepted change", () => {
    const { acceptance } = acceptHandoff({
      inviteKind: "reset",
      userMessage: "reset it",
    });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("change_goal");
  });

  it("4 — recent blocker-focus invite + focus on the blocker → accepted change", () => {
    const { acceptance } = acceptHandoff({
      inviteKind: "blocker_focus",
      userMessage: "let's focus on the blocker",
    });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("change_goal");
  });

  it("5 — recent invite + concrete bar → accepted concrete candidate", () => {
    const { acceptance } = acceptHandoff({
      userMessage: "yes change my goal to run 3 miles every day",
    });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.concrete_bar_present).toBe(true);
    expect(acceptance.proposed_bar_text).toMatch(/3 miles/i);
  });

  it("6 — no recent invite + bare yes → skip", () => {
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
  });

  it("9 — active pending blocks acceptance", () => {
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
      userMessage: "I want to change my goal",
      commitment,
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    expect(acceptance.disposition).toBe("skip");
    expect(acceptance.skip_reason).toBe("existing_pending");
  });

  it("12 — decline not now", () => {
    const { acceptance } = acceptHandoff({ userMessage: "not now" });
    expect(acceptance.disposition).toBe("declined");
    expect(acceptance.reply_meaning).toBe("keep_current");
    expect(acceptance.telemetry.coach_goal_evolution_user_declined).toBe(true);
  });

  it("13 — ignore done today", () => {
    const { acceptance } = acceptHandoff({
      userMessage: "done today",
      classificationEventType: "user_yes",
    });
    expect(acceptance.disposition).toBe("ignored");
  });

  it("14-15 — raise-the-bar invite reply is accepted classification only", () => {
    const { acceptance } = acceptHandoff({ userMessage: "raise the bar" });
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("raise_current_goal");
  });

  it("20 — bare yes with invite does not accept (multi-option unsafe)", () => {
    const { acceptance } = acceptHandoff({
      userMessage: "yes",
      classificationEventType: "user_yes",
    });
    expect(acceptance.disposition).toBe("ignored");
    expect(acceptance.reply_meaning).toBe("unclear");
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
    "freeform invite + %s → unclear, no hallway",
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
      expect(acceptance.disposition).toBe("ignored");
      expect(acceptance.reply_meaning).toBe("unclear");
      expect(acceptance.concrete_bar_present).toBe(false);
      expect(acceptance.proposed_bar_text).toBeNull();
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

describe("invite reply meaning — safe hallway policy", () => {
  const DONNA =
    "To be positive amid all the negativity each day. Always give a positive comment each day. Positive self talk.";
  const INVITE_BODY = "I think it's time to change your goal. What do you think?";
  const MULTI_OPTION_INVITE =
    'Do you want to "raise the bar" or focus on another goal? I\'m ready for whatever you decide!';

  function freeformInviteAcceptance(
    userMessage: string,
    inviteBody = INVITE_BODY,
    commitment = baseCommitment()
  ) {
    const inviteAt = "2026-06-01T11:59:00.000Z";
    const freeform = deriveRecentCoachGoalEvolutionInviteFromEvents({
      eventsNewestFirst: [],
      commitment,
      nowMs: NOW_MS,
      lastOutboundFullBody: inviteBody,
      lastOutboundSentAtMs: Date.parse(inviteAt),
    });
    // Multi-option raise/another copy may not match freeform detector — use structured invite.
    const invite = freeform.last_outbound_is_invite
      ? freeform
      : deriveRecentCoachGoalEvolutionInviteFromEvents({
          eventsNewestFirst: [checkSentInviteEvent(inviteAt, "raise")],
          commitment,
          nowMs: NOW_MS,
        });
    const acceptance = evaluateCoachInviteAcceptanceContext({
      invite,
      userMessage,
      commitment,
      classificationEventType: null,
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    return { invite, acceptance };
  }

  it("A — Stay 1 week more with that goal → keep_current, no hallway", () => {
    const { acceptance } = freeformInviteAcceptance(
      "Stay 1 week more with that goal",
      MULTI_OPTION_INVITE
    );
    expect(acceptance.reply_meaning).toBe("keep_current");
    expect(acceptance.disposition).toBe("declined");
  });

  it.each(["sure", "ok", "okay", "sounds good", "yes", "fine"])(
    "B — ambiguous affirmative %s after multi-option invite → unclear, no hallway",
    (userMessage) => {
      const { acceptance } = freeformInviteAcceptance(
        userMessage,
        MULTI_OPTION_INVITE
      );
      expect(acceptance.reply_meaning).toBe("unclear");
      expect(acceptance.disposition).toBe("ignored");
    }
  );

  it.each([
    "Stay one more week with that goal",
    "Keep the same goal",
    "Same goal",
    "Stay with this goal",
    "One more week",
    "Let's do one more week",
    "Don't change it",
    "No, keep this one",
    "Stick with this goal",
    "Continue this goal",
    "Keep what we have",
  ])("C — keep-current %s → no hallway", (userMessage) => {
    const { acceptance } = freeformInviteAcceptance(
      userMessage,
      MULTI_OPTION_INVITE
    );
    expect(acceptance.reply_meaning).toBe("keep_current");
    expect(acceptance.disposition).toBe("declined");
  });

  it.each([
    "That makes sense and I want to keep working",
    "This week has been busy but I'm trying",
    "I'll think about it",
    "I'm not sure yet",
    "So far so good",
  ])("D — substantive unclear %s → no hallway", (userMessage) => {
    const { acceptance } = freeformInviteAcceptance(userMessage);
    expect(acceptance.reply_meaning).toBe("unclear");
    expect(["ignored", "declined"]).toContain(acceptance.disposition);
    expect(acceptance.disposition).not.toBe("accepted");
  });

  it.each([
    "I want to change my goal",
    "Let's focus on another goal",
    "I need a new goal",
    "Can we change my goal?",
  ])("E — explicit change %s → hallway", (userMessage) => {
    const { acceptance } = freeformInviteAcceptance(userMessage);
    expect(acceptance.reply_meaning).toBe("change_goal");
    expect(acceptance.disposition).toBe("accepted");
  });

  it.each(["Raise the bar", "Let's make it harder", "I want to step it up"])(
    "F — explicit raise %s → hallway",
    (userMessage) => {
      const { acceptance } = freeformInviteAcceptance(userMessage);
      expect(acceptance.reply_meaning).toBe("raise_current_goal");
      expect(acceptance.disposition).toBe("accepted");
    }
  );

  it("G — concrete candidate → confirmation path", () => {
    const msg = "I want my goal to be waking up before my kids";
    const { acceptance } = freeformInviteAcceptance(msg);
    expect(acceptance.reply_meaning).toBe("concrete_candidate");
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.concrete_bar_present).toBe(true);
  });

  it("A2 — Donna positivity after invite → concrete candidate, not length-acceptance", () => {
    const { invite, acceptance } = freeformInviteAcceptance(DONNA);
    expect(invite.last_outbound_is_invite).toBe(true);
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("concrete_candidate");
    expect(acceptance.proposed_bar_text).not.toBe(DONNA);
    expect(acceptance.proposed_bar_text).toMatch(/positive comment|self-talk|self talk/i);
  });

  it("B2 — broad workouts direction after invite → unclear, no hallway", () => {
    const { acceptance } = freeformInviteAcceptance(
      "I want to be more consistent with workouts."
    );
    expect(acceptance.disposition).not.toBe("accepted");
    expect(acceptance.reply_meaning).toBe("unclear");
  });

  it("C2 — concrete walk bar after invite → confirmation candidate", () => {
    const msg = "Walk 20 minutes after dinner every day.";
    const { acceptance } = freeformInviteAcceptance(msg);
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.concrete_bar_present).toBe(true);
    expect(acceptance.proposed_bar_text).toMatch(/walk 20 minutes/i);
  });

  it("D2 — decline after invite → no pending", () => {
    const { acceptance } = freeformInviteAcceptance("No, keep the same goal.");
    expect(acceptance.disposition).toBe("declined");
    expect(acceptance.reply_meaning).toBe("keep_current");
  });

  it("E2 — bare Ok after invite → unclear, no hallway", () => {
    const { acceptance } = freeformInviteAcceptance("Ok");
    expect(acceptance.disposition).toBe("ignored");
    expect(acceptance.reply_meaning).toBe("unclear");
  });

  it("F2 — meta change please after invite → shell, raw not CBS", () => {
    const raw = "I want to change my goal, please.";
    const { acceptance } = freeformInviteAcceptance(raw);
    expect(acceptance.disposition).toBe("accepted");
    expect(acceptance.reply_meaning).toBe("change_goal");
    expect(acceptance.concrete_bar_present).toBe(false);
    expect(acceptance.proposed_bar_text).toBeNull();
  });

  it("G2 — same positivity text without invite does not accept via invite path", () => {
    const invite = deriveRecentCoachGoalEvolutionInviteFromEvents({
      eventsNewestFirst: [],
      commitment: baseCommitment(),
      nowMs: NOW_MS,
      lastOutboundFullBody: "Did you hit your walk today?",
      lastOutboundSentAtMs: NOW_MS - 60_000,
    });
    expect(invite.last_outbound_is_invite).toBe(false);
    const acceptance = evaluateCoachInviteAcceptanceContext({
      invite,
      userMessage: DONNA,
      commitment: baseCommitment(),
      classificationEventType: null,
      plannedInterruptionActionable: false,
      nowMs: NOW_MS,
    });
    expect(acceptance.disposition).toBe("skip");
  });

  it("substantiveContinuation is neutered (never opens by length)", () => {
    expect(isSubstantiveGoalChangeInviteContinuation("Stay 1 week more with that goal")).toBe(
      false
    );
    expect(
      isSubstantiveGoalChangeInviteContinuation(
        "That makes sense and I want to keep working on positivity every day"
      )
    ).toBe(false);
  });
});
