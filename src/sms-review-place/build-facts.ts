/**
 * SMS Review Place — fake lane facts from curated scenarios (no DB loaders).
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { InboundV3ProofCalloutHint } from "@/lib/v2-proof-moment";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import { RELATIONSHIP_MEMORY_7D_WINDOW_DAYS } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipMemory30dResult } from "@/lib/sms-relationship-memory-30d";
import { RELATIONSHIP_MEMORY_30D_WINDOW_DAYS } from "@/lib/sms-relationship-memory-30d";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";

/** Mirror `RECENT_EXACT_THREAD_WINDOW_HOURS` without importing DB-backed module. */
const RECENT_EXACT_THREAD_WINDOW_HOURS = 72 as const;
import type { SlimSmsRelationshipMemoryPacketForFacts } from "@/lib/sms-relationship-memory-packet";
import { buildTemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import {
  buildInboundV3RelationshipFacts,
  buildConversationBrainFallbackFacts,
  type InboundV3OpenQuestionFacts,
  type InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";
import {
  enrichDailyFactsWithThreadFreshness,
  type DailyV3RelationshipFacts,
} from "@/lib/v3-daily-relationship-lane";
import {
  PLAN_CONFIRMATION_Q,
  SATISFIED_ASK_Q,
} from "@/sms-review-place/fixtures/strategy-card-scenarios";
import { getPersona } from "@/sms-review-place/fixtures/personas";
import { OLD_PREVIEW_STUB_TEXT } from "@/sms-review-place/fixtures/open-question-strategy-card-scenarios";
import { ARC_LEGACY_PREVIEW_STUB } from "@/sms-review-place/fixtures/arc-clarify-strategy-card-scenarios";
import { CENTRAL_PIVOT_LEGACY_TETHER_PREVIEW_STUB } from "@/sms-review-place/fixtures/central-pivot-strategy-card-scenarios";
import { LEGACY_FALLBACK_TEMPLATE_PREVIEW_STUB } from "@/sms-review-place/fixtures/conversation-brain-fallback-scenarios";
import type { SmsReviewScenario } from "@/sms-review-place/types";

const SIM_DAY_KEY = "2026-06-04";
const SIM_LOCAL_ISO = "2026-06-04T14:00:00.000Z";

export function emptyThread72h(): RecentExactThread72hResult {
  return {
    messages: [],
    window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
    message_count: 0,
    had_preview_messages: false,
    had_system_no_send: false,
  };
}

export function emptyMemory7d(commitmentId = "sim_cmt_1"): RelationshipMemory7dResult {
  return {
    window_days: RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
    built_at: SIM_LOCAL_ISO,
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
    meta: { item_count: 0, sources_used: ["sms_review_place_fixture"] },
  };
}

export function emptyMemory30d(commitmentId = "sim_cmt_1"): RelationshipMemory30dResult {
  return {
    window_days: RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
    built_at: SIM_LOCAL_ISO,
    commitment_id: commitmentId,
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
    meta: { item_count: 0, sources_used: ["sms_review_place_fixture"] },
  };
}

function minimalMemoryPacket(
  overrides: Partial<SlimSmsRelationshipMemoryPacketForFacts> = {}
): SlimSmsRelationshipMemoryPacketForFacts {
  return {
    recent_exact_thread_text: "",
    recent_exact_message_count: 0,
    recent_exact_thread_72h: emptyThread72h(),
    relationship_memory_7d: emptyMemory7d(),
    relationship_memory_30d: emptyMemory30d(),
    last_outbound_full_body: null,
    last_inbound_full_body: null,
    last_substantive_user_message: null,
    last_substantive_coach_message: null,
    last_5_coach_questions: [],
    last_5_user_answers: [],
    latest_open_question: null,
    latest_answer_after_open_question: null,
    open_question_answered_at: null,
    open_question_pending: false,
    open_question_expected_answer_type: null,
    open_question_source: "none",
    answer_source: "none",
    projection_used: false,
    latest_open_question_guess: null,
    latest_answer_after_open_question_guess: null,
    do_not_repeat_phrases: [],
    memory_priority_rules: [],
    coaching_memory_summary: null,
    coaching_memory_is_background_only: true,
    relationship_anchor_sources: { important_people: [], people_summary: null },
    ...overrides,
  };
}

function buildTemporalForScenario(scenario: SmsReviewScenario): TemporalContractV1 {
  return buildTemporalContractV1({
    timezone: scenario.timezone,
    now: new Date(SIM_LOCAL_ISO),
    sendDayKey: SIM_DAY_KEY,
  });
}

function baseCommitment(scenario: SmsReviewScenario): ActiveV2CommitmentRow {
  const persona = getPersona(scenario.personaId);
  const row: ActiveV2CommitmentRow = {
    id: `sim_cmt_${scenario.id}`,
    clerk_user_id: persona.clerkUserId,
    status: "active",
    behavior_statement: scenario.behaviorStatement,
    title: scenario.goalTitle,
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

  if (scenario.id === "stale-goal") {
    row.pending_resolution_kind = "commitment_replace";
    row.pending_resolution_created_at = "2026-06-01T12:00:00.000Z";
    row.pending_resolution_expires_at = "2026-06-10T12:00:00.000Z";
    row.pending_resolution_payload = {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: "No screens after 9pm",
      candidate_new_bar: "No screens after 9pm",
    };
  }

  if (scenario.id === "strategy-card-active-pending") {
    row.adaptive_proposal_text = "Try a smaller rep?";
    row.adaptive_proposal_created_at = "2026-06-01T00:00:00.000Z";
    row.adaptive_proposal_expires_at = "2026-06-15T00:00:00.000Z";
  }

  return row;
}

function baseGatedDecision(event: "user_yes" | "user_no" | "user_partial"): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: event,
    decision_reason: "sms_review_place_fixture",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

function isStrategyCardScenario(scenario: SmsReviewScenario): boolean {
  return scenario.id.startsWith("strategy-card-");
}

function inboundEventForScenario(scenario: SmsReviewScenario): "user_yes" | "user_no" | "user_partial" {
  if (scenario.id === "partial-not-win" || scenario.id === "strategy-card-partial") return "user_partial";
  if (
    scenario.id === "repeated-miss-no-shame" ||
    scenario.id === "blocker-heavy" ||
    scenario.id === "strategy-card-single-miss" ||
    scenario.id === "strategy-card-blocker-known" ||
    scenario.id === "strategy-card-active-pending"
  ) {
    return "user_no";
  }
  if (scenario.id === "strategy-card-plan-ack-good") return "user_yes";
  return "user_yes";
}

function proofHintForScenario(scenario: SmsReviewScenario): InboundV3ProofCalloutHint | null {
  if (scenario.id === "proof-victory-allowed") {
    return {
      eligible: true,
      surface: "victory_room",
      reason: "followed_through",
      instruction: "May mention Victory Room naturally.",
      proof_insert_will_attempt: true,
      proof_callout_claim_saved_allowed: false,
    };
  }
  if (scenario.id === "proof-victory-forbidden") {
    return {
      eligible: true,
      surface: "victory_room",
      reason: "followed_through",
      instruction: "May mention Victory Room naturally.",
      proof_insert_will_attempt: true,
      proof_callout_claim_saved_allowed: false,
    };
  }
  return null;
}

const OPEN_QUESTION_SCENARIO_IDS = new Set([
  "open-question-answered",
  "open-question-clear-answer",
  "open-question-unclear-answer",
  "open-question-plan-ack",
  "open-question-satisfied-no-repeat",
  "open-question-not-delivered",
  "open-question-old-preview-non-speakable",
]);

const ARC_CLARIFY_SCENARIO_IDS = new Set([
  "arc-clarify-ambiguous-short",
  "arc-clarify-legacy-preview-non-speakable",
  "arc-clarify-tentative-outcome-not-scored",
]);

const CENTRAL_PIVOT_SCENARIO_IDS = new Set([
  "central-pivot-human-conversation",
  "central-pivot-meta-confusion",
  "central-pivot-legacy-tether-non-speakable",
  "central-pivot-advice-request",
]);

const LEGACY_FALLBACK_SCENARIO_IDS = new Set([
  "legacy-fallback-completion-safe",
  "legacy-fallback-miss-safe",
  "legacy-fallback-template-preview-non-speakable",
  "legacy-fallback-tu-suppresses-fallback",
]);

function buildOpenQuestionAnswerInboundFacts(args: {
  scenario: SmsReviewScenario;
  persona: ReturnType<typeof getPersona>;
  commitment: ActiveV2CommitmentRow;
  openQ: string;
  userReply: string;
  lines: string[];
  memoryPacket: SlimSmsRelationshipMemoryPacketForFacts;
}): InboundV3RelationshipFacts {
  const { scenario, persona, commitment, openQ, userReply, lines, memoryPacket } = args;
  const id = scenario.id;

  let openQuestionFacts: InboundV3OpenQuestionFacts = {
    latest_open_question: openQ,
    expected_reply_semantics: id === "open-question-plan-ack" ? "plan_confirmation" : "open_reflection",
    resolution_subkind: id === "open-question-plan-ack" ? "plan_confirmation" : "open_reflection",
    extracted_answer:
      id === "open-question-unclear-answer"
        ? null
        : id === "open-question-plan-ack"
          ? userReply
          : userReply,
    answer_kind: id === "open-question-unclear-answer" ? "ambiguous" : "open_reflection",
    old_open_question_reply_preview:
      id === "open-question-old-preview-non-speakable" ? OLD_PREVIEW_STUB_TEXT : "LEGACY_PREVIEW",
    deterministic_fallback_used: false,
    deterministic_fallback_reason: null,
    legacy_open_question_reply_source: "deterministic_fallback",
    latest_outbound_preview: openQ,
  };

  if (id === "open-question-unclear-answer") {
    openQuestionFacts = {
      ...openQuestionFacts,
      extracted_answer: null,
      answer_kind: "ambiguous",
    };
  }

  const mp = { ...memoryPacket };

  if (id !== "open-question-not-delivered") {
    const thread72h: RecentExactThread72hResult = {
      messages: [
        {
          at: "2026-06-04T13:00:00.000Z",
          at_local: "Jun 4, 8:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: SIM_DAY_KEY,
          role: "coach",
          body: openQ,
          message_kind: null,
          source_table: "sms_outbound_messages",
          message_sid: "SM_sim_oq_sent",
          delivery_status: "sent",
          is_exact_body: true,
        },
        {
          at: "2026-06-04T14:00:00.000Z",
          at_local: "Jun 4, 9:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: SIM_DAY_KEY,
          role: "user",
          body: userReply,
          message_kind: null,
          source_table: "sms_inbound_messages",
          message_sid: "sim_SM001",
          delivery_status: "sent",
          is_exact_body: true,
        },
      ],
      window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
      message_count: 2,
      had_preview_messages: false,
      had_system_no_send: false,
    };
    mp.recent_exact_thread_72h = thread72h;
    mp.recent_exact_thread_text = `Coach: ${openQ}\nUser: ${userReply}`;
  }

  if (id === "open-question-satisfied-no-repeat" || id === "open-question-answered") {
    mp.open_question_pending = false;
    mp.latest_answer_after_open_question = "After Brooke's workout";
    mp.answer_source = "projection";
    mp.projection_used = true;
  }

  if (id === "open-question-not-delivered") {
    const thread72h: RecentExactThread72hResult = {
      messages: [
        {
          at: "2026-06-04T13:00:00.000Z",
          at_local: "Jun 4, 8:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: SIM_DAY_KEY,
          role: "coach",
          body: openQ,
          message_kind: "check_sent_preview",
          source_table: "sms_outbound_messages",
          message_sid: "SM_sim_preview_oq",
          delivery_status: "preview",
          is_exact_body: true,
        },
      ],
      window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
      message_count: 1,
      had_preview_messages: true,
      had_system_no_send: false,
    };
    mp.recent_exact_thread_72h = thread72h;
    mp.recent_exact_thread_text = `${openQ} [preview]`;
    mp.open_question_pending = true;
  }

  const clearAnswerTu =
    id === "open-question-clear-answer"
      ? {
          reconciled_relationship_meaning: "direct_answer" as const,
          reconciled_response_intent: "close_loop_no_new_action" as const,
          reconciled_persistence_decision: "no_outcome_write" as const,
          reconciled_do_not_repeat_asks: [] as string[],
          last_ask_satisfied: "no" as const,
          satisfaction_kind: "unclear" as const,
          stale_ask_risk: false,
          confidence: 0.9,
          disagreement_flags: [] as string[],
          interpreter_failed_reason: null,
          stale_ask_avoided: false,
          persistence_note: "clear open question answer",
          proposal: null,
        }
      : undefined;

  const unclearTu =
    id === "open-question-unclear-answer"
      ? {
          reconciled_relationship_meaning: "direct_answer" as const,
          reconciled_response_intent: "unclear_clarify" as const,
          reconciled_persistence_decision: "no_outcome_write" as const,
          reconciled_do_not_repeat_asks: [] as string[],
          last_ask_satisfied: "no" as const,
          satisfaction_kind: "unclear" as const,
          stale_ask_risk: false,
          confidence: 0.7,
          disagreement_flags: [] as string[],
          interpreter_failed_reason: null,
          stale_ask_avoided: false,
          persistence_note: "unclear open question answer",
          proposal: null,
        }
      : undefined;

  const planAckTu =
    id === "open-question-plan-ack"
      ? {
          reconciled_relationship_meaning: "direct_answer" as const,
          reconciled_response_intent: "reinforce_plan_without_proof" as const,
          reconciled_persistence_decision: "no_outcome_write" as const,
          reconciled_do_not_repeat_asks: [] as string[],
          last_ask_satisfied: "no" as const,
          satisfaction_kind: "unclear" as const,
          stale_ask_risk: false,
          confidence: 0.85,
          disagreement_flags: [] as string[],
          interpreter_failed_reason: null,
          stale_ask_avoided: false,
          persistence_note: "plan ack",
          proposal: null,
        }
      : undefined;

  const satisfiedTu =
    id === "open-question-satisfied-no-repeat"
      ? {
          reconciled_relationship_meaning: "direct_answer" as const,
          reconciled_response_intent: "acknowledge_prior_ask_satisfied" as const,
          reconciled_persistence_decision: "no_outcome_write" as const,
          reconciled_do_not_repeat_asks: [openQ],
          last_ask_satisfied: "yes" as const,
          satisfaction_kind: "plan_exists" as const,
          stale_ask_risk: false,
          confidence: 0.9,
          disagreement_flags: [] as string[],
          interpreter_failed_reason: null,
          stale_ask_avoided: true,
          persistence_note: "satisfied open question",
          proposal: null,
        }
      : undefined;

  const built = buildInboundV3RelationshipFacts({
    clerkUserId: persona.clerkUserId,
    preferredName: persona.preferredName,
    timezone: scenario.timezone,
    localTimeIso: SIM_LOCAL_ISO,
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    userMessageRaw: userReply,
    coalescedInboundText: userReply,
    suppressedMessageSids: ["sim_SM001"],
    transcriptLines: lines,
    northStarPacket: {
      source: "sms_review_place",
      latestOutboundBody: openQ,
      latestOpenQuestion: openQ,
      expectedReplySemantics:
        id === "open-question-plan-ack" ? "plan_confirmation" : "open_reflection",
      proofSignal: false,
      missSignal: false,
      blockerSignal: false,
      todayCompleted: false,
    },
    gatedDecision:
      id === "open-question-unclear-answer"
        ? {
            mode: "clarify",
            final_event_type: null,
            decision_reason: "sms_review_place_fixture",
            confidence_used: null,
            should_write_outcome_event: false,
            should_open_blocker_capture: false,
            reply_style: "normal_outcome",
            overrode_deterministic: false,
          }
        : {
            mode: "use_deterministic",
            final_event_type: null,
            decision_reason: "sms_review_place_fixture",
            confidence_used: null,
            should_write_outcome_event: false,
            should_open_blocker_capture: false,
            reply_style: "normal_outcome",
            overrode_deterministic: false,
          },
    deterministicEventType: "user_yes",
    doNotRepeatHints: [],
    relationshipProfileSummary: persona.identityLabel,
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
    relationshipMemoryPacket: mp,
    routePurpose: "open_question_answer",
    branchMigratedToLane: true,
    branchName: "open_question_answer",
    openQuestionFacts,
    turnUnderstandingReconciled: planAckTu ?? satisfiedTu ?? clearAnswerTu ?? unclearTu,
  });

  if (id === "open-question-plan-ack") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "answer_to_prior_question",
      persistence_decision: "no_outcome_write",
      sms_response_intent: "reinforce_plan_and_choose_first_step",
    };
  } else if (id === "open-question-unclear-answer") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "answer_to_prior_question",
      persistence_decision: "no_outcome_write",
      sms_response_intent: "clarify_gently",
    };
  } else {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "answer_to_prior_question",
      persistence_decision: "no_outcome_write",
      sms_response_intent: "answer_prior_question",
    };
  }

  built.thread.expected_reply_semantics =
    id === "open-question-plan-ack" ? "plan_confirmation" : "open_reflection";

  return built;
}

function buildArcClarifyInboundFacts(args: {
  scenario: SmsReviewScenario;
  persona: ReturnType<typeof getPersona>;
  commitment: ActiveV2CommitmentRow;
  checkQ: string;
  userReply: string;
  lines: string[];
  memoryPacket: SlimSmsRelationshipMemoryPacketForFacts;
}): InboundV3RelationshipFacts {
  const { scenario, persona, commitment, checkQ, userReply, lines, memoryPacket } = args;
  const id = scenario.id;

  const tentativeOutcome =
    id === "arc-clarify-tentative-outcome-not-scored" ? ("user_yes" as const) : ("user_yes" as const);

  const arcClarificationFacts = {
    ambiguous_short_reply: true,
    tentative_outcome: tentativeOutcome,
    clarification_reason:
      id === "arc-clarify-legacy-preview-non-speakable"
        ? "ambiguous_short_stale_prompt"
        : "ambiguous_short_reply",
    context_age: {
      accountability_prompt_age_minutes: 180,
      accountability_prompt_sent_at: "2026-06-04T13:00:00.000Z",
      latest_outcome_at: null,
    },
    latest_question: checkQ,
    legacy_clarification_text_preview:
      id === "arc-clarify-legacy-preview-non-speakable"
        ? ARC_LEGACY_PREVIEW_STUB
        : "LEGACY_ARC_PREVIEW",
  };

  const mp = { ...memoryPacket };
  const thread72h: RecentExactThread72hResult = {
    messages: [
      {
        at: "2026-06-04T13:00:00.000Z",
        at_local: "Jun 4, 8:00 AM",
        at_local_timezone: scenario.timezone,
        local_day_key: SIM_DAY_KEY,
        role: "coach",
        body: checkQ,
        message_kind: null,
        source_table: "sms_outbound_messages",
        message_sid: "SM_sim_arc_coach",
        delivery_status: "sent",
        is_exact_body: true,
      },
      {
        at: "2026-06-04T13:05:00.000Z",
        at_local: "Jun 4, 8:05 AM",
        at_local_timezone: scenario.timezone,
        local_day_key: SIM_DAY_KEY,
        role: "user",
        body: userReply,
        message_kind: null,
        source_table: "sms_inbound_messages",
        message_sid: "SM_sim_arc_user",
        delivery_status: "sent",
        is_exact_body: true,
      },
    ],
    window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
    message_count: 2,
    had_preview_messages: false,
    had_system_no_send: false,
  };
  mp.recent_exact_thread_72h = thread72h;
  mp.recent_exact_thread_text = lines.join("\n");
  mp.last_outbound_full_body = checkQ;
  mp.last_5_coach_questions = [checkQ];

  const built = buildInboundV3RelationshipFacts({
    clerkUserId: persona.clerkUserId,
    preferredName: persona.preferredName,
    timezone: scenario.timezone,
    localTimeIso: SIM_LOCAL_ISO,
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    userMessageRaw: userReply,
    coalescedInboundText: userReply,
    suppressedMessageSids: ["sim_SM001"],
    transcriptLines: lines,
    northStarPacket: {
      source: "sms_review_place",
      latestOutboundBody: checkQ,
      latestOpenQuestion: checkQ,
      expectedReplySemantics: "completion_check",
      proofSignal: false,
      missSignal: false,
      blockerSignal: false,
      todayCompleted: false,
    },
    gatedDecision: {
      mode: "use_deterministic",
      final_event_type: tentativeOutcome,
      decision_reason: "sms_review_place_arc_fixture",
      confidence_used: null,
      should_write_outcome_event: true,
      should_open_blocker_capture: false,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    },
    deterministicEventType: tentativeOutcome,
    doNotRepeatHints: [],
    relationshipProfileSummary: persona.identityLabel,
    conversationBrain: { enabled: false },
    centralBrain: { shadow_stored: false },
    arc: { ambiguous_short_reply: true, clarification_required: true },
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
    relationshipMemoryPacket: mp,
    routePurpose: "arc_clarify_ambiguous_short",
    branchMigratedToLane: true,
    branchName: "arc_ambiguous_short_clarify",
    arcClarificationFacts,
  });

  built.inbound_meaning = {
    ...built.inbound_meaning,
    relationship_meaning: "uncertain",
    persistence_decision: "no_outcome_write",
    sms_response_intent: "clarify_gently",
  };
  built.thread.expected_reply_semantics = "completion_check";

  return built;
}

function buildCentralPivotInboundFacts(args: {
  scenario: SmsReviewScenario;
  persona: ReturnType<typeof getPersona>;
  commitment: ActiveV2CommitmentRow;
  checkQ: string;
  userReply: string;
  lines: string[];
  memoryPacket: SlimSmsRelationshipMemoryPacketForFacts;
}): InboundV3RelationshipFacts {
  const { scenario, persona, commitment, checkQ, userReply, lines, memoryPacket } = args;
  const id = scenario.id;

  const centralTurnPurpose =
    id === "central-pivot-meta-confusion"
      ? "meta_question_or_confusion"
      : id === "central-pivot-advice-request"
        ? "advice_or_coaching_request"
        : "human_conversation";

  const suggestedMove =
    id === "central-pivot-meta-confusion"
      ? "clarify_intent"
      : id === "central-pivot-advice-request"
        ? "reinforce_plan_without_proof"
        : "close_loop_no_new_action";

  const centralBrainPivotFacts = {
    blocked_outcome_scoring: true,
    central_turn_purpose: centralTurnPurpose,
    confidence: 0.9,
    reason: "central_brain_human_or_meta",
    suggested_move: suggestedMove,
    legacy_tether_text_preview:
      id === "central-pivot-legacy-tether-non-speakable"
        ? CENTRAL_PIVOT_LEGACY_TETHER_PREVIEW_STUB
        : "LEGACY_TETHER_PREVIEW",
  };

  const mp = { ...memoryPacket };
  const thread72h: RecentExactThread72hResult = {
    messages: [
      {
        at: "2026-06-04T13:00:00.000Z",
        at_local: "Jun 4, 8:00 AM",
        at_local_timezone: scenario.timezone,
        local_day_key: SIM_DAY_KEY,
        role: "coach",
        body: checkQ,
        message_kind: null,
        source_table: "sms_outbound_messages",
        message_sid: "SM_sim_pivot_coach",
        delivery_status: "sent",
        is_exact_body: true,
      },
      {
        at: "2026-06-04T13:05:00.000Z",
        at_local: "Jun 4, 8:05 AM",
        at_local_timezone: scenario.timezone,
        local_day_key: SIM_DAY_KEY,
        role: "user",
        body: userReply,
        message_kind: null,
        source_table: "sms_inbound_messages",
        message_sid: "SM_sim_pivot_user",
        delivery_status: "sent",
        is_exact_body: true,
      },
    ],
    window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
    message_count: 2,
    had_preview_messages: false,
    had_system_no_send: false,
  };
  mp.recent_exact_thread_72h = thread72h;
  mp.recent_exact_thread_text = lines.join("\n");
  mp.last_outbound_full_body = checkQ;
  mp.last_5_coach_questions = [checkQ];

  const built = buildInboundV3RelationshipFacts({
    clerkUserId: persona.clerkUserId,
    preferredName: persona.preferredName,
    timezone: scenario.timezone,
    localTimeIso: SIM_LOCAL_ISO,
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    userMessageRaw: userReply,
    coalescedInboundText: userReply,
    suppressedMessageSids: ["sim_SM001"],
    transcriptLines: lines,
    northStarPacket: {
      source: "sms_review_place",
      latestOutboundBody: checkQ,
      latestOpenQuestion: checkQ,
      expectedReplySemantics: "completion_check",
      proofSignal: false,
      missSignal: false,
      blockerSignal: false,
      todayCompleted: false,
    },
    gatedDecision: {
      mode: "use_deterministic",
      final_event_type: "user_yes",
      decision_reason: "sms_review_place_central_pivot_fixture",
      confidence_used: null,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    },
    deterministicEventType: "user_yes",
    doNotRepeatHints: [],
    relationshipProfileSummary: persona.identityLabel,
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
    relationshipMemoryPacket: mp,
    routePurpose: "central_brain_pivot",
    branchMigratedToLane: true,
    branchName: "central_brain_outcome_blocking_pivot",
    centralBrainPivotFacts,
  });

  built.inbound_meaning = {
    ...built.inbound_meaning,
    relationship_meaning: "uncertain",
    persistence_decision: "no_outcome_write",
    sms_response_intent: "clarify_gently",
  };
  built.v2_accountability = {
    ...built.v2_accountability,
    should_write_outcome_event: false,
  };
  built.thread.expected_reply_semantics = "completion_check";

  return built;
}

function buildConversationBrainFallbackInboundFacts(args: {
  scenario: SmsReviewScenario;
  persona: ReturnType<typeof getPersona>;
  commitment: ActiveV2CommitmentRow;
  checkQ: string;
  userReply: string;
  lines: string[];
  memoryPacket: SlimSmsRelationshipMemoryPacketForFacts;
}): InboundV3RelationshipFacts {
  const { scenario, persona, commitment, checkQ, userReply, lines, memoryPacket } = args;
  const id = scenario.id;

  const isMiss = id === "legacy-fallback-miss-safe";
  const isPreview = id === "legacy-fallback-template-preview-non-speakable";
  const isTuSuppress = id === "legacy-fallback-tu-suppresses-fallback";
  const gatedEventType = isMiss ? "user_no" : "user_yes";
  const classifierResult = isMiss ? "user_no" : "user_yes";

  const conversationBrainFallbackFacts = buildConversationBrainFallbackFacts({
    legacyFallbackReason: "conversation_brain_legacy_fallback_disabled",
    deterministicTemplateBody: isPreview
      ? LEGACY_FALLBACK_TEMPLATE_PREVIEW_STUB
      : "LEGACY_DETERMINISTIC_TEMPLATE_PREVIEW",
    classifierResult,
    gatedEventType,
    shouldWriteOutcomeEvent: !isTuSuppress,
    gatedMode: "use_deterministic",
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    inboundMessageSid: "sim_SM_legacy_fb",
  });

  const mp = { ...memoryPacket };
  mp.last_outbound_full_body = checkQ;
  mp.last_5_coach_questions = [checkQ];

  const tuSuppress =
    isTuSuppress
      ? {
          reconciled_relationship_meaning: "direct_answer" as const,
          reconciled_response_intent: "acknowledge_prior_ask_satisfied" as const,
          reconciled_persistence_decision: "no_outcome_write" as const,
          reconciled_do_not_repeat_asks: [checkQ],
          last_ask_satisfied: "yes" as const,
          satisfaction_kind: "already_scheduled" as const,
          stale_ask_risk: true,
          confidence: 0.9,
          disagreement_flags: [] as string[],
          interpreter_failed_reason: null,
          stale_ask_avoided: true,
          persistence_note: "legacy fallback TU suppress fixture",
          proposal: null,
        }
      : undefined;

  const built = buildInboundV3RelationshipFacts({
    clerkUserId: persona.clerkUserId,
    preferredName: persona.preferredName,
    timezone: scenario.timezone,
    localTimeIso: SIM_LOCAL_ISO,
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    userMessageRaw: userReply,
    coalescedInboundText: userReply,
    suppressedMessageSids: ["sim_SM001"],
    transcriptLines: lines,
    northStarPacket: {
      source: "sms_review_place",
      latestOutboundBody: checkQ,
      latestOpenQuestion: checkQ,
      expectedReplySemantics: "completion_check",
      proofSignal: false,
      missSignal: isMiss,
      blockerSignal: false,
      todayCompleted: !isMiss && !isTuSuppress,
    },
    gatedDecision: {
      mode: "use_deterministic",
      final_event_type: gatedEventType,
      decision_reason: "sms_review_place_legacy_fallback_fixture",
      confidence_used: null,
      should_write_outcome_event: !isTuSuppress,
      should_open_blocker_capture: isMiss,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    },
    deterministicEventType: classifierResult,
    doNotRepeatHints: [],
    relationshipProfileSummary: persona.identityLabel,
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
    relationshipMemoryPacket: mp,
    routePurpose: "conversation_brain_unavailable",
    branchName: "conversation_brain_legacy_disabled_lane",
    branchMigratedToLane: true,
    conversationBrainFallbackFacts,
    turnUnderstandingReconciled: tuSuppress,
  });

  if (isMiss) {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "miss",
      persistence_decision: "write_user_no",
      sms_response_intent: "tell_truth_and_recover",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_no",
      deterministic_classifier_event: "user_no",
      miss_signal: true,
      today_completed: false,
      should_write_outcome_event: true,
    };
  } else if (isPreview) {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "reported_completion",
      persistence_decision: "write_user_yes_today",
      sms_response_intent: "acknowledge_completion_and_next_step",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_yes",
      deterministic_classifier_event: "user_yes",
      today_completed: true,
      should_write_outcome_event: true,
    };
  } else if (isTuSuppress) {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "reported_completion",
      persistence_decision: "no_outcome_write",
      sms_response_intent: "acknowledge_completion_and_next_step",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_yes",
      deterministic_classifier_event: "user_yes",
      today_completed: true,
      should_write_outcome_event: false,
    };
  } else {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "reported_completion",
      persistence_decision: "write_user_yes_today",
      sms_response_intent: "acknowledge_completion_and_next_step",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_yes",
      deterministic_classifier_event: "user_yes",
      today_completed: true,
      should_write_outcome_event: true,
    };
  }

  built.thread.expected_reply_semantics = "completion_check";
  return built;
}

export function buildDailyFacts(scenario: SmsReviewScenario): DailyV3RelationshipFacts {
  const persona = getPersona(scenario.personaId);
  const temporal = buildTemporalForScenario(scenario);
  const transcript = scenario.transcriptLines?.join("\n") ?? scenario.threadSummary;

  const lastCoachQ =
    scenario.id === "repeated-question-risk"
      ? "Did the two hours happen today?"
      : scenario.transcriptLines?.[0]?.replace(/^Coach:\s*/i, "") ?? null;

  const facts: DailyV3RelationshipFacts = {
    route_kind: "main_active_accountability",
    accountability_day_key: SIM_DAY_KEY,
    temporal_contract: temporal,
    user: {
      clerk_user_id: persona.clerkUserId,
      preferred_name: persona.preferredName,
      timezone: scenario.timezone,
      local_time_iso: SIM_LOCAL_ISO,
      relationship_profile_summary: persona.identityLabel,
    },
    commitment: {
      id: `sim_cmt_${scenario.id}`,
      title: scenario.goalTitle,
      behavior_statement: scenario.behaviorStatement,
      effective_ask: scenario.effectiveAsk,
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: scenario.transcriptLines?.[0] ?? "Coach: Quick check",
      latest_inbound_sms: scenario.transcriptLines?.[1]?.replace(/^User:\s*/i, "") ?? null,
      recent_transcript_or_context_block: transcript,
      latest_open_question: lastCoachQ,
      do_not_repeat_hints: scenario.id === "repeated-question-risk" ? ["do_not_reask_coach_question"] : [],
      coaching_memory_snippet: `COACHING_MEMORY (fixture): ${scenario.memorySummary}`,
      recent_pattern_hints: null,
      recent_exact_thread_72h: emptyThread72h(),
      relationship_memory_7d: emptyMemory7d(),
      relationship_memory_30d: emptyMemory30d(),
      last_5_coach_questions: lastCoachQ ? [lastCoachQ] : [],
      last_5_user_answers: [],
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: scenario.id === "repeated-miss-no-shame" ? "user_no" : "user_yes",
      yes_streak_14d: scenario.id === "warm-praise-overuse" ? 6 : 2,
      no_count_14d: scenario.id === "repeated-miss-no-shame" ? 4 : 1,
      partial_count_14d: 0,
      blocker_preview: scenario.id === "blocker-heavy" ? "childcare" : null,
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
  };

  if (scenario.id === "plan-not-proof") {
    facts.accountability.pending_plan_proof = {
      active: true,
      plan_summary_hint: "workout after Brooke",
      anchor_phrase_hint: "after Brooke's workout",
      anchor_key: "brooke|workout",
      plan_for_day_key: "2026-06-03",
      source_answer_preview: "I'll do it after Brooke's workout",
      recurrence_confidence: "unknown",
      outcome_known: false,
    };
    facts.suggested_coaching_move = "close_prior_plan_loop";
  }

  if (scenario.id === "repeated-miss-no-shame") {
    facts.accountability.daily_purpose = "standard_accountability_check";
    facts.accountability.prior_outcome = "user_no";
  }

  if (scenario.id === "time-ref-yesterday") {
    const thread72h: RecentExactThread72hResult = {
      messages: [
        {
          at: "2026-06-04T12:00:00.000Z",
          at_local: "Jun 4, 8:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: SIM_DAY_KEY,
          role: "coach",
          body: "Quick check on the block",
          message_kind: null,
          source_table: "sms_outbound_messages",
          message_sid: "SM_sim_coach",
          delivery_status: "sent",
          is_exact_body: true,
        },
        {
          at: "2026-06-03T15:00:00.000Z",
          at_local: "Jun 3, 11:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: "2026-06-03",
          role: "user",
          body: "Yes — got the two hours in yesterday.",
          message_kind: null,
          source_table: "sms_inbound_messages",
          message_sid: "SM_sim_yesterday",
          delivery_status: "sent",
          is_exact_body: true,
        },
        {
          at: "2026-06-04T13:30:00.000Z",
          at_local: "Jun 4, 9:30 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: SIM_DAY_KEY,
          role: "user",
          body: "I did it yesterday",
          message_kind: null,
          source_table: "sms_inbound_messages",
          message_sid: "SM_sim_today",
          delivery_status: "sent",
          is_exact_body: true,
        },
      ],
      window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
      message_count: 3,
      had_preview_messages: false,
      had_system_no_send: false,
    };
    facts.thread_memory.recent_exact_thread_72h = thread72h;
    facts.thread_memory.recent_exact_thread_text =
      "User: Yes — got the two hours in yesterday.\nUser: I did it yesterday";
    facts.thread_memory.latest_inbound_sms = "I did it yesterday";
    facts.thread_memory.relationship_memory_7d = {
      ...emptyMemory7d(),
      outcome_counts: { yes: 2, no: 0, partial: 0, blockers: 0, checks_sent: 1 },
      wins: [
        {
          summary: "user_yes",
          evidence: "two hours deep work yesterday",
          at: "2026-06-03T15:00:00.000Z",
          local_day_key: "2026-06-03",
          source: "v2_commitment_event:user_yes",
          message_sid: null,
          is_exact_body: false,
        },
      ],
      meta: { item_count: 1, sources_used: ["sms_review_place_fixture"] },
    };
    return enrichDailyFactsWithThreadFreshness(facts);
  }

  return facts;
}

function applyStrategyCardScenarioPatches(
  scenario: SmsReviewScenario,
  built: InboundV3RelationshipFacts,
  userReply: string
): InboundV3RelationshipFacts {
  if (!isStrategyCardScenario(scenario)) return built;

  if (scenario.id === "strategy-card-single-miss") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "miss",
      persistence_decision: "write_user_no",
      sms_response_intent: "tell_truth_and_recover",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_no",
      deterministic_classifier_event: "user_no",
      miss_signal: true,
      blocker_signal: false,
      today_completed: false,
    };
    built.miss_adjustment_policy = {
      adjustment_proposal_allowed_by_evidence: false,
      single_miss_recovery_required: true,
      adjustment_evidence_reason: "not_allowed_single_miss",
    };
    return built;
  }

  if (scenario.id === "strategy-card-plan-ack-good") {
    const inboundMeaning = {
      classifier_event_type: "user_yes" as const,
      relationship_meaning: "answer_to_prior_question" as const,
      response_intent: "answer_to_prior_question" as const,
      persistence_decision: "no_outcome_write" as const,
      do_not_repeat_asks: [] as string[],
      stale_ask_risk: false,
      confidence: "high" as const,
      persistence_note: "short_answer_no_outcome_proof:short_affirm_plan_confirmation",
      sms_response_intent: "answer_prior_question" as const,
      temporal_scope: "today" as const,
      evidence: ["short_answer_plan_confirmation", "short_affirm_plan_confirmation"],
      disqualifiers: [] as string[],
      spoken_local_day_key: SIM_DAY_KEY,
      reported_for_day_key: null,
      user_timezone: scenario.timezone,
    };
    built.turn_understanding = undefined;
    built.inbound_meaning = { ...built.inbound_meaning, ...inboundMeaning } as InboundMeaningFacts;
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: null,
      deterministic_classifier_event: "user_yes",
      miss_signal: false,
      today_completed: false,
    };
    built.miss_adjustment_policy = {
      adjustment_proposal_allowed_by_evidence: true,
      single_miss_recovery_required: false,
      adjustment_evidence_reason: "not_a_miss_turn",
    };
    built.thread = {
      ...built.thread,
      coalesced_inbound_text: userReply,
      latest_inbound_raw: userReply,
      latest_outbound_coach_sms: PLAN_CONFIRMATION_Q,
      latest_open_question: PLAN_CONFIRMATION_Q,
      expected_reply_semantics: "proposal_yes_no",
      current_inbound_is_short_acknowledgement: true,
      memory_packet: {
        ...(built.thread.memory_packet ?? minimalMemoryPacket()),
        recent_exact_thread_text: `Coach: ${PLAN_CONFIRMATION_Q}\nUser: ${userReply}`,
        recent_exact_message_count: 2,
        last_outbound_full_body: PLAN_CONFIRMATION_Q,
        last_inbound_full_body: userReply,
        last_substantive_coach_message: PLAN_CONFIRMATION_Q,
        last_5_coach_questions: [PLAN_CONFIRMATION_Q],
        latest_open_question: PLAN_CONFIRMATION_Q,
        open_question_pending: true,
        open_question_source: "projection",
      },
    };
    return built;
  }

  if (scenario.id === "strategy-card-completion") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "reported_completion",
      persistence_decision: "write_user_yes_today",
      sms_response_intent: "acknowledge_completion_and_next_step",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_yes",
      deterministic_classifier_event: "user_yes",
      miss_signal: false,
      proof_signal: false,
      today_completed: true,
    };
    built.miss_adjustment_policy = {
      adjustment_proposal_allowed_by_evidence: true,
      single_miss_recovery_required: false,
      adjustment_evidence_reason: "not_a_miss_turn",
    };
    return built;
  }

  if (scenario.id === "strategy-card-partial") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "partial_attempt",
      persistence_decision: "write_user_partial",
      sms_response_intent: "identify_blocker_or_next_move",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_partial",
      deterministic_classifier_event: "user_partial",
      miss_signal: false,
      today_completed: false,
    };
    built.miss_adjustment_policy = {
      adjustment_proposal_allowed_by_evidence: true,
      single_miss_recovery_required: false,
      adjustment_evidence_reason: "not_a_miss_turn",
    };
    return built;
  }

  if (scenario.id === "strategy-card-blocker-known") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "miss",
      persistence_decision: "write_user_no",
      sms_response_intent: "tell_truth_and_recover",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_no",
      deterministic_classifier_event: "user_no",
      miss_signal: true,
      blocker_signal: true,
      today_completed: false,
    };
    return built;
  }

  if (scenario.id === "strategy-card-satisfied-ask") {
    const memory7d = {
      ...emptyMemory7d(),
      direct_answer_history: [
        {
          coach_question: SATISFIED_ASK_Q,
          user_answer: "Already did that yesterday",
          answer_type: "direct_answer",
          at: "2026-06-03T12:00:00.000Z",
          source: "v2_commitment_sms_thread_memory",
          message_sid: null,
        },
      ],
      meta: { item_count: 1, sources_used: ["sms_review_place_fixture"] },
    };
    built.thread = {
      ...built.thread,
      coalesced_inbound_text: userReply,
      latest_inbound_raw: userReply,
      latest_outbound_coach_sms: SATISFIED_ASK_Q,
      latest_open_question: SATISFIED_ASK_Q,
      memory_packet: {
        ...(built.thread.memory_packet ?? minimalMemoryPacket()),
        recent_exact_thread_text: `Coach: ${SATISFIED_ASK_Q}\nUser: Already did that yesterday\nUser: ${userReply}`,
        recent_exact_message_count: 3,
        last_5_coach_questions: [SATISFIED_ASK_Q],
        latest_open_question: SATISFIED_ASK_Q,
        relationship_memory_7d: memory7d,
      },
    };
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "miss",
      persistence_decision: "write_user_no",
      sms_response_intent: "tell_truth_and_recover",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_no",
      deterministic_classifier_event: "user_no",
      miss_signal: true,
      today_completed: false,
    };
    return built;
  }

  if (scenario.id === "strategy-card-proof-forbidden") {
    built.inbound_meaning = {
      ...built.inbound_meaning,
      relationship_meaning: "reported_completion",
      persistence_decision: "write_user_yes_today",
      sms_response_intent: "acknowledge_completion_and_next_step",
    };
    built.v2_accountability = {
      ...built.v2_accountability,
      final_event_type: "user_yes",
      deterministic_classifier_event: "user_yes",
      proof_signal: false,
      today_completed: true,
      proof_callout_hint: null,
    };
    return built;
  }

  return built;
}

export function buildInboundFacts(
  scenario: SmsReviewScenario,
  userReply: string
): InboundV3RelationshipFacts {
  const persona = getPersona(scenario.personaId);
  const commitment = baseCommitment(scenario);
  const event = inboundEventForScenario(scenario);
  const lines = scenario.transcriptLines ?? [`Coach: Quick check`, `User: ${userReply}`];

  const openQ = lines[0]?.replace(/^Coach:\s*/i, "") ?? "Quick check";
  const mp = minimalMemoryPacket({
    recent_exact_thread_text: lines.join("\n"),
    recent_exact_message_count: lines.length,
    last_5_coach_questions: [openQ],
    latest_open_question: openQ,
    latest_answer_after_open_question:
      scenario.id === "open-question-answered" ? "After Brooke's workout" : null,
    open_question_pending: scenario.id !== "open-question-answered",
    open_question_source: "projection",
    answer_source: scenario.id === "open-question-answered" ? "projection" : "none",
    projection_used: scenario.id === "open-question-answered",
  });

  const built = buildInboundV3RelationshipFacts({
    clerkUserId: persona.clerkUserId,
    preferredName: persona.preferredName,
    timezone: scenario.timezone,
    localTimeIso: SIM_LOCAL_ISO,
    commitment,
    effectiveAsk: scenario.effectiveAsk,
    userMessageRaw: userReply,
    coalescedInboundText: userReply,
    suppressedMessageSids: ["sim_SM001"],
    transcriptLines: lines,
    northStarPacket: {
      source: "sms_review_place",
      latestOutboundBody: openQ,
      latestOpenQuestion: openQ,
      expectedReplySemantics: "completion_check",
      proofSignal: scenario.id.startsWith("proof-victory"),
      missSignal: event === "user_no",
      blockerSignal: scenario.id === "blocker-heavy",
      todayCompleted: event === "user_yes",
    },
    gatedDecision: baseGatedDecision(event),
    deterministicEventType: event,
    doNotRepeatHints: [],
    relationshipProfileSummary: persona.identityLabel,
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
    relationshipMemoryPacket: mp,
    proofCalloutHint: proofHintForScenario(scenario),
  });

  if (OPEN_QUESTION_SCENARIO_IDS.has(scenario.id)) {
    return buildOpenQuestionAnswerInboundFacts({
      scenario,
      persona,
      commitment,
      openQ,
      userReply,
      lines,
      memoryPacket: mp,
    });
  }

  if (ARC_CLARIFY_SCENARIO_IDS.has(scenario.id)) {
    return buildArcClarifyInboundFacts({
      scenario,
      persona,
      commitment,
      checkQ: openQ,
      userReply,
      lines,
      memoryPacket: mp,
    });
  }

  if (CENTRAL_PIVOT_SCENARIO_IDS.has(scenario.id)) {
    return buildCentralPivotInboundFacts({
      scenario,
      persona,
      commitment,
      checkQ: openQ,
      userReply,
      lines,
      memoryPacket: mp,
    });
  }

  if (LEGACY_FALLBACK_SCENARIO_IDS.has(scenario.id)) {
    return buildConversationBrainFallbackInboundFacts({
      scenario,
      persona,
      commitment,
      checkQ: openQ,
      userReply,
      lines,
      memoryPacket: mp,
    });
  }

  if (scenario.id === "time-ref-yesterday") {
    const thread72h: RecentExactThread72hResult = {
      messages: [
        {
          at: "2026-06-03T15:00:00.000Z",
          at_local: "Jun 3, 11:00 AM",
          at_local_timezone: scenario.timezone,
          local_day_key: "2026-06-03",
          role: "user",
          body: "Yes — got the two hours in yesterday.",
          message_kind: null,
          source_table: "sms_inbound_messages",
          message_sid: "SM_sim_yesterday_in",
          delivery_status: "sent",
          is_exact_body: true,
        },
      ],
      window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
      message_count: 1,
      had_preview_messages: false,
      had_system_no_send: false,
    };
    const memoryPacketBase = built.thread.memory_packet ?? minimalMemoryPacket();
    built.thread.memory_packet = {
      ...memoryPacketBase,
      recent_exact_thread_72h: thread72h,
      recent_exact_thread_text: "User: Yes — got the two hours in yesterday.",
      relationship_memory_7d: {
        ...emptyMemory7d(),
        wins: [
          {
            summary: "user_yes",
            evidence: "two hours yesterday",
            at: "2026-06-03T15:00:00.000Z",
            local_day_key: "2026-06-03",
            source: "v2_commitment_event:user_yes",
            message_sid: null,
            is_exact_body: false,
          },
        ],
        meta: { item_count: 1, sources_used: ["sms_review_place_fixture"] },
      },
      relationship_memory_30d: memoryPacketBase.relationship_memory_30d,
    };
    built.temporal_contract = buildTemporalForScenario(scenario);
  }

  return applyStrategyCardScenarioPatches(scenario, built, userReply);
}

/** Minimal in-memory thread advance for future multi-day (unused in Sim-1 v1). */
export function advanceThreadForStep(
  lines: string[],
  step: { coachLine?: string; userLine?: string }
): string[] {
  const next = [...lines];
  if (step.coachLine) next.push(`Coach: ${step.coachLine}`);
  if (step.userLine) next.push(`User: ${step.userLine}`);
  return next;
}

export function simulatedLocalIso(): string {
  return SIM_LOCAL_ISO;
}

export function simulatedDayKey(): string {
  return SIM_DAY_KEY;
}
