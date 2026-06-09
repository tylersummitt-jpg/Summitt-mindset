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
import {
  buildInboundV3RelationshipFacts,
  deriveSuggestedCoachingMoveForInboundFacts,
  formatInboundV3LaneNoSendLastError,
  produceInboundV3RelationshipSms,
  slimOpenQuestionFactsForTelemetry,
  type InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";

const REFINE_ONLY_GATED: V2InboundGatedDecision = {
  mode: "clarify",
  final_event_type: null,
  decision_reason: "v3_refine_visible_only",
  confidence_used: null,
  should_write_outcome_event: false,
  should_open_blocker_capture: false,
  reply_style: "normal_outcome",
  overrode_deterministic: false,
};

function baseCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_3da",
    clerk_user_id: "user_3da",
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

function baseFactsArgs() {
  const gated = baseGatedDecision();
  return {
    clerkUserId: "user_3da",
    preferredName: "Alex",
    timezone: "America/Chicago",
    localTimeIso: "2026-05-12T09:00:00.000Z",
    commitment: baseCommitment(),
    effectiveAsk: "Two hours deep work before noon",
    userMessageRaw: "k",
    coalescedInboundText: "k",
    suppressedMessageSids: [] as string[],
    transcriptLines: ["Coach: Did you hit two hours?", "User: k"],
    northStarPacket: {
      source: "sms_inbound_coach",
      latestOutboundBody: "Did you hit two hours?",
      latestOpenQuestion: "Did you hit two hours?",
      expectedReplySemantics: "proposal_yes_no",
      proofSignal: false,
      missSignal: false,
      blockerSignal: false,
      todayCompleted: false,
    },
    gatedDecision: gated,
    deterministicEventType: "user_yes" as const,
    doNotRepeatHints: [] as string[],
    relationshipProfileSummary: null,
    conversationBrain: { enabled: false },
    centralBrain: { shadow_stored: false },
    arc: { ambiguous_short_reply: true, clarification_required: true },
    phase5a: {
      central_tether_brain_enabled: false,
      arc_clarify_brain_enabled: false,
      inbound_stitched_final_enabled: false,
    },
    forcedFutureStretchIntentActive: false,
    wave11MemoryConfirmationPending: false,
    accountabilityProofHint: null,
    rejectedTimeCandidates: [] as string[],
    unavailableWindows: [] as string[],
  };
}

describe("Phase 3D-a inbound lane (central pivot + ARC clarify)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("deriveSuggested uses pivot facts suggested_move", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "central_brain_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_outcome_blocking_pivot",
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: "human_tether",
        confidence: 0.9,
        reason: "central_brain_human_or_meta",
        suggested_move: "custom_pivot_move",
        legacy_tether_text_preview: "LEGACY",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("custom_pivot_move");
  });

  it("deriveSuggested falls back for empty pivot suggested_move", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "central_brain_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_outcome_blocking_pivot",
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: null,
        confidence: null,
        reason: "central_brain_human_or_meta",
        suggested_move: "   ",
        legacy_tether_text_preview: "LEGACY",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("pivot_respond_humanely");
  });

  it("deriveSuggested uses arc clarification route", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "arc_clarify_ambiguous_short",
      branchMigratedToLane: true,
      branchName: "arc_ambiguous_short_clarify",
      arcClarificationFacts: {
        ambiguous_short_reply: true,
        tentative_outcome: "user_yes",
        clarification_reason: "ambiguous_short_stale_prompt",
        context_age: {
          accountability_prompt_age_minutes: 120,
          accountability_prompt_sent_at: "2026-05-12T08:00:00.000Z",
          latest_outcome_at: null,
        },
        latest_question: "Did you hit two hours?",
        legacy_clarification_text_preview: "LEGACY_ARC",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("clarify_ambiguous_short_natural_sms");
  });

  it("central pivot lane: metadata carries route_purpose and branch when clean", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Quick read — what did you mean by that last text?",
              no_send_reason: null,
              turn_purpose: "pivot_clarify",
              voice_confidence: 0.75,
              used_facts: ["central_brain_pivot_facts"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const tether =
      "LEGACY_TETHER_PREVIEW_DETERMINISTIC_BODY_SHOULD_NOT_MATCH_LANE_OUTPUT_XYZ789";

    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "central_brain_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_outcome_blocking_pivot",
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: "human_tether",
        confidence: 0.88,
        reason: "central_brain_human_or_meta",
        suggested_move: "human_tether",
        legacy_tether_text_preview: tether,
      },
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_central_pivot"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body.trim()).not.toBe(tether.trim());
    expect(r.metadata.route_purpose).toBe("central_brain_pivot");
    expect(r.metadata.branch_migrated_to_lane).toBe(true);
    expect(r.metadata.branch_name).toBe("central_brain_outcome_blocking_pivot");
    expect(r.metadata.should_send).toBe(true);
  });

  it("ARC clarify lane: metadata and body differ from legacy clarification template", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Say more — did you mean yes to the bar, or something else?",
              no_send_reason: null,
              turn_purpose: "arc_clarify",
              voice_confidence: 0.7,
              used_facts: ["arc_clarification_facts"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const legacy =
      "LEGACY_ARC_CLARIFICATION_TEMPLATE_SHOULD_NOT_MATCH_LANE_OUTPUT_ABC123";

    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "arc_clarify_ambiguous_short",
      branchMigratedToLane: true,
      branchName: "arc_ambiguous_short_clarify",
      arcClarificationFacts: {
        ambiguous_short_reply: true,
        tentative_outcome: "user_yes",
        clarification_reason: "ambiguous_short_stale_prompt",
        context_age: {
          accountability_prompt_age_minutes: 200,
          accountability_prompt_sent_at: null,
          latest_outcome_at: null,
        },
        latest_question: "Did you hit two hours?",
        legacy_clarification_text_preview: legacy,
      },
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_arc_clarify"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).not.toBe(legacy);
    expect(r.metadata.route_purpose).toBe("arc_clarify_ambiguous_short");
  });

  it("lane no-send last_error includes route extras", () => {
    const lane = {
      body: "",
      shouldSend: false,
      noSendReason: "openai_unavailable",
      replySource: "v3_inbound_relationship_lane" as const,
      turnPurpose: "no_send",
      voiceConfidence: null,
      usedFacts: [],
      safetyNotes: [],
      metadata: { route_purpose: "central_brain_pivot" },
      openAiOk: false,
    };
    const raw = formatInboundV3LaneNoSendLastError(lane, {
      route_purpose: "central_brain_pivot",
      branch_name: "central_brain_outcome_blocking_pivot",
    });
    const j = JSON.parse(raw) as Record<string, unknown>;
    expect(j.tag).toBe("inbound_v3_lane_no_send");
    expect(j.route_purpose).toBe("central_brain_pivot");
    expect(j.branch_name).toBe("central_brain_outcome_blocking_pivot");
  });

  it("pivot lane failure path: model no_send", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: false,
              body: "",
              no_send_reason: "unsafe",
              turn_purpose: "no_send",
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
    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "central_brain_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_outcome_blocking_pivot",
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: "x",
        confidence: null,
        reason: "central_brain_human_or_meta",
        suggested_move: "x",
        legacy_tether_text_preview: "old",
      },
    });
    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: [] });
    expect(r.shouldSend).toBe(false);
    const err = formatInboundV3LaneNoSendLastError(r, {
      route_purpose: "central_brain_pivot",
      branch_name: "central_brain_outcome_blocking_pivot",
    });
    expect(JSON.parse(err).tag).toBe("inbound_v3_lane_no_send");
  });

  it("replySource v3_inbound_relationship_lane remains protected", () => {
    expect(isV3RelationshipVoiceReplySource("v3_inbound_relationship_lane")).toBe(true);
    expect(isV3OwnedInboundReplySource("v3_inbound_relationship_lane")).toBe(true);
  });

  it("pivot facts preserve blocked scoring with no outcome write", () => {
    const f: InboundV3RelationshipFacts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "central_brain_pivot",
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: "t",
        confidence: 1,
        reason: "central_brain_human_or_meta",
        suggested_move: "t",
        legacy_tether_text_preview: "x",
      },
    });
    expect(f.v2_accountability.should_write_outcome_event).toBe(false);
    expect(f.central_brain_pivot_facts?.blocked_outcome_scoring).toBe(true);
    expect(f.inbound_meaning.persistence_decision).toBe("no_outcome_write");
  });
});

describe("Phase 3D-b inbound lane (blocker pivot + blocker ack)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("deriveSuggested uses central brain blocker pivot facts", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      routePurpose: "central_brain_blocker_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_blocker_capture_pivot",
      centralBrainBlockerPivotFacts: {
        blocked_blocker_capture: true,
        central_turn_purpose: "human_tether",
        confidence: 0.9,
        reason: "central_brain_human_or_meta",
        suggested_move: "custom_blocker_pivot",
        blocker_text: "too many meetings",
        legacy_tether_text_preview: "OLD",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("custom_blocker_pivot");
  });

  it("deriveSuggested uses blocker_capture_ack facts", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      routePurpose: "blocker_capture_ack",
      branchMigratedToLane: true,
      branchName: "blocker_capture_ack",
      blockerFacts: {
        blocker_text: "meetings",
        blocker_category: "user_partial:blank",
        repeated_blocker_signal: false,
        following_event_type: "user_no",
        blocker_pending_age_minutes_remaining: 30,
        suggested_next_move: "Protect two hours",
        legacy_blocker_ack_preview: "LEGACY_ACK",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("acknowledge_blocker_capture");
  });

  it("central_brain_blocker_pivot lane metadata when clean", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Understood on meetings as the drag. One move tomorrow: block the first hour before inbox.",
              no_send_reason: null,
              turn_purpose: "blocker_pivot",
              voice_confidence: 0.72,
              used_facts: ["central_brain_blocker_pivot_facts"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const legacyTether = "LEGACY_BLOCKER_TETHER_PREVIEW_SHOULD_NOT_EQUAL_LANE";
    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      routePurpose: "central_brain_blocker_pivot",
      branchMigratedToLane: true,
      branchName: "central_brain_blocker_capture_pivot",
      centralBrainBlockerPivotFacts: {
        blocked_blocker_capture: true,
        central_turn_purpose: "human_tether",
        confidence: 0.8,
        reason: "central_brain_human_or_meta",
        suggested_move: "human_tether",
        blocker_text: "meetings stacked",
        legacy_tether_text_preview: legacyTether,
      },
    });
    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: ["test_blocker_pivot"] });
    expect(r.shouldSend).toBe(true);
    expect(r.body.trim()).not.toBe(legacyTether.trim());
    expect(r.metadata.route_purpose).toBe("central_brain_blocker_pivot");
    expect(r.metadata.branch_migrated_to_lane).toBe(true);
  });

  it("blocker_capture_ack lane body differs from legacy ack preview", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Thanks for naming it — we will work that edge without letting the bar slide.",
              no_send_reason: null,
              turn_purpose: "blocker_ack",
              voice_confidence: 0.7,
              used_facts: ["blocker_facts"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const legacyAck = "LEGACY_BLOCKER_ACK_AI_OR_TEMPLATE_SHOULD_NOT_EQUAL_LANE";
    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      routePurpose: "blocker_capture_ack",
      branchMigratedToLane: true,
      branchName: "blocker_capture_ack",
      blockerFacts: {
        blocker_text: "distraction",
        blocker_category: "user_partial",
        repeated_blocker_signal: true,
        following_event_type: "user_no",
        blocker_pending_age_minutes_remaining: 10,
        suggested_next_move: "Two hours deep work",
        legacy_blocker_ack_preview: legacyAck,
      },
    });
    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: ["test_blocker_ack"] });
    expect(r.shouldSend).toBe(true);
    expect(r.body.trim()).not.toBe(legacyAck.trim());
    expect(r.metadata.route_purpose).toBe("blocker_capture_ack");
  });
});

describe("Phase 3C inbound lane (open_question_answer)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("deriveSuggested uses open_question_facts", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      arc: { ambiguous_short_reply: false, clarification_required: false },
      routePurpose: "open_question_answer",
      branchMigratedToLane: true,
      branchName: "open_question_answer",
      openQuestionFacts: {
        latest_open_question: "What time works?",
        expected_reply_semantics: "time_or_schedule",
        resolution_subkind: "time_or_schedule",
        extracted_answer: "9am",
        answer_kind: "time_or_schedule",
        old_open_question_reply_preview: "LEGACY_TRY_GENERATE_PREVIEW",
        deterministic_fallback_used: true,
        deterministic_fallback_reason: "openai_failed_or_empty",
        legacy_open_question_reply_source: "deterministic_fallback",
        latest_outbound_preview: "Did you protect focus?",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("respond_to_open_question_answer_natural");
  });

  it("open_question_answer lane: clean body is not the legacy tryGenerate preview", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Nine works — lock it on the calendar and text me when the first block starts.",
              no_send_reason: null,
              turn_purpose: "answer_open_question",
              voice_confidence: 0.75,
              used_facts: ["open_question_facts", "thread"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: true,
            }),
          },
        },
      ],
    });
    const legacyPreview = "DETERMINISTIC_OR_OPENAI_LEGACY_TRY_GENERATE_BODY";
    const oqFacts = {
      latest_open_question: "What time works tomorrow?",
      expected_reply_semantics: "time_or_schedule",
      resolution_subkind: "time_or_schedule",
      extracted_answer: "9am",
      answer_kind: "time_or_schedule",
      old_open_question_reply_preview: legacyPreview,
      deterministic_fallback_used: true,
      deterministic_fallback_reason: "openai_failed_or_empty",
      legacy_open_question_reply_source: "deterministic_fallback" as const,
      latest_outbound_preview: "Did you hit two hours?",
    };
    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      arc: { ambiguous_short_reply: false, clarification_required: false },
      routePurpose: "open_question_answer",
      branchMigratedToLane: true,
      branchName: "open_question_answer",
      openQuestionFacts: oqFacts,
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["tryResolveAnswerToOpenQuestionTurn", "tryGenerateV3OpenQuestionCoachReply_legacy_preview_only"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body.trim()).not.toBe(legacyPreview.trim());
    expect(r.metadata.route_purpose).toBe("open_question_answer");
    expect(r.metadata.open_question_facts_summary).toEqual(slimOpenQuestionFactsForTelemetry(oqFacts));
    const messages = createMock.mock.calls[0]?.[0]?.messages as { content?: string; role?: string }[] | undefined;
    const systemContent = messages?.find((m) => m.role === "system")?.content ?? "";
    const userContent = messages?.find((m) => m.role === "user")?.content ?? "";
    expect(systemContent).toMatch(/primary coaching move/i);
    expect(systemContent).not.toMatch(/ROUTE \(open_question_answer\)/);
    expect(userContent).toContain("STRATEGY_CARD_V1");
    expect(userContent).toContain('"route_kind":"open_question_answer"');
    expect(userContent).toContain('"open_question_answer_kind":"time_or_schedule"');
    expect(userContent).not.toContain('"open_question_facts"');
  });

  it("open_question_answer lane no-send is tagged for operator last_error", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: false,
              body: "",
              no_send_reason: "unsafe_facts",
              turn_purpose: "no_send",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: false,
            }),
          },
        },
      ],
    });
    const facts = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      gatedDecision: REFINE_ONLY_GATED,
      arc: { ambiguous_short_reply: false, clarification_required: false },
      routePurpose: "open_question_answer",
      branchMigratedToLane: true,
      branchName: "open_question_answer",
      openQuestionFacts: {
        latest_open_question: "Story title?",
        expected_reply_semantics: "open_reflection",
        resolution_subkind: "open_reflection",
        extracted_answer: "The long hallway",
        answer_kind: "open_reflection",
        old_open_question_reply_preview: "LEGACY",
        deterministic_fallback_used: false,
        deterministic_fallback_reason: null,
        legacy_open_question_reply_source: "openai",
        latest_outbound_preview: null,
      },
    });
    const r = await produceInboundV3RelationshipSms({ facts, telemetry_fact_sources: ["test_oq_lane"] });
    expect(r.shouldSend).toBe(false);
    const err = formatInboundV3LaneNoSendLastError(r, {
      route_purpose: "open_question_answer",
      branch_name: "open_question_answer",
      branch_migrated_to_lane: true,
    });
    const parsed = JSON.parse(err) as { tag?: string; route_purpose?: string; branch_name?: string };
    expect(parsed.tag).toBe("inbound_v3_lane_no_send");
    expect(parsed.route_purpose).toBe("open_question_answer");
    expect(parsed.branch_name).toBe("open_question_answer");
  });
});
