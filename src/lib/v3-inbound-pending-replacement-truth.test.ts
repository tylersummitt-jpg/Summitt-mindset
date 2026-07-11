import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  bodyCoachesStaleCanonicalBar,
  bodyRepresentsPendingCandidate,
  buildInboundPendingReplacementFactsFromCommitment,
  buildPendingReplaceSafeClarificationFallback,
  detectPendingReplacementStateTruthViolations,
  detectSeasonTransitionTruthViolations,
  tryPendingReplaceActiveTruthFallback,
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

  it("returns hallway facts for awaiting_candidate with empty candidate (outranks old-goal coaching)", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({
        behavior_statement: "I will run 2 miles a day",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          raw_user_text: "I want to change my goal",
          inbound_message_sid: "SM_hall",
          ai_confidence: null,
          candidate_behavior_statement: null,
          candidate_new_bar: null,
        },
      })
    );
    expect(facts).not.toBeNull();
    expect(facts?.pending_resolution_sms_state).toBe("awaiting_candidate");
    expect(facts?.pending_candidate_behavior_statement).toBe("");
    expect(facts?.required_meaning_summary).toMatch(/suspended|hallway|do NOT coach canonical/i);
    expect(facts?.required_meaning_summary).toMatch(/fits with the old/i);
  });

  it("returns null when pending is not commitment_replace", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({ pending_resolution_kind: "commitment_tighten" })
    );
    expect(facts).toBeNull();
  });
});

describe("detectPendingReplacementStateTruthViolations — empty-candidate hallway", () => {
  it("blocks old-goal for-today coaching while awaiting_candidate with no candidate", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({
        behavior_statement: "I will do one small helpful act for my wife today without being asked.",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          raw_user_text: "more active",
          inbound_message_sid: "SM_x",
          ai_confidence: null,
          candidate_behavior_statement: null,
          candidate_new_bar: null,
        },
      })
    )!;
    const hits = detectPendingReplacementStateTruthViolations(
      "It's great you're looking to be more active! For today, focus on doing one small helpful act for Civia without being asked.",
      facts
    );
    expect(hits).toContain("pending_replace_coaches_stale_canonical_bar");
  });

  it("blocks fit-with-old-goal clarification loops", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({
        behavior_statement: "I will run 2 miles a day",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          raw_user_text: "lift",
          inbound_message_sid: "SM_y",
          ai_confidence: null,
          candidate_behavior_statement: null,
          candidate_new_bar: null,
        },
      })
    )!;
    const hits = detectPendingReplacementStateTruthViolations(
      "Let's clarify how this fits with your current commitment to running 2 miles a day.",
      facts
    );
    expect(hits).toContain("pending_replace_coaches_stale_canonical_bar");
  });

  it("allows a pure hallway ask with no old-goal assignment", () => {
    const facts = buildInboundPendingReplacementFactsFromCommitment(
      baseCommitment({
        behavior_statement: "I will run 2 miles a day",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          raw_user_text: "change",
          inbound_message_sid: "SM_z",
          ai_confidence: null,
          candidate_behavior_statement: null,
          candidate_new_bar: null,
        },
      })
    )!;
    const hits = detectPendingReplacementStateTruthViolations(
      "Got it. What new goal do you want me to hold you to?",
      facts
    );
    expect(hits).toEqual([]);
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

  it("11: sends fallback containing candidate when writer omits candidate during pending replace", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Great work last night — I'll add that to your calendar going forward.",
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

    const legacyPreview =
      "I'm still holding: Walk 10,000 steps. Tell me if that's the lock—or what you want instead.";
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_brooke",
      preferredName: "Brooke",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "I will declutter a little at a time",
      userMessageRaw: "Yes, confirm and accomplished last night.",
      coalescedInboundText: "Yes, confirm and accomplished last night.",
      suppressedMessageSids: [],
      transcriptLines: ["User: Yes, confirm and accomplished last night."],
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
      pendingResolutionFacts: {
        resolution_type: "commitment_replace",
        pending_action: "commitment_replace",
        user_answer_type: "pending_confirmation_ambiguous",
        state_transition_summary:
          "Confirmation ambiguous; pending remains awaiting_confirmation before visible SMS.",
        updated_commitment_snapshot: "{}",
        legacy_pending_reply_preview: legacyPreview,
      },
    });

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_stage).toBe("pending_replace_truth_fallback");
    expect(r.metadata.pending_replace_truth_fallback_used).toBe(true);
    expect(r.body.toLowerCase()).toMatch(/walk|10,?000|steps/);
    expect(r.body.toLowerCase()).not.toMatch(/reply yes|reply no/);
    expect(r.body.toLowerCase()).not.toMatch(/updated|changed|locked in your goal/);
    expect(r.metadata.final_reply_source).toBe("pending_replace_truth_fallback");
  });

  it("12: fallback does not claim goal changed", async () => {
    const prFacts = pendingReplacementFacts;
    const fallback = tryPendingReplaceActiveTruthFallback({
      pendingReplacementFacts: prFacts,
      legacyPendingReplyPreview:
        "I'm still holding: Walk 10,000 steps. Tell me if that's the lock—or what you want instead.",
      stateTransitionSummary:
        "Confirmation ambiguous; pending remains awaiting_confirmation before visible SMS.",
      truthViolations: ["pending_replace_candidate_not_represented"],
    });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.body.toLowerCase()).not.toMatch(/updated|changed your goal|commitment is updated/);
      expect(fallback.body.toLowerCase()).not.toMatch(/the lock|locked in|i'?m still holding:|let'?s confirm/);
      expect(fallback.body.toLowerCase()).toMatch(/new goal|hold you to/);
    }
  });

  it("user-visible pending fallback has no lock / I'm still holding jargon", () => {
    const body = buildPendingReplaceSafeClarificationFallback("Walk 10,000 steps");
    expect(body.toLowerCase()).not.toMatch(/the lock|locked in|i'?m still holding:|candidate bar|daily bar|let'?s confirm/);
    expect(body.toLowerCase()).toMatch(/new goal|hold you to/);
    expect(body).toMatch(/Walk 10,000 steps/);
  });

  it("14: fallback is not used when pending_resolution_applied is true", () => {
    const fallback = tryPendingReplaceActiveTruthFallback({
      pendingReplacementFacts: { ...pendingReplacementFacts, pending_resolution_applied: true },
      legacyPendingReplyPreview: "Done. Updated bar: Walk 10,000 steps.",
      stateTransitionSummary: "SMS pending-resolution replace applied",
      truthViolations: ["pending_replace_candidate_not_represented"],
    });
    expect(fallback.ok).toBe(false);
    expect(fallback.reason).toBe("pending_not_active_or_applied");
  });

  it("15: constructs safe fallback when legacy lacks candidate but pending candidate exists", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Great work last night!",
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
      userMessageRaw: "yes",
      coalescedInboundText: "yes",
      suppressedMessageSids: [],
      transcriptLines: ["User: yes"],
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
      pendingResolutionFacts: {
        resolution_type: "commitment_replace",
        pending_action: "commitment_replace",
        user_answer_type: "pending_confirmation_ambiguous",
        state_transition_summary: "pending remains awaiting_confirmation",
        updated_commitment_snapshot: "{}",
        legacy_pending_reply_preview: "Thanks — noted.",
      },
    });

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_stage).toBe("pending_replace_truth_fallback");
    expect(r.metadata.pending_replace_truth_fallback_reason).toBe("constructed_safe_fallback");
    expect(r.metadata.pending_replace_state_truth_blocked_reasons).toEqual(
      expect.arrayContaining(["pending_replace_candidate_not_represented"])
    );
    expect(r.body.toLowerCase()).toMatch(/walk|10,?000|steps/);
  });

  it("uses fallback when model coaches stale canonical bar during pending replace", async () => {
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

    const legacyPreview =
      "I'm still holding: Walk 10,000 steps. Tell me if that's the lock—or what you want instead.";
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
      pendingResolutionFacts: {
        resolution_type: "commitment_replace",
        pending_action: "commitment_replace",
        user_answer_type: "pending_confirmation_ambiguous",
        state_transition_summary:
          "Confirmation ambiguous; pending remains awaiting_confirmation before visible SMS.",
        updated_commitment_snapshot: "{}",
        legacy_pending_reply_preview: legacyPreview,
      },
    });

    expect(facts.pending_replacement_facts?.pending_candidate_behavior_statement).toContain("Walk");

    const r = await produceInboundV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["test"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_stage).toBe("pending_replace_truth_fallback");
    expect(r.metadata.pending_replace_state_truth_blocked_reasons).toEqual(
      expect.arrayContaining(["pending_replace_coaches_stale_canonical_bar"])
    );
    expect(r.body.toLowerCase()).toMatch(/walk|10,?000|steps/);
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
