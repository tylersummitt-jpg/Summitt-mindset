import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  bodyCoachesStaleCanonicalBar,
  bodyRepresentsPendingCandidate,
  buildInboundPendingReplacementFactsFromCommitment,
  detectPendingReplacementStateTruthViolations,
  detectSeasonTransitionTruthViolations,
} from "@/lib/v3-inbound-pending-replacement-truth";
import {
  buildInboundV3RelationshipFacts,
  produceInboundV3RelationshipSms,
  type InboundV3PendingReplacementFacts,
} from "@/lib/v3-inbound-relationship-lane";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";

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

function baseCommitment(overrides?: Partial<ActiveV2CommitmentRow>): ActiveV2CommitmentRow {
  return {
    id: "cmt_brooke",
    clerk_user_id: "user_brooke",
    title: "House organization",
    behavior_statement: "I will declutter a little at a time",
    accountability_phase: "active_accountability",
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-17T12:00:00.000Z",
    pending_resolution_payload: {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      raw_user_text: "walking 10,000 steps a day",
      inbound_message_sid: "SM123",
      ai_confidence: 0.9,
      candidate_behavior_statement: "Walk 10,000 steps",
      candidate_new_bar: "Walk 10,000 steps",
      memory_signal_snapshot: {
        memory_signal_summary: "User wants to change their goal to walking 10,000 steps a day.",
      },
    },
    updated_at: "2026-05-10T12:00:00.000Z",
    ...overrides,
  } as ActiveV2CommitmentRow;
}

const V3_REFINE_ONLY_GATED: V2InboundGatedDecision = {
  mode: "normal",
  final_event_type: null,
  should_write_outcome_event: false,
  reply_style: null,
};

const northStarPacket: NorthStarSmsContextPacket = {
  latestInboundRaw: "walking 10,000 steps",
  latestOutboundBody: null,
  latestOpenQuestion: null,
  behaviorStatement: "I will declutter a little at a time",
  effectiveAskText: "I will declutter a little at a time",
  expectedReplySemantics: null,
  proofSignal: false,
  missSignal: false,
  blockerSignal: false,
  todayCompleted: false,
  futureIntentHint: null,
};

const pendingReplacementFacts: InboundV3PendingReplacementFacts = {
  pending_resolution_active: true,
  pending_resolution_kind: "commitment_replace",
  pending_resolution_sms_state: "awaiting_confirmation",
  pending_candidate_behavior_statement: "Walk 10,000 steps",
  pending_candidate_new_bar: "Walk 10,000 steps",
  canonical_behavior_statement: "I will declutter a little at a time",
  pending_resolution_applied: false,
  required_meaning_summary: "candidate is truth",
};

describe("buildInboundPendingReplacementFactsFromCommitment", () => {
  it("builds facts for commitment_replace awaiting_confirmation with candidate", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(baseCommitment());
    expect(facts).not.toBeNull();
    expect(facts?.pending_candidate_behavior_statement).toBe("Walk 10,000 steps");
    expect(facts?.canonical_behavior_statement).toContain("declutter");
    expect(facts?.pending_resolution_applied).toBe(false);
  });

  it("returns null when pending is not commitment_replace", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({ pending_resolution_kind: "commitment_tighten" })
    );
    expect(facts).toBeNull();
  });
});

describe("detectPendingReplacementStateTruthViolations", () => {
  it("blocks false goal-updated language while pending", () => {
    const hits = detectPendingReplacementStateTruthViolations(
      "Your goal to keep your house organized has been updated. I'll hold you to declutter.",
      pendingReplacementFacts
    );
    expect(hits).toContain("pending_replace_false_applied_language");
    expect(hits).toContain("pending_replace_coaches_stale_canonical_bar");
  });

  it("allows natural confirmation about the candidate", () => {
    const hits = detectPendingReplacementStateTruthViolations(
      "I hear the switch: walking 10,000 steps a day. Before I hold you to it, is that the daily line you want?",
      pendingReplacementFacts
    );
    expect(hits).toEqual([]);
  });

  it("allows applied language when pending_resolution_applied is true", () => {
    const hits = detectPendingReplacementStateTruthViolations(
      "Done — your commitment is updated to Walk 10,000 steps.",
      { ...pendingReplacementFacts, pending_resolution_applied: true }
    );
    expect(hits).not.toContain("pending_replace_false_applied_language");
  });
});

describe("detectSeasonTransitionTruthViolations", () => {
  const sameChapterFacts = {
    chapter_changed: false,
    user_facing_transition: "same_chapter" as const,
    bar_raised_in_same_chapter: true,
    old_season_name: "Season 1",
    new_season_name: "Season 1",
  };

  const newChapterFacts = {
    chapter_changed: true,
    user_facing_transition: "new_chapter" as const,
    bar_raised_in_same_chapter: false,
    old_season_name: "Season 1",
    new_season_name: "Season 2",
  };

  it("blocks chapter language when user_facing_transition is none", () => {
    const hits = detectSeasonTransitionTruthViolations("That chapter is closed — let's walk.", {
      chapter_changed: false,
      user_facing_transition: "none",
      bar_raised_in_same_chapter: false,
      old_season_name: null,
      new_season_name: null,
    });
    expect(hits).toContain("season_transition_false_chapter_language");
  });

  it("blocks chapter language when facts are null", () => {
    const hits = detectSeasonTransitionTruthViolations("New chapter started.", null);
    expect(hits).toContain("season_transition_false_chapter_language");
  });

  it("blocks new chapter language for same_chapter bar raise", () => {
    const hits = detectSeasonTransitionTruthViolations("New chapter started.", sameChapterFacts);
    expect(hits).toContain("season_transition_false_chapter_language");
  });

  it("blocks season started language for same_chapter", () => {
    const hits = detectSeasonTransitionTruthViolations(
      "Your season started with a sharper bar.",
      sameChapterFacts
    );
    expect(hits).toContain("season_transition_false_chapter_language");
  });

  it("allows chapter language when chapter_changed is true", () => {
    const hits = detectSeasonTransitionTruthViolations("New chapter started.", newChapterFacts);
    expect(hits).toEqual([]);
  });
});

describe("bodyRepresentsPendingCandidate / bodyCoachesStaleCanonicalBar", () => {
  it("detects stale canonical coaching without candidate", () => {
    expect(bodyRepresentsPendingCandidate("Let's keep decluttering today.", "Walk 10,000 steps")).toBe(
      false
    );
    expect(
      bodyCoachesStaleCanonicalBar(
        "Your house organization goal — declutter a little at a time — is still the bar.",
        "I will declutter a little at a time",
        "Walk 10,000 steps"
      )
    ).toBe(true);
  });
});

describe("produceInboundV3RelationshipSms pending replace truth", () => {
  const prevOpenAi = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockReset();
  });

  afterEach(() => {
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
  });

  it("no-sends when model coaches stale canonical bar during pending replace", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Your goal to keep your house organized is still in progress — declutter a little at a time today.",
              no_send_reason: null,
              turn_purpose: "pending_replace",
              voice_confidence: 0.8,
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
      clerkUserId: "user_brooke",
      preferredName: "Brooke",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "I will declutter a little at a time",
      userMessageRaw: "walking 10,000 steps a day",
      coalescedInboundText: "walking 10,000 steps a day",
      suppressedMessageSids: [],
      transcriptLines: ["User: walking 10,000 steps a day"],
      northStarPacket,
      gatedDecision: V3_REFINE_ONLY_GATED,
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
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      branchMigratedToLane: true,
    });

    expect(facts.pending_replacement_facts?.pending_candidate_behavior_statement).toContain("Walk");

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test"],
    });

    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_stage).toBe("pending_replace_state_truth_blocked");
    expect(r.metadata.pending_replace_state_truth_blocked_reasons).toEqual(
      expect.arrayContaining(["pending_replace_coaches_stale_canonical_bar"])
    );
  });

  it("sends when model reflects the pending candidate", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "I hear you — walking 10,000 steps a day. Is that the daily line you want me to hold you to?",
              no_send_reason: null,
              turn_purpose: "pending_replace_confirm",
              voice_confidence: 0.85,
              used_facts: ["pending_replacement_facts"],
              safety_notes: [],
              rejected_times_obeyed: true,
              split_messages_handled: false,
            }),
          },
        },
      ],
    });

    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_brooke",
      preferredName: "Brooke",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "I will declutter a little at a time",
      userMessageRaw: "walking 10,000 steps a day",
      coalescedInboundText: "walking 10,000 steps a day",
      suppressedMessageSids: [],
      transcriptLines: ["User: walking 10,000 steps a day"],
      northStarPacket,
      gatedDecision: V3_REFINE_ONLY_GATED,
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
      routePurpose: "pending_resolution",
      branchName: "sms_pending_resolution_complete",
      branchMigratedToLane: true,
    });

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).toMatch(/walk|10,?000|steps/);
    expect(r.body.toLowerCase()).not.toMatch(/declutter/);
  });
});
