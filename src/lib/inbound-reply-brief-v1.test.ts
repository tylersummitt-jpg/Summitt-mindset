import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  applyInboundBriefMaxQuestionsGuard,
  buildInboundBriefWriterSystemPrompt,
  buildInboundReplyBriefV1,
  countFollowupQuestionsAskedOnDay,
  deriveMaxQuestionsForBrief,
  detectInboundBriefMaxQuestionsViolation,
  type InboundReplyBriefV1,
} from "@/lib/inbound-reply-brief-v1";
import {
  enrichReconciledWithInboundRouteContract,
  type ReconciledTurnUnderstanding,
} from "@/lib/openai-relationship-turn-understanding-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";

const RECENT_EXACT_THREAD_WINDOW_HOURS = 72 as const;

type GoldenThreadMessage = {
  at: string;
  at_local: string;
  at_local_timezone: string;
  local_day_key: string;
  role: "coach" | "user" | "system_no_send";
  body: string;
  message_kind: string | null;
  source_table: string;
  message_sid: string | null;
  delivery_status: "sent" | "cancelled" | "skipped" | "preview" | "unknown";
  is_exact_body: boolean;
};

const DAY_KEY = "2026-06-15";

function coachMsg(body: string, at = "2026-06-15T12:00:00.000Z"): GoldenThreadMessage {
  return {
    at,
    at_local: "2026-06-15T08:00:00",
    at_local_timezone: "America/Chicago",
    local_day_key: DAY_KEY,
    role: "coach",
    body,
    message_kind: "inbound_coach",
    source_table: "v2_commitment_sms",
    message_sid: "SM_coach",
    delivery_status: "sent",
    is_exact_body: true,
  };
}

function userMsg(body: string, at = "2026-06-15T12:05:00.000Z"): GoldenThreadMessage {
  return {
    at,
    at_local: "2026-06-15T08:05:00",
    at_local_timezone: "America/Chicago",
    local_day_key: DAY_KEY,
    role: "user",
    body,
    message_kind: "inbound_user",
    source_table: "sms_inbound_messages",
    message_sid: "SM_user",
    delivery_status: "sent",
    is_exact_body: true,
  };
}

function goldenFacts(
  latestInbound: string,
  overrides: Partial<InboundV3RelationshipFacts> = {}
): InboundV3RelationshipFacts {
  const priorCoach =
    overrides.thread?.latest_outbound_coach_sms ??
    overrides.thread?.most_recent_coach_question ??
    null;
  return {
    route_kind: "main_active_accountability",
    route_purpose: "normal_inbound_reply",
    branch_migrated_to_lane: false,
    user: {
      clerk_user_id: "user_golden",
      preferred_name: "Test",
      timezone: "America/Chicago",
      local_time_iso: "2026-06-15T14:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_golden",
      title: "Daily habit",
      behavior_statement: "Complete the daily commitment",
      effective_ask: "Complete the daily commitment",
      accountability_phase: "active_accountability",
    },
    thread: {
      latest_inbound_raw: latestInbound,
      coalesced_inbound_text: latestInbound,
      suppressed_message_sids: [],
      recent_transcript_lines: [],
      latest_outbound_coach_sms: priorCoach,
      latest_open_question: priorCoach,
      latest_answer_after_open_question: null,
      expected_reply_semantics: null,
      memory_authority: {
        open_question_source: "none",
        answer_source: "none",
        projection_used: false,
      },
      do_not_repeat_hints: [],
      rejected_time_candidates: [],
      unavailable_windows: [],
      current_inbound_is_already_told_you_correction: false,
      current_inbound_is_short_acknowledgement: false,
      most_recent_substantive_prior_user_message: null,
      most_recent_coach_question: priorCoach,
      memory_correction_should_use_prior_user_answer: false,
      short_ack_should_not_reask_question: false,
      memory_packet: {
        recent_exact_thread_text: "",
        recent_exact_thread_72h: {
          messages: [],
          window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
          message_count: 0,
          had_preview_messages: false,
          had_system_no_send: false,
        },
        relationship_memory_7d: {
          window_days: 7,
          built_at: "2026-06-15T12:00:00.000Z",
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
        },
        relationship_memory_30d: {
          window_days: 30,
          built_at: "2026-06-15T12:00:00.000Z",
          commitment_id: "cmt_golden",
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
        },
        recent_exact_message_count: 0,
        last_outbound_full_body: priorCoach,
        last_inbound_full_body: latestInbound,
        last_substantive_user_message: latestInbound,
        last_substantive_coach_message: priorCoach,
        last_5_coach_questions: priorCoach ? [priorCoach] : [],
        last_5_user_answers: [],
        latest_open_question: priorCoach,
        latest_answer_after_open_question: null,
        open_question_pending: Boolean(priorCoach),
        open_question_source: "none",
        answer_source: "none",
        projection_used: false,
        latest_open_question_guess: null,
        latest_answer_after_open_question_guess: null,
        do_not_repeat_phrases: [],
        memory_priority_rules: [],
      },
      ...overrides.thread,
    },
    v2_accountability: {
      deterministic_classifier_event: "user_yes",
      gated_mode: "use_deterministic",
      final_event_type: "user_yes",
      should_write_outcome_event: true,
      reply_style: "normal_outcome",
      proof_signal: false,
      miss_signal: false,
      blocker_signal: false,
      today_completed: false,
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
      reason: "golden_fixture",
      confidence: "high",
      evidence: [],
      disqualifiers: [],
      spoken_local_day_key: DAY_KEY,
      reported_for_day_key: DAY_KEY,
      user_timezone: "America/Chicago",
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

function expectMustNotDoIncludes(brief: InboundReplyBriefV1, phrase: RegExp | string) {
  const joined = brief.reply_strategy.must_not_do.join(" ");
  if (typeof phrase === "string") {
    expect(joined.toLowerCase()).toContain(phrase.toLowerCase());
  } else {
    expect(joined).toMatch(phrase);
  }
}

describe("buildInboundReplyBriefV1 golden fixtures", () => {
  it("1 — Tyler kids compliments: close loop after detailed answer", () => {
    const priorCoach = "What specific compliment did you give each of your kids today?";
    const latest =
      "Breck is Super Avenger Grateful Guy, Rocky is SuperHero Sweet Boy, Lakelyn is Joyful Girl.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        thread: {
          latest_outbound_coach_sms: priorCoach,
          most_recent_coach_question: priorCoach,
        },
        inbound_resolved_truth: {
          latest_user_text: latest,
          resolved_outcome: "completed",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: true,
          satisfied_recent_ask: true,
          persistence_decision: "write_user_yes_today",
          required_reply_move: "close_loop_on_answered_ask",
          max_questions_override: 0,
          must_not_do: ["Do not ask for proof or evidence again on this turn."],
        },
      }),
    });

    expect(["completion_proof", "answered_prior_question"]).toContain(brief.turn_type);
    expect(brief.resolved_truth.answered_prior_question).toBe(true);
    expect(brief.resolved_truth.goal_status_from_latest_message).toBe("completed");
    expect(brief.question_policy.max_questions).toBe(0);
    expectMustNotDoIncludes(brief, "what got in the way");
  });

  it("2 — Brooke false premise challenge", () => {
    const latest = "How do you know I accomplished it yesterday?";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        inbound_meaning: {
          relationship_meaning: "question",
          persistence_decision: "no_outcome_write",
          temporal_scope: "yesterday",
          sms_response_intent: "clarify_gently",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });

    expect(brief.turn_type).toBe("false_premise_challenge");
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("correct_false_premise");
    expectMustNotDoIncludes(brief, "invent facts");
    expectMustNotDoIncludes(brief, "double down");
  });

  it("3 — Paul gratitude repeat complaint", () => {
    const latest = "Already answered that in the first reply.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        thread: {
          latest_outbound_coach_sms: "What are three gratitudes from today?",
          most_recent_coach_question: "What are three gratitudes from today?",
        },
        inbound_resolved_truth: {
          latest_user_text: latest,
          resolved_outcome: "none",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: true,
          satisfied_recent_ask: true,
          persistence_decision: "no_outcome_write",
          required_reply_move: "close_loop_on_answered_ask",
          max_questions_override: 0,
          must_not_do: [],
        },
      }),
    });

    expect(["repeated_question_complaint", "answered_prior_question"]).toContain(brief.turn_type);
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("acknowledge_already_answered");
    expectMustNotDoIncludes(brief, "re-ask");
  });

  it("4 — Mandy asks for wisdom", () => {
    const latest =
      "Can you share some wisdom on relationships and balance? I could use your perspective.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        inbound_meaning: {
          relationship_meaning: "question",
          persistence_decision: "no_outcome_write",
          temporal_scope: "unspecified",
          sms_response_intent: "clarify_gently",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });

    expect(brief.turn_type).toBe("help_request");
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("give_direct_help");
  });

  it("5 — Dara motivation struggle", () => {
    const latest =
      "I am struggling with motivation to do my exercises in the morning.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        inbound_meaning: {
          relationship_meaning: "blocker",
          persistence_decision: "no_outcome_write",
          temporal_scope: "today",
          sms_response_intent: "identify_blocker_or_next_move",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });

    expect(brief.turn_type).toBe("help_request");
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("give_direct_help");
    expectMustNotDoIncludes(brief, "no-send");
  });

  it("6 — Kathy thanks + lateral/core preference", () => {
    const latest = "Thank you! I want to focus on lateral movements and core work.";
    const priorCoach = "What kind of movement are you hoping to get in today?";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        thread: {
          latest_outbound_coach_sms: priorCoach,
          most_recent_coach_question: priorCoach,
        },
        inbound_resolved_truth: {
          latest_user_text: latest,
          resolved_outcome: "none",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: true,
          satisfied_recent_ask: false,
          persistence_decision: "no_outcome_write",
          required_reply_move: "close_loop_on_answered_ask",
          must_not_do: [],
        },
      }),
    });

    expect(["answered_prior_question", "reflection"]).toContain(brief.turn_type);
    expect(brief.question_policy.max_questions).toBe(0);
    expectMustNotDoIncludes(brief, "can you share more");
  });

  it("7 — Jordan thank-you", () => {
    const latest = "Thank you I needed that!";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        inbound_meaning: {
          relationship_meaning: "reflective_share",
          persistence_decision: "ack_only",
          temporal_scope: "today",
          sms_response_intent: "acknowledge_reflection",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
        inbound_resolved_truth: {
          latest_user_text: latest,
          resolved_outcome: "none",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: false,
          satisfied_recent_ask: false,
          persistence_decision: "ack_only",
          required_reply_move: "acknowledge_reflection",
          max_questions_override: 0,
          must_not_do: [],
        },
      }),
    });

    expect(brief.turn_type).toBe("thanks_acknowledgment");
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("close_acknowledgment");
  });

  it("8 — Sandi early morning at work", () => {
    const latest = "Not yet. It's only 7:16 a.m. and I'm at work.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        user: {
          clerk_user_id: "user_golden",
          preferred_name: "Sandi",
          timezone: "America/Chicago",
          local_time_iso: "2026-06-15T12:16:00.000Z",
          relationship_profile_summary: null,
        },
        inbound_meaning: {
          relationship_meaning: "miss",
          persistence_decision: "no_outcome_write",
          temporal_scope: "today",
          sms_response_intent: "tell_truth_and_recover",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });

    expect(brief.turn_type).toBe("timing_context");
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.reply_strategy.move).toBe("timing_context_forward");
    expectMustNotDoIncludes(brief, "too early");
  });
});

describe("followup question policy", () => {
  it("counts delivered coach questions on accountability day", () => {
    const messages = [
      coachMsg("Did the two hours happen before noon?"),
      userMsg("Not yet"),
      coachMsg("What got in the way?", "2026-06-15T13:00:00.000Z"),
    ];
    expect(countFollowupQuestionsAskedOnDay(messages, DAY_KEY)).toBe(2);
  });

  it("forces max_questions 0 when followup already used today", () => {
    const policy = deriveMaxQuestionsForBrief({
      turnType: "miss",
      followupQuestionUsedToday: true,
      completionHasDetails: false,
    });
    expect(policy.max_questions).toBe(0);
    expect(policy.reason).toBe("followup_question_already_used_today");
  });

  it("forces max_questions 0 when inbound_resolved_truth.max_questions_override is 0", () => {
    const withoutOverride = deriveMaxQuestionsForBrief({
      turnType: "miss",
      followupQuestionUsedToday: false,
      completionHasDetails: false,
    });
    expect(withoutOverride.max_questions).toBe(1);

    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("done", {
        inbound_resolved_truth: {
          latest_user_text: "done",
          resolved_outcome: "completed",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: false,
          satisfied_recent_ask: false,
          persistence_decision: "write_user_yes_today",
          required_reply_move: "acknowledge_completion",
          max_questions_override: 0,
          must_not_do: [],
        },
      }),
    });

    expect(brief.turn_type).toBe("completion_proof");
    expect(
      deriveMaxQuestionsForBrief({
        turnType: "completion_proof",
        followupQuestionUsedToday: false,
        completionHasDetails: false,
      }).max_questions
    ).toBe(1);
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.question_policy.reason).toMatch(/resolved_truth_max_questions_override/);
  });
});

describe("brief max questions guard", () => {
  it("detects question mark when max_questions=0", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Thank you I needed that!", {
        inbound_resolved_truth: {
          latest_user_text: "Thank you I needed that!",
          resolved_outcome: "none",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: false,
          satisfied_recent_ask: false,
          persistence_decision: "ack_only",
          required_reply_move: "acknowledge_reflection",
          max_questions_override: 0,
          must_not_do: [],
        },
      }),
    });
    expect(brief.question_policy.max_questions).toBe(0);
    expect(detectInboundBriefMaxQuestionsViolation("Glad that helped — how are you feeling?", brief).violation).toBe(
      true
    );
  });

  it("repairs or falls back without no-send", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Thank you I needed that!"),
    });
    const out = applyInboundBriefMaxQuestionsGuard({
      body: "Glad that helped — how are you feeling today?",
      brief,
    });
    expect(out.body).not.toMatch(/\?/);
    expect(out.telemetry.inbound_brief_max_questions_guard_applied).toBe(true);
  });

  it("uses Jordan thanks fallback when repair empty", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Thank you I needed that!"),
    });
    const out = applyInboundBriefMaxQuestionsGuard({
      body: "How are you feeling?",
      brief,
    });
    expect(out.body).toBe("Good. Keep it simple today and let that be enough.");
    expect(out.telemetry.inbound_brief_max_questions_guard_fallback_used).toBe(true);
  });

  it("uses Sandi timing fallback", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Not yet. It's only 7:16 a.m. and I'm at work."),
    });
    const out = applyInboundBriefMaxQuestionsGuard({
      body: "Did you do it yet?",
      brief,
    });
    expect(out.body).toContain("fair window");
    expect(out.body).not.toMatch(/\?/);
  });

  it("uses Paul already-answered fallback for short ack + re-ask writer body", () => {
    const latest = "Already answered that in the first reply.";
    const priorCoach = "What are three gratitudes from today?";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(latest, {
        thread: {
          latest_outbound_coach_sms: priorCoach,
          most_recent_coach_question: priorCoach,
        },
        inbound_resolved_truth: {
          latest_user_text: latest,
          resolved_outcome: "none",
          temporal_scope: "today",
          plan_detected: false,
          blocker_detected: false,
          answered_recent_ask: true,
          satisfied_recent_ask: true,
          persistence_decision: "no_outcome_write",
          required_reply_move: "close_loop_on_answered_ask",
          max_questions_override: 0,
          must_not_do: [],
        },
      }),
    });
    const out = applyInboundBriefMaxQuestionsGuard({
      body: "Thanks — what are three gratitudes from today?",
      brief,
    });
    expect(out.body).toMatch(/already answered|answered the work in front of you/i);
    expect(out.telemetry.inbound_brief_max_questions_guard_fallback_used).toBe(true);
  });
});

describe("brief compactness", () => {
  it("does not embed full relationship packet fields", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Thank you!", {
        thread: {
          memory_packet: {
            recent_exact_thread_text: "x".repeat(5000),
            coaching_memory_summary: "y".repeat(3000),
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
      }),
    });
    const serialized = JSON.stringify(brief);
    expect(serialized.length).toBeLessThan(8000);
    expect(serialized).not.toContain("relationship_memory_30d");
    expect(brief.brief_version).toBe("inbound_reply_brief_v1");
  });
});

function phase1Reconciled(rawInbound: string, extra?: { openQuestionPending?: boolean; latestOpenQuestion?: string | null }) {
  return enrichReconciledWithInboundRouteContract(
    {
      proposal: null,
      reconciled_relationship_meaning: "unclear",
      reconciled_response_intent: "unclear_clarify",
      reconciled_persistence_decision: "no_outcome_write",
      reconciled_do_not_repeat_asks: [],
      last_ask_satisfied: "unclear",
      satisfaction_kind: "unclear",
      stale_ask_risk: false,
      confidence: 0.8,
      disagreement_flags: [],
      interpreter_failed_reason: null,
      stale_ask_avoided: false,
      persistence_note: "test",
      reconciled_goal_change_intent: null,
    } satisfies ReconciledTurnUnderstanding,
    {
      rawInbound,
      classifierEventType: "user_partial",
      openQuestionPending: extra?.openQuestionPending,
      latestOpenQuestion: extra?.latestOpenQuestion,
    }
  );
}

describe("Phase 1 route brief integration", () => {
  it("Thanks for the advice → acknowledgment_no_reply, not help_request", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Thanks for the advice", {
        turn_understanding: phase1Reconciled("Thanks for the advice"),
      }),
    });
    expect(brief.route).toBe("acknowledgment_no_reply");
    expect(brief.should_reply).toBe(false);
    expect(brief.turn_type).toBe("thanks_acknowledgment");
    expect(brief.turn_type).not.toBe("help_request");
  });

  it("win close loop brief has close_loop and zero questions", () => {
    const text = "And I gave them compliments today. So we hit the goal!";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, { turn_understanding: phase1Reconciled(text) }),
    });
    expect(brief.route).toBe("win_close_loop");
    expect(brief.close_loop).toBe(true);
    expect(brief.question_policy.max_questions).toBe(0);
    expect(brief.allow_generic_advice).toBe(false);
  });

  it("win without persist → metaphor_only soft VR; vague check-in does not force VR", () => {
    const winBrief = buildInboundReplyBriefV1({
      facts: goldenFacts("I did it today", {
        turn_understanding: phase1Reconciled("I did it today"),
      }),
    });
    expect(winBrief.allowed_claims.victory_room_language_mode).toBe("metaphor_only");
    expect(winBrief.allowed_claims.can_reference_victory_room).toBe(false);

    const system = buildInboundBriefWriterSystemPrompt({ maxChars: 320 });
    expect(system).toMatch(/metaphor_only: soft Victory Room/i);
    expect(system).toMatch(/optional and encouraged/i);
    expect(system).not.toMatch(/do not mention Victory Room when.*metaphor_only/i);

    const vagueBrief = buildInboundReplyBriefV1({
      facts: goldenFacts("Things are going well.", {
        turn_understanding: phase1Reconciled("Things are going well."),
      }),
    });
    expect(vagueBrief.allowed_claims.victory_room_language_mode).not.toBe("recorded_allowed");
    // D: vague positivity is not a win/proof route that requires VR
    expect(vagueBrief.route).not.toBe("win_close_loop");
  });

  it("gratitude list → proof_answer_close_loop, not reflection", () => {
    const text =
      "Our family is healthy. We are provided with everything we need. My wife's family is doing well health wise.";
    const openQ = "Name three things you are grateful for.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        thread: {
          latest_open_question: openQ,
          open_question_pending: true,
          memory_packet: {
            open_question_pending: true,
            latest_open_question: openQ,
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
        turn_understanding: phase1Reconciled(text, {
          openQuestionPending: true,
          latestOpenQuestion: openQ,
        }),
      }),
    });
    expect(brief.route).toBe("proof_answer_close_loop");
    expect(brief.turn_type).toBe("answered_prior_question");
    expect(brief.turn_type).not.toBe("reflection");
  });
});

describe("inbound thread_window writer-facing actual SMS", () => {
  function threadMsg(
    partial: Partial<GoldenThreadMessage> &
      Pick<GoldenThreadMessage, "role" | "body" | "source_table" | "delivery_status"> & {
        delivery_evidence?: string;
        is_fallback_context?: boolean;
      }
  ): GoldenThreadMessage & { delivery_evidence?: string; is_fallback_context?: boolean } {
    return {
      at: "2026-06-15T12:00:00.000Z",
      at_local: "2026-06-15T08:00:00",
      at_local_timezone: "America/Chicago",
      local_day_key: DAY_KEY,
      message_kind: null,
      message_sid: null,
      is_exact_body: true,
      ...partial,
    };
  }

  it("E/F: excludes fallback/preview and preserves lean provenance on thread_window", () => {
    const current = "Current inbound once only.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(current, {
        thread: {
          memory_packet: {
            recent_exact_thread_72h: {
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 5,
              had_preview_messages: true,
              had_system_no_send: false,
              messages: [
                threadMsg({
                  role: "coach",
                  body: "FALLBACK_LAST_OUTBOUND",
                  source_table: "sms_last_outbound_context",
                  delivery_status: "sent",
                  is_fallback_context: true,
                  message_sid: "SM_FALLBACK",
                }),
                threadMsg({
                  at: "2026-06-15T11:00:00.000Z",
                  at_local: "2026-06-15T07:00:00",
                  role: "coach",
                  body: "Real prior coach SMS",
                  source_table: "sms_send_events",
                  delivery_status: "sent",
                  message_sid: "SM_COACH_REAL",
                  delivery_evidence: "message_sid_present",
                }),
                threadMsg({
                  at: "2026-06-15T11:30:00.000Z",
                  at_local: "2026-06-15T07:30:00",
                  role: "coach",
                  body: "CHECK_SENT_PREVIEW",
                  source_table: "v2_events",
                  delivery_status: "preview",
                  is_exact_body: false,
                }),
                threadMsg({
                  at: "2026-06-15T12:05:00.000Z",
                  at_local: "2026-06-15T08:05:00",
                  role: "user",
                  body: current,
                  source_table: "sms_inbound_messages",
                  delivery_status: "sent",
                  message_sid: "SM_USER_NOW",
                  delivery_evidence: "inbound_received",
                }),
              ],
            },
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
      }),
    });

    expect(brief.thread_window.some((m) => /FALLBACK_LAST_OUTBOUND|CHECK_SENT_PREVIEW/i.test(m.body))).toBe(
      false
    );
    expect(brief.thread_window.some((m) => m.source_table === "sms_last_outbound_context")).toBe(false);

    const coach = brief.thread_window.find((m) => m.body.includes("Real prior coach SMS"));
    expect(coach).toMatchObject({
      role: "coach",
      source_table: "sms_send_events",
      delivery_evidence: "message_sid_present",
      message_sid: "SM_COACH_REAL",
      at_local: "2026-06-15T07:00:00",
    });

    const userHits = brief.thread_window.filter((m) => m.role === "user" && m.body === current);
    expect(userHits).toHaveLength(1);
    expect(userHits[0]).toMatchObject({
      source_table: "sms_inbound_messages",
      delivery_evidence: "inbound_received",
      message_sid: "SM_USER_NOW",
    });
  });

  it("G: current inbound message appears exactly once in thread_window", () => {
    const current = "Exactly once inbound body.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(current, {
        thread: {
          memory_packet: {
            recent_exact_thread_72h: {
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 1,
              had_preview_messages: false,
              had_system_no_send: false,
              messages: [
                threadMsg({
                  role: "user",
                  body: current,
                  source_table: "sms_inbound_messages",
                  delivery_status: "sent",
                  message_sid: "SM_ONCE",
                  delivery_evidence: "inbound_received",
                }),
              ],
            },
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
      }),
    });
    expect(brief.thread_window.filter((m) => m.body === current)).toHaveLength(1);
    expect(brief.thread_window.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("H: unsent generated inbound reply_body does not appear in thread_window", () => {
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("User said this.", {
        thread: {
          memory_packet: {
            recent_exact_thread_72h: {
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: 2,
              had_preview_messages: false,
              had_system_no_send: false,
              messages: [
                threadMsg({
                  role: "user",
                  body: "User said this.",
                  source_table: "sms_inbound_messages",
                  delivery_status: "sent",
                  message_sid: "SM_U",
                  delivery_evidence: "inbound_received",
                }),
                threadMsg({
                  role: "coach",
                  body: "UNSENT_GENERATED_REPLY_BODY",
                  source_table: "sms_inbound_coach_jobs",
                  delivery_status: "cancelled",
                  message_sid: null,
                  is_exact_body: true,
                }),
                threadMsg({
                  role: "coach",
                  body: "ANOTHER_UNSENT_REPLY",
                  source_table: "sms_inbound_coach_jobs",
                  delivery_status: "skipped",
                  message_sid: null,
                }),
              ],
            },
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
      }),
    });
    expect(brief.thread_window.some((m) => /UNSENT_GENERATED_REPLY|ANOTHER_UNSENT_REPLY/i.test(m.body))).toBe(
      false
    );
  });

  it("E: thread_window includes more than 6 messages and caps at 20", () => {
    const messages = [];
    for (let i = 0; i < 24; i++) {
      messages.push(
        threadMsg({
          at: `2026-06-15T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
          at_local: `2026-06-15T0${i % 10}:00:00`,
          role: i % 2 === 0 ? "coach" : "user",
          body: `Window line ${i}`,
          source_table: i % 2 === 0 ? "sms_send_events" : "sms_inbound_messages",
          delivery_status: "sent",
          message_sid: `SM_W_${i}`,
          delivery_evidence: i % 2 === 0 ? "message_sid_present" : "inbound_received",
        })
      );
    }
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts("Window line 23", {
        thread: {
          memory_packet: {
            recent_exact_thread_72h: {
              window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
              message_count: messages.length,
              had_preview_messages: false,
              had_system_no_send: false,
              messages,
            },
          } as InboundV3RelationshipFacts["thread"]["memory_packet"],
        },
      }),
    });
    expect(brief.thread_window.length).toBeGreaterThan(6);
    expect(brief.thread_window.length).toBeLessThanOrEqual(20);
    expect(brief.thread_window.at(-1)?.body).toBe("Window line 23");
    expect(brief.thread_window[0]?.body).toBe("Window line 4");
  });
});

function coachingFitReconciled(
  rawInbound: string,
  overrides: Partial<ReconciledTurnUnderstanding> = {}
): ReconciledTurnUnderstanding {
  return enrichReconciledWithInboundRouteContract(
    {
      proposal: null,
      reconciled_relationship_meaning: "coaching_fit_feedback",
      reconciled_response_intent: "repair_coaching_fit",
      reconciled_persistence_decision: "no_outcome_write",
      reconciled_do_not_repeat_asks: ["Did you start the meeting with a clear agenda today?"],
      last_ask_satisfied: "no",
      satisfaction_kind: "not_satisfied",
      stale_ask_risk: true,
      confidence: 0.86,
      disagreement_flags: ["coaching_fit_feedback_repair"],
      interpreter_failed_reason: null,
      stale_ask_avoided: true,
      persistence_note: "test coaching fit",
      reconciled_goal_change_intent: null,
      ...overrides,
    } satisfies ReconciledTurnUnderstanding,
    { rawInbound, classifierEventType: "user_partial" }
  );
}

describe("coaching_fit_repair inbound brief", () => {
  it("C — coaching-fit TU yields repair move before accountability", () => {
    const text = "This isn't helpful for what I'm dealing with.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, { turn_understanding: coachingFitReconciled(text) }),
    });
    expect(brief.turn_type).toBe("coaching_fit_repair");
    expect(brief.reply_strategy.move).toBe("repair_coaching_fit_before_accountability");
    expect(brief.question_policy.max_questions).toBe(1);
    expect(brief.reply_strategy.must_not_do.join(" ")).toMatch(/Repair coaching fit/i);
    expect(brief.reply_strategy.must_not_do.join(" ")).toMatch(/same assignment/i);
  });

  it("B — phrase without relevant still routes via TU not body.includes", () => {
    const text = "You're missing what I actually need.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, { turn_understanding: coachingFitReconciled(text) }),
    });
    expect(brief.turn_type).toBe("coaching_fit_repair");
    expect(text.toLowerCase()).not.toContain("relevant");
  });

  it("F — goal-change request stays goal-change path, not coaching fit repair", () => {
    const text = "I want to change my goal";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        turn_understanding: coachingFitReconciled(text, {
          reconciled_relationship_meaning: "goal_adjustment_request",
          reconciled_response_intent: "clarify_goal_change",
          reconciled_goal_change_intent: {
            authoritative: true,
            detected: true,
            adjustment_type: "replace",
            source: "user_requested",
            requires_confirmation: true,
            proposed_new_goal_text: null,
            evidence_quote: "change my goal",
            confidence: "high",
            goal_change_not_outcome_write: true,
            goal_change_no_state_mutation_without_confirmation: true,
          },
        }),
      }),
    });
    expect(brief.turn_type).not.toBe("coaching_fit_repair");
  });

  it("G — STOP does not become coaching fit repair", () => {
    const text = "STOP";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        inbound_meaning: {
          relationship_meaning: "unknown",
          persistence_decision: "ack_only",
          temporal_scope: "today",
          sms_response_intent: "clarify_gently",
          route_priority: { compliance_or_stop: true },
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });
    expect(brief.turn_type).not.toBe("coaching_fit_repair");
  });

  it("G — timing preference does not become coaching fit repair", () => {
    const text = "Not yet. It's only 7:16 a.m. and I'm at work.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        turn_understanding: coachingFitReconciled(text, {
          reconciled_relationship_meaning: "unclear",
          reconciled_response_intent: "unclear_clarify",
        }),
      }),
    });
    expect(brief.turn_type).toBe("timing_context");
    expect(brief.turn_type).not.toBe("coaching_fit_repair");
  });

  it("H — normal miss does not become coaching fit repair", () => {
    const text = "No, I didn't get to it today.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        inbound_meaning: {
          relationship_meaning: "miss",
          persistence_decision: "write_user_no",
          temporal_scope: "today",
          sms_response_intent: "tell_truth_and_recover",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
        v2_accountability: { miss_signal: true },
      }),
    });
    expect(brief.turn_type).toBe("miss");
    expect(brief.turn_type).not.toBe("coaching_fit_repair");
  });

  it("writer system prompt includes coaching_fit_repair guidance", () => {
    const system = buildInboundBriefWriterSystemPrompt({ maxChars: 320 });
    expect(system).toMatch(/coaching_fit_repair/i);
    expect(system).toMatch(/recalibration question/i);
  });

  it("I — no deterministic relevant phrase routing in brief module", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/inbound-reply-brief-v1.ts"), "utf8");
    expect(src).not.toMatch(/includes\s*\(\s*["']relevant["']\s*\)/);
    expect(src).not.toMatch(/body\.includes\s*\(\s*["']relevant["']\s*\)/);
  });
});

function ambiguousRelatedProgressReconciled(
  rawInbound: string,
  overrides: Partial<ReconciledTurnUnderstanding> = {}
): ReconciledTurnUnderstanding {
  return enrichReconciledWithInboundRouteContract(
    {
      proposal: null,
      reconciled_relationship_meaning: "ambiguous_related_progress",
      reconciled_response_intent: "clarify_completion_or_concretize_action",
      reconciled_persistence_decision: "no_outcome_write",
      reconciled_do_not_repeat_asks: [
        "Did you finish one task moving the art/t-shirt business forward today?",
      ],
      last_ask_satisfied: "unclear",
      satisfaction_kind: "unclear",
      stale_ask_risk: true,
      confidence: 0.84,
      disagreement_flags: ["ambiguous_related_progress_no_outcome"],
      interpreter_failed_reason: null,
      stale_ask_avoided: false,
      persistence_note: "test ambiguous related progress",
      reconciled_goal_change_intent: null,
      ...overrides,
    } satisfies ReconciledTurnUnderstanding,
    { rawInbound, classifierEventType: "user_partial" }
  );
}

describe("ambiguous_related_progress inbound brief", () => {
  it("F — ambiguous related progress yields clarify/concretize, not miss recovery", () => {
    const text = "I've been so busy creating.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        turn_understanding: ambiguousRelatedProgressReconciled(text),
        v2_accountability: { miss_signal: true },
        inbound_meaning: {
          relationship_meaning: "unknown",
          persistence_decision: "no_outcome_write",
          temporal_scope: "today",
          sms_response_intent: "clarify_gently",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
      }),
    });
    expect(brief.turn_type).toBe("ambiguous_related_progress");
    expect(brief.reply_strategy.move).toBe("clarify_completion_or_concretize_action");
    expect(brief.question_policy.max_questions).toBe(1);
    expect(brief.turn_type).not.toBe("miss");
    expect(brief.turn_type).not.toBe("partial");
    expect(brief.reply_strategy.move).not.toBe("ask_one_blocker");
    expect(brief.reply_strategy.must_not_do.join(" ")).toMatch(/possible related progress/i);
    expect(brief.reply_strategy.must_not_do.join(" ")).toMatch(/proof/i);
  });

  it("J — phrase without creating still routes via TU", () => {
    const text = "I spent the afternoon working on ideas for the shirts.";
    expect(text.toLowerCase()).not.toContain("creating");
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        turn_understanding: ambiguousRelatedProgressReconciled(text),
        v2_accountability: { miss_signal: true },
      }),
    });
    expect(brief.turn_type).toBe("ambiguous_related_progress");
  });

  it("J — creating in body with wrong TU meaning does not force ambiguous progress", () => {
    const text = "I've been so busy creating.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        inbound_meaning: {
          relationship_meaning: "miss",
          persistence_decision: "write_user_no",
          temporal_scope: "today",
          sms_response_intent: "tell_truth_and_recover",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
        v2_accountability: { miss_signal: true },
      }),
    });
    expect(brief.turn_type).not.toBe("ambiguous_related_progress");
  });

  it("K — clear miss stays miss", () => {
    const text = "No, I didn't get to it today.";
    const brief = buildInboundReplyBriefV1({
      facts: goldenFacts(text, {
        inbound_meaning: {
          relationship_meaning: "miss",
          persistence_decision: "write_user_no",
          temporal_scope: "today",
          sms_response_intent: "tell_truth_and_recover",
          route_priority: "normal",
          spoken_local_day_key: DAY_KEY,
          reported_for_day_key: DAY_KEY,
          user_timezone: "America/Chicago",
        },
        v2_accountability: { miss_signal: true },
      }),
    });
    expect(brief.turn_type).toBe("miss");
    expect(brief.turn_type).not.toBe("ambiguous_related_progress");
  });

  it("writer system prompt includes ambiguous_related_progress guidance", () => {
    const system = buildInboundBriefWriterSystemPrompt({ maxChars: 320 });
    expect(system).toMatch(/ambiguous_related_progress/i);
    expect(system).toMatch(/concretizing question/i);
  });

  it("no creating phrase router in brief module", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/inbound-reply-brief-v1.ts"), "utf8");
    expect(src).not.toMatch(/includes\s*\(\s*["']creating["']\s*\)/);
    expect(src).not.toMatch(/body\.includes\s*\(\s*["']creating["']\s*\)/);
  });
});
