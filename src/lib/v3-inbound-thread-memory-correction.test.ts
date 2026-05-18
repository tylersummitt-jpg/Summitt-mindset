import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  buildInboundV3RelationshipFacts,
  deriveInboundThreadMemoryCorrectionFields,
  extractMostRecentCoachQuestion,
  extractMostRecentSubstantivePriorUserMessage,
  isAlreadyToldYouCorrection,
  isShortAcknowledgement,
} from "@/lib/v3-inbound-relationship-lane";
import { slimMemoryPacketForFacts, type SmsRelationshipMemoryPacket } from "@/lib/sms-relationship-memory-packet";

const RB_TRANSCRIPT = [
  "Coach: What story will you dictate today to keep building on that momentum? Early childhood memories could be a great starting point!",
  "User: Yes will continue with those and expand list for future reminder.",
  "Coach: Expanding your list sounds like a solid plan! Make sure to set aside time to dictate your stories. What specific stories are you considering?",
  "User: Sunday School, farm, songs Mother sang",
  "Coach: Sunday School, farm, and the songs your mother sang sound like a beautiful tapestry of memories. Let's aim to dictate that story tomorrow. Looking forward to hearing it.",
  "User: 👍",
  "Coach: I see your thumbs up! Let's keep that momentum going. What story will you dictate today?",
  "User: I already told you",
] as const;

function baseCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_rb",
    clerk_user_id: "user_rb",
    status: "active",
    behavior_statement: "Dictate stories daily",
    title: "Story dictation",
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

function baseGated(): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: "user_partial",
    decision_reason: "test",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

describe("inbound thread memory correction helpers", () => {
  it("detects already-told-you correction phrases", () => {
    expect(isAlreadyToldYouCorrection("I already told you")).toBe(true);
    expect(isAlreadyToldYouCorrection("already told you")).toBe(true);
    expect(isAlreadyToldYouCorrection("I already answered")).toBe(true);
    expect(isAlreadyToldYouCorrection("done")).toBe(false);
  });

  it("detects conservative short acknowledgements on normal inbound only", () => {
    expect(isShortAcknowledgement("👍", "normal_inbound_reply")).toBe(true);
    expect(isShortAcknowledgement("ok", "normal_inbound_reply")).toBe(true);
    expect(isShortAcknowledgement("got it", "normal_inbound_reply")).toBe(true);
    expect(isShortAcknowledgement("yes", "normal_inbound_reply")).toBe(false);
    expect(isShortAcknowledgement("👍", "adaptive_proposal_consent_accept")).toBe(false);
  });

  it("extracts most recent substantive prior user message for R.B. already-told-you turn", () => {
    const prior = extractMostRecentSubstantivePriorUserMessage(
      [...RB_TRANSCRIPT],
      "I already told you"
    );
    expect(prior).toBe("Sunday School, farm, songs Mother sang");
  });

  it("extracts most recent coach question from R.B. thread", () => {
    const q = extractMostRecentCoachQuestion([...RB_TRANSCRIPT]);
    expect(q).toMatch(/What story will you dictate today/i);
  });

  it("R.B. already-told-you facts flags", () => {
    const f = deriveInboundThreadMemoryCorrectionFields({
      recentTranscriptLines: [...RB_TRANSCRIPT],
      currentInbound: "I already told you",
      routePurpose: "normal_inbound_reply",
    });
    expect(f.current_inbound_is_already_told_you_correction).toBe(true);
    expect(f.most_recent_substantive_prior_user_message).toBe("Sunday School, farm, songs Mother sang");
    expect(f.memory_correction_should_use_prior_user_answer).toBe(true);
    expect(f.short_ack_should_not_reask_question).toBe(false);
  });

  it("R.B. thumbs-up short ack facts after substantive answer", () => {
    const transcriptThroughThumbs = RB_TRANSCRIPT.slice(0, 6);
    const f = deriveInboundThreadMemoryCorrectionFields({
      recentTranscriptLines: [...transcriptThroughThumbs],
      currentInbound: "👍",
      routePurpose: "normal_inbound_reply",
    });
    expect(f.current_inbound_is_short_acknowledgement).toBe(true);
    expect(f.most_recent_substantive_prior_user_message).toBe("Sunday School, farm, songs Mother sang");
    expect(f.short_ack_should_not_reask_question).toBe(true);
  });

  it("short ack with no prior substantive answer does not fabricate flags", () => {
    const f = deriveInboundThreadMemoryCorrectionFields({
      recentTranscriptLines: ["Coach: How did today go?", "User: 👍"],
      currentInbound: "👍",
      routePurpose: "normal_inbound_reply",
    });
    expect(f.current_inbound_is_short_acknowledgement).toBe(true);
    expect(f.most_recent_substantive_prior_user_message).toBeNull();
    expect(f.short_ack_should_not_reask_question).toBe(false);
  });

  it("buildInboundV3RelationshipFacts sets suggested move for already-told-you", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_rb",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: [...RB_TRANSCRIPT],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: "What story will you dictate today?",
        latestOpenQuestion: "What story will you dictate today?",
        expectedReplySemantics: "open_reflection",
      },
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
    });
    expect(facts.thread.current_inbound_is_already_told_you_correction).toBe(true);
    expect(facts.thread.most_recent_substantive_prior_user_message).toBe(
      "Sunday School, farm, songs Mother sang"
    );
    expect(facts.suggested_coaching_move).toBe("use_recent_answer_after_correction");
    expect(facts.constraints.forbidden_substrings).toEqual(
      expect.arrayContaining(["what story will you dictate"])
    );
  });

  it("memory packet supplies substantive prior answer when transcript lines are stale", () => {
    const packet: SmsRelationshipMemoryPacket = {
      clerk_user_id: "user_rb",
      commitment_id: "cmt_rb",
      behavior_statement: "Dictate stories daily",
      effective_ask: "Dictate stories daily",
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
        "Coach: What story will you dictate today?\nUser: Sunday School, farm, songs Mother sang",
      last_outbound_full_body: "What story will you dictate today?",
      last_inbound_full_body: "I already told you",
      last_substantive_user_message: "Sunday School, farm, songs Mother sang",
      last_substantive_coach_message: "What story will you dictate today?",
      last_5_coach_questions: [
        {
          text: "What story will you dictate today?",
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
      latest_open_question_guess: "What story will you dictate today?",
      latest_answer_after_open_question_guess: "Sunday School, farm, songs Mother sang",
      do_not_repeat_phrases: [],
      memory_priority_rules: [],
      meta: {
        message_count: 2,
        thread_text_capped: false,
        sources_used: [],
        built_at: "2026-05-18T12:00:00.000Z",
      },
    };
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_rb",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: ["Coach: About grammar school", "User: I already told you"],
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
      relationshipMemoryPacket: slimMemoryPacketForFacts(packet),
    });
    expect(facts.thread.most_recent_substantive_prior_user_message).toBe(
      "Sunday School, farm, songs Mother sang"
    );
    expect(facts.thread.memory_packet?.latest_answer_after_open_question_guess).toContain("Sunday School");
  });

  it("short ack overrides user_yes suggested move when prior substantive answer exists", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_rb",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T09:00:00.000Z",
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories daily",
      userMessageRaw: "👍",
      coalescedInboundText: "👍",
      suppressedMessageSids: [],
      transcriptLines: RB_TRANSCRIPT.slice(0, 6) as unknown as string[],
      northStarPacket: { source: "sms_inbound_coach" },
      gatedDecision: { ...baseGated(), final_event_type: "user_yes" },
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
    expect(facts.thread.short_ack_should_not_reask_question).toBe(true);
    expect(facts.suggested_coaching_move).toBe("acknowledge_prior_answer_without_reasking");
  });
});
