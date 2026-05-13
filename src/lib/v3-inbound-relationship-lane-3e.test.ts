import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  deriveSuggestedCoachingMoveForInboundFacts,
  produceInboundV3RelationshipSms,
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
    id: "cmt_3e",
    clerk_user_id: "user_3e",
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

function baseFactsArgs() {
  const gated = REFINE_ONLY_GATED;
  return {
    clerkUserId: "user_3e",
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
    arc: { ambiguous_short_reply: false, clarification_required: false },
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

describe("Phase 3E inbound lane (refresh / pending-resolution / memory confirmation)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("deriveSuggested uses refresh_facts before accountability fallback", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "refresh_identity",
      branchMigratedToLane: true,
      branchName: "refresh_identity_still_commitment_prompt",
      refreshFacts: {
        refresh_step: "identity",
        expected_answer: "STILL",
        user_answer_type: "STILL",
        state_transition_summary: "Test",
        legacy_refresh_reply_preview: "LEGACY_MACHINE",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("continue_refresh_coach_sms");
  });

  it("deriveSuggested uses pending_resolution_facts", () => {
    const f = buildInboundV3RelationshipFacts({
      ...baseFactsArgs(),
      routePurpose: "pending_resolution",
      branchMigratedToLane: true,
      branchName: "sms_pending_resolution_complete",
      pendingResolutionFacts: {
        resolution_type: "commitment_tighten",
        pending_action: "commitment_tighten",
        user_answer_type: "user_yes",
        state_transition_summary: "Handler finished",
        updated_commitment_snapshot: "{}",
        legacy_pending_reply_preview: "LEGACY_PENDING",
      },
    });
    expect(deriveSuggestedCoachingMoveForInboundFacts(f)).toBe("continue_pending_resolution_coach_sms");
  });

  it("deriveSuggested memory_decline vs memory_clarification vs memory_confirmation", () => {
    const baseMem = {
      pending_memory_kind: "identity",
      candidate_memory_fields: "{}",
      user_confirmation_parse: "yes",
      memory_applied: true,
      memory_declined: false,
      ambiguous: false,
      legacy_memory_reply_preview: "LEGACY",
    };
    expect(
      deriveSuggestedCoachingMoveForInboundFacts(
        buildInboundV3RelationshipFacts({
          ...baseFactsArgs(),
          routePurpose: "memory_decline",
          branchMigratedToLane: true,
          branchName: "wave11_memory_declined",
          memoryConfirmationFacts: { ...baseMem, user_confirmation_parse: "no", memory_declined: true },
        })
      )
    ).toBe("acknowledge_memory_declined");

    expect(
      deriveSuggestedCoachingMoveForInboundFacts(
        buildInboundV3RelationshipFacts({
          ...baseFactsArgs(),
          routePurpose: "memory_clarification",
          branchMigratedToLane: true,
          branchName: "wave11_memory_ambiguous",
          memoryConfirmationFacts: { ...baseMem, ambiguous: true, user_confirmation_parse: "ambiguous" },
        })
      )
    ).toBe("clarify_memory_confirmation_reply");

    expect(
      deriveSuggestedCoachingMoveForInboundFacts(
        buildInboundV3RelationshipFacts({
          ...baseFactsArgs(),
          routePurpose: "memory_confirmation",
          branchMigratedToLane: true,
          branchName: "wave11_memory_confirmed",
          memoryConfirmationFacts: baseMem,
        })
      )
    ).toBe("acknowledge_memory_update_outcome");
  });

  it("lane post-validate blocks when required_verbatim_substrings missing from model body", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Thanks — noted for the refresh thread.",
              no_send_reason: null,
              turn_purpose: "refresh_ack",
              voice_confidence: 0.8,
              used_facts: ["refresh_facts"],
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
      routePurpose: "refresh_confirmation",
      branchMigratedToLane: true,
      branchName: "refresh_commitment_keep_ack",
      refreshFacts: {
        refresh_step: "commitment",
        expected_answer: "KEEP",
        user_answer_type: "KEEP",
        state_transition_summary: "User kept bar",
        legacy_refresh_reply_preview: "MACHINE",
        required_verbatim_substrings: ["REQUIRED_SNIPPET_XYZ"],
      },
    });
    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test_3e_verbatim"],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("required_verbatim_missing");
  });

  it("replySource v3_inbound_relationship_lane remains protected (North Star OpenAI full finalizer off)", () => {
    expect(isV3RelationshipVoiceReplySource("v3_inbound_relationship_lane")).toBe(true);
    expect(isV3OwnedInboundReplySource("v3_inbound_relationship_lane")).toBe(true);
  });
});

describe("sms-inbound-coach route — Phase 3E wiring (static)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
  const route = readFileSync(routePath, "utf8");

  it("does not reference removed persistV2JobReplyReadyAndSend helper", () => {
    expect(route).not.toContain("persistV2JobReplyReadyAndSend");
  });

  it("processV2MemoryConfirmationInbound uses inbound lane send, not refineInboundSmsMachineDraft", () => {
    const start = route.indexOf("async function processV2MemoryConfirmationInbound");
    const end = route.indexOf("async function processV2SmsInboundPendingResolution");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
    expect(body).not.toContain("refineInboundSmsMachineDraft");
    expect(body).not.toContain("appendSmsParagraphIfUnderCap");
  });

  it("processV2SmsInboundPendingResolution uses inbound lane, not V3 inbound coach draft refine", () => {
    const start = route.indexOf("async function processV2SmsInboundPendingResolution");
    const end = route.indexOf("async function processV2CoachingRefreshInbound");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
    expect(body).toContain("routePurpose: \"pending_resolution\"");
    expect(body).not.toContain("produceV3InboundCoachDraft");
    expect(body).not.toContain("recoverV3InboundCoachDraftFromArgs");
  });

  it("persistRefreshSmsLaneAndSend still routes through inbound V3 relationship lane", () => {
    const start = route.indexOf("async function persistRefreshSmsLaneAndSend");
    const end = route.indexOf("async function mergeInboundMemoryIntoSmsPendingResolution");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("persistInboundV3RelationshipLaneReplyReadyAndSend");
  });
});
