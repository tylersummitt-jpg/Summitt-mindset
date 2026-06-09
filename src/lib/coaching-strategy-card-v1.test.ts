import { describe, expect, it } from "vitest";

import {
  deriveStrategyCardPlanAckSource,
  buildInboundNormalStrategyCardV1,
  buildStrategyCardContextFromSnapshot,
  buildStrategyCardV1PromptGuidance,
  isInboundNormalStrategyCardEligible,
  resolveShortAnswerPlanAckFromInboundFacts,
  strategyCardV1MetaForTelemetry,
  strategyCardV1UserPromptAppendix,
  validateAndRepairInboundNormalStrategyCardV1,
  type StrategyCardBuildContext,
} from "@/lib/coaching-strategy-card-v1";
import { buildActivePendingStateFromCommitmentRow } from "@/lib/sms-active-pending-state";
import { deriveAdjustmentProposalAllowedByEvidence } from "@/lib/inbound-miss-adjustment-policy";
import type { ProofAndPraisePermissionV2Data } from "@/lib/sms-proof-praise-permission-v2";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";

const PLAN_CONFIRMATION_Q =
  "How does committing to two hours deep work before noon this week feel? Let me know if that works or if you'd like to adjust!";

function baseProof(overrides?: Partial<ProofAndPraisePermissionV2Data>): ProofAndPraisePermissionV2Data {
  return {
    can_praise_effort: true,
    can_praise_consistency: false,
    can_claim_completion: false,
    can_claim_miss: false,
    can_claim_partial: false,
    can_claim_proof: false,
    can_reference_victory_room: false,
    allowed_outbound_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
    },
    forbidden_proof_claims: [],
    evidence: [],
    freshness: {},
    writer_guidance: {
      may_praise_effort_without_proof: true,
      must_not_say_saved_to_victory_room_unless_allowed: true,
      must_not_call_something_proof_unless_allowed: true,
      final_guard_still_validates: true,
    },
    ...overrides,
  };
}

function emptyOpenLoops(): OpenLoopsAndDoNotRepeatData {
  return {
    open_loops: [],
    satisfied_asks: [],
    do_not_repeat_asks: [],
    do_not_repeat_phrases: [],
    recent_unanswered_coach_questions: [],
  };
}

function minimalFacts(overrides?: Partial<InboundV3RelationshipFacts>): InboundV3RelationshipFacts {
  const inboundMeaning = {
    raw_inbound: "no",
    classifier_event_type: "user_no",
    relationship_meaning: "miss",
    response_intent: "acknowledge_miss",
    persistence_decision: "write_user_no",
    do_not_repeat_asks: [],
    stale_ask_risk: false,
    confidence: 0.9,
    persistence_note: "test",
    sms_response_intent: "tell_truth_and_recover",
  };
  return {
    route_purpose: "normal_inbound_reply",
    user: {
      clerk_user_id: "u",
      preferred_name: "Alex",
      timezone: "America/Chicago",
      local_time_iso: "2026-06-08T12:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "c",
      title: "Focus",
      behavior_statement: "Two hours deep work",
      effective_ask: "Two hours deep work",
      accountability_phase: "active_accountability",
    },
    thread: {
      latest_inbound_raw: "no",
      coalesced_inbound_text: "no",
      suppressed_message_sids: [],
      recent_transcript_lines: [],
      latest_outbound_coach_sms: null,
      latest_open_question: null,
      latest_answer_after_open_question: null,
      expected_reply_semantics: "unknown",
      memory_authority: { open_question_source: "none", answer_source: "none", projection_used: false },
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
      deterministic_classifier_event: "user_no",
      gated_mode: "use_deterministic",
      final_event_type: "user_no",
      should_write_outcome_event: true,
      reply_style: "normal_outcome",
      proof_signal: false,
      miss_signal: true,
      blocker_signal: false,
      today_completed: false,
      future_intent_hint: null,
      supplement_commitment_change_guidance: false,
      proof_callout_hint: null,
    },
    legacy_suggestions: {
      conversation_brain: { enabled: false },
      central_brain: { shadow_stored: false },
      arc: {},
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forced_future_stretch_intent_active: false,
      wave11_memory_confirmation_pending: false,
      accountability_proof_hint: null,
    },
    inbound_meaning: inboundMeaning,
    suggested_coaching_move: "name_blocker",
    coaching_move_source: "deterministic",
    miss_adjustment_policy: deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning,
      finalEventType: "user_no",
      routePurpose: "normal_inbound_reply",
    }),
    constraints: {
      max_chars: 320,
      one_sms: true,
      no_generic_motivation: true,
      no_quoted_or_truncated_echo_of_inbound: true,
      if_unsafe_return_no_send: true,
      forbidden_substrings: [],
    },
    ...overrides,
  } as InboundV3RelationshipFacts;
}

function sacaOnlyPlanAckFacts(overrides?: Partial<InboundV3RelationshipFacts>): InboundV3RelationshipFacts {
  const inboundMeaning = {
    raw_inbound: "Sounds good",
    classifier_event_type: "user_yes" as const,
    relationship_meaning: "answer_to_prior_question" as const,
    response_intent: "answer_to_prior_question" as const,
    persistence_decision: "no_outcome_write" as const,
    do_not_repeat_asks: [] as string[],
    stale_ask_risk: false,
    confidence: 0.9,
    persistence_note: "short_answer_no_outcome_proof:short_affirm_plan_confirmation",
    sms_response_intent: "answer_prior_question" as const,
    temporal_scope: "today" as const,
    evidence: ["short_answer_plan_confirmation", "short_affirm_plan_confirmation"],
    disqualifiers: [] as string[],
    spoken_local_day_key: "2026-06-08",
    reported_for_day_key: null,
    user_timezone: "America/Chicago",
  };
  return minimalFacts({
    turn_understanding: undefined,
    suggested_coaching_move: "respond_to_open_question_answer_natural",
    coaching_move_source: "deterministic",
    v2_accountability: {
      ...minimalFacts().v2_accountability,
      final_event_type: null,
      deterministic_classifier_event: "user_yes",
      today_completed: false,
      miss_signal: false,
    },
    inbound_meaning: inboundMeaning,
    miss_adjustment_policy: {
      adjustment_proposal_allowed_by_evidence: true,
      single_miss_recovery_required: false,
      adjustment_evidence_reason: "none",
    },
    thread: {
      ...minimalFacts().thread,
      coalesced_inbound_text: "Sounds good",
      latest_inbound_raw: "Sounds good",
      latest_outbound_coach_sms: PLAN_CONFIRMATION_Q,
      latest_open_question: PLAN_CONFIRMATION_Q,
      expected_reply_semantics: "proposal_yes_no",
      current_inbound_is_short_acknowledgement: true,
      memory_packet: {
        recent_exact_thread_text: `Coach: ${PLAN_CONFIRMATION_Q}\nUser: Sounds good`,
        recent_exact_thread_72h: {
          messages: [],
          window_hours: 72,
          message_count: 2,
          had_preview_messages: false,
          had_system_no_send: false,
        },
        relationship_memory_7d: emptyMemory7d(),
        relationship_memory_30d: emptyMemory30d(),
        recent_exact_message_count: 2,
        last_outbound_full_body: PLAN_CONFIRMATION_Q,
        last_inbound_full_body: "Sounds good",
        last_substantive_coach_message: PLAN_CONFIRMATION_Q,
        last_substantive_user_message: null,
        last_5_coach_questions: [PLAN_CONFIRMATION_Q],
        last_5_user_answers: [],
        latest_open_question: PLAN_CONFIRMATION_Q,
        latest_answer_after_open_question: null,
        open_question_pending: true,
        open_question_source: "projection" as const,
        answer_source: "none" as const,
        projection_used: false,
        latest_open_question_guess: null,
        latest_answer_after_open_question_guess: null,
        do_not_repeat_phrases: [],
        memory_priority_rules: [],
      },
    },
    ...overrides,
  });
}

function emptyMemory7d() {
  return {
    window_days: 7,
    built_at: "2026-06-08T12:00:00.000Z",
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
  };
}

function emptyMemory30d() {
  return {
    window_days: 30,
    built_at: "2026-06-08T12:00:00.000Z",
    commitment_id: "c",
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
  };
}

function buildCtx(facts: InboundV3RelationshipFacts, extra?: Partial<StrategyCardBuildContext>): StrategyCardBuildContext {
  return {
    facts,
    proofPermission: baseProof(),
    openLoops: emptyOpenLoops(),
    activePending: buildActivePendingStateFromCommitmentRow(null),
    noSendSilence: null,
    ...extra,
  };
}

describe("coaching-strategy-card-v1", () => {
  it("single miss forbids propose_adjustment / evaluate_commitment / raise_standard", () => {
    const facts = minimalFacts({
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: false,
        single_miss_recovery_required: true,
        adjustment_evidence_reason: "single_miss",
      },
      suggested_coaching_move: "propose_adjustment",
    });
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(facts) });
    expect(card.move.type).not.toBe("propose_adjustment");
    expect(card.move.type).not.toBe("evaluate_commitment");
    expect(card.move.type).not.toBe("raise_standard");
    expect(card.must_not_do.some((m) => /commitment/i.test(m))).toBe(true);
  });

  it("single miss produces ask_blocker or recover_today", () => {
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(minimalFacts()) });
    expect(["ask_blocker", "recover_today"]).toContain(card.move.type);
  });

  it("completion produces ack_completion with completion claim when permitted", () => {
    const facts = minimalFacts({
      v2_accountability: {
        ...minimalFacts().v2_accountability,
        final_event_type: "user_yes",
        deterministic_classifier_event: "user_yes",
        miss_signal: false,
        today_completed: true,
      },
      inbound_meaning: {
        ...minimalFacts().inbound_meaning,
        relationship_meaning: "reported_completion",
        persistence_decision: "write_user_yes_today",
        sms_response_intent: "acknowledge_completion_and_next_step",
      },
      suggested_coaching_move: "acknowledge_completion",
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: true,
        single_miss_recovery_required: false,
        adjustment_evidence_reason: "none",
      },
    });
    const ctx = buildCtx(facts, {
      proofPermission: baseProof({
        can_claim_completion: true,
        allowed_outbound_claims: { completion: true, miss: false, partial: false, proof: false, victory_room: false },
      }),
    });
    const card = buildInboundNormalStrategyCardV1({ ctx });
    expect(card.move.type).toBe("ack_completion");
    expect(card.allowed_claims.completion).toBe(true);
  });

  it("partial produces ack_partial or recover with partial claim when permitted", () => {
    const facts = minimalFacts({
      v2_accountability: {
        ...minimalFacts().v2_accountability,
        final_event_type: "user_partial",
        deterministic_classifier_event: "user_partial",
      },
      inbound_meaning: {
        ...minimalFacts().inbound_meaning,
        relationship_meaning: "partial_attempt",
        persistence_decision: "write_user_partial",
        sms_response_intent: "identify_blocker_or_next_move",
      },
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: true,
        single_miss_recovery_required: false,
        adjustment_evidence_reason: "none",
      },
    });
    const ctx = buildCtx(facts, {
      proofPermission: baseProof({
        can_claim_partial: true,
        allowed_outbound_claims: { completion: false, miss: false, partial: true, proof: false, victory_room: false },
      }),
    });
    const card = buildInboundNormalStrategyCardV1({ ctx });
    expect(["ack_partial", "recover_today"]).toContain(card.move.type);
    expect(card.allowed_claims.partial).toBe(true);
  });

  it("plan ack produces protect_existing_plan or close_loop without outcome claims", () => {
    const facts = minimalFacts({
      thread: {
        ...minimalFacts().thread,
        coalesced_inbound_text: "yes sounds good",
        current_inbound_is_short_acknowledgement: true,
      },
      turn_understanding: {
        reconciled_relationship_meaning: "direct_answer",
        reconciled_response_intent: "reinforce_plan_without_proof",
        reconciled_persistence_decision: "no_outcome_write",
        reconciled_do_not_repeat_asks: [],
        last_ask_satisfied: "no",
        satisfaction_kind: null,
        stale_ask_risk: false,
        confidence: 0.85,
        disagreement_flags: [],
        interpreter_failed_reason: null,
        stale_ask_avoided: false,
        persistence_note: "plan ack",
        proposal: null,
      },
    });
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildCtx(facts, { shortAnswerPlanAck: true }),
    });
    expect(["protect_existing_plan", "close_loop"]).toContain(card.move.type);
    expect(card.allowed_claims.completion).toBe(false);
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.must_not_do.some((m) => /proof|completion|miss/i.test(m))).toBe(true);
  });

  it("blocker already known prevents asking blocker again", () => {
    const facts = minimalFacts({
      thread: {
        ...minimalFacts().thread,
        coalesced_inbound_text: "no because meetings ran long all morning",
      },
      v2_accountability: {
        ...minimalFacts().v2_accountability,
        blocker_signal: true,
      },
    });
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(facts) });
    expect(card.move.type).toBe("recover_today");
    expect(card.must_not_do.some((m) => /what got in the way/i.test(m))).toBe(true);
  });

  it("proof permission false keeps proof/victory false", () => {
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildCtx(
        minimalFacts({
          v2_accountability: {
            ...minimalFacts().v2_accountability,
            final_event_type: "user_yes",
            today_completed: true,
          },
        }),
        { proofPermission: baseProof() }
      ),
    });
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.allowed_claims.victory_room).toBe(false);
  });

  it("proof permission true allows proof when can_claim_proof", () => {
    const ctx = buildCtx(minimalFacts(), {
      proofPermission: baseProof({
        can_claim_proof: true,
        can_reference_victory_room: true,
        allowed_outbound_claims: { completion: false, miss: false, partial: false, proof: true, victory_room: true },
      }),
    });
    const card = buildInboundNormalStrategyCardV1({ ctx });
    expect(card.allowed_claims.proof).toBe(true);
    expect(card.allowed_claims.victory_room).toBe(true);
  });

  it("active pending adds must_not_do resolved/applied", () => {
    const row = {
      id: "c",
      clerk_user_id: "u",
      status: "active",
      behavior_statement: "B",
      title: "T",
      success_criteria: null,
      blocker_capture_expires_at: null,
      blocker_capture_after_event: null,
      adaptive_ask_text: null,
      adaptive_ask_active_from: null,
      adaptive_ask_expires_at: null,
      adaptive_proposal_text: "Try a smaller rep?",
      adaptive_proposal_created_at: "2026-06-01T00:00:00.000Z",
      adaptive_proposal_expires_at: "2026-06-15T00:00:00.000Z",
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
    const pending = buildActivePendingStateFromCommitmentRow(row);
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(minimalFacts(), { activePending: pending }) });
    expect(card.server_truth_summary.active_pending_kinds.length).toBeGreaterThan(0);
    expect(card.must_not_do.some((m) => /pending|resolved|applied/i.test(m))).toBe(true);
  });

  it("satisfied ask appears in avoid_repeating", () => {
    const ask = "Did you put the family connection on the calendar?";
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildCtx(minimalFacts(), {
        openLoops: {
          ...emptyOpenLoops(),
          satisfied_asks: [{ ask_text: ask, do_not_repeat: true, source: "turn_understanding" }],
        },
      }),
    });
    expect(card.writer_constraints.avoid_repeating.some((a) => a.includes("calendar"))).toBe(true);
  });

  it("silence context sets gentle_reentry or low_pressure", () => {
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildCtx(minimalFacts(), {
        noSendSilence: {
          last_visible_coach_sms_at: null,
          last_user_reply_at: null,
          last_user_outcome_at: null,
          silence_context: {
            writer_tone_hint: "gentle re-entry; do not imply user ignored an undelivered message",
            silence_tier: "nudge",
          },
          delivery_truth: {
            recent_questions_not_delivered: [],
            recent_questions_delivered_but_unanswered: [],
          },
          writer_guidance: {
            do_not_explain_internal_message_failure: true,
            do_not_discuss_internal_send_pipeline: true,
            use_only_for_tone_and_continuity: true,
            may_naturally_reask_if_prior_question_not_delivered: true,
          },
        },
      }),
    });
    expect(["gentle_reentry", "low_pressure"]).toContain(card.writer_constraints.tone_posture);
  });

  it("legacy allowed move is used when compatible", () => {
    const facts = minimalFacts({
      suggested_coaching_move: "acknowledge_completion",
      v2_accountability: {
        ...minimalFacts().v2_accountability,
        final_event_type: "user_yes",
        deterministic_classifier_event: "user_yes",
        today_completed: true,
      },
      inbound_meaning: {
        ...minimalFacts().inbound_meaning,
        relationship_meaning: "reported_completion",
        persistence_decision: "write_user_yes_today",
      },
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: true,
        single_miss_recovery_required: false,
        adjustment_evidence_reason: "none",
      },
    });
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(facts) });
    expect(card.move.type).toBe("ack_completion");
    expect(card.meta.legacy_hint_used).toBe(true);
    expect(card.meta.legacy_hint_replaced).not.toBe(true);
  });

  it("legacy forbidden move is replaced", () => {
    const facts = minimalFacts({
      suggested_coaching_move: "propose_adjustment",
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: false,
        single_miss_recovery_required: true,
        adjustment_evidence_reason: "single_miss",
      },
    });
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(facts) });
    expect(card.meta.legacy_hint_replaced).toBe(true);
    expect(card.move.type).not.toBe("propose_adjustment");
  });

  it("validator repairs invalid card", () => {
    const ctx = buildCtx(
      minimalFacts({
        miss_adjustment_policy: {
          adjustment_proposal_allowed_by_evidence: false,
          single_miss_recovery_required: true,
          adjustment_evidence_reason: "single_miss",
        },
      })
    );
    const bad = buildInboundNormalStrategyCardV1({ ctx });
    bad.move.type = "propose_adjustment";
    const result = validateAndRepairInboundNormalStrategyCardV1(bad, ctx);
    expect(result.validation_status).toBe("repaired");
    expect(result.card.move.type).not.toBe("propose_adjustment");
  });

  it("no SMS copy allowed in card fields", () => {
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(minimalFacts()) });
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(card)).not.toMatch(/Nice — what made/i);
  });

  it("isInboundNormalStrategyCardEligible excludes transactional routes", () => {
    expect(isInboundNormalStrategyCardEligible(minimalFacts())).toBe(true);
    expect(isInboundNormalStrategyCardEligible(minimalFacts({ route_purpose: "blocker_capture_ack" }))).toBe(false);
    expect(isInboundNormalStrategyCardEligible(minimalFacts({ route_purpose: "refresh" }))).toBe(false);
  });

  it("prompt guidance mentions Strategy Card authority", () => {
    const g = buildStrategyCardV1PromptGuidance();
    expect(g).toMatch(/primary coaching move/i);
    expect(g).toMatch(/final guard still validates/i);
    expect(g).toMatch(/RELATIONSHIP_SNAPSHOT_V2/i);
  });

  it("user appendix includes strategy_card_v1 JSON", () => {
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(minimalFacts()) });
    const appendix = strategyCardV1UserPromptAppendix(card);
    expect(appendix).toContain("STRATEGY_CARD_V1");
    expect(appendix).toContain('"version":"1.0"');
  });
});

describe("buildStrategyCardContextFromSnapshot", () => {
  it("maps snapshot sections into build context", () => {
    const facts = minimalFacts();
    const ctx = buildStrategyCardContextFromSnapshot({
      facts,
      snapshot: {
        proof_and_praise_permission: { data: baseProof() },
        open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
        active_pending_state: buildActivePendingStateFromCommitmentRow(null),
        no_send_and_silence_history: null,
      },
    });
    expect(ctx.proofPermission.can_claim_proof).toBe(false);
    expect(ctx.facts.route_purpose).toBe("normal_inbound_reply");
  });

  it("derives shortAnswerPlanAck from SACA plan confirmation without explicit flag", () => {
    const facts = sacaOnlyPlanAckFacts();
    expect(resolveShortAnswerPlanAckFromInboundFacts(facts)).toBe(true);
    const ctx = buildStrategyCardContextFromSnapshot({
      facts,
      snapshot: {
        proof_and_praise_permission: { data: baseProof() },
        open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
        active_pending_state: buildActivePendingStateFromCommitmentRow(null),
        no_send_and_silence_history: null,
      },
    });
    expect(ctx.shortAnswerPlanAck).toBe(true);
  });
});

describe("SACA plan ack Strategy Card (no TU)", () => {
  it("SACA-only plan ack produces protect_existing_plan or close_loop", () => {
    const facts = sacaOnlyPlanAckFacts();
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildStrategyCardContextFromSnapshot({
        facts,
        snapshot: {
          proof_and_praise_permission: { data: baseProof() },
          open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
          active_pending_state: buildActivePendingStateFromCommitmentRow(null),
          no_send_and_silence_history: null,
        },
      }),
    });
    expect(["protect_existing_plan", "close_loop"]).toContain(card.move.type);
  });

  it("SACA-only plan ack does not produce ask_blocker or ack_completion", () => {
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildStrategyCardContextFromSnapshot({
        facts: sacaOnlyPlanAckFacts(),
        snapshot: {
          proof_and_praise_permission: { data: baseProof() },
          open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
          active_pending_state: buildActivePendingStateFromCommitmentRow(null),
          no_send_and_silence_history: null,
        },
      }),
    });
    expect(card.move.type).not.toBe("ask_blocker");
    expect(card.move.type).not.toBe("ack_completion");
  });

  it("SACA-only plan ack forbids outcome and proof claims", () => {
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildStrategyCardContextFromSnapshot({
        facts: sacaOnlyPlanAckFacts(),
        snapshot: {
          proof_and_praise_permission: { data: baseProof({ can_claim_proof: true, can_claim_completion: true }) },
          open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
          active_pending_state: buildActivePendingStateFromCommitmentRow(null),
          no_send_and_silence_history: null,
        },
      }),
    });
    expect(card.allowed_claims.completion).toBe(false);
    expect(card.allowed_claims.miss).toBe(false);
    expect(card.allowed_claims.partial).toBe(false);
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.must_not_do.some((m) => /plan acknowledgment|completion|blocker|proof/i.test(m))).toBe(true);
  });

  it("Good on plan confirmation resolves via SACA", () => {
    const facts = sacaOnlyPlanAckFacts({
      thread: {
        ...sacaOnlyPlanAckFacts().thread,
        coalesced_inbound_text: "Good",
        latest_inbound_raw: "Good",
      },
      inbound_meaning: {
        ...sacaOnlyPlanAckFacts().inbound_meaning,
        raw_inbound: "Good",
      },
    });
    expect(resolveShortAnswerPlanAckFromInboundFacts(facts)).toBe(true);
  });

  it("TU plan ack still works when present", () => {
    const facts = minimalFacts({
      turn_understanding: {
        reconciled_relationship_meaning: "direct_answer",
        reconciled_response_intent: "reinforce_plan_without_proof",
        reconciled_persistence_decision: "no_outcome_write",
        reconciled_do_not_repeat_asks: [],
        last_ask_satisfied: "no",
        satisfaction_kind: null,
        stale_ask_risk: false,
        confidence: 0.85,
        disagreement_flags: [],
        interpreter_failed_reason: null,
        stale_ask_avoided: false,
        persistence_note: "plan ack",
        proposal: null,
      },
    });
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(facts) });
    expect(["protect_existing_plan", "close_loop"]).toContain(card.move.type);
  });

  it("non-plan outcome yes still produces ack_completion when server truth supports", () => {
    const facts = minimalFacts({
      v2_accountability: {
        ...minimalFacts().v2_accountability,
        final_event_type: "user_yes",
        deterministic_classifier_event: "user_yes",
        today_completed: true,
      },
      inbound_meaning: {
        ...minimalFacts().inbound_meaning,
        relationship_meaning: "reported_completion",
        persistence_decision: "write_user_yes_today",
        sms_response_intent: "acknowledge_completion_and_next_step",
      },
      miss_adjustment_policy: {
        adjustment_proposal_allowed_by_evidence: true,
        single_miss_recovery_required: false,
        adjustment_evidence_reason: "none",
      },
    });
    const card = buildInboundNormalStrategyCardV1({
      ctx: buildCtx(facts, {
        proofPermission: baseProof({
          can_claim_completion: true,
          allowed_outbound_claims: { completion: true, miss: false, partial: false, proof: false, victory_room: false },
        }),
      }),
    });
    expect(card.move.type).toBe("ack_completion");
    expect(card.allowed_claims.completion).toBe(true);
  });
});

describe("strategy card telemetry", () => {
  it("includes compact SQL-safe keys without SMS body or user text", () => {
    const card = buildInboundNormalStrategyCardV1({ ctx: buildCtx(minimalFacts()) });
    const meta = strategyCardV1MetaForTelemetry({
      card,
      validation_status: "valid",
      validation_reasons: [],
    });
    expect(meta.strategy_card_version).toBe("1.0");
    expect(meta.strategy_card_can_claim_proof).toBe(false);
    expect(meta.strategy_card_can_reference_victory_room).toBe(false);
    const json = JSON.stringify(meta);
    expect(json).not.toMatch(/Sounds good|Nice — what made/i);
    expect(json.length).toBeLessThan(2000);
  });

  it("deriveStrategyCardPlanAckSource returns saca for SACA plan ack", () => {
    const facts = sacaOnlyPlanAckFacts();
    const ctx = buildStrategyCardContextFromSnapshot({
      facts,
      snapshot: {
        proof_and_praise_permission: { data: baseProof() },
        open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
        active_pending_state: buildActivePendingStateFromCommitmentRow(null),
        no_send_and_silence_history: null,
      },
    });
    expect(deriveStrategyCardPlanAckSource(ctx)).toBe("saca");
    const meta = strategyCardV1MetaForTelemetry(
      { card: buildInboundNormalStrategyCardV1({ ctx }), validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_plan_ack_source).toBe("saca");
  });
});
