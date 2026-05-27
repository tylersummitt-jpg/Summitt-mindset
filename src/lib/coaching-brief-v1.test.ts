import { describe, expect, it } from "vitest";

import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import {
  buildCoachingBriefV1FromDailyFacts,
  buildCoachingBriefV1FromInboundFacts,
  compactCoachingBriefV1ForV3Brain,
} from "@/lib/coaching-brief-v1";

function minimalDailyFacts(
  overrides?: Partial<DailyV3RelationshipFacts>
): DailyV3RelationshipFacts {
  return {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-05-12",
    user: {
      clerk_user_id: "user_1",
      preferred_name: null,
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T09:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_1",
      title: "Focus",
      behavior_statement: "Deep work before noon",
      effective_ask: "Deep work before noon",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: null,
      latest_inbound_sms: null,
      recent_transcript_or_context_block: null,
      latest_open_question: null,
      do_not_repeat_hints: [],
      coaching_memory_snippet: "",
      recent_pattern_hints: null,
      open_question_pending: false,
      projection_used: true,
      recent_exact_thread_text: "Coach: How did it go?\nUser: After Brooke's workout",
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: "user_no",
      yes_streak_14d: 0,
      no_count_14d: 1,
      partial_count_14d: 0,
      blocker_preview: null,
      proof_or_milestone_signal: null,
      silence_tier: "none",
      unanswered_checks: 0,
      days_since_last_user_outcome: 1,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    suggested_coaching_move: "ask_completion",
    constraints: {
      max_chars: 300,
      one_sms: true,
      no_raw_title_or_behavior_paste: true,
      no_generic_motivation: true,
      if_unsafe_return_no_send: true,
    },
    ...overrides,
  };
}

function minimalInboundFacts(
  overrides?: Partial<InboundV3RelationshipFacts>
): InboundV3RelationshipFacts {
  return {
    route_purpose: "normal_inbound_reply",
    user: {
      clerk_user_id: "user_1",
      preferred_name: null,
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T09:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_1",
      title: "Focus",
      behavior_statement: "Deep work before noon",
      effective_ask: "Deep work before noon",
      accountability_phase: "active_accountability",
    },
    thread: {
      latest_inbound_raw: "Yes I did it",
      coalesced_inbound_text: "Yes I did it",
      suppressed_message_sids: [],
      recent_transcript_lines: ["Coach: Did you protect the block?", "User: Yes I did it"],
      latest_outbound_coach_sms: null,
      latest_open_question: null,
      latest_answer_after_open_question: null,
      expected_reply_semantics: null,
      memory_authority: {
        open_question_source: "projection",
        answer_source: "projection",
        projection_used: true,
      },
      do_not_repeat_hints: [],
      rejected_time_candidates: [],
      unavailable_windows: [],
      current_inbound_is_already_told_you_correction: false,
      current_inbound_is_short_acknowledgement: false,
      most_recent_substantive_prior_user_message: null,
      most_recent_coach_question: null,
      memory_correction_should_use_prior_user_answer: false,
      short_ack_should_not_reask_question: false,
    },
    v2_accountability: {
      deterministic_classifier_event: "user_yes",
      gated_mode: "score",
      final_event_type: "user_yes",
      should_write_outcome_event: true,
      reply_style: null,
      proof_signal: true,
      miss_signal: false,
      blocker_signal: false,
      today_completed: true,
      future_intent_hint: null,
      supplement_commitment_change_guidance: false,
    },
    legacy_suggestions: {
      conversation_brain: null,
      central_brain: null,
      arc: null,
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forced_future_stretch_intent_active: false,
      wave11_memory_confirmation_pending: false,
      accountability_proof_hint: null,
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

describe("buildCoachingBriefV1FromDailyFacts", () => {
  it("returns close_plan_loop reply target when pending_plan_proof is active", () => {
    const brief = buildCoachingBriefV1FromDailyFacts(
      minimalDailyFacts({
        suggested_coaching_move: "close_prior_plan_loop",
        accountability: {
          ...minimalDailyFacts().accountability,
          pending_plan_proof: {
            active: true,
            plan_summary_hint: "after workout",
            anchor_phrase_hint: "after Brooke's workout",
            anchor_key: "brooke|workout",
            plan_for_day_key: "2026-05-11",
            source_answer_preview: "I'll do it after Brooke's workout",
            recurrence_confidence: "unknown",
            outcome_known: false,
          },
        },
      })
    );
    expect(brief.reply_target).toBe("close_plan_loop");
    expect(brief.memory_state.pending_plan_proof_active).toBe(true);
  });

  it("sets tactical_advice_allowed false when pending_plan_proof is active", () => {
    const brief = buildCoachingBriefV1FromDailyFacts(
      minimalDailyFacts({
        accountability: {
          ...minimalDailyFacts().accountability,
          pending_plan_proof: {
            active: true,
            plan_summary_hint: "plan",
            anchor_phrase_hint: null,
            anchor_key: null,
            plan_for_day_key: "2026-05-11",
            source_answer_preview: "plan text",
            recurrence_confidence: "unknown",
            outcome_known: false,
          },
        },
      })
    );
    expect(brief.tactical_advice_allowed).toBe(false);
    expect(brief.guardrail_context).toContain("no_tactical_advice");
  });

  it("includes timing anchor confidence when timing_anchor_memory exists", () => {
    const brief = buildCoachingBriefV1FromDailyFacts(
      minimalDailyFacts({
        accountability: {
          ...minimalDailyFacts().accountability,
          timing_anchor_memory: {
            active: true,
            anchor_phrase_hint: "after Brooke's workout",
            anchor_key: "brooke|workout",
            recurrence_confidence: "low",
            confidence_level: "mentioned_once",
            mention_count_45d: 1,
            user_confirmed: false,
            outcome_success_after_mention_count: 0,
            first_seen_day_key: "2026-05-10",
            last_seen_day_key: "2026-05-11",
            source: "recent_user_plan",
            safe_usage_allowed: [],
            safe_usage_forbidden: [],
          },
        },
      })
    );
    expect(brief.memory_state.timing_anchor_active).toBe(true);
    expect(brief.memory_state.timing_anchor_confidence).toBe("mentioned_once");
    expect(brief.guardrail_context).toContain("timing_anchor_low_confidence");
  });

  it("defaults pat_candidates to empty and explicit_pat_content_allowed false", () => {
    const brief = buildCoachingBriefV1FromDailyFacts(minimalDailyFacts());
    expect(brief.pat_candidates).toEqual([]);
    expect(brief.explicit_pat_content_allowed).toBe(false);
    expect(brief.message_weight).toBe("standard");
    expect(brief.surface).toBe("daily_sms");
  });

  it("includes plan-proof must_not_say phrases when pending_plan_proof active", () => {
    const brief = buildCoachingBriefV1FromDailyFacts(
      minimalDailyFacts({
        accountability: {
          ...minimalDailyFacts().accountability,
          pending_plan_proof: {
            active: true,
            plan_summary_hint: "x",
            anchor_phrase_hint: null,
            anchor_key: null,
            plan_for_day_key: "2026-05-11",
            source_answer_preview: "x",
            recurrence_confidence: "unknown",
            outcome_known: false,
          },
        },
      })
    );
    expect(brief.must_not_say).toContain("you followed through");
  });
});

describe("buildCoachingBriefV1FromInboundFacts", () => {
  it("returns surface inbound_sms", () => {
    const brief = buildCoachingBriefV1FromInboundFacts(minimalInboundFacts());
    expect(brief.surface).toBe("inbound_sms");
    expect(brief.pat_candidates).toEqual([]);
    expect(brief.explicit_pat_content_allowed).toBe(false);
  });

  it("includes pending replacement and memory correction flags when available", () => {
    const brief = buildCoachingBriefV1FromInboundFacts(
      minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_correction_should_use_prior_user_answer: true,
        },
        pending_replacement_facts: {
          pending_resolution_active: true,
          pending_resolution_applied: false,
          pending_resolution_sms_state: "awaiting_confirmation",
          pending_candidate_behavior_statement: "Walk 10k steps",
          canonical_behavior_statement: "Old bar",
          pending_resolution_kind: "commitment_replace",
        },
      })
    );
    expect(brief.memory_state.pending_goal_replacement_active).toBe(true);
    expect(brief.memory_state.memory_correction_active).toBe(true);
    expect(brief.guardrail_context).toContain("pending_goal_replacement");
    expect(brief.guardrail_context).toContain("memory_correction_active");
  });

  it("maps acknowledge reply_target for user_yes", () => {
    const brief = buildCoachingBriefV1FromInboundFacts(minimalInboundFacts());
    expect(brief.reply_target).toBe("acknowledge");
    expect(brief.memory_state.inbound_event_type).toBe("user_yes");
  });
});

describe("compactCoachingBriefV1ForV3Brain", () => {
  it("does not include full thread text", () => {
    const longThread = "Coach: ".repeat(500) + "User: done";
    const brief = buildCoachingBriefV1FromDailyFacts(
      minimalDailyFacts({
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          recent_exact_thread_text: longThread,
        },
      })
    );
    const log = compactCoachingBriefV1ForV3Brain(brief);
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain(longThread);
    expect(serialized).not.toContain("recent_exact_thread");
    expect(log.pat_candidates_offered).toEqual([]);
  });
});
