import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const createMock = vi.hoisted(() => vi.fn());

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
import {
  buildInboundV3RelationshipFacts,
  produceInboundV3RelationshipSms,
} from "@/lib/v3-inbound-relationship-lane";
import {
  detectSmsMemoryRepeatViolation,
  shouldRunInboundMemoryRepeatGuard,
} from "@/lib/sms-memory-anti-repeat";
import { slimMemoryPacketForFacts } from "@/lib/sms-relationship-memory-packet";

function baseCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_repeat",
    clerk_user_id: "user_repeat",
    status: "active",
    behavior_statement: "Dictate stories daily",
    title: "Stories",
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
  };
}

function baseGated(): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: "user_partial",
    decision_reason: "test_fixture",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

function rbMemoryPacket(): ReturnType<typeof slimMemoryPacketForFacts> {
  return slimMemoryPacketForFacts({
    clerk_user_id: "user_repeat",
    commitment_id: "cmt_repeat",
    behavior_statement: "Dictate stories",
    effective_ask: "Dictate stories",
    accountability_phase: "active_accountability",
    pending_resolution_summary: null,
    overlay_active: false,
    recent_outcomes_summary: {
      yes_7d: 0,
      no_7d: 0,
      partial_7d: 0,
      blockers_7d: 0,
      checks_sent_7d: 0,
      latest_blocker_preview: null,
      latest_proof_hint: null,
    },
    coaching_memory_summary: null,
    coaching_memory_is_background_only: true,
    relationship_profile_summary: null,
    recent_exact_messages: [],
    recent_exact_thread_text:
      "Coach: What specific stories are you considering?\nUser: Sunday School, farm, songs Mother sang\nUser: I already told you",
    last_outbound_full_body: "What specific stories are you considering?",
    last_inbound_full_body: "I already told you",
    last_substantive_user_message: "Sunday School, farm, songs Mother sang",
    last_substantive_coach_message: "What specific stories are you considering?",
    last_5_coach_questions: [
      {
        text: "What story will you dictate today?",
        asked_at: "2026-05-18T10:30:00.000Z",
        source_table: "sms_inbound_coach_jobs",
        is_preview: false,
      },
      {
        text: "What specific stories are you considering?",
        asked_at: "2026-05-18T11:00:00.000Z",
        source_table: "sms_inbound_coach_jobs",
        is_preview: false,
      },
    ],
    last_5_user_answers: [
      {
        text: "Sunday School, farm, songs Mother sang",
        answered_at: "2026-05-18T11:20:00.000Z",
        source_table: "sms_inbound_coach_jobs",
      },
    ],
    latest_open_question_guess: "What specific stories are you considering?",
    latest_answer_after_open_question_guess: "Sunday School, farm, songs Mother sang",
    latest_open_question: "What specific stories are you considering?",
    latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
    open_question_pending: false,
    open_question_source: "projection",
    answer_source: "projection",
    do_not_repeat_phrases: [
      { kind: "projection_dnr", phrase: "What story will you dictate today?" },
      { kind: "projection_dnr", phrase: "What specific stories are you considering?" },
    ],
    memory_priority_rules: [],
    meta: {
      message_count: 3,
      thread_text_capped: false,
      sources_used: ["sms_inbound_coach_jobs"],
      built_at: new Date().toISOString(),
      projection_used: true,
      projection_load_failed: false,
    },
  });
}

function expectAntiGhostRepairSucceeded(metadata: Record<string, unknown>) {
  expect(
    metadata.memory_repeat_guard_succeeded === true ||
      metadata.thread_freshness_repair_succeeded === true
  ).toBe(true);
}

describe("produceInboundV3RelationshipSms memory repeat guard (M2B-5)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.clearAllMocks();
  });

  it("repairs repeated question on normal inbound", async () => {
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
                body: "You're right — Sunday School, the farm, and your mother's songs. What's the first thread you'll dictate today?",
                used_strategy: "next_first_step",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_repeat",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-18T12:00:00.000Z",
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
      gatedDecision: baseGated(),
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
      relationshipMemoryPacket: rbMemoryPacket(),
    });

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_memory_repeat"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("what story will you dictate today");
    expect(r.metadata.memory_repeat_guard_attempted).toBe(true);
    expect(r.metadata.memory_repeat_guard_succeeded).toBe(true);
  });

  it("no-sends when repair still repeats", async () => {
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
                body: "What's the first story you'll dictate today?",
                used_strategy: "next_first_step",
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
                body: "What story shows who you're becoming today?",
                used_strategy: "identity_tie_back",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_repeat",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-18T12:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: [
        "Coach: What specific stories are you considering?",
        "User: Sunday School, farm, songs Mother sang",
      ],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: baseGated(),
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
      relationshipMemoryPacket: rbMemoryPacket(),
    });

    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: [] });

    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("thread_memory_repeat_blocked");
    expect(r.metadata.memory_repeat_no_send_reason).toBe("still_repeated_after_repair");
    expect(r.metadata.forced_second_repair_attempted).toBe(true);
  });

  it("skips memory repeat guard on contract consent with required verbatim", () => {
    const binding = "Reply YES to accept this tighter overlay for the next 7 days.";
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_repeat",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-18T12:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "YES",
      coalescedInboundText: "YES",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: baseGated(),
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
      routePurpose: "adaptive_proposal_consent_accept",
      contractConsentFacts: {
        consent_parse: "user_yes",
        latest_outbound_was_proposal: true,
        proposal_kind: "shrink_ask",
        proposal_text_digest: "tighter overlay",
        overlay_action: "activated",
        rpc_result: "ok",
        server_state_transition_summary: "activated",
        legacy_contract_ack_preview: "legacy",
        inbound_message_sid: "SM1",
        proposal_expires_at: null,
        required_verbatim_substrings: [binding],
      },
      relationshipMemoryPacket: rbMemoryPacket(),
    });
    expect(shouldRunInboundMemoryRepeatGuard(facts)).toBe(false);
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: binding,
      lastCoachQuestions: [binding],
      doNotRepeatPhrases: [binding],
      requiredVerbatimSubstrings: [binding],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("clear completion repair sends when repaired body is non-repetitive (steps yesterday)", async () => {
    const repeatedQ = "Have you started your commitment to take at least 10,000 steps today?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: repeatedQ,
                no_send_reason: null,
                turn_purpose: "acknowledge_completion",
                voice_confidence: 0.85,
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
                body: "What actually happened with yesterday's bar is in the books. What's the next honest move for today?",
                used_strategy: "proof_check",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_steps",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-06-01T12:00:00.000Z",
      commitment: {
        ...baseCommitment(),
        behavior_statement: "Take at least 10,000 steps daily",
      },
      effectiveAsk: "Take at least 10,000 steps daily",
      userMessageRaw: "I did my 10,000 steps yesterday!",
      coalescedInboundText: "I did my 10,000 steps yesterday!",
      suppressedMessageSids: [],
      transcriptLines: [`Coach: ${repeatedQ}`, "User: I did my 10,000 steps yesterday!"],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: {
        ...baseGated(),
        mode: "use_deterministic",
        final_event_type: "user_yes",
        decision_reason: "clear_reported_completion_outcome",
        should_write_outcome_event: true,
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
      relationshipMemoryPacket: {
        ...rbMemoryPacket(),
        last_5_coach_questions: [repeatedQ],
        last_outbound_full_body: repeatedQ,
      },
    });

    expect(facts.suggested_coaching_move).toBe("acknowledge_completion");

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_completion_memory_repeat"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("have you started");
    expectAntiGhostRepairSucceeded(r.metadata);
    expect(String(r.body).toLowerCase()).not.toContain("victory room");
  });

  it("duplicate completion after prior memory-repeat no-send includes escalation and can send", async () => {
    const repeatedQ = "Have you started your commitment to take at least 10,000 steps today?";
    const inbound = "I did my 10,000 steps yesterday!";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: repeatedQ,
                no_send_reason: null,
                turn_purpose: "acknowledge_completion",
                voice_confidence: 0.85,
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
                body: "Good — yesterday's bar is in the books. What honest move keeps today on track?",
                used_strategy: "outcome_check",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_steps",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-06-01T14:00:00.000Z",
      commitment: {
        ...baseCommitment(),
        behavior_statement: "Take at least 10,000 steps daily",
      },
      effectiveAsk: "Take at least 10,000 steps daily",
      userMessageRaw: inbound,
      coalescedInboundText: inbound,
      suppressedMessageSids: [],
      transcriptLines: [`Coach: ${repeatedQ}`, `User: ${inbound}`],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: {
        ...baseGated(),
        mode: "use_deterministic",
        final_event_type: "user_yes",
        decision_reason: "clear_reported_completion_outcome",
        should_write_outcome_event: true,
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
      priorMemoryRepeatNoSend: {
        prior_message_sid: "SM_prior",
        prior_no_send_reason: "thread_memory_repeat_blocked",
        prior_cancelled_at: "2026-06-01T13:00:00.000Z",
        normalized_inbound_text: "i did my 10,000 steps yesterday!",
        repeated_question_preview: repeatedQ,
        escalation_attempt: true,
      },
      relationshipMemoryPacket: {
        ...rbMemoryPacket(),
        last_5_coach_questions: [repeatedQ],
        last_outbound_full_body: repeatedQ,
      },
    });

    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: [] });

    expect(r.shouldSend).toBe(true);
    expectAntiGhostRepairSucceeded(r.metadata);
    expect(r.metadata.repair_snapshot_kind).toBe("thread_freshness");
    expect(r.metadata.thread_freshness_violation_reason).toBe("reasked_completed_action");
  });
});
