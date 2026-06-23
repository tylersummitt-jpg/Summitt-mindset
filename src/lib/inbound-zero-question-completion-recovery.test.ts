import { describe, expect, it } from "vitest";
import {
  buildZeroQuestionCompletionFallbackAck,
  isAcknowledgeCompletionZeroQuestionRecoveryEligible,
  repairZeroQuestionCompletionStatement,
  tryRecoverAcknowledgeCompletionZeroQuestionBody,
} from "@/lib/inbound-zero-question-completion-recovery";
import type { InboundV3RelationshipFacts, InboundV3RelationshipLaneInput } from "@/lib/v3-inbound-relationship-lane";

function stepCompletionFacts(
  userMessage: string,
  overrides?: Partial<InboundV3RelationshipFacts>
): InboundV3RelationshipFacts {
  return {
    route_purpose: "normal_inbound_reply",
    user: {
      clerk_user_id: "user-1",
      preferred_name: "Brooke",
      timezone: "America/New_York",
      local_time_iso: "2026-06-22T20:06:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "commit-steps",
      title: "10,000 steps",
      behavior_statement: "Walk 10,000 steps every day",
      effective_ask: "Did you get your 10,000 steps today?",
      accountability_phase: "active",
    },
    thread: {
      latest_inbound_raw: userMessage,
      coalesced_inbound_text: userMessage,
      suppressed_message_sids: [],
      recent_transcript_lines: [`Coach: Did you get your steps?`, `User: ${userMessage}`],
      latest_outbound_coach_sms: "Did you get your steps?",
      latest_open_question: "Did you get your steps?",
      latest_answer_after_open_question: null,
      expected_reply_semantics: "coach_yes_no",
      memory_authority: {
        open_question_source: "north_star",
        answer_source: "none",
        projection_used: false,
      },
      do_not_repeat_hints: [],
      rejected_time_candidates: [],
      unavailable_windows: [],
      current_inbound_is_already_told_you_correction: false,
      current_inbound_is_short_acknowledgement: false,
      most_recent_substantive_prior_user_message: null,
      most_recent_coach_question: "Did you get your steps?",
      memory_correction_should_use_prior_user_answer: false,
      short_ack_should_not_reask_question: false,
    },
    v2_accountability: {
      deterministic_classifier_event: "user_yes",
      gated_mode: "normal_outcome",
      final_event_type: "user_yes",
      should_write_outcome_event: true,
      reply_style: "normal_outcome",
      proof_signal: true,
      miss_signal: false,
      blocker_signal: false,
      today_completed: true,
      future_intent_hint: null,
      supplement_commitment_change_guidance: false,
    },
    legacy_suggestions: {
      conversation_brain: { enabled: false },
      central_brain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forced_future_stretch_intent_active: false,
      wave11_memory_confirmation_pending: false,
      accountability_proof_hint: null,
    },
    inbound_meaning: {
      relationship_meaning: "reported_completion",
      persistence_decision: "write_user_yes_today",
      temporal_scope: "today",
      sms_response_intent: "acknowledge_completion_and_next_step",
      evidence: [],
      reason: "substantive_self_reported_completion",
      spoken_local_day_key: "2026-06-22",
      reported_for_day_key: "2026-06-22",
    } as InboundV3RelationshipFacts["inbound_meaning"],
    inbound_resolved_truth: {
      latest_user_text: userMessage,
      resolved_outcome: "completed",
      temporal_scope: "today",
      plan_detected: false,
      blocker_detected: false,
      answered_recent_ask: false,
      satisfied_recent_ask: false,
      persistence_decision: "write_user_yes_today",
      required_reply_move: "acknowledge_completion",
      max_questions_override: 0,
      must_not_do: ["Do not ask whether it already happened."],
    },
    suggested_coaching_move: "acknowledge_completion",
    constraints: {
      max_chars: 320,
      one_sms: true,
      no_generic_motivation: true,
      no_quoted_or_truncated_echo_of_inbound: true,
      if_unsafe_return_no_send: true,
    },
    ...overrides,
  };
}

function laneInput(
  facts: InboundV3RelationshipFacts,
  proof?: { persisted: boolean; eventType?: "user_yes" | null }
): InboundV3RelationshipLaneInput {
  return {
    facts,
    telemetry_fact_sources: ["test"],
    proof_persisted_before_writer: proof?.persisted ?? false,
    proof_persisted_event_type: proof?.eventType ?? null,
  };
}

describe("repairZeroQuestionCompletionStatement", () => {
  it("strips ask-shaped second sentence", () => {
    const repaired = repairZeroQuestionCompletionStatement(
      "You got your 10,000 steps in today. How did it feel?"
    );
    expect(repaired).toBe("You got your 10,000 steps in today.");
    expect(repaired).not.toMatch(/\?/);
  });

  it("sanitizes great job prefix when factual remainder remains", () => {
    const repaired = repairZeroQuestionCompletionStatement(
      "Great job getting your 10,000 steps. How did it feel?"
    );
    expect(repaired).toMatch(/10,000 steps/);
    expect(repaired).not.toMatch(/\?/);
    expect(repaired).not.toMatch(/great job/i);
  });
});

describe("buildZeroQuestionCompletionFallbackAck", () => {
  it("includes 10,000 steps when user proof contains it", () => {
    const ack = buildZeroQuestionCompletionFallbackAck(
      stepCompletionFacts("I got my 10,000 steps today")
    );
    expect(ack).toBe("That counts — 10,000 steps today.");
    expect(ack).not.toMatch(/\?/);
  });
});

describe("tryRecoverAcknowledgeCompletionZeroQuestionBody", () => {
  it("uses repair when clean statement remains", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    const result = tryRecoverAcknowledgeCompletionZeroQuestionBody(
      "You got your 10,000 steps in today. How did it feel?",
      laneInput(facts, { persisted: true, eventType: "user_yes" }),
      () => true
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.telemetry.zero_question_repair_succeeded).toBe(true);
      expect(result.telemetry.zero_question_completion_fallback_used).toBe(false);
      expect(result.telemetry.final_reply_source).toBe("zero_question_repair");
    }
  });

  it("uses fallback when repair fails and proof persisted", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    const result = tryRecoverAcknowledgeCompletionZeroQuestionBody(
      "How did it feel today?",
      laneInput(facts, { persisted: true, eventType: "user_yes" }),
      () => true
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toContain("10,000 steps");
      expect(result.telemetry.zero_question_completion_fallback_used).toBe(true);
      expect(result.telemetry.final_reply_source).toBe("zero_question_completion_fallback");
    }
  });

  it("does not recover without proof_persisted_before_writer", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    const result = tryRecoverAcknowledgeCompletionZeroQuestionBody(
      "Nice. How did it feel?",
      laneInput(facts, { persisted: false }),
      () => true
    );
    expect(result.ok).toBe(false);
    expect(result.telemetry.zero_question_repair_attempted).toBe(false);
  });

  it("uses fallback when praise-only writer body cannot produce valid repair", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    const result = tryRecoverAcknowledgeCompletionZeroQuestionBody(
      "Good job! How did it feel?",
      laneInput(facts, { persisted: true, eventType: "user_yes" }),
      () => true
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("That counts — 10,000 steps today.");
      expect(result.telemetry.zero_question_completion_fallback_used).toBe(true);
      expect(result.telemetry.final_reply_source).toBe("zero_question_completion_fallback");
    }
  });

  it("uses fallback when repaired statement fails lane validation", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    let validateCalls = 0;
    const result = tryRecoverAcknowledgeCompletionZeroQuestionBody(
      "You got your 10,000 steps today. How did it feel?",
      laneInput(facts, { persisted: true, eventType: "user_yes" }),
      () => {
        validateCalls += 1;
        return validateCalls > 1;
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.telemetry.zero_question_completion_fallback_used).toBe(true);
      expect(result.body).toContain("10,000 steps");
    }
  });

  it("does not recover for close_loop_on_answered_ask", () => {
    const facts = stepCompletionFacts("I already told you", {
      inbound_resolved_truth: {
        latest_user_text: "I already told you",
        resolved_outcome: "none",
        temporal_scope: "today",
        plan_detected: false,
        blocker_detected: false,
        answered_recent_ask: true,
        satisfied_recent_ask: true,
        persistence_decision: "ack_only",
        required_reply_move: "close_loop_on_answered_ask",
        max_questions_override: 0,
        must_not_do: [],
      },
    });
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible(
        laneInput(facts, { persisted: true, eventType: "user_yes" })
      )
    ).toBe(false);
  });

  it("does not recover for crisis safety tier", () => {
    const facts = stepCompletionFacts("I want to hurt myself");
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible(
        laneInput(facts, { persisted: true, eventType: "user_yes" })
      )
    ).toBe(false);
  });

  it("does not recover for STOP compliance turn", () => {
    const facts = stepCompletionFacts("STOP");
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible(
        laneInput(facts, { persisted: true, eventType: "user_yes" })
      )
    ).toBe(false);
  });

  it("requires all eligibility gates for fallback", () => {
    const facts = stepCompletionFacts("I got my 10,000 steps today");
    const base = laneInput(facts, { persisted: true, eventType: "user_yes" });
    expect(isAcknowledgeCompletionZeroQuestionRecoveryEligible(base)).toBe(true);
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible({
        ...base,
        proof_persisted_before_writer: false,
      })
    ).toBe(false);
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible({
        ...base,
        proof_persisted_event_type: null,
      })
    ).toBe(false);
    const wrongMove = {
      ...facts,
      inbound_resolved_truth: {
        ...facts.inbound_resolved_truth!,
        required_reply_move: "protect_future_plan" as const,
      },
    };
    expect(
      isAcknowledgeCompletionZeroQuestionRecoveryEligible(
        laneInput(wrongMove, { persisted: true, eventType: "user_yes" })
      )
    ).toBe(false);
  });
});
