import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { InboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import { EMPTY_INBOUND_SOL_WIN_PRESENTATION } from "@/lib/inbound-sol-coaching-brief";

const persistSolInboundUserEvidence = vi.hoisted(() => vi.fn());
const persistInboundAccountabilityOutcomeEvent = vi.hoisted(() => vi.fn());
const persistInboundWinsWithAccountability = vi.hoisted(() => vi.fn());
const persistRecognizedWins = vi.hoisted(() => vi.fn());
const scheduleC1IfWinsDurable = vi.hoisted(() => vi.fn());
const scheduleInboundMmsD1SemanticClaim = vi.hoisted(() => vi.fn(() => null));
const scheduleInboundMmsD2cSemanticClaim = vi.hoisted(() => vi.fn(() => null));
const loadInboundRelationshipPacket = vi.hoisted(() => vi.fn());
const runInboundSolBriefInterpreter = vi.hoisted(() => vi.fn());
const writeInboundSolBody = vi.hoisted(() => vi.fn());
const recognizeWinsFromInboundV1 = vi.hoisted(() => vi.fn());
const classifyWinCandidatesEquivalenceV1 = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const setBlockerCapturePending = vi.hoisted(() => vi.fn());
const applySolAnsweredOpenCoachQuestion = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, applied: false as const, reason: "no_answered_question" }))
);

vi.mock("@/lib/inbound-sol-user-evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-sol-user-evidence")>();
  return {
    ...actual,
    persistSolInboundUserEvidence,
  };
});

vi.mock("@/lib/v2-inbound-accountability-outcome-persist", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-inbound-accountability-outcome-persist")>();
  return {
    ...actual,
    persistInboundAccountabilityOutcomeEvent,
  };
});

vi.mock("@/lib/v2-win-persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-win-persist")>();
  return {
    ...actual,
    persistInboundWinsWithAccountability,
    persistRecognizedWins,
  };
});

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  scheduleC1IfWinsDurable,
}));

vi.mock("@/lib/victory-media/inbound-mms-d1-claim", () => ({
  scheduleInboundMmsD1SemanticClaim,
}));

vi.mock("@/lib/victory-media/inbound-mms-d2c-claim", () => ({
  scheduleInboundMmsD2cSemanticClaim,
}));

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory,
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    setBlockerCapturePending,
  };
});

vi.mock("@/lib/v2-commitment-sms-thread-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment-sms-thread-memory")>();
  return {
    ...actual,
    applySolAnsweredOpenCoachQuestion,
  };
});

vi.mock("@/lib/inbound-relationship-packet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-relationship-packet")>();
  return {
    ...actual,
    loadInboundRelationshipPacket,
  };
});

vi.mock("@/lib/inbound-sol-brief-interpreter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-sol-brief-interpreter")>();
  return {
    ...actual,
    runInboundSolBriefInterpreter,
  };
});

vi.mock("@/lib/inbound-sol-writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-sol-writer")>();
  return {
    ...actual,
    writeInboundSolBody,
  };
});

vi.mock("@/lib/openai-win-recognition-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai-win-recognition-v1")>();
  return {
    ...actual,
    recognizeWinsFromInboundV1,
  };
});

vi.mock("@/lib/openai-win-candidate-equivalence-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai-win-candidate-equivalence-v1")>();
  return {
    ...actual,
    classifyWinCandidatesEquivalenceV1,
  };
});

import { runInboundSolRelationshipTurn } from "@/lib/inbound-sol-relationship-turn";

const commitment = {
  id: "c1",
  behavior_statement: "Lift 30 minutes",
  title: "Lift",
} as ActiveV2CommitmentRow;

function brief(
  overrides: Partial<InboundCoachingBriefV1["inbound"]> = {},
  continuityOverrides: Partial<InboundCoachingBriefV1["conversation_continuity"]> = {}
): InboundCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "Completed the lift",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "background",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Got the whole thing finished before lunch.",
      outcome: "completed",
      evidence_note: "User reported finishing",
      evidence_strength: "stated_once",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: true,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: null,
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
      ...continuityOverrides,
    },
    goal_role_today: {
      canonical_goal: "Lift 30 minutes",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "central",
      note: "Completion today",
    },
    coaching_direction: {
      primary_move: "celebrate",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "History is not style.",
    },
    inbound: {
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "central",
        outcome: "completed",
        confidence: "high",
        evidence: "Got the whole thing finished before lunch.",
      },
      meaningful_win: null,
      pending_photo_relation: { relation: "none", target_win_id: null },
      durable_user_evidence: null,
      win_presentation: EMPTY_INBOUND_SOL_WIN_PRESENTATION,
      ...overrides,
    },
  };
}

describe("runInboundSolRelationshipTurn", () => {
  beforeEach(() => {
    persistSolInboundUserEvidence.mockReset();
    persistSolInboundUserEvidence.mockResolvedValue({ status: "none", reason: "null_capture" });
    persistInboundAccountabilityOutcomeEvent.mockReset();
    scheduleC1IfWinsDurable.mockReset();
    scheduleInboundMmsD1SemanticClaim.mockReset();
    scheduleInboundMmsD1SemanticClaim.mockReturnValue(null);
    scheduleInboundMmsD2cSemanticClaim.mockReset();
    scheduleInboundMmsD2cSemanticClaim.mockReturnValue(null);
    persistInboundWinsWithAccountability.mockReset();
    persistRecognizedWins.mockReset();
    loadInboundRelationshipPacket.mockReset();
    runInboundSolBriefInterpreter.mockReset();
    writeInboundSolBody.mockReset();
    recognizeWinsFromInboundV1.mockReset();
    classifyWinCandidatesEquivalenceV1.mockReset();
    recomputeV2CoachingMemory.mockReset();
    setBlockerCapturePending.mockReset();
    applySolAnsweredOpenCoachQuestion.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    setBlockerCapturePending.mockResolvedValue(undefined);
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({
      ok: true,
      applied: false,
      reason: "no_answered_question",
    });

    loadInboundRelationshipPacket.mockImplementation(async (args: { receivedAt?: Date | string | null }) => ({
      ok: true,
      receivedAt:
        args.receivedAt instanceof Date
          ? args.receivedAt
          : typeof args.receivedAt === "string"
            ? new Date(args.receivedAt)
            : new Date("2026-08-18T16:00:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/Chicago",
          local_date: "2026-08-18",
          local_weekday: "Tuesday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null, open_coach_question: null },
        latest_inbound_text: "Got the whole thing finished before lunch.",
        latest_inbound_message_sid: "SMfin",
        pending_media_context: {
          candidate_count: 0,
          candidate: null,
          recent_wins: [],
        },
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: [],
          omitted_older_turn_count: 0,
        },
      },
    }));

    persistInboundAccountabilityOutcomeEvent.mockResolvedValue({
      status: "inserted",
      eventType: "user_yes",
      eventId: "evt1",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    });
    persistInboundWinsWithAccountability.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "w1", status: "inserted", idempotency_key: "win_v1:acc_yes:SMfin" }],
    });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "wlife", status: "inserted", idempotency_key: "win_v1:SMfin:0" }],
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you finished before lunch.",
      capture: { retry_occurred: false },
    });
  });

  it("persists user_yes from Sol even when classifier is other, then sends body A unchanged", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(),
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Got the whole thing finished before lunch.",
      messageSid: "SMfin",
      recentEventsNewestFirst: [],
      gatedDecision: defaultGatedDecision("user_no", "test"),
      classifierEventType: "user_no",
      classifierNormalizedHint: null,
      exclusiveLaneOwnsTurn: false,
      pendingConfirmationConflict: false,
    });

    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Proud you finished before lunch.");
    expect(persistInboundAccountabilityOutcomeEvent).toHaveBeenCalledTimes(1);
    expect(persistInboundAccountabilityOutcomeEvent.mock.calls[0]?.[0]?.eventType).toBe(
      "user_yes"
    );
    expect(persistInboundWinsWithAccountability).toHaveBeenCalledTimes(1);
    expect(persistRecognizedWins).not.toHaveBeenCalled();
    expect(recognizeWinsFromInboundV1).not.toHaveBeenCalled();
    expect(classifyWinCandidatesEquivalenceV1).not.toHaveBeenCalled();
    expect(recomputeV2CoachingMemory).toHaveBeenCalledWith("c1", {
      reasonCode: "inbound_user_outcome",
    });
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
    expect(scheduleC1IfWinsDurable).toHaveBeenCalledWith({
      persisted: 1,
      conflicts: 0,
      clerkUserId: "user_1",
      messageSid: "SMfin",
    });
  });

  it("passes display-only trophy overlays after user_yes without a second persist path", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        win_presentation: {
          accountability_trophy_title: "Lifted Weights",
          life_trophy_title: null,
        },
      }),
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "yes",
      messageSid: "SMfin",
      recentEventsNewestFirst: [],
      gatedDecision: defaultGatedDecision("user_no", "test"),
      classifierEventType: "user_no",
      classifierNormalizedHint: null,
      exclusiveLaneOwnsTurn: false,
      pendingConfirmationConflict: false,
    });

    expect(persistInboundWinsWithAccountability).toHaveBeenCalledTimes(1);
    expect(persistInboundWinsWithAccountability.mock.calls[0]?.[0]?.displayTitleOverrides).toEqual({
      accountability: "Lifted Weights",
      independent: null,
    });
    expect(recognizeWinsFromInboundV1).not.toHaveBeenCalled();
  });

  it("C1 persist hook throw cannot block Sol Coach send", async () => {
    scheduleC1IfWinsDurable.mockImplementation(() => {
      throw new Error("c1 boom");
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(),
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Got the whole thing finished before lunch.",
      messageSid: "SMfin",
      recentEventsNewestFirst: [],
      gatedDecision: defaultGatedDecision("user_no", "test"),
      classifierEventType: "user_no",
      classifierNormalizedHint: null,
      exclusiveLaneOwnsTurn: false,
      pendingConfirmationConflict: false,
    });

    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Proud you finished before lunch.");
    expect(persistInboundWinsWithAccountability).toHaveBeenCalledTimes(1);
  });

  it("classifier user_yes + Sol plan → no proof row and still writes", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "central",
          outcome: "plan",
          confidence: "high",
          evidence: "I'm going to do it tomorrow.",
        },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Tomorrow works. One lift when you can.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "I'm going to do it tomorrow.",
      messageSid: "SMplan",
      recentEventsNewestFirst: [],
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      classifierEventType: "user_yes",
      classifierNormalizedHint: null,
      exclusiveLaneOwnsTurn: false,
      pendingConfirmationConflict: false,
    });

    expect(persistInboundAccountabilityOutcomeEvent).not.toHaveBeenCalled();
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
    expect(result.persistResult.status).toBe("skipped");
    expect(result.shouldSend).toBe(true);
  });

  it("no-send on interpreter failure — no fallback writer", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: false,
      brief: null,
      error: "invalid_json",
      capture: { retry_occurred: true },
    });

    const result = await runInboundSolRelationshipTurn({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "hello",
      messageSid: "SMfail",
      recentEventsNewestFirst: [],
      gatedDecision: defaultGatedDecision("user_no", "test"),
      classifierEventType: "user_no",
      classifierNormalizedHint: null,
      exclusiveLaneOwnsTurn: false,
      pendingConfirmationConflict: false,
    });

    expect(result.shouldSend).toBe(false);
    expect(writeInboundSolBody).not.toHaveBeenCalled();
    expect(applySolAnsweredOpenCoachQuestion).not.toHaveBeenCalled();
    expect(result.noSendReason).toContain("interpreter_");
  });

  const turnArgs = (messageSid: string, text: string) => ({
    clerkUserId: "user_1",
    timezone: "America/Chicago",
    commitment,
    latestInboundText: text,
    messageSid,
    recentEventsNewestFirst: [] as [],
    gatedDecision: defaultGatedDecision("user_no", "test"),
    classifierEventType: "user_no" as const,
    classifierNormalizedHint: null,
    exclusiveLaneOwnsTurn: false,
    pendingConfirmationConflict: false,
    receivedAt: new Date("2026-08-18T16:00:00.000Z"),
  });

  it("user_no: event persisted, recompute + blocker pending before writer", async () => {
    const order: string[] = [];
    persistInboundAccountabilityOutcomeEvent.mockImplementation(async () => {
      order.push("persist");
      return {
        status: "inserted",
        eventType: "user_no",
        eventId: "e-no",
        idempotencyKey: "k",
        overrideGatedNoWrite: false,
      };
    });
    recomputeV2CoachingMemory.mockImplementation(async () => {
      order.push("recompute");
    });
    setBlockerCapturePending.mockImplementation(async () => {
      order.push("blocker");
    });
    writeInboundSolBody.mockImplementation(async () => {
      order.push("writer");
      return { ok: true, body: "Got it. What got in the way?", capture: { retry_occurred: false } };
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "central",
          outcome: "missed",
          confidence: "high",
          evidence: "I missed it.",
        },
      }),
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMno", "I missed it."));
    expect(result.shouldSend).toBe(true);
    expect(persistInboundAccountabilityOutcomeEvent.mock.calls[0]?.[0]?.eventType).toBe("user_no");
    expect(recomputeV2CoachingMemory).toHaveBeenCalledTimes(1);
    expect(setBlockerCapturePending).toHaveBeenCalledWith("c1", "user_no");
    expect(order).toEqual(["persist", "recompute", "blocker", "writer"]);
  });

  it("user_partial: event persisted, recompute + blocker pending before writer", async () => {
    const order: string[] = [];
    persistInboundAccountabilityOutcomeEvent.mockImplementation(async () => {
      order.push("persist");
      return {
        status: "inserted",
        eventType: "user_partial",
        eventId: "e-p",
        idempotencyKey: "k",
        overrideGatedNoWrite: false,
      };
    });
    recomputeV2CoachingMemory.mockImplementation(async () => {
      order.push("recompute");
    });
    setBlockerCapturePending.mockImplementation(async () => {
      order.push("blocker");
    });
    writeInboundSolBody.mockImplementation(async () => {
      order.push("writer");
      return { ok: true, body: "Ten minutes is a start. What got in the way of the rest?", capture: { retry_occurred: false } };
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "central",
          outcome: "partial",
          confidence: "high",
          evidence: "I got 15 minutes in.",
        },
      }),
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMpart", "I got 15 minutes in."));
    expect(result.shouldSend).toBe(true);
    expect(persistInboundAccountabilityOutcomeEvent.mock.calls[0]?.[0]?.eventType).toBe(
      "user_partial"
    );
    expect(setBlockerCapturePending).toHaveBeenCalledWith("c1", "user_partial");
    expect(order.indexOf("recompute")).toBeLessThan(order.indexOf("writer"));
    expect(order.indexOf("blocker")).toBeLessThan(order.indexOf("writer"));
  });

  it("user_no + life: user_no row and distinct life win, no accountability merge", async () => {
    persistInboundAccountabilityOutcomeEvent.mockResolvedValue({
      status: "inserted",
      eventType: "user_no",
      eventId: "e-no",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "central",
          outcome: "missed",
          confidence: "high",
          evidence: "Missed the lift.",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother through a hard situation",
          relationship: "life",
        },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Sorry about the lift. Proud you showed up for your brother.",
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn(
      turnArgs("SMnl", "Missed the lift. Helped my brother through a hard situation.")
    );
    expect(persistInboundAccountabilityOutcomeEvent.mock.calls[0]?.[0]?.eventType).toBe("user_no");
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(persistRecognizedWins.mock.calls[0]?.[0]?.recognition?.wins?.[0]?.relationship_type).toBe(
      "whole_life"
    );
    expect(persistRecognizedWins.mock.calls[0]?.[0]?.occurredAtIso).toBe(
      "2026-08-18T16:00:00.000Z"
    );
  });

  it("user_partial + life: user_partial row and distinct life win", async () => {
    persistInboundAccountabilityOutcomeEvent.mockResolvedValue({
      status: "inserted",
      eventType: "user_partial",
      eventId: "e-p",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "central",
          outcome: "partial",
          confidence: "high",
          evidence: "Got 10 minutes.",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Sat with my dad at the hospital",
          relationship: "life",
        },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Ten minutes is real. Glad you were with your dad.",
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn(turnArgs("SMpl", "Got 10 minutes. Sat with my dad at the hospital."));
    expect(persistInboundAccountabilityOutcomeEvent.mock.calls[0]?.[0]?.eventType).toBe(
      "user_partial"
    );
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
  });

  it("same-day yes skip + life: no second yes, life win still persists", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother through a hard situation",
          relationship: "life",
        },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Already counted the lift. Proud you helped your brother.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      ...turnArgs("SMskip", "I completed my lift and helped my brother."),
      recentEventsNewestFirst: [
        {
          event_type: "user_yes",
          occurred_at: "2026-08-18T12:00:00.000Z",
          payload_json: {},
        } as never,
      ],
    });

    expect(persistInboundAccountabilityOutcomeEvent).not.toHaveBeenCalled();
    expect(result.persistResult.status).toBe("skipped");
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
  });

  it("life-only: no accountability row, life win persists", async () => {
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "Life update, not the goal.",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother through a hard situation",
          relationship: "life",
        },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you showed up for your brother.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMlife", "Helped my brother through a hard situation.")
    );
    expect(persistInboundAccountabilityOutcomeEvent).not.toHaveBeenCalled();
    expect(result.persistResult.status).toBe("skipped");
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
  });

  it("uses receive-time ISO for life-win occurredAt, not process now", async () => {
    persistInboundAccountabilityOutcomeEvent.mockResolvedValue({
      status: "inserted",
      eventType: "user_yes",
      eventId: "e-yes",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(),
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn({
      ...turnArgs("SMrecv", "Got the whole thing finished before lunch."),
      receivedAt: new Date("2026-08-19T04:59:00.000Z"),
    });
    expect(persistInboundWinsWithAccountability.mock.calls[0]?.[0]?.occurredAtIso).toBe(
      "2026-08-19T04:59:00.000Z"
    );
  });

  const PHOTO_JOB = "aaaaaaaa-1111-4111-8111-111111111111";
  const WIN_HIKING = "cccccccc-3333-4333-8333-333333333333";
  const onePending = {
    candidate_count: 1 as const,
    candidate: {
      job_id: PHOTO_JOB,
      age_seconds: 120,
      message_sid: "SMdddddddddddddddddddddddddddddddd",
      normalized_ready: true as const,
    },
    recent_wins: [
      {
        id: WIN_HIKING,
        text: "Kids hiking",
        occurred_at: "2026-08-20T12:00:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
        has_media: false,
      },
    ],
  };

  function packetWithPending() {
    loadInboundRelationshipPacket.mockImplementation(async (args: { receivedAt?: Date | string | null }) => ({
      ok: true,
      receivedAt:
        args.receivedAt instanceof Date
          ? args.receivedAt
          : new Date("2026-08-18T16:00:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/Chicago",
          local_date: "2026-08-18",
          local_weekday: "Tuesday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null, open_coach_question: null },
        latest_inbound_text: "This was me finally taking the kids hiking.",
        latest_inbound_message_sid: "SMhike",
        pending_media_context: onePending,
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: [],
          omitted_older_turn_count: 0,
        },
      },
    }));
  }

  it("D1 current_turn_win schedules claim after one durable Win", async () => {
    packetWithPending();
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "wlife", status: "inserted", idempotency_key: "k" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "This was me finally taking the kids hiking.",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took the kids hiking",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you took the kids hiking.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMhike", "This was me finally taking the kids hiking.")
    );
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    const arg = scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0];
    expect(arg.context.candidate_count).toBe(1);
    expect(arg.currentMessageSid).toBe("SMhike");
    expect(arg.relation.relation).toBe("current_turn_win");
    expect(arg.winResult?.wins).toEqual([
      expect.objectContaining({ id: "wlife", status: "inserted" }),
    ]);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
  });

  it("D1 claim scheduler throw cannot block Coach send", async () => {
    packetWithPending();
    scheduleInboundMmsD1SemanticClaim.mockImplementation(() => {
      throw new Error("d1 boom");
    });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "wlife", status: "inserted", idempotency_key: "k" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "hiking",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took the kids hiking",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you took the kids hiking.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMhike", "This was me finally taking the kids hiking.")
    );
    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Proud you took the kids hiking.");
  });

  it("D1 blocks photo-saved Coach copy before canonical attach", async () => {
    packetWithPending();
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "wlife", status: "inserted", idempotency_key: "k" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "hiking",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took the kids hiking",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "I saved your photo.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMhike", "This was me finally taking the kids hiking.")
    );
    expect(result.shouldSend).toBe(false);
    expect(result.noSendReason).toBe("blocked_photo_saved_before_canonical_attach");
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
  });

  it("D1 still allows Win-saved language when a photo claim is only queued", async () => {
    packetWithPending();
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "wlife", status: "inserted", idempotency_key: "k" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "hiking",
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took the kids hiking",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you took the kids hiking. I saved that Win.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMhike", "This was me finally taking the kids hiking.")
    );
    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Proud you took the kids hiking. I saved that Win.");
  });

  it("D1 production caption: family-day text with one ~5min photo claims current_turn_win", async () => {
    const familyText =
      "Awesome family day today! Loved spending time with Brooke and the kids";
    const familyWinId = "ffffffff-6666-4666-8666-666666666666";
    loadInboundRelationshipPacket.mockImplementation(async () => ({
      ok: true,
      receivedAt: new Date("2026-08-22T00:15:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/New_York",
          local_date: "2026-08-21",
          local_weekday: "Friday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null, open_coach_question: null },
        latest_inbound_text: familyText,
        latest_inbound_message_sid: "SMfamily",
        pending_media_context: {
          candidate_count: 1,
          candidate: {
            job_id: PHOTO_JOB,
            age_seconds: 300,
            message_sid: "MM0c95783f12557186ce311ef3e03c1801",
            normalized_ready: true,
          },
          recent_wins: [],
        },
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: [],
          omitted_older_turn_count: 0,
        },
      },
    }));
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: familyWinId, status: "inserted", idempotency_key: "kfam" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: familyText,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Spent an enjoyable family day with Brooke and the kids.",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Sounds like a really good day with Brooke and the kids.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMfamily", familyText));
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    const arg = scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0];
    expect(arg.context.candidate_count).toBe(1);
    expect(arg.context.candidate.job_id).toBe(PHOTO_JOB);
    expect(arg.context.candidate.age_seconds).toBe(300);
    expect(arg.relation).toEqual({ relation: "current_turn_win", target_win_id: null });
    expect(arg.winResult?.wins).toEqual([
      expect.objectContaining({ id: familyWinId, status: "inserted" }),
    ]);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
  });

  it("D1 production vacation: 17m photo claims current_turn_win; 10h photo is not the candidate", async () => {
    const vacationText =
      "So proud that we took our kids on a family vacation. It was the best yet.";
    const freshJobId = "2cf694ea-ba64-4323-a56f-bdb9a4075136";
    const oldJobId = "dba40005-52c2-43bd-a4c1-edadc3ebff7e";
    const vacationWinId = "cecc9398-ca3b-46a6-9393-87c9be246665";
    loadInboundRelationshipPacket.mockImplementation(async () => ({
      ok: true,
      receivedAt: new Date("2026-08-22T11:15:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/New_York",
          local_date: "2026-08-22",
          local_weekday: "Saturday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null, open_coach_question: null },
        latest_inbound_text: vacationText,
        latest_inbound_message_sid: "SMvacation",
        pending_media_context: {
          candidate_count: 1,
          candidate: {
            job_id: freshJobId,
            age_seconds: 17 * 60,
            message_sid: "MM2cf694eaba644323a56fbdb9a4075136",
            normalized_ready: true,
          },
          recent_wins: [],
        },
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: [],
          omitted_older_turn_count: 0,
        },
      },
    }));
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: vacationWinId, status: "inserted", idempotency_key: "kvac" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: vacationText,
        },
        meaningful_win: {
          present: true,
          grounded_action:
            "Tyler and Brooke took their kids on a family vacation that he describes as their best yet.",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "That sounds like a trip worth keeping.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMvacation", vacationText)
    );
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    const arg = scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0];
    expect(arg.context.candidate_count).toBe(1);
    expect(arg.context.candidate.job_id).toBe(freshJobId);
    expect(arg.context.candidate.job_id).not.toBe(oldJobId);
    expect(JSON.stringify(arg.context)).not.toContain(oldJobId);
    expect(arg.context.candidate.age_seconds).toBe(17 * 60);
    expect(arg.relation).toEqual({ relation: "current_turn_win", target_win_id: null });
    expect(arg.winResult?.wins).toEqual([
      expect.objectContaining({ id: vacationWinId, status: "inserted" }),
    ]);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
  });

  it("D1 unrelated later text does not claim the pending photo", async () => {
    packetWithPending();
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "What time is my check-in tomorrow?",
        },
        meaningful_win: null,
        pending_photo_relation: { relation: "none", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Check-in is in the morning text.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMchk", "What time is my check-in tomorrow?")
    );
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    const arg = scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0];
    expect(arg.relation.relation).toBe("none");
  });

  it("D1 genuine uncertainty does not claim", async () => {
    packetWithPending();
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "low",
          evidence: "ok",
        },
        meaningful_win: null,
        pending_photo_relation: { relation: "uncertain", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Got you.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMok", "ok"));
    expect(result.shouldSend).toBe(true);
    const arg = scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0];
    expect(arg.relation.relation).toBe("uncertain");
  });

  it("D2c pending_user answer schedules D0 after the durable Win, not D1", async () => {
    const question = "What made this one a win for you?";
    const lakeText = "I took Lakelyn to her first dance class.";
    const lakeWinId = "ffffffff-7777-4777-8777-777777777777";
    loadInboundRelationshipPacket.mockImplementation(async () => ({
      ok: true,
      receivedAt: new Date("2026-08-22T16:10:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/Chicago",
          local_date: "2026-08-22",
          local_weekday: "Saturday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null, open_coach_question: null },
        latest_inbound_text: lakeText,
        latest_inbound_message_sid: "SMlake",
        pending_media_context: {
          candidate_count: 1,
          candidate: {
            job_id: PHOTO_JOB,
            age_seconds: 2400,
            message_sid: "SMdddddddddddddddddddddddddddddddd",
            normalized_ready: true,
            awaiting_user: true,
            clarification_body: question,
          },
          recent_wins: [],
        },
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: [],
          omitted_older_turn_count: 0,
        },
      },
    }));
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: lakeWinId, status: "inserted", idempotency_key: "klake" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: lakeText,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took Lakelyn to her first dance class",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Love that you took Lakelyn to her first dance class.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMlake", lakeText));
    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Love that you took Lakelyn to her first dance class.");
    expect(scheduleInboundMmsD2cSemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim).not.toHaveBeenCalled();
    const arg = scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0];
    expect(arg.context.candidate.awaiting_user).toBe(true);
    expect(arg.context.candidate.clarification_body).toBe(question);
    expect(arg.relation).toEqual({ relation: "current_turn_win", target_win_id: null });
    expect(arg.winResult?.wins).toEqual([
      expect.objectContaining({ id: lakeWinId, status: "inserted" }),
    ]);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
  });

  const MEETING_Q = "How did the meeting go?";
  const PHOTO_Q = "What made this one a win for you?";
  const d2cPending = {
    candidate_count: 1 as const,
    candidate: {
      job_id: PHOTO_JOB,
      age_seconds: 2400,
      message_sid: "SMdddddddddddddddddddddddddddddddd",
      normalized_ready: true as const,
      awaiting_user: true as const,
      clarification_body: PHOTO_Q,
    },
    recent_wins: [] as [],
  };

  function packetWithD2c(overrides: {
    latestInboundText: string;
    latestInboundMessageSid?: string;
    openCoachQuestion?: {
      text: string;
      expected_answer_type: string | null;
      pending: boolean;
      asked_at: string | null;
    } | null;
    pendingMedia?: {
      candidate_count: 0 | 1 | 2;
      candidate: (typeof d2cPending)["candidate"] | (typeof onePending)["candidate"] | null;
      recent_wins: unknown[];
    };
    exactThreadMessages?: unknown[];
  }) {
    loadInboundRelationshipPacket.mockImplementation(async (args: {
      receivedAt?: Date | string | null;
      currentTurnMessageSids?: string[];
    }) => {
      void args.currentTurnMessageSids;
      return {
      ok: true,
      receivedAt:
        args.receivedAt instanceof Date
          ? args.receivedAt
          : new Date("2026-08-22T16:10:00.000Z"),
      packet: {
        version: "inbound_relationship_v1",
        message_for: {
          timezone: "America/Chicago",
          local_date: "2026-08-22",
          local_weekday: "Saturday",
          daypart: "inbound",
        },
        preferred_name: "Tyler",
        current_goal: { text: "Lift 30 minutes" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: {
          pending_goal_change: null,
          open_coach_question:
            overrides.openCoachQuestion === undefined
              ? null
              : overrides.openCoachQuestion,
        },
        latest_inbound_text: overrides.latestInboundText,
        latest_inbound_message_sid: overrides.latestInboundMessageSid ?? "SMlake",
        pending_media_context: overrides.pendingMedia ?? d2cPending,
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: overrides.exactThreadMessages ?? [],
          omitted_older_turn_count: 0,
        },
      },
    };
    });
  }

  it("O: answering the photo does not clear an unrelated open Coach question in this turn", async () => {
    const lakeText = "Taking Lakelyn to her first dance class.";
    const lakeWinId = "ffffffff-7777-4777-8777-777777777777";
    packetWithD2c({
      latestInboundText: lakeText,
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
    });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: lakeWinId, status: "inserted", idempotency_key: "klake" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: lakeText,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took Lakelyn to her first dance class",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Love that you took Lakelyn.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMlake", lakeText));
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD2cSemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
    expect(result.packet?.hard_state.open_coach_question?.text).toBe(MEETING_Q);
    expect(result.packet?.hard_state.open_coach_question?.pending).toBe(true);
    const writerPacket = writeInboundSolBody.mock.calls[0]?.[0]?.packet;
    expect(writerPacket?.hard_state.open_coach_question?.text).toBe(MEETING_Q);
    expect(writerPacket?.hard_state.open_coach_question?.pending).toBe(true);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        messageSid: "SMlake",
        expectedOpenQuestion: expect.objectContaining({ text: MEETING_Q, pending: true }),
        answeredQuestion: null,
        canonicalHumanTurnText: lakeText,
      })
    );
  });

  it("P: answering the other live question does not claim the pending photo", async () => {
    const meetingText = "The meeting went well — we locked the timeline.";
    packetWithD2c({
      latestInboundText: meetingText,
      latestInboundMessageSid: "SMmeet",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          answer_priority: "first",
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: meetingText,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        {
          answered_question: {
            question: MEETING_Q,
            answer: meetingText,
          },
        }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Glad the meeting locked the timeline.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMmeet", meetingText)
    );
    expect(result.shouldSend).toBe(true);
    expect(scheduleInboundMmsD2cSemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim).not.toHaveBeenCalled();
    expect(scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0]?.relation.relation).toBe(
      "none"
    );
    expect(persistRecognizedWins).not.toHaveBeenCalled();
    expect(result.packet?.pending_media_context.candidate?.awaiting_user).toBe(true);
    expect(result.packet?.pending_media_context.candidate?.clarification_body).toBe(
      PHOTO_Q
    );
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        messageSid: "SMmeet",
        expectedOpenQuestion: expect.objectContaining({ text: MEETING_Q, pending: true }),
        answeredQuestion: { question: MEETING_Q, answer: meetingText },
        canonicalHumanTurnText: meetingText,
      })
    );
  });

  it("A: Sol-authored meeting answer closes via post-Sol apply with no photo", async () => {
    const meetingText = "The meeting went really well.";
    packetWithD2c({
      latestInboundText: meetingText,
      latestInboundMessageSid: "SMmeetA",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
      pendingMedia: { candidate_count: 0, candidate: null, recent_wins: [] },
    });
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({ ok: true, applied: true });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: meetingText,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        { answered_question: { question: MEETING_Q, answer: meetingText } }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Glad the meeting went well.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMmeetA", meetingText));
    expect(result.shouldSend).toBe(true);
    expect(result.packet?.hard_state.open_coach_question?.pending).toBe(true);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledTimes(1);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredQuestion: { question: MEETING_Q, answer: meetingText },
        expectedOpenQuestion: expect.objectContaining({ pending: true, text: MEETING_Q }),
        canonicalHumanTurnText: meetingText,
      })
    );
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
  });

  it("generic answered_question for another exact-thread Coach Q is passed through", async () => {
    const otherQ = "What will you protect tomorrow?";
    const humanText = "The first 30 minutes before email.";
    packetWithD2c({
      latestInboundText: humanText,
      latestInboundMessageSid: "SMprotect",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
      pendingMedia: { candidate_count: 0, candidate: null, recent_wins: [] },
    });
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({
      ok: true,
      applied: false,
      reason: "question_mismatch",
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: humanText,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        { answered_question: { question: otherQ, answer: humanText } }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Protect that first half hour.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMprotect", humanText));
    expect(result.shouldSend).toBe(true);
    expect(result.packet?.hard_state.open_coach_question?.pending).toBe(true);
    expect(result.brief?.conversation_continuity.answered_question).toEqual({
      question: otherQ,
      answer: humanText,
    });
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredQuestion: { question: otherQ, answer: humanText },
        expectedOpenQuestion: expect.objectContaining({ text: MEETING_Q, pending: true }),
        canonicalHumanTurnText: humanText,
      })
    );
  });

  it("last-ask apply receives coalesced human turn text, not a raw SID fragment", async () => {
    const coalesced = "I took Lakelyn to her first dance class.";
    packetWithD2c({
      latestInboundText: coalesced,
      latestInboundMessageSid: "SMpart3",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
      pendingMedia: { candidate_count: 0, candidate: null, recent_wins: [] },
    });
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({ ok: true, applied: true });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: coalesced,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        {
          answered_question: {
            question: MEETING_Q,
            answer: "Lakelyn's first dance class.",
          },
        }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Love that first class.",
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn({
      ...turnArgs("SMpart3", coalesced),
      currentTurnMessageSids: ["SMpart1", "SMpart2", "SMpart3"],
    });

    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        messageSid: "SMpart3",
        canonicalHumanTurnText: coalesced,
        answeredQuestion: {
          question: MEETING_Q,
          answer: "Lakelyn's first dance class.",
        },
      })
    );
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledTimes(1);
  });

  it("E: one turn can apply meeting close and photo current_turn_win independently", async () => {
    const bothText =
      "The meeting went great, and that picture was from taking Lakelyn to her first dance class.";
    const lakeWinId = "ffffffff-7777-4777-8777-777777777777";
    packetWithD2c({
      latestInboundText: bothText,
      latestInboundMessageSid: "SMboth",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
    });
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({ ok: true, applied: true });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: lakeWinId, status: "inserted", idempotency_key: "kboth" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: bothText,
          },
          meaningful_win: {
            present: true,
            grounded_action: "Took Lakelyn to her first dance class",
            relationship: "life",
          },
          pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
        },
        { answered_question: { question: MEETING_Q, answer: "The meeting went great" } }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Glad the meeting went great — and love that first class.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMboth", bothText));
    expect(result.shouldSend).toBe(true);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredQuestion: { question: MEETING_Q, answer: "The meeting went great" },
      })
    );
    expect(scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0]?.relation.relation).toBe(
      "current_turn_win"
    );
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
  });

  it("F: direct question leaves the old open question for apply to skip", async () => {
    const q = "What time does Tennessee play?";
    packetWithD2c({
      latestInboundText: q,
      latestInboundMessageSid: "SMtennQ",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          answer_priority: "first",
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: q,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        { answered_question: null }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "I don't have live game times.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMtennQ", q));
    expect(result.shouldSend).toBe(true);
    expect(result.packet?.hard_state.open_coach_question?.pending).toBe(true);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredQuestion: null,
        expectedOpenQuestion: expect.objectContaining({ pending: true, text: MEETING_Q }),
      })
    );
    expect(scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0]?.relation.relation).toBe("none");
  });

  it("writer failure after Sol close apply still does not send and applies once", async () => {
    const meetingText = "The meeting went really well.";
    packetWithD2c({
      latestInboundText: meetingText,
      latestInboundMessageSid: "SMmeetFail",
      openCoachQuestion: {
        text: MEETING_Q,
        expected_answer_type: null,
        pending: true,
        asked_at: "2026-08-22T15:00:00.000Z",
      },
      pendingMedia: { candidate_count: 0, candidate: null, recent_wins: [] },
    });
    applySolAnsweredOpenCoachQuestion.mockResolvedValue({ ok: true, applied: true });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief(
        {
          accountability_interpretation: {
            relevance: "unrelated",
            outcome: "not_applicable",
            confidence: "high",
            evidence: meetingText,
          },
          meaningful_win: null,
          pending_photo_relation: { relation: "none", target_win_id: null },
        },
        { answered_question: { question: MEETING_Q, answer: meetingText } }
      ),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: false,
      error: "openai_request_failed",
      body: null,
      capture: { retry_occurred: true },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMmeetFail", meetingText));
    expect(result.shouldSend).toBe(false);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledTimes(1);
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
  });

  it("writer failure after D2c schedule still persists one Win and does not send", async () => {
    const lakeText = "I took Lakelyn to her first dance class.";
    const lakeWinId = "ffffffff-7777-4777-8777-777777777777";
    packetWithD2c({ latestInboundText: lakeText });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: lakeWinId, status: "inserted", idempotency_key: "klake" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: lakeText,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took Lakelyn to her first dance class",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: false,
      error: "openai_request_failed",
      body: null,
      capture: { retry_occurred: true },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMlake", lakeText));
    expect(result.shouldSend).toBe(false);
    expect(result.noSendReason).toBe("writer_openai_request_failed");
    expect(result.body).toBeNull();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(scheduleInboundMmsD2cSemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim).not.toHaveBeenCalled();
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
  });

  it("D2c Tennessee-game direct question: Sol none → no D0, one writer reply", async () => {
    const q = "What time does the Tennessee game start?";
    packetWithD2c({ latestInboundText: q, latestInboundMessageSid: "SMtenn" });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        answer_priority: "first",
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: q,
        },
        meaningful_win: null,
        pending_photo_relation: { relation: "none", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "I don't have live game times — check the kickoff listing.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMtenn", q));
    expect(result.shouldSend).toBe(true);
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
    expect(scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0]?.relation.relation).toBe(
      "none"
    );
    expect(persistRecognizedWins).not.toHaveBeenCalled();
    expect(result.packet?.pending_media_context.candidate?.awaiting_user).toBe(true);
  });

  it("D2c different unrelated Win does not claim the pending photo", async () => {
    const text = "I also crushed my presentation today.";
    const winId = "aaaaaaaa-8888-4888-8888-888888888888";
    packetWithD2c({ latestInboundText: text, latestInboundMessageSid: "SMpres" });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: winId, status: "inserted", idempotency_key: "kpres" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: text,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Crushed the presentation",
          relationship: "life",
        },
        pending_photo_relation: { relation: "none", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you crushed that presentation.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMpres", text));
    expect(result.shouldSend).toBe(true);
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(scheduleInboundMmsD2cSemanticClaim.mock.calls[0]?.[0]?.relation.relation).toBe(
      "none"
    );
    expect(result.packet?.pending_media_context.candidate?.awaiting_user).toBe(true);
  });

  it("reserved-unsent clarification is not treated as a sent D2c question", async () => {
    const text = "I took Lakelyn to her first dance class.";
    packetWithD2c({
      latestInboundText: text,
      pendingMedia: onePending,
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: text,
        },
        meaningful_win: null,
        pending_photo_relation: { relation: "none", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Got you.",
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn(turnArgs("SMlake", text));
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0]?.context.candidate?.awaiting_user).toBeUndefined();
    expect(
      scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0]?.context.candidate?.clarification_body
    ).toBeUndefined();
  });

  it("coalesced burst is one Sol turn, one persist, one D2c claim, one writer", async () => {
    const coalesced = "I took Lakelyn to dance class for the first time";
    const lakeWinId = "ffffffff-7777-4777-8777-777777777777";
    packetWithD2c({ latestInboundText: coalesced });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: lakeWinId, status: "inserted", idempotency_key: "klake" }],
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: coalesced,
        },
        meaningful_win: {
          present: true,
          grounded_action: "Took Lakelyn to dance class",
          relationship: "life",
        },
        pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Love that first dance class.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      ...turnArgs("SMpart3", coalesced),
      currentTurnMessageSids: ["SMpart1", "SMpart2", "SMpart3"],
    });
    expect(result.shouldSend).toBe(true);
    expect(runInboundSolBriefInterpreter).toHaveBeenCalledTimes(1);
    expect(applySolAnsweredOpenCoachQuestion).toHaveBeenCalledTimes(1);
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    expect(scheduleInboundMmsD2cSemanticClaim).toHaveBeenCalledTimes(1);
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
    expect(loadInboundRelationshipPacket.mock.calls[0]?.[0]?.currentTurnMessageSids).toEqual([
      "SMpart1",
      "SMpart2",
      "SMpart3",
    ]);
    expect(loadInboundRelationshipPacket.mock.calls[0]?.[0]?.latestInboundText).toBe(
      coalesced
    );
  });

  it("two pending_user jobs: no D2c claim and no D1 substitute", async () => {
    const text = "Taking Lakelyn to dance class.";
    packetWithD2c({
      latestInboundText: text,
      pendingMedia: {
        candidate_count: 2,
        candidate: null,
        recent_wins: [],
      },
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: text,
        },
        meaningful_win: null,
        pending_photo_relation: { relation: "none", target_win_id: null },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Got you.",
      capture: { retry_occurred: false },
    });

    await runInboundSolRelationshipTurn(turnArgs("SMlake", text));
    expect(scheduleInboundMmsD2cSemanticClaim).not.toHaveBeenCalled();
    expect(scheduleInboundMmsD1SemanticClaim).toHaveBeenCalledOnce();
    expect(scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0]?.context.candidate_count).toBe(
      2
    );
    expect(scheduleInboundMmsD1SemanticClaim.mock.calls[0]?.[0]?.context.candidate).toBeNull();
  });

  it("persists durable user evidence from loaded.receivedAt before writer", async () => {
    const receivedAt = new Date("2026-08-18T16:00:00.000Z");
    const order: string[] = [];
    persistSolInboundUserEvidence.mockImplementation(async () => {
      order.push("evidence");
      return { status: "inserted", reason: null };
    });
    writeInboundSolBody.mockImplementation(async () => {
      order.push("writer");
      return { ok: true, body: "Got it.", capture: { retry_occurred: false } };
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        durable_user_evidence: {
          exact_user_evidence: "I like when you challenge me directly.",
        },
      }),
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn({
      ...turnArgs("SMpref", "I like when you challenge me directly. Don't sugarcoat it."),
      receivedAt,
    });
    expect(result.shouldSend).toBe(true);
    expect(persistSolInboundUserEvidence).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      messageSid: "SMpref",
      latestInboundText: "Got the whole thing finished before lunch.",
      occurredAtIso: receivedAt.toISOString(),
      durableUserEvidence: {
        exact_user_evidence: "I like when you challenge me directly.",
      },
    });
    expect(order).toEqual(["evidence", "writer"]);
    expect(result.forensics.inbound_sol_durable_user_evidence_persist_status).toBe("inserted");
    expect(result.forensics.inbound_sol_durable_user_evidence_returned).toBe(true);
    expect(result.forensics.inbound_sol_historical_evidence_count).toBe(0);
  });

  it("durable evidence persist failure or throw cannot block Sol Coach send", async () => {
    persistSolInboundUserEvidence.mockRejectedValue(new Error("evidence boom"));
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        durable_user_evidence: { exact_user_evidence: "Don't sugarcoat it." },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you finished before lunch.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(turnArgs("SMfin", "Got the whole thing finished before lunch."));
    expect(result.shouldSend).toBe(true);
    expect(result.body).toBe("Proud you finished before lunch.");
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
    expect(result.forensics.inbound_sol_durable_user_evidence_persist_status).toBe("failed");
  });

  it("durable evidence validation_rejected still sends Coach reply", async () => {
    persistSolInboundUserEvidence.mockResolvedValue({
      status: "validation_rejected",
      reason: "not_latest_inbound_substring",
    });
    runInboundSolBriefInterpreter.mockResolvedValue({
      ok: true,
      brief: brief({
        durable_user_evidence: { exact_user_evidence: "User prefers direct coaching." },
      }),
      capture: { retry_occurred: false },
    });
    writeInboundSolBody.mockResolvedValue({
      ok: true,
      body: "Proud you finished before lunch.",
      capture: { retry_occurred: false },
    });

    const result = await runInboundSolRelationshipTurn(
      turnArgs("SMfin", "Got the whole thing finished before lunch.")
    );
    expect(result.shouldSend).toBe(true);
    expect(writeInboundSolBody).toHaveBeenCalledTimes(1);
    expect(result.forensics.inbound_sol_durable_user_evidence_persist_status).toBe(
      "validation_rejected"
    );
  });
});
