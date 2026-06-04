import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { isV3OwnedInboundReplySource } from "@/lib/v3-sms-brain";
import { isV3RelationshipVoiceReplySource } from "@/lib/north-star-coach-sms";
import { buildSmsGoalAdjustmentLaneGuardrails } from "@/lib/sms-goal-adjustment-signal";
import { buildPlannedInterruptionLaneGuardrails } from "@/lib/sms-planned-interruption";
import { buildSmsPatternSignalLaneGuardrails } from "@/lib/sms-pattern-signal";
import { buildVictoryBackgroundLaneGuardrails } from "@/lib/sms-victory-background-context";
import {
  INBOUND_PROOF_CALLOUT_LANE_INSTRUCTION,
  type InboundV3ProofCalloutHint,
} from "@/lib/v2-proof-moment";
import {
  buildInboundProofCalloutLaneGuardrails,
  buildInboundV3RelationshipFacts,
  buildSeasonTransitionRouteAux,
  produceInboundV3RelationshipSms,
  type InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";
import { buildThreadFreshnessPromptGuidance } from "@/lib/sms-thread-freshness";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";
import {
  RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
  type RelationshipMemory7dResult,
} from "@/lib/sms-relationship-memory-7d";
import {
  RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
  type RelationshipMemory30dResult,
} from "@/lib/sms-relationship-memory-30d";
import type { SlimSmsRelationshipMemoryPacketForFacts } from "@/lib/sms-relationship-memory-packet";
import { buildInboundSeasonTransitionFacts } from "@/lib/v2-sms-goal-season-mutation";

const emptyThread72h = {
  messages: [],
  window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
  message_count: 0,
  had_preview_messages: false,
  had_system_no_send: false,
} as const;

const emptyMemory7d: RelationshipMemory7dResult = {
  window_days: RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
  built_at: "2026-05-18T12:00:00.000Z",
  outcome_counts: { yes: 0, no: 0, partial: 0, blockers: 0, checks_sent: 0 },
  wins: [],
  misses: [],
  partials: [],
  comebacks: [],
  blockers: [],
  proof_moments: [],
  open_loops: [],
  direct_answer_history: [],
  context_flags: {},
  meta: { item_count: 0, sources_used: [] },
};

const emptyMemory30d: RelationshipMemory30dResult = {
  window_days: RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
  built_at: "2026-05-18T12:00:00.000Z",
  commitment_id: "cmt_test",
  season: null,
  outcome_counts_30d: {
    yes: 0,
    no: 0,
    partial: 0,
    blockers: 0,
    checks_sent: 0,
    overlay_activated: 0,
    overlay_declined: 0,
    reactivation_yes: 0,
  },
  recurring_blockers: [],
  meaningful_proof: [],
  adjustments: [],
  goal_changes: [],
  comebacks: [],
  voice_preferences: null,
  pat_read_snapshot: [],
  meta: { item_count: 0, sources_used: [] },
};

function minimalRelationshipMemoryPacket(
  overrides: Partial<SlimSmsRelationshipMemoryPacketForFacts>
): SlimSmsRelationshipMemoryPacketForFacts {
  return {
    recent_exact_thread_text: "",
    recent_exact_message_count: 0,
    recent_exact_thread_72h: emptyThread72h,
    relationship_memory_7d: emptyMemory7d,
    relationship_memory_30d: emptyMemory30d,
    last_outbound_full_body: null,
    last_inbound_full_body: null,
    last_substantive_user_message: null,
    last_substantive_coach_message: null,
    last_5_coach_questions: [],
    last_5_user_answers: [],
    latest_open_question: null,
    latest_answer_after_open_question: null,
    open_question_answered_at: null,
    open_question_pending: false,
    open_question_expected_answer_type: null,
    open_question_source: "none",
    answer_source: "none",
    projection_used: false,
    latest_open_question_guess: null,
    latest_answer_after_open_question_guess: null,
    do_not_repeat_phrases: [],
    memory_priority_rules: [],
    coaching_memory_summary: null,
    coaching_memory_is_background_only: true,
    ...overrides,
  };
}

function baseCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_inbound_lane",
    clerk_user_id: "user_lane",
    status: "active",
    behavior_statement: "Two hours deep work before noon",
    title: "Morning focus",
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

function baseGatedDecision(): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: "user_yes",
    decision_reason: "test_fixture",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

function baseFacts(overrides?: Partial<InboundV3RelationshipFacts>): InboundV3RelationshipFacts {
  const gated = baseGatedDecision();
  const built = buildInboundV3RelationshipFacts({
    clerkUserId: "user_lane",
    preferredName: "Alex",
    timezone: "America/Chicago",
    localTimeIso: "2026-05-12T09:00:00.000Z",
    commitment: baseCommitment(),
    effectiveAsk: "Two hours deep work before noon",
    userMessageRaw: "done",
    coalescedInboundText: "done",
    suppressedMessageSids: ["SM123"],
    transcriptLines: ["Coach: How did it go?", "User: done"],
    northStarPacket: {
      source: "sms_inbound_coach",
      latestOutboundBody: "How did it go?",
      latestOpenQuestion: "How did it go?",
      expectedReplySemantics: "proposal_yes_no",
      proofSignal: false,
      missSignal: false,
      blockerSignal: false,
      todayCompleted: false,
    },
    gatedDecision: gated,
    deterministicEventType: "user_yes",
    doNotRepeatHints: [],
    relationshipProfileSummary: null,
    conversationBrain: { enabled: false },
    centralBrain: { shadow_stored: false },
    arc: { ambiguous_short_reply: false, clarification_required: false },
    phase5a: {
      central_tether_brain_enabled: false,
      arc_clarify_brain_enabled: false,
      inbound_stitched_final_enabled: false,
    },
    forcedFutureStretchIntentActive: false,
    wave11MemoryConfirmationPending: false,
    accountabilityProofHint: null,
    rejectedTimeCandidates: [],
    unavailableWindows: [],
  });
  return { ...built, ...overrides };
}

describe("produceInboundV3RelationshipSms", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("happy path: returns shouldSend true with mocked OpenAI JSON", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Nice — what made the two hours stick today?",
              no_send_reason: null,
              turn_purpose: "inbound_ack",
              voice_confidence: 0.8,
              used_facts: ["thread", "commitment"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("two hours");
    expect(r.replySource).toBe("v3_inbound_relationship_lane");
    expect(r.openAiOk).toBe(true);
    expect(r.metadata.inbound_v3_lane_used).toBe(true);
    expect(r.metadata.old_inbound_writer_used_as_voice).toBe(false);
    expect(r.metadata.relationship_packet_version).toBe("1.8");
    expect(r.metadata.relationship_packet_budget_chars).toBe(12000);
  });

  it("returns shouldSend=false when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("openai_unavailable");
    expect(r.body).toBe("");
  });

  it("returns invalid_json after one strict JSON retry when both completions are non-parseable", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "{bad" } }] });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("invalid_json");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(false);
  });

  it("invalid JSON on first completion succeeds after one strict JSON retry", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: "It sounds like you're feeling really overwhelmed right now, Angel. What is one tiny next step?",
                no_send_reason: null,
                turn_purpose: "inbound_ack",
                voice_confidence: 0.82,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).toContain("overwhelmed");
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(true);
  });

  it("empathetic inbound body does not hit long_user_quote false positive", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "I see you're facing challenges during other exercises — what would help you stay with it for five minutes?",
              no_send_reason: null,
              turn_purpose: "inbound_ack",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("blocks forbidden coaching clichés from model output", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Say it straight — what's the next concrete move?",
              no_send_reason: null,
              turn_purpose: "bad",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
  });

  it("blocks rejected time repeat when facts list rejected times", async () => {
    const core = baseFacts();
    const facts = {
      ...core,
      thread: { ...core.thread, rejected_time_candidates: ["3pm Tuesday"] },
    };
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Got it — let's try 3pm Tuesday again.",
              no_send_reason: null,
              turn_purpose: "bad",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("rejected_time_repeated");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("repairable phrase triggers lane repair then sends", async () => {
    const wordy =
      "Great to hear you made those calls, Angel! How did you feel about the conversations? Reflecting on them can help us prepare for tomorrow's 2 PM commitment. Let me know how it went!";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: wordy,
                no_send_reason: null,
                turn_purpose: "inbound",
                voice_confidence: 0.75,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Love that you made the calls — what felt strongest in those conversations?",
                used_strategy: "compress",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_stage).toBe("post_validate_repaired");
    expect(r.metadata.lane_repair_succeeded).toBe(true);
    expect(r.metadata.repair_snapshot_kind).toBe("lane_post_validate");
    const repairUserMsg = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(repairUserMsg).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(repairUserMsg).not.toMatch(/OPTIONAL_ACCOUNTABILITY_FACTS_JSON/);
  });

  it("second inbound post-validate repair succeeds when first repair swaps repairable issue", async () => {
    const wordy =
      "Great to hear you made those calls! Let me know how it went — what felt strongest?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: wordy,
                no_send_reason: null,
                turn_purpose: "inbound",
                voice_confidence: 0.75,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Great job — as you continue this momentum, what felt strongest in those calls?",
                used_strategy: "bad_momentum_swap",
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "What felt strongest in those calls for you?",
                used_strategy: "specific_question",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_post_validate_repair_attempt_count).toBe(2);
    expect(r.metadata.lane_post_validate_second_repair_succeeded).toBe(true);
    const secondRepairMsg = createMock.mock.calls[2]?.[0]?.messages?.[1]?.content as string;
    expect(secondRepairMsg).toMatch(/repair_pass: 2/);
  });

  it("inbound lane repair failure keeps no-send metadata", async () => {
    const wordy =
      "Great to hear you made those calls, Angel! How did you feel about the conversations? Reflecting on them can help us prepare for tomorrow's 2 PM commitment. Let me know how it went!";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: wordy,
                no_send_reason: null,
                turn_purpose: "inbound",
                voice_confidence: 0.75,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "not-json" } }],
      });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(false);
    expect(r.metadata.lane_stage).toBe("post_validate_repair_failed");
  });

  it("required_verbatim_substrings present: skips lane repair for repairable-only blocks", async () => {
    const wordy =
      "Great to hear you made those calls, Angel! How did you feel about the conversations? Reflecting on them can help us prepare for tomorrow's 2 PM commitment. Let me know how it went!";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: wordy,
              no_send_reason: null,
              turn_purpose: "inbound",
              voice_confidence: 0.75,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const f = baseFacts();
    const r = await produceInboundV3RelationshipSms({
      facts: {
        ...f,
        constraints: { ...f.constraints, required_verbatim_substrings: ["NEEDLE_VERBATIM"] },
      },
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_stage).toBe("post_validate_blocked");
    expect(r.metadata.lane_repair_attempted).toBeUndefined();
  });

  it("repairs or blocks when model re-asks after already-told-you correction (M2B-5)", async () => {
    const rbTranscript = [
      "Coach: What specific stories are you considering?",
      "User: Sunday School, farm, songs Mother sang",
      "Coach: Let's aim to dictate that story tomorrow.",
      "User: I already told you",
    ];
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: "What story will you dictate today?",
                no_send_reason: null,
                turn_purpose: "inbound_turn",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "You're right — Sunday School, the farm, and your mother's songs. What thread feels most alive to work on next?",
                used_strategy: "outcome_check",
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "You're right — Sunday School, the farm, and your mother's songs. What thread feels most alive to work on next?",
                used_strategy: "fresh_angle_v2",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: rbTranscript,
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOpenQuestion: "What specific stories are you considering?",
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      relationshipMemoryPacket: minimalRelationshipMemoryPacket({
        recent_exact_thread_text: rbTranscript.join("\n"),
        recent_exact_message_count: 4,
        last_outbound_full_body: "What specific stories are you considering?",
        last_inbound_full_body: "I already told you",
        last_substantive_user_message: "Sunday School, farm, songs Mother sang",
        last_substantive_coach_message: "What specific stories are you considering?",
        last_5_coach_questions: [
          "What story will you dictate today?",
          "What specific stories are you considering?",
        ],
        do_not_repeat_phrases: [
          "What story will you dictate today?",
          "What specific stories are you considering?",
        ],
        last_5_user_answers: ["Sunday School, farm, songs Mother sang"],
        latest_open_question_guess: "What specific stories are you considering?",
        latest_answer_after_open_question_guess: "Sunday School, farm, songs Mother sang",
        latest_open_question: "What specific stories are you considering?",
        latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
        open_question_pending: false,
        open_question_source: "projection",
        answer_source: "projection",
        projection_used: true,
        memory_priority_rules: [],
        coaching_memory_summary: null,
        coaching_memory_is_background_only: true,
      }),
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("what story will you dictate today");
    expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("includes THREAD_MEMORY_CORRECTION in system prompt for already-told-you", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "You're right — you did: Sunday School, the farm, and your mother's songs. Let's keep that thread moving today.",
              no_send_reason: null,
              turn_purpose: "use_recent_answer",
              voice_confidence: 0.85,
              used_facts: ["thread"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: [
        "Coach: What specific stories are you considering?",
        "User: Sunday School, farm, songs Mother sang",
        "User: I already told you",
      ],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
    });
    await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_fixture"],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("THREAD_MEMORY_CORRECTION");
    expect(systemMsg).toContain("ALREADY_TOLD_YOU_CORRECTION");
    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
    expect(userMsg).toContain("Sunday School, farm, songs Mother sang");
    expect(userMsg).not.toContain("INBOUND_ACCOUNTABILITY_FACTS_JSON");
  });

  it("system prompt keeps memory/correction guidance without duplicating thread body (Phase 3B)", async () => {
    const duplicateThreadMarker = "ONLY_IN_PACKET_THREAD_BODY_XYZ98765";
    const longThreadBody = `${duplicateThreadMarker} ${"Coach: line ".repeat(400)}User: done`;
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Got it — you already covered that thread. What is the next small move today?",
              no_send_reason: null,
              turn_purpose: "use_recent_answer",
              voice_confidence: 0.85,
              used_facts: ["thread"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Morning focus block",
      userMessageRaw: "done",
      coalescedInboundText: "done",
      suppressedMessageSids: [],
      transcriptLines: ["Coach: How did it go?", "User: done"],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_yes",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      relationshipMemoryPacket: minimalRelationshipMemoryPacket({
        recent_exact_thread_text: longThreadBody,
        recent_exact_message_count: 2,
        latest_open_question: "How did it go?",
        latest_answer_after_open_question: "done",
        open_question_pending: false,
        open_question_source: "projection",
        answer_source: "projection",
        projection_used: true,
        last_5_coach_questions: ["How did it go?"],
        do_not_repeat_phrases: ["How did it go?"],
      }),
    });
    await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_fixture"],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(systemMsg).toContain("MEMORY_PACKET");
    expect(systemMsg).toContain("RELATIONSHIP_PACKET_V1.recent_exact_thread_72h");
    expect(systemMsg).toMatch(/do not rely on duplicated thread blobs/i);
    expect(systemMsg).toMatch(/do NOT ask again/i);
    expect(systemMsg).not.toContain("Recent exact thread (bounded):");
    expect(systemMsg).not.toContain(duplicateThreadMarker);
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
    expect(userMsg).toContain("recent_exact_thread_72h");
    expect(userMsg).toContain(duplicateThreadMarker);
  });
});

describe("Phase 3F-3 adaptive_proposal_consent_clarification facts", () => {
  const refineOnlyGated: V2InboundGatedDecision = {
    mode: "clarify",
    final_event_type: null,
    decision_reason: "v3_refine_visible_only",
    confidence_used: null,
    should_write_outcome_event: false,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };

  it("merges adaptive_consent_clarification_facts and required_meaning_summary into constraints", () => {
    const commitment = baseCommitment();
    commitment.adaptive_proposal_text = "Walk 20 min";

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: null,
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      commitment,
      effectiveAsk: "Walk daily",
      userMessageRaw: "maybe",
      coalescedInboundText: "maybe",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: "proposal?",
        latestOpenQuestion: null,
        expectedReplySemantics: "proposal_yes_no",
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
      },
      gatedDecision: refineOnlyGated,
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "adaptive_proposal_consent_clarification",
      branchName: "adaptive_proposal_consent_clarification",
      branchMigratedToLane: true,
      adaptiveConsentClarificationFacts: {
        latest_outbound_was_proposal: true,
        pending_proposal_valid: true,
        proposal_kind: "shrink",
        proposal_text_digest: "Walk 20 min",
        inbound_parse: "ambiguous",
        server_action_taken: "none",
        state_remains_pending: true,
        required_meaning_summary: "Ask for YES or NO on the proposal.",
        legacy_clarification_preview: "stub",
        inbound_message_sid: "SMxxx",
      },
    });

    expect(facts.route_purpose).toBe("adaptive_proposal_consent_clarification");
    expect(facts.adaptive_consent_clarification_facts?.server_action_taken).toBe("none");
    expect(facts.constraints.required_meaning_summary).toContain("YES or NO");
    expect(facts.suggested_coaching_move).toBe("ask_clear_yes_or_no_for_pending_adaptive_proposal");
  });
});

describe("v3_inbound_relationship_lane reply source classification", () => {
  it("is a V3 relationship voice source (North Star OpenAI full finalizer off)", () => {
    expect(isV3RelationshipVoiceReplySource("v3_inbound_relationship_lane")).toBe(true);
  });

  it("is a V3-owned inbound reply source", () => {
    expect(isV3OwnedInboundReplySource("v3_inbound_relationship_lane")).toBe(true);
  });
});

describe("inbound V3 victory_background", () => {
  it("buildInboundV3RelationshipFacts includes victory_background when passed", () => {
    const facts = baseFacts({
      victory_background: {
        active_season_label: "Chapter 1",
        active_season_started_at: null,
        pat_read_strength: null,
        pat_read_pattern: "Evening drift",
        pat_read_next_move: null,
      },
    });
    expect(facts.victory_background?.active_season_label).toBe("Chapter 1");
    expect(facts.victory_background?.pat_read_pattern).toBe("Evening drift");
  });

  it("buildInboundV3RelationshipFacts includes goal_adjustment fields when goalAdjustmentSignal passed", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessageRaw: "I'm on vacation",
      coalescedInboundText: "I'm on vacation",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        expectedReplySemantics: "proposal_yes_no",
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_yes",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      goalAdjustmentSignal: {
        move: "pause_cadence",
        confidence: "high",
        mentionAllowed: true,
        internalHint: "planned_interruption",
        requiresUserConfirmation: true,
        compatibleFlow: "none",
        doNotRepeatKey: "goal_adjustment_pause_cadence_prompt",
      },
    });
    expect(facts.v2_accountability.goal_adjustment_move).toBe("pause_cadence");
    expect(facts.v2_accountability.goal_adjustment_requires_confirmation).toBe(true);
  });

  it("buildInboundV3RelationshipFacts includes pattern_signal fields when patternSignal passed", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessageRaw: "done",
      coalescedInboundText: "done",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        expectedReplySemantics: "proposal_yes_no",
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_yes",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      patternSignal: {
        canonical: "phone_pull",
        count14d: 2,
        count21d: 2,
        confidence: "medium",
        mentionAllowed: true,
        internalHint: "medium pattern signal: phone_pull appeared 2 times in 14d",
        gentleUserLine: "The phone has pulled you off track more than once.",
        doNotRepeatKey: "repeated_phone_pull_prompt",
        source: "events",
      },
    });
    expect(facts.v2_accountability.pattern_signal_confidence).toBe("medium");
    expect(facts.v2_accountability.pattern_canonical).toBe("phone_pull");
    expect(facts.v2_accountability.pattern_mention_allowed).toBe(true);
    expect(facts.v2_accountability.pattern_internal_hint).toContain("phone_pull");
  });

  it("buildInboundV3RelationshipFacts includes planned interruption on commitment when passed", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessageRaw: "I'm on vacation",
      coalescedInboundText: "I'm on vacation",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        expectedReplySemantics: null,
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
        futureIntentHint: null,
      },
      gatedDecision: {
        ...baseGatedDecision(),
        should_write_outcome_event: false,
        final_event_type: null,
      },
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      plannedInterruption: {
        active: true,
        reasonCategory: "vacation",
        resumeHint: "next week",
      },
    });
    expect(facts.commitment.planned_interruption_active).toBe(true);
    expect(facts.commitment.planned_interruption_reason_category).toBe("vacation");
    expect(facts.commitment.planned_interruption_resume_hint).toBe("next week");
  });

  it("buildInboundV3RelationshipFacts includes pat_principles when passed", () => {
    const facts = baseFacts({
      victory_background: {
        active_season_label: null,
        active_season_started_at: null,
        pat_read_strength: null,
        pat_read_pattern: null,
        pat_read_next_move: null,
        pat_principles: {
          focus_next_title: "Take Full Responsibility",
          focus_next_text: "Tell the truth about the miss.",
          living_well_title: "Be a Competitor",
          living_well_text: "Your proof shows you compete with the standard.",
        },
      },
    });
    expect(facts.victory_background?.pat_principles?.focus_next_title).toBe(
      "Take Full Responsibility"
    );
    expect(facts.victory_background?.pat_principles?.living_well_title).toBe("Be a Competitor");
  });

  it("produceInboundV3RelationshipSms system prompt includes victory guardrails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Got it — what tripped the morning block?",
              no_send_reason: null,
              turn_purpose: "inbound_turn",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });

    await produceInboundV3RelationshipSms({
      facts: baseFacts({
        victory_background: {
          active_season_label: null,
          active_season_started_at: null,
          pat_read_strength: "Steady",
          pat_read_pattern: null,
          pat_read_next_move: null,
        },
      }),
      telemetry_fact_sources: [],
    });

    const systemMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain("VICTORY_BACKGROUND");
    expect(systemMsg).toMatch(/Pat Principles/i);
    expect(systemMsg).toMatch(/do not invent principle/i);
    expect(systemMsg).toMatch(/primary anchor/i);
    expect(systemMsg).not.toMatch(/Pat Summitt.*quote/i);
    expect(systemMsg).toContain(buildVictoryBackgroundLaneGuardrails().trim().slice(0, 30));
    expect(systemMsg).toContain(buildSmsPatternSignalLaneGuardrails().trim().slice(0, 20));
    expect(systemMsg).toContain(buildSmsGoalAdjustmentLaneGuardrails().trim().slice(0, 20));
    expect(systemMsg).toContain(buildPlannedInterruptionLaneGuardrails().trim().slice(0, 24));
    expect(systemMsg).toMatch(/not a diagnosis/i);
    expect(systemMsg).toMatch(/pattern_mention_allowed/i);
    expect(systemMsg).toMatch(/not permission to mutate/i);
    expect(systemMsg).toMatch(/pause_cadence/i);
    expect(systemMsg).toMatch(/raise_bar/i);
    expect(systemMsg).toMatch(/invitation/i);
  });

  it("produceInboundV3RelationshipSms includes structured 30d pat_read_snapshot when memory packet present", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Got it — what tripped the morning block?",
              no_send_reason: null,
              turn_purpose: "inbound_turn",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });

    await produceInboundV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          memory_packet: {
            ...minimalRelationshipMemoryPacket({}),
            recent_exact_thread_text: "Coach: How did it go?\nUser: done",
            relationship_memory_30d: {
              ...emptyMemory30d,
              pat_read_snapshot: [
                {
                  field: "pattern",
                  text: "Work Smart pattern",
                  source: "v2_victory_pat_read_snapshot",
                  is_ai_snapshot: true,
                  commitment_id: "cmt_inbound_lane",
                },
              ],
            },
          },
        },
        victory_background: {
          active_season_label: null,
          active_season_started_at: null,
          pat_read_strength: null,
          pat_read_pattern: "Work Smart",
          pat_read_next_move: null,
          pat_principles: {
            focus_next_title: "Work Smart",
            focus_next_text: "Adjust the plan once, then execute.",
            living_well_title: null,
            living_well_text: null,
          },
        },
      }),
      telemetry_fact_sources: [],
    });

    const userMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("relationship_memory_30d_or_season");
    expect(userMsg).toContain("pat_read_snapshot");
    expect(userMsg).toContain("Work Smart pattern");
    expect(userMsg).not.toContain("pat_principles");
  });
});

describe("inbound V3 proof_callout_hint (Slice 2)", () => {
  const proofHint: InboundV3ProofCalloutHint = {
    eligible: true,
    surface: "victory_room",
    reason: "first_completion",
    instruction: INBOUND_PROOF_CALLOUT_LANE_INSTRUCTION,
    proof_insert_will_attempt: true,
    proof_callout_claim_saved_allowed: false,
  };

  it("buildInboundProofCalloutLaneGuardrails requires optional natural mention", () => {
    const g = buildInboundProofCalloutLaneGuardrails();
    expect(g).toMatch(/optional/i);
    expect(g).toMatch(/Do not force/i);
    expect(g).toMatch(/proof_callout_claim_saved_allowed/i);
    expect(g).toMatch(/second paragraph/i);
  });

  it("buildInboundV3RelationshipFacts attaches proof_callout_hint on v2_accountability", () => {
    const built = buildInboundV3RelationshipFacts({
      ...({
        clerkUserId: "user_lane",
        preferredName: "Alex",
        timezone: "America/Chicago",
        localTimeIso: "2026-05-12T09:00:00.000Z",
        commitment: baseCommitment(),
        effectiveAsk: "Two hours deep work",
        userMessageRaw: "yes",
        coalescedInboundText: "yes",
        suppressedMessageSids: [],
        transcriptLines: [],
        northStarPacket: {
          source: "sms_inbound_coach",
          proofSignal: true,
          missSignal: false,
          blockerSignal: false,
          todayCompleted: false,
        },
        gatedDecision: baseGatedDecision(),
        deterministicEventType: "user_yes",
        doNotRepeatHints: [],
        relationshipProfileSummary: null,
        conversationBrain: { enabled: false },
        centralBrain: { shadow_stored: false },
        arc: { ambiguous_short_reply: false, clarification_required: false },
        phase5a: {
          central_tether_brain_enabled: false,
          arc_clarify_brain_enabled: false,
          inbound_stitched_final_enabled: false,
        },
        forcedFutureStretchIntentActive: false,
        wave11MemoryConfirmationPending: false,
        accountabilityProofHint: null,
        rejectedTimeCandidates: [],
        unavailableWindows: [],
        proofCalloutHint: proofHint,
      } as Parameters<typeof buildInboundV3RelationshipFacts>[0]),
    });
    expect(built.v2_accountability.proof_callout_hint?.eligible).toBe(true);
    expect(built.v2_accountability.proof_callout_hint?.proof_callout_claim_saved_allowed).toBe(false);
  });

  it("produceInboundV3RelationshipSms includes proof_callout_hint in facts JSON when present", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Good — that counts.",
              no_send_reason: null,
              turn_purpose: "inbound_turn",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });

    await produceInboundV3RelationshipSms({
      facts: baseFacts({
        v2_accountability: {
          ...baseFacts().v2_accountability,
          proof_callout_hint: proofHint,
        },
      }),
      telemetry_fact_sources: ["buildInboundProofCalloutHint"],
    });

    const systemMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain("PROOF_CALLOUT");
    const userMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("proof_callout_hint");
    expect(userMsg).toContain("proof_callout_claim_saved_allowed");
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
  });

  it("builds when proof_callout_hint is absent", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Got it.",
              no_send_reason: null,
              turn_purpose: "inbound_turn",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const r = await produceInboundV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
  });
});

describe("buildSeasonTransitionRouteAux", () => {
  it("includes do-not-expose-internal-labels guidance when season facts are present", () => {
    const aux = buildSeasonTransitionRouteAux({
      ...baseFacts(),
      season_transition_facts: {
        chapter_changed: false,
        user_facing_transition: "same_chapter",
        bar_raised_in_same_chapter: true,
        old_season_name: "Morning Focus",
        new_season_name: "Morning Focus",
      },
    });
    expect(aux).toContain("SEASON_TRANSITION");
    expect(aux).toContain("Do NOT expose internal labels");
    expect(aux).toMatch(/Never say:.*same_season_sync/);
    expect(aux).toMatch(/Never say:.*snapshot/);
    expect(aux).toContain("same chapter");
  });

  it("guides new_chapter language without IDs when chapter changed", () => {
    const aux = buildSeasonTransitionRouteAux({
      ...baseFacts(),
      season_transition_facts: {
        chapter_changed: true,
        user_facing_transition: "new_chapter",
        bar_raised_in_same_chapter: false,
        old_season_name: "Phone Discipline",
        new_season_name: "Walking",
      },
    });
    expect(aux).toContain("new chapter");
    expect(aux).toContain("never IDs");
  });

  it("returns empty string when season facts are absent", () => {
    expect(buildSeasonTransitionRouteAux(baseFacts())).toBe("");
  });
});

describe("season_transition_facts in V3 facts JSON", () => {
  it("sanitized season facts omit internal labels from model-facing JSON", () => {
    const mutationFacts = buildInboundSeasonTransitionFacts({
      ok: true,
      rpcResult: "applied",
      seasonMode: "same_season_sync",
      commitmentReplaceApplied: false,
      oldCommitmentId: "cmt-uuid",
      newCommitmentId: "cmt-uuid",
      seasonTransitionApplied: true,
      seasonTransitionAction: "same_season_sync",
      oldSeasonId: "season-uuid",
      newSeasonId: "season-uuid",
      oldSeasonName: "Focus",
      newSeasonName: "Focus",
      sameSeasonGoalSnapshotSynced: true,
      idempotentReplay: false,
      warningCode: null,
    });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Tyler",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessageRaw: "yes",
      coalescedInboundText: "yes",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        latestInboundRaw: "yes",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        behaviorStatement: "Two hours deep work before noon",
        effectiveAskText: "Two hours deep work before noon",
        expectedReplySemantics: null,
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
        futureIntentHint: null,
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_yes",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      branchMigratedToLane: true,
      seasonTransitionFacts: mutationFacts,
    });
    const json = JSON.stringify(facts);
    expect(json).toContain("user_facing_transition");
    expect(json).not.toMatch(/same_season_sync|same_season_goal_snapshot|season_transition_applied|season_mode/);
    expect(json).not.toMatch(/season-uuid|cmt-uuid/);
  });
});

describe("inbound_meaning authority on V3 facts", () => {
  it("yesterday ack_only does not expose today_completed or user_yes final_event_type", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-06-01T12:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Take at least 10,000 steps daily",
      userMessageRaw: "I did my 10,000 steps yesterday!",
      coalescedInboundText: "I did my 10,000 steps yesterday!",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: {
        source: "sms_inbound_coach",
        todayCompleted: true,
        proofSignal: true,
      },
      gatedDecision: {
        ...baseGatedDecision(),
        final_event_type: "user_yes",
        should_write_outcome_event: true,
      },
      deterministicEventType: "user_yes",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
    });
    expect(facts.inbound_meaning.persistence_decision).toBe("ack_only");
    expect(facts.inbound_meaning.temporal_scope).toBe("yesterday");
    expect(facts.v2_accountability.today_completed).toBe(false);
    expect(facts.v2_accountability.proof_signal).toBe(false);
    expect(facts.v2_accountability.final_event_type).not.toBe("user_yes");
    expect(facts.suggested_coaching_move).toBe("acknowledge_completion");
  });
});

describe("thread_freshness in V3 inbound lane", () => {
  const lunchTranscript = [
    "Coach: How do you feel about prioritizing your five minutes of stretching at lunch?",
    "User: Good suggestion so did that at lunch.",
  ];

  it("buildInboundV3RelationshipFacts includes thread_freshness for completed lunch stretch", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Five minutes stretching at lunch",
      userMessageRaw: "Good suggestion so did that at lunch.",
      coalescedInboundText: "Good suggestion so did that at lunch.",
      suppressedMessageSids: [],
      transcriptLines: lunchTranscript,
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOpenQuestion:
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      relationshipMemoryPacket: minimalRelationshipMemoryPacket({
        recent_exact_thread_text: lunchTranscript.join("\n"),
        last_5_user_answers: ["Good suggestion so did that at lunch."],
        last_5_coach_questions: [
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
        ],
        do_not_repeat_phrases: [],
        latest_open_question:
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
      }),
    });

    expect(facts.thread_freshness).toBeDefined();
    expect(facts.thread_freshness?.completed_actions.length).toBeGreaterThanOrEqual(1);
    expect(facts.thread_freshness?.do_not_reask_topics.some((t) => /lunch|stretch/i.test(t))).toBe(
      true
    );
    const json = JSON.stringify(facts);
    expect(json).toContain("thread_freshness");
    expect(json).toContain("do_not_reask_topics");
  });

  it("produceInboundV3RelationshipSms system prompt includes THREAD_FRESHNESS authority", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Nice work — what's the next small win today?",
              no_send_reason: null,
              turn_purpose: "inbound_turn",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });

    await produceInboundV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          recent_transcript_lines: lunchTranscript,
          coalesced_inbound_text: "Good suggestion so did that at lunch.",
        },
        thread_freshness: {
          completed_actions: [
            {
              text: "five-minute stretch at lunch",
              evidence: "Good suggestion so did that at lunch.",
            },
          ],
          do_not_reask_topics: ["lunch stretch", "five-minute stretch at lunch"],
          active_temporal_frame: "today",
          temporal_anchors: ["lunch", "stretch"],
          recent_user_plan_or_schedule: null,
          recent_user_completion: "Good suggestion so did that at lunch.",
        },
      }),
      telemetry_fact_sources: [],
    });

    const firstCall = createMock.mock.calls[0]?.[0];
    const systemMsg = firstCall?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain("THREAD_FRESHNESS");
    expect(systemMsg).toContain("RELATIONSHIP_PACKET_AUTHORITY");
    expect(systemMsg).toContain(buildThreadFreshnessPromptGuidance().trim().slice(0, 40));
    const userMsg = firstCall?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("thread_freshness");
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
  });

  it("repairs stale lunch-stretch re-ask via thread freshness guard", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: "How do you feel about prioritizing your five minutes of stretching at lunch?",
                no_send_reason: null,
                turn_purpose: "inbound_turn",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
                rejected_times_obeyed: true,
                split_messages_handled: true,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Nice — you got the lunch stretch in. What feels like the next small win?",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_lane",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Five minutes stretching at lunch",
      userMessageRaw: "Good suggestion so did that at lunch.",
      coalescedInboundText: "Good suggestion so did that at lunch.",
      suppressedMessageSids: [],
      transcriptLines: lunchTranscript,
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOpenQuestion:
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
      },
      gatedDecision: baseGatedDecision(),
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      relationshipMemoryPacket: minimalRelationshipMemoryPacket({
        recent_exact_thread_text: lunchTranscript.join("\n"),
        last_5_user_answers: ["Good suggestion so did that at lunch."],
        last_5_coach_questions: [
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
        ],
        do_not_repeat_phrases: [],
        latest_open_question:
          "How do you feel about prioritizing your five minutes of stretching at lunch?",
      }),
    });

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_fixture"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toMatch(/how do you feel about prioritizing.*stretch.*lunch/);
    expect(r.metadata.thread_freshness_repair_succeeded).toBe(true);
    expect(r.metadata.thread_freshness_used).toBe(true);
  });
});
