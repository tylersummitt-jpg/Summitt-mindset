/**
 * Phase 4.1/4.3/4.4a/4.5/4.7a/4.7b/4.7c-A/4.7c-B/4.8a — Coaching Strategy Card v1 (inbound + daily + weekly).
 * Server-built coaching move envelope; writer-facing after validation/repair.
 * Does not route, mutate state, send SMS, or replace Relationship Snapshot.
 */

import type { MissAdjustmentPolicyResult } from "@/lib/inbound-miss-adjustment-policy";
import {
  inboundUserRequestedGoalAdjustment,
  isMissRecoveryTurn,
} from "@/lib/inbound-miss-adjustment-policy";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import type { ProofAndPraisePermissionV2Data } from "@/lib/sms-proof-praise-permission-v2";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { NoSendAndSilenceHistoryV2Data } from "@/lib/sms-no-send-and-silence-history-v2";
import type { ActivePendingState } from "@/lib/sms-active-pending-state";
import {
  isPlanAckFromShortAnswerContext,
  resolveShortAnswerContextAuthority,
} from "@/lib/inbound-short-answer-context";
import type {
  InboundV3ArcClarificationFacts,
  InboundV3CentralBrainPivotFacts,
  InboundV3OpenQuestionFacts,
  InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";
import { createHash } from "crypto";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { DailyProofCalibration, DailyProofPraiseAllowedLevel } from "@/lib/sms-daily-proof-calibration";
import {
  buildRelationshipAnchors,
  detectRecentlyUsedRelationshipAnchorKeys,
  relationshipAnchorAvoidRepeatingFingerprints,
  applyRelationshipAnchorStrategyBoundaries,
} from "@/lib/sms-relationship-anchors";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import {
  ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO,
  CONTRACT_BAR_SPECIFIC_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO,
  DAILY_TODAY_NOT_RENEWAL_MUST_NOT_DO,
  INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  PENDING_CANDIDATE_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO,
  REACTIVATION_SPECIFIC_STEP_NOT_RENEWAL_MUST_NOT_DO,
  REFRESH_FIT_CHECK_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO,
  WEEKLY_NO_YES_NO_RESET_MUST_NOT_DO,
} from "@/lib/sms-generic-future-recommitment-question-family";
import type { DailySemanticContractProposalFactsPacket } from "@/lib/v3-daily-contract-proposal-semantic";
import {
  buildDailyTemporalAwarenessPromptGuidance,
  dailyC1CanImplyTodayMissed,
  dailyC1IsCurrentDayMiss,
} from "@/lib/sms-daily-temporal-awareness";

export const STRATEGY_CARD_V1_VERSION = "1.0" as const;

export type StrategyCardSurface = "inbound" | "daily" | "weekly";
export type StrategyCardRouteKind =
  | "normal_inbound_reply"
  | "open_question_answer"
  | "arc_clarify_ambiguous_short"
  | "central_brain_pivot"
  | "main_active_accountability"
  | "low_pressure_reactivation"
  | "contract_prompt"
  | "refresh_identity"
  | "refresh_commitment"
  | "pending_resolution"
  | "weekly_proof_v2";

export type WeeklyProofStrategyCardRouteKind = "weekly_proof_v2";

export type DailyC1StrategyCardRouteKind =
  | "main_active_accountability"
  | "low_pressure_reactivation";

export type DailyC2StrategyCardRouteKind = "contract_prompt";

export type DailyC3RefreshStrategyCardRouteKind = "refresh_identity" | "refresh_commitment";

export type DailyC3PendingResolutionStrategyCardRouteKind = "pending_resolution";

export type DailyRefreshStepSummary = "identity" | "commitment";

export type DailyContractProposalKind = "shrink_ask" | "recommit_same";

export type StrategyCardOutcome = "completed" | "missed" | "partial" | "none" | "unclear";

export type StrategyCardMoveType =
  | "ask_blocker"
  | "ack_completion"
  | "ack_partial"
  | "recover_today"
  | "clarify"
  | "close_loop"
  | "protect_existing_plan"
  | "propose_adjustment"
  | "evaluate_commitment"
  | "raise_standard"
  | "reactivate_gently"
  | "daily_check_in"
  | "contract_proposal"
  | "refresh_identity"
  | "refresh_commitment"
  | "pending_resolution_reminder"
  | "weekly_reflect"
  | "weekly_recover"
  | "weekly_celebrate_earned"
  | "weekly_low_pressure"
  | "handoff"
  | "other";

export type StrategyCardTonePosture =
  | "direct"
  | "warm_direct"
  | "gentle_reentry"
  | "celebrate_earned"
  | "low_pressure"
  | "clarifying"
  | "contract_precise";

export type StrategyCardV1 = {
  version: typeof STRATEGY_CARD_V1_VERSION;
  generated_at: string;
  surface: StrategyCardSurface;
  route_kind: StrategyCardRouteKind;
  turn_kind: string;
  server_truth_summary: {
    outcome: StrategyCardOutcome;
    explicit_user_truth: boolean;
    persistence_decision?: string | null;
    active_pending_kinds: string[];
    answered_last_question?: boolean | null;
    satisfied_ask_fingerprints: string[];
    open_question_answer_kind?: string | null;
    open_question_satisfied?: boolean | null;
    arc_tentative_outcome?: string | null;
    arc_clarification_reason?: string | null;
    arc_context_age?: string | null;
    central_turn_purpose?: string | null;
    central_pivot_blocked_outcome_scoring?: boolean | null;
    central_pivot_should_answer_without_scoring?: boolean | null;
    central_pivot_suggested_move?: string | null;
    daily_route_kind?: string | null;
    daily_server_strategy?: string | null;
    daily_purpose?: string | null;
    daily_prior_outcome?: StrategyCardOutcome | null;
    daily_pending_plan_proof_active?: boolean;
    daily_reactivation?: boolean;
    daily_silence_tier?: string | null;
    daily_conversation_intent?: DailyC1ConversationIntent | null;
    local_date?: string | null;
    local_weekday?: string | null;
    user_timezone?: string | null;
    is_new_accountability_day?: boolean | null;
    daily_high_repeat_risk?: boolean;
    daily_zero_question_required?: boolean;
    daily_zero_question_reason?: string | null;
    daily_contract_proposal_kind?: DailyContractProposalKind | null;
    daily_contract_proposal_pending_before_sms?: boolean;
    daily_contract_must_not_claim_goal_updated?: boolean;
    daily_contract_required_bar_fingerprint?: string | null;
    daily_contract_required_meaning?: string | null;
    daily_refresh_step?: DailyRefreshStepSummary | null;
    daily_refresh_required_anchor_fingerprint?: string | null;
    daily_refresh_required_ask_fingerprint?: string | null;
    daily_refresh_session_written_before_sms?: boolean;
    daily_pending_resolution_kind?: string | null;
    daily_pending_candidate_fingerprint?: string | null;
    daily_pending_state_written_before_sms?: boolean;
    daily_pending_awaiting_user_confirmation?: boolean | null;
    daily_pending_required_candidate_fingerprint?: string | null;
    weekly_completed_count?: number | null;
    weekly_missed_count?: number | null;
    weekly_partial_count?: number | null;
    weekly_silent_week?: boolean | null;
    weekly_rough_week?: boolean | null;
    weekly_strong_week?: boolean | null;
    weekly_has_proof_hints?: boolean | null;
    weekly_can_claim_proof?: boolean | null;
    weekly_can_reference_victory_room?: boolean | null;
    weekly_proof_state_written_before_sms?: boolean;
    daily_proof_wins_7d?: number | null;
    daily_proof_age_days?: number | null;
    daily_praise_allowed_level?: DailyProofPraiseAllowedLevel | null;
    daily_consistency_claim_allowed?: boolean | null;
    daily_fresh_move_required?: boolean | null;
  };
  move: {
    type: StrategyCardMoveType;
    priority: "low" | "normal" | "high";
    confidence: "low" | "medium" | "high";
    reason: string;
  };
  must_do: string[];
  must_not_do: string[];
  allowed_claims: {
    completion: boolean;
    miss: boolean;
    partial: boolean;
    proof: boolean;
    victory_room: boolean;
    state_changed: boolean;
    proposal_active: boolean;
  };
  writer_constraints: {
    max_questions: number;
    avoid_repeating: string[];
    tone_posture: StrategyCardTonePosture;
  };
  meta: {
    generation_source: "server_strategy_card_v1";
    legacy_suggested_coaching_move?: string | null;
    legacy_coaching_move_source?: string | null;
    legacy_hint_used?: boolean;
    legacy_hint_replaced?: boolean;
    legacy_server_strategy?: string | null;
    legacy_next_move_type?: string | null;
    legacy_v2_contract_proposal_kind?: string | null;
  };
};

export type DailyC1StrategyCardBuildContext = {
  facts: DailyV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
};

export type DailyC2StrategyCardBuildContext = {
  facts: DailyV3RelationshipFacts;
  semanticFacts: DailySemanticContractProposalFactsPacket;
  openLoops: OpenLoopsAndDoNotRepeatData;
};

export type DailyC3RefreshStrategyCardBuildContext = {
  facts: DailyV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
};

export type DailyC3PendingResolutionStrategyCardBuildContext = {
  facts: DailyV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
};

export type WeeklyStrategyCardBuildContext = {
  facts: WeeklyV3OutboundFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
};

export type PendingResolutionFactsPacketForPrompt = {
  resolution_kind: string | null;
  sms_state: string | null;
  awaiting_user_confirmation: boolean;
  candidate_behavior_snippet: string | null;
  candidate_fingerprint: string | null;
  required_verbatim_note: string | null;
  must_not_claim_resolved: true;
  must_not_claim_goal_changed: true;
};

export type StrategyCardValidationStatus = "valid" | "repaired";

export type StrategyCardPlanAckSource = "saca" | "tu" | "sms_intent" | "none";

export type StrategyCardBuildContext = {
  facts: InboundV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
  shortAnswerPlanAck?: boolean;
};

export type StrategyCardValidationResult = {
  card: StrategyCardV1;
  validation_status: StrategyCardValidationStatus;
  validation_reasons: string[];
};

const MAX_REASON_CHARS = 200;
const MAX_MUST_DO = 5;
const MAX_MUST_NOT_DO = 8;
const MAX_AVOID_REPEATING = 10;
const MAX_FINGERPRINT_CHARS = 120;

/** Writer-facing must_not_do when a prior internal coach draft preview exists on open-question turns. */
export const OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO =
  "Do not quote, paraphrase, or answer as if a prior internal coach draft preview is new user-facing text.";

/** Writer-facing must_not_do when a prior internal clarification template preview exists on arc turns. */
export const ARC_CLARIFICATION_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO =
  "Do not quote, paraphrase, or reuse a prior internal clarification template preview as new user-facing text.";

/** Writer-facing must_not_do — arc tentative classifier hint is not confirmed server truth. */
export const ARC_TENTATIVE_OUTCOME_NOT_CONFIRMED_MUST_NOT_DO =
  "Do not treat tentative_outcome as confirmed completion, miss, partial, or proof.";

/** Writer-facing must_not_do — central pivot turns are not scored accountability outcomes. */
export const CENTRAL_PIVOT_NO_OUTCOME_SCORING_MUST_NOT_DO =
  "Do not score this turn as today's completion, miss, or partial accountability outcome.";

const CENTRAL_PIVOT_ALLOWED_MOVES: StrategyCardMoveType[] = [
  "close_loop",
  "clarify",
  "protect_existing_plan",
  "recover_today",
  "other",
];

const SINGLE_MISS_FORBIDDEN_MOVES: StrategyCardMoveType[] = [
  "propose_adjustment",
  "evaluate_commitment",
  "raise_standard",
];

const SMS_COPY_RE = /\b(hey|hi|thanks|thank you|great job|you've got this)\b/i;

function hasStrategyCardBlockingBranchFacts(facts: InboundV3RelationshipFacts): boolean {
  if (facts.blocker_facts) return true;
  if (facts.refresh_facts) return true;
  if (facts.pending_resolution_facts) return true;
  if (facts.memory_confirmation_facts) return true;
  if (facts.contract_consent_facts) return true;
  if (facts.adaptive_consent_clarification_facts) return true;
  if (facts.commitment_change_facts) return true;
  if (facts.commitment_change_context_facts) return true;
  if (facts.goal_change_facts) return true;
  if (facts.central_brain_pivot_facts) return true;
  if (facts.central_brain_blocker_pivot_facts) return true;
  if (facts.arc_clarification_facts) return true;
  if (facts.pending_replacement_facts?.pending_resolution_active === true) return true;
  if (facts.identity_edit) return true;
  if (facts.relationship_exit) return true;
  return false;
}

export function isInboundNormalStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  if (facts.route_purpose !== "normal_inbound_reply") return false;
  if (facts.open_question_facts) return false;
  if (hasStrategyCardBlockingBranchFacts(facts)) return false;
  return true;
}

export function isOpenQuestionAnswerStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  if (facts.route_purpose !== "open_question_answer") return false;
  if (!facts.open_question_facts) return false;
  if (hasStrategyCardBlockingBranchFacts(facts)) return false;
  return true;
}

function hasArcClarifyBlockingBranchFacts(facts: InboundV3RelationshipFacts): boolean {
  if (facts.blocker_facts) return true;
  if (facts.refresh_facts) return true;
  if (facts.pending_resolution_facts) return true;
  if (facts.memory_confirmation_facts) return true;
  if (facts.contract_consent_facts) return true;
  if (facts.adaptive_consent_clarification_facts) return true;
  if (facts.commitment_change_facts) return true;
  if (facts.commitment_change_context_facts) return true;
  if (facts.goal_change_facts) return true;
  if (facts.central_brain_pivot_facts) return true;
  if (facts.central_brain_blocker_pivot_facts) return true;
  if (facts.open_question_facts) return true;
  if (facts.conversation_brain_fallback_facts) return true;
  if (facts.pending_replacement_facts?.pending_resolution_active === true) return true;
  if (facts.identity_edit) return true;
  if (facts.relationship_exit) return true;
  return false;
}

export function isArcClarifyStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  if (facts.route_purpose !== "arc_clarify_ambiguous_short") return false;
  if (!facts.arc_clarification_facts) return false;
  if (hasArcClarifyBlockingBranchFacts(facts)) return false;
  return true;
}

function hasCentralPivotBlockingBranchFacts(facts: InboundV3RelationshipFacts): boolean {
  if (facts.blocker_facts) return true;
  if (facts.refresh_facts) return true;
  if (facts.pending_resolution_facts) return true;
  if (facts.memory_confirmation_facts) return true;
  if (facts.contract_consent_facts) return true;
  if (facts.adaptive_consent_clarification_facts) return true;
  if (facts.commitment_change_facts) return true;
  if (facts.commitment_change_context_facts) return true;
  if (facts.central_brain_blocker_pivot_facts) return true;
  if (facts.arc_clarification_facts) return true;
  if (facts.open_question_facts) return true;
  if (facts.conversation_brain_fallback_facts) return true;
  if (facts.pending_replacement_facts?.pending_resolution_active === true) return true;
  if (facts.identity_edit) return true;
  if (facts.relationship_exit) return true;
  return false;
}

export function isCentralPivotStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  if (facts.route_purpose !== "central_brain_pivot") return false;
  if (!facts.central_brain_pivot_facts) return false;
  if (hasCentralPivotBlockingBranchFacts(facts)) return false;
  return true;
}

export function isStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  return (
    isInboundNormalStrategyCardEligible(facts) ||
    isOpenQuestionAnswerStrategyCardEligible(facts) ||
    isArcClarifyStrategyCardEligible(facts) ||
    isCentralPivotStrategyCardEligible(facts)
  );
}

function truncateText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fingerprintAsk(text: string): string {
  return truncateText(text, MAX_FINGERPRINT_CHARS);
}

function deriveOutcome(facts: InboundV3RelationshipFacts): StrategyCardOutcome {
  const meaning = facts.inbound_meaning;
  const ft = facts.v2_accountability.final_event_type;
  if (ft === "user_yes" || meaning?.persistence_decision === "write_user_yes_today") return "completed";
  if (ft === "user_no" || meaning?.persistence_decision === "write_user_no") return "missed";
  if (ft === "user_partial" || meaning?.persistence_decision === "write_user_partial") return "partial";
  const rm = meaning?.relationship_meaning;
  if (rm === "reported_completion") return "completed";
  if (rm === "miss") return "missed";
  if (rm === "partial_attempt") return "partial";
  return "unclear";
}

function isPlanAckTurn(args: {
  facts: InboundV3RelationshipFacts;
  tu: ReconciledTurnUnderstanding | null | undefined;
  shortAnswerPlanAck?: boolean;
}): boolean {
  if (args.shortAnswerPlanAck === true) return true;
  const intent = args.tu?.reconciled_response_intent;
  if (intent === "reinforce_plan_without_proof") return true;
  const smsIntent = args.facts.inbound_meaning?.sms_response_intent;
  return smsIntent === "reinforce_plan_and_choose_first_step";
}

function blockerAlreadyKnown(facts: InboundV3RelationshipFacts): boolean {
  if (facts.v2_accountability.blocker_signal === true) return true;
  const rm = facts.inbound_meaning?.relationship_meaning;
  if (rm === "miss" || rm === "partial_attempt") {
    const raw = facts.thread.coalesced_inbound_text.trim();
    if (raw.length >= 20 && /\b(because|blocked|couldn't|could not|kid|meeting|travel|sick)\b/i.test(raw)) {
      return true;
    }
  }
  const tu = facts.turn_understanding;
  if (tu?.reconciled_response_intent === "identify_blocker" && tu.confidence >= 0.6) {
    const raw = facts.thread.coalesced_inbound_text.trim();
    if (raw.length >= 15) return true;
  }
  return false;
}

function mapLegacyMoveToType(legacy: string | null | undefined): StrategyCardMoveType | null {
  const m = legacy?.trim();
  if (!m) return null;
  if (m === "name_blocker" || m === "narrow_blocker") return "ask_blocker";
  if (m === "acknowledge_completion" || m === "acknowledge_result_and_next_standard") return "ack_completion";
  if (m === "clarify_intent" || m === "clarify_ambiguous_short_natural_sms") return "clarify";
  if (m === "close_loop_no_new_action" || m === "acknowledge_prior_ask_satisfied") return "close_loop";
  if (m === "respond_to_open_question_answer_natural") return "close_loop";
  if (m === "acknowledge_prior_answer_without_reasking") return "close_loop";
  if (m === "next_first_step" || m === "reinforce_plan_without_proof") return "protect_existing_plan";
  if (m === "close_prior_plan_loop") return "protect_existing_plan";
  if (m === "low_pressure_reactivation") return "reactivate_gently";
  if (m === "ask_completion" || m === "hold_standard" || m === "invite_smaller_rep") return "daily_check_in";
  if (m === "respond_commitment_change_context_without_pending_resolution") return "evaluate_commitment";
  if (m === "commitment_change_handoff_respond_with_server_owned_next_steps") return "handoff";
  if (m === "ask_accountability") return "other";
  if (m.includes("adjust") || m.includes("proposal")) return "propose_adjustment";
  return "other";
}

function resolveTonePosture(args: {
  moveType: StrategyCardMoveType;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
  canCelebrate: boolean;
}): StrategyCardTonePosture {
  const hint = args.noSendSilence?.silence_context?.writer_tone_hint?.toLowerCase() ?? "";
  if (hint.includes("gentle re-entry")) return "gentle_reentry";
  if (hint.includes("low-pressure")) return "low_pressure";
  if (args.moveType === "clarify") return "clarifying";
  if (args.moveType === "ack_completion" && args.canCelebrate) return "celebrate_earned";
  if (args.moveType === "ack_completion" || args.moveType === "ack_partial") return "warm_direct";
  return "direct";
}

function collectAvoidRepeating(ctx: StrategyCardBuildContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const f = fingerprintAsk(t);
    const key = f.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    if (s.ask_text?.trim()) push(s.ask_text);
  }
  for (const a of ctx.openLoops.do_not_repeat_asks ?? []) push(a);
  for (const a of ctx.facts.turn_understanding?.reconciled_do_not_repeat_asks ?? []) push(a);
  for (const p of ctx.openLoops.do_not_repeat_phrases ?? []) push(p);
  return out.slice(0, MAX_AVOID_REPEATING);
}

function openQuestionFingerprint(oq: InboundV3OpenQuestionFacts | null | undefined): string | null {
  const q = oq?.latest_open_question?.trim();
  if (!q) return null;
  return fingerprintAsk(q);
}

export function openQuestionOldCoachPreviewText(
  oq: InboundV3OpenQuestionFacts | null | undefined
): string | null {
  const preview = oq?.old_open_question_reply_preview?.trim();
  if (!preview || preview.length < 2) return null;
  return preview;
}

export function openQuestionOldCoachPreviewFingerprint(
  oq: InboundV3OpenQuestionFacts | null | undefined
): string | null {
  const preview = openQuestionOldCoachPreviewText(oq);
  if (!preview) return null;
  return fingerprintAsk(preview);
}

export function arcClarifyLegacyPreviewText(
  arc: InboundV3ArcClarificationFacts | null | undefined
): string | null {
  const preview = arc?.legacy_clarification_text_preview?.trim();
  if (!preview || preview.length < 2) return null;
  return preview;
}

export function arcClarifyLegacyPreviewFingerprint(
  arc: InboundV3ArcClarificationFacts | null | undefined
): string | null {
  const preview = arcClarifyLegacyPreviewText(arc);
  if (!preview) return null;
  return fingerprintAsk(preview);
}

export function centralPivotTetherPreviewText(
  pivot: InboundV3CentralBrainPivotFacts | null | undefined
): string | null {
  const preview = pivot?.legacy_tether_text_preview?.trim();
  if (!preview || preview.length < 2) return null;
  return preview;
}

export function centralPivotTetherPreviewFingerprint(
  pivot: InboundV3CentralBrainPivotFacts | null | undefined
): string | null {
  const preview = centralPivotTetherPreviewText(pivot);
  if (!preview) return null;
  return fingerprintAsk(preview);
}

function centralPivotMoveFromPurpose(
  purpose: string | null | undefined,
  suggestedMove: string | null | undefined
): StrategyCardMoveType {
  const p = (purpose ?? "").trim().toLowerCase();
  if (p === "meta_question_or_confusion") return "clarify";
  if (p === "advice_or_coaching_request") {
    const legacy = mapLegacyMoveToType(suggestedMove);
    if (legacy === "clarify") return "clarify";
    return "protect_existing_plan";
  }
  if (p === "human_conversation" || p === "human_tether") {
    const legacy = mapLegacyMoveToType(suggestedMove);
    if (legacy && CENTRAL_PIVOT_ALLOWED_MOVES.includes(legacy)) return legacy;
    return "close_loop";
  }
  const fromLegacy = mapLegacyMoveToType(suggestedMove);
  if (fromLegacy && CENTRAL_PIVOT_ALLOWED_MOVES.includes(fromLegacy)) return fromLegacy;
  return "close_loop";
}

function collectCentralPivotAvoidRepeating(ctx: StrategyCardBuildContext): string[] {
  const out = collectAvoidRepeating(ctx);
  const previewFp = centralPivotTetherPreviewFingerprint(ctx.facts.central_brain_pivot_facts);
  if (previewFp && !out.some((a) => a.toLowerCase() === previewFp.toLowerCase())) {
    out.push(previewFp);
  }
  return out.slice(0, MAX_AVOID_REPEATING);
}

function buildCentralPivotMustDoMustNotDo(args: {
  moveType: StrategyCardMoveType;
  ctx: StrategyCardBuildContext;
  blockedScoring: boolean;
}): { must_do: string[]; must_not_do: string[] } {
  const must_do: string[] = [];
  const must_not_do = [
    CENTRAL_PIVOT_NO_OUTCOME_SCORING_MUST_NOT_DO,
    "Do not claim completion, miss, partial, proof, or Victory Room.",
    "Do not invent a new goal or claim state changed.",
  ];

  if (centralPivotTetherPreviewText(args.ctx.facts.central_brain_pivot_facts)) {
    must_not_do.push(OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
  }

  if (args.blockedScoring) {
    must_not_do.push(
      "Do not treat this human/meta detour as today's scored accountability outcome."
    );
  }

  switch (args.moveType) {
    case "close_loop":
    case "other":
      must_do.push("Respond humanely and briefly.");
      must_do.push("Keep relationship continuity.");
      must_do.push("Return toward accountability without scoring this turn.");
      must_not_do.push("Do not turn the detour into a new goal or state change.");
      break;
    case "clarify":
      must_do.push("Answer or clarify the confusion naturally.");
      must_do.push("Keep it concise — one question at most if needed.");
      must_not_do.push("Do not treat the confusion as today's accountability outcome.");
      must_not_do.push("Do not pile on unrelated questions.");
      break;
    case "protect_existing_plan":
      must_do.push("Give a concise coaching response anchored to the current commitment.");
      must_do.push("Protect the existing plan unless server truth says otherwise.");
      must_not_do.push("Do not invent a new plan.");
      must_not_do.push("Do not propose adjustment unless server policy explicitly allows it.");
      break;
    case "recover_today":
      must_do.push("Respond humanely while keeping today recoverable when appropriate.");
      break;
  }

  must_not_do.push(ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO);
  must_not_do.push(INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO);

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function arcLatestQuestionFingerprint(
  arc: InboundV3ArcClarificationFacts | null | undefined
): string | null {
  const q = arc?.latest_question?.trim();
  if (!q) return null;
  return fingerprintAsk(q);
}

function formatArcContextAgeSummary(
  age: InboundV3ArcClarificationFacts["context_age"] | null | undefined
): string | null {
  if (!age) return null;
  const parts: string[] = [];
  if (age.accountability_prompt_age_minutes != null) {
    parts.push(`prompt_age_min:${age.accountability_prompt_age_minutes}`);
  }
  if (age.accountability_prompt_sent_at?.trim()) {
    parts.push(`prompt_sent:${age.accountability_prompt_sent_at.trim().slice(0, 24)}`);
  }
  if (age.latest_outcome_at?.trim()) {
    parts.push(`latest_outcome:${age.latest_outcome_at.trim().slice(0, 24)}`);
  }
  return parts.length > 0 ? parts.join("|") : null;
}

function arcQuestionAlreadySatisfied(ctx: StrategyCardBuildContext): boolean {
  const fp = arcLatestQuestionFingerprint(ctx.facts.arc_clarification_facts);
  if (!fp) return false;
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    if (s.ask_text?.trim() && fingerprintAsk(s.ask_text).toLowerCase() === fp.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function collectArcClarifyAvoidRepeating(ctx: StrategyCardBuildContext): string[] {
  const out = collectAvoidRepeating(ctx);
  const arc = ctx.facts.arc_clarification_facts;
  const qFp = arcLatestQuestionFingerprint(arc);
  if (qFp && !out.some((a) => a.toLowerCase() === qFp.toLowerCase())) {
    out.unshift(qFp);
  }
  const previewFp = arcClarifyLegacyPreviewFingerprint(arc);
  if (previewFp && !out.some((a) => a.toLowerCase() === previewFp.toLowerCase())) {
    out.push(previewFp);
  }
  return out.slice(0, MAX_AVOID_REPEATING);
}

function buildArcClarifyMustDoMustNotDo(ctx: StrategyCardBuildContext): {
  must_do: string[];
  must_not_do: string[];
} {
  const must_do = [
    "Ask exactly one natural clarification question.",
    "Anchor lightly to the latest coach accountability question or context.",
    "Make clear the reply is not being scored as an outcome yet.",
  ];
  const must_not_do = [
    ARC_TENTATIVE_OUTCOME_NOT_CONFIRMED_MUST_NOT_DO,
    ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO,
    "Do not claim completion, miss, partial, or proof.",
    "Do not mention Victory Room.",
  ];

  if (arcClarifyLegacyPreviewText(ctx.facts.arc_clarification_facts)) {
    must_not_do.push(ARC_CLARIFICATION_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
  }

  if (arcQuestionAlreadySatisfied(ctx)) {
    must_not_do.push("Do not repeat the stale accountability question verbatim if thread memory shows it was already answered.");
  }

  if (ctx.openLoops.satisfied_asks?.length) {
    must_not_do.push("Do not re-ask satisfied asks from open_loops.");
  }

  must_not_do.push(INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO);

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

export function buildArcClarifyStrategyCardV1(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const arc = facts.arc_clarification_facts!;
  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  const legacyUsed = legacyType === "clarify";
  const legacyReplaced =
    legacyType != null && legacyType !== "clarify" && facts.suggested_coaching_move?.trim();

  const promptAge = arc.context_age?.accountability_prompt_age_minutes;
  const priority: "normal" | "high" =
    promptAge != null && promptAge >= 120 ? "high" : "normal";

  const { must_do, must_not_do } = buildArcClarifyMustDoMustNotDo(ctx);
  const avoid_repeating = collectArcClarifyAvoidRepeating(ctx);

  const allowed: StrategyCardV1["allowed_claims"] = {
    completion: false,
    miss: false,
    partial: false,
    proof: false,
    victory_room: false,
    state_changed: false,
    proposal_active: false,
  };

  const turnKind =
    facts.turn_understanding?.reconciled_response_intent ??
    arc.clarification_reason ??
    "arc_clarify_ambiguous_short";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "inbound",
    route_kind: "arc_clarify_ambiguous_short",
    turn_kind: String(turnKind),
    server_truth_summary: {
      outcome: "unclear",
      explicit_user_truth: false,
      persistence_decision: facts.inbound_meaning?.persistence_decision ?? null,
      active_pending_kinds: activePendingKinds(ctx.activePending),
      answered_last_question: null,
      satisfied_ask_fingerprints: [],
      arc_tentative_outcome: arc.tentative_outcome ?? null,
      arc_clarification_reason: arc.clarification_reason ?? null,
      arc_context_age: formatArcContextAgeSummary(arc.context_age),
    },
    move: {
      type: "clarify",
      priority,
      confidence: "high",
      reason: truncateText(
        "Ambiguous short reply — one natural clarification before scoring the accountability outcome.",
        MAX_REASON_CHARS
      ),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: 1,
      avoid_repeating,
      tone_posture: "clarifying",
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: facts.suggested_coaching_move ?? null,
      legacy_coaching_move_source: facts.coaching_move_source ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

export function buildCentralPivotStrategyCardV1(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const pivot = facts.central_brain_pivot_facts!;
  const turnPurpose = pivot.central_turn_purpose?.trim() || null;
  const moveType = centralPivotMoveFromPurpose(turnPurpose, pivot.suggested_move);
  const blockedScoring = pivot.blocked_outcome_scoring === true;
  const shouldAnswerWithoutScoring = blockedScoring;

  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  const legacyUsed =
    legacyType != null &&
    legacyType === moveType &&
    facts.coaching_move_source?.includes("central") === true;
  const legacyReplaced =
    legacyType != null &&
    legacyType !== moveType &&
    Boolean(facts.suggested_coaching_move?.trim());

  const { must_do, must_not_do } = buildCentralPivotMustDoMustNotDo({
    moveType,
    ctx,
    blockedScoring,
  });
  const avoid_repeating = collectCentralPivotAvoidRepeating(ctx);

  const allowed: StrategyCardV1["allowed_claims"] = {
    completion: false,
    miss: false,
    partial: false,
    proof: false,
    victory_room: false,
    state_changed: false,
    proposal_active: false,
  };

  const turnKind =
    facts.turn_understanding?.reconciled_response_intent ??
    turnPurpose ??
    "central_brain_pivot";

  const maxQuestions = moveType === "clarify" ? 1 : 0;
  const tonePosture: StrategyCardTonePosture =
    moveType === "clarify" ? "clarifying" : "warm_direct";

  const moveReasonByPurpose: Record<string, string> = {
    human_conversation: "Human conversation detour — respond briefly without scoring today's outcome.",
    human_tether: "Human tether detour — respond briefly without scoring today's outcome.",
    meta_question_or_confusion: "Meta question or confusion — clarify naturally without scoring today's outcome.",
    advice_or_coaching_request:
      "Advice or coaching request — concise response anchored to the current commitment.",
  };
  const reasonKey = (turnPurpose ?? "").toLowerCase();
  const moveReason =
    moveReasonByPurpose[reasonKey] ??
    "Central brain pivot — respond to the human/meta need without scoring today's accountability outcome.";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "inbound",
    route_kind: "central_brain_pivot",
    turn_kind: String(turnKind),
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      persistence_decision: facts.inbound_meaning?.persistence_decision ?? null,
      active_pending_kinds: activePendingKinds(ctx.activePending),
      answered_last_question: null,
      satisfied_ask_fingerprints: [],
      central_turn_purpose: turnPurpose,
      central_pivot_blocked_outcome_scoring: blockedScoring,
      central_pivot_should_answer_without_scoring: shouldAnswerWithoutScoring,
      central_pivot_suggested_move: pivot.suggested_move?.trim() || null,
    },
    move: {
      type: moveType,
      priority: "normal",
      confidence: pivot.confidence != null && pivot.confidence >= 0.8 ? "high" : "medium",
      reason: truncateText(moveReason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: maxQuestions,
      avoid_repeating,
      tone_posture: tonePosture,
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: facts.suggested_coaching_move ?? null,
      legacy_coaching_move_source: facts.coaching_move_source ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

function isOpenQuestionAnswerUnclear(
  oq: InboundV3OpenQuestionFacts,
  facts: InboundV3RelationshipFacts
): boolean {
  if (facts.v2_accountability.gated_mode === "clarify") return true;
  const kind = oq.answer_kind?.toLowerCase() ?? "";
  if (kind === "ambiguous" || kind === "unclear") return true;
  const tu = facts.turn_understanding;
  if (tu?.reconciled_response_intent === "unclear_clarify") return true;
  const ans = oq.extracted_answer?.trim();
  return !ans || ans.length < 2;
}

function isOpenQuestionAnswerClear(
  oq: InboundV3OpenQuestionFacts,
  facts: InboundV3RelationshipFacts
): boolean {
  return !isOpenQuestionAnswerUnclear(oq, facts);
}

function isOpenQuestionNotDelivered(ctx: StrategyCardBuildContext): boolean {
  const fp = openQuestionFingerprint(ctx.facts.open_question_facts);
  if (!fp) return false;
  const notDelivered = ctx.noSendSilence?.delivery_truth?.recent_questions_not_delivered ?? [];
  return notDelivered.some((q) => {
    const a = q.toLowerCase();
    const b = fp.toLowerCase();
    return a.includes(b.slice(0, 24)) || b.includes(a.slice(0, 24));
  });
}

export function isOpenQuestionSatisfied(ctx: StrategyCardBuildContext): boolean {
  const tu = ctx.facts.turn_understanding;
  if (tu?.last_ask_satisfied === "yes") return true;
  if (ctx.facts.thread.short_ack_should_not_reask_question) return true;
  const mp = ctx.facts.thread.memory_packet;
  if (mp?.open_question_pending === false && mp?.latest_answer_after_open_question?.trim()) return true;
  if (ctx.facts.thread.latest_answer_after_open_question?.trim() && mp?.open_question_pending === false) {
    return true;
  }
  const fp = openQuestionFingerprint(ctx.facts.open_question_facts);
  if (!fp) return false;
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    if (s.ask_text?.trim() && fingerprintAsk(s.ask_text).toLowerCase() === fp.toLowerCase()) return true;
  }
  return false;
}

function missTurnNeedsBlocker(facts: InboundV3RelationshipFacts): boolean {
  const outcome = deriveOutcome(facts);
  return outcome === "missed" || outcome === "partial" || facts.miss_adjustment_policy?.single_miss_recovery_required === true;
}

function collectOpenQuestionAvoidRepeating(ctx: StrategyCardBuildContext): string[] {
  const out = collectAvoidRepeating(ctx);
  const oq = ctx.facts.open_question_facts;
  const fp = openQuestionFingerprint(oq);
  if (fp) {
    const clearAnswer =
      Boolean(oq?.extracted_answer?.trim()) &&
      oq!.extracted_answer!.trim().length >= 2 &&
      !isOpenQuestionAnswerUnclear(oq!, ctx.facts);
    if (
      (isOpenQuestionSatisfied(ctx) || clearAnswer) &&
      !out.some((a) => a.toLowerCase() === fp.toLowerCase())
    ) {
      out.unshift(fp);
    }
  }
  const previewFp = openQuestionOldCoachPreviewFingerprint(oq);
  if (previewFp && !out.some((a) => a.toLowerCase() === previewFp.toLowerCase())) {
    out.push(previewFp);
  }
  return out.slice(0, MAX_AVOID_REPEATING);
}

function selectOpenQuestionMoveType(ctx: StrategyCardBuildContext): {
  type: StrategyCardMoveType;
  reason: string;
  confidence: "low" | "medium" | "high";
} {
  const { facts } = ctx;
  const oq = facts.open_question_facts!;
  const tu = facts.turn_understanding;
  const planAck = isPlanAckTurn({ facts, tu, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const satisfied = isOpenQuestionSatisfied(ctx);
  const notDelivered = isOpenQuestionNotDelivered(ctx);
  const adjustmentRequested = inboundUserRequestedGoalAdjustment(facts.thread.coalesced_inbound_text);
  const adjustmentAllowed = facts.miss_adjustment_policy?.adjustment_proposal_allowed_by_evidence === true;

  if (planAck) {
    return {
      type: tu?.last_ask_satisfied === "yes" ? "close_loop" : "protect_existing_plan",
      reason: "Plan acknowledgment on open-question turn — protect the plan, not an outcome triad.",
      confidence: "high",
    };
  }

  if (satisfied) {
    return {
      type: "close_loop",
      reason: "Open question already satisfied — close the loop without re-asking.",
      confidence: "high",
    };
  }

  if (notDelivered) {
    return {
      type: "clarify",
      reason: "Prior open question may not have been delivered — one natural follow-up is allowed.",
      confidence: "medium",
    };
  }

  if (isOpenQuestionAnswerUnclear(oq, facts)) {
    return {
      type: "clarify",
      reason: "Open-question answer is partial or unclear — one clarifying question only.",
      confidence: "medium",
    };
  }

  if (adjustmentRequested) {
    if (adjustmentAllowed) {
      return {
        type: "evaluate_commitment",
        reason: "User asked to change the bar while answering — evaluate with confirmation.",
        confidence: "medium",
      };
    }
    return {
      type: "clarify",
      reason: "Adjustment language without evidence permission — clarify intent only.",
      confidence: "medium",
    };
  }

  const tuIntent = tu?.reconciled_response_intent;
  if (tuIntent === "unclear_clarify") {
    return { type: "clarify", reason: "Turn understanding requests gentle clarification.", confidence: "medium" };
  }
  if (tuIntent === "close_loop_no_new_action" || tuIntent === "acknowledge_prior_ask_satisfied") {
    return { type: "close_loop", reason: "Prior ask satisfied — close the loop.", confidence: "high" };
  }
  if (tuIntent === "reinforce_plan_without_proof") {
    return { type: "protect_existing_plan", reason: "Turn understanding reinforces plan without proof.", confidence: "high" };
  }

  if (isOpenQuestionAnswerClear(oq, facts) || oq.extracted_answer?.trim()) {
    return {
      type: "close_loop",
      reason: "User answered the open question clearly — acknowledge and continue the thread.",
      confidence: "high",
    };
  }

  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  if (legacyType && legacyType !== "ask_blocker") {
    return {
      type: legacyType,
      reason: `Consolidated from legacy suggested_coaching_move (${facts.suggested_coaching_move}).`,
      confidence: "medium",
    };
  }

  return {
    type: "close_loop",
    reason: "Default open-question answer handling — acknowledge and move forward.",
    confidence: "medium",
  };
}

function buildOpenQuestionMustDoMustNotDo(args: {
  moveType: StrategyCardMoveType;
  ctx: StrategyCardBuildContext;
  planAck: boolean;
  satisfied: boolean;
  notDelivered: boolean;
}): { must_do: string[]; must_not_do: string[] } {
  const must_do: string[] = [];
  const must_not_do: string[] = [];
  const pendingKinds = activePendingKinds(args.ctx.activePending);

  if (args.moveType === "close_loop" || args.moveType === "protect_existing_plan") {
    must_do.push("Acknowledge the user's answer naturally.");
    must_do.push("Continue the accountability thread forward.");
    must_not_do.push("Do not re-ask the same open question.");
    must_not_do.push("Do not treat the answer as completion, miss, partial, or proof unless allowed_claims permit.");
  }

  if (args.moveType === "clarify") {
    must_do.push("Ask one natural clarification about the open question.");
    must_not_do.push("Do not pile on unrelated new questions.");
    must_not_do.push("Do not claim the open question is resolved.");
  }

  if (args.planAck) {
    must_do.push("Acknowledge the plan confirmation briefly.");
    must_not_do.push("Do not treat plan acknowledgment as completion, miss, partial, or proof.");
    must_not_do.push("Do not ask what got in the way as if this were a miss.");
  }

  if (args.satisfied) {
    must_not_do.push("Do not re-ask the satisfied open question.");
  }

  if (args.notDelivered) {
    must_not_do.push("Do not imply the user ignored the earlier question.");
  }

  if (openQuestionOldCoachPreviewText(args.ctx.facts.open_question_facts)) {
    must_not_do.push(OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);
  }

  if (pendingKinds.length > 0) {
    must_not_do.push("Do not claim pending items are resolved, applied, or closed.");
  }

  if (args.ctx.openLoops.satisfied_asks?.length) {
    must_not_do.push("Do not re-ask satisfied asks from open_loops.");
  }

  must_not_do.push(ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO);
  must_not_do.push(INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO);

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function buildOpenQuestionAllowedClaims(
  ctx: StrategyCardBuildContext,
  outcome: StrategyCardOutcome
): StrategyCardV1["allowed_claims"] {
  const p = ctx.proofPermission;
  const planAck = isPlanAckTurn({
    facts: ctx.facts,
    tu: ctx.facts.turn_understanding,
    shortAnswerPlanAck: ctx.shortAnswerPlanAck,
  });

  if (planAck) {
    return {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: proposalActive(ctx.activePending, ctx.facts),
    };
  }

  return {
    completion: outcome === "completed" && p.can_claim_completion,
    miss: outcome === "missed" && p.can_claim_miss,
    partial: outcome === "partial" && p.can_claim_partial,
    proof: outcome === "completed" && p.can_claim_proof,
    victory_room: outcome === "completed" && p.can_reference_victory_room,
    state_changed: false,
    proposal_active: proposalActive(ctx.activePending, ctx.facts),
  };
}

export function buildOpenQuestionAnswerStrategyCardV1(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const oq = facts.open_question_facts!;
  const outcome = deriveOutcome(facts);
  const planAck = isPlanAckTurn({ facts, tu: facts.turn_understanding, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const satisfied = isOpenQuestionSatisfied(ctx);
  const notDelivered = isOpenQuestionNotDelivered(ctx);
  const selected = selectOpenQuestionMoveType(ctx);
  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  const legacyUsed =
    legacyType != null && legacyType === selected.type && selected.type !== "ask_blocker";
  const legacyReplaced =
    legacyType != null && legacyType !== selected.type && facts.suggested_coaching_move?.trim();

  const { must_do, must_not_do } = buildOpenQuestionMustDoMustNotDo({
    moveType: selected.type,
    ctx,
    planAck,
    satisfied,
    notDelivered,
  });

  const avoid_repeating = collectOpenQuestionAvoidRepeating(ctx);
  const satisfiedFingerprints = (ctx.openLoops.satisfied_asks ?? []).map((s) =>
    fingerprintAsk(s.ask_text ?? "")
  );
  const oqFp = openQuestionFingerprint(oq);
  if (oqFp && satisfied && !satisfiedFingerprints.includes(oqFp)) {
    satisfiedFingerprints.unshift(oqFp);
  }

  const allowed = buildOpenQuestionAllowedClaims(ctx, outcome);
  const canCelebrate = allowed.completion && ctx.proofPermission.can_praise_consistency;

  const turnKind =
    oq.answer_kind ??
    facts.turn_understanding?.reconciled_response_intent ??
    facts.inbound_meaning?.relationship_meaning ??
    "open_question_answer";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "inbound",
    route_kind: "open_question_answer",
    turn_kind: String(turnKind),
    server_truth_summary: {
      outcome,
      explicit_user_truth: outcome !== "unclear" && outcome !== "none",
      persistence_decision: facts.inbound_meaning?.persistence_decision ?? null,
      active_pending_kinds: activePendingKinds(ctx.activePending),
      answered_last_question:
        facts.turn_understanding?.last_ask_satisfied === "yes" ||
        satisfied ||
        facts.thread.short_ack_should_not_reask_question ||
        null,
      satisfied_ask_fingerprints: satisfiedFingerprints.filter(Boolean).slice(0, MAX_AVOID_REPEATING),
      open_question_answer_kind: oq.answer_kind ?? null,
      open_question_satisfied: satisfied,
    },
    move: {
      type: selected.type,
      priority: selected.confidence === "high" ? "high" : "normal",
      confidence: selected.confidence,
      reason: truncateText(selected.reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: selected.type === "clarify" ? 1 : 1,
      avoid_repeating,
      tone_posture: resolveTonePosture({
        moveType: selected.type,
        noSendSilence: ctx.noSendSilence,
        canCelebrate,
      }),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: facts.suggested_coaching_move ?? null,
      legacy_coaching_move_source: facts.coaching_move_source ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

function activePendingKinds(activePending: ActivePendingState): string[] {
  return activePending.items.filter((i) => i.active).map((i) => i.kind);
}

function proposalActive(activePending: ActivePendingState, facts: InboundV3RelationshipFacts): boolean {
  const kinds = activePendingKinds(activePending);
  if (kinds.some((k) => k === "contract_proposal" || k === "adaptive_proposal")) return true;
  return Boolean(facts.v2_accountability.goal_adjustment_mention_allowed);
}

function selectMoveFromInboundResolvedTruth(
  rt: NonNullable<InboundV3RelationshipFacts["inbound_resolved_truth"]>
): { type: StrategyCardMoveType; reason: string; confidence: "high" } | null {
  switch (rt.required_reply_move) {
    case "acknowledge_completion":
      return {
        type: "ack_completion",
        reason: "Resolved inbound truth: user reported completion on this turn.",
        confidence: "high",
      };
    case "protect_future_plan":
      return {
        type: "protect_existing_plan",
        reason: "Resolved inbound truth: future plan — protect without outcome interrogation.",
        confidence: "high",
      };
    case "close_loop_on_answered_ask":
      return {
        type: "close_loop",
        reason: "Resolved inbound truth: prior ask satisfied — close the loop.",
        confidence: "high",
      };
    case "acknowledge_partial":
      return {
        type: "ack_partial",
        reason: "Resolved inbound truth: partial attempt.",
        confidence: "high",
      };
    case "acknowledge_miss_without_shame":
      return {
        type: rt.blocker_detected ? "recover_today" : "ask_blocker",
        reason: "Resolved inbound truth: honest miss — recover without shame.",
        confidence: "high",
      };
    case "acknowledge_blocker":
      return {
        type: "recover_today",
        reason: "Resolved inbound truth: blocker named — acknowledge and recover.",
        confidence: "high",
      };
    case "clarify_once":
      return {
        type: "clarify",
        reason: "Resolved inbound truth: one clarifying question only.",
        confidence: "high",
      };
    default:
      return null;
  }
}

function selectMoveType(ctx: StrategyCardBuildContext): {
  type: StrategyCardMoveType;
  reason: string;
  confidence: "low" | "medium" | "high";
} {
  const { facts } = ctx;
  const rt = facts.inbound_resolved_truth;
  if (rt) {
    const fromResolved = selectMoveFromInboundResolvedTruth(rt);
    if (fromResolved) return fromResolved;
  }
  const policy = facts.miss_adjustment_policy;
  const tu = facts.turn_understanding;
  const outcome = deriveOutcome(facts);
  const planAck = isPlanAckTurn({ facts, tu, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const blockerKnown = blockerAlreadyKnown(facts);
  const adjustmentRequested = inboundUserRequestedGoalAdjustment(facts.thread.coalesced_inbound_text);
  const adjustmentAllowed = policy?.adjustment_proposal_allowed_by_evidence === true;

  if (planAck) {
    return {
      type: tu?.last_ask_satisfied === "yes" ? "close_loop" : "protect_existing_plan",
      reason: "User acknowledged a forward plan — protect the plan, not an outcome triad.",
      confidence: "high",
    };
  }

  if (policy?.single_miss_recovery_required === true) {
    if (blockerKnown) {
      return {
        type: "recover_today",
        reason: "Single miss with blocker context — recover today without changing the commitment.",
        confidence: "high",
      };
    }
    return {
      type: "ask_blocker",
      reason: "Single miss recovery — ask what got in the way before any adjustment talk.",
      confidence: "high",
    };
  }

  if (outcome === "completed") {
    return {
      type: "ack_completion",
      reason: "Server truth shows explicit completion on this turn.",
      confidence: "high",
    };
  }

  if (outcome === "partial") {
    return {
      type: blockerKnown ? "recover_today" : "ack_partial",
      reason: blockerKnown
        ? "Partial with blocker detail — acknowledge partial and recover forward."
        : "Server truth shows partial — acknowledge honestly without calling it full completion.",
      confidence: "medium",
    };
  }

  if (outcome === "missed") {
    if (blockerKnown) {
      return {
        type: "recover_today",
        reason: "Miss with blocker detail already present — recover, do not re-ask what blocked.",
        confidence: "high",
      };
    }
    return {
      type: "ask_blocker",
      reason: "Miss turn — identify what got in the way.",
      confidence: "high",
    };
  }

  if (adjustmentRequested) {
    if (adjustmentAllowed) {
      return {
        type: "evaluate_commitment",
        reason: "User asked to change the bar — evaluate with confirmation, not a unilateral change.",
        confidence: "medium",
      };
    }
    return {
      type: "clarify",
      reason: "Adjustment language without evidence permission — clarify intent without proposing a new commitment.",
      confidence: "medium",
    };
  }

  const tuIntent = tu?.reconciled_response_intent;
  if (tuIntent === "unclear_clarify") {
    return { type: "clarify", reason: "Turn understanding requests gentle clarification.", confidence: "medium" };
  }
  if (tuIntent === "close_loop_no_new_action" || tuIntent === "acknowledge_prior_ask_satisfied") {
    return { type: "close_loop", reason: "Prior ask satisfied — close the loop.", confidence: "high" };
  }
  if (tuIntent === "acknowledge_completion") {
    return { type: "ack_completion", reason: "Turn understanding acknowledges completion.", confidence: "high" };
  }
  if (tuIntent === "tell_truth_and_recover" || tuIntent === "identify_blocker") {
    return {
      type: blockerKnown ? "recover_today" : "ask_blocker",
      reason: "Recovery or blocker intent from turn understanding.",
      confidence: "medium",
    };
  }

  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  if (legacyType) {
    return {
      type: legacyType,
      reason: `Consolidated from legacy suggested_coaching_move (${facts.suggested_coaching_move}).`,
      confidence: "medium",
    };
  }

  if (facts.v2_accountability.gated_mode === "clarify") {
    return { type: "clarify", reason: "Classifier gated to clarify.", confidence: "medium" };
  }

  return { type: "other", reason: "Default accountability continuity for this turn.", confidence: "low" };
}

function buildMustDoMustNotDo(args: {
  moveType: StrategyCardMoveType;
  ctx: StrategyCardBuildContext;
  policy: MissAdjustmentPolicyResult | null | undefined;
  planAck: boolean;
  blockerKnown: boolean;
}): { must_do: string[]; must_not_do: string[] } {
  const must_do: string[] = [];
  const must_not_do: string[] = [];
  const pendingKinds = activePendingKinds(args.ctx.activePending);
  const rt = args.ctx.facts.inbound_resolved_truth;

  if (rt) {
    for (const item of rt.must_not_do) {
      if (item.trim()) must_not_do.push(item.trim());
    }
    if (rt.required_reply_move === "acknowledge_completion") {
      must_do.push("Acknowledge what the user reported they completed.");
      must_not_do.push("Do not ask whether it already happened or ask for proof again.");
      must_not_do.push("Do not turn completion into tomorrow planning or a new accountability question.");
    }
    if (rt.required_reply_move === "protect_future_plan") {
      must_do.push("Briefly protect the future plan without interrogating whether it already happened.");
      must_not_do.push('Do not ask "did you do it?" or treat the future plan as completion proof.');
    }
    if (rt.required_reply_move === "close_loop_on_answered_ask") {
      must_do.push("Acknowledge the answer or evidence and move one step forward.");
      must_not_do.push("Do not repeat the prior ask or ask for the same evidence again.");
    }
    if (rt.max_questions_override === 0) {
      must_not_do.push("Write statement-only SMS — no question mark and no ask-shaped follow-up.");
    }
  }

  if (args.policy?.single_miss_recovery_required) {
    must_do.push("Ask one honest recovery or blocker question.");
    must_not_do.push("Do not propose changing the commitment or offer a new commitment target.");
  }

  if (args.planAck) {
    must_do.push("Acknowledge the plan confirmation briefly.");
    must_not_do.push("Do not treat plan acknowledgment as completion, miss, partial, or proof.");
    must_not_do.push("Do not ask what got in the way as if this were a miss.");
  }

  if (args.moveType === "ack_completion") {
    must_do.push("Acknowledge the reported completion honestly.");
    must_not_do.push("Do not call it proof or Victory Room unless allowed_claims permit.");
  }

  if (args.moveType === "ack_partial") {
    must_do.push("Acknowledge partial honestly.");
    must_not_do.push("Do not call it full completion.");
  }

  if (args.blockerKnown && args.moveType === "recover_today") {
    must_not_do.push("Do not ask again what got in the way — user already named it.");
  }

  if (pendingKinds.length > 0) {
    must_not_do.push("Do not claim pending items are resolved, applied, or closed.");
  }

  if (args.ctx.openLoops.satisfied_asks?.length) {
    must_not_do.push("Do not re-ask satisfied asks from open_loops.");
  }

  must_not_do.push(ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO);
  must_not_do.push(INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO);

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function buildAllowedClaims(ctx: StrategyCardBuildContext, outcome: StrategyCardOutcome): StrategyCardV1["allowed_claims"] {
  const p = ctx.proofPermission;
  const planAck = isPlanAckTurn({
    facts: ctx.facts,
    tu: ctx.facts.turn_understanding,
    shortAnswerPlanAck: ctx.shortAnswerPlanAck,
  });

  if (planAck) {
    return {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: proposalActive(ctx.activePending, ctx.facts),
    };
  }

  return {
    completion: outcome === "completed" && p.can_claim_completion,
    miss: outcome === "missed" && p.can_claim_miss,
    partial: outcome === "partial" && p.can_claim_partial,
    proof: p.can_claim_proof,
    victory_room: p.can_reference_victory_room,
    state_changed: false,
    proposal_active: proposalActive(ctx.activePending, ctx.facts),
  };
}

export function buildInboundNormalStrategyCardV1(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const outcome = deriveOutcome(facts);
  const planAck = isPlanAckTurn({ facts, tu: facts.turn_understanding, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const blockerKnown = blockerAlreadyKnown(facts);
  const selected = selectMoveType(ctx);
  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  const legacyUsed =
    legacyType != null && legacyType === selected.type && !SINGLE_MISS_FORBIDDEN_MOVES.includes(selected.type);
  const legacyReplaced =
    legacyType != null && legacyType !== selected.type && facts.suggested_coaching_move?.trim();

  const { must_do, must_not_do } = buildMustDoMustNotDo({
    moveType: selected.type,
    ctx,
    policy: facts.miss_adjustment_policy,
    planAck,
    blockerKnown,
  });

  const avoid_repeating = collectAvoidRepeating(ctx);
  const satisfiedFingerprints = (ctx.openLoops.satisfied_asks ?? []).map((s) =>
    fingerprintAsk(s.ask_text ?? "")
  );

  const allowed = buildAllowedClaims(ctx, outcome);
  const canCelebrate = allowed.completion && ctx.proofPermission.can_praise_consistency;
  const rt = facts.inbound_resolved_truth;
  const maxQuestions =
    rt?.max_questions_override ??
    (selected.type === "clarify" ? 1 : 1);

  const turnKind =
    facts.v2_accountability.final_event_type ??
    facts.inbound_meaning?.relationship_meaning ??
    facts.turn_understanding?.reconciled_response_intent ??
    "unknown";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "inbound",
    route_kind: "normal_inbound_reply",
    turn_kind: String(turnKind),
    server_truth_summary: {
      outcome,
      explicit_user_truth: outcome !== "unclear" && outcome !== "none",
      persistence_decision: facts.inbound_meaning?.persistence_decision ?? null,
      active_pending_kinds: activePendingKinds(ctx.activePending),
      answered_last_question:
        facts.turn_understanding?.last_ask_satisfied === "yes" ||
        facts.thread.short_ack_should_not_reask_question ||
        null,
      satisfied_ask_fingerprints: satisfiedFingerprints.filter(Boolean).slice(0, MAX_AVOID_REPEATING),
    },
    move: {
      type: selected.type,
      priority: selected.confidence === "high" ? "high" : "normal",
      confidence: selected.confidence,
      reason: truncateText(selected.reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: maxQuestions,
      avoid_repeating,
      tone_posture: resolveTonePosture({
        moveType: selected.type,
        noSendSilence: ctx.noSendSilence,
        canCelebrate,
      }),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: facts.suggested_coaching_move ?? null,
      legacy_coaching_move_source: facts.coaching_move_source ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

function validateSharedStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): string[] {
  const reasons: string[] = [];
  const policy = ctx.facts.miss_adjustment_policy;
  const outcome = card.server_truth_summary.outcome;

  if (card.route_kind === "normal_inbound_reply") {
    if (policy?.single_miss_recovery_required && SINGLE_MISS_FORBIDDEN_MOVES.includes(card.move.type)) {
      reasons.push("single_miss_forbidden_move");
    }
  }

  if (!policy?.adjustment_proposal_allowed_by_evidence && card.move.type === "propose_adjustment") {
    reasons.push("adjustment_not_allowed");
  }

  if (!policy?.adjustment_proposal_allowed_by_evidence && card.move.type === "evaluate_commitment") {
    const requested = inboundUserRequestedGoalAdjustment(ctx.facts.thread.coalesced_inbound_text);
    if (!requested) reasons.push("evaluate_without_permission");
  }

  if (card.allowed_claims.proof && !ctx.proofPermission.can_claim_proof) {
    reasons.push("proof_not_permitted");
  }
  if (card.allowed_claims.victory_room && !ctx.proofPermission.can_reference_victory_room) {
    reasons.push("victory_room_not_permitted");
  }
  if (card.allowed_claims.completion && !ctx.proofPermission.can_claim_completion && outcome !== "completed") {
    reasons.push("completion_claim_mismatch");
  }
  if (card.allowed_claims.completion && outcome !== "completed") {
    reasons.push("completion_without_outcome");
  }
  if (card.allowed_claims.miss && outcome !== "missed") {
    reasons.push("miss_without_outcome");
  }
  if (card.allowed_claims.partial && outcome !== "partial") {
    reasons.push("partial_without_outcome");
  }

  if (card.allowed_claims.state_changed) {
    reasons.push("state_changed_not_supported_v1");
  }

  for (const item of card.must_do) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_must_do");
    }
  }

  if (card.move.reason.length > MAX_REASON_CHARS) {
    reasons.push("reason_too_long");
  }

  const rt = ctx.facts.inbound_resolved_truth;
  if (rt?.max_questions_override === 0) {
    if (card.writer_constraints.max_questions !== 0) {
      reasons.push("resolved_truth_max_questions_zero");
    }
    if (
      (rt.required_reply_move === "acknowledge_completion" ||
        rt.required_reply_move === "close_loop_on_answered_ask" ||
        rt.required_reply_move === "protect_future_plan") &&
      (card.move.type === "clarify" || card.move.type === "ask_blocker")
    ) {
      reasons.push("resolved_truth_forbids_question_move");
    }
  }

  if (card.writer_constraints.max_questions > 1 && card.move.type !== "clarify") {
    reasons.push("max_questions_exceeded");
  }

  const pendingKinds = activePendingKinds(ctx.activePending);
  if (
    pendingKinds.length > 0 &&
    !card.must_not_do.some((m) => /pending|resolved|applied/i.test(m))
  ) {
    reasons.push("missing_pending_must_not_do");
  }

  for (const ask of card.server_truth_summary.satisfied_ask_fingerprints) {
    if (card.must_do.some((m) => m.toLowerCase().includes(ask.toLowerCase().slice(0, 20)))) {
      reasons.push("reask_satisfied_in_must_do");
    }
  }

  return reasons;
}

function validateOpenQuestionStrategyCardV1(card: StrategyCardV1, ctx: StrategyCardBuildContext): string[] {
  const reasons: string[] = [];
  if (card.route_kind !== "open_question_answer") return reasons;

  if (card.move.type === "ask_blocker" && !missTurnNeedsBlocker(ctx.facts)) {
    reasons.push("open_question_ask_blocker_without_miss");
  }

  if (isOpenQuestionSatisfied(ctx)) {
    if (!card.must_not_do.some((m) => /re-ask|same open question|satisfied open question/i.test(m))) {
      reasons.push("missing_open_question_no_reask");
    }
    const fp = openQuestionFingerprint(ctx.facts.open_question_facts);
    if (
      fp &&
      !card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === fp.toLowerCase())
    ) {
      reasons.push("missing_open_question_avoid_repeat");
    }
  }

  if (card.move.type === "clarify" && card.writer_constraints.max_questions !== 1) {
    reasons.push("open_question_clarify_max_questions");
  }

  const oldPreview = openQuestionOldCoachPreviewText(ctx.facts.open_question_facts);
  if (oldPreview) {
    if (
      !card.must_not_do.some((m) =>
        /prior internal coach draft preview|internal coach draft preview/i.test(m)
      )
    ) {
      reasons.push("missing_open_question_old_preview_non_speakable");
    }
    const previewFp = openQuestionOldCoachPreviewFingerprint(ctx.facts.open_question_facts);
    if (
      previewFp &&
      !card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === previewFp.toLowerCase())
    ) {
      reasons.push("missing_open_question_old_preview_avoid_repeat");
    }
  }

  return reasons;
}

function validateArcClarifyStrategyCardV1(card: StrategyCardV1, ctx: StrategyCardBuildContext): string[] {
  const reasons: string[] = [];
  if (card.route_kind !== "arc_clarify_ambiguous_short") return reasons;

  if (card.move.type !== "clarify") {
    reasons.push("arc_clarify_move_not_clarify");
  }

  if (card.writer_constraints.max_questions > 1) {
    reasons.push("arc_clarify_max_questions");
  }

  for (const key of ["completion", "miss", "partial", "proof", "victory_room", "state_changed", "proposal_active"] as const) {
    if (card.allowed_claims[key]) {
      reasons.push(`arc_clarify_claim_${key}`);
    }
  }

  if (
    !card.must_not_do.some((m) =>
      /tentative_outcome|tentative outcome/i.test(m)
    )
  ) {
    reasons.push("missing_arc_tentative_outcome_not_confirmed");
  }

  const legacyPreview = arcClarifyLegacyPreviewText(ctx.facts.arc_clarification_facts);
  if (legacyPreview) {
    if (
      !card.must_not_do.some((m) =>
        /internal clarification template preview|clarification template preview/i.test(m)
      )
    ) {
      reasons.push("missing_arc_legacy_preview_non_speakable");
    }
    const previewFp = arcClarifyLegacyPreviewFingerprint(ctx.facts.arc_clarification_facts);
    if (
      previewFp &&
      !card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === previewFp.toLowerCase())
    ) {
      reasons.push("missing_arc_legacy_preview_avoid_repeat");
    }
  }

  const qFp = arcLatestQuestionFingerprint(ctx.facts.arc_clarification_facts);
  if (
    qFp &&
    !card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === qFp.toLowerCase())
  ) {
    reasons.push("missing_arc_latest_question_avoid_repeat");
  }

  return reasons;
}

function validateCentralPivotStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): string[] {
  const reasons: string[] = [];
  if (card.route_kind !== "central_brain_pivot") return reasons;

  const pivot = ctx.facts.central_brain_pivot_facts;
  if (!pivot) return reasons;

  if (!CENTRAL_PIVOT_ALLOWED_MOVES.includes(card.move.type)) {
    reasons.push("central_pivot_invalid_move");
  }

  for (const key of [
    "completion",
    "miss",
    "partial",
    "proof",
    "victory_room",
    "state_changed",
    "proposal_active",
  ] as const) {
    if (card.allowed_claims[key]) {
      reasons.push(`central_pivot_claim_${key}`);
    }
  }

  if (pivot.blocked_outcome_scoring === true) {
    if (card.server_truth_summary.central_pivot_blocked_outcome_scoring !== true) {
      reasons.push("central_pivot_missing_blocked_outcome_scoring");
    }
    if (
      !card.must_not_do.some((m) =>
        /completion, miss, or partial|score this turn|scored accountability outcome/i.test(m)
      )
    ) {
      reasons.push("missing_central_pivot_no_outcome_scoring");
    }
  }

  if (card.move.type === "clarify" && card.writer_constraints.max_questions > 1) {
    reasons.push("central_pivot_clarify_max_questions");
  }

  const tetherPreview = centralPivotTetherPreviewText(pivot);
  if (tetherPreview) {
    if (
      !card.must_not_do.some((m) =>
        /prior internal coach draft preview|internal coach draft preview/i.test(m)
      )
    ) {
      reasons.push("missing_central_pivot_tether_preview_non_speakable");
    }
    const previewFp = centralPivotTetherPreviewFingerprint(pivot);
    if (
      previewFp &&
      !card.writer_constraints.avoid_repeating.some((a) => a.toLowerCase() === previewFp.toLowerCase())
    ) {
      reasons.push("missing_central_pivot_tether_preview_avoid_repeat");
    }
  }

  return reasons;
}

export function validateStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons = [
    ...validateSharedStrategyCardV1(card, ctx),
    ...validateOpenQuestionStrategyCardV1(card, ctx),
    ...validateArcClarifyStrategyCardV1(card, ctx),
    ...validateCentralPivotStrategyCardV1(card, ctx),
  ];
  return { valid: reasons.length === 0, reasons };
}

export function validateInboundNormalStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  return validateStrategyCardV1(card, ctx);
}

function repairNormalCard(card: StrategyCardV1, ctx: StrategyCardBuildContext, reasons: string[]): StrategyCardV1 {
  const rebuilt = buildInboundNormalStrategyCardV1({ ctx, generatedAt: card.generated_at });
  let moveType = rebuilt.move.type;
  let reason = rebuilt.move.reason;

  if (reasons.includes("single_miss_forbidden_move")) {
    moveType = blockerAlreadyKnown(ctx.facts) ? "recover_today" : "ask_blocker";
    reason = "Repaired: single miss recovery — blocker question only, no adjustment.";
  } else if (reasons.some((r) => r.includes("proof") || r.includes("victory"))) {
    moveType = rebuilt.move.type === "propose_adjustment" ? "clarify" : rebuilt.move.type;
    reason = "Repaired: claims aligned to server proof permission.";
  } else if (reasons.includes("adjustment_not_allowed") || reasons.includes("evaluate_without_permission")) {
    moveType = "clarify";
    reason = "Repaired: clarify intent without commitment change.";
  }

  const allowed = buildAllowedClaims(ctx, rebuilt.server_truth_summary.outcome);
  const { must_do, must_not_do } = buildMustDoMustNotDo({
    moveType,
    ctx,
    policy: ctx.facts.miss_adjustment_policy,
    planAck: isPlanAckTurn({
      facts: ctx.facts,
      tu: ctx.facts.turn_understanding,
      shortAnswerPlanAck: ctx.shortAnswerPlanAck,
    }),
    blockerKnown: blockerAlreadyKnown(ctx.facts),
  });

  return {
    ...rebuilt,
    move: {
      type: moveType,
      priority: "normal",
      confidence: "medium",
      reason: truncateText(reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      ...rebuilt.writer_constraints,
      max_questions: moveType === "clarify" ? 1 : 1,
      tone_posture:
        moveType === "clarify" ? "clarifying" : rebuilt.writer_constraints.tone_posture,
    },
    meta: {
      ...rebuilt.meta,
      legacy_hint_replaced: true,
    },
  };
}

function repairOpenQuestionCard(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext,
  reasons: string[]
): StrategyCardV1 {
  const rebuilt = buildOpenQuestionAnswerStrategyCardV1({ ctx, generatedAt: card.generated_at });
  let moveType: StrategyCardMoveType = "close_loop";
  let reason = "Repaired: acknowledge open-question answer and continue the thread.";

  if (
    reasons.includes("open_question_ask_blocker_without_miss") ||
    reasons.includes("missing_open_question_no_reask") ||
    reasons.includes("missing_open_question_avoid_repeat")
  ) {
    moveType = isOpenQuestionAnswerUnclear(ctx.facts.open_question_facts!, ctx.facts)
      ? "clarify"
      : "close_loop";
    reason =
      moveType === "clarify"
        ? "Repaired: one clarifying question about the open question."
        : "Repaired: close the open-question loop without re-asking.";
  } else if (reasons.some((r) => r.includes("proof") || r.includes("victory"))) {
    moveType = "close_loop";
    reason = "Repaired: open-question claims aligned to server proof permission.";
  } else if (reasons.includes("adjustment_not_allowed") || reasons.includes("evaluate_without_permission")) {
    moveType = "clarify";
    reason = "Repaired: clarify intent without commitment change.";
  }

  const planAck = isPlanAckTurn({
    facts: ctx.facts,
    tu: ctx.facts.turn_understanding,
    shortAnswerPlanAck: ctx.shortAnswerPlanAck,
  });
  const satisfied = isOpenQuestionSatisfied(ctx);
  const notDelivered = isOpenQuestionNotDelivered(ctx);
  const allowed = buildOpenQuestionAllowedClaims(ctx, rebuilt.server_truth_summary.outcome);
  const { must_do, must_not_do } = buildOpenQuestionMustDoMustNotDo({
    moveType,
    ctx,
    planAck,
    satisfied,
    notDelivered,
  });

  return {
    ...rebuilt,
    move: {
      type: moveType,
      priority: "normal",
      confidence: "medium",
      reason: truncateText(reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      ...rebuilt.writer_constraints,
      avoid_repeating: collectOpenQuestionAvoidRepeating(ctx),
      max_questions: moveType === "clarify" ? 1 : 1,
      tone_posture: moveType === "clarify" ? "clarifying" : rebuilt.writer_constraints.tone_posture,
    },
    meta: {
      ...rebuilt.meta,
      legacy_hint_replaced: true,
    },
  };
}

function repairArcClarifyCard(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildArcClarifyStrategyCardV1({ ctx, generatedAt: card.generated_at });
}

function repairCentralPivotCard(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildCentralPivotStrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function finalizeStrategyCardWithRelationshipAnchorBoundaries(
  card: StrategyCardV1,
  counts: { relationshipAnchorCount: number; scheduleAnchorCount: number }
): StrategyCardV1 {
  if (counts.relationshipAnchorCount === 0 && counts.scheduleAnchorCount === 0) {
    return card;
  }
  const must_do = [...card.must_do];
  const must_not_do = [...card.must_not_do];
  const avoid_repeating = [...card.writer_constraints.avoid_repeating];
  applyRelationshipAnchorStrategyBoundaries({
    must_do,
    must_not_do,
    avoid_repeating,
    relationshipAnchorCount: counts.relationshipAnchorCount,
    scheduleAnchorCount: counts.scheduleAnchorCount,
    recentlyUsedAnchorKeys: [],
  });
  return {
    ...card,
    must_do: [...new Set(must_do)].slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
    writer_constraints: {
      ...card.writer_constraints,
      avoid_repeating: avoid_repeating.slice(0, MAX_AVOID_REPEATING),
    },
  };
}

export function buildStrategyCardV1ForFacts(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  if (isOpenQuestionAnswerStrategyCardEligible(args.ctx.facts)) {
    return buildOpenQuestionAnswerStrategyCardV1(args);
  }
  if (isArcClarifyStrategyCardEligible(args.ctx.facts)) {
    return buildArcClarifyStrategyCardV1(args);
  }
  if (isCentralPivotStrategyCardEligible(args.ctx.facts)) {
    return buildCentralPivotStrategyCardV1(args);
  }
  return buildInboundNormalStrategyCardV1(args);
}

export function validateAndRepairStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired =
    card.route_kind === "open_question_answer"
      ? repairOpenQuestionCard(card, ctx, first.reasons)
      : card.route_kind === "arc_clarify_ambiguous_short"
        ? repairArcClarifyCard(card, ctx, first.reasons)
        : card.route_kind === "central_brain_pivot"
          ? repairCentralPivotCard(card, ctx, first.reasons)
          : repairNormalCard(card, ctx, first.reasons);
  const second = validateStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

export function validateAndRepairInboundNormalStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): StrategyCardValidationResult {
  return validateAndRepairStrategyCardV1(card, ctx);
}

export function buildStrategyCardV1PromptGuidance(): string {
  return `
STRATEGY_CARD_V1 (primary coaching move when present):
- Follow strategy_card_v1 for the coaching move — do not invent a different move.
- Use RELATIONSHIP_SNAPSHOT_V2 and RELATIONSHIP_PACKET_V1 for relationship context only — not as permission to override the card.
- Respect allowed_claims — do not claim completion, miss, partial, proof, or Victory Room beyond what the card allows.
- Honor must_do and must_not_do exactly.
- Honor writer_constraints.avoid_repeating — do not re-ask those questions.
- Match writer_constraints.tone_posture in voice, without quoting internal labels.
- Server final guard still validates the final SMS separately.`;
}

export function strategyCardV1UserPromptAppendix(card: StrategyCardV1): string {
  return `STRATEGY_CARD_V1 (primary coaching move — follow exactly; do not invent a different move):
${JSON.stringify(card)}`;
}

export function strategyCardV1MetaForTelemetry(
  result: StrategyCardValidationResult,
  ctx?:
    | StrategyCardBuildContext
    | DailyC1StrategyCardBuildContext
    | DailyC2StrategyCardBuildContext
    | DailyC3RefreshStrategyCardBuildContext
    | DailyC3PendingResolutionStrategyCardBuildContext
    | WeeklyStrategyCardBuildContext
): Record<string, unknown> {
  const c = result.card;
  const inboundCtx =
    ctx && c.surface === "inbound" ? (ctx as StrategyCardBuildContext) : undefined;
  return {
    strategy_card_version: c.version,
    strategy_card_surface: c.surface,
    strategy_card_route_kind: c.route_kind,
    strategy_card_move_type: c.move.type,
    strategy_card_move_confidence: c.move.confidence,
    strategy_card_validation_status: result.validation_status,
    strategy_card_validation_reasons: result.validation_reasons.slice(0, 8),
    strategy_card_legacy_suggested_coaching_move: c.meta.legacy_suggested_coaching_move ?? null,
    strategy_card_legacy_coaching_move_source: c.meta.legacy_coaching_move_source ?? null,
    strategy_card_legacy_hint_used: c.meta.legacy_hint_used === true,
    strategy_card_legacy_hint_replaced: c.meta.legacy_hint_replaced === true,
    strategy_card_allowed_claims: c.allowed_claims,
    strategy_card_can_claim_proof: c.allowed_claims.proof,
    strategy_card_can_reference_victory_room: c.allowed_claims.victory_room,
    strategy_card_tone_posture: c.writer_constraints.tone_posture,
    ...(ctx && c.surface === "inbound"
      ? { strategy_card_plan_ack_source: deriveStrategyCardPlanAckSource(inboundCtx!) }
      : {}),
    ...(c.route_kind === "open_question_answer"
      ? {
          strategy_card_open_question_answer_kind:
            c.server_truth_summary.open_question_answer_kind ??
            inboundCtx?.facts.open_question_facts?.answer_kind ??
            null,
          strategy_card_open_question_satisfied:
            c.server_truth_summary.open_question_satisfied ??
            (inboundCtx ? isOpenQuestionSatisfied(inboundCtx) : null),
        }
      : {}),
    ...(c.route_kind === "arc_clarify_ambiguous_short"
      ? {
          strategy_card_arc_tentative_outcome:
            c.server_truth_summary.arc_tentative_outcome ??
            inboundCtx?.facts.arc_clarification_facts?.tentative_outcome ??
            null,
          strategy_card_arc_context_age: c.server_truth_summary.arc_context_age ?? null,
          strategy_card_arc_clarification_reason:
            c.server_truth_summary.arc_clarification_reason ??
            inboundCtx?.facts.arc_clarification_facts?.clarification_reason ??
            null,
        }
      : {}),
    ...(c.route_kind === "central_brain_pivot"
      ? {
          strategy_card_central_turn_purpose:
            c.server_truth_summary.central_turn_purpose ??
            inboundCtx?.facts.central_brain_pivot_facts?.central_turn_purpose ??
            null,
          strategy_card_central_pivot_blocked_outcome_scoring:
            c.server_truth_summary.central_pivot_blocked_outcome_scoring ??
            inboundCtx?.facts.central_brain_pivot_facts?.blocked_outcome_scoring ??
            null,
          strategy_card_central_pivot_should_answer_without_scoring:
            c.server_truth_summary.central_pivot_should_answer_without_scoring ??
            (inboundCtx?.facts.central_brain_pivot_facts?.blocked_outcome_scoring === true
              ? true
              : null),
        }
      : {}),
    ...(c.surface === "daily" &&
    c.route_kind !== "contract_prompt" &&
    c.route_kind !== "refresh_identity" &&
    c.route_kind !== "refresh_commitment" &&
    c.route_kind !== "pending_resolution"
      ? {
          strategy_card_legacy_server_strategy: c.meta.legacy_server_strategy ?? null,
          strategy_card_legacy_next_move_type: c.meta.legacy_next_move_type ?? null,
          strategy_card_daily_purpose: c.server_truth_summary.daily_purpose ?? null,
          strategy_card_daily_reactivation: c.server_truth_summary.daily_reactivation === true,
          strategy_card_daily_conversation_intent:
            c.server_truth_summary.daily_conversation_intent ?? null,
          strategy_card_local_date: c.server_truth_summary.local_date ?? null,
          strategy_card_local_weekday: c.server_truth_summary.local_weekday ?? null,
          strategy_card_user_timezone: c.server_truth_summary.user_timezone ?? null,
          strategy_card_is_new_accountability_day:
            c.server_truth_summary.is_new_accountability_day ?? null,
          strategy_card_high_repeat_risk:
            c.server_truth_summary.daily_high_repeat_risk === true,
          strategy_card_zero_question_required:
            c.server_truth_summary.daily_zero_question_required === true,
          strategy_card_zero_question_reason:
            c.server_truth_summary.daily_zero_question_reason ?? null,
        }
      : {}),
    ...(c.route_kind === "contract_prompt"
      ? {
          strategy_card_legacy_server_strategy: c.meta.legacy_server_strategy ?? null,
          strategy_card_legacy_next_move_type: c.meta.legacy_next_move_type ?? null,
          strategy_card_legacy_v2_contract_proposal_kind:
            c.meta.legacy_v2_contract_proposal_kind ?? null,
          strategy_card_daily_contract_proposal_kind:
            c.server_truth_summary.daily_contract_proposal_kind ?? null,
        }
      : {}),
    ...(c.route_kind === "refresh_identity" || c.route_kind === "refresh_commitment"
      ? {
          strategy_card_legacy_server_strategy: c.meta.legacy_server_strategy ?? null,
          strategy_card_legacy_next_move_type: c.meta.legacy_next_move_type ?? null,
          strategy_card_daily_refresh_step: c.server_truth_summary.daily_refresh_step ?? null,
          strategy_card_daily_refresh_session_written_before_sms:
            c.server_truth_summary.daily_refresh_session_written_before_sms === false
              ? false
              : null,
          strategy_card_daily_refresh_required_anchor_fingerprint:
            c.server_truth_summary.daily_refresh_required_anchor_fingerprint ?? null,
          strategy_card_daily_refresh_required_ask_fingerprint:
            c.server_truth_summary.daily_refresh_required_ask_fingerprint ?? null,
        }
      : {}),
    ...(c.route_kind === "pending_resolution"
      ? {
          strategy_card_legacy_server_strategy: c.meta.legacy_server_strategy ?? null,
          strategy_card_legacy_next_move_type: c.meta.legacy_next_move_type ?? null,
          strategy_card_daily_pending_resolution_kind:
            c.server_truth_summary.daily_pending_resolution_kind ?? null,
          strategy_card_daily_pending_state_written_before_sms:
            c.server_truth_summary.daily_pending_state_written_before_sms === false
              ? false
              : null,
          strategy_card_daily_pending_candidate_fingerprint:
            c.server_truth_summary.daily_pending_candidate_fingerprint ?? null,
          strategy_card_daily_pending_awaiting_user_confirmation:
            c.server_truth_summary.daily_pending_awaiting_user_confirmation ?? null,
        }
      : {}),
    ...(c.surface === "weekly" && c.route_kind === "weekly_proof_v2"
      ? {
          strategy_card_weekly_completed_count:
            c.server_truth_summary.weekly_completed_count ?? null,
          strategy_card_weekly_missed_count: c.server_truth_summary.weekly_missed_count ?? null,
          strategy_card_weekly_partial_count: c.server_truth_summary.weekly_partial_count ?? null,
          strategy_card_weekly_silent_week: c.server_truth_summary.weekly_silent_week === true,
          strategy_card_weekly_rough_week: c.server_truth_summary.weekly_rough_week === true,
          strategy_card_weekly_strong_week: c.server_truth_summary.weekly_strong_week === true,
          strategy_card_weekly_has_proof_hints: c.server_truth_summary.weekly_has_proof_hints === true,
          strategy_card_weekly_can_claim_proof:
            c.server_truth_summary.weekly_can_claim_proof === true,
          strategy_card_weekly_can_reference_victory_room:
            c.server_truth_summary.weekly_can_reference_victory_room === true,
          strategy_card_weekly_proof_state_written_before_sms:
            c.server_truth_summary.weekly_proof_state_written_before_sms === false
              ? false
              : null,
        }
      : {}),
  };
}

/** Resolve SACA plan-ack from inbound facts (thread + meaning); used for Strategy Card context. */
export function resolveShortAnswerPlanAckFromInboundFacts(
  facts: InboundV3RelationshipFacts
): boolean {
  const mp = facts.thread.memory_packet;
  const saca = resolveShortAnswerContextAuthority({
    rawInbound: facts.thread.coalesced_inbound_text,
    latestOpenQuestion:
      facts.thread.latest_open_question ??
      mp?.latest_open_question ??
      mp?.latest_open_question_guess ??
      null,
    latestOutboundBody:
      facts.thread.latest_outbound_coach_sms ??
      mp?.last_substantive_coach_message ??
      mp?.last_outbound_full_body ??
      null,
    expectedReplySemantics: facts.thread.expected_reply_semantics,
    openQuestionPending: mp?.open_question_pending,
    effectiveAsk: facts.commitment.effective_ask,
    behaviorStatement: facts.commitment.behavior_statement,
    commitmentTitle: facts.commitment.title,
    tuAnsweredLastCoachAsk: facts.turn_understanding?.proposal?.answered_last_coach_ask ?? null,
  });
  if (isPlanAckFromShortAnswerContext(saca)) return true;

  const evidence = facts.inbound_meaning?.evidence ?? [];
  const sacaPlanEvidence = evidence.some(
    (e) => e === "short_answer_plan_confirmation" || e.startsWith("plan_confirmation")
  );
  if (
    sacaPlanEvidence &&
    facts.inbound_meaning?.persistence_decision === "no_outcome_write" &&
    facts.inbound_meaning?.relationship_meaning === "answer_to_prior_question"
  ) {
    return true;
  }
  return false;
}

/** Read-only telemetry: which signal drove plan-ack classification for the card. */
export function deriveStrategyCardPlanAckSource(ctx: StrategyCardBuildContext): StrategyCardPlanAckSource {
  const facts = ctx.facts;
  if (ctx.shortAnswerPlanAck === true || resolveShortAnswerPlanAckFromInboundFacts(facts)) {
    return "saca";
  }
  const intent = facts.turn_understanding?.reconciled_response_intent;
  if (intent === "reinforce_plan_without_proof") return "tu";
  if (facts.inbound_meaning?.sms_response_intent === "reinforce_plan_and_choose_first_step") {
    return "sms_intent";
  }
  return "none";
}

export function buildStrategyCardContextFromSnapshot(args: {
  facts: InboundV3RelationshipFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
  shortAnswerPlanAck?: boolean;
}): StrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
    shortAnswerPlanAck:
      args.shortAnswerPlanAck === true
        ? true
        : resolveShortAnswerPlanAckFromInboundFacts(args.facts),
  };
}

/** @internal test helper */
export function isMissRecoveryTurnForCard(facts: InboundV3RelationshipFacts): boolean {
  return isMissRecoveryTurn({
    inboundMeaning: facts.inbound_meaning,
    finalEventType: facts.v2_accountability.final_event_type,
  });
}

/** @internal test helper */
export function deriveAdjustmentPolicyForCard(
  facts: InboundV3RelationshipFacts
): MissAdjustmentPolicyResult | null | undefined {
  return facts.miss_adjustment_policy;
}

// --- Daily C1 Strategy Card v1 (main_active_accountability + low_pressure_reactivation) ---

export type DailyC1ConversationIntent =
  | "plan_today"
  | "obstacle_recovery"
  | "reflect_pattern"
  | "protect_existing_plan"
  | "close_loop"
  | "relationship_anchor_bridge"
  | "identity_encouragement"
  | "direct_outcome_check"
  | "low_pressure_reentry"
  | "celebrate_progress_honest";

const DAILY_C1_RELATIONSHIP_ACCOUNTABILITY_TOUCH =
  "Make one natural relationship-accountability touch for today. Create an opening for the user to report progress, make a plan, name a blocker, reflect on a pattern, or take the next honest step. Do not default to a binary completion question.";

const DAILY_C1_ALLOWED_MOVES: StrategyCardMoveType[] = [
  "daily_check_in",
  "reactivate_gently",
  "protect_existing_plan",
  "close_loop",
  "ask_blocker",
  "recover_today",
  "clarify",
  "other",
];

export type DailySmsSuggestedMoveV1 = {
  move: string;
  posture: string;
  max_questions: 0 | 1;
  reason: string;
  must_not_do: string[];
  allowed_claims: { proof: boolean; victory_room: boolean };
  subordinate_to: ["authoritative_truth", "recent_exact_thread"];
};

const SUGGESTED_MOVE_MUST_NOT_DO_MAX = 3;

function pushSuggestedMustNotDo(list: string[], line: string): void {
  const t = line.trim();
  if (!t || list.length >= SUGGESTED_MOVE_MUST_NOT_DO_MAX) return;
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  list.push(t.slice(0, 120));
}

/** Writer-facing compact move from internal Daily C1 Strategy Card. */
export function buildSuggestedMoveFromDailyC1Card(
  card: StrategyCardV1,
  calibration: DailyProofCalibration | null | undefined
): DailySmsSuggestedMoveV1 {
  const must_not_do: string[] = [];

  if (calibration && !calibration.strong_commitment_claim_allowed) {
    pushSuggestedMustNotDo(
      must_not_do,
      "Do not say great commitment, strong commitment, or shown commitment"
    );
  }
  if (calibration && !calibration.consistency_claim_allowed) {
    pushSuggestedMustNotDo(
      must_not_do,
      "Do not imply consistency, on a roll, dominating, or kept showing up"
    );
  }
  for (const item of card.must_not_do) {
    pushSuggestedMustNotDo(must_not_do, item);
  }

  const maxQ = card.writer_constraints.max_questions;
  const max_questions: 0 | 1 = maxQ <= 0 ? 0 : 1;

  return {
    move: card.move.type.slice(0, 40),
    posture: card.writer_constraints.tone_posture.slice(0, 40),
    max_questions,
    reason: card.move.reason.trim().slice(0, 120),
    must_not_do: must_not_do.slice(0, SUGGESTED_MOVE_MUST_NOT_DO_MAX),
    allowed_claims: {
      proof: card.allowed_claims.proof,
      victory_room: card.allowed_claims.victory_room,
    },
    subordinate_to: ["authoritative_truth", "recent_exact_thread"],
  };
}

export function isDailyC1StrategyCardEligible(facts: DailyV3RelationshipFacts): boolean {
  if (
    facts.route_kind !== "main_active_accountability" &&
    facts.route_kind !== "low_pressure_reactivation"
  ) {
    return false;
  }
  if (facts.contract_proposal) return false;
  if (facts.accountability.contract_proposal_mode) return false;
  if (facts.pending_resolution) return false;
  if (facts.refresh) return false;
  return true;
}

export function isDailyC2StrategyCardEligible(facts: DailyV3RelationshipFacts): boolean {
  if (facts.route_kind !== "contract_prompt") return false;
  if (facts.pending_resolution) return false;
  if (facts.refresh) return false;
  const cp = facts.contract_proposal;
  if (!cp || cp.semantic_daily_contract_v1 !== true) return false;
  if (!cp.daily_contract_semantic_facts) return false;
  return true;
}

export function isDailyC3RefreshStrategyCardEligible(facts: DailyV3RelationshipFacts): boolean {
  if (facts.route_kind !== "refresh_identity" && facts.route_kind !== "refresh_commitment") {
    return false;
  }
  if (facts.pending_resolution) return false;
  if (facts.contract_proposal) return false;
  const refresh = facts.refresh;
  if (!refresh) return false;
  if (facts.route_kind === "refresh_identity") {
    if (refresh.refresh_step !== "identity_first") return false;
    const anchor =
      refresh.identity_anchor_text?.trim() ||
      facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
      facts.commitment.identity_anchor_short?.trim() ||
      "";
    return anchor.length > 0;
  }
  if (refresh.refresh_step !== "commitment_daily") return false;
  const ask =
    refresh.effective_ask_for_bar?.trim() ||
    facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
    facts.commitment.effective_ask?.trim() ||
    "";
  return ask.length > 0;
}

export function isDailyC3PendingResolutionStrategyCardEligible(
  facts: DailyV3RelationshipFacts
): boolean {
  if (facts.route_kind !== "pending_resolution") return false;
  if (!facts.pending_resolution) return false;
  if (facts.refresh) return false;
  if (facts.contract_proposal) return false;
  return true;
}

export function isDailyStrategyCardEligible(facts: DailyV3RelationshipFacts): boolean {
  return (
    isDailyC1StrategyCardEligible(facts) ||
    isDailyC2StrategyCardEligible(facts) ||
    isDailyC3RefreshStrategyCardEligible(facts) ||
    isDailyC3PendingResolutionStrategyCardEligible(facts)
  );
}

function deriveDailyOutcomeFromPriorOutcome(prior: string | null | undefined): StrategyCardOutcome {
  const p = prior?.trim();
  if (p === "user_yes") return "completed";
  if (p === "user_no") return "missed";
  if (p === "user_partial") return "partial";
  return "none";
}

function weekdayFromDayKey(dayKey: string): string | null {
  const parts = dayKey.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[date.getUTCDay()] ?? null;
}

function deriveIsNewAccountabilityDay(facts: DailyV3RelationshipFacts): boolean {
  const today = facts.accountability_day_key?.trim();
  if (!today) return true;
  const t72 = facts.thread_memory.recent_exact_thread_72h;
  if (t72?.messages?.length) {
    for (let i = t72.messages.length - 1; i >= 0; i--) {
      const m = t72.messages[i]!;
      if (m.role === "coach" && m.delivery_status === "sent" && m.local_day_key?.trim()) {
        return m.local_day_key.trim() !== today;
      }
    }
  }
  return true;
}

function deriveDailyC1LocalDayContext(facts: DailyV3RelationshipFacts): {
  local_date: string;
  local_weekday: string | null;
  user_timezone: string;
  is_new_accountability_day: boolean;
} {
  return {
    local_date: facts.accountability_day_key,
    local_weekday: weekdayFromDayKey(facts.accountability_day_key),
    user_timezone: facts.user.timezone,
    is_new_accountability_day: deriveIsNewAccountabilityDay(facts),
  };
}

/** @internal test helper — prospective when no current-day miss server truth. */
export function obstacleRecoveryUsesProspectiveFraming(
  ctx: DailyC1StrategyCardBuildContext
): boolean {
  return !dailyC1CanImplyTodayMissed({ proofPermission: ctx.proofPermission });
}

function semanticAvoidKey(prefix: string, text: string): string {
  const t = text.trim();
  if (t.length < 8) return "";
  const hash = createHash("sha256").update(t.toLowerCase()).digest("hex").slice(0, 12);
  return `${prefix}:${hash}`;
}

function hasSatisfiedRecentAsk(ctx: DailyC1StrategyCardBuildContext): boolean {
  return (
    ctx.facts.daily_satisfied_ask_context?.has_satisfied_recent_ask === true ||
    (ctx.openLoops.satisfied_asks?.length ?? 0) > 0
  );
}

export const DAILY_C1_ZERO_QUESTION_REASON = "stale_or_memory_repeat_risk" as const;

const DAILY_C1_ZERO_QUESTION_MUST_DO =
  "Do not ask a question in this SMS — give one concrete current-step, protect-plan, close-loop, or identity/accountability statement instead.";
const DAILY_C1_NOTEBOOK_FIRST_MUST_DO =
  "Read RELATIONSHIP_PACKET_V1 as the relationship notebook before writing: current goal/standard, identity, temporal_awareness_summary, recent_thread_timeline_summary_72h, stale_ask_avoidance_summary, avoid_repeating, satisfied-ask context; use relationship anchors only if naturally relevant to today's move.";
const DAILY_C1_NOTEBOOK_FRESH_TOUCH_MUST_DO =
  "Then write one fresh, human, no-question coaching touch — concrete action, protect plan, close loop, identity/accountability reminder, low-pressure reentry, or relational bridge into action when natural.";
const DAILY_C1_ZERO_QUESTION_NO_INTERROGATION =
  "Do not ask first-step, outcome, blocker, evidence, strategy, how-did-it-go, what-got-in-the-way, did-you, do-you, will-you, or can-you phrasing.";
const DAILY_C1_ZERO_QUESTION_HIDDEN_COMMANDS =
  "Do not use question-shaped commands such as tell me, let me know, reply with, name the blocker, choose one, or send me.";

function dailyC1DoNotRepeatAskCount(ctx: DailyC1StrategyCardBuildContext): number {
  return (
    (ctx.openLoops.do_not_repeat_asks?.length ?? 0) +
    (ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks?.length ?? 0)
  );
}

function dailyC1RecentCoachQuestionCount(ctx: DailyC1StrategyCardBuildContext): number {
  return (ctx.facts.thread_memory.last_5_coach_questions ?? []).filter(
    (q) => typeof q === "string" && q.trim().length >= 12
  ).length;
}

/** True when recent-thread context makes another question likely to stale-repeat or memory-block. */
export function dailyC1HasHighRepeatRisk(ctx: DailyC1StrategyCardBuildContext): boolean {
  if (hasSatisfiedRecentAsk(ctx)) return true;
  if (ctx.facts.daily_satisfied_ask_context?.stale_ask_risk === true) return true;

  const doNotRepeatCount = dailyC1DoNotRepeatAskCount(ctx);
  if (doNotRepeatCount > 0) return true;

  const recentUnanswered = (ctx.openLoops.recent_unanswered_coach_questions ?? []).filter(
    (q) => q.trim().length >= 12
  );
  if (recentUnanswered.length > 0) return true;

  const recentCoachQCount = dailyC1RecentCoachQuestionCount(ctx);
  if (recentCoachQCount > 0) return true;

  return false;
}

function dailyC1ZeroQuestionRequired(ctx: DailyC1StrategyCardBuildContext): boolean {
  return (
    ctx.facts.route_kind === "main_active_accountability" && dailyC1HasHighRepeatRisk(ctx)
  );
}

function isPlanAffirmingSatisfiedAsk(ctx: DailyC1StrategyCardBuildContext): boolean {
  const t = ctx.facts.daily_satisfied_ask_context?.satisfied_ask_type;
  if (t === "plan_detail" || t === "plan_confirmation") return true;
  if (ctx.facts.accountability.pending_plan_proof?.active === true) return true;
  const evidence = ctx.facts.daily_satisfied_ask_context?.evidence_preview?.trim() ?? "";
  return /\b(i'll|i will|plan|8pm|am|pm)\b/i.test(evidence);
}

function hasExtendedSilence(ctx: DailyC1StrategyCardBuildContext): boolean {
  const a = ctx.facts.accountability;
  const silence = ctx.noSendSilence?.silence_context;
  if (a.reentry_active || a.daily_purpose === "comeback_after_silence") return true;
  if (a.silence_tier === "quiet" || a.silence_tier === "nudge") return true;
  if ((silence?.days_since_last_user_reply ?? 0) >= 2) return true;
  if (a.unanswered_checks >= 2) return true;
  if (a.days_since_last_user_outcome >= 3) return true;
  return false;
}

function dailyC1ProofCalibration(ctx: DailyC1StrategyCardBuildContext): DailyProofCalibration | null {
  return ctx.facts.proof_calibration ?? null;
}

function isDailyProofWeakStale(ctx: DailyC1StrategyCardBuildContext): boolean {
  const cal = dailyC1ProofCalibration(ctx);
  if (!cal) return false;
  return (
    cal.recent_proof_strength === "weak_stale" ||
    (cal.praise_allowed_level === "capability_only" && (cal.proof_age_days ?? 0) >= 2)
  );
}

export function dailyC1HasRecentPositiveProgress(ctx: DailyC1StrategyCardBuildContext): boolean {
  return hasRecentPositiveProgress(ctx);
}

function hasRecentPositiveProgress(ctx: DailyC1StrategyCardBuildContext): boolean {
  const cal = dailyC1ProofCalibration(ctx);
  if (cal) {
    if (cal.praise_allowed_level === "none" || cal.praise_allowed_level === "capability_only") {
      return false;
    }
    if (cal.proof_age_days != null && cal.proof_age_days >= 2 && cal.wins_7d <= 2) {
      return false;
    }
    if (
      cal.praise_allowed_level === "specific_recent_proof" ||
      cal.praise_allowed_level === "measured_progress" ||
      cal.praise_allowed_level === "consistency" ||
      cal.praise_allowed_level === "streak"
    ) {
      return true;
    }
  }
  const a = ctx.facts.accountability;
  const proofAge = cal?.proof_age_days ?? a.days_since_last_user_outcome;
  if (a.prior_outcome === "user_yes" && proofAge <= 1) return true;
  if ((a.yes_streak_14d ?? 0) >= 3) return true;
  if (a.proof_or_milestone_signal?.trim() && proofAge <= 1) return true;
  return false;
}

function outcomeCheckAppropriate(ctx: DailyC1StrategyCardBuildContext): boolean {
  if (hasSatisfiedRecentAsk(ctx)) return false;
  if (ctx.facts.accountability.pending_plan_proof?.active === true) return true;
  if (ctx.facts.accountability.pending_plan_proof?.outcome_known === false) return true;
  if (hasExtendedSilence(ctx)) return false;
  if (ctx.facts.accountability.prior_outcome === "user_no") return true;
  if (ctx.facts.accountability.prior_outcome === "user_partial") return true;
  if ((ctx.facts.accountability.days_since_last_user_outcome ?? 0) >= 2) return true;
  return false;
}

function relationshipAnchorBridgeEligible(ctx: DailyC1StrategyCardBuildContext): boolean {
  const sources = ctx.facts.relationship_anchor_sources;
  if (!sources?.important_people?.length) return false;
  const coachBodies = [
    ...(ctx.facts.thread_memory.last_5_coach_questions ?? []),
    ctx.facts.thread_memory.latest_outbound_sms ?? "",
  ].filter((b) => typeof b === "string" && b.trim().length > 0) as string[];
  const anchors = buildRelationshipAnchors({
    sources,
    timezone: ctx.facts.user.timezone,
    lastCoachMessages: ctx.facts.thread_memory.last_5_coach_questions,
    recentCoachThreadBodies: coachBodies,
  });
  if (!anchors.length) return false;
  const recentlyUsed = detectRecentlyUsedRelationshipAnchorKeys({
    anchors,
    coachBodies,
  });
  return anchors.some((a) => !recentlyUsed.includes(a.anchor_key) && !a.last_coach_referenced_at);
}

export function selectDailyC1ConversationIntent(
  ctx: DailyC1StrategyCardBuildContext
): DailyC1ConversationIntent {
  const { facts } = ctx;

  if (facts.route_kind === "low_pressure_reactivation") {
    return "low_pressure_reentry";
  }

  if (facts.accountability.pending_plan_proof?.active === true) {
    return "protect_existing_plan";
  }

  if (dailyC1IsCurrentDayMiss({ facts, proofPermission: ctx.proofPermission })) {
    return "obstacle_recovery";
  }

  if (hasSatisfiedRecentAsk(ctx)) {
    if (isPlanAffirmingSatisfiedAsk(ctx)) {
      return facts.accountability.pending_plan_proof?.active ? "protect_existing_plan" : "plan_today";
    }
    return "close_loop";
  }

  if (facts.accountability.blocker_preview?.trim()) {
    return "obstacle_recovery";
  }

  if (relationshipAnchorBridgeEligible(ctx)) {
    return "relationship_anchor_bridge";
  }

  if (hasExtendedSilence(ctx)) {
    return "plan_today";
  }

  if (isDailyProofWeakStale(ctx)) {
    if (ctx.facts.accountability.prior_outcome === "user_no") {
      return "obstacle_recovery";
    }
    return ctx.facts.accountability.prior_outcome === "user_partial" ? "reflect_pattern" : "plan_today";
  }

  if (hasRecentPositiveProgress(ctx)) {
    return ctx.proofPermission.can_claim_proof ? "celebrate_progress_honest" : "identity_encouragement";
  }

  if (outcomeCheckAppropriate(ctx)) {
    if (dailyC1HasHighRepeatRisk(ctx)) {
      return "plan_today";
    }
    return "direct_outcome_check";
  }

  if (
    ctx.proofPermission.can_claim_partial ||
    (facts.accountability.prior_outcome === "user_partial" &&
      facts.accountability.days_since_last_user_outcome === 0)
  ) {
    return "reflect_pattern";
  }

  return "plan_today";
}

export function mapDailyC1IntentToMoveType(
  intent: DailyC1ConversationIntent,
  ctx: DailyC1StrategyCardBuildContext
): StrategyCardMoveType {
  switch (intent) {
    case "low_pressure_reentry":
      return "reactivate_gently";
    case "protect_existing_plan":
      return "protect_existing_plan";
    case "close_loop":
      return "close_loop";
    case "obstacle_recovery":
      return ctx.facts.accountability.blocker_preview?.trim() ? "ask_blocker" : "recover_today";
    case "direct_outcome_check":
      return "daily_check_in";
    case "celebrate_progress_honest":
    case "identity_encouragement":
    case "plan_today":
    case "reflect_pattern":
    case "relationship_anchor_bridge":
      return "recover_today";
    default:
      return "recover_today";
  }
}

function collectDailyAvoidRepeating(ctx: DailyC1StrategyCardBuildContext): string[] {
  const items: string[] = [];

  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const sk = semanticAvoidKey("do_not_reask", ask);
    if (sk) items.push(sk);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const sk = semanticAvoidKey("satisfied_ask", s.ask_text ?? "");
    if (sk) items.push(sk);
  }
  for (const ask of ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks ?? []) {
    const sk = semanticAvoidKey("satisfied_ask", ask);
    if (sk) items.push(sk);
  }

  const coachBodies = [
    ...(ctx.facts.thread_memory.last_5_coach_questions ?? []),
    ctx.facts.thread_memory.latest_outbound_sms ?? "",
  ].filter((b) => typeof b === "string" && b.trim().length > 0) as string[];
  const anchors = buildRelationshipAnchors({
    sources: ctx.facts.relationship_anchor_sources,
    timezone: ctx.facts.user.timezone,
    lastCoachMessages: ctx.facts.thread_memory.last_5_coach_questions,
    recentCoachThreadBodies: coachBodies,
  });
  const recentlyUsed = detectRecentlyUsedRelationshipAnchorKeys({ anchors, coachBodies });
  for (const fp of relationshipAnchorAvoidRepeatingFingerprints(recentlyUsed)) {
    items.push(fp);
  }

  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const fp = fingerprintAsk(s.ask_text ?? "");
    if (fp) items.push(fp);
  }
  for (const ask of ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const q of ctx.facts.thread_memory.last_5_coach_questions ?? []) {
    const sk = semanticAvoidKey("recent_coach_question", q);
    if (sk) items.push(sk);
    const fp = fingerprintAsk(q);
    if (fp) items.push(fp);
  }

  for (const coachBody of ctx.facts.thread_memory.recent_coach_body_do_not_repeat ?? []) {
    const preview = coachBody.body_preview?.trim() || coachBody.body?.trim();
    if (!preview) continue;
    const sk = semanticAvoidKey("recent_coach_body", preview);
    if (sk) items.push(sk);
  }

  for (const item of ctx.facts.fresh_move?.recent_cta_do_not_repeat ?? []) {
    const sk = semanticAvoidKey("recent_cta", item.phrase);
    if (sk) items.push(sk);
  }
  for (const item of ctx.facts.fresh_move?.recent_advice_do_not_repeat ?? []) {
    const sk = semanticAvoidKey("recent_advice", item.phrase);
    if (sk) items.push(sk);
  }

  return [...new Set(items)].slice(0, MAX_AVOID_REPEATING);
}

function selectDailyC1MainMoveType(
  ctx: DailyC1StrategyCardBuildContext,
  intent: DailyC1ConversationIntent
): StrategyCardMoveType {
  return mapDailyC1IntentToMoveType(intent, ctx);
}

function intentAllowsZeroQuestions(intent: DailyC1ConversationIntent): boolean {
  return (
    intent === "close_loop" ||
    intent === "protect_existing_plan" ||
    intent === "identity_encouragement" ||
    intent === "celebrate_progress_honest" ||
    intent === "relationship_anchor_bridge" ||
    intent === "plan_today"
  );
}

function buildDailyC1AllowedClaims(
  ctx: DailyC1StrategyCardBuildContext,
  outcome: StrategyCardOutcome
): StrategyCardV1["allowed_claims"] {
  const p = ctx.proofPermission;
  if (ctx.facts.route_kind === "low_pressure_reactivation") {
    return {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    };
  }
  return {
    completion: outcome === "completed" && p.can_claim_completion,
    miss: outcome === "missed" && p.can_claim_miss,
    partial: outcome === "partial" && p.can_claim_partial,
    proof: p.can_claim_proof,
    victory_room: p.can_reference_victory_room,
    state_changed: false,
    proposal_active: false,
  };
}

function buildDailyC1MustDoMustNotDo(args: {
  moveType: StrategyCardMoveType;
  intent: DailyC1ConversationIntent;
  ctx: DailyC1StrategyCardBuildContext;
  zeroQuestionRequired?: boolean;
}): { must_do: string[]; must_not_do: string[] } {
  const { moveType, intent, ctx } = args;
  const zeroQuestionRequired = args.zeroQuestionRequired === true;
  const must_do: string[] = [];
  const must_not_do: string[] = [
    "Do not claim proof or Victory Room unless allowed_claims permits it.",
    "Do not claim server-side state changed or an active proposal.",
    ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO,
    DAILY_TODAY_NOT_RENEWAL_MUST_NOT_DO,
  ];

  const recentCoachBodies = ctx.facts.thread_memory.recent_coach_body_do_not_repeat ?? [];
  if (recentCoachBodies.length > 0) {
    must_not_do.push(
      "Do not repeat or lightly paraphrase prior coach SMS from the last 72 hours.",
      "Do not reuse yesterday's same next action or CTA when no new proof changes it."
    );
    must_do.push(
      "Choose a fresh honest coaching move grounded in current goal and recent thread — not a light paraphrase of prior coach SMS."
    );
  }

  const cal = dailyC1ProofCalibration(ctx);
  if (cal) {
    if (cal.consistency_claim_allowed === false) {
      must_not_do.push(
        "Do not say great commitment or strong commitment.",
        "Do not say consistent, on a roll, dominating, or kept showing up.",
        "Do not imply repeated follow-through beyond what proof allows.",
        ...(cal.proof_age_days != null && cal.proof_age_days > 1
          ? ["Do not say recently completed unless proof_age_days <= 1 and wording is precise."]
          : [])
      );
    }
    if (cal.praise_allowed_level === "capability_only") {
      must_do.push(
        "You may say the user has shown they can do it — then pivot to today's next honest win."
      );
      must_not_do.push("Do not praise consistency or measured progress on stale weak proof.");
    }
    if (cal.praise_allowed_level === "none") {
      must_not_do.push("Do not praise proof, consistency, or commitment on this turn.");
    }
    for (const item of ctx.facts.fresh_move?.recent_cta_do_not_repeat ?? []) {
      must_not_do.push(`Do not reuse CTA/advice: "${item.phrase}".`);
    }
    for (const item of ctx.facts.fresh_move?.recent_advice_do_not_repeat ?? []) {
      must_not_do.push(`Do not reuse advice/tool: "${item.phrase}".`);
    }
    if (ctx.facts.fresh_move?.fresh_move_required) {
      must_do.push("Choose a fresh honest move — do not repeat recent CTA/advice from prior coach SMS.");
    }
  }

  if (zeroQuestionRequired) {
    must_do.unshift(
      DAILY_C1_NOTEBOOK_FRESH_TOUCH_MUST_DO,
      DAILY_C1_NOTEBOOK_FIRST_MUST_DO,
      DAILY_C1_ZERO_QUESTION_MUST_DO
    );
    must_not_do.push(
      DAILY_C1_ZERO_QUESTION_NO_INTERROGATION,
      DAILY_C1_ZERO_QUESTION_HIDDEN_COMMANDS,
      "Do not force a yes/no reply."
    );
  }

  if (ctx.facts.route_kind === "low_pressure_reactivation") {
    must_do.push("Low-pressure re-entry — one natural question at most.");
    must_do.push("Acknowledge quiet context only when appropriate, without guilt.");
    must_not_do.push("Do not scold or imply the user ignored undelivered messages.");
    must_not_do.push("Do not claim completion, miss, partial, or proof on this turn.");
    must_not_do.push(REACTIVATION_SPECIFIC_STEP_NOT_RENEWAL_MUST_NOT_DO);
  } else if (intent === "direct_outcome_check") {
    must_do.push(DAILY_C1_RELATIONSHIP_ACCOUNTABILITY_TOUCH);
    if (zeroQuestionRequired) {
      must_do.push(
        "Use a concrete accountability statement — direct outcome interrogation is not appropriate when repeat risk is high."
      );
      must_not_do.push("Do not ask a direct outcome check question on this turn.");
    } else {
      must_do.push("One natural direct outcome check is allowed when prior outcome is still unknown.");
      must_not_do.push("Do not stack multiple interrogation questions.");
    }
  } else {
    must_do.push(DAILY_C1_RELATIONSHIP_ACCOUNTABILITY_TOUCH);
    if (zeroQuestionRequired) {
      must_do.push("Ground the touch in notebook context — do not invent facts beyond the packet.");
    } else if (intentAllowsZeroQuestions(intent)) {
      must_do.push("Zero questions is allowed — encouragement, planning, or close-loop is fine.");
    }
  }

  switch (intent) {
    case "plan_today":
      if (zeroQuestionRequired) {
        must_do.push(
          "Give one concrete protect-plan or action statement for today — no planning question."
        );
      } else {
        must_do.push("Help identify today's realistic first step or window.");
      }
      must_not_do.push("Do not ask if they already completed unless direct_outcome_check was intended.");
      break;
    case "obstacle_recovery":
      if (obstacleRecoveryUsesProspectiveFraming(ctx)) {
        if (zeroQuestionRequired) {
          must_do.push(
            "Name a prospective blocker or concrete action frame for today — no blocker interrogation."
          );
        } else {
          must_do.push("Name or explore what might get in the way today.");
        }
        must_do.push(
          "If referencing a prior miss, use yesterday or last time — not today-failure wording."
        );
        must_not_do.push(
          "Do not imply today already failed or ask what held them back today unless allowed_claims.miss is true."
        );
        must_not_do.push(
          "Do not use what got in the way today, what held you back today, why didn't you today, or what stopped you today."
        );
      } else {
        if (zeroQuestionRequired) {
          must_do.push(
            "Acknowledge today's blocker with a concrete next-move statement — avoid repeating the exact blocker question."
          );
        } else {
          must_do.push("Name or explore today's likely blocker without shame.");
        }
        must_not_do.push("Do not imply failure beyond what allowed_claims.miss permits.");
      }
      break;
    case "reflect_pattern":
      must_do.push("Help notice what usually makes this goal work or slip.");
      must_not_do.push("Do not turn this into unrelated therapy or chit-chat.");
      break;
    case "protect_existing_plan":
      if (zeroQuestionRequired) {
        must_do.push("Protect the stated plan with a concrete accountability statement — no question.");
      } else {
        must_do.push("Acknowledge and protect the current plan.");
      }
      must_not_do.push("Do not add new obligations unless the user invited them.");
      break;
    case "close_loop":
      if (zeroQuestionRequired) {
        must_do.push(
          "Acknowledge the prior answer and close the loop with a concrete statement — no new question."
        );
      } else {
        must_do.push("Acknowledge the prior answer and close the loop.");
      }
      must_not_do.push("Do not ask the same satisfied question again.");
      break;
    case "relationship_anchor_bridge":
      if (zeroQuestionRequired) {
        must_do.push(
          "You may use at most one relationship anchor only if it bridges into a concrete action for today's goal."
        );
        must_not_do.push("Do not ask a standalone person question or opener.");
      } else {
        must_do.push("You may use at most one relationship anchor only if it bridges into today's goal.");
        must_not_do.push("Do not open with standalone person chit-chat.");
      }
      must_not_do.push("Do not use guilt, shame, or pride pressure via a person.");
      break;
    case "identity_encouragement":
      must_do.push("Connect today's move to who they are becoming.");
      must_not_do.push("Do not use generic motivational fluff.");
      break;
    case "celebrate_progress_honest":
      must_do.push("Acknowledge honest progress within allowed_claims only.");
      must_not_do.push("Do not invent proof or Victory Room.");
      break;
    case "low_pressure_reentry":
      break;
    case "direct_outcome_check":
      break;
  }

  if (moveType === "ask_blocker" && intent === "obstacle_recovery") {
    must_do.push("Use known blocker context from facts.");
    must_not_do.push("Do not propose goal change on this turn.");
  }

  must_not_do.push("Do not re-ask satisfied questions from avoid_repeating.");
  if (hasSatisfiedRecentAsk(ctx)) {
    const satisfiedLines = [
      "Do not repeat or paraphrase satisfied coach asks.",
      "Do not use How did X go as a paraphrase re-ask.",
    ];
    if (zeroQuestionRequired) {
      must_not_do.unshift(...satisfiedLines);
    } else {
      must_not_do.push(...satisfiedLines);
    }
  }

  const mustDoLimit = zeroQuestionRequired ? 7 : MAX_MUST_DO;
  const mustNotDoLimit = zeroQuestionRequired ? 11 : MAX_MUST_NOT_DO;

  return {
    must_do: must_do.slice(0, mustDoLimit),
    must_not_do: [...new Set(must_not_do)].slice(0, mustNotDoLimit),
  };
}

function resolveDailyC1TonePosture(args: {
  facts: DailyV3RelationshipFacts;
  moveType: StrategyCardMoveType;
}): StrategyCardTonePosture {
  if (args.facts.route_kind === "low_pressure_reactivation") {
    return "gentle_reentry";
  }
  if (
    args.facts.accountability.reentry_active ||
    args.facts.accountability.daily_purpose === "comeback_after_silence"
  ) {
    return "warm_direct";
  }
  return "warm_direct";
}

export function buildDailyC1StrategyCardContextFromSnapshot(args: {
  facts: DailyV3RelationshipFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
}): DailyC1StrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
  };
}

function dailyC1MoveReason(
  intent: DailyC1ConversationIntent,
  moveType: StrategyCardMoveType,
  ctx: DailyC1StrategyCardBuildContext
): string {
  const byIntent: Partial<Record<DailyC1ConversationIntent, string>> = {
    low_pressure_reentry: "Low-pressure reactivation — gentle re-entry without outcome claims.",
    protect_existing_plan: "Protect the user's stated plan before a fresh check.",
    close_loop: "Prior ask was answered — close the loop without re-asking.",
    obstacle_recovery: obstacleRecoveryUsesProspectiveFraming(ctx)
      ? "Explore what might get in the way today."
      : "Explore what got in the way today.",
    plan_today: "Relationship-first touch — help shape today's realistic step.",
    reflect_pattern: "Reflect on what makes this goal work or slip.",
    relationship_anchor_bridge: "Bridge optional relationship context into today's move.",
    identity_encouragement: "Encourage identity-aligned progress without interrogation.",
    celebrate_progress_honest: "Acknowledge honest progress within allowed claims.",
    direct_outcome_check: "Direct outcome check when prior result is still unknown.",
  };
  return (
    byIntent[intent] ??
    (moveType === "protect_existing_plan"
      ? "Close pending plan loop before a fresh accountability check."
      : moveType === "ask_blocker"
        ? "Daily touch with known blocker context."
        : "Relationship-first daily accountability touch.")
  );
}

export function buildDailyC1StrategyCardV1(args: {
  ctx: DailyC1StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const isReactivation = facts.route_kind === "low_pressure_reactivation";
  const outcome = deriveDailyOutcomeFromPriorOutcome(facts.accountability.prior_outcome);
  const conversationIntent = selectDailyC1ConversationIntent(ctx);
  const moveType = isReactivation
    ? "reactivate_gently"
    : selectDailyC1MainMoveType(ctx, conversationIntent);
  const legacyMove = facts.suggested_coaching_move?.trim() || null;
  const legacyType = mapLegacyMoveToType(legacyMove ?? undefined);
  const legacyUsed = legacyType != null && legacyType === moveType;
  const legacyReplaced = legacyType != null && legacyType !== moveType && legacyMove;
  const localDay = deriveDailyC1LocalDayContext(facts);
  const highRepeatRisk = dailyC1HasHighRepeatRisk(ctx);
  const zeroQuestionRequired = dailyC1ZeroQuestionRequired(ctx);

  const { must_do, must_not_do } = buildDailyC1MustDoMustNotDo({
    moveType,
    intent: conversationIntent,
    ctx,
    zeroQuestionRequired,
  });
  const avoid_repeating = collectDailyAvoidRepeating(ctx);
  const allowed = buildDailyC1AllowedClaims(ctx, outcome);
  const satisfiedFingerprints = (ctx.openLoops.satisfied_asks ?? [])
    .map((s) => fingerprintAsk(s.ask_text ?? ""))
    .filter(Boolean)
    .slice(0, MAX_AVOID_REPEATING);

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "daily",
    route_kind: facts.route_kind as DailyC1StrategyCardRouteKind,
    turn_kind: facts.accountability.daily_purpose ?? facts.route_kind,
    server_truth_summary: {
      outcome,
      explicit_user_truth: outcome !== "none" && outcome !== "unclear",
      active_pending_kinds: activePendingKinds(ctx.activePending),
      satisfied_ask_fingerprints: satisfiedFingerprints,
      daily_route_kind: facts.route_kind,
      daily_server_strategy: facts.accountability.server_strategy ?? null,
      daily_purpose: facts.accountability.daily_purpose ?? null,
      daily_prior_outcome: outcome,
      daily_pending_plan_proof_active: facts.accountability.pending_plan_proof?.active === true,
      daily_reactivation: isReactivation,
      daily_silence_tier: facts.accountability.silence_tier ?? null,
      daily_conversation_intent: conversationIntent,
      local_date: localDay.local_date,
      local_weekday: localDay.local_weekday,
      user_timezone: localDay.user_timezone,
      is_new_accountability_day: localDay.is_new_accountability_day,
      daily_high_repeat_risk: highRepeatRisk,
      daily_zero_question_required: zeroQuestionRequired,
      daily_zero_question_reason: zeroQuestionRequired
        ? DAILY_C1_ZERO_QUESTION_REASON
        : null,
      ...(ctx.facts.proof_calibration
        ? {
            daily_proof_wins_7d: ctx.facts.proof_calibration.wins_7d,
            daily_proof_age_days: ctx.facts.proof_calibration.proof_age_days,
            daily_praise_allowed_level: ctx.facts.proof_calibration.praise_allowed_level,
            daily_consistency_claim_allowed: ctx.facts.proof_calibration.consistency_claim_allowed,
            daily_fresh_move_required: ctx.facts.fresh_move?.fresh_move_required ?? false,
          }
        : {}),
    },
    move: {
      type: moveType,
      priority: isReactivation ? "low" : "normal",
      confidence: "high",
      reason: truncateText(dailyC1MoveReason(conversationIntent, moveType, ctx), MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: zeroQuestionRequired ? 0 : 1,
      avoid_repeating,
      tone_posture: resolveDailyC1TonePosture({ facts, moveType }),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: legacyMove,
      legacy_coaching_move_source: "rule_derived",
      legacy_server_strategy: facts.accountability.server_strategy ?? null,
      legacy_next_move_type: facts.accountability.next_move_type ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

export function validateDailyC1StrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC1StrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (card.surface !== "daily") reasons.push("surface_not_daily");
  if (
    card.route_kind !== "main_active_accountability" &&
    card.route_kind !== "low_pressure_reactivation"
  ) {
    reasons.push("daily_c1_route_kind_invalid");
  }
  if (!DAILY_C1_ALLOWED_MOVES.includes(card.move.type)) {
    reasons.push("daily_c1_forbidden_move");
  }
  if (card.route_kind === "low_pressure_reactivation" && card.move.type !== "reactivate_gently") {
    reasons.push("reactivation_move_mismatch");
  }
  if (card.allowed_claims.proposal_active || card.allowed_claims.state_changed) {
    reasons.push("daily_c1_forbidden_claim");
  }
  if (card.allowed_claims.proof && !ctx.proofPermission.can_claim_proof) {
    reasons.push("proof_not_permitted");
  }
  if (card.allowed_claims.victory_room && !ctx.proofPermission.can_reference_victory_room) {
    reasons.push("victory_room_not_permitted");
  }
  if (card.allowed_claims.completion && !ctx.proofPermission.can_claim_completion) {
    reasons.push("completion_not_permitted");
  }
  if (card.allowed_claims.miss && !ctx.proofPermission.can_claim_miss) {
    reasons.push("miss_not_permitted");
  }
  if (card.allowed_claims.partial && !ctx.proofPermission.can_claim_partial) {
    reasons.push("partial_not_permitted");
  }
  if (
    card.route_kind === "low_pressure_reactivation" &&
    (card.allowed_claims.completion ||
      card.allowed_claims.miss ||
      card.allowed_claims.partial ||
      card.allowed_claims.proof ||
      card.allowed_claims.victory_room)
  ) {
    reasons.push("reactivation_outcome_claim_forbidden");
  }
  if (
    card.route_kind === "low_pressure_reactivation" &&
    card.writer_constraints.tone_posture !== "gentle_reentry" &&
    card.writer_constraints.tone_posture !== "low_pressure"
  ) {
    reasons.push("reactivation_tone_invalid");
  }
  if (card.route_kind === "low_pressure_reactivation" && card.writer_constraints.max_questions > 1) {
    reasons.push("reactivation_max_questions_exceeded");
  }
  const hasSatisfied =
    (ctx.openLoops.satisfied_asks?.length ?? 0) > 0 ||
    (ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks?.length ?? 0) > 0;
  if (hasSatisfied && card.writer_constraints.avoid_repeating.length === 0) {
    reasons.push("missing_satisfied_avoid_repeating");
  }
  if (
    hasSatisfied &&
    card.server_truth_summary.daily_conversation_intent === "direct_outcome_check"
  ) {
    reasons.push("satisfied_ask_direct_outcome_forbidden");
  }
  if (
    card.must_do.some((m) =>
      /ask about today's commitment \/ accountability/i.test(m)
    )
  ) {
    reasons.push("legacy_checkbox_must_do");
  }
  for (const item of card.must_do) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_must_do");
    }
  }
  if (card.move.reason.length > MAX_REASON_CHARS) {
    reasons.push("reason_too_long");
  }

  return { valid: reasons.length === 0, reasons };
}

function repairDailyC1Card(
  card: StrategyCardV1,
  ctx: DailyC1StrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildDailyC1StrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function validateAndRepairDailyC1StrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC1StrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateDailyC1StrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairDailyC1Card(card, ctx, first.reasons);
  const second = validateDailyC1StrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

/** Writer strategy prose demoted when Daily C1 Strategy Card is active. */
export function buildDailyC1StrategyCardDemotedPromptRules(): string {
  return `
RELATIONSHIP-FIRST DAILY (one continuous coaching relationship — not a daily checkbox bot):
- At most one question in the SMS; zero questions is okay when closing, protecting, encouraging, or planning.
- When strategy_card_high_repeat_risk or strategy_card_zero_question_required is true, read RELATIONSHIP_PACKET_V1 as the relationship notebook first (goal, identity, temporal awareness, recent thread timeline, stale/do-not-repeat context), then write one fresh no-question coaching touch — not another question or question-shaped command.
- Do NOT ask the same question as any entry in structured_recent_truth.last_5_coach_questions unless the user clearly has not answered and you briefly acknowledge that.
- If structured_recent_truth, stale_ask_avoidance_summary, or daily_satisfied_ask_context shows the user already satisfied a prior coach ask, do NOT repeat or paraphrase do_not_repeat_asks — no "How did X go?" paraphrase re-asks.
- Make a fresh current-step, plan, obstacle, identity, or relationship-bridge move instead of another outcome interrogation.
- Do not use "Welcome back" unless accountability.reentry_active is true or silence context truly warrants a comeback line.
- If facts say reentry/comeback after silence, acknowledge return briefly before the next move.
${buildDailyTemporalAwarenessPromptGuidance()}`;
}

// --- Daily C2 Strategy Card v1 (contract_prompt semantic shrink_ask + recommit_same) ---

const DAILY_C2_ALLOWED_MOVES: StrategyCardMoveType[] = ["contract_proposal"];

const C2_MUST_NOT_GOAL_CHANGED = "Do not claim the goal, commitment, or bar already changed or is now active.";
const C2_MUST_NOT_ACCEPTED = "Do not claim the user already accepted the proposal or that it is active.";
const C2_MUST_NOT_ACTIVE = "Do not claim the proposal or overlay is already active or applied.";
const C2_MUST_NOT_ROBOTIC = "Do not use robotic menu consent copy (Reply YES, Reply NO, YES to confirm, etc.).";

function deriveDailyC2RequiredMeaning(kind: DailyContractProposalKind): string {
  if (kind === "shrink_ask") {
    return "Propose a smaller or tighter bar as an offer — not already applied.";
  }
  return "Present the server-authorized same-bar continuity decision in natural coaching language — not already accepted or active.";
}

function deriveDailyC2BarFingerprint(sem: DailySemanticContractProposalFactsPacket): string | null {
  const source =
    sem.proposal_kind === "shrink_ask"
      ? (sem.proposed_overlay_ask?.trim() || sem.proposed_behavior_preview.trim())
      : sem.proposed_behavior_preview.trim() || sem.base_behavior_statement.trim();
  return source ? fingerprintAsk(source) : null;
}

function collectDailyC2AvoidRepeating(ctx: DailyC2StrategyCardBuildContext): string[] {
  const items: string[] = [];
  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const fp = fingerprintAsk(s.ask_text ?? "");
    if (fp) items.push(fp);
  }
  for (const ask of ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const q of ctx.facts.thread_memory.last_5_coach_questions ?? []) {
    const fp = fingerprintAsk(q);
    if (fp) items.push(fp);
  }
  const barFp = deriveDailyC2BarFingerprint(ctx.semanticFacts);
  if (barFp) items.push(barFp);
  return [...new Set(items)].slice(0, MAX_AVOID_REPEATING);
}

function buildDailyC2MustDoMustNotDo(
  kind: DailyContractProposalKind
): { must_do: string[]; must_not_do: string[] } {
  const must_not_do = [
    C2_MUST_NOT_GOAL_CHANGED,
    C2_MUST_NOT_ACCEPTED,
    C2_MUST_NOT_ACTIVE,
    C2_MUST_NOT_ROBOTIC,
    CONTRACT_BAR_SPECIFIC_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO,
    "Do not claim proof or Victory Room on this contract proposal turn.",
    "Do not invent a different bar or obligation than semantic proposal facts describe.",
  ];
  const must_do: string[] = [
    "Present this as a proposal or offer — server state has not changed yet.",
    "Use structured proposal semantics for bar meaning — do not paraphrase into a different obligation.",
    "One natural conversational question or closing cue at most.",
  ];
  if (kind === "shrink_ask") {
    must_do.push("Present the smaller or tighter bar as a proposal the user may try.");
    must_do.push("Preserve proposed bar meaning from semantic facts.");
    must_do.push("Ask naturally whether they want to try this bar.");
    must_not_do.push("Do not claim the new smaller bar is already active.");
  } else {
    must_do.push(
      "Present same-bar continuity in natural coaching language only if still needed."
    );
    must_do.push(
      "Preserve current bar meaning; let the user accept, decline, or adjust in natural coaching language."
    );
    must_not_do.push("Do not use recommit or Would you like to recommit in visible SMS.");
    must_not_do.push(
      "Do not re-ask same-bar consent when the recent thread already affirms the plan."
    );
    must_not_do.push(
      "Do not claim the same-bar proposal is accepted or active before the user confirms."
    );
  }
  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function resolveDailyC2TonePosture(kind: DailyContractProposalKind): StrategyCardTonePosture {
  return kind === "shrink_ask" ? "contract_precise" : "warm_direct";
}

export function buildDailyC2StrategyCardContextFromSnapshot(args: {
  facts: DailyV3RelationshipFacts;
  snapshot: {
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
  };
}): DailyC2StrategyCardBuildContext {
  const sem = args.facts.contract_proposal!.daily_contract_semantic_facts!;
  return {
    facts: args.facts,
    semanticFacts: sem,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
  };
}

export function buildDailyC2StrategyCardV1(args: {
  ctx: DailyC2StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts, semanticFacts: sem } = ctx;
  const kind = sem.proposal_kind;
  const legacyMove = facts.suggested_coaching_move?.trim() || null;
  const { must_do, must_not_do } = buildDailyC2MustDoMustNotDo(kind);
  const avoid_repeating = collectDailyC2AvoidRepeating(ctx);
  const barFingerprint = deriveDailyC2BarFingerprint(sem);
  const requiredMeaning = deriveDailyC2RequiredMeaning(kind);
  const reason =
    kind === "shrink_ask"
      ? "Semantic daily contract — propose a smaller bar without claiming it is active."
      : "Semantic daily contract — same-bar continuity offer without claiming state changed.";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "daily",
    route_kind: "contract_prompt",
    turn_kind: facts.accountability.daily_purpose ?? "contract_overlay_proposal",
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      active_pending_kinds: [],
      satisfied_ask_fingerprints: [],
      daily_route_kind: facts.route_kind,
      daily_server_strategy: facts.accountability.server_strategy ?? null,
      daily_purpose: facts.accountability.daily_purpose ?? null,
      daily_contract_proposal_kind: kind,
      daily_contract_proposal_pending_before_sms: false,
      daily_contract_must_not_claim_goal_updated: sem.must_not_claim_goal_updated,
      daily_contract_required_bar_fingerprint: barFingerprint,
      daily_contract_required_meaning: requiredMeaning,
    },
    move: {
      type: "contract_proposal",
      priority: "normal",
      confidence: "high",
      reason: truncateText(reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    },
    writer_constraints: {
      max_questions: 1,
      avoid_repeating,
      tone_posture: resolveDailyC2TonePosture(kind),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: legacyMove,
      legacy_coaching_move_source: "rule_derived",
      legacy_server_strategy: facts.accountability.server_strategy ?? null,
      legacy_next_move_type: facts.accountability.next_move_type ?? null,
      legacy_v2_contract_proposal_kind: kind,
    },
  };
}

function mustNotDoIncludesC2CoreConstraints(must_not_do: string[]): boolean {
  const joined = must_not_do.join(" ").toLowerCase();
  return (
    joined.includes("goal") &&
    joined.includes("changed") &&
    joined.includes("accepted") &&
    joined.includes("reply yes")
  );
}

function mustDoIncludesC2ProposalMeaning(must_do: string[], kind: DailyContractProposalKind): boolean {
  const joined = must_do.join(" ").toLowerCase();
  if (kind === "shrink_ask") {
    return joined.includes("proposal") && joined.includes("semantic");
  }
  return joined.includes("same-bar") && joined.includes("semantic");
}

export function validateDailyContractPromptStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC2StrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const semKind = ctx.semanticFacts.proposal_kind;

  if (card.surface !== "daily") reasons.push("surface_not_daily");
  if (card.route_kind !== "contract_prompt") reasons.push("daily_c2_route_kind_invalid");
  if (card.move.type !== "contract_proposal") reasons.push("daily_c2_forbidden_move");
  if (!DAILY_C2_ALLOWED_MOVES.includes(card.move.type)) reasons.push("daily_c2_move_not_allowed");
  if (card.server_truth_summary.daily_contract_proposal_kind !== semKind) {
    reasons.push("daily_c2_proposal_kind_mismatch");
  }
  if (card.allowed_claims.proposal_active || card.allowed_claims.state_changed) {
    reasons.push("daily_c2_forbidden_claim");
  }
  if (
    card.allowed_claims.completion ||
    card.allowed_claims.miss ||
    card.allowed_claims.partial ||
    card.allowed_claims.proof ||
    card.allowed_claims.victory_room
  ) {
    reasons.push("daily_c2_outcome_claim_forbidden");
  }
  if (card.server_truth_summary.daily_contract_proposal_pending_before_sms !== false) {
    reasons.push("daily_c2_proposal_pending_must_be_false");
  }
  if (card.writer_constraints.max_questions > 1) reasons.push("daily_c2_max_questions_exceeded");
  if (!mustNotDoIncludesC2CoreConstraints(card.must_not_do)) {
    reasons.push("daily_c2_missing_core_must_not_do");
  }
  if (!mustDoIncludesC2ProposalMeaning(card.must_do, semKind)) {
    reasons.push("daily_c2_missing_proposal_must_do");
  }
  for (const item of [...card.must_do, ...card.must_not_do, card.move.reason]) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_card");
    }
  }
  if (card.move.reason.length > MAX_REASON_CHARS) reasons.push("reason_too_long");

  return { valid: reasons.length === 0, reasons };
}

function repairDailyC2Card(
  card: StrategyCardV1,
  ctx: DailyC2StrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildDailyC2StrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function validateAndRepairDailyContractPromptStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC2StrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateDailyContractPromptStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairDailyC2Card(card, ctx, first.reasons);
  const second = validateDailyContractPromptStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

// --- Daily C3 refresh Strategy Card v1 (refresh_identity + refresh_commitment) ---

const DAILY_C3_REFRESH_ALLOWED_MOVES: StrategyCardMoveType[] = [
  "refresh_identity",
  "refresh_commitment",
];

function summarizeDailyRefreshStep(
  refreshStep: DailyV3RelationshipFacts["refresh"] extends infer R
    ? R extends { refresh_step: infer S }
      ? S
      : never
    : never
): DailyRefreshStepSummary | null {
  if (refreshStep === "identity_first") return "identity";
  if (refreshStep === "commitment_daily") return "commitment";
  return null;
}

function deriveRefreshIdentityAnchorFingerprint(ctx: DailyC3RefreshStrategyCardBuildContext): string | null {
  const source =
    ctx.facts.refresh?.identity_anchor_text?.trim() ||
    ctx.facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
    ctx.facts.commitment.identity_anchor_short?.trim() ||
    "";
  return source ? fingerprintAsk(source) : null;
}

function deriveRefreshCommitmentAskFingerprint(ctx: DailyC3RefreshStrategyCardBuildContext): string | null {
  const source =
    ctx.facts.refresh?.effective_ask_for_bar?.trim() ||
    ctx.facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
    ctx.facts.commitment.effective_ask?.trim() ||
    "";
  return source ? fingerprintAsk(source) : null;
}

function collectDailyC3RefreshAvoidRepeating(ctx: DailyC3RefreshStrategyCardBuildContext): string[] {
  const items: string[] = [];
  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const fp = fingerprintAsk(s.ask_text ?? "");
    if (fp) items.push(fp);
  }
  for (const ask of ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const q of ctx.facts.thread_memory.last_5_coach_questions ?? []) {
    const fp = fingerprintAsk(q);
    if (fp) items.push(fp);
  }
  const anchorFp = deriveRefreshIdentityAnchorFingerprint(ctx);
  const askFp = deriveRefreshCommitmentAskFingerprint(ctx);
  if (anchorFp) items.push(anchorFp);
  if (askFp) items.push(askFp);
  for (const v of ctx.facts.constraints.required_verbatim_substrings ?? []) {
    const fp = fingerprintAsk(v);
    if (fp) items.push(fp);
  }
  return [...new Set(items)].slice(0, MAX_AVOID_REPEATING);
}

function buildDailyC3RefreshMustDoMustNotDo(
  routeKind: DailyC3RefreshStrategyCardRouteKind
): { must_do: string[]; must_not_do: string[] } {
  const must_not_do = [
    "Do not claim proof or Victory Room on this refresh turn.",
    "Do not pile on unrelated questions — one refresh question only.",
  ];
  const must_do: string[] = [
    "Keep this as an in-progress refresh question — server state has not changed yet.",
    "Use required verbatim substrings from server facts when present.",
  ];

  if (routeKind === "refresh_commitment") {
    must_not_do.push(REFRESH_FIT_CHECK_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO);
  }

  if (routeKind === "refresh_identity") {
    must_do.push("Ask an identity-fit / alignment question for this refresh step.");
    must_do.push("Preserve required identity anchor meaning from server facts.");
    must_not_do.push("Do not claim identity was updated or changed.");
    must_not_do.push("Do not claim the refresh is complete.");
    must_not_do.push("Do not claim the commitment changed.");
    must_not_do.push("Do not invent a new identity anchor.");
  } else {
    must_do.push("Ask whether the effective ask / commitment still fits today.");
    must_do.push("Preserve required effective ask meaning from server facts.");
    must_not_do.push("Do not claim the commitment changed or was updated.");
    must_not_do.push("Do not claim the refresh is complete.");
    must_not_do.push("Do not claim the user already recommitted.");
    must_not_do.push("Do not invent a new commitment or bar.");
  }

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

export function buildDailyC3RefreshStrategyCardContextFromSnapshot(args: {
  facts: DailyV3RelationshipFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
}): DailyC3RefreshStrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
  };
}

export function buildDailyC3RefreshStrategyCardV1(args: {
  ctx: DailyC3RefreshStrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const routeKind = facts.route_kind as DailyC3RefreshStrategyCardRouteKind;
  const moveType = routeKind;
  const legacyMove = facts.suggested_coaching_move?.trim() || null;
  const { must_do, must_not_do } = buildDailyC3RefreshMustDoMustNotDo(routeKind);
  const avoid_repeating = collectDailyC3RefreshAvoidRepeating(ctx);
  const refreshStep = facts.refresh
    ? summarizeDailyRefreshStep(facts.refresh.refresh_step)
    : null;
  const anchorFp = deriveRefreshIdentityAnchorFingerprint(ctx);
  const askFp = deriveRefreshCommitmentAskFingerprint(ctx);
  const reason =
    routeKind === "refresh_identity"
      ? "Refresh identity alignment — ask fit without claiming state changed."
      : "Refresh commitment fit-check — ask whether the bar still fits without claiming state changed.";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "daily",
    route_kind: routeKind,
    turn_kind: facts.accountability.daily_purpose ?? routeKind,
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      active_pending_kinds: [],
      satisfied_ask_fingerprints: [],
      daily_route_kind: facts.route_kind,
      daily_server_strategy: facts.accountability.server_strategy ?? null,
      daily_purpose: facts.accountability.daily_purpose ?? null,
      daily_refresh_step: refreshStep,
      daily_refresh_required_anchor_fingerprint: anchorFp,
      daily_refresh_required_ask_fingerprint: askFp,
      daily_refresh_session_written_before_sms: false,
    },
    move: {
      type: moveType,
      priority: "normal",
      confidence: "high",
      reason: truncateText(reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    },
    writer_constraints: {
      max_questions: 1,
      avoid_repeating,
      tone_posture: "clarifying",
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: legacyMove,
      legacy_coaching_move_source: "rule_derived",
      legacy_server_strategy: facts.accountability.server_strategy ?? null,
      legacy_next_move_type: facts.accountability.next_move_type ?? null,
    },
  };
}

function mustNotDoIncludesRefreshIdentityConstraints(must_not_do: string[]): boolean {
  const joined = must_not_do.join(" ").toLowerCase();
  return (
    joined.includes("identity") &&
    joined.includes("updated") &&
    joined.includes("refresh") &&
    joined.includes("complete") &&
    joined.includes("commitment")
  );
}

function mustNotDoIncludesRefreshCommitmentConstraints(must_not_do: string[]): boolean {
  const joined = must_not_do.join(" ").toLowerCase();
  return (
    joined.includes("commitment") &&
    joined.includes("changed") &&
    joined.includes("refresh") &&
    joined.includes("complete") &&
    joined.includes("recommitted")
  );
}

function mustDoIncludesRefreshMeaning(must_do: string[], routeKind: DailyC3RefreshStrategyCardRouteKind): boolean {
  const joined = must_do.join(" ").toLowerCase();
  if (routeKind === "refresh_identity") {
    return joined.includes("identity") && joined.includes("anchor");
  }
  return joined.includes("effective ask") || joined.includes("commitment");
}

export function validateDailyC3RefreshStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC3RefreshStrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const routeKind = ctx.facts.route_kind;

  if (card.surface !== "daily") reasons.push("surface_not_daily");
  if (card.route_kind !== "refresh_identity" && card.route_kind !== "refresh_commitment") {
    reasons.push("daily_c3_refresh_route_kind_invalid");
  }
  if (card.move.type !== card.route_kind) reasons.push("daily_c3_refresh_move_route_mismatch");
  if (!DAILY_C3_REFRESH_ALLOWED_MOVES.includes(card.move.type)) {
    reasons.push("daily_c3_refresh_forbidden_move");
  }
  if (
    card.allowed_claims.completion ||
    card.allowed_claims.miss ||
    card.allowed_claims.partial ||
    card.allowed_claims.proof ||
    card.allowed_claims.victory_room ||
    card.allowed_claims.state_changed ||
    card.allowed_claims.proposal_active
  ) {
    reasons.push("daily_c3_refresh_forbidden_claim");
  }
  if (card.server_truth_summary.daily_refresh_session_written_before_sms !== false) {
    reasons.push("daily_c3_refresh_session_must_be_false");
  }
  if (card.writer_constraints.max_questions > 1) reasons.push("daily_c3_refresh_max_questions_exceeded");
  if (routeKind === "refresh_identity") {
    if (!mustNotDoIncludesRefreshIdentityConstraints(card.must_not_do)) {
      reasons.push("daily_c3_refresh_identity_must_not_do_missing");
    }
    if (!mustDoIncludesRefreshMeaning(card.must_do, "refresh_identity")) {
      reasons.push("daily_c3_refresh_identity_must_do_missing");
    }
  }
  if (routeKind === "refresh_commitment") {
    if (!mustNotDoIncludesRefreshCommitmentConstraints(card.must_not_do)) {
      reasons.push("daily_c3_refresh_commitment_must_not_do_missing");
    }
    if (!mustDoIncludesRefreshMeaning(card.must_do, "refresh_commitment")) {
      reasons.push("daily_c3_refresh_commitment_must_do_missing");
    }
  }
  const requiredFp =
    routeKind === "refresh_identity"
      ? deriveRefreshIdentityAnchorFingerprint(ctx)
      : deriveRefreshCommitmentAskFingerprint(ctx);
  if (requiredFp && !card.writer_constraints.avoid_repeating.includes(requiredFp)) {
    reasons.push("daily_c3_refresh_missing_required_fingerprint");
  }
  for (const item of [...card.must_do, ...card.must_not_do, card.move.reason]) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_card");
    }
  }
  if (card.move.reason.length > MAX_REASON_CHARS) reasons.push("reason_too_long");

  return { valid: reasons.length === 0, reasons };
}

function repairDailyC3RefreshCard(
  card: StrategyCardV1,
  ctx: DailyC3RefreshStrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildDailyC3RefreshStrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function validateAndRepairDailyC3RefreshStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC3RefreshStrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateDailyC3RefreshStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairDailyC3RefreshCard(card, ctx, first.reasons);
  const second = validateDailyC3RefreshStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

// --- Daily C3 pending_resolution Strategy Card v1 ---

const DAILY_C3_PENDING_ALLOWED_MOVES: StrategyCardMoveType[] = ["pending_resolution_reminder"];

function derivePendingCandidateSource(ctx: DailyC3PendingResolutionStrategyCardBuildContext): string {
  const pr = ctx.facts.pending_resolution;
  return (
    pr?.candidate_behavior_snippet?.trim() ||
    ctx.facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
    ""
  );
}

function derivePendingCandidateFingerprint(
  ctx: DailyC3PendingResolutionStrategyCardBuildContext
): string | null {
  const source = derivePendingCandidateSource(ctx);
  return source ? fingerprintAsk(source) : null;
}

function derivePendingRequiredCandidateFingerprint(
  ctx: DailyC3PendingResolutionStrategyCardBuildContext
): string | null {
  const source = ctx.facts.constraints.required_verbatim_substrings?.[0]?.trim() || "";
  return source ? fingerprintAsk(source) : null;
}

function collectDailyC3PendingAvoidRepeating(
  ctx: DailyC3PendingResolutionStrategyCardBuildContext
): string[] {
  const items: string[] = [];
  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const fp = fingerprintAsk(s.ask_text ?? "");
    if (fp) items.push(fp);
  }
  for (const ask of ctx.facts.daily_satisfied_ask_context?.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const q of ctx.facts.thread_memory.last_5_coach_questions ?? []) {
    const fp = fingerprintAsk(q);
    if (fp) items.push(fp);
  }
  const candidateFp = derivePendingCandidateFingerprint(ctx);
  const requiredFp = derivePendingRequiredCandidateFingerprint(ctx);
  if (candidateFp) items.push(candidateFp);
  if (requiredFp) items.push(requiredFp);
  for (const v of ctx.facts.constraints.required_verbatim_substrings ?? []) {
    const fp = fingerprintAsk(v);
    if (fp) items.push(fp);
  }
  return [...new Set(items)].slice(0, MAX_AVOID_REPEATING);
}

function buildDailyC3PendingMustDoMustNotDo(): { must_do: string[]; must_not_do: string[] } {
  const must_do = [
    "Remind the user about the pending resolution / candidate change in flight.",
    "Preserve pending candidate meaning from route facts and PENDING_RESOLUTION_FACTS.",
    "Ask naturally for confirmation or completion of the pending loop.",
    "Use required candidate/verbatim from server facts when present.",
    "Keep this as a pending resolution reminder — server state has not applied the change yet.",
  ];
  const must_not_do = [
    "Do not claim the pending resolution is already applied or resolved.",
    "Do not claim the goal or commitment already changed.",
    "Do not claim the user already accepted or confirmed the change.",
    "Do not invent a new candidate bar or alternate obligation.",
    PENDING_CANDIDATE_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO,
    "Do not use robotic menu wording (Reply YES/NO, phone-tree confirmations).",
    "Do not claim proof or Victory Room on this pending reminder turn.",
    "Do not pile on unrelated questions — one pending reminder question only.",
  ];
  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

export function buildPendingResolutionFactsPacketForPrompt(
  facts: DailyV3RelationshipFacts
): PendingResolutionFactsPacketForPrompt | null {
  const pr = facts.pending_resolution;
  if (!pr) return null;
  const candidate =
    pr.candidate_behavior_snippet?.trim() ||
    facts.constraints.required_verbatim_substrings?.[0]?.trim() ||
    null;
  return {
    resolution_kind: pr.resolution_kind,
    sms_state: pr.sms_state,
    awaiting_user_confirmation: pr.awaiting_user_confirmation,
    candidate_behavior_snippet: candidate,
    candidate_fingerprint: candidate ? fingerprintAsk(candidate) : null,
    required_verbatim_note: facts.constraints.required_verbatim_substrings?.length
      ? "Use constraints.required_verbatim_substrings when present."
      : null,
    must_not_claim_resolved: true,
    must_not_claim_goal_changed: true,
  };
}

export function buildDailyC3PendingResolutionStrategyCardContextFromSnapshot(args: {
  facts: DailyV3RelationshipFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
}): DailyC3PendingResolutionStrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
  };
}

export function buildDailyC3PendingResolutionStrategyCardV1(args: {
  ctx: DailyC3PendingResolutionStrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const pr = facts.pending_resolution!;
  const legacyMove = facts.suggested_coaching_move?.trim() || "pending_resolution_reminder";
  const { must_do, must_not_do } = buildDailyC3PendingMustDoMustNotDo();
  const avoid_repeating = collectDailyC3PendingAvoidRepeating(ctx);
  const candidateFp = derivePendingCandidateFingerprint(ctx);
  const requiredFp = derivePendingRequiredCandidateFingerprint(ctx);

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "daily",
    route_kind: "pending_resolution",
    turn_kind: facts.accountability.daily_purpose ?? "pending_resolution",
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      active_pending_kinds: pr.resolution_kind ? [pr.resolution_kind] : [],
      satisfied_ask_fingerprints: [],
      daily_route_kind: facts.route_kind,
      daily_server_strategy: facts.accountability.server_strategy ?? null,
      daily_purpose: facts.accountability.daily_purpose ?? null,
      daily_pending_resolution_kind: pr.resolution_kind,
      daily_pending_candidate_fingerprint: candidateFp,
      daily_pending_state_written_before_sms: false,
      daily_pending_awaiting_user_confirmation: pr.awaiting_user_confirmation,
      daily_pending_required_candidate_fingerprint: requiredFp,
    },
    move: {
      type: "pending_resolution_reminder",
      priority: "normal",
      confidence: "high",
      reason: truncateText(
        "Pending resolution reminder — nudge completion without claiming the change is applied.",
        MAX_REASON_CHARS
      ),
    },
    must_do,
    must_not_do,
    allowed_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    },
    writer_constraints: {
      max_questions: 1,
      avoid_repeating,
      tone_posture: "contract_precise",
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: legacyMove,
      legacy_coaching_move_source: "rule_derived",
      legacy_server_strategy: facts.accountability.server_strategy ?? null,
      legacy_next_move_type: facts.accountability.next_move_type ?? null,
    },
  };
}

function mustNotDoIncludesPendingResolutionConstraints(must_not_do: string[]): boolean {
  const joined = must_not_do.join(" ").toLowerCase();
  return (
    (joined.includes("resolved") || joined.includes("applied")) &&
    joined.includes("goal") &&
    joined.includes("accepted") &&
    joined.includes("invent")
  );
}

function mustDoIncludesPendingMeaning(must_do: string[]): boolean {
  const joined = must_do.join(" ").toLowerCase();
  return joined.includes("pending") && (joined.includes("candidate") || joined.includes("resolution"));
}

export function validateDailyC3PendingResolutionStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC3PendingResolutionStrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (card.surface !== "daily") reasons.push("surface_not_daily");
  if (card.route_kind !== "pending_resolution") reasons.push("daily_c3_pending_route_kind_invalid");
  if (card.move.type !== "pending_resolution_reminder") {
    reasons.push("daily_c3_pending_move_type_invalid");
  }
  if (!DAILY_C3_PENDING_ALLOWED_MOVES.includes(card.move.type)) {
    reasons.push("daily_c3_pending_forbidden_move");
  }
  if (
    card.allowed_claims.completion ||
    card.allowed_claims.miss ||
    card.allowed_claims.partial ||
    card.allowed_claims.proof ||
    card.allowed_claims.victory_room ||
    card.allowed_claims.state_changed ||
    card.allowed_claims.proposal_active
  ) {
    reasons.push("daily_c3_pending_forbidden_claim");
  }
  if (card.server_truth_summary.daily_pending_state_written_before_sms !== false) {
    reasons.push("daily_c3_pending_state_must_be_false");
  }
  if (card.writer_constraints.max_questions > 1) reasons.push("daily_c3_pending_max_questions_exceeded");
  if (!mustNotDoIncludesPendingResolutionConstraints(card.must_not_do)) {
    reasons.push("daily_c3_pending_must_not_do_missing");
  }
  if (!mustDoIncludesPendingMeaning(card.must_do)) {
    reasons.push("daily_c3_pending_must_do_missing");
  }
  const candidateFp = derivePendingCandidateFingerprint(ctx);
  if (candidateFp && !card.writer_constraints.avoid_repeating.includes(candidateFp)) {
    reasons.push("daily_c3_pending_missing_candidate_fingerprint");
  }
  for (const item of [...card.must_do, ...card.must_not_do, card.move.reason]) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_card");
    }
  }
  if (card.move.reason.length > MAX_REASON_CHARS) reasons.push("reason_too_long");

  return { valid: reasons.length === 0, reasons };
}

function repairDailyC3PendingCard(
  card: StrategyCardV1,
  ctx: DailyC3PendingResolutionStrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildDailyC3PendingResolutionStrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function validateAndRepairDailyC3PendingResolutionStrategyCardV1(
  card: StrategyCardV1,
  ctx: DailyC3PendingResolutionStrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateDailyC3PendingResolutionStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairDailyC3PendingCard(card, ctx, first.reasons);
  const second = validateDailyC3PendingResolutionStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

// --- Weekly proof Strategy Card v1 (weekly_proof_v2) ---

const WEEKLY_PROOF_ALLOWED_MOVES: StrategyCardMoveType[] = [
  "weekly_reflect",
  "weekly_recover",
  "weekly_celebrate_earned",
  "weekly_low_pressure",
  "protect_existing_plan",
  "close_loop",
  "other",
];

export function isWeeklyProofStrategyCardEligible(facts: WeeklyV3OutboundFacts): boolean {
  if (facts.route.route_purpose !== "weekly_proof_v2") return false;
  if (facts.route.legacy_weekly_branch) return false;
  if (!facts.weekly_proof) return false;
  return true;
}

function deriveWeeklyProofMoveType(ctx: WeeklyStrategyCardBuildContext): StrategyCardMoveType {
  const wp = ctx.facts.weekly_proof;
  const canProof = ctx.proofPermission.can_claim_proof === true;

  if (wp.planned_pause_week || ctx.facts.commitment.planned_interruption_active) {
    return "protect_existing_plan";
  }
  if (wp.silent_week) {
    return "weekly_low_pressure";
  }
  if (wp.rough_week) {
    return "weekly_recover";
  }
  if (wp.proof_moment_hints.length > 0 && canProof) {
    return "weekly_celebrate_earned";
  }
  if (wp.strong_week) {
    return "weekly_celebrate_earned";
  }
  if (wp.missed_count > 0 && wp.completed_count > 0) {
    return "weekly_reflect";
  }
  if (wp.missed_count > wp.completed_count) {
    return "weekly_recover";
  }
  return "weekly_reflect";
}

function deriveWeeklyTonePosture(
  moveType: StrategyCardMoveType,
  ctx: WeeklyStrategyCardBuildContext
): StrategyCardTonePosture {
  if (moveType === "weekly_low_pressure") return "low_pressure";
  if (moveType === "weekly_recover") return "gentle_reentry";
  if (moveType === "protect_existing_plan") return "gentle_reentry";
  if (moveType === "weekly_celebrate_earned" && ctx.proofPermission.can_claim_proof) {
    return "celebrate_earned";
  }
  return "warm_direct";
}

function buildWeeklyAllowedClaims(ctx: WeeklyStrategyCardBuildContext): StrategyCardV1["allowed_claims"] {
  const wp = ctx.facts.weekly_proof;
  const perm = ctx.proofPermission.allowed_outbound_claims;
  if (wp.silent_week) {
    return {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    };
  }
  return {
    completion: perm.completion === true && wp.completed_count > 0,
    miss: perm.miss === true && wp.missed_count > 0,
    partial: perm.partial === true && wp.partial_count > 0,
    proof: perm.proof === true && wp.proof_moment_hints.length > 0,
    victory_room: perm.victory_room === true,
    state_changed: false,
    proposal_active: false,
  };
}

function buildWeeklyMustDoMustNotDo(
  moveType: StrategyCardMoveType,
  ctx: WeeklyStrategyCardBuildContext
): { must_do: string[]; must_not_do: string[] } {
  const wp = ctx.facts.weekly_proof;
  const must_not_do = [
    "Do not claim the goal or commitment changed unless server state already shows it.",
    "Do not invent proof or Victory Room beyond proof_and_praise_permission.",
    "Do not pile on unrelated questions — one weekly coaching move only.",
    WEEKLY_NO_YES_NO_RESET_MUST_NOT_DO,
  ];
  const must_do: string[] = [
    "Ground weekly framing in RELATIONSHIP_PACKET_V1 weekly_week_summary counts — not invented progress.",
    "Keep this as a weekly reflection touchpoint, not a daily rep check.",
  ];

  if (moveType === "weekly_low_pressure") {
    must_do.push("Keep the tone light and low-pressure for a sparse or silent week.");
    must_do.push("Point toward next week and the current commitment without shame.");
    must_do.push("Offer a specific coach-led next-week direction or reflection — not a generic recommitment question.");
    must_not_do.push("Do not invent progress, streaks, or a strong week.");
    must_not_do.push("Do not claim proof or Victory Room.");
  } else if (moveType === "weekly_recover") {
    must_do.push("Be honest about a rough week without shaming.");
    must_do.push("Orient toward recovery and next week.");
    must_do.push("Offer a specific recovery direction for next week — not a generic recommitment question.");
    must_not_do.push("Do not overpraise or call it an amazing or strong week.");
    must_not_do.push("Do not fake proof or Victory Room.");
  } else if (moveType === "weekly_celebrate_earned") {
    must_do.push("Celebrate consistency only to the level weekly counts and permission support.");
    must_do.push("Reference proof only if proof permission allows.");
    must_not_do.push("Do not claim perfect or every-day streak unless counts support it.");
    must_not_do.push("Do not invent additional proof moments.");
  } else if (moveType === "weekly_reflect") {
    must_do.push("Reflect honestly on completed, missed, and partial balance this week.");
    must_do.push("Point toward next week without overstatement.");
    must_do.push("Use a specific next-week direction or reflection — not a generic recommitment question.");
    must_not_do.push("Do not overstate progress beyond weekly counts.");
    must_not_do.push("Do not shame missed days.");
  } else if (moveType === "protect_existing_plan") {
    must_do.push("Protect the current plan and acknowledge pause context if present.");
    must_do.push("Honor planned pause — sparse replies are context, not failure.");
    must_not_do.push("Do not claim cadence or commitment already changed.");
  }

  if (wp.planned_pause_week) {
    must_not_do.push("Do not shame silence or missed days during a planned pause week.");
  }

  const distinctMissDays =
    wp.distinct_missed_day_count ?? wp.missed_count;
  if (distinctMissDays < 2) {
    must_not_do.push(
      'Do not say "couple missed", "few missed", "several missed", "two missed", "two misses", "missed two days", or similar exact multi-miss count language unless distinct valid miss-day count is at least 2.'
    );
  }

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function collectWeeklyAvoidRepeating(ctx: WeeklyStrategyCardBuildContext): string[] {
  const items: string[] = [];
  for (const ask of ctx.openLoops.do_not_repeat_asks ?? []) {
    const fp = fingerprintAsk(ask);
    if (fp) items.push(fp);
  }
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    const fp = fingerprintAsk(s.ask_text ?? "");
    if (fp) items.push(fp);
  }
  for (const q of ctx.facts.thread.last_5_coach_questions ?? []) {
    const fp = fingerprintAsk(q);
    if (fp) items.push(fp);
  }
  for (const h of ctx.facts.thread.do_not_repeat_hints ?? []) {
    const fp = fingerprintAsk(h);
    if (fp) items.push(fp);
  }
  return [...new Set(items)].slice(0, MAX_AVOID_REPEATING);
}

export function buildWeeklyStrategyCardContextFromSnapshot(args: {
  facts: WeeklyV3OutboundFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
}): WeeklyStrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
  };
}

export function buildWeeklyProofStrategyCardV1(args: {
  ctx: WeeklyStrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const wp = facts.weekly_proof;
  const moveType = deriveWeeklyProofMoveType(ctx);
  const { must_do, must_not_do } = buildWeeklyMustDoMustNotDo(moveType, ctx);
  const allowed_claims = buildWeeklyAllowedClaims(ctx);
  const avoid_repeating = collectWeeklyAvoidRepeating(ctx);
  const reasonByMove: Partial<Record<StrategyCardMoveType, string>> = {
    weekly_low_pressure: "Silent or sparse week — keep it low-pressure without inventing progress.",
    weekly_recover: "Rough week — recover with honesty, not shame or overpraise.",
    weekly_celebrate_earned: "Earned consistency — celebrate only to the level counts and permission allow.",
    weekly_reflect: "Mixed week — reflect honestly on the balance and next week.",
    protect_existing_plan: "Planned pause week — protect the current plan without failure framing.",
  };

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "weekly",
    route_kind: "weekly_proof_v2",
    turn_kind: facts.route.route_purpose,
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      active_pending_kinds: [],
      satisfied_ask_fingerprints: [],
      weekly_completed_count: wp.completed_count,
      weekly_missed_count: wp.missed_count,
      weekly_partial_count: wp.partial_count,
      weekly_silent_week: wp.silent_week,
      weekly_rough_week: wp.rough_week,
      weekly_strong_week: wp.strong_week,
      weekly_has_proof_hints: wp.proof_moment_hints.length > 0,
      weekly_can_claim_proof: ctx.proofPermission.can_claim_proof === true,
      weekly_can_reference_victory_room: ctx.proofPermission.can_reference_victory_room === true,
      weekly_proof_state_written_before_sms: false,
    },
    move: {
      type: moveType,
      priority: "normal",
      confidence: "high",
      reason: truncateText(reasonByMove[moveType] ?? "Weekly proof reflection.", MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims,
    writer_constraints: {
      max_questions: 1,
      avoid_repeating,
      tone_posture: deriveWeeklyTonePosture(moveType, ctx),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: moveType,
      legacy_coaching_move_source: "rule_derived",
    },
  };
}

function mustNotDoExcludesStrongWeekFraming(must_not_do: string[]): boolean {
  const joined = must_not_do.join(" ").toLowerCase();
  return joined.includes("strong") || joined.includes("amazing");
}

function claimsWithinWeeklyCounts(
  claims: StrategyCardV1["allowed_claims"],
  wp: WeeklyV3OutboundFacts["weekly_proof"]
): boolean {
  if (claims.completion && wp.completed_count < 1) return false;
  if (claims.miss && wp.missed_count < 1) return false;
  if (claims.partial && wp.partial_count < 1) return false;
  return true;
}

export function validateWeeklyProofStrategyCardV1(
  card: StrategyCardV1,
  ctx: WeeklyStrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const wp = ctx.facts.weekly_proof;
  const perm = ctx.proofPermission;

  if (card.surface !== "weekly") reasons.push("surface_not_weekly");
  if (card.route_kind !== "weekly_proof_v2") reasons.push("weekly_route_kind_invalid");
  if (!WEEKLY_PROOF_ALLOWED_MOVES.includes(card.move.type)) {
    reasons.push("weekly_forbidden_move");
  }
  if (card.server_truth_summary.weekly_proof_state_written_before_sms !== false) {
    reasons.push("weekly_proof_state_must_be_false");
  }
  if (card.allowed_claims.state_changed || card.allowed_claims.proposal_active) {
    reasons.push("weekly_forbidden_state_claim");
  }
  if (wp.silent_week && card.move.type === "weekly_celebrate_earned") {
    reasons.push("weekly_silent_cannot_celebrate");
  }
  if (wp.silent_week && (card.allowed_claims.proof || card.allowed_claims.victory_room)) {
    reasons.push("weekly_silent_cannot_claim_proof");
  }
  if (wp.rough_week && card.move.type === "weekly_celebrate_earned") {
    reasons.push("weekly_rough_cannot_celebrate");
  }
  if (
    card.allowed_claims.proof &&
    !(perm.can_claim_proof === true && wp.proof_moment_hints.length > 0)
  ) {
    reasons.push("weekly_proof_claim_without_permission");
  }
  if (card.allowed_claims.victory_room && perm.can_reference_victory_room !== true) {
    reasons.push("weekly_victory_claim_without_permission");
  }
  if (!claimsWithinWeeklyCounts(card.allowed_claims, wp)) {
    reasons.push("weekly_claims_exceed_counts");
  }
  if (wp.rough_week && !mustNotDoExcludesStrongWeekFraming(card.must_not_do)) {
    reasons.push("weekly_rough_must_not_do_missing");
  }
  if (card.writer_constraints.max_questions > 1) reasons.push("weekly_max_questions_exceeded");
  for (const item of [...card.must_do, ...card.must_not_do, card.move.reason]) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_card");
    }
  }
  if (card.move.reason.length > MAX_REASON_CHARS) reasons.push("reason_too_long");

  return { valid: reasons.length === 0, reasons };
}

function repairWeeklyProofCard(
  card: StrategyCardV1,
  ctx: WeeklyStrategyCardBuildContext,
  _reasons: string[]
): StrategyCardV1 {
  return buildWeeklyProofStrategyCardV1({ ctx, generatedAt: card.generated_at });
}

export function validateAndRepairWeeklyProofStrategyCardV1(
  card: StrategyCardV1,
  ctx: WeeklyStrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateWeeklyProofStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairWeeklyProofCard(card, ctx, first.reasons);
  const second = validateWeeklyProofStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}
