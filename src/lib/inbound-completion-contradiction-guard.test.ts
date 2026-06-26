import { describe, expect, it } from "vitest";
import {
  COMPLETION_CONTRADICTION_PHRASE_RE,
  detectExplicitAlignedInboundCompletion,
  detectInboundCompletionContradictionViolation,
  tryRecoverInboundCompletionContradictionBody,
} from "@/lib/inbound-completion-contradiction-guard";
import { isReportedCompletionRelationshipCandidate } from "@/lib/pending-plan-proof";
import type { InboundV3RelationshipFacts, InboundV3RelationshipLaneInput } from "@/lib/v3-inbound-relationship-lane";

const BROOKE_COALESCED =
  "I got my goal this morning while walking the dogs\nI hit 10000 steps already";

const BROOKE_BAD_REPLY =
  "Good hitting 10,000 steps this morning while walking the dogs! What do you think kept you from reaching your full goal today?";

const stepAlignment = {
  commitmentBehaviorStatement: "Walk 10,000 steps every day",
  effectiveAsk: "Did you get your 10,000 steps today?",
  commitmentTitle: "10,000 steps",
};

function brookeFacts(): InboundV3RelationshipFacts {
  return {
    route_purpose: "normal_inbound_reply",
    commitment: {
      id: "c1",
      title: "10,000 steps",
      behavior_statement: "Walk 10,000 steps every day",
      effective_ask: "Did you get your 10,000 steps today?",
      accountability_phase: "active",
    },
    thread: {
      latest_inbound_raw: BROOKE_COALESCED,
      coalesced_inbound_text: BROOKE_COALESCED,
      suppressed_message_sids: [],
      recent_transcript_lines: [],
      latest_outbound_coach_sms: null,
      latest_open_question: null,
      latest_answer_after_open_question: null,
      memory_authority: {
        open_question_source: "none",
        answer_source: "none",
        projection_used: false,
      },
      expected_reply_semantics: null,
      do_not_repeat_hints: [],
      rejected_time_candidates: [],
      unavailable_windows: [],
    },
    constraints: { max_chars: 480, forbidden_substrings: [], required_verbatim_substrings: [] },
    inbound_meaning: {
      relationship_meaning: "reported_completion",
      temporal_scope: "today",
      confidence: "high",
      evidence: ["test"],
      disqualifiers: [],
      persistence_decision: "write_user_yes_today",
      reason: "test",
    },
    v2_accountability: {
      deterministic_classifier_event: "user_yes",
      final_event_type: "user_yes",
      today_completed: false,
    },
    legacy_suggestions: {},
    user: {
      clerk_user_id: "user_brooke",
      preferred_name: "Brooke",
      timezone: "America/New_York",
      local_time_iso: "2026-06-26T16:00:00.000Z",
      relationship_profile_summary: null,
    },
  } as InboundV3RelationshipFacts;
}

function laneInput(facts: InboundV3RelationshipFacts): InboundV3RelationshipLaneInput {
  return {
    facts,
    telemetry_fact_sources: ["test"],
    proof_persisted_before_writer: true,
    proof_persisted_event_type: "user_yes",
  };
}

describe("inbound-completion-contradiction-guard", () => {
  it("detects explicit aligned completion for Brooke coalesced body", () => {
    expect(detectExplicitAlignedInboundCompletion(BROOKE_COALESCED, stepAlignment)).toBe(true);
    expect(isReportedCompletionRelationshipCandidate(BROOKE_COALESCED)).toBe(true);
  });

  it("future plan is not a completion candidate", () => {
    expect(isReportedCompletionRelationshipCandidate("I will get 10000 steps tonight")).toBe(false);
  });

  it("off-goal brushing is not explicit aligned completion for step commitment", () => {
    expect(
      detectExplicitAlignedInboundCompletion("I hit my goal of brushing my teeth", stepAlignment)
    ).toBe(false);
  });

  it("flags Brooke bad reply as contradiction", () => {
    const violation = detectInboundCompletionContradictionViolation(BROOKE_BAD_REPLY, brookeFacts());
    expect(violation.violation).toBe(true);
    expect(COMPLETION_CONTRADICTION_PHRASE_RE.test(BROOKE_BAD_REPLY)).toBe(true);
  });

  it("repairs Brooke bad reply to statement-only acknowledgement", () => {
    const recovered = tryRecoverInboundCompletionContradictionBody(
      BROOKE_BAD_REPLY,
      laneInput(brookeFacts()),
      () => true
    );
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.body).not.toMatch(/\?/);
    expect(recovered.body).not.toMatch(COMPLETION_CONTRADICTION_PHRASE_RE);
    expect(recovered.telemetry.completion_contradiction_guard_applied).toBe(true);
    expect(recovered.telemetry.explicit_aligned_completion_detected).toBe(true);
  });

  it("miss turn may still ask what got in the way", () => {
    const missFacts = {
      ...brookeFacts(),
      thread: {
        ...brookeFacts().thread,
        coalesced_inbound_text: "I missed my steps today because I had no time",
        latest_inbound_raw: "I missed my steps today because I had no time",
      },
    };
    const reply = "That makes sense. What got in the way today?";
    expect(detectInboundCompletionContradictionViolation(reply, missFacts).violation).toBe(false);
  });
});
