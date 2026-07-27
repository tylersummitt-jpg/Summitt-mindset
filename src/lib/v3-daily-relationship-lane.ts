/**
 * Daily Central V3 Relationship Lane — Phase 2 (all daily user-facing branches).
 * OpenAI authors the visible daily SMS; V2/accountability inputs are facts only (no upstream prose as seed).
 */

import OpenAI from "openai";

import type { V2DailyMessagePurpose } from "@/lib/v2-ai-outbound";
import type { V2OutboundStrategy } from "@/lib/v2-ai-outbound";
import type { V2NextMoveKind } from "@/lib/v2-sms-accountability";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import {
  applySmsMemoryAntiRepeatGuard,
  buildAntiRepeatDetectArgsFromDailyFacts,
  detectSmsMemoryRepeatViolation,
  shouldRunDailyMemoryRepeatGuard,
} from "@/lib/sms-memory-anti-repeat";
import {
  detectRelationshipCoachingVoiceBlockedReasons,
  evaluateRelationshipVoiceWithPraisePolicy,
  partitionFinalVoiceBlockedReasons,
  runLanePostValidateRepairLoop,
  repairV3RelationshipLaneBodyWithOpenAI,
} from "@/lib/v3-sms-voice-ownership";
import {
  buildSmsPraisePolicyArgsFromDailyFacts,
} from "@/lib/sms-earned-praise-policy";
import {
  detectRelationshipRobotConsentMenuReasons,
  relationshipRobotConsentMenuNoSendReason,
} from "@/lib/relationship-robot-consent-menu";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import { buildSmsGoalAdjustmentLaneGuardrails } from "@/lib/sms-goal-adjustment-signal";
import { buildCoachGoalEvolutionInviteLaneGuardrails } from "@/lib/sms-coach-initiated-goal-evolution-invite";
import {
  buildPlannedInterruptionLaneGuardrails,
} from "@/lib/sms-planned-interruption";
import { buildSmsPatternSignalLaneGuardrails } from "@/lib/sms-pattern-signal";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";
import type { RelationshipAnchorSources } from "@/lib/sms-relationship-anchors";
import type { DailySilenceCadenceFacts } from "@/lib/sms-silence-cadence-v1";
import { slimDailySatisfiedAskContextForTelemetry } from "@/lib/daily-satisfied-ask-context";
import { applyDailyStaleAskDetectOnly } from "@/lib/daily-stale-ask-guard";
import {
  buildDailyOpenQuestionAnswerPriorityGuidance,
  buildDailyZeroQuestionOpenQuestionStatementGuidance,
  buildDailyZeroQuestionPendingPlanProofGuardrails,
  buildPendingPlanProofLaneGuardrails,
  buildPendingPlanProofVoiceRepairInstruction,
  detectPendingPlanProofVoiceViolations,
  type PendingPlanProofFact,
} from "@/lib/pending-plan-proof";
import {
  buildTimingAnchorMemoryLaneGuardrails,
  buildTimingAnchorVoiceRepairInstruction,
  detectTimingAnchorVoiceViolations,
  inferHasProofOrKnownOutcomeForDailyAccountability,
  type TimingAnchorMemory,
} from "@/lib/timing-anchor-memory";
import {
  applyThreadFreshnessGuard,
  buildThreadFreshnessPromptGuidance,
  deriveRecentThreadFreshnessFacts,
  detectThreadFreshnessViolations,
  type ThreadFreshnessFacts,
} from "@/lib/sms-thread-freshness";
import type { RecentCoachBodyDoNotRepeat } from "@/lib/sms-recent-coach-body-anti-repeat";
import {
  extractCoachBodiesFromBriefThread,
  PROMPT_COACH_BODY_DO_NOT_REPEAT_MAX,
} from "@/lib/sms-recent-coach-body-anti-repeat";
import {
  buildDailyProofCalibrationPromptBlock,
  dailyProofCalibrationTelemetry,
  deriveDailyProofCalibration,
  type DailyProofCalibration,
} from "@/lib/sms-daily-proof-calibration";
import {
  buildDailyFreshMovePromptBlock,
  dailyFreshMoveTelemetry,
  deriveDailyFreshMoveFacts,
  deriveFreshnessAvoidPhrasesForBrief,
  detectDailyRepeatedCtaViolation,
  type DailyFreshMoveFacts,
} from "@/lib/sms-daily-fresh-move";
import {
  dailyUnsupportedPraiseTelemetry,
  detectDailyUnsupportedPraiseViolation,
} from "@/lib/sms-daily-unsupported-praise-validator";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import {
  buildRecentExactThreadForBrief,
  deriveBriefThreadWindowTelemetry,
  type RecentExactThreadForBriefResult,
} from "@/lib/sms-recent-exact-thread-72h";
import {
  buildDailySmsWritingBriefV1,
  buildDailySmsWriterMessagesFromBrief,
  dailyWritingBriefTelemetry,
  deriveDailyWritingBriefFallbackTelemetry,
  useDailySmsWritingBriefV1,
} from "@/lib/sms-daily-writing-brief-v1";
import {
  attachDailyNotebookVerdictToMetadata,
  buildDailyNotebookTelemetry,
} from "@/lib/sms-daily-notebook-telemetry";
import {
  buildWriterOpenAiCapture,
  type TylerTextOverviewWriterOpenAiCapture,
} from "@/lib/tyler-text-overview-writer-capture";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipMemory30dResult } from "@/lib/sms-relationship-memory-30d";
import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  buildWriterUserPromptWithStrategyCard,
  relationshipPacketMetaForLaneTelemetry,
} from "@/lib/sms-relationship-packet-v1";
import {
  buildDailyC1StrategyCardContextFromSnapshot,
  buildDailyC1StrategyCardV1,
  buildDailyC1StrategyCardDemotedPromptRules,
  finalizeStrategyCardWithRelationshipAnchorBoundaries,
  buildDailyC2StrategyCardContextFromSnapshot,
  buildDailyC2StrategyCardV1,
  buildDailyC3PendingResolutionStrategyCardContextFromSnapshot,
  buildDailyC3PendingResolutionStrategyCardV1,
  buildDailyC3RefreshStrategyCardContextFromSnapshot,
  buildDailyC3RefreshStrategyCardV1,
  buildPendingResolutionFactsPacketForPrompt,
  buildStrategyCardV1PromptGuidance,
  isDailyC1StrategyCardEligible,
  isDailyC2StrategyCardEligible,
  isDailyC3PendingResolutionStrategyCardEligible,
  isDailyC3RefreshStrategyCardEligible,
  strategyCardV1MetaForTelemetry,
  strategyCardV1UserPromptAppendix,
  validateAndRepairDailyC1StrategyCardV1,
  validateAndRepairDailyC3PendingResolutionStrategyCardV1,
  validateAndRepairDailyC3RefreshStrategyCardV1,
  validateAndRepairDailyContractPromptStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import type { StrategyCardV1 } from "@/lib/coaching-strategy-card-v1";
import type { TemporalContractV1, TemporalReferencedEventV1 } from "@/lib/sms-temporal-contract-v1";
import {
  buildReferencedEventsFromDailySources,
  buildTemporalContractV1,
  buildTemporalWordingRepairInstruction,
  dayKeyOffset,
  slimTemporalContractForTelemetry,
} from "@/lib/sms-temporal-contract-v1";
import {
  detectTemporalWordingViolations,
  pickSalientReferencedEvent,
  temporalWordingViolationReasons,
} from "@/lib/sms-temporal-wording-validator";
import {
  buildRepairSnapshotPromptGuidance,
  prepareRepairSnapshotForOpenAI,
} from "@/lib/sms-relationship-repair-snapshot-v1";
import type {
  SmsGoalAdjustmentCompatibleFlow,
  SmsGoalAdjustmentConfidence,
  SmsGoalAdjustmentMove,
} from "@/lib/sms-goal-adjustment-signal";
import type { DailyCoachGoalEvolutionInviteFacts } from "@/lib/sms-coach-initiated-goal-evolution-invite";
import {
  buildVictoryBackgroundLaneGuardrails,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";
import type { DailySemanticContractProposalFactsPacket } from "@/lib/v3-daily-contract-proposal-semantic";
import {
  DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES,
  validateSemanticDailyContractProposalSms,
} from "@/lib/v3-daily-contract-proposal-semantic";

const DAILY_LANE_MAX_CHARS = 300;

/** Top-level system rules when Strategy Card requires zero questions (prompt only). */
export function buildDailyZeroQuestionModeSystemRules(): string {
  return `
ZERO-QUESTION DAILY MODE IS ACTIVE (Strategy Card authority — overrides generic open-question guidance below):
- The final SMS must be a statement-only coaching touch.
- Do not ask a question. Do not use a question mark.
- Do not use hidden question commands such as tell me, let me know, reply with, name the blocker, choose one, or send me.
- Do not ask for proof, evidence, outcome, first step, blocker, strategy, or whether the plan happened.
- Do not re-ask or paraphrase recent coach questions from structured_recent_truth.last_5_coach_questions or avoid_repeating.
- Use one concrete no-question coaching move rooted in the current goal, recent thread, and identity when natural.
- A good zero-question SMS can acknowledge the thread, protect today's next honest action, and challenge the user without asking for a reply.`;
}

/** Statement-only repair constraint when zero-question daily mode is active. */
export function buildDailyMemoryRepeatZeroQuestionRepairInstruction(): string {
  return [
    "ZERO-QUESTION MEMORY REPAIR:",
    "Rewrite as one statement-only coaching SMS.",
    "No question marks.",
    "No hidden asks.",
    "Do not use did you / do you / have you / will you / can you / what happened / what got in the way / tell me / let me know phrasing.",
    "Use one concrete next action in statement form tied to the current goal.",
  ].join(" ");
}

/** Reject memory-repeat repair bodies that violate zero-question mode. */
export function detectDailyZeroQuestionStatementRepairViolation(body: string): {
  violation: boolean;
  reason: string | null;
} {
  const b = body.trim();
  if (!b) return { violation: false, reason: null };
  if (/\?/.test(b)) {
    return { violation: true, reason: "daily_zero_question_repair_contains_question_mark" };
  }
  if (
    /\b(did you|do you|have you|will you|can you|what got in the way|what happened|tell me|let me know)\b/i.test(
      b
    )
  ) {
    return { violation: true, reason: "daily_zero_question_repair_ask_shaped_phrase" };
  }
  return { violation: false, reason: null };
}

function resolveDailyZeroQuestionModeFromCard(card: StrategyCardV1 | null): boolean {
  if (!card) return false;
  return (
    card.writer_constraints.max_questions === 0 ||
    card.server_truth_summary.daily_zero_question_required === true ||
    card.server_truth_summary.daily_high_repeat_risk === true
  );
}

/** Compact writer authority: do not paraphrase recent coach SMS bodies from last 72h. */
export function buildDailyRecentCoachBodyDoNotRepeatGuidance(
  facts: DailyV3RelationshipFacts
): string {
  const bodies = facts.thread_memory.recent_coach_body_do_not_repeat ?? [];
  if (!bodies.length) return "";

  const lines = [
    "",
    "RECENT COACH BODY DO-NOT-REPEAT (authoritative — beats summaries and generic encouragement):",
    "- Do not repeat or lightly paraphrase any coach SMS from the last 72 hours.",
    "- If a prior coach text already praised the same proof and gave the same next action, choose a different honest move grounded in the current goal and recent thread.",
  ];

  const forPrompt = bodies.slice(-PROMPT_COACH_BODY_DO_NOT_REPEAT_MAX);
  for (const b of forPrompt) {
    const when = b.at_local?.trim() ? `[${b.at_local}] ` : "";
    lines.push(`- ${when}Coach already sent: "${b.body_preview}"`);
  }

  return lines.join("\n");
}

/** Wrapper must not restate server-owned binding instructional phrases (contract_prompt only). */
export const DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT = [
  "keep this line",
  "7 days",
  "same focus",
  "same commitment",
  "hold you to",
  "recommit",
] as const;

export type DailyV3RouteKind =
  | "main_active_accountability"
  | "low_pressure_reactivation"
  | "pending_resolution"
  | "refresh_identity"
  | "refresh_commitment"
  | "contract_prompt";

export type DailyV3ContractProposalFacts = {
  contract_kind: "shrink_ask" | "recommit_same";
  /** User must be able to accept or decline the overlay proposal meaningfully (YES/NO classifier). */
  required_reply_semantics: "yes_no_binding_only";
  /**
   * Legacy paste-binding path (guided tightening, older daily contracts).
   * Daily semantic overlay proposals omit this field.
   */
  binding_text_verbatim?: string;
  /** Canonical daily adaptive proposal routing: OpenAI relationship voice only (no pasted server binding line). */
  semantic_daily_contract_v1?: true;
  /** Structured semantics for semantic daily adaptive proposals — surfaced verbatim to the model inside ACCOUNTABILITY_FACTS_JSON. */
  daily_contract_semantic_facts?: DailySemanticContractProposalFactsPacket;
};

export type DailyV3PendingResolutionFacts = {
  resolution_kind: string | null;
  expires_at: string | null;
  payload_source: string | null;
  sms_state: string | null;
  detected_intent: string | null;
  candidate_behavior_snippet: string | null;
  awaiting_user_confirmation: boolean;
};

export type DailyV3RefreshFacts = {
  refresh_step: "identity_first" | "commitment_daily";
  identity_anchor_text?: string | null;
  effective_ask_for_bar?: string | null;
};

export type DailyV3RelationshipFacts = {
  route_kind: DailyV3RouteKind;
  accountability_day_key: string;
  temporal_contract?: TemporalContractV1 | null;
  thread_freshness?: ThreadFreshnessFacts | null;
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_time_iso: string;
    /** Soft tone hints only; not authoritative facts. */
    relationship_profile_summary: string | null;
  };
  commitment: {
    id: string;
    title: string;
    behavior_statement: string;
    effective_ask: string;
    accountability_phase: string;
    identity_anchor_allowed: boolean;
    identity_anchor_short: string | null;
  };
  thread_memory: {
    latest_outbound_sms: string | null;
    latest_inbound_sms: string | null;
    recent_transcript_or_context_block: string | null;
    latest_open_question: string | null;
    latest_answer_after_open_question?: string | null;
    open_question_answered_at?: string | null;
    open_question_pending?: boolean;
    projection_used?: boolean;
    open_question_source?: "projection" | "runtime_guess" | "none";
    answer_source?: "projection" | "runtime_guess" | "none";
    recent_exact_thread_text?: string | null;
    recent_exact_thread_72h?: RecentExactThread72hResult;
    relationship_memory_7d?: RelationshipMemory7dResult;
    relationship_memory_30d?: RelationshipMemory30dResult;
    last_outbound_full_body?: string | null;
    last_inbound_full_body?: string | null;
    last_5_coach_questions?: string[];
    last_5_user_answers?: string[];
    memory_priority_rules?: string[];
    do_not_repeat_hints: string[];
    coaching_memory_snippet: string;
    recent_pattern_hints: string | null;
    /** Sent coach SMS bodies from last 72h — anti-repeat guard + writer authority. */
    recent_coach_body_do_not_repeat?: RecentCoachBodyDoNotRepeat[];
  };
  accountability: {
    daily_purpose: V2DailyMessagePurpose;
    server_strategy: V2OutboundStrategy;
    next_move_type: V2NextMoveKind;
    prior_outcome: string | null;
    yes_streak_14d: number | null;
    no_count_14d: number | null;
    partial_count_14d: number | null;
    blocker_preview: string | null;
    proof_or_milestone_signal: string | null;
    silence_tier: string;
    unanswered_checks: number;
    days_since_last_user_outcome: number;
    reentry_active: boolean;
    overlay_active: boolean;
    evolution_pattern_hint: string | null;
    contract_proposal_mode: boolean;
    goal_adjustment_move?: SmsGoalAdjustmentMove | null;
    goal_adjustment_confidence?: SmsGoalAdjustmentConfidence | null;
    goal_adjustment_mention_allowed?: boolean;
    goal_adjustment_internal_hint?: string | null;
    goal_adjustment_requires_confirmation?: boolean;
    goal_adjustment_compatible_flow?: SmsGoalAdjustmentCompatibleFlow | null;
    /** Slice 3A — coach-initiated goal evolution invite (invitation only; no pending/mutation). */
    coach_goal_evolution_invite?: DailyCoachGoalEvolutionInviteFacts | null;
    planned_interruption_active?: boolean;
    planned_interruption_reason_category?: string | null;
    planned_interruption_resume_hint?: string | null;
    /** Derived: dated plan stated; outcome not yet proven (close loop first). */
    pending_plan_proof?: PendingPlanProofFact | null;
    /** Derived: timing anchor confidence (recurrence / confirmation / prior success). */
    timing_anchor_memory?: TimingAnchorMemory | null;
  };
  /** When route is pending-resolution daily reminder. */
  pending_resolution?: DailyV3PendingResolutionFacts | null;
  /** When route is refresh identity or commitment step. */
  refresh?: DailyV3RefreshFacts | null;
  /** When route is contract / adaptive overlay proposal daily. */
  contract_proposal?: DailyV3ContractProposalFacts | null;
  /** Read-only Victory Room background (season label + Pat Read); non-speakable unless naturally relevant. */
  victory_background?: V3VictoryBackgroundFacts | null;
  /** Latest inbound satisfied-ask / do-not-repeat truth for daily stale-ask prevention. */
  daily_satisfied_ask_context?: DailySatisfiedAskContext | null;
  /** Server-owned daily proof praise calibration (beats summaries). */
  proof_calibration?: DailyProofCalibration | null;
  /** Server-owned fresh-move / CTA do-not-repeat from recent coach bodies. */
  fresh_move?: DailyFreshMoveFacts | null;
  /** Optional user-provided people context for relationship anchors (read-only). */
  relationship_anchor_sources?: RelationshipAnchorSources | null;
  /** Silence Cadence V1 — single outbound silence/re-entry authority. */
  silence_cadence?: DailySilenceCadenceFacts | null;
  suggested_coaching_move: string;
  constraints: {
    max_chars: number;
    one_sms: true;
    no_raw_title_or_behavior_paste: true;
    no_generic_motivation: true;
    if_unsafe_return_no_send: true;
    /** Each non-empty string MUST appear verbatim in `body` when should_send is true. */
    required_verbatim_substrings?: string[];
    /** Contract wrapper only: phrases that must not appear outside binding_text_verbatim. */
    wrapper_must_not_repeat_substrings?: string[];
  };
};

/** Facts without derived `suggested_coaching_move` / `constraints` (used by {@link deriveSuggestedCoachingMoveForDailyFacts}). */
export type DailyV3RelationshipFactsForMove = Omit<DailyV3RelationshipFacts, "suggested_coaching_move" | "constraints">;

export type DailyV3RelationshipLaneInput = {
  facts: DailyV3RelationshipFacts;
  /** Upstream modules that supplied structured facts only (observability). */
  telemetry_fact_sources: string[];
  /** Authoritative server row for row-backed active_pending_state (read-only context). */
  commitmentRow?: import("@/lib/v2-commitment").ActiveV2CommitmentRow | null;
  /** Optional slot/daypart overrides for evening preview or future multi-slot builds. */
  writing_brief_overrides?: import("@/lib/sms-daily-writing-brief-v1").DailySmsWritingBriefOverrides;
  /**
   * Morning TTO draft generation only: keep the primary writer's body for Tyler review.
   * Soft-fail semantic/style post-checks as telemetry; skip OpenAI repair rewrites.
   * Must NOT be set for Evening preview or live send builds.
   */
  tto_draft_preserve_primary_body?: boolean;
};

export type DailyV3RelationshipLaneReplySource = "v3_daily_relationship_lane";

export type DailyV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: DailyV3RelationshipLaneReplySource;
  turnPurpose: string;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
  /** Exact OpenAI writer messages captured immediately before the lane writer call. */
  writerOpenAiCapture?: TylerTextOverviewWriterOpenAiCapture | null;
};

const DAILY_V3_LANE_OPENAI_MODEL = "gpt-4o-mini" as const;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/** Rule-derived coaching move label for telemetry and model grounding (not prose). */
export function deriveSuggestedCoachingMoveForDailyFacts(f: DailyV3RelationshipFactsForMove): string {
  if (f.route_kind === "pending_resolution") return "pending_resolution_reminder";
  if (f.route_kind === "refresh_identity") return "refresh_identity_alignment";
  if (f.route_kind === "refresh_commitment") return "refresh_commitment_fit_check";
  if (f.route_kind === "contract_prompt") return "propose_contract";
  if (f.route_kind === "low_pressure_reactivation") return "low_pressure_reactivation";
  if (f.accountability.pending_plan_proof?.active === true) return "close_prior_plan_loop";
  if (f.accountability.daily_purpose === "comeback_after_silence") return "acknowledge_comeback";
  if (f.accountability.next_move_type === "shrink_ask") return "invite_smaller_rep";
  if (f.accountability.coach_goal_evolution_invite?.should_invite === true) {
    return "invite_goal_evolution";
  }
  if (f.accountability.next_move_type === "hold_standard") return "hold_standard";
  if (f.accountability.blocker_preview) return "ask_blocker";
  if (f.accountability.daily_purpose === "contract_overlay_proposal") return "propose_contract";
  if (f.accountability.daily_purpose === "evolution_pattern_check") return "evolution_check";
  return "ask_completion";
}

function routeSpecificSystemAddendum(
  f: DailyV3RelationshipFacts,
  opts?: { strategyCardC2Active?: boolean; strategyCardC3PendingActive?: boolean }
): string {
  const lines: string[] = [];
  const strategyCardC2Active = opts?.strategyCardC2Active === true;
  const strategyCardC3PendingActive = opts?.strategyCardC3PendingActive === true;
  if (f.route_kind === "pending_resolution") {
    if (strategyCardC3PendingActive && f.pending_resolution) {
      const packet = buildPendingResolutionFactsPacketForPrompt(f);
      if (packet) {
        lines.push(
          `PENDING_RESOLUTION_FACTS (authoritative pending candidate / route facts — Strategy Card owns coaching move; not scripted lines): ${JSON.stringify(packet)}.`
        );
      }
    }
    lines.push(
      "PENDING_RESOLUTION_ROUTE: User has an in-flight guided commitment update. Nudge them to complete it in-app or via SMS per facts. Do not invent a new bar or change server state."
    );
  }
  if (f.route_kind === "refresh_identity") {
    lines.push(
      "REFRESH_IDENTITY_ROUTE: Identity alignment check (not a daily score). If constraints.required_verbatim_substrings lists an identity anchor, include that substring EXACTLY once, character-for-character."
    );
  }
  if (f.route_kind === "refresh_commitment") {
    lines.push(
      "REFRESH_COMMITMENT_ROUTE: Ask whether today’s bar still fits. If constraints.required_verbatim_substrings lists the effective bar text, include it EXACTLY once, character-for-character."
    );
  }
  if (f.route_kind === "contract_prompt" && f.contract_proposal) {
    const sem =
      f.contract_proposal.semantic_daily_contract_v1 === true &&
      f.contract_proposal.daily_contract_semantic_facts != null;

    if (sem) {
      const d = f.contract_proposal.daily_contract_semantic_facts!;
      if (strategyCardC2Active) {
        lines.push(
          `SEMANTIC_DAILY_CONTRACT_FACTS (authoritative proposal meaning — Strategy Card owns coaching move; not scripted lines): ${JSON.stringify(d)}.`
        );
      } else {
        lines.push(
          `SEMANTIC_DAILY_CONTRACT_ROUTE: Write one SMS in one long relational coaching arc — concise, humane, unmistakably the same steady coach thread.`,
          `Ground in thread_memory blocks (recent SMS, transcript, coaching memory hints, anti-repeat cues) plus identity + goal facts — facts are not screenplay dialogue to paste.`,
          `Naturally reflect the bar/effective commitment described in structured facts.`,
          `- Ask gently whether staying with this cadence/bar for roughly ${String(d.duration_days)} days fits, they'd rather ease up, or they want an adjustment.`,
          `- One conversational question/closing cue — not stacked menu interrogation.`,
          `- Do NOT use menu consent copy or phone-tree confirmations (examples forbidden in facts.forbidden_phrases + ${DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES.map((p) => JSON.stringify(p)).join(", ")}).`,
          `- Never claim server-side goal/overlay/state already mutated (must_not_claim_goal_updated stays true server-side until RPC applies).`,
          `- Do NOT fabricate an alternate obligation or swap in a invented different goal.`,
          `- Avoid reading raw behavior text aloud like contractual fine print unless a compact natural mention feels humane.`,
          `Structured proposal semantics (FACTS_JSON fragment only — not scripted lines): ${JSON.stringify(d)}.`
        );
      }
    } else {
      const wrapperForbidden =
        f.constraints.wrapper_must_not_repeat_substrings?.length
          ? f.constraints.wrapper_must_not_repeat_substrings
          : [...DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT];
      const bv = typeof f.contract_proposal.binding_text_verbatim === "string"
        ? f.contract_proposal.binding_text_verbatim
        : "";
      lines.push(
        `CONTRACT_PROMPT_ROUTE (legacy binding verbatim): Paste contract_proposal.binding_text_verbatim EXACTLY once in the SMS body — character-for-character, unchanged. Do not paraphrase or restate that instruction.`,
        `The human wrapper is short context only (e.g. "Let's make this simple." / "Here's the line." / "If this is right, confirm it.").`,
        `Do NOT use these phrases anywhere in the wrapper (they already belong inside the binding): ${wrapperForbidden.map((p) => JSON.stringify(p)).join(", ")}.`,
        `One natural confirmation ask total (e.g. whether to keep the same bar for the week) — not two questions. Never use visible menu-bot phrasing like "Reply YES", "Reply NO", "YES to confirm", or "NO to discard". Do not change binding meaning or add new legal obligations.`,
        `Binding for verbatim inclusion: ${JSON.stringify(bv)}`
      );
    }
  }
  if (f.constraints.required_verbatim_substrings?.length) {
    lines.push(
      `REQUIRED_VERBATIM: The final body must contain each string in constraints.required_verbatim_substrings exactly (substring match). If you cannot do that safely, return should_send false.`
    );
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  turn_purpose?: unknown;
  voice_confidence?: unknown;
  used_facts?: unknown;
  safety_notes?: unknown;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function safeJsonParse(raw: string): LaneModelJson | null {
  try {
    return JSON.parse(raw) as LaneModelJson;
  } catch {
    return null;
  }
}

function collectDailyPostValidateVoiceViolations(
  body: string,
  facts: DailyV3RelationshipFacts,
  bindingVerbatim?: string | null
): { blocked: string[]; praiseMetadata: Record<string, unknown> } {
  const hasProof = inferHasProofOrKnownOutcomeForDailyAccountability(facts.accountability);
  const praisePolicy = buildSmsPraisePolicyArgsFromDailyFacts({
    body,
    routeKind: facts.route_kind,
    accountability: facts.accountability,
    commitment: facts.commitment,
    thread_memory: facts.thread_memory,
  });
  const voice = evaluateRelationshipVoiceWithPraisePolicy(body, {
    bindingVerbatim: bindingVerbatim ?? undefined,
    praisePolicy,
  });
  const hits = [
    ...voice.reasons,
    ...detectPendingPlanProofVoiceViolations(body, facts.accountability.pending_plan_proof),
    ...detectTimingAnchorVoiceViolations({
      body,
      timingAnchorMemory: facts.accountability.timing_anchor_memory,
      pendingPlanProof: facts.accountability.pending_plan_proof,
      hasProofOrKnownOutcome: hasProof,
    }),
  ];
  return {
    blocked: [...new Set(hits)],
    praiseMetadata: voice.praiseMetadata,
  };
}

const DAILY_THREAD_FRESHNESS_EXCLUDED_ROUTE_KINDS = new Set<DailyV3RouteKind>([
  "contract_prompt",
  "pending_resolution",
  "refresh_identity",
  "refresh_commitment",
]);

export function shouldRunDailyThreadFreshnessGuard(facts: DailyV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  return !DAILY_THREAD_FRESHNESS_EXCLUDED_ROUTE_KINDS.has(facts.route_kind);
}

export function enrichDailyFactsWithThreadFreshness(facts: DailyV3RelationshipFacts): DailyV3RelationshipFacts {
  const tm = facts.thread_memory;
  const threadFreshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: tm.recent_exact_thread_text ?? tm.recent_transcript_or_context_block ?? null,
    recentTranscriptLines: tm.recent_transcript_or_context_block
      ? tm.recent_transcript_or_context_block.split("\n").filter(Boolean)
      : [],
    last5UserAnswers: tm.last_5_user_answers ?? [],
    latestUserInbound: tm.latest_inbound_sms ?? null,
    latestCoachQuestion: tm.latest_open_question ?? tm.last_5_coach_questions?.slice(-1)[0] ?? null,
    accountabilityDayKey: facts.accountability_day_key,
    timezone: facts.user.timezone,
  });

  const sendDayKey = facts.accountability_day_key;
  const now = Number.isFinite(new Date(facts.user.local_time_iso).getTime())
    ? new Date(facts.user.local_time_iso)
    : new Date();
  const contractBase: TemporalContractV1 = {
    ...buildTemporalContractV1({
      timezone: facts.user.timezone,
      now,
      sendDayKey,
    }),
    today_key: sendDayKey,
    yesterday_key: dayKeyOffset(sendDayKey, -1),
    tomorrow_key: dayKeyOffset(sendDayKey, 1),
    send_day_key: sendDayKey,
  };
  const referencedEvents = buildReferencedEventsFromDailySources({
    timezone: facts.user.timezone,
    contract: contractBase,
    threadFreshness,
    memory7d: tm.relationship_memory_7d,
    recentThread72h: tm.recent_exact_thread_72h,
    pendingPlanProof: facts.accountability.pending_plan_proof,
  });
  const temporal_contract: TemporalContractV1 = {
    ...contractBase,
    referenced_events: referencedEvents.length ? referencedEvents : undefined,
  };

  return {
    ...facts,
    thread_freshness: threadFreshness,
    temporal_contract,
  };
}

/** Attach proof calibration + fresh-move facts after thread freshness (no I/O). */
export function enrichDailyFactsWithProofCalibrationAndFreshMove(
  facts: DailyV3RelationshipFacts
): DailyV3RelationshipFacts {
  const proof_calibration = deriveDailyProofCalibration({ facts });
  const fresh_move = deriveDailyFreshMoveFacts(facts.thread_memory.recent_coach_body_do_not_repeat, {
    effectiveAsk: facts.commitment.effective_ask,
    behaviorStatement: facts.commitment.behavior_statement,
  });
  return { ...facts, proof_calibration, fresh_move };
}

export function applyDailyProofCalibrationSeatbelts(
  body: string,
  facts: DailyV3RelationshipFacts
): { blocked: boolean; noSendReason: string | null; metadata: Record<string, unknown> } {
  const cal = facts.proof_calibration;
  if (cal) {
    const praiseHit = detectDailyUnsupportedPraiseViolation({ body, calibration: cal });
    if (praiseHit) {
      return {
        blocked: true,
        noSendReason: "unsupported_praise_claim",
        metadata: {
          ...dailyUnsupportedPraiseTelemetry(praiseHit, cal),
          lane_stage: "daily_unsupported_praise_blocked",
        },
      };
    }
  }
  const fresh = facts.fresh_move ?? {
    recent_cta_do_not_repeat: [],
    recent_advice_do_not_repeat: [],
    fresh_move_required: false,
  };
  const ctaHit = detectDailyRepeatedCtaViolation({
    body,
    freshMove: fresh,
    newProofAllowsSameCta:
      cal?.recent_completion_claim_allowed === true && (cal?.proof_age_days ?? 99) <= 0,
  });
  if (ctaHit) {
    return {
      blocked: true,
      noSendReason: "thread_memory_repeat_blocked",
      metadata: {
        ...dailyFreshMoveTelemetry(fresh, ctaHit),
        lane_stage: "daily_repeated_cta_blocked",
      },
    };
  }
  return { blocked: false, noSendReason: null, metadata: {} };
}

export function shouldRunDailyTemporalWordingGuard(facts: DailyV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (DAILY_THREAD_FRESHNESS_EXCLUDED_ROUTE_KINDS.has(facts.route_kind)) return false;
  return Boolean(facts.temporal_contract);
}

function resolveDailyTemporalReferencedEvents(
  laneFacts: DailyV3RelationshipFacts
): TemporalReferencedEventV1[] {
  const contract = laneFacts.temporal_contract!;
  return (
    contract.referenced_events ??
    buildReferencedEventsFromDailySources({
      timezone: laneFacts.user.timezone,
      contract,
      threadFreshness: laneFacts.thread_freshness,
      memory7d: laneFacts.thread_memory.relationship_memory_7d,
      recentThread72h: laneFacts.thread_memory.recent_exact_thread_72h,
      pendingPlanProof: laneFacts.accountability.pending_plan_proof,
    })
  );
}

function dailyTemporalBindingSkipsValidation(bindingVerbatim: string | null): boolean {
  const binding = bindingVerbatim?.trim() ?? "";
  return Boolean(binding) && /\b(yesterday|today|tomorrow)\b/i.test(binding);
}

function detectDailyTemporalWordingViolationsForLane(
  body: string,
  laneFacts: DailyV3RelationshipFacts,
  bindingVerbatim: string | null
) {
  if (!shouldRunDailyTemporalWordingGuard(laneFacts)) return [];
  const contract = laneFacts.temporal_contract!;
  return detectTemporalWordingViolations(body, {
    temporal_contract: contract,
    referenced_events: resolveDailyTemporalReferencedEvents(laneFacts),
    mode: "daily",
    skip_validation: dailyTemporalBindingSkipsValidation(bindingVerbatim),
  });
}

type DailyTemporalGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

async function applyDailyTemporalWordingGuard(args: {
  body: string;
  laneFacts: DailyV3RelationshipFacts;
  bindingVerbatim: string | null;
  turnPurpose: string;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  baseMeta: Record<string, unknown>;
  laneOpenAiJsonMeta: Record<string, unknown>;
  successRepairExtra: Record<string, unknown>;
}): Promise<DailyTemporalGuardResult> {
  const baseTelemetry = (): Record<string, unknown> => {
    const c = args.laneFacts.temporal_contract;
    return {
      ...(c ? slimTemporalContractForTelemetry(c) : {}),
      temporal_wording_violation_detected: false,
      temporal_wording_violation_reason: null,
      temporal_wording_repair_attempted: false,
      temporal_wording_repair_succeeded: false,
    };
  };

  if (!shouldRunDailyTemporalWordingGuard(args.laneFacts)) {
    return { outcome: "ok", body: args.body, metadata: baseTelemetry() };
  }

  const contract = args.laneFacts.temporal_contract!;
  const referenced = resolveDailyTemporalReferencedEvents(args.laneFacts);

  let body = args.body.trim();
  let violations = detectDailyTemporalWordingViolationsForLane(
    body,
    args.laneFacts,
    args.bindingVerbatim
  );

  if (!violations.length) {
    return { outcome: "ok", body, metadata: baseTelemetry() };
  }

  const original = body;
  const salient = pickSalientReferencedEvent(referenced);
  const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
    repairKind: "temporal_wording",
    routeKind: "daily",
    routePurpose: args.laneFacts.route_kind,
    blockedBody: body,
    blockedReasons: temporalWordingViolationReasons(violations),
    laneFacts: args.laneFacts,
    freshness: args.laneFacts.thread_freshness,
  });

  const repairOut = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "daily",
    routePurpose: args.laneFacts.route_kind,
    originalBody: body,
    blockedReasons: temporalWordingViolationReasons(violations),
    repairSnapshot,
    systemInstruction: buildTemporalWordingRepairInstruction({
      contract,
      violationReason: violations[0]!.reason,
      salientEvent: salient,
    }),
  });

  const attemptMeta: Record<string, unknown> = {
    ...baseTelemetry(),
    temporal_wording_violation_detected: true,
    temporal_wording_violation_reason: violations[0]!.reason,
    temporal_wording_repair_attempted: true,
    temporal_wording_repair_succeeded: false,
    ...snapshotMeta,
  };

  if (!repairOut?.body?.trim()) {
    return {
      outcome: "no_send",
      noSendReason: "temporal_wording_blocked",
      metadata: attemptMeta,
    };
  }

  body = repairOut.body.replace(/^["']|["']$/g, "").trim();
  violations = detectDailyTemporalWordingViolationsForLane(
    body,
    args.laneFacts,
    args.bindingVerbatim
  );

  if (violations.length > 0) {
    return {
      outcome: "no_send",
      noSendReason: "temporal_wording_blocked",
      metadata: {
        ...attemptMeta,
        temporal_wording_repair_succeeded: false,
        v3_candidate_body: original,
        repaired_candidate_body: body,
        temporal_wording_repaired_blocked_reasons: temporalWordingViolationReasons(violations),
        ...repairOut.metadata,
      },
    };
  }

  return {
    outcome: "ok",
    body,
    metadata: {
      ...attemptMeta,
      temporal_wording_repair_succeeded: true,
      v3_candidate_body: original,
      repaired_candidate_body: body,
      ...repairOut.metadata,
    },
  };
}

function summarizeFacts(f: DailyV3RelationshipFacts): string {
  const slim = {
    route_kind: f.route_kind,
    daily_purpose: f.accountability.daily_purpose,
    server_strategy: f.accountability.server_strategy,
    next_move: f.accountability.next_move_type,
    prior_outcome: f.accountability.prior_outcome,
    silence_tier: f.accountability.silence_tier,
    suggested_move: f.suggested_coaching_move,
    has_contract: Boolean(f.contract_proposal),
    has_pending: Boolean(f.pending_resolution),
    refresh_step: f.refresh?.refresh_step ?? null,
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

function validateRequiredVerbatims(body: string, required: string[] | undefined): string | null {
  if (!required?.length) return null;
  for (const sub of required) {
    const t = sub.trim();
    if (!t) continue;
    if (!body.includes(t)) return t;
  }
  return null;
}

function runSemanticDailyContractValidatorIfApplicable(
  facts: DailyV3RelationshipFacts,
  body: string
): null | { reason_code: string; reason_detail?: string } {
  if (
    facts.route_kind !== "contract_prompt" ||
    facts.contract_proposal?.semantic_daily_contract_v1 !== true ||
    !facts.contract_proposal.daily_contract_semantic_facts
  ) {
    return null;
  }
  const d = facts.contract_proposal.daily_contract_semantic_facts;
  const sem = validateSemanticDailyContractProposalSms({
    smsBody: body,
    preview: d.proposed_behavior_preview,
    canonicalOverlayAsk: d.proposed_overlay_ask,
    baseBehaviorStatement: d.base_behavior_statement,
  });
  if (sem.ok) return null;
  return { reason_code: sem.reason_code, reason_detail: sem.reason_detail };
}

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

/** Detect wrapper restating binding instructional language outside the required verbatim binding. */
export function detectContractWrapperDuplicates(
  body: string,
  bindingVerbatim: string,
  wrapperForbidden: readonly string[]
): string[] {
  const hits: string[] = [];
  const binding = bindingVerbatim.trim();
  if (!binding) return hits;

  const occurrences = countSubstringOccurrences(body, binding);
  if (occurrences === 0) return hits;
  if (occurrences > 1) hits.push("contract_binding_repeated");

  const firstIdx = body.indexOf(binding);
  const wrapperOnly = `${body.slice(0, firstIdx)}${body.slice(firstIdx + binding.length)}`.toLowerCase();

  for (const phrase of wrapperForbidden) {
    const p = phrase.trim().toLowerCase();
    if (!p) continue;
    if (wrapperOnly.includes(p)) {
      hits.push(`contract_wrapper_duplicate:${phrase}`);
    }
  }

  const duplicatePatterns: Array<[RegExp, string]> = [
    [/keep this line/gi, "keep this line"],
    [/same focus/gi, "same focus"],
    [/same commitment/gi, "same commitment"],
  ];
  for (const [re, label] of duplicatePatterns) {
    const matches = body.match(re);
    if (matches && matches.length > 1 && !hits.some((h) => h.includes(label))) {
      hits.push(`contract_wrapper_duplicate:${label}`);
    }
  }

  return hits;
}

type ContractWrapperRepairJson = {
  body?: unknown;
  used_strategy?: unknown;
  safety_notes?: unknown;
};

function safeParseContractWrapperRepairJson(raw: string): ContractWrapperRepairJson | null {
  try {
    return JSON.parse(raw) as ContractWrapperRepairJson;
  } catch {
    return null;
  }
}

/**
 * OpenAI repair for contract wrapper duplication only. Preserves binding_text_verbatim exactly.
 */
async function repairDailyContractWrapperDuplicate(args: {
  originalBody: string;
  bindingVerbatim: string;
  blockedReasons: string[];
  laneFacts: DailyV3RelationshipFacts;
  routePurpose: string;
  wrapperMustNotRepeatSubstrings: readonly string[];
}): Promise<{ body: string; metadata: Record<string, unknown> } | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const binding = args.bindingVerbatim.trim();
  if (!binding) return null;

  const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
    repairKind: "contract_wrapper",
    routeKind: "daily",
    routePurpose: args.routePurpose,
    blockedBody: args.originalBody,
    blockedReasons: args.blockedReasons,
    laneFacts: args.laneFacts,
    wrapperBlockedReasons: args.blockedReasons,
    bindingTextVerbatim: binding,
    wrapperMustNotRepeatSubstrings: [...args.wrapperMustNotRepeatSubstrings],
  });

  const system = `You repair contract proposal SMS copy for Summitt Mindset.

OUTPUT: strict JSON only with keys:
body (string, one SMS),
used_strategy (string, short),
safety_notes (string array, may be empty)

RULES:
- BINDING_VERBATIM must appear in body exactly once, character-for-character unchanged: ${JSON.stringify(binding)}
- Remove duplicate wrapper language that restates the binding (keep this line, 7 days, same focus, same commitment, hold you to, recommit) OUTSIDE the binding.
- Short human wrapper only before and/or after the binding — do not paraphrase the binding instruction.
- One natural confirmation invitation total — not two questions. Never use "Reply YES", "Reply NO", "YES to confirm", or "NO to discard".
- No markdown, bullets, or role labels. One short SMS; no newlines in body.
${buildRepairSnapshotPromptGuidance()}`;

  const userContent = [
    `blocked_reasons: ${args.blockedReasons.join(", ")}`,
    `original_candidate_sms: ${args.originalBody}`,
    `REPAIR_RELATIONSHIP_SNAPSHOT_V1:`,
    JSON.stringify(repairSnapshot),
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 280,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = safeParseContractWrapperRepairJson(raw);
    const bodyRaw = typeof parsed?.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
    const repaired = bodyRaw.replace(/^["']|["']$/g, "").trim();
    if (!repaired) return null;

    if (countSubstringOccurrences(repaired, binding) !== 1) return null;

    const used_strategy =
      typeof parsed?.used_strategy === "string" ? parsed.used_strategy.trim() : "contract_wrapper_dedup";
    const sn = Array.isArray(parsed?.safety_notes)
      ? parsed.safety_notes.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];

    return {
      body: repaired,
      metadata: {
        contract_wrapper_repair_used_strategy: used_strategy,
        contract_wrapper_repair_safety_notes: sn,
        repair_snapshot_version: snapshotMeta.repair_snapshot_version,
        repair_snapshot_kind: snapshotMeta.repair_snapshot_kind,
        repair_snapshot_chars: snapshotMeta.repair_snapshot_chars,
        repair_snapshot_truncated: snapshotMeta.repair_snapshot_truncated,
      },
    };
  } catch (e) {
    console.warn("[v3-daily-relationship-lane] contract_wrapper_repair_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

type RobotConsentMenuRepairJson = {
  body?: unknown;
  used_strategy?: unknown;
  safety_notes?: unknown;
};

function safeParseRobotConsentMenuRepairJson(raw: string): RobotConsentMenuRepairJson | null {
  try {
    return JSON.parse(raw) as RobotConsentMenuRepairJson;
  } catch {
    return null;
  }
}

/**
 * OpenAI repair for robotic YES/NO menu consent copy. Preserves binding_text_verbatim when present.
 */
async function repairDailyRelationshipRobotConsentMenu(args: {
  originalBody: string;
  bindingVerbatim: string | null;
  blockedReasons: string[];
  laneFacts: DailyV3RelationshipFacts;
  routePurpose: string;
}): Promise<{ body: string; metadata: Record<string, unknown> } | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const binding = args.bindingVerbatim?.trim() ?? "";
  const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
    repairKind: "robot_consent_menu",
    routeKind: "daily",
    routePurpose: args.routePurpose,
    blockedBody: args.originalBody,
    blockedReasons: args.blockedReasons,
    laneFacts: args.laneFacts,
    robotMenuBlockedReasons: args.blockedReasons,
    bindingTextVerbatim: args.bindingVerbatim,
  });

  const bindingRule = binding
    ? `- BINDING_VERBATIM must appear in body exactly once, character-for-character unchanged: ${JSON.stringify(binding)}`
    : `- Do not add server binding instructional phrases (keep this line for 7 days, same commitment—keep this line, same focus—keep this line).`;

  const system = `You repair relationship coaching SMS copy for Summitt Mindset.

OUTPUT: strict JSON only with keys:
body (string, one SMS),
used_strategy (string, short),
safety_notes (string array, may be empty)

RULES:
${bindingRule}
- Remove robotic menu-bot consent phrasing: "Reply YES", "Reply NO", "YES to confirm", "NO to discard", "Reply YES to commit/recommit", etc.
- Replace with one short natural confirmation ask (e.g. whether to keep the same bar for the week) — wording may vary; do not sound like a phone tree.
- One confirmation invitation total — not two questions.
- No markdown, bullets, or role labels. One short SMS; no newlines in body.
${buildRepairSnapshotPromptGuidance()}`;

  const userContent = [
    `blocked_reasons: ${args.blockedReasons.join(", ")}`,
    `original_candidate_sms: ${args.originalBody}`,
    `REPAIR_RELATIONSHIP_SNAPSHOT_V1:`,
    JSON.stringify(repairSnapshot),
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 280,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = safeParseRobotConsentMenuRepairJson(raw);
    const bodyRaw = typeof parsed?.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
    const repaired = bodyRaw.replace(/^["']|["']$/g, "").trim();
    if (!repaired) return null;
    if (binding && countSubstringOccurrences(repaired, binding) !== 1) return null;

    const used_strategy =
      typeof parsed?.used_strategy === "string" ? parsed.used_strategy.trim() : "robot_consent_menu_naturalize";
    const sn = Array.isArray(parsed?.safety_notes)
      ? parsed.safety_notes.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];

    return {
      body: repaired,
      metadata: {
        robot_consent_menu_repair_used_strategy: used_strategy,
        robot_consent_menu_repair_safety_notes: sn,
        repair_snapshot_version: snapshotMeta.repair_snapshot_version,
        repair_snapshot_kind: snapshotMeta.repair_snapshot_kind,
        repair_snapshot_chars: snapshotMeta.repair_snapshot_chars,
        repair_snapshot_truncated: snapshotMeta.repair_snapshot_truncated,
      },
    };
  } catch (e) {
    console.warn("[v3-daily-relationship-lane] robot_consent_menu_repair_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function dailyBindingVerbatimForRobotGuard(facts: DailyV3RelationshipFacts): string | null {
  if (facts.route_kind === "contract_prompt" && facts.contract_proposal) {
    if (facts.contract_proposal.semantic_daily_contract_v1 === true) return null;
    const b =
      typeof facts.contract_proposal.binding_text_verbatim === "string"
        ? facts.contract_proposal.binding_text_verbatim.trim()
        : "";
    return b || null;
  }
  return null;
}

/** Contract / binding routes: lane repair must not rewrite required verbatim substrings. */
function dailyLanePostValidateRepairExcluded(facts: DailyV3RelationshipFacts): boolean {
  if (
    facts.route_kind === "contract_prompt" &&
    facts.contract_proposal?.semantic_daily_contract_v1 !== true
  )
    return true;
  return Boolean(facts.constraints.required_verbatim_substrings?.length);
}

/**
 * Produces the next relationship SMS for any daily cron branch.
 * Fail-closed: no deterministic coaching fallback; OpenAI/parse/validation failures → shouldSend false.
 */
async function produceDailyV3RelationshipSmsImpl(
  args: DailyV3RelationshipLaneInput
): Promise<DailyV3RelationshipLaneResult> {
  const sc = args.facts.silence_cadence;
  if (sc && !sc.send_today) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: sc.no_send_reason ?? "silence_cadence_no_send",
      replySource: "v3_daily_relationship_lane",
      turnPurpose: "silence_cadence_no_send",
      voiceConfidence: null,
      usedFacts: [],
      safetyNotes: [],
      openAiOk: false,
      metadata: {
        silence_cadence_route: sc.route,
        silence_day: sc.silence_day,
        send_today: sc.send_today,
        intentional_space: true,
        no_send_reason: sc.no_send_reason,
        skip_source: "silence_cadence_no_send",
        lane_stage: "silence_cadence_no_send",
        daily_writer_invoked: false,
        v3_brain_version: V3_BRAIN_VERSION,
        daily_v3_lane_used: true,
        route_purpose: args.facts.route_kind,
      },
      writerOpenAiCapture: null,
    };
  }

  let factsAfterThread = enrichDailyFactsWithThreadFreshness(args.facts);
  const useWritingBrief = useDailySmsWritingBriefV1(factsAfterThread);
  let briefThread: RecentExactThreadForBriefResult | null = null;

  if (useWritingBrief) {
    const nowForThread = new Date();
    briefThread = await buildRecentExactThreadForBrief({
      clerkUserId: factsAfterThread.user.clerk_user_id,
      commitmentId: factsAfterThread.commitment.id,
      timezone: factsAfterThread.user.timezone,
      now: nowForThread,
    });
    const coachBodies = extractCoachBodiesFromBriefThread(briefThread, nowForThread.getTime());
    factsAfterThread = {
      ...factsAfterThread,
      thread_memory: {
        ...factsAfterThread.thread_memory,
        recent_coach_body_do_not_repeat:
          coachBodies.length > 0
            ? coachBodies
            : factsAfterThread.thread_memory.recent_coach_body_do_not_repeat,
      },
    };
  }

  const laneFacts = enrichDailyFactsWithProofCalibrationAndFreshMove(factsAfterThread);
  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    ...(laneFacts.temporal_contract
      ? slimTemporalContractForTelemetry(laneFacts.temporal_contract)
      : {}),
    daily_v3_lane_used: true,
    daily_writer_invoked: true,
    v3_lane_reply_source: "v3_daily_relationship_lane" satisfies DailyV3RelationshipLaneReplySource,
    old_daily_writer_used_as_voice: false,
    old_daily_writer_fact_sources: args.telemetry_fact_sources,
    daily_facts_summary: summarizeFacts(laneFacts),
    suggested_coaching_move: laneFacts.suggested_coaching_move,
    route_purpose: laneFacts.route_kind,
    thread_freshness_used: Boolean(laneFacts.thread_freshness),
    thread_freshness_active_temporal_frame: laneFacts.thread_freshness?.active_temporal_frame ?? null,
    thread_freshness_completed_action_count: laneFacts.thread_freshness?.completed_actions.length ?? 0,
    ...(laneFacts.proof_calibration
      ? dailyProofCalibrationTelemetry(laneFacts.proof_calibration)
      : {}),
  };

  const empty = (
    reason: string,
    openAiOk: boolean,
    extra?: Record<string, unknown>,
    writerOpenAiCapture: TylerTextOverviewWriterOpenAiCapture | null = null
  ): DailyV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_daily_relationship_lane",
    turnPurpose: "no_send",
    voiceConfidence: null,
    usedFacts: [],
    safetyNotes: [],
    metadata: { ...baseMeta, ...extra },
    openAiOk,
    writerOpenAiCapture,
  });

  const client = getOpenAIClient();
  if (!client) {
    return empty("openai_unavailable", false, { lane_stage: "no_client" });
  }

  const relationshipPacket = buildRelationshipPacketForOpenAI({
    lane: "daily",
    sourceFacts: laneFacts,
    commitmentRow: args.commitmentRow ?? null,
  });
  Object.assign(
    baseMeta,
    relationshipPacketMetaForLaneTelemetry(relationshipPacket.meta, relationshipPacket.snapshotV2Meta)
  );

  let strategyCardUserAppendix = "";
  let strategyCardPromptGuidance = "";
  let validatedDailyC1Card: StrategyCardV1 | null = null;
  const strategyCardC1Eligible = isDailyC1StrategyCardEligible(laneFacts);
  const strategyCardC2Eligible = isDailyC2StrategyCardEligible(laneFacts);
  const strategyCardC3RefreshEligible = isDailyC3RefreshStrategyCardEligible(laneFacts);
  const strategyCardC3PendingEligible = isDailyC3PendingResolutionStrategyCardEligible(laneFacts);
  if (strategyCardC1Eligible) {
    const strategyCtx = buildDailyC1StrategyCardContextFromSnapshot({
      facts: laneFacts,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = finalizeStrategyCardWithRelationshipAnchorBoundaries(
      buildDailyC1StrategyCardV1({ ctx: strategyCtx }),
      {
        relationshipAnchorCount: relationshipPacket.meta.relationship_anchor_available_count ?? 0,
        scheduleAnchorCount: relationshipPacket.meta.schedule_anchor_available_count ?? 0,
      }
    );
    const validated = validateAndRepairDailyC1StrategyCardV1(draftCard, strategyCtx);
    validatedDailyC1Card = validated.card;
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated, strategyCtx));
  } else if (strategyCardC2Eligible) {
    const strategyCtx = buildDailyC2StrategyCardContextFromSnapshot({
      facts: laneFacts,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = buildDailyC2StrategyCardV1({ ctx: strategyCtx });
    const validated = validateAndRepairDailyContractPromptStrategyCardV1(draftCard, strategyCtx);
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated, strategyCtx));
  } else if (strategyCardC3RefreshEligible) {
    const strategyCtx = buildDailyC3RefreshStrategyCardContextFromSnapshot({
      facts: laneFacts,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = buildDailyC3RefreshStrategyCardV1({ ctx: strategyCtx });
    const validated = validateAndRepairDailyC3RefreshStrategyCardV1(draftCard, strategyCtx);
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated, strategyCtx));
  } else if (strategyCardC3PendingEligible) {
    const strategyCtx = buildDailyC3PendingResolutionStrategyCardContextFromSnapshot({
      facts: laneFacts,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = buildDailyC3PendingResolutionStrategyCardV1({ ctx: strategyCtx });
    const validated = validateAndRepairDailyC3PendingResolutionStrategyCardV1(draftCard, strategyCtx);
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated, strategyCtx));
  }

  const strategyCardDailyActive =
    strategyCardC1Eligible ||
    strategyCardC2Eligible ||
    strategyCardC3RefreshEligible ||
    strategyCardC3PendingEligible;

  const dailyZeroQuestionMode = resolveDailyZeroQuestionModeFromCard(validatedDailyC1Card);
  if (dailyZeroQuestionMode) {
    Object.assign(baseMeta, { daily_zero_question_mode_active: true });
  }

  const dailyQuestionConstraintLine = dailyZeroQuestionMode
    ? "zero questions required — write one statement-only coaching touch (no question mark, no hidden ask)"
    : strategyCardC1Eligible
      ? "at most one question (zero questions okay when closing, protecting, encouraging, or planning) or one concrete action"
      : "one clear question or one concrete action";
  const dailyAccountabilityHumanLanguageLine = dailyZeroQuestionMode
    ? "- Use human accountability language in statements — not interrogation (no did you / what happened / what got in the way / can you phrasing)."
    : '- Never expose internal accountability labels in visible SMS (partial, yes/no/partial, done/partial/missed, user_yes, user_no, user_partial, classification, route). Use human language: "did it happen or did something get in the way?", "did you get it done, start it, or miss it?", "what happened with the plan?"';
  const dailyOpenQuestionGuidance = dailyZeroQuestionMode
    ? buildDailyZeroQuestionOpenQuestionStatementGuidance()
    : buildDailyOpenQuestionAnswerPriorityGuidance();
  const dailyPendingPlanGuardrails = dailyZeroQuestionMode
    ? buildDailyZeroQuestionPendingPlanProofGuardrails(laneFacts.accountability.pending_plan_proof)
    : buildPendingPlanProofLaneGuardrails(laneFacts.accountability.pending_plan_proof);
  const dailySatisfiedAskAdvanceLine = dailyZeroQuestionMode
    ? "- If structured_recent_truth.turn_understanding or daily_satisfied_ask_context shows the user already satisfied the prior coach ask, acknowledge their answer in a statement and move forward — do not repeat or paraphrase do_not_repeat_asks."
    : strategyCardC1Eligible
      ? ""
      : "- If structured_recent_truth.turn_understanding or daily_satisfied_ask_context shows the user already satisfied the prior coach ask, do NOT repeat or paraphrase do_not_repeat_asks — acknowledge their answer and move to a non-stale next step or outcome-close question.";

  let system: string;
  let user: string;

  if (
    useWritingBrief &&
    validatedDailyC1Card &&
    briefThread &&
    laneFacts.proof_calibration
  ) {
    const freshnessPhrases = deriveFreshnessAvoidPhrasesForBrief(
      laneFacts.thread_memory.recent_coach_body_do_not_repeat,
      {
        effectiveAsk: laneFacts.commitment.effective_ask,
        behaviorStatement: laneFacts.commitment.behavior_statement,
      }
    );
    const brief = buildDailySmsWritingBriefV1({
      facts: laneFacts,
      proof_calibration: laneFacts.proof_calibration,
      strategy_card: validatedDailyC1Card,
      thread: briefThread,
      freshness_phrases: freshnessPhrases,
      commitmentRow: args.commitmentRow ?? null,
      writing_brief_overrides: args.writing_brief_overrides,
    });
    const writerMsgs = buildDailySmsWriterMessagesFromBrief(brief);
    system = writerMsgs.system;
    user = writerMsgs.user;
    const nowForBriefThread = new Date();
    const threadWindow = deriveBriefThreadWindowTelemetry(
      briefThread.timeline_7d.messages,
      nowForBriefThread.getTime()
    );
    Object.assign(
      baseMeta,
      dailyWritingBriefTelemetry({
        brief,
        writer_system_chars: writerMsgs.writer_system_chars,
        writer_payload_chars: writerMsgs.writer_payload_chars,
        writer_total_chars: writerMsgs.writer_total_chars,
        threadWindow,
        threadBuild: briefThread.build_telemetry,
      }),
      {
        slot_coaching_context: brief.slot_coaching_context,
        current_send_slot: brief.current_send_slot,
      },
      buildDailyNotebookTelemetry({
        buildTelemetry: briefThread.build_telemetry,
        briefBuildStatus: "used",
        messageCount: brief.recent_exact_thread.message_count,
        exactSourceMessageCount: briefThread.exact_source_message_count,
        lastOutboundFallbackMessageCount: briefThread.last_outbound_fallback_message_count,
        writerInvoked: true,
      })
    );
  } else {
    system = `You are writing the NEXT SMS in one long coaching relationship (months of thread). This is not an isolated reminder app.

RULES:
${dailyZeroQuestionMode ? buildDailyZeroQuestionModeSystemRules() : ""}
${laneFacts.proof_calibration ? buildDailyProofCalibrationPromptBlock(laneFacts.proof_calibration) : ""}
${laneFacts.fresh_move?.fresh_move_required ? buildDailyFreshMovePromptBlock(laneFacts.fresh_move) : ""}
- Summaries in lower_authority_background, relationship_memory_7d, and relationship_memory_30d_or_season are background only (summary_authority=background_only). Do not convert summaries into praise unless structured_recent_truth.daily_proof_calibration allows it. Exact recent thread + daily proof calibration beat summaries (exact_thread_and_calibration_win=true).
- Use RELATIONSHIP_PACKET_V1 only as facts — never copy old template wording or paraphrase labeled machine drafts.
${buildRelationshipPacketPromptGuidance()}
${strategyCardPromptGuidance}
- When structured_recent_truth.projection_used is true, latest_open_question and latest_answer_after_open_question are server-owned durable projection — they beat runtime guesses and previews.
- recent_exact_thread (when present) is the highest-priority transcript — it outranks coaching summaries and older transcript blocks when they conflict.
${strategyCardC1Eligible ? buildDailyC1StrategyCardDemotedPromptRules() : ""}
${strategyCardC1Eligible || dailyZeroQuestionMode ? "" : `- Do NOT ask the same question as any entry in structured_recent_truth.last_5_coach_questions unless the user clearly has not answered and you briefly acknowledge that.`}
${buildDailyRecentCoachBodyDoNotRepeatGuidance(laneFacts)}
${dailyOpenQuestionGuidance}
${dailySatisfiedAskAdvanceLine}
- If thread_memory.latest_open_question is already answered in recent exact thread with proof/outcome (not only a forward plan while pending_plan_proof is active), advance from that answer.
${strategyCardC1Eligible || dailyZeroQuestionMode ? "" : `- Do not use "Welcome back" unless accountability.reentry_active is true or silence context truly warrants a comeback line.`}
- Avoid repeating the prior day's opener or the same coach question from recent exact thread.
- Anchor to the user's real commitment (effective ask + state), without pasting raw title or behavior_statement as a quoted phrase or "Did [raw] happen today?" / "Did you protect [raw]?" style checks.
- One short SMS, max ${DAILY_LANE_MAX_CHARS} characters, no newlines, ${dailyQuestionConstraintLine}.
${dailyAccountabilityHumanLanguageLine}
- No generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope your", "checking in" as filler).
${strategyCardC1Eligible || dailyZeroQuestionMode ? "" : `- If facts say reentry/comeback after silence, acknowledge return briefly before the ask.`}
- If unsafe, uncertain, or facts conflict badly, return should_send false.
${buildThreadFreshnessPromptGuidance()}
${buildVictoryBackgroundLaneGuardrails()}
${buildSmsPatternSignalLaneGuardrails()}
${buildSmsGoalAdjustmentLaneGuardrails()}
${buildCoachGoalEvolutionInviteLaneGuardrails()}
${buildPlannedInterruptionLaneGuardrails()}
${dailyPendingPlanGuardrails}
${buildTimingAnchorMemoryLaneGuardrails(laneFacts.accountability.timing_anchor_memory)}
${routeSpecificSystemAddendum(laneFacts, {
  strategyCardC2Active: strategyCardC2Eligible,
  strategyCardC3PendingActive: strategyCardC3PendingEligible,
})}

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[])`;

    const writerUserPrompt = buildWriterUserPromptWithStrategyCard({
      userPromptJson: relationshipPacket.userPromptJson,
      strategyCardAppendix: strategyCardUserAppendix,
      stripWhenCardActive: strategyCardDailyActive ? { lane: "daily" } : undefined,
    });
    if (writerUserPrompt.stripped_fields.length > 0) {
      Object.assign(baseMeta, {
        strategy_card_packet_writer_hints_stripped: true,
        strategy_card_packet_stripped_fields: writerUserPrompt.stripped_fields,
      });
    }
    user = writerUserPrompt.prompt;
    Object.assign(baseMeta, {
      writer_prompt_path: "legacy_packet_v1",
      daily_writing_brief_used: false,
      writer_system_chars: system.length,
      writer_payload_chars: user.length,
      writer_total_chars: system.length + user.length,
      ...deriveDailyWritingBriefFallbackTelemetry({
        facts: laneFacts,
        validatedDailyC1Card,
        briefThread,
        hasProofCalibration: Boolean(laneFacts.proof_calibration),
      }),
    });
  }

  let laneOpenAiJsonMeta: Record<string, unknown> = {};
  let parsed: LaneModelJson | null = null;
  const writerPromptPathForCapture =
    typeof baseMeta.writer_prompt_path === "string" ? baseMeta.writer_prompt_path : null;
  const writerOpenAiCapture = buildWriterOpenAiCapture({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    model: DAILY_V3_LANE_OPENAI_MODEL,
    writer_prompt_path: writerPromptPathForCapture,
  });
  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<LaneModelJson>({
      client,
      model: DAILY_V3_LANE_OPENAI_MODEL,
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: writerOpenAiCapture.messages,
      jsonSchemaReminder:
        "Keys: should_send (boolean), body (string), no_send_reason (string|null), turn_purpose (string), voice_confidence (number 0-1 or null), used_facts (string[]), safety_notes (string[]).",
      parse: safeJsonParse,
    });
    parsed = jsonOut.value;
    laneOpenAiJsonMeta = jsonOut.retryMeta as unknown as Record<string, unknown>;
  } catch (e) {
    return empty("openai_request_failed", true, {
      lane_stage: "openai_error",
      message: e instanceof Error ? e.message : String(e),
    }, writerOpenAiCapture);
  }

  if (!parsed) {
    return empty("invalid_json", true, {
      lane_stage: "parse",
      ...laneOpenAiJsonMeta,
    }, writerOpenAiCapture);
  }

  const shouldSendModel = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const turnPurpose = typeof parsed.turn_purpose === "string" ? parsed.turn_purpose.trim() : "daily_turn";
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);
  const bodyPreview = (s: string) => (s.length > 220 ? `${s.slice(0, 219)}…` : s);
  let successLaneStage: "ok" | "post_validate_repaired" = "ok";
  let successRepairExtra: Record<string, unknown> = {};
  const preservePrimaryForTto = args.tto_draft_preserve_primary_body === true;
  const primaryWriterShouldSend = shouldSendModel;
  const primaryWriterNoSendReason = noSendReason;

  if (!shouldSendModel) {
    if (!(preservePrimaryForTto && body)) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: noSendReason || "model_no_send",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes,
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "model_no_send",
          v3_candidate_body: "",
        },
        openAiOk: true,
        writerOpenAiCapture,
      };
    }
    // Morning TTO: keep non-empty primary body for Tyler even when model recommended no-send.
  }

  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body", ...laneOpenAiJsonMeta }, writerOpenAiCapture);
  }
  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "trim_empty", ...laneOpenAiJsonMeta }, writerOpenAiCapture);
  }

  const primaryWriterBody = body;

  if (preservePrimaryForTto) {
    const bindingVerbatim = dailyBindingVerbatimForRobotGuard(laneFacts);
    const missingVerb = validateRequiredVerbatims(
      primaryWriterBody,
      laneFacts.constraints.required_verbatim_substrings
    );
    if (missingVerb != null) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "missing_required_verbatim",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, `missing_verbatim:${missingVerb.slice(0, 80)}`],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "verbatim_validation_failed",
          v3_candidate_body: primaryWriterBody,
          first_missing_verbatim_preview: missingVerb.slice(0, 120),
          post_writer_checks_softened_for_tto: true,
          primary_writer_should_send: primaryWriterShouldSend,
          primary_writer_no_send_reason: primaryWriterNoSendReason,
        },
        openAiOk: true,
        writerOpenAiCapture,
      };
    }

    const semanticContractFail = runSemanticDailyContractValidatorIfApplicable(
      laneFacts,
      primaryWriterBody
    );
    if (semanticContractFail != null) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: `semantic_daily_contract_blocked:${semanticContractFail.reason_code}`,
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [
          ...safetyNotes,
          `blocked:semantic_daily_contract_validator:${semanticContractFail.reason_code}`,
        ],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "semantic_daily_contract_validator_failed",
          semantic_contract_validator_detail:
            semanticContractFail.reason_detail ?? semanticContractFail.reason_code,
          v3_candidate_body: primaryWriterBody,
          post_writer_checks_softened_for_tto: true,
          primary_writer_should_send: primaryWriterShouldSend,
          primary_writer_no_send_reason: primaryWriterNoSendReason,
        },
        openAiOk: true,
        writerOpenAiCapture,
      };
    }

    const draftContentWarnings: string[] = [];
    if (!primaryWriterShouldSend) {
      draftContentWarnings.push(
        primaryWriterNoSendReason
          ? `primary_model_no_send:${primaryWriterNoSendReason}`
          : "primary_model_no_send"
      );
    }

    const robotMenuReasons = detectRelationshipRobotConsentMenuReasons(primaryWriterBody, {
      bindingVerbatim,
    });
    for (const r of robotMenuReasons) draftContentWarnings.push(`robot_consent_menu:${r}`);

    const postValidate = collectDailyPostValidateVoiceViolations(
      primaryWriterBody,
      laneFacts,
      bindingVerbatim
    );
    for (const r of postValidate.blocked) draftContentWarnings.push(`post_validate:${r}`);

    if (shouldRunDailyTemporalWordingGuard(laneFacts)) {
      const temporalHits = detectDailyTemporalWordingViolationsForLane(
        primaryWriterBody,
        laneFacts,
        bindingVerbatim
      );
      for (const hit of temporalHits) {
        draftContentWarnings.push(`temporal_wording:${hit.reason}`);
      }
    }

    if (shouldRunDailyThreadFreshnessGuard(laneFacts)) {
      const freshnessHit = detectThreadFreshnessViolations(
        primaryWriterBody,
        laneFacts.thread_freshness
      );
      if (freshnessHit) {
        draftContentWarnings.push(`thread_freshness:${freshnessHit.reason}`);
      }
    }

    if (shouldRunDailyMemoryRepeatGuard(laneFacts)) {
      const memoryHit = detectSmsMemoryRepeatViolation(
        buildAntiRepeatDetectArgsFromDailyFacts(laneFacts, primaryWriterBody)
      );
      if (memoryHit.hasViolation) {
        draftContentWarnings.push(
          `memory_repeat:${memoryHit.reason ?? "thread_memory_repeat"}`
        );
      }
    }

    if (laneFacts.route_kind !== "contract_prompt") {
      const staleAskGuard = applyDailyStaleAskDetectOnly({
        body: primaryWriterBody,
        satisfiedAskContext: laneFacts.daily_satisfied_ask_context,
        lastCoachQuestions: laneFacts.thread_memory.last_5_coach_questions,
        answeredOpenQuestion: laneFacts.thread_memory.latest_open_question ?? null,
        latestAnswerText: laneFacts.thread_memory.latest_answer_after_open_question ?? null,
        routePurpose: laneFacts.route_kind,
        stage: "daily_lane_pre_send",
      });
      if (staleAskGuard.outcome === "no_send") {
        draftContentWarnings.push(
          `stale_ask:${staleAskGuard.noSendReason ?? "stale_ask_no_send"}`
        );
      }
    }

    const proofSeatbelts = applyDailyProofCalibrationSeatbelts(primaryWriterBody, laneFacts);
    if (proofSeatbelts.blocked) {
      draftContentWarnings.push(
        `proof_seatbelt:${proofSeatbelts.noSendReason ?? "proof_calibration_blocked"}`
      );
    }

    return {
      body: primaryWriterBody,
      shouldSend: true,
      noSendReason: null,
      replySource: "v3_daily_relationship_lane",
      turnPurpose,
      voiceConfidence,
      usedFacts,
      safetyNotes: [
        ...safetyNotes,
        ...draftContentWarnings.map((w) => `tto_draft_warning:${w}`),
      ],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage:
          draftContentWarnings.length > 0 ? "ok_with_draft_content_warnings" : "ok",
        v3_candidate_body: primaryWriterBody,
        post_writer_checks_softened_for_tto: true,
        primary_writer_should_send: primaryWriterShouldSend,
        primary_writer_no_send_reason: primaryWriterNoSendReason,
        draft_content_warnings: draftContentWarnings,
        ...postValidate.praiseMetadata,
        ...(slimDailySatisfiedAskContextForTelemetry(laneFacts.daily_satisfied_ask_context) ?? {}),
        praise_policy_context: buildSmsPraisePolicyArgsFromDailyFacts({
          body: primaryWriterBody,
          routeKind: laneFacts.route_kind,
          accountability: laneFacts.accountability,
          commitment: laneFacts.commitment,
          thread_memory: laneFacts.thread_memory,
        }),
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  const bindingVerbatim = dailyBindingVerbatimForRobotGuard(laneFacts);
  const robotMenuReasons = detectRelationshipRobotConsentMenuReasons(body, { bindingVerbatim });
  let robotConsentMenuExtra: Record<string, unknown> = {};
  if (robotMenuReasons.length > 0) {
    const originalRobotSnapshot = body;
    const robotRepair = await repairDailyRelationshipRobotConsentMenu({
      originalBody: body,
      bindingVerbatim,
      blockedReasons: robotMenuReasons,
      laneFacts,
      routePurpose: laneFacts.route_kind,
    });
    robotConsentMenuExtra = {
      robot_consent_menu_blocked_reasons: robotMenuReasons,
      robot_consent_menu_repair_attempted: true,
      robot_consent_menu_repair_succeeded: false,
      v3_candidate_body: originalRobotSnapshot,
    };
    if (robotRepair) {
      body = robotRepair.body.replace(/^["']|["']$/g, "").trim();
      robotConsentMenuExtra = {
        ...robotConsentMenuExtra,
        ...robotRepair.metadata,
        repaired_candidate_body: body,
      };
    }
    const robotAfter = detectRelationshipRobotConsentMenuReasons(body, { bindingVerbatim });
    if (robotRepair && robotAfter.length === 0) {
      robotConsentMenuExtra = {
        ...robotConsentMenuExtra,
        robot_consent_menu_repair_succeeded: true,
      };
    }
    if (robotAfter.length > 0) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: relationshipRobotConsentMenuNoSendReason(robotAfter),
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...robotAfter.map((r) => `blocked:${r}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "robot_consent_menu_blocked",
          robot_consent_menu_blocked_reasons: robotAfter,
          ...robotConsentMenuExtra,
        },
        openAiOk: true,
      writerOpenAiCapture,
      };
    }
    if (robotRepair) {
      successLaneStage = "post_validate_repaired";
      successRepairExtra = { ...successRepairExtra, ...robotConsentMenuExtra };
    }
  }

  const pendingPlan = laneFacts.accountability.pending_plan_proof;
  const timingMemory = laneFacts.accountability.timing_anchor_memory;
  const postValidate = collectDailyPostValidateVoiceViolations(body, laneFacts, bindingVerbatim);
  const blocked = postValidate.blocked;
  const praiseMetadata = postValidate.praiseMetadata;
  if (blocked.length > 0) {
    const { repairable, hard } = partitionFinalVoiceBlockedReasons(blocked);

    if (
      hard.length > 0 ||
      repairable.length === 0 ||
      dailyLanePostValidateRepairExcluded(laneFacts)
    ) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...blocked.map((b) => `blocked:${b}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_blocked",
          v3_candidate_body: body,
          blocked_reasons: blocked,
          ...praiseMetadata,
        },
        openAiOk: true,
      writerOpenAiCapture,
      };
    }

    const originalCandidateSnapshot = body;

    const timingViolations = detectTimingAnchorVoiceViolations({
      body,
      timingAnchorMemory: timingMemory,
      pendingPlanProof: pendingPlan,
      hasProofOrKnownOutcome: inferHasProofOrKnownOutcomeForDailyAccountability(laneFacts.accountability),
    });
    const pendingRepairHint =
      pendingPlan?.active === true &&
      repairable.some((r) => r.startsWith("unearned_") || r === "presumed_recurring_anchor_schedule")
        ? buildPendingPlanProofVoiceRepairInstruction(pendingPlan)
        : null;
    const timingRepairHint =
      timingViolations.length > 0
        ? buildTimingAnchorVoiceRepairInstruction(timingViolations, timingMemory, pendingPlan)
        : null;

    const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
      repairKind: "lane_post_validate",
      routeKind: "daily",
      routePurpose: laneFacts.route_kind,
      blockedBody: body,
      blockedReasons: repairable,
      laneFacts,
      laneBlockedReasons: blocked,
    });

    const repairLoop = await runLanePostValidateRepairLoop({
      routeKind: "daily",
      routePurpose: laneFacts.route_kind,
      originalBody: body,
      initialBlocked: blocked,
      initialRepairable: repairable,
      repairSnapshot,
      snapshotMeta,
      systemInstruction:
        [pendingRepairHint, timingRepairHint].filter(Boolean).join("\n\n") || undefined,
      validateAfterRepair: (candidate) => {
        const postValidateAfter = collectDailyPostValidateVoiceViolations(
          candidate,
          laneFacts,
          bindingVerbatim
        );
        const missingAfterRepair = validateRequiredVerbatims(
          candidate,
          laneFacts.constraints.required_verbatim_substrings
        );
        return {
          blockedReasons: postValidateAfter.blocked,
          missingRequiredVerbatim: missingAfterRepair != null,
        };
      },
    });

    if (!repairLoop.ok) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [
          ...safetyNotes,
          ...blocked.map((b) => `blocked:${b}`),
          ...(repairLoop.repairedBlockedReasons ?? []).map((b) => `repaired_blocked:${b}`),
        ],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_repair_failed",
          v3_candidate_body: originalCandidateSnapshot,
          blocked_reasons: blocked,
          lane_repair_attempted: true,
          lane_repair_succeeded: false,
          original_blocked_reasons: repairable,
          original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
          repaired_candidate_body: repairLoop.repairedBody,
          repaired_blocked_reasons: repairLoop.repairedBlockedReasons,
          ...repairLoop.lastRepairMetadata,
          ...snapshotMeta,
          ...repairLoop.telemetry,
          ...(repairLoop.extraMeta ?? {}),
        },
        openAiOk: true,
      writerOpenAiCapture,
      };
    }

    body = repairLoop.body;
    successLaneStage = "post_validate_repaired";
    successRepairExtra = {
      lane_repair_attempted: true,
      lane_repair_succeeded: true,
      original_blocked_reasons: repairable,
      original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
      repaired_candidate_body: repairLoop.body,
      repaired_blocked_reasons: [],
      ...repairLoop.lastRepairMetadata,
      ...snapshotMeta,
      ...repairLoop.telemetry,
    };
  }

  if (
    laneFacts.route_kind === "contract_prompt" &&
    laneFacts.contract_proposal &&
    laneFacts.contract_proposal.semantic_daily_contract_v1 !== true
  ) {
    const bindingVerbatim = (laneFacts.contract_proposal.binding_text_verbatim ?? "").trim();
    const wrapperForbidden =
      laneFacts.constraints.wrapper_must_not_repeat_substrings?.length
        ? laneFacts.constraints.wrapper_must_not_repeat_substrings
        : [...DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT];

    let contractDup = detectContractWrapperDuplicates(body, bindingVerbatim, wrapperForbidden);
    if (contractDup.length > 0) {
      const originalContractSnapshot = body;
      const originalContractDup = contractDup;
      const contractRepair = await repairDailyContractWrapperDuplicate({
        originalBody: body,
        bindingVerbatim,
        blockedReasons: contractDup,
        laneFacts,
        routePurpose: laneFacts.route_kind,
        wrapperMustNotRepeatSubstrings: wrapperForbidden,
      });

      if (!contractRepair) {
        return {
          body: "",
          shouldSend: false,
          noSendReason: "contract_wrapper_duplicate",
          replySource: "v3_daily_relationship_lane",
          turnPurpose: turnPurpose || "no_send",
          voiceConfidence,
          usedFacts,
          safetyNotes: [...safetyNotes, ...contractDup.map((c) => `blocked:${c}`)],
          metadata: {
            ...baseMeta,
            ...laneOpenAiJsonMeta,
            lane_stage: "contract_wrapper_repair_failed",
            v3_candidate_body: originalContractSnapshot,
            contract_wrapper_blocked_reasons: contractDup,
            contract_wrapper_repair_attempted: true,
            contract_wrapper_repair_succeeded: false,
          },
          openAiOk: true,
        writerOpenAiCapture,
        };
      }

      body = contractRepair.body.replace(/^["']|["']$/g, "").trim();
      contractDup = detectContractWrapperDuplicates(body, bindingVerbatim, wrapperForbidden);
      const missingBindingAfterContractRepair = validateRequiredVerbatims(
        body,
        laneFacts.constraints.required_verbatim_substrings
      );
      const fvgAfterContractRepair = detectRelationshipCoachingVoiceBlockedReasons(body, {
        bindingVerbatim,
      });
      const robotAfterContractRepair = detectRelationshipRobotConsentMenuReasons(body, {
        bindingVerbatim,
      });

      if (
        contractDup.length > 0 ||
        missingBindingAfterContractRepair != null ||
        fvgAfterContractRepair.length > 0 ||
        robotAfterContractRepair.length > 0
      ) {
        return {
          body: "",
          shouldSend: false,
          noSendReason:
            missingBindingAfterContractRepair != null
              ? "missing_required_verbatim"
              : "contract_wrapper_duplicate",
          replySource: "v3_daily_relationship_lane",
          turnPurpose: turnPurpose || "no_send",
          voiceConfidence,
          usedFacts,
          safetyNotes: [
            ...safetyNotes,
            ...contractDup.map((c) => `blocked:${c}`),
            ...fvgAfterContractRepair.map((b) => `repaired_blocked:${b}`),
          ],
          metadata: {
            ...baseMeta,
            ...laneOpenAiJsonMeta,
            lane_stage: "contract_wrapper_repair_failed",
            v3_candidate_body: originalContractSnapshot,
            contract_wrapper_blocked_reasons: contractDup,
            contract_wrapper_repair_attempted: true,
            contract_wrapper_repair_succeeded: false,
            repaired_candidate_body: body,
            repaired_contract_wrapper_blocked_reasons: contractDup,
            repaired_fvg_blocked_reasons: fvgAfterContractRepair,
            robot_consent_menu_blocked_reasons: robotAfterContractRepair,
            ...(missingBindingAfterContractRepair != null
              ? { first_missing_verbatim_preview: missingBindingAfterContractRepair.slice(0, 120) }
              : {}),
            ...contractRepair.metadata,
          },
          openAiOk: true,
        writerOpenAiCapture,
        };
      }

      successLaneStage = "post_validate_repaired";
      successRepairExtra = {
        ...successRepairExtra,
        contract_wrapper_repair_attempted: true,
        contract_wrapper_repair_succeeded: true,
        original_contract_wrapper_blocked_reasons: originalContractDup,
        original_candidate_body_preview: bodyPreview(originalContractSnapshot),
        repaired_candidate_body: body,
        ...contractRepair.metadata,
      };
    }
  }

  const missingVerb = validateRequiredVerbatims(body, laneFacts.constraints.required_verbatim_substrings);
  if (missingVerb != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "missing_required_verbatim",
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `missing_verbatim:${missingVerb.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "verbatim_validation_failed",
        v3_candidate_body: body,
        first_missing_verbatim_preview: missingVerb.slice(0, 120),
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  const semanticContractFailEarly = runSemanticDailyContractValidatorIfApplicable(laneFacts, body);
  if (semanticContractFailEarly != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: `semantic_daily_contract_blocked:${semanticContractFailEarly.reason_code}`,
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [
        ...safetyNotes,
        `blocked:semantic_daily_contract_validator:${semanticContractFailEarly.reason_code}`,
      ],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "semantic_daily_contract_validator_failed",
        semantic_contract_validator_detail:
          semanticContractFailEarly.reason_detail ?? semanticContractFailEarly.reason_code,
        v3_candidate_body: body,
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  const temporalGuard = await applyDailyTemporalWordingGuard({
    body,
    laneFacts,
    bindingVerbatim: dailyBindingVerbatimForRobotGuard(laneFacts),
    turnPurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    baseMeta,
    laneOpenAiJsonMeta,
    successRepairExtra,
  });
  if (temporalGuard.outcome === "no_send") {
    return {
      body: "",
      shouldSend: false,
      noSendReason: temporalGuard.noSendReason,
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "temporal_wording_blocked",
        v3_candidate_body: body,
        ...temporalGuard.metadata,
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }
  body = temporalGuard.body;
  if (temporalGuard.metadata.temporal_wording_repair_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...temporalGuard.metadata };
  } else if (Object.keys(temporalGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...temporalGuard.metadata };
  }

  const freshnessGuard = await applyThreadFreshnessGuard({
    routeKind: "daily",
    routePurpose: laneFacts.route_kind,
    body,
    factsJson: laneFacts,
    freshness: laneFacts.thread_freshness,
    enabled: shouldRunDailyThreadFreshnessGuard(laneFacts),
  });

  if (freshnessGuard.outcome === "no_send") {
    return {
      body: "",
      shouldSend: false,
      noSendReason: freshnessGuard.noSendReason,
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "thread_freshness_guard_failed",
        v3_candidate_body: body,
        ...freshnessGuard.metadata,
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  body = freshnessGuard.body;
  if (freshnessGuard.metadata.thread_freshness_repair_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...freshnessGuard.metadata };
  } else if (Object.keys(freshnessGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...freshnessGuard.metadata };
  }

  const memoryRepeatGuard = await applySmsMemoryAntiRepeatGuard({
    routeKind: "daily",
    routePurpose: laneFacts.route_kind,
    body,
    factsJson: laneFacts,
    detectInput: buildAntiRepeatDetectArgsFromDailyFacts(laneFacts, body),
    enabled: shouldRunDailyMemoryRepeatGuard(laneFacts),
    openAiRepairEnabled: true,
    additionalRepairInstruction: dailyZeroQuestionMode
      ? buildDailyMemoryRepeatZeroQuestionRepairInstruction()
      : undefined,
    validateAfterRepair: async (candidate) => {
      if (dailyZeroQuestionMode) {
        const zeroQRepair = detectDailyZeroQuestionStatementRepairViolation(candidate);
        if (zeroQRepair.violation) {
          return {
            ok: false,
            noSendReason: "thread_memory_repeat_blocked",
            extraMeta: {
              memory_repeat_no_send_reason: "zero_question_repair_violation",
              daily_zero_question_repair_violation_reason: zeroQRepair.reason,
              memory_repeat_repair_skipped_zero_question_mode: false,
            },
          };
        }
      }
      const after = collectDailyPostValidateVoiceViolations(
        candidate,
        laneFacts,
        dailyBindingVerbatimForRobotGuard(laneFacts)
      );
      const blockedAfter = after.blocked;
      if (blockedAfter.length > 0) {
        return {
          ok: false,
          noSendReason: "lane_post_validate_blocked",
          extraMeta: { repaired_blocked_reasons: blockedAfter },
        };
      }
      if (shouldRunDailyThreadFreshnessGuard(laneFacts)) {
        const freshnessAfterRepeat = detectThreadFreshnessViolations(
          candidate,
          laneFacts.thread_freshness
        );
        if (freshnessAfterRepeat) {
          return {
            ok: false,
            noSendReason: "thread_freshness_stale_blocked",
            extraMeta: {
              thread_freshness_violation_detected: true,
              thread_freshness_violation_reason: freshnessAfterRepeat.reason,
            },
          };
        }
      }
      const temporalAfterRepeat = detectDailyTemporalWordingViolationsForLane(
        candidate,
        laneFacts,
        dailyBindingVerbatimForRobotGuard(laneFacts)
      );
      if (temporalAfterRepeat.length > 0) {
        return {
          ok: false,
          noSendReason: "temporal_wording_blocked",
          extraMeta: {
            temporal_wording_violation_detected: true,
            temporal_wording_violation_reason: temporalAfterRepeat[0]!.reason,
            ...(successRepairExtra.temporal_wording_repair_attempted === true
              ? { temporal_wording_repair_attempted: true }
              : {}),
            temporal_wording_repair_succeeded: false,
          },
        };
      }
      const missingAfter = validateRequiredVerbatims(
        candidate,
        laneFacts.constraints.required_verbatim_substrings
      );
      if (missingAfter != null) {
        return {
          ok: false,
          noSendReason: "missing_required_verbatim",
          extraMeta: { first_missing_verbatim_preview: missingAfter.slice(0, 120) },
        };
      }

      const semFail = runSemanticDailyContractValidatorIfApplicable(laneFacts, candidate);
      if (semFail != null) {
        return {
          ok: false,
          noSendReason: `semantic_daily_contract_blocked:${semFail.reason_code}`,
          extraMeta: {
            semantic_contract_validator_detail: semFail.reason_detail ?? semFail.reason_code,
          },
        };
      }
      return { ok: true };
    },
  });

  if (memoryRepeatGuard.outcome === "no_send") {
    return {
      body: "",
      shouldSend: false,
      noSendReason: memoryRepeatGuard.noSendReason,
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "daily_thread_memory_repeat_guard_failed",
        v3_candidate_body: body,
        ...memoryRepeatGuard.metadata,
        skip_source: "memory_repeat_no_send",
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  body = memoryRepeatGuard.body;
  if (memoryRepeatGuard.metadata.memory_repeat_guard_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
  } else if (Object.keys(memoryRepeatGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
  }

  if (laneFacts.route_kind !== "contract_prompt") {
    const staleAskGuard = applyDailyStaleAskDetectOnly({
      body,
      satisfiedAskContext: laneFacts.daily_satisfied_ask_context,
      lastCoachQuestions: laneFacts.thread_memory.last_5_coach_questions,
      answeredOpenQuestion: laneFacts.thread_memory.latest_open_question ?? null,
      latestAnswerText: laneFacts.thread_memory.latest_answer_after_open_question ?? null,
      routePurpose: laneFacts.route_kind,
      stage: "daily_lane_pre_send",
    });

    if (staleAskGuard.outcome === "no_send") {
      return {
        body: "",
        shouldSend: false,
        noSendReason: staleAskGuard.noSendReason,
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, "daily_stale_ask_blocked"],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "daily_stale_ask_guard_failed",
          v3_candidate_body: body,
          ...successRepairExtra,
          ...staleAskGuard.metadata,
          no_send_reason: staleAskGuard.noSendReason,
          ...(slimDailySatisfiedAskContextForTelemetry(laneFacts.daily_satisfied_ask_context) ?? {}),
          skip_source: "stale_ask_no_send",
        },
        openAiOk: true,
      writerOpenAiCapture,
      };
    }

    if (Object.keys(staleAskGuard.metadata).length > 0) {
      successRepairExtra = { ...successRepairExtra, ...staleAskGuard.metadata };
    }
  }

  const proofSeatbelts = applyDailyProofCalibrationSeatbelts(body, laneFacts);
  if (proofSeatbelts.blocked) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: proofSeatbelts.noSendReason ?? "lane_post_validate_blocked",
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: proofSeatbelts.metadata.lane_stage ?? "daily_proof_calibration_seatbelt_blocked",
        v3_candidate_body: body,
        ...successRepairExtra,
        ...proofSeatbelts.metadata,
        skip_source: "proof_calibration_seatbelt_no_send",
      },
      openAiOk: true,
      writerOpenAiCapture,
    };
  }

  const finalPraise = collectDailyPostValidateVoiceViolations(
    body,
    laneFacts,
    dailyBindingVerbatimForRobotGuard(laneFacts)
  );

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_daily_relationship_lane",
    turnPurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      ...laneOpenAiJsonMeta,
      lane_stage: successLaneStage,
      v3_candidate_body: body,
      ...successRepairExtra,
      ...finalPraise.praiseMetadata,
      ...(slimDailySatisfiedAskContextForTelemetry(laneFacts.daily_satisfied_ask_context) ?? {}),
      praise_policy_context: buildSmsPraisePolicyArgsFromDailyFacts({
        body,
        routeKind: laneFacts.route_kind,
        accountability: laneFacts.accountability,
        commitment: laneFacts.commitment,
        thread_memory: laneFacts.thread_memory,
      }),
    },
    openAiOk: true,
  writerOpenAiCapture,
  };
}

export async function produceDailyV3RelationshipSms(
  args: DailyV3RelationshipLaneInput
): Promise<DailyV3RelationshipLaneResult> {
  const result = await produceDailyV3RelationshipSmsImpl(args);
  return {
    ...result,
    metadata: attachDailyNotebookVerdictToMetadata(result.metadata ?? {}),
  };
}

/** Coaching memory → compact do-not-repeat / pattern hints for the lane (facts only). */
export function deriveDoNotRepeatHintsFromCoachingMemory(m: V2CoachingMemoryForPrompt | null): string[] {
  if (!m) return [];
  const out: string[] = [];
  for (const t of m.blocker_tags ?? []) {
    if (t?.trim()) out.push(`blocker_tag:${t.trim()}`);
  }
  if (m.latest_blocker_preview?.trim()) {
    out.push(`latest_blocker_preview:${m.latest_blocker_preview.trim().slice(0, 120)}`);
  }
  return out.slice(0, 12);
}

/** Bounded memory snippet for prompts (same formatter as V3 daily; facts context). */
export function buildCoachingMemorySnippetForDailyLane(m: V2CoachingMemoryForPrompt | null): string {
  return formatCoachingMemoryPromptBlock(m).slice(0, 1400);
}
