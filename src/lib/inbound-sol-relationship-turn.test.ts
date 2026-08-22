import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { InboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";

const persistInboundAccountabilityOutcomeEvent = vi.hoisted(() => vi.fn());
const persistInboundWinsWithAccountability = vi.hoisted(() => vi.fn());
const persistRecognizedWins = vi.hoisted(() => vi.fn());
const scheduleC1IfWinsDurable = vi.hoisted(() => vi.fn());
const scheduleInboundMmsD1SemanticClaim = vi.hoisted(() => vi.fn(() => null));
const loadInboundRelationshipPacket = vi.hoisted(() => vi.fn());
const runInboundSolBriefInterpreter = vi.hoisted(() => vi.fn());
const writeInboundSolBody = vi.hoisted(() => vi.fn());
const recognizeWinsFromInboundV1 = vi.hoisted(() => vi.fn());
const classifyWinCandidatesEquivalenceV1 = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const setBlockerCapturePending = vi.hoisted(() => vi.fn());

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

function brief(overrides: Partial<InboundCoachingBriefV1["inbound"]> = {}): InboundCoachingBriefV1 {
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
      ...overrides,
    },
  };
}

describe("runInboundSolRelationshipTurn", () => {
  beforeEach(() => {
    persistInboundAccountabilityOutcomeEvent.mockReset();
    scheduleC1IfWinsDurable.mockReset();
    scheduleInboundMmsD1SemanticClaim.mockReset();
    scheduleInboundMmsD1SemanticClaim.mockReturnValue(null);
    persistInboundWinsWithAccountability.mockReset();
    persistRecognizedWins.mockReset();
    loadInboundRelationshipPacket.mockReset();
    runInboundSolBriefInterpreter.mockReset();
    writeInboundSolBody.mockReset();
    recognizeWinsFromInboundV1.mockReset();
    classifyWinCandidatesEquivalenceV1.mockReset();
    recomputeV2CoachingMemory.mockReset();
    setBlockerCapturePending.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    setBlockerCapturePending.mockResolvedValue(undefined);

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
});
