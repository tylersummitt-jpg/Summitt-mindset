import { describe, expect, it } from "vitest";

import {
  ARC_CLARIFICATION_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO,
  ARC_TENTATIVE_OUTCOME_NOT_CONFIRMED_MUST_NOT_DO,
  arcClarifyLegacyPreviewFingerprint,
  buildArcClarifyStrategyCardV1,
  buildCentralPivotStrategyCardV1,
  deriveStrategyCardPlanAckSource,
  buildInboundNormalStrategyCardV1,
  buildOpenQuestionAnswerStrategyCardV1,
  buildStrategyCardContextFromSnapshot,
  buildStrategyCardV1PromptGuidance,
  CENTRAL_PIVOT_NO_OUTCOME_SCORING_MUST_NOT_DO,
  centralPivotTetherPreviewFingerprint,
  isArcClarifyStrategyCardEligible,
  isCentralPivotStrategyCardEligible,
  isInboundNormalStrategyCardEligible,
  isOpenQuestionAnswerStrategyCardEligible,
  isOpenQuestionSatisfied,
  OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO,
  openQuestionOldCoachPreviewFingerprint,
  resolveShortAnswerPlanAckFromInboundFacts,
  strategyCardV1MetaForTelemetry,
  strategyCardV1UserPromptAppendix,
  validateAndRepairInboundNormalStrategyCardV1,
  validateAndRepairStrategyCardV1,
  type StrategyCardBuildContext,
  buildDailyC1StrategyCardContextFromSnapshot,
  buildDailyC1StrategyCardV1,
  buildDailyC2StrategyCardContextFromSnapshot,
  buildDailyC2StrategyCardV1,
  isDailyC1StrategyCardEligible,
  isDailyC2StrategyCardEligible,
  isDailyStrategyCardEligible,
  validateAndRepairDailyC1StrategyCardV1,
  validateAndRepairDailyContractPromptStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { buildActivePendingStateFromCommitmentRow } from "@/lib/sms-active-pending-state";
import { deriveAdjustmentProposalAllowedByEvidence } from "@/lib/inbound-miss-adjustment-policy";
import type { ProofAndPraisePermissionV2Data } from "@/lib/sms-proof-praise-permission-v2";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";

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

const OPEN_QUESTION =
  "Still on for a strength session after Brooke's workout?";

function openQuestionFactsFixture() {
  return {
    latest_open_question: OPEN_QUESTION,
    expected_reply_semantics: "open_reflection",
    resolution_subkind: "open_reflection",
    extracted_answer: "After Brooke's workout",
    answer_kind: "open_reflection",
    old_open_question_reply_preview: "LEGACY_PREVIEW",
    deterministic_fallback_used: false,
    deterministic_fallback_reason: null,
    legacy_open_question_reply_source: "deterministic_fallback" as const,
    latest_outbound_preview: OPEN_QUESTION,
  };
}

function openQuestionInboundMeaning() {
  return {
    raw_inbound: "After Brooke's workout",
    classifier_event_type: "user_yes" as const,
    relationship_meaning: "answer_to_prior_question" as const,
    response_intent: "answer_to_prior_question" as const,
    persistence_decision: "no_outcome_write" as const,
    do_not_repeat_asks: [] as string[],
    stale_ask_risk: false,
    confidence: 0.9,
    persistence_note: "open_question_answer",
    sms_response_intent: "answer_prior_question" as const,
  };
}

function oqMinimalFacts(overrides?: Partial<InboundV3RelationshipFacts>): InboundV3RelationshipFacts {
  return minimalFacts({
    route_purpose: "open_question_answer",
    open_question_facts: openQuestionFactsFixture(),
    suggested_coaching_move: "respond_to_open_question_answer_natural",
    coaching_move_source: "open_question",
    inbound_meaning: openQuestionInboundMeaning(),
    v2_accountability: {
      ...minimalFacts().v2_accountability,
      final_event_type: null,
      deterministic_classifier_event: "user_yes",
      should_write_outcome_event: false,
      today_completed: false,
      miss_signal: false,
    },
    miss_adjustment_policy: {
      adjustment_proposal_allowed_by_evidence: true,
      single_miss_recovery_required: false,
      adjustment_evidence_reason: "not_a_miss_turn",
    },
    thread: {
      ...minimalFacts().thread,
      coalesced_inbound_text: "After Brooke's workout",
      latest_inbound_raw: "After Brooke's workout",
      latest_open_question: OPEN_QUESTION,
      latest_answer_after_open_question: "After Brooke's workout",
      expected_reply_semantics: "open_reflection",
    },
    ...overrides,
  });
}

describe("Phase 4.3 open_question_answer Strategy Card", () => {
  it("eligibility requires open_question_answer route and open_question_facts", () => {
    expect(isOpenQuestionAnswerStrategyCardEligible(oqMinimalFacts())).toBe(true);
    expect(isOpenQuestionAnswerStrategyCardEligible(minimalFacts())).toBe(false);
    expect(
      isOpenQuestionAnswerStrategyCardEligible(
        oqMinimalFacts({ route_purpose: "blocker_capture_ack" })
      )
    ).toBe(false);
    expect(
      isOpenQuestionAnswerStrategyCardEligible(
        oqMinimalFacts({
          blocker_facts: {
            blocker_text: "traffic",
            blocker_category: null,
            following_event_type: "user_no",
            repeated_blocker_signal: false,
            blocker_pending_age_minutes_remaining: 30,
            suggested_next_move: "acknowledge_blocker_capture",
            legacy_blocker_ack_preview: "",
          },
        })
      )
    ).toBe(false);
    expect(isInboundNormalStrategyCardEligible(oqMinimalFacts())).toBe(false);
  });

  it("clear open-question answer produces close_loop", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx: buildCtx(oqMinimalFacts()) });
    expect(card.route_kind).toBe("open_question_answer");
    expect(card.move.type).toBe("close_loop");
    expect(card.must_not_do.some((m) => /re-ask the same open question/i.test(m))).toBe(true);
    expect(card.allowed_claims.completion).toBe(false);
    expect(card.allowed_claims.proof).toBe(false);
  });

  it("unclear answer produces clarify with max_questions=1", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({
      ctx: buildCtx(
        oqMinimalFacts({
          open_question_facts: {
            ...openQuestionFactsFixture(),
            extracted_answer: null,
            answer_kind: "ambiguous",
          },
        })
      ),
    });
    expect(card.move.type).toBe("clarify");
    expect(card.writer_constraints.max_questions).toBe(1);
    expect(card.must_do.some((m) => /one natural clarification/i.test(m))).toBe(true);
  });

  it("plan ack on open question protects plan without outcome claims", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({
      ctx: buildCtx(
        oqMinimalFacts({
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
        })
      ),
    });
    expect(["protect_existing_plan", "close_loop"]).toContain(card.move.type);
    expect(card.allowed_claims.completion).toBe(false);
    expect(card.allowed_claims.proof).toBe(false);
  });

  it("not-delivered open question may clarify without implying ignored", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({
      ctx: buildCtx(oqMinimalFacts(), {
        noSendSilence: {
          silence_context: {
            writer_tone_hint: "direct",
            days_since_last_user_reply: 1,
            days_since_last_outcome: null,
            silence_tier: "none",
            reentry_context: null,
          },
          delivery_truth: {
            recent_questions_not_delivered: [OPEN_QUESTION],
            recent_questions_delivered_unanswered: [],
            may_naturally_reask_if_prior_question_not_delivered: true,
          },
          recent_questions_not_delivered_count: 1,
          recent_questions_delivered_unanswered_count: 0,
        },
      }),
    });
    expect(card.move.type).toBe("clarify");
    expect(card.must_not_do.some((m) => /ignored the earlier question/i.test(m))).toBe(true);
  });

  it("satisfied open question includes fingerprint in avoid_repeating", () => {
    const ctx = buildCtx(
      oqMinimalFacts({
        thread: {
          ...oqMinimalFacts().thread,
          memory_packet: {
            ...minimalFacts().thread.memory_packet!,
            open_question_pending: false,
            latest_answer_after_open_question: "After Brooke's workout",
          },
        },
      })
    );
    expect(isOpenQuestionSatisfied(ctx)).toBe(true);
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx });
    expect(card.writer_constraints.avoid_repeating.some((a) => /Brooke's workout/i.test(a))).toBe(
      true
    );
  });

  it("proof permission false keeps proof/victory false on open question", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx: buildCtx(oqMinimalFacts()) });
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.allowed_claims.victory_room).toBe(false);
  });

  it("active pending adds must_not_do resolved/applied", () => {
    const pending = buildActivePendingStateFromCommitmentRow({
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
    });
    const card = buildOpenQuestionAnswerStrategyCardV1({
      ctx: buildCtx(oqMinimalFacts(), { activePending: pending }),
    });
    expect(card.must_not_do.some((m) => /resolved|applied|closed/i.test(m))).toBe(true);
  });

  it("validator repairs invalid ask_blocker for open_question_answer", () => {
    const ctx = buildCtx(oqMinimalFacts());
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx });
    card.move.type = "ask_blocker";
    const result = validateAndRepairStrategyCardV1(card, ctx);
    expect(result.validation_status).toBe("repaired");
    expect(result.card.move.type).not.toBe("ask_blocker");
    expect(["close_loop", "clarify"]).toContain(result.card.move.type);
  });

  it("no SMS copy in open-question card fields", () => {
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx: buildCtx(oqMinimalFacts()) });
    expect(JSON.stringify(card)).not.toMatch(/Nice — what made/i);
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
  });

  it("open-question telemetry includes answer_kind and satisfied", () => {
    const ctx = buildCtx(oqMinimalFacts());
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx });
    const meta = strategyCardV1MetaForTelemetry(
      { card, validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_route_kind).toBe("open_question_answer");
    expect(meta.strategy_card_open_question_answer_kind).toBe("open_reflection");
    expect(meta.strategy_card_open_question_satisfied).toBeDefined();
  });

  it("old coach preview adds non-speakable must_not_do and avoid_repeating fingerprint", () => {
    const oq = openQuestionFactsFixture();
    const ctx = buildCtx(oqMinimalFacts({ open_question_facts: oq }));
    const card = buildOpenQuestionAnswerStrategyCardV1({ ctx });
    expect(card.must_not_do).toContain(OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
    const fp = openQuestionOldCoachPreviewFingerprint(oq);
    expect(fp).toBeTruthy();
    expect(
      card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === fp!.toLowerCase())
    ).toBe(true);
    expect(card.must_not_do.some((m) => /old_open_question_reply_preview/i.test(m))).toBe(false);
  });
});

function arcFactsFixture(
  overrides?: Partial<InboundV3RelationshipFacts>
): InboundV3RelationshipFacts {
  return {
    ...minimalFacts(),
    route_purpose: "arc_clarify_ambiguous_short",
    suggested_coaching_move: "clarify_ambiguous_short_natural_sms",
    coaching_move_source: "hard_route",
    arc_clarification_facts: {
      ambiguous_short_reply: true,
      tentative_outcome: "user_yes",
      clarification_reason: "ambiguous_short_reply",
      context_age: {
        accountability_prompt_age_minutes: 200,
        accountability_prompt_sent_at: "2026-06-04T13:00:00.000Z",
        latest_outcome_at: null,
      },
      latest_question: "Did you hit two hours of deep work before noon?",
      legacy_clarification_text_preview: "LEGACY_ARC_CLARIFICATION_TEMPLATE_STUB",
    },
    ...overrides,
  };
}

describe("Phase 4.4a Strategy Card v1 arc clarify", () => {
  it("arc eligibility true only for arc_clarify_ambiguous_short with arc facts", () => {
    expect(isArcClarifyStrategyCardEligible(arcFactsFixture())).toBe(true);
    expect(isArcClarifyStrategyCardEligible(minimalFacts())).toBe(false);
    expect(isArcClarifyStrategyCardEligible(arcFactsFixture({ route_purpose: "normal_inbound_reply" }))).toBe(
      false
    );
  });

  it("normal and OQ eligibility unchanged when arc facts absent", () => {
    expect(isInboundNormalStrategyCardEligible(minimalFacts())).toBe(true);
    expect(isOpenQuestionAnswerStrategyCardEligible(minimalFacts())).toBe(false);
    expect(isArcClarifyStrategyCardEligible(minimalFacts())).toBe(false);
  });

  it("pivot, legacy, OQ, blocker exclude arc eligibility", () => {
    expect(
      isArcClarifyStrategyCardEligible(
        arcFactsFixture({ central_brain_pivot_facts: { blocked_outcome_scoring: true, central_turn_purpose: "human_conversation", confidence: 0.9, reason: "x", suggested_move: "x", legacy_tether_text_preview: "L" } })
      )
    ).toBe(false);
    expect(
      isArcClarifyStrategyCardEligible(
        arcFactsFixture({
          conversation_brain_fallback_facts: {
            conversation_brain_control_available: false,
            legacy_fallback_reason: "x",
            deterministic_template_preview: "T",
            classifier_result: "user_yes",
            gated_event_type: "user_yes",
            should_write_outcome_event: true,
            suggested_coaching_move: "ask_accountability",
            current_commitment_snapshot: "snap",
            server_state_summary: "s",
            inbound_message_sid: "SM1",
            coaching_route_meaning_summary: "m",
          },
        })
      )
    ).toBe(false);
    expect(
      isArcClarifyStrategyCardEligible(
        arcFactsFixture({
          open_question_facts: {
            latest_open_question: "Q?",
            expected_reply_semantics: "open_reflection",
            resolution_subkind: "open_reflection",
            extracted_answer: null,
            answer_kind: "ambiguous",
            old_open_question_reply_preview: "P",
            deterministic_fallback_used: false,
            deterministic_fallback_reason: null,
            legacy_open_question_reply_source: "deterministic_fallback",
            latest_outbound_preview: null,
          },
        })
      )
    ).toBe(false);
    expect(isArcClarifyStrategyCardEligible(arcFactsFixture({ blocker_facts: { blocker_text: "kids", blocker_category: null, repeated_blocker_signal: false, following_event_type: "user_no", blocker_pending_age_minutes_remaining: null, suggested_next_move: null, legacy_blocker_ack_preview: "L" } }))).toBe(false);
  });

  it("arc builder returns clarify with max_questions 1 and all claims false", () => {
    const ctx = buildCtx(arcFactsFixture());
    const card = buildArcClarifyStrategyCardV1({ ctx });
    expect(card.route_kind).toBe("arc_clarify_ambiguous_short");
    expect(card.move.type).toBe("clarify");
    expect(card.writer_constraints.max_questions).toBe(1);
    expect(card.allowed_claims).toEqual({
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    });
  });

  it("arc must_not_do includes tentative-outcome-not-confirmed and preview constraint", () => {
    const ctx = buildCtx(arcFactsFixture());
    const card = buildArcClarifyStrategyCardV1({ ctx });
    expect(card.must_not_do).toContain(ARC_TENTATIVE_OUTCOME_NOT_CONFIRMED_MUST_NOT_DO);
    expect(card.must_not_do).toContain(ARC_CLARIFICATION_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
    const fp = arcClarifyLegacyPreviewFingerprint(ctx.facts.arc_clarification_facts);
    expect(
      card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === fp!.toLowerCase())
    ).toBe(true);
    expect(card.must_not_do.some((m) => /legacy_clarification_text_preview/i.test(m))).toBe(false);
  });

  it("validator repairs invalid arc move to clarify", () => {
    const ctx = buildCtx(arcFactsFixture());
    const card = buildArcClarifyStrategyCardV1({ ctx });
    card.move.type = "ack_completion";
    card.allowed_claims.completion = true;
    const result = validateAndRepairStrategyCardV1(card, ctx);
    expect(result.validation_status).toBe("repaired");
    expect(result.card.move.type).toBe("clarify");
    expect(result.card.allowed_claims.completion).toBe(false);
  });

  it("no SMS copy in arc card fields", () => {
    const card = buildArcClarifyStrategyCardV1({ ctx: buildCtx(arcFactsFixture()) });
    expect(card.must_do.join(" ")).not.toMatch(/Did you hit two hours/i);
    expect(card.must_not_do.join(" ")).not.toMatch(/LEGACY_ARC_CLARIFICATION_TEMPLATE_STUB/i);
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
  });

  it("arc telemetry includes tentative outcome and context age", () => {
    const ctx = buildCtx(arcFactsFixture());
    const card = buildArcClarifyStrategyCardV1({ ctx });
    const meta = strategyCardV1MetaForTelemetry(
      { card, validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_route_kind).toBe("arc_clarify_ambiguous_short");
    expect(meta.strategy_card_move_type).toBe("clarify");
    expect(meta.strategy_card_arc_tentative_outcome).toBe("user_yes");
    expect(meta.strategy_card_arc_context_age).toMatch(/prompt_age_min:200/);
  });
});

function pivotFactsFixture(
  overrides?: Partial<InboundV3RelationshipFacts>,
  purpose = "human_conversation"
): InboundV3RelationshipFacts {
  return {
    ...minimalFacts(),
    route_purpose: "central_brain_pivot",
    suggested_coaching_move: "close_loop_no_new_action",
    coaching_move_source: "central_brain",
    central_brain_pivot_facts: {
      blocked_outcome_scoring: true,
      central_turn_purpose: purpose,
      confidence: 0.9,
      reason: "central_brain_human_or_meta",
      suggested_move: "close_loop_no_new_action",
      legacy_tether_text_preview: "LEGACY_TETHER_STUB_DO_NOT_SPEAK",
    },
    inbound_meaning: {
      relationship_meaning: "uncertain",
      persistence_decision: "no_outcome_write",
      sms_response_intent: "clarify_gently",
      evidence: [],
    },
    v2_accountability: {
      ...minimalFacts().v2_accountability,
      should_write_outcome_event: false,
    },
    ...overrides,
  };
}

describe("Phase 4.5 Strategy Card v1 central brain pivot", () => {
  it("central pivot eligibility true only for central_brain_pivot with pivot facts", () => {
    expect(isCentralPivotStrategyCardEligible(pivotFactsFixture())).toBe(true);
    expect(isCentralPivotStrategyCardEligible(minimalFacts())).toBe(false);
    expect(
      isCentralPivotStrategyCardEligible(pivotFactsFixture({ route_purpose: "normal_inbound_reply" }))
    ).toBe(false);
  });

  it("normal, OQ, and arc eligibility unchanged when pivot facts absent", () => {
    expect(isInboundNormalStrategyCardEligible(minimalFacts())).toBe(true);
    expect(isOpenQuestionAnswerStrategyCardEligible(minimalFacts())).toBe(false);
    expect(isArcClarifyStrategyCardEligible(minimalFacts())).toBe(false);
    expect(isCentralPivotStrategyCardEligible(minimalFacts())).toBe(false);
  });

  it("legacy, transactional, arc, OQ, and blocker families exclude pivot eligibility", () => {
    expect(
      isCentralPivotStrategyCardEligible(
        pivotFactsFixture({
          conversation_brain_fallback_facts: {
            conversation_brain_control_available: false,
            legacy_fallback_reason: "x",
            deterministic_template_preview: "T",
            classifier_result: "user_yes",
            gated_event_type: "user_yes",
            should_write_outcome_event: true,
            suggested_coaching_move: "ask_accountability",
            current_commitment_snapshot: "snap",
            server_state_summary: "s",
            inbound_message_sid: "SM1",
            coaching_route_meaning_summary: "m",
          },
        })
      )
    ).toBe(false);
    expect(
      isCentralPivotStrategyCardEligible(
        pivotFactsFixture({
          arc_clarification_facts: arcFactsFixture().arc_clarification_facts!,
        })
      )
    ).toBe(false);
    expect(
      isCentralPivotStrategyCardEligible(
        pivotFactsFixture({
          open_question_facts: {
            latest_open_question: "Q?",
            expected_reply_semantics: "open_reflection",
            resolution_subkind: "open_reflection",
            extracted_answer: null,
            answer_kind: "ambiguous",
            old_open_question_reply_preview: "P",
            deterministic_fallback_used: false,
            deterministic_fallback_reason: null,
            legacy_open_question_reply_source: "deterministic_fallback",
            latest_outbound_preview: null,
          },
        })
      )
    ).toBe(false);
    expect(
      isCentralPivotStrategyCardEligible(
        pivotFactsFixture({
          blocker_facts: {
            blocker_text: "kids",
            blocker_category: null,
            repeated_blocker_signal: false,
            following_event_type: "user_no",
            blocker_pending_age_minutes_remaining: null,
            suggested_next_move: null,
            legacy_blocker_ack_preview: "L",
          },
        })
      )
    ).toBe(false);
    expect(
      isCentralPivotStrategyCardEligible(
        pivotFactsFixture({
          refresh_facts: {
            refresh_step: "identity_anchor",
            user_answer_type: "free_text",
            expected_answer: null,
            state_transition_summary: "none",
            updated_identity_anchor: null,
            updated_commitment_bar: null,
            legacy_refresh_reply_preview: "PREVIEW",
          },
        })
      )
    ).toBe(false);
  });

  it("pivot builder sets central_pivot_blocked_outcome_scoring and all claims false", () => {
    const ctx = buildCtx(pivotFactsFixture());
    const card = buildCentralPivotStrategyCardV1({ ctx });
    expect(card.route_kind).toBe("central_brain_pivot");
    expect(card.server_truth_summary.central_pivot_blocked_outcome_scoring).toBe(true);
    expect(card.allowed_claims).toEqual({
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    });
  });

  it("human_conversation maps to close_loop or other", () => {
    const card = buildCentralPivotStrategyCardV1({ ctx: buildCtx(pivotFactsFixture()) });
    expect(["close_loop", "other"]).toContain(card.move.type);
    expect(card.must_not_do).toContain(CENTRAL_PIVOT_NO_OUTCOME_SCORING_MUST_NOT_DO);
  });

  it("meta_question_or_confusion maps to clarify with max_questions 1", () => {
    const card = buildCentralPivotStrategyCardV1({
      ctx: buildCtx(pivotFactsFixture(undefined, "meta_question_or_confusion")),
    });
    expect(card.move.type).toBe("clarify");
    expect(card.writer_constraints.max_questions).toBe(1);
    expect(card.must_not_do.some((m) => /confusion as today's/i.test(m))).toBe(true);
  });

  it("advice_or_coaching_request maps to protect_existing_plan or clarify", () => {
    const card = buildCentralPivotStrategyCardV1({
      ctx: buildCtx(pivotFactsFixture(undefined, "advice_or_coaching_request")),
    });
    expect(["protect_existing_plan", "clarify"]).toContain(card.move.type);
    expect(card.allowed_claims.state_changed).toBe(false);
    expect(card.allowed_claims.proposal_active).toBe(false);
  });

  it("legacy tether preview adds non-speakable constraint and fingerprint", () => {
    const ctx = buildCtx(pivotFactsFixture());
    const card = buildCentralPivotStrategyCardV1({ ctx });
    expect(card.must_not_do).toContain(OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
    const fp = centralPivotTetherPreviewFingerprint(ctx.facts.central_brain_pivot_facts);
    expect(
      card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === fp!.toLowerCase())
    ).toBe(true);
    expect(card.must_not_do.some((m) => /legacy_tether_text_preview/i.test(m))).toBe(false);
  });

  it("validator repairs invalid outcome-claiming pivot card", () => {
    const ctx = buildCtx(pivotFactsFixture());
    const card = buildCentralPivotStrategyCardV1({ ctx });
    card.move.type = "ack_completion";
    card.allowed_claims.completion = true;
    const result = validateAndRepairStrategyCardV1(card, ctx);
    expect(result.validation_status).toBe("repaired");
    expect(result.card.allowed_claims.completion).toBe(false);
    expect(["close_loop", "clarify", "protect_existing_plan", "recover_today", "other"]).toContain(
      result.card.move.type
    );
  });

  it("validator rejects claim overreach on proof when card claims proof", () => {
    const ctx = buildCtx(pivotFactsFixture());
    const card = buildCentralPivotStrategyCardV1({ ctx });
    card.allowed_claims.proof = true;
    const first = validateAndRepairStrategyCardV1(card, ctx);
    expect(first.card.allowed_claims.proof).toBe(false);
  });

  it("no SMS copy in pivot card fields", () => {
    const card = buildCentralPivotStrategyCardV1({ ctx: buildCtx(pivotFactsFixture()) });
    expect(card.must_do.join(" ")).not.toMatch(/LEGACY_TETHER_STUB/i);
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
  });

  it("pivot telemetry includes central turn purpose and blocked scoring", () => {
    const ctx = buildCtx(pivotFactsFixture());
    const card = buildCentralPivotStrategyCardV1({ ctx });
    const meta = strategyCardV1MetaForTelemetry(
      { card, validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_route_kind).toBe("central_brain_pivot");
    expect(meta.strategy_card_central_turn_purpose).toBe("human_conversation");
    expect(meta.strategy_card_central_pivot_blocked_outcome_scoring).toBe(true);
    expect(meta.strategy_card_central_pivot_should_answer_without_scoring).toBe(true);
  });
});

describe("Daily C1 Strategy Card v1", () => {
  function dailyFacts(overrides?: Partial<DailyV3RelationshipFacts>): DailyV3RelationshipFacts {
    return {
      route_kind: "main_active_accountability",
      accountability_day_key: "2026-06-08",
      user: {
        clerk_user_id: "u_daily",
        preferred_name: "Alex",
        timezone: "America/Chicago",
        local_time_iso: "2026-06-08T09:00:00.000Z",
        relationship_profile_summary: null,
      },
      commitment: {
        id: "cmt_d",
        title: "Focus",
        behavior_statement: "Two hours deep work",
        effective_ask: "Two hours deep work",
        accountability_phase: "active_accountability",
        identity_anchor_allowed: false,
        identity_anchor_short: null,
      },
      thread_memory: {
        latest_outbound_sms: "Did it happen?",
        latest_inbound_sms: null,
        recent_transcript_or_context_block: null,
        latest_open_question: null,
        do_not_repeat_hints: [],
        coaching_memory_snippet: "",
        recent_pattern_hints: null,
        last_5_coach_questions: ["Did it happen yesterday?"],
      },
      accountability: {
        daily_purpose: "standard_accountability_check",
        server_strategy: "standard_check",
        next_move_type: "hold_standard",
        prior_outcome: "user_yes",
        yes_streak_14d: 2,
        no_count_14d: 0,
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

  function buildDailyCtx(facts: DailyV3RelationshipFacts) {
    return buildDailyC1StrategyCardContextFromSnapshot({
      facts,
      snapshot: {
        proof_and_praise_permission: { data: baseProof() },
        open_loops_and_do_not_repeat: {
          data: {
            ...emptyOpenLoops(),
            satisfied_asks: [
              {
                ask_text: "Did it happen yesterday?",
                satisfied_at: "2026-06-07",
                source: "projection",
                do_not_repeat: true,
              },
            ],
            do_not_repeat_asks: ["Did it happen yesterday?"],
          },
        },
        active_pending_state: { items: [] },
        no_send_and_silence_history: null,
      },
    });
  }

  it("main_active_accountability defaults to daily_check_in", () => {
    const card = buildDailyC1StrategyCardV1({ ctx: buildDailyCtx(dailyFacts()) });
    expect(card.surface).toBe("daily");
    expect(card.route_kind).toBe("main_active_accountability");
    expect(card.move.type).toBe("daily_check_in");
  });

  it("main with pending_plan_proof uses protect_existing_plan", () => {
    const card = buildDailyC1StrategyCardV1({
      ctx: buildDailyCtx(
        dailyFacts({
          accountability: {
            ...dailyFacts().accountability,
            pending_plan_proof: {
              active: true,
              plan_summary_hint: "after workout",
              anchor_phrase_hint: "workout",
              anchor_key: "wk",
              plan_for_day_key: "2026-06-08",
              source_answer_preview: "after workout",
              recurrence_confidence: "medium",
              outcome_known: false,
            },
          },
          suggested_coaching_move: "close_prior_plan_loop",
        })
      ),
    });
    expect(card.move.type).toBe("protect_existing_plan");
  });

  it("low_pressure_reactivation uses reactivate_gently", () => {
    const card = buildDailyC1StrategyCardV1({
      ctx: buildDailyCtx(
        dailyFacts({
          route_kind: "low_pressure_reactivation",
          suggested_coaching_move: "low_pressure_reactivation",
          accountability: {
            ...dailyFacts().accountability,
            prior_outcome: null,
            server_strategy: "reactivation_nudge",
          },
        })
      ),
    });
    expect(card.move.type).toBe("reactivate_gently");
    expect(card.writer_constraints.tone_posture).toBe("gentle_reentry");
    expect(card.writer_constraints.max_questions).toBeLessThanOrEqual(1);
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.allowed_claims.victory_room).toBe(false);
  });

  it("C1 eligibility excludes contract, pending, and refresh routes", () => {
    expect(isDailyC1StrategyCardEligible(dailyFacts())).toBe(true);
    expect(
      isDailyC1StrategyCardEligible(
        dailyFacts({ contract_proposal: { contract_kind: "shrink_ask", required_reply_semantics: "yes_no_binding_only", semantic_daily_contract_v1: true } })
      )
    ).toBe(false);
    expect(
      isDailyC1StrategyCardEligible(
        dailyFacts({
          pending_resolution: {
            resolution_kind: "replace",
            expires_at: null,
            payload_source: null,
            sms_state: null,
            detected_intent: null,
            candidate_behavior_snippet: null,
            awaiting_user_confirmation: false,
          },
        })
      )
    ).toBe(false);
    expect(
      isDailyC1StrategyCardEligible(
        dailyFacts({ refresh: { refresh_step: "identity_first", identity_anchor_text: "Leader" } })
      )
    ).toBe(false);
    expect(isDailyStrategyCardEligible(dailyFacts())).toBe(true);
  });

  it("proof false keeps proof and Victory false", () => {
    const card = buildDailyC1StrategyCardV1({ ctx: buildDailyCtx(dailyFacts()) });
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.allowed_claims.victory_room).toBe(false);
  });

  it("includes satisfied asks in avoid_repeating", () => {
    const card = buildDailyC1StrategyCardV1({ ctx: buildDailyCtx(dailyFacts()) });
    expect(card.writer_constraints.avoid_repeating.length).toBeGreaterThan(0);
  });

  it("invalid card repairs to safe daily default", () => {
    const ctx = buildDailyCtx(dailyFacts({ route_kind: "low_pressure_reactivation" }));
    const bad = buildDailyC1StrategyCardV1({ ctx });
    bad.move.type = "propose_adjustment";
    bad.allowed_claims.proposal_active = true;
    const result = validateAndRepairDailyC1StrategyCardV1(bad, ctx);
    expect(result.card.move.type).toBe("reactivate_gently");
    expect(result.card.allowed_claims.proposal_active).toBe(false);
  });

  it("no SMS copy in daily card fields", () => {
    const card = buildDailyC1StrategyCardV1({ ctx: buildDailyCtx(dailyFacts()) });
    expect(card.must_do.join(" ")).not.toMatch(/\b(hey|thanks for texting)\b/i);
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
  });

  it("daily telemetry includes surface and legacy strategy hints", () => {
    const ctx = buildDailyCtx(dailyFacts());
    const card = buildDailyC1StrategyCardV1({ ctx });
    const meta = strategyCardV1MetaForTelemetry(
      { card, validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_surface).toBe("daily");
    expect(meta.strategy_card_legacy_server_strategy).toBe("standard_check");
    expect(meta.strategy_card_daily_reactivation).toBe(false);
  });
});

describe("Daily C2 Strategy Card v1", () => {
  function contractSemanticFacts(
    kind: "shrink_ask" | "recommit_same"
  ): DailyV3RelationshipFacts["contract_proposal"] extends infer _T
    ? NonNullable<DailyV3RelationshipFacts["contract_proposal"]>["daily_contract_semantic_facts"]
    : never {
    const baseBehavior = "Two hours deep work before noon";
    const shrinkAsk = "One hour deep work before noon";
    return {
      proposal_kind: kind,
      duration_days: 7,
      base_behavior_statement: baseBehavior,
      proposed_overlay_ask: kind === "shrink_ask" ? shrinkAsk : null,
      proposed_behavior_preview: kind === "shrink_ask" ? shrinkAsk : baseBehavior,
      desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
      must_not_claim_goal_updated: true,
      forbidden_phrases: ["Reply YES"],
    };
  }

  function contractDailyFacts(
    kind: "shrink_ask" | "recommit_same",
    overrides?: Partial<DailyV3RelationshipFacts>
  ): DailyV3RelationshipFacts {
    return {
      route_kind: "contract_prompt",
      accountability_day_key: "2026-06-08",
      user: {
        clerk_user_id: "u_contract",
        preferred_name: "Alex",
        timezone: "America/Chicago",
        local_time_iso: "2026-06-08T09:00:00.000Z",
        relationship_profile_summary: null,
      },
      commitment: {
        id: "cmt_c",
        title: "Focus",
        behavior_statement: "Two hours deep work before noon",
        effective_ask: "Two hours deep work before noon",
        accountability_phase: "active_accountability",
        identity_anchor_allowed: false,
        identity_anchor_short: null,
      },
      thread_memory: {
        latest_outbound_sms: "How did today go?",
        latest_inbound_sms: null,
        recent_transcript_or_context_block: null,
        latest_open_question: null,
        do_not_repeat_hints: [],
        coaching_memory_snippet: "",
        recent_pattern_hints: null,
        last_5_coach_questions: [],
      },
      accountability: {
        daily_purpose: "contract_overlay_proposal",
        server_strategy: "standard_check",
        next_move_type: "shrink_ask",
        prior_outcome: null,
        yes_streak_14d: 0,
        no_count_14d: 0,
        partial_count_14d: 0,
        blocker_preview: null,
        proof_or_milestone_signal: null,
        silence_tier: "none",
        unanswered_checks: 0,
        days_since_last_user_outcome: 2,
        reentry_active: false,
        overlay_active: false,
        evolution_pattern_hint: null,
        contract_proposal_mode: true,
      },
      contract_proposal: {
        contract_kind: kind,
        required_reply_semantics: "yes_no_binding_only",
        semantic_daily_contract_v1: true,
        daily_contract_semantic_facts: contractSemanticFacts(kind),
      },
      suggested_coaching_move: "propose_contract",
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

  function buildC2Ctx(facts: DailyV3RelationshipFacts) {
    return buildDailyC2StrategyCardContextFromSnapshot({
      facts,
      snapshot: {
        open_loops_and_do_not_repeat: { data: emptyOpenLoops() },
      },
    });
  }

  it("shrink_ask uses contract_proposal move", () => {
    const card = buildDailyC2StrategyCardV1({ ctx: buildC2Ctx(contractDailyFacts("shrink_ask")) });
    expect(card.route_kind).toBe("contract_prompt");
    expect(card.move.type).toBe("contract_proposal");
    expect(card.server_truth_summary.daily_contract_proposal_kind).toBe("shrink_ask");
    expect(card.writer_constraints.tone_posture).toBe("contract_precise");
  });

  it("recommit_same uses contract_proposal move", () => {
    const card = buildDailyC2StrategyCardV1({
      ctx: buildC2Ctx(contractDailyFacts("recommit_same")),
    });
    expect(card.move.type).toBe("contract_proposal");
    expect(card.server_truth_summary.daily_contract_proposal_kind).toBe("recommit_same");
    expect(card.writer_constraints.tone_posture).toBe("warm_direct");
  });

  it("state_changed and proposal_active are false", () => {
    const card = buildDailyC2StrategyCardV1({ ctx: buildC2Ctx(contractDailyFacts("shrink_ask")) });
    expect(card.allowed_claims.state_changed).toBe(false);
    expect(card.allowed_claims.proposal_active).toBe(false);
    expect(card.server_truth_summary.daily_contract_proposal_pending_before_sms).toBe(false);
  });

  it("proof and Victory false by default", () => {
    const card = buildDailyC2StrategyCardV1({ ctx: buildC2Ctx(contractDailyFacts("shrink_ask")) });
    expect(card.allowed_claims.proof).toBe(false);
    expect(card.allowed_claims.victory_room).toBe(false);
  });

  it("must_not_do includes goal changed, accepted, active, and robotic consent", () => {
    const joined = buildDailyC2StrategyCardV1({
      ctx: buildC2Ctx(contractDailyFacts("shrink_ask")),
    }).must_not_do.join(" ").toLowerCase();
    expect(joined).toMatch(/goal/);
    expect(joined).toMatch(/changed/);
    expect(joined).toMatch(/accepted/);
    expect(joined).toMatch(/active/);
    expect(joined).toMatch(/reply yes/);
  });

  it("max_questions <= 1", () => {
    const card = buildDailyC2StrategyCardV1({ ctx: buildC2Ctx(contractDailyFacts("recommit_same")) });
    expect(card.writer_constraints.max_questions).toBeLessThanOrEqual(1);
  });

  it("invalid card repairs to safe contract_proposal", () => {
    const ctx = buildC2Ctx(contractDailyFacts("shrink_ask"));
    const bad = buildDailyC2StrategyCardV1({ ctx });
    bad.move.type = "daily_check_in";
    bad.allowed_claims.proposal_active = true;
    const result = validateAndRepairDailyContractPromptStrategyCardV1(bad, ctx);
    expect(result.card.move.type).toBe("contract_proposal");
    expect(result.card.allowed_claims.proposal_active).toBe(false);
  });

  it("no SMS copy in daily C2 card fields", () => {
    const card = buildDailyC2StrategyCardV1({ ctx: buildC2Ctx(contractDailyFacts("shrink_ask")) });
    expect(card.must_do.join(" ")).not.toMatch(/\b(hey|thanks for texting)\b/i);
    expect(card.move.reason.length).toBeLessThanOrEqual(200);
  });

  it("C2 eligibility excludes legacy binding path and C1 routes", () => {
    expect(isDailyC2StrategyCardEligible(contractDailyFacts("shrink_ask"))).toBe(true);
    expect(isDailyC1StrategyCardEligible(contractDailyFacts("shrink_ask"))).toBe(false);
    expect(
      isDailyC2StrategyCardEligible(
        contractDailyFacts("shrink_ask", {
          contract_proposal: {
            contract_kind: "shrink_ask",
            required_reply_semantics: "yes_no_binding_only",
            binding_text_verbatim: "Reply YES to confirm",
          },
        })
      )
    ).toBe(false);
    expect(isDailyStrategyCardEligible(contractDailyFacts("shrink_ask"))).toBe(true);
  });

  it("C2 telemetry includes contract proposal kind", () => {
    const ctx = buildC2Ctx(contractDailyFacts("shrink_ask"));
    const card = buildDailyC2StrategyCardV1({ ctx });
    const meta = strategyCardV1MetaForTelemetry(
      { card, validation_status: "valid", validation_reasons: [] },
      ctx
    );
    expect(meta.strategy_card_surface).toBe("daily");
    expect(meta.strategy_card_route_kind).toBe("contract_prompt");
    expect(meta.strategy_card_move_type).toBe("contract_proposal");
    expect(meta.strategy_card_daily_contract_proposal_kind).toBe("shrink_ask");
    expect(meta.strategy_card_legacy_v2_contract_proposal_kind).toBe("shrink_ask");
  });
});
