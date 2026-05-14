import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { isV3OwnedInboundReplySource } from "@/lib/v3-sms-brain";
import { isV3RelationshipVoiceReplySource } from "@/lib/north-star-coach-sms";
import {
  buildInboundV3RelationshipFacts,
  produceInboundV3RelationshipSms,
  type InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";

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
