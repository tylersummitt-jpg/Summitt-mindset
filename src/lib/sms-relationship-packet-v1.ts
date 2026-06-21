/**
 * Relationship Packet v1.8 — ordered, budgeted OpenAI context with 72h thread + 7d + 30d memory.
 * Server-owned packing only; no DB writes, no hard-coded SMS.
 */

import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { DailyProofCalibration } from "@/lib/sms-daily-proof-calibration";
import type { DailyFreshMoveFacts } from "@/lib/sms-daily-fresh-move";
import type { DailyCoachGoalEvolutionInviteFacts } from "@/lib/sms-coach-initiated-goal-evolution-invite";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";
import {
  buildStaleAskAvoidanceSummary,
  type OpenLoopsAndDoNotRepeatData,
} from "@/lib/sms-open-loops-and-do-not-repeat";
import {
  applyMemory7dTemporalLabels,
} from "@/lib/sms-relationship-memory-7d";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import {
  buildTemporalContractPromptGuidance,
  buildTemporalContractV1,
} from "@/lib/sms-temporal-contract-v1";
import { isTurnUnderstandingAuthoritative } from "@/lib/openai-relationship-turn-understanding-v1";
import type {
  InboundResolvedTruth,
  InboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import { RECENT_EXACT_THREAD_WINDOW_HOURS } from "@/lib/sms-recent-exact-thread-72h";
import {
  buildDailyTemporalAwarenessPromptGuidance,
  buildRecentThreadTimelineSummary72h,
  deriveDailyTemporalAwarenessSummary,
  deriveIsNewAccountabilityDayFromThread,
  weekdayFromAccountabilityDayKey,
  type DailyRecentThreadTimelineEntry,
  type DailyTemporalAwarenessSummary,
} from "@/lib/sms-daily-temporal-awareness";
import {
  buildRelationshipAndScheduleAnchors,
  buildRelationshipAnchorsPromptGuidance,
  relationshipAnchorAvoidRepeatingFingerprints,
  type RelationshipAnchor,
  type RelationshipAnchorSources,
  type RelationshipAnchorTelemetryCounts,
  type ScheduleAnchor,
} from "@/lib/sms-relationship-anchors";
import {
  countRelationshipMemory7dItems,
  DEFAULT_MEMORY_7D_SECTION_CHAR_BUDGET,
  RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
  trimRelationshipMemory7dData,
  type RelationshipMemory7dData,
} from "@/lib/sms-relationship-memory-7d";
import {
  countRelationshipMemory30dItems,
  DEFAULT_MEMORY_30D_SECTION_CHAR_BUDGET,
  RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
  trimRelationshipMemory30dData,
  type RelationshipMemory30dData,
} from "@/lib/sms-relationship-memory-30d";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  activePendingStateForLaneFacts,
  buildRelationshipSnapshotV2,
  buildRelationshipSnapshotV2PromptGuidance,
  combinedUserPromptFromPacketAndSnapshot,
  type RelationshipSnapshotV2,
  type RelationshipSnapshotV2Meta,
} from "@/lib/sms-relationship-snapshot-v2";

export const RELATIONSHIP_PACKET_VERSION = "1.8" as const;
export const DEFAULT_RELATIONSHIP_PACKET_BUDGET = 13_200;

export type RelationshipPacketLane = "inbound" | "daily" | "weekly";

export type RelationshipPacketAuthority =
  | "authoritative_current"
  | "structured_recent_truth"
  | "authoritative_recent_thread"
  | "structured_background"
  | "background_summary"
  | "low_authority_hint";

export type RelationshipPacketSection<T> = {
  authority: RelationshipPacketAuthority;
  data: T;
};

export type RelationshipPacketCurrentTurn = {
  route_purpose?: string;
  route_kind?: string;
  current_user_inbound?: string | null;
  local_time_iso?: string | null;
  expected_reply_semantics?: string | null;
  daily_purpose?: string | null;
  server_strategy?: string | null;
  accountability_day_key?: string | null;
  gated_mode?: string | null;
  deterministic_classifier_event?: string | null;
  should_write_outcome_event?: boolean;
  split_message_sids?: string[];
  week_start?: string | null;
  week_end?: string | null;
  timezone?: string | null;
  local_date?: string | null;
  local_weekday?: string | null;
  is_new_accountability_day?: boolean;
  planned_pause_week?: boolean;
  silent_week?: boolean;
  rough_week?: boolean;
  strong_week?: boolean;
  reason_for_send?: string | null;
  temporal_contract?: TemporalContractV1 | null;
  temporal_awareness_summary?: DailyTemporalAwarenessSummary | null;
  suggested_coaching_move?: string | null;
  adjustment_proposal_allowed_by_evidence?: boolean | null;
  single_miss_recovery_required?: boolean | null;
  adjustment_evidence_reason?: string | null;
  goal_adjustment_mention_allowed?: boolean | null;
};

export type RelationshipPacketTurnUnderstandingSection = {
  authority: "authoritative_current";
  relationship_meaning: string;
  response_intent: string;
  last_ask_satisfied: string;
  satisfaction_kind: string;
  do_not_repeat_asks: string[];
  stale_ask_risk: boolean;
  evidence_quotes: string[];
  confidence: number;
  persistence_note: string;
};

export type RelationshipPacketStructuredRecentTruth = {
  turn_understanding?: RelationshipPacketTurnUnderstandingSection | null;
  inbound_resolved_truth?: (InboundResolvedTruth & { authority: "authoritative_current" }) | null;
  daily_satisfied_ask_context?: {
    has_satisfied_recent_ask: boolean;
    satisfied_ask_type: string;
    do_not_repeat_asks: string[];
    evidence_preview: string | null;
    source: string;
    occurred_at: string | null;
    persistence_note: string;
  } | null;
  thread_freshness?: ThreadFreshnessFacts | null;
  latest_open_question?: string | null;
  latest_answer_after_open_question?: string | null;
  open_question_pending?: boolean | null;
  open_question_source?: string | null;
  answer_source?: string | null;
  projection_used?: boolean | null;
  last_5_coach_questions?: string[];
  last_5_user_answers?: string[];
  do_not_repeat_phrases?: string[];
  memory_correction?: {
    already_told_you?: boolean;
    short_ack?: boolean;
    prior_substantive_user_message?: string | null;
    most_recent_coach_question?: string | null;
  };
  route_constraints_summary?: {
    required_verbatim_count?: number;
    required_verbatim_present?: boolean;
    required_meaning_summary?: string | null;
    forbidden_substring_count?: number;
  };
  daily_proof_calibration?: DailyProofCalibration | null;
  daily_fresh_move?: Pick<
    DailyFreshMoveFacts,
    "recent_cta_do_not_repeat" | "recent_advice_do_not_repeat" | "fresh_move_required"
  > | null;
  summary_authority_note?: {
    summary_authority: "background_only";
    exact_thread_and_calibration_win: true;
  };
  weekly_week_summary?: {
    completed_count?: number;
    missed_count?: number;
    partial_count?: number;
    blocker_count?: number;
    proof_moment_hints?: string[];
    win_hints?: string[];
    comeback_hints?: string[];
    repeated_blocker_hints?: string[];
    notable_pattern?: string | null;
  };
  stale_ask_avoidance_summary?: {
    satisfied_ask_labels: string[];
    do_not_reask_labels: string[];
    recent_coach_question_labels: string[];
    has_satisfied_recent_ask: boolean;
  } | null;
  recent_thread_timeline_summary_72h?: DailyRecentThreadTimelineEntry[] | null;
  recent_coach_body_do_not_repeat?: Array<{
    body_preview: string;
    at_local: string | null;
  }> | null;
  /** Slice 3A — coach-initiated goal evolution invite (invitation only; no pending/mutation). */
  coach_goal_evolution_invite?: DailyCoachGoalEvolutionInviteFacts | null;
};

export type RelationshipPacketRecentExactThread72h = {
  window_hours: typeof RECENT_EXACT_THREAD_WINDOW_HOURS;
  messages: RecentExactThread72hMessage[];
  message_count: number;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  legacy_fallback_lines?: string[];
  legacy_fallback_source?:
    | "recent_exact_thread_text"
    | "recent_transcript_or_context_block"
    | "recent_transcript_lines";
};

/** @deprecated v1.5 legacy line format — fallback only */
export type RelationshipPacketRecentExactThread = {
  lines: string[];
  line_count: number;
  source: "recent_exact_thread_text" | "recent_transcript_or_context_block" | "recent_transcript_lines";
  had_preview_lines?: boolean;
};

export type RelationshipPacketCanonicalState = {
  commitment_id?: string | null;
  title?: string | null;
  behavior_statement?: string | null;
  effective_ask?: string | null;
  accountability_phase?: string | null;
  identity_anchor?: string | null;
  identity_anchor_allowed?: boolean;
  active_season_label?: string | null;
  overlay_active?: boolean | null;
  contract_proposal_mode?: boolean | null;
  pending_resolution_active?: boolean | null;
  planned_interruption_active?: boolean | null;
  constraints?: {
    max_chars?: number;
    required_verbatim_substrings?: string[];
    required_meaning_summary?: string | null;
    forbidden_substrings?: string[];
    wrapper_must_not_repeat_substrings?: string[];
    weekly_anti_shame?: {
      planned_pause_week?: boolean;
      silent_week?: boolean;
      rough_week?: boolean;
      anti_shame_required?: boolean;
    };
  };
};

export type RelationshipPacketProofVictoryPermission = {
  proof_signal?: boolean | null;
  miss_signal?: boolean | null;
  blocker_signal?: boolean | null;
  today_completed?: boolean | null;
  proof_callout_hint?: Record<string, unknown> | null;
  accountability_proof_hint?: string | null;
  proof_or_milestone_signal?: string | null;
  can_reference_victory_room?: boolean | null;
  can_say_saved_as_proof?: boolean | null;
  proof_saved?: boolean | null;
};

export type RelationshipPacketMemory7d = RelationshipMemory7dData;

export type RelationshipPacketMemory30dOrSeason = RelationshipMemory30dData;

export type RelationshipPacketLowerAuthorityBackground = {
  relationship_profile_summary?: string | null;
  legacy_suggestions_summary?: string | null;
  coaching_memory_snippet?: string | null;
  recent_transcript_or_context_block?: string | null;
  summary_authority?: "background_only";
  exact_thread_and_calibration_win?: boolean;
};

export type RelationshipPacketRelationshipAnchorsData = {
  anchors: RelationshipAnchor[];
};

export type RelationshipPacketScheduleAnchorsData = {
  anchors: ScheduleAnchor[];
};

export type RelationshipPacketV1 = {
  relationship_packet_version: typeof RELATIONSHIP_PACKET_VERSION;
  current_turn: RelationshipPacketSection<RelationshipPacketCurrentTurn>;
  structured_recent_truth: RelationshipPacketSection<RelationshipPacketStructuredRecentTruth>;
  recent_exact_thread_72h: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null;
  canonical_state: RelationshipPacketSection<RelationshipPacketCanonicalState>;
  proof_victory_permission: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null;
  relationship_anchors?: RelationshipPacketSection<RelationshipPacketRelationshipAnchorsData>;
  schedule_anchors?: RelationshipPacketSection<RelationshipPacketScheduleAnchorsData>;
  relationship_memory_7d?: RelationshipPacketSection<RelationshipPacketMemory7d>;
  relationship_memory_30d_or_season?: RelationshipPacketSection<RelationshipPacketMemory30dOrSeason>;
  lower_authority_background?: RelationshipPacketSection<RelationshipPacketLowerAuthorityBackground>;
};

export type RelationshipPacketMeta = {
  relationship_packet_version: typeof RELATIONSHIP_PACKET_VERSION;
  relationship_packet_truncated: boolean;
  truncated_sections: string[];
  included_thread_message_count: number | null;
  included_thread_window_hours: number | null;
  included_thread_oldest_at: string | null;
  included_thread_newest_at: string | null;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  included_memory_7d_window_days: number | null;
  included_memory_7d_item_count: number | null;
  relationship_memory_7d_truncated: boolean;
  included_memory_30d_window_days: number | null;
  included_memory_30d_item_count: number | null;
  relationship_memory_30d_truncated: boolean;
  total_chars: number;
  budget_chars: number;
  relationship_anchor_available_count?: number;
  schedule_anchor_available_count?: number;
  relationship_anchor_recently_used_count?: number;
  relationship_anchor_source_onboarding_count?: number;
  relationship_anchor_source_sms_confirmed_count?: number;
  strategy_card_relationship_anchor_boundary_present?: boolean;
  stale_ask_avoidance_has_satisfied_recent_ask?: boolean;
  stale_ask_avoidance_satisfied_label_count?: number;
  stale_ask_avoidance_do_not_reask_label_count?: number;
  stale_ask_avoidance_recent_question_label_count?: number;
};

export type BuildRelationshipPacketResult = {
  packet: RelationshipPacketV1;
  userPromptJson: string;
  meta: RelationshipPacketMeta;
  snapshotV2: RelationshipSnapshotV2;
  snapshotV2Meta: RelationshipSnapshotV2Meta;
};

export function buildRelationshipPacketPromptGuidance(): string {
  return `
RELATIONSHIP_PACKET_AUTHORITY (read relationship_packet_v1 sections — beats stale summaries):
- authoritative_current and structured_recent_truth beat background_summary and low_authority_hint on conflict.
- authoritative_recent_thread (recent_exact_thread_72h) beats relationship_memory_7d and relationship_memory_30d_or_season on conflict.
- relationship_memory_7d beats relationship_memory_30d_or_season on conflict.
- relationship_memory_7d is structured_background for weekly continuity only — never proof of today's completion or current open question state.
- relationship_memory_30d_or_season is background_summary for season-arc context only — never proof of today's completion or current open question state.
- Never invent patterns beyond listed relationship_memory_7d or relationship_memory_30d_or_season evidence items.
- pat_read_snapshot entries are AI snapshots (is_ai_snapshot: true) and must lose to exact SMS thread and event-backed memory.
- background_summary and low_authority_hint must NEVER override recent exact thread or canonical_state.
- If structured_recent_truth.turn_understanding or daily_satisfied_ask_context is present, it is authoritative for whether the prior coach ask is satisfied — do not repeat do_not_repeat_asks.
- If structured_recent_truth.stale_ask_avoidance_summary is present, honor satisfied_ask_labels and do_not_reask_labels — do not paraphrase satisfied asks.
- If structured_recent_truth.thread_freshness lists completed_actions or do_not_reask_topics, do NOT re-ask those topics.
- If structured_recent_truth gives active_temporal_frame, respect it (do not shift to today/tomorrow without user movement).
- lower_authority_background and coaching summaries are tone/context only — not proof of what happened.
- structured_recent_truth.daily_proof_calibration is authoritative server truth for praise and proof recency — it beats coaching_memory_snippet and lower_authority_background on praise/consistency claims.
- If structured_recent_truth.summary_authority_note is present, summaries are background_only; exact thread + daily_proof_calibration win on conflict.
${buildRelationshipAnchorsPromptGuidance()}
${buildDailyC1HighRepeatRiskPacketGuidance()}
${buildTemporalContractPromptGuidance()}
${buildDailyTemporalAwarenessPromptGuidance()}
${buildRelationshipSnapshotV2PromptGuidance()}`;
}

/** Compact product law when stale/DNR context makes another question likely to repeat-block. */
export function buildDailyC1HighRepeatRiskPacketGuidance(): string {
  return `
DAILY_C1_HIGH_REPEAT_RISK (when stale_ask_avoidance_summary, daily_satisfied_ask_context, or avoid_repeating shows recent satisfied/repeated asks):
- Treat RELATIONSHIP_PACKET_V1 as the relationship notebook: read temporal awareness, recent thread timeline, current goal/standard, identity, stale/do-not-repeat context, and relationship anchors only if naturally useful before writing.
- Then write one fresh, human, no-question coaching touch: concrete action, protect plan, close loop, identity reminder, low-pressure reentry, or relational bridge into action — not another question or question-shaped command.
- Do not paraphrase satisfied asks, do_not_reask_labels, or recent_coach_question_labels into planning, outcome, blocker, evidence, or strategy phrasing.
- Do not use tell me, let me know, reply with, name the blocker, choose one, or send me as a substitute for a question mark.`;
}

function isWeeklyFacts(
  facts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts,
  lane: RelationshipPacketLane
): facts is WeeklyV3OutboundFacts {
  return lane === "weekly";
}

function isInboundFacts(
  facts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts,
  lane: RelationshipPacketLane
): facts is InboundV3RelationshipFacts {
  return lane === "inbound";
}

function isDailyFacts(
  facts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts,
  lane: RelationshipPacketLane
): facts is DailyV3RelationshipFacts {
  return lane === "daily";
}

function compactStrings(items: string[] | null | undefined, max: number): string[] {
  if (!items?.length) return [];
  return items.map((s) => s.trim()).filter(Boolean).slice(0, max);
}

function truncateText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function splitThreadLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function threadHasPreviewLine(lines: string[]): boolean {
  return lines.some((l) => /\[preview\]/i.test(l));
}

function buildCurrentTurnInbound(f: InboundV3RelationshipFacts): RelationshipPacketCurrentTurn {
  return {
    route_purpose: f.route_purpose,
    current_user_inbound: f.thread.coalesced_inbound_text || f.thread.latest_inbound_raw || null,
    local_time_iso: f.user.local_time_iso,
    expected_reply_semantics: f.thread.expected_reply_semantics,
    gated_mode: f.v2_accountability.gated_mode,
    deterministic_classifier_event: f.v2_accountability.deterministic_classifier_event,
    should_write_outcome_event: f.v2_accountability.should_write_outcome_event,
    split_message_sids:
      f.thread.suppressed_message_sids.length > 0 ? f.thread.suppressed_message_sids : undefined,
    timezone: f.user.timezone,
    temporal_contract: f.temporal_contract ?? null,
    suggested_coaching_move: f.suggested_coaching_move?.trim() || null,
    adjustment_proposal_allowed_by_evidence:
      f.miss_adjustment_policy?.adjustment_proposal_allowed_by_evidence ??
      f.v2_accountability.adjustment_proposal_allowed_by_evidence ??
      null,
    single_miss_recovery_required:
      f.miss_adjustment_policy?.single_miss_recovery_required ??
      f.v2_accountability.single_miss_recovery_required ??
      null,
    adjustment_evidence_reason:
      f.miss_adjustment_policy?.adjustment_evidence_reason ??
      f.v2_accountability.adjustment_evidence_reason ??
      null,
    goal_adjustment_mention_allowed: f.v2_accountability.goal_adjustment_mention_allowed ?? null,
  };
}

function deriveIsNewAccountabilityDayForPacket(f: DailyV3RelationshipFacts): boolean {
  return deriveIsNewAccountabilityDayFromThread({
    accountabilityDayKey: f.accountability_day_key,
    messages: f.thread_memory.recent_exact_thread_72h?.messages,
  });
}

function buildCurrentTurnDaily(f: DailyV3RelationshipFacts): RelationshipPacketCurrentTurn {
  const temporal_awareness_summary = deriveDailyTemporalAwarenessSummary({
    facts: f,
    isNewAccountabilityDay: deriveIsNewAccountabilityDayForPacket(f),
  });
  return {
    route_kind: f.route_kind,
    daily_purpose: f.accountability.daily_purpose,
    server_strategy: f.accountability.server_strategy,
    accountability_day_key: f.accountability_day_key,
    local_time_iso: f.user.local_time_iso,
    timezone: f.user.timezone,
    local_date: f.accountability_day_key,
    local_weekday: weekdayFromAccountabilityDayKey(f.accountability_day_key),
    is_new_accountability_day: temporal_awareness_summary.is_new_accountability_day,
    temporal_contract: f.temporal_contract ?? null,
    temporal_awareness_summary,
  };
}

function buildStaleAskAvoidanceSummaryFromDailyFacts(
  f: DailyV3RelationshipFacts
): ReturnType<typeof buildStaleAskAvoidanceSummary> {
  const tm = f.thread_memory;
  const sac = f.daily_satisfied_ask_context;
  const satisfiedAsks =
    sac?.has_satisfied_recent_ask === true
      ? (sac.do_not_repeat_asks ?? []).map((ask) => ({
          ask_text: ask.slice(0, 160),
          source: "daily_satisfied_ask_context" as const,
          do_not_repeat: true,
        }))
      : [];
  const data: OpenLoopsAndDoNotRepeatData = {
    open_loops: [],
    satisfied_asks: satisfiedAsks,
    do_not_repeat_asks: compactStrings(
      [...(sac?.do_not_repeat_asks ?? []), ...(tm.do_not_repeat_hints ?? [])],
      6
    ),
    do_not_repeat_phrases: [],
    recent_unanswered_coach_questions: compactStrings(tm.last_5_coach_questions, 2),
  };
  return buildStaleAskAvoidanceSummary(data);
}

/** Compact stale-ask counts for telemetry — no raw label text. */
export function staleAskAvoidanceTelemetryFromSummary(
  summary: ReturnType<typeof buildStaleAskAvoidanceSummary>
): Pick<
  RelationshipPacketMeta,
  | "stale_ask_avoidance_has_satisfied_recent_ask"
  | "stale_ask_avoidance_satisfied_label_count"
  | "stale_ask_avoidance_do_not_reask_label_count"
  | "stale_ask_avoidance_recent_question_label_count"
> {
  if (!summary) {
    return {
      stale_ask_avoidance_has_satisfied_recent_ask: false,
      stale_ask_avoidance_satisfied_label_count: 0,
      stale_ask_avoidance_do_not_reask_label_count: 0,
      stale_ask_avoidance_recent_question_label_count: 0,
    };
  }
  return {
    stale_ask_avoidance_has_satisfied_recent_ask: summary.has_satisfied_recent_ask,
    stale_ask_avoidance_satisfied_label_count: summary.satisfied_ask_labels.length,
    stale_ask_avoidance_do_not_reask_label_count: summary.do_not_reask_labels.length,
    stale_ask_avoidance_recent_question_label_count: summary.recent_coach_question_labels.length,
  };
}

function buildCurrentTurnWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketCurrentTurn {
  return {
    route_kind: "weekly",
    route_purpose: f.route.route_purpose,
    week_start: f.weekly_proof.week_start,
    week_end: f.weekly_proof.week_end,
    timezone: f.user.timezone,
    local_date: f.user.local_date,
    local_time_iso: `${f.user.local_date}T${f.user.local_time}:00`,
    temporal_contract:
      f.temporal_contract ??
      buildTemporalContractV1({
        timezone: f.user.timezone,
        now: new Date(`${f.user.local_date}T${f.user.local_time}:00`),
        sendDayKey: f.user.local_date,
      }),
    planned_pause_week: f.weekly_proof.planned_pause_week === true,
    silent_week: f.weekly_proof.silent_week,
    rough_week: f.weekly_proof.rough_week,
    strong_week: f.weekly_proof.strong_week,
    reason_for_send: f.route.reason_for_send,
  };
}

function buildStructuredTruthWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketStructuredRecentTruth {
  const t = f.thread;
  const wp = f.weekly_proof;
  return {
    thread_freshness: t.thread_freshness ?? null,
    latest_open_question: t.latest_open_question,
    latest_answer_after_open_question: t.latest_answer_after_open_question,
    open_question_pending: t.open_question_pending,
    open_question_source: t.open_question_source,
    answer_source: t.answer_source,
    projection_used: t.projection_used,
    last_5_coach_questions: compactStrings(t.last_5_coach_questions, 5),
    last_5_user_answers: compactStrings(t.last_5_user_answers, 5),
    do_not_repeat_phrases: compactStrings(t.do_not_repeat_hints, 8),
    weekly_week_summary: {
      completed_count: wp.completed_count,
      missed_count: wp.missed_count,
      partial_count: wp.partial_count,
      blocker_count: wp.blocker_count,
      proof_moment_hints: compactStrings(wp.proof_moment_hints, 4),
      win_hints: compactStrings(wp.win_hints, 4),
      comeback_hints: compactStrings(wp.comeback_hints, 4),
      repeated_blocker_hints: compactStrings(wp.repeated_blocker_hints, 4),
      notable_pattern: wp.notable_pattern,
    },
    route_constraints_summary: {
      required_verbatim_count: f.constraints?.required_verbatim_substrings?.length ?? 0,
      required_verbatim_present: Boolean(f.constraints?.required_verbatim_substrings?.length),
      forbidden_substring_count: 0,
    },
  };
}

function resolveRecentThread72hWeekly(
  f: WeeklyV3OutboundFacts
): RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null {
  const t72 = f.thread.recent_exact_thread_72h;
  if (t72?.messages?.length) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: t72.messages,
        message_count: t72.message_count,
        had_preview_messages: t72.had_preview_messages,
        had_system_no_send: t72.had_system_no_send,
      },
    };
  }
  const exact = f.thread.recent_exact_thread_text?.trim();
  if (exact) {
    const lines = splitThreadLines(exact);
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_exact_thread_text",
      },
    };
  }
  const lines = f.thread.recent_transcript_lines.filter(Boolean);
  if (lines.length) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_transcript_lines",
      },
    };
  }
  return null;
}

function buildCanonicalWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketCanonicalState {
  const wp = f.weekly_proof;
  return {
    commitment_id: f.commitment.active_commitment_id,
    behavior_statement: f.commitment.behavior_statement,
    effective_ask: f.commitment.effective_ask,
    accountability_phase: f.commitment.commitment_state,
    identity_anchor: f.commitment.identity_anchor ?? null,
    active_season_label: f.victory_background?.active_season_label ?? null,
    planned_interruption_active: f.commitment.planned_interruption_active,
    constraints: {
      max_chars: 320,
      required_verbatim_substrings: f.constraints?.required_verbatim_substrings,
      weekly_anti_shame: {
        planned_pause_week: wp.planned_pause_week === true,
        silent_week: wp.silent_week,
        rough_week: wp.rough_week,
        anti_shame_required: wp.planned_pause_week === true || wp.silent_week || wp.rough_week,
      },
    },
  };
}

function buildProofVictoryWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketProofVictoryPermission | null {
  const wp = f.weekly_proof;
  const hasAny =
    wp.proof_moment_hints.length > 0 ||
    wp.win_hints.length > 0 ||
    wp.comeback_hints.length > 0 ||
    f.victory_background != null;
  if (!hasAny) return null;
  return {
    proof_or_milestone_signal: wp.notable_pattern,
    can_reference_victory_room: f.victory_background != null ? true : null,
    can_say_saved_as_proof: false,
    proof_saved: false,
  };
}

function resolveMemory7dWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketMemory7d | null {
  const raw = f.thread.relationship_memory_7d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  return data;
}

function resolveMemory30dWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketMemory30dOrSeason | null {
  const raw = f.thread.relationship_memory_30d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  return data;
}

function buildLowerAuthorityWeekly(f: WeeklyV3OutboundFacts): RelationshipPacketLowerAuthorityBackground {
  return {
    relationship_profile_summary: f.user.sms_engagement_summary ?? null,
    coaching_memory_snippet: f.thread.coaching_memory_snippet
      ? truncateText(f.thread.coaching_memory_snippet, 600)
      : null,
  };
}

function buildStructuredTruthInbound(f: InboundV3RelationshipFacts): RelationshipPacketStructuredRecentTruth {
  const mp = f.thread.memory_packet;
  const reqVerb = f.constraints.required_verbatim_substrings ?? [];
  const tu = f.turn_understanding;
  const rt = f.inbound_resolved_truth;
  return {
    ...(rt
      ? {
          inbound_resolved_truth: {
            authority: "authoritative_current" as const,
            ...rt,
          },
        }
      : {}),
    ...(tu && isTurnUnderstandingAuthoritative(tu)
      ? {
          turn_understanding: {
            authority: "authoritative_current" as const,
            relationship_meaning: tu.reconciled_relationship_meaning,
            response_intent: tu.reconciled_response_intent,
            last_ask_satisfied: tu.last_ask_satisfied,
            satisfaction_kind: tu.satisfaction_kind,
            do_not_repeat_asks: tu.reconciled_do_not_repeat_asks,
            stale_ask_risk: tu.stale_ask_risk,
            evidence_quotes: tu.proposal?.evidence_quotes ?? [],
            confidence: tu.confidence,
            persistence_note: tu.persistence_note,
          },
        }
      : {}),
    thread_freshness: f.thread_freshness ?? null,
    latest_open_question: f.thread.latest_open_question ?? mp?.latest_open_question ?? null,
    latest_answer_after_open_question:
      f.thread.latest_answer_after_open_question ?? mp?.latest_answer_after_open_question ?? null,
    open_question_pending: mp?.open_question_pending ?? null,
    open_question_source: mp?.open_question_source ?? f.thread.memory_authority.open_question_source,
    answer_source: mp?.answer_source ?? f.thread.memory_authority.answer_source,
    projection_used: mp?.projection_used ?? f.thread.memory_authority.projection_used,
    last_5_coach_questions: compactStrings(mp?.last_5_coach_questions, 5),
    last_5_user_answers: compactStrings(mp?.last_5_user_answers, 5),
    do_not_repeat_phrases: compactStrings(mp?.do_not_repeat_phrases, 8),
    memory_correction: {
      already_told_you: f.thread.current_inbound_is_already_told_you_correction,
      short_ack: f.thread.short_ack_should_not_reask_question,
      prior_substantive_user_message: f.thread.most_recent_substantive_prior_user_message,
      most_recent_coach_question: f.thread.most_recent_coach_question,
    },
    route_constraints_summary: {
      required_verbatim_count: reqVerb.length,
      required_verbatim_present: reqVerb.length > 0,
      required_meaning_summary: f.constraints.required_meaning_summary ?? null,
      forbidden_substring_count: f.constraints.forbidden_substrings?.length ?? 0,
    },
  };
}

function turnUnderstandingFromDailySatisfiedAskContext(
  ctx: DailySatisfiedAskContext
): RelationshipPacketTurnUnderstandingSection {
  return {
    authority: "authoritative_current",
    relationship_meaning: ctx.relationship_meaning ?? "answer_to_prior_question",
    response_intent: ctx.response_intent ?? "acknowledge_prior_answer",
    last_ask_satisfied: ctx.last_ask_satisfied,
    satisfaction_kind:
      ctx.satisfied_ask_type === "plan_detail"
        ? "plan_detail_provided"
        : ctx.satisfied_ask_type === "plan_confirmation"
          ? "plan_confirmed"
          : ctx.satisfied_ask_type === "outcome_answer"
            ? "outcome_reported"
            : "prior_ask_satisfied",
    do_not_repeat_asks: compactStrings(ctx.do_not_repeat_asks, 6),
    stale_ask_risk: ctx.stale_ask_risk,
    evidence_quotes: ctx.evidence_preview ? [ctx.evidence_preview.slice(0, 160)] : [],
    confidence: ctx.source === "inbound_turn_telemetry" ? 0.88 : 0.72,
    persistence_note: ctx.persistence_note,
  };
}

function buildStructuredTruthDaily(f: DailyV3RelationshipFacts): RelationshipPacketStructuredRecentTruth {
  const tm = f.thread_memory;
  const reqVerb = f.constraints.required_verbatim_substrings ?? [];
  const sac = f.daily_satisfied_ask_context;
  const turnUnderstanding =
    sac?.has_satisfied_recent_ask === true ? turnUnderstandingFromDailySatisfiedAskContext(sac) : null;
  const staleAskAvoidanceSummary = buildStaleAskAvoidanceSummaryFromDailyFacts(f);
  const timeline = buildRecentThreadTimelineSummary72h({
    messages: tm.recent_exact_thread_72h?.messages,
    accountabilityDayKey: f.accountability_day_key,
  });
  return {
    ...(turnUnderstanding ? { turn_understanding: turnUnderstanding } : {}),
    ...(sac?.has_satisfied_recent_ask
      ? {
          daily_satisfied_ask_context: {
            has_satisfied_recent_ask: true,
            satisfied_ask_type: sac.satisfied_ask_type,
            do_not_repeat_asks: compactStrings(sac.do_not_repeat_asks, 6),
            evidence_preview: sac.evidence_preview,
            source: sac.source,
            occurred_at: sac.occurred_at,
            persistence_note: sac.persistence_note,
          },
        }
      : {}),
    ...(staleAskAvoidanceSummary ? { stale_ask_avoidance_summary: staleAskAvoidanceSummary } : {}),
    ...(timeline.length ? { recent_thread_timeline_summary_72h: timeline } : {}),
    ...(tm.recent_coach_body_do_not_repeat?.length
      ? {
          recent_coach_body_do_not_repeat: tm.recent_coach_body_do_not_repeat
            .slice(-3)
            .map((b) => ({
              body_preview: b.body_preview,
              at_local: b.at_local,
            })),
        }
      : {}),
    thread_freshness: f.thread_freshness ?? null,
    latest_open_question: tm.latest_open_question ?? null,
    latest_answer_after_open_question: tm.latest_answer_after_open_question ?? null,
    open_question_pending: tm.open_question_pending ?? null,
    open_question_source: tm.open_question_source ?? null,
    answer_source: tm.answer_source ?? null,
    projection_used: tm.projection_used ?? null,
    last_5_coach_questions: compactStrings(tm.last_5_coach_questions, 5),
    last_5_user_answers: compactStrings(tm.last_5_user_answers, 5),
    do_not_repeat_phrases: compactStrings(tm.do_not_repeat_hints, 8),
    route_constraints_summary: {
      required_verbatim_count: reqVerb.length,
      required_verbatim_present: reqVerb.length > 0,
      required_meaning_summary: null,
      forbidden_substring_count: 0,
    },
    ...(f.accountability.coach_goal_evolution_invite
      ? { coach_goal_evolution_invite: f.accountability.coach_goal_evolution_invite }
      : {}),
    ...(f.proof_calibration ? { daily_proof_calibration: f.proof_calibration } : {}),
    ...(f.fresh_move?.fresh_move_required
      ? {
          daily_fresh_move: {
            recent_cta_do_not_repeat: f.fresh_move.recent_cta_do_not_repeat,
            recent_advice_do_not_repeat: f.fresh_move.recent_advice_do_not_repeat,
            fresh_move_required: f.fresh_move.fresh_move_required,
          },
        }
      : {}),
    summary_authority_note: {
      summary_authority: "background_only",
      exact_thread_and_calibration_win: true,
    },
  };
}

function resolveRecentThread72hInbound(
  f: InboundV3RelationshipFacts
): RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null {
  const t72 = f.thread.memory_packet?.recent_exact_thread_72h;
  if (t72?.messages?.length) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: t72.messages,
        message_count: t72.message_count,
        had_preview_messages: t72.had_preview_messages,
        had_system_no_send: t72.had_system_no_send,
      },
    };
  }
  const mpText = f.thread.memory_packet?.recent_exact_thread_text?.trim();
  if (mpText) {
    const lines = splitThreadLines(mpText);
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_exact_thread_text",
      },
    };
  }
  const lines = f.thread.recent_transcript_lines.filter(Boolean);
  if (lines.length) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_transcript_lines",
      },
    };
  }
  return null;
}

function resolveRecentThread72hDaily(
  f: DailyV3RelationshipFacts
): RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null {
  const t72 = f.thread_memory.recent_exact_thread_72h;
  if (t72?.messages?.length) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: t72.messages,
        message_count: t72.message_count,
        had_preview_messages: t72.had_preview_messages,
        had_system_no_send: t72.had_system_no_send,
      },
    };
  }
  const exact = f.thread_memory.recent_exact_thread_text?.trim();
  if (exact) {
    const lines = splitThreadLines(exact);
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_exact_thread_text",
      },
    };
  }
  const block = f.thread_memory.recent_transcript_or_context_block?.trim();
  if (block) {
    const lines = splitThreadLines(block);
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: RECENT_EXACT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: threadHasPreviewLine(lines),
        had_system_no_send: false,
        legacy_fallback_lines: lines,
        legacy_fallback_source: "recent_transcript_or_context_block",
      },
    };
  }
  return null;
}

function buildCanonicalInbound(f: InboundV3RelationshipFacts): RelationshipPacketCanonicalState {
  return {
    commitment_id: f.commitment.id,
    title: f.commitment.title,
    behavior_statement: f.commitment.behavior_statement,
    effective_ask: f.commitment.effective_ask,
    accountability_phase: f.commitment.accountability_phase,
    identity_anchor: null,
    active_season_label: f.victory_background?.active_season_label ?? null,
    overlay_active: f.contract_consent_facts != null ? true : undefined,
    pending_resolution_active: f.pending_resolution_facts != null,
    planned_interruption_active: f.commitment.planned_interruption_active,
    constraints: {
      max_chars: f.constraints.max_chars,
      required_verbatim_substrings: f.constraints.required_verbatim_substrings,
      required_meaning_summary: f.constraints.required_meaning_summary ?? null,
      forbidden_substrings: f.constraints.forbidden_substrings?.slice(0, 12),
    },
  };
}

function buildCanonicalDaily(f: DailyV3RelationshipFacts): RelationshipPacketCanonicalState {
  return {
    commitment_id: f.commitment.id,
    title: f.commitment.title,
    behavior_statement: f.commitment.behavior_statement,
    effective_ask: f.commitment.effective_ask,
    accountability_phase: f.commitment.accountability_phase,
    identity_anchor: f.commitment.identity_anchor_short,
    identity_anchor_allowed: f.commitment.identity_anchor_allowed,
    active_season_label: f.victory_background?.active_season_label ?? null,
    overlay_active: f.accountability.overlay_active,
    contract_proposal_mode: f.accountability.contract_proposal_mode,
    pending_resolution_active: f.pending_resolution != null,
    planned_interruption_active: f.accountability.planned_interruption_active,
    constraints: {
      max_chars: f.constraints.max_chars,
      required_verbatim_substrings: f.constraints.required_verbatim_substrings,
      wrapper_must_not_repeat_substrings: f.constraints.wrapper_must_not_repeat_substrings,
    },
  };
}

function buildProofVictoryInbound(f: InboundV3RelationshipFacts): RelationshipPacketProofVictoryPermission | null {
  const hint = f.v2_accountability.proof_callout_hint;
  const hasAny =
    f.v2_accountability.proof_signal ||
    f.v2_accountability.miss_signal ||
    f.v2_accountability.blocker_signal ||
    hint != null ||
    f.legacy_suggestions.accountability_proof_hint ||
    f.victory_background != null;
  if (!hasAny) return null;
  return {
    proof_signal: f.v2_accountability.proof_signal,
    miss_signal: f.v2_accountability.miss_signal,
    blocker_signal: f.v2_accountability.blocker_signal,
    today_completed: f.v2_accountability.today_completed,
    proof_callout_hint: hint ? { ...hint } : null,
    accountability_proof_hint: f.legacy_suggestions.accountability_proof_hint,
    can_reference_victory_room: hint?.eligible === true ? true : hint ? false : null,
    can_say_saved_as_proof: hint?.proof_callout_claim_saved_allowed === true ? true : false,
    proof_saved: false,
  };
}

function buildProofVictoryDaily(f: DailyV3RelationshipFacts): RelationshipPacketProofVictoryPermission | null {
  const hasAny =
    Boolean(f.accountability.proof_or_milestone_signal) || f.victory_background != null;
  if (!hasAny) return null;
  return {
    proof_or_milestone_signal: f.accountability.proof_or_milestone_signal,
    can_reference_victory_room: f.victory_background != null ? true : null,
    can_say_saved_as_proof: false,
    proof_saved: false,
  };
}

function resolveMemory7dInbound(f: InboundV3RelationshipFacts): RelationshipPacketMemory7d | null {
  const raw = f.thread.memory_packet?.relationship_memory_7d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  return data;
}

function resolveMemory7dDaily(f: DailyV3RelationshipFacts): RelationshipPacketMemory7d | null {
  const raw = f.thread_memory.relationship_memory_7d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  let merged = {
    ...data,
    context_flags: {
      ...data.context_flags,
      pending_plan_proof_active: f.accountability.pending_plan_proof?.active ?? false,
      reentry_active: f.accountability.reentry_active,
      silence_tier: f.accountability.silence_tier,
      unanswered_checks: f.accountability.unanswered_checks,
      days_since_last_user_outcome: f.accountability.days_since_last_user_outcome,
    },
  };
  if (f.temporal_contract) {
    merged = applyMemory7dTemporalLabels(merged, f.temporal_contract) as typeof merged;
  }
  return merged;
}

function resolveMemory30dInbound(f: InboundV3RelationshipFacts): RelationshipPacketMemory30dOrSeason | null {
  const raw = f.thread.memory_packet?.relationship_memory_30d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  return {
    ...data,
    runtime_hints: {
      pattern_internal_hint: f.v2_accountability.pattern_internal_hint ?? null,
      goal_adjustment_internal_hint: f.v2_accountability.goal_adjustment_internal_hint ?? null,
    },
  };
}

function resolveMemory30dDaily(f: DailyV3RelationshipFacts): RelationshipPacketMemory30dOrSeason | null {
  const raw = f.thread_memory.relationship_memory_30d;
  if (!raw) return null;
  const { meta: _meta, ...data } = raw;
  void _meta;
  return {
    ...data,
    runtime_hints: {
      goal_adjustment_internal_hint: f.accountability.goal_adjustment_internal_hint ?? null,
      evolution_pattern_hint: f.accountability.evolution_pattern_hint ?? null,
    },
  };
}

function buildLowerAuthorityInbound(f: InboundV3RelationshipFacts): RelationshipPacketLowerAuthorityBackground {
  const conversationBrain = f.legacy_suggestions.conversation_brain ?? null;
  return {
    relationship_profile_summary: f.user.relationship_profile_summary,
    legacy_suggestions_summary: truncateText(
      JSON.stringify({
        conversation_brain_enabled: conversationBrain?.enabled ?? false,
        forced_future_stretch: f.legacy_suggestions.forced_future_stretch_intent_active,
      }),
      320
    ),
  };
}

function buildLowerAuthorityDaily(f: DailyV3RelationshipFacts): RelationshipPacketLowerAuthorityBackground {
  return {
    summary_authority: "background_only",
    exact_thread_and_calibration_win: true,
    relationship_profile_summary: f.user.relationship_profile_summary,
    coaching_memory_snippet:
      f.thread_memory.coaching_memory_snippet?.trim() &&
      !f.thread_memory.coaching_memory_snippet.includes("COACHING_MEMORY (background only")
        ? truncateText(f.thread_memory.coaching_memory_snippet, 600)
        : null,
    recent_transcript_or_context_block: f.thread_memory.recent_transcript_or_context_block
      ? truncateText(f.thread_memory.recent_transcript_or_context_block, 400)
      : null,
  };
}

type MutablePacketBuild = {
  current_turn: RelationshipPacketSection<RelationshipPacketCurrentTurn>;
  structured_recent_truth: RelationshipPacketSection<RelationshipPacketStructuredRecentTruth>;
  recent_exact_thread_72h: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null;
  canonical_state: RelationshipPacketSection<RelationshipPacketCanonicalState>;
  proof_victory_permission: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null;
  relationship_anchors?: RelationshipPacketSection<RelationshipPacketRelationshipAnchorsData>;
  schedule_anchors?: RelationshipPacketSection<RelationshipPacketScheduleAnchorsData>;
  relationship_memory_7d?: RelationshipPacketSection<RelationshipPacketMemory7d>;
  relationship_memory_30d_or_season?: RelationshipPacketSection<RelationshipPacketMemory30dOrSeason>;
  lower_authority_background?: RelationshipPacketSection<RelationshipPacketLowerAuthorityBackground>;
};

function coachThreadBodiesFrom72h(
  thread: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null | undefined
): string[] {
  if (!thread?.data.messages?.length) return [];
  return thread.data.messages
    .filter((m) => m.role === "coach")
    .map((m) => m.body)
    .filter(Boolean);
}

function resolveAnchorsForLaneFacts(args: {
  lane: RelationshipPacketLane;
  facts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts;
  thread72h: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null;
}): {
  built: ReturnType<typeof buildRelationshipAndScheduleAnchors>;
  extraAvoidRepeating: string[];
} {
  const facts = args.facts;
  if (!("relationship_anchor_sources" in facts)) {
    return {
      built: buildRelationshipAndScheduleAnchors({
        sources: null,
        timezone: facts.user.timezone,
        timingAnchorMemory: null,
        threadFreshness: "thread_freshness" in facts ? facts.thread_freshness : null,
      }),
      extraAvoidRepeating: [],
    };
  }

  const inboundOrDaily = facts as InboundV3RelationshipFacts | DailyV3RelationshipFacts;
  const coachQuestions =
    "thread_memory" in inboundOrDaily
      ? (inboundOrDaily.thread_memory.last_5_coach_questions ?? []).map((q) =>
          typeof q === "string" ? q : ""
        )
      : [];
  const coachThreadBodies = coachThreadBodiesFrom72h(args.thread72h);

  const built = buildRelationshipAndScheduleAnchors({
    sources: inboundOrDaily.relationship_anchor_sources ?? null,
    timezone: inboundOrDaily.user.timezone,
    timingAnchorMemory:
      args.lane === "daily" && "accountability" in inboundOrDaily
        ? inboundOrDaily.accountability.timing_anchor_memory ?? null
        : null,
    threadFreshness: inboundOrDaily.thread_freshness ?? null,
    lastCoachMessages: coachQuestions,
    recentCoachThreadBodies: coachThreadBodies,
  });

  return {
    built,
    extraAvoidRepeating: relationshipAnchorAvoidRepeatingFingerprints(
      built.relationship_anchor_recently_used_keys
    ),
  };
}

function serializePacket(build: MutablePacketBuild): RelationshipPacketV1 {
  const packet: RelationshipPacketV1 = {
    relationship_packet_version: RELATIONSHIP_PACKET_VERSION,
    current_turn: build.current_turn,
    structured_recent_truth: build.structured_recent_truth,
    recent_exact_thread_72h: build.recent_exact_thread_72h,
    canonical_state: build.canonical_state,
    proof_victory_permission: build.proof_victory_permission,
  };
  if (build.relationship_anchors) packet.relationship_anchors = build.relationship_anchors;
  if (build.schedule_anchors) packet.schedule_anchors = build.schedule_anchors;
  if (build.relationship_memory_7d) packet.relationship_memory_7d = build.relationship_memory_7d;
  if (build.relationship_memory_30d_or_season) {
    packet.relationship_memory_30d_or_season = build.relationship_memory_30d_or_season;
  }
  if (build.lower_authority_background) packet.lower_authority_background = build.lower_authority_background;
  return packet;
}

function userPromptFromPacket(packet: RelationshipPacketV1): string {
  return `RELATIONSHIP_PACKET_V1 (facts only; not copyable prose):
${JSON.stringify(packet)}

Write JSON only.`;
}

function measureCombinedPrompt(packet: RelationshipPacketV1, snapshot: RelationshipSnapshotV2): number {
  return combinedUserPromptFromPacketAndSnapshot(packet, snapshot).length;
}

function trimLowerAuthority(
  section: RelationshipPacketSection<RelationshipPacketLowerAuthorityBackground> | undefined,
  maxChars: number
): RelationshipPacketSection<RelationshipPacketLowerAuthorityBackground> | undefined {
  if (!section) return undefined;
  const data = { ...section.data };
  if (data.coaching_memory_snippet) data.coaching_memory_snippet = truncateText(data.coaching_memory_snippet, maxChars);
  if (data.recent_transcript_or_context_block) {
    data.recent_transcript_or_context_block = truncateText(data.recent_transcript_or_context_block, maxChars);
  }
  if (data.relationship_profile_summary) {
    data.relationship_profile_summary = truncateText(data.relationship_profile_summary, maxChars);
  }
  if (data.legacy_suggestions_summary) {
    data.legacy_suggestions_summary = truncateText(data.legacy_suggestions_summary, maxChars);
  }
  return { authority: section.authority, data };
}

function trimMemory30d(
  section: RelationshipPacketSection<RelationshipPacketMemory30dOrSeason> | undefined,
  maxChars: number
): { section: RelationshipPacketSection<RelationshipPacketMemory30dOrSeason> | undefined; truncated: boolean } {
  if (!section) return { section: undefined, truncated: false };
  const { data, truncated } = trimRelationshipMemory30dData(section.data, maxChars);
  return {
    section: { authority: section.authority, data },
    truncated,
  };
}

function trimMemory7d(
  section: RelationshipPacketSection<RelationshipPacketMemory7d> | undefined,
  maxChars: number
): { section: RelationshipPacketSection<RelationshipPacketMemory7d> | undefined; truncated: boolean } {
  if (!section) return { section: undefined, truncated: false };
  const { data, truncated } = trimRelationshipMemory7dData(section.data, maxChars);
  return {
    section: { authority: section.authority, data },
    truncated,
  };
}

function dropOldestThreadMessage(
  thread: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null
): RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null {
  if (!thread || thread.data.messages.length <= 1) return thread;
  const messages = thread.data.messages.slice(1);
  return {
    authority: thread.authority,
    data: {
      ...thread.data,
      messages,
      message_count: messages.length,
    },
  };
}

function truncateOldestThreadMessageBodies(
  thread: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null,
  maxBodyChars: number
): RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null {
  if (!thread || !thread.data.messages.length) return thread;
  const messages = thread.data.messages.map((m, i) => {
    if (i > 0 || m.body.length <= maxBodyChars) return m;
    return {
      ...m,
      body: `${m.body.slice(0, maxBodyChars - 1)}…`,
      body_truncated: true,
    };
  });
  return {
    authority: thread.authority,
    data: { ...thread.data, messages },
  };
}

export function buildRelationshipPacketForOpenAI(args: {
  lane: RelationshipPacketLane;
  sourceFacts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts;
  totalCharBudget?: number;
  commitmentRow?: ActiveV2CommitmentRow | null;
}): BuildRelationshipPacketResult {
  const budget = args.totalCharBudget ?? DEFAULT_RELATIONSHIP_PACKET_BUDGET;
  const truncatedSections: string[] = [];
  let memory7dTruncated = false;
  let memory30dTruncated = false;

  let build: MutablePacketBuild;

  if (isInboundFacts(args.sourceFacts, args.lane)) {
    const f = args.sourceFacts;
    build = {
      current_turn: { authority: "authoritative_current", data: buildCurrentTurnInbound(f) },
      structured_recent_truth: {
        authority: "structured_recent_truth",
        data: buildStructuredTruthInbound(f),
      },
      recent_exact_thread_72h: resolveRecentThread72hInbound(f),
      canonical_state: { authority: "authoritative_current", data: buildCanonicalInbound(f) },
      proof_victory_permission: (() => {
        const p = buildProofVictoryInbound(f);
        return p ? { authority: "authoritative_current", data: p } : null;
      })(),
      relationship_memory_7d: (() => {
        const data = resolveMemory7dInbound(f);
        return data
          ? { authority: "structured_background" as const, data }
          : undefined;
      })(),
      relationship_memory_30d_or_season: (() => {
        const data = resolveMemory30dInbound(f);
        return data
          ? { authority: "background_summary" as const, data }
          : undefined;
      })(),
      lower_authority_background: {
        authority: "low_authority_hint",
        data: buildLowerAuthorityInbound(f),
      },
    };
  } else if (isDailyFacts(args.sourceFacts, args.lane)) {
    const f = args.sourceFacts;
    build = {
      current_turn: { authority: "authoritative_current", data: buildCurrentTurnDaily(f) },
      structured_recent_truth: {
        authority: "structured_recent_truth",
        data: buildStructuredTruthDaily(f),
      },
      recent_exact_thread_72h: resolveRecentThread72hDaily(f),
      canonical_state: { authority: "authoritative_current", data: buildCanonicalDaily(f) },
      proof_victory_permission: (() => {
        const p = buildProofVictoryDaily(f);
        return p ? { authority: "authoritative_current", data: p } : null;
      })(),
      relationship_memory_7d: (() => {
        const data = resolveMemory7dDaily(f);
        return data
          ? { authority: "structured_background" as const, data }
          : undefined;
      })(),
      relationship_memory_30d_or_season: (() => {
        const data = resolveMemory30dDaily(f);
        return data
          ? { authority: "background_summary" as const, data }
          : undefined;
      })(),
      lower_authority_background: {
        authority: "low_authority_hint",
        data: buildLowerAuthorityDaily(f),
      },
    };
  } else {
    const f = args.sourceFacts;
    build = {
      current_turn: { authority: "authoritative_current", data: buildCurrentTurnWeekly(f) },
      structured_recent_truth: {
        authority: "structured_recent_truth",
        data: buildStructuredTruthWeekly(f),
      },
      recent_exact_thread_72h: resolveRecentThread72hWeekly(f),
      canonical_state: { authority: "authoritative_current", data: buildCanonicalWeekly(f) },
      proof_victory_permission: (() => {
        const p = buildProofVictoryWeekly(f);
        return p ? { authority: "authoritative_current", data: p } : null;
      })(),
      relationship_memory_7d: (() => {
        const data = resolveMemory7dWeekly(f);
        return data ? { authority: "structured_background" as const, data } : undefined;
      })(),
      relationship_memory_30d_or_season: (() => {
        const data = resolveMemory30dWeekly(f);
        return data ? { authority: "background_summary" as const, data } : undefined;
      })(),
      lower_authority_background: {
        authority: "low_authority_hint",
        data: buildLowerAuthorityWeekly(f),
      },
    };
  }

  let anchorAvoidRepeating: string[] = [];
  let anchorTelemetry: RelationshipAnchorTelemetryCounts | null = null;
  if (args.lane !== "weekly") {
    const resolved = resolveAnchorsForLaneFacts({
      lane: args.lane,
      facts: args.sourceFacts,
      thread72h: build.recent_exact_thread_72h,
    });
    anchorAvoidRepeating = resolved.extraAvoidRepeating;
    anchorTelemetry = resolved.built.telemetry;
    if (resolved.built.relationship_anchors.length > 0) {
      build.relationship_anchors = {
        authority: "structured_background",
        data: { anchors: resolved.built.relationship_anchors },
      };
    }
    if (resolved.built.schedule_anchors.length > 0) {
      build.schedule_anchors = {
        authority: "structured_background",
        data: { anchors: resolved.built.schedule_anchors },
      };
    }
  }

  const pendingBuilt = activePendingStateForLaneFacts({
    lane: args.lane,
    sourceFacts: args.sourceFacts,
    commitmentRow: args.commitmentRow,
  });
  const activePendingState = pendingBuilt.state;
  const activePendingMeta = pendingBuilt.meta;

  const rebuildSnapshot = (truncated: boolean) =>
    buildRelationshipSnapshotV2({
      packet,
      activePendingState,
      activePendingMeta,
      surface: args.lane,
      lane: args.lane,
      truncated,
      relationshipAnchorAvoidRepeating: anchorAvoidRepeating,
      // Packet already carries proof_victory_permission when present; keep snapshot proof compact.
      proofPermissionCompact: true,
    });

  let packet = serializePacket(build);
  let snapshotBuilt = rebuildSnapshot(false);
  let size = measureCombinedPrompt(packet, snapshotBuilt.snapshot);

  const recordTrunc = (section: string) => {
    if (!truncatedSections.includes(section)) truncatedSections.push(section);
  };

  while (size > budget) {
    const prevSize = size;

    if (build.lower_authority_background) {
      build.lower_authority_background = trimLowerAuthority(build.lower_authority_background, 200);
      recordTrunc("lower_authority_background");
      packet = serializePacket(build);
      snapshotBuilt = rebuildSnapshot(truncatedSections.length > 0);
      size = measureCombinedPrompt(packet, snapshotBuilt.snapshot);
      if (size > budget) {
        delete build.lower_authority_background;
      }
    } else if (build.relationship_memory_30d_or_season) {
      const trimmed = trimMemory30d(
        build.relationship_memory_30d_or_season,
        DEFAULT_MEMORY_30D_SECTION_CHAR_BUDGET
      );
      if (trimmed.section) {
        build.relationship_memory_30d_or_season = trimmed.section;
        if (trimmed.truncated) {
          memory30dTruncated = true;
          recordTrunc("relationship_memory_30d_or_season");
        }
      }
      packet = serializePacket(build);
      snapshotBuilt = rebuildSnapshot(truncatedSections.length > 0);
      size = measureCombinedPrompt(packet, snapshotBuilt.snapshot);
      if (size > budget) {
        delete build.relationship_memory_30d_or_season;
        memory30dTruncated = true;
        recordTrunc("relationship_memory_30d_or_season");
      }
    } else if (build.relationship_memory_7d) {
      const trimmed = trimMemory7d(build.relationship_memory_7d, DEFAULT_MEMORY_7D_SECTION_CHAR_BUDGET);
      if (trimmed.section) {
        build.relationship_memory_7d = trimmed.section;
        if (trimmed.truncated) {
          memory7dTruncated = true;
          recordTrunc("relationship_memory_7d");
        }
      }
      packet = serializePacket(build);
      snapshotBuilt = rebuildSnapshot(truncatedSections.length > 0);
      size = measureCombinedPrompt(packet, snapshotBuilt.snapshot);
      if (size > budget) {
        delete build.relationship_memory_7d;
        memory7dTruncated = true;
        recordTrunc("relationship_memory_7d");
      }
    } else if (build.recent_exact_thread_72h && build.recent_exact_thread_72h.data.messages.length > 2) {
      build.recent_exact_thread_72h = dropOldestThreadMessage(build.recent_exact_thread_72h);
      recordTrunc("recent_exact_thread_72h");
    } else if (build.recent_exact_thread_72h?.data.legacy_fallback_lines?.length) {
      const lines = build.recent_exact_thread_72h.data.legacy_fallback_lines;
      if (lines.length > 2) {
        build.recent_exact_thread_72h = {
          ...build.recent_exact_thread_72h,
          data: {
            ...build.recent_exact_thread_72h.data,
            legacy_fallback_lines: lines.slice(1),
          },
        };
        recordTrunc("recent_exact_thread_72h");
      }
    } else if (build.recent_exact_thread_72h?.data.messages.length) {
      const oldest = build.recent_exact_thread_72h.data.messages[0];
      const nextMax = Math.max(200, Math.floor((oldest?.body.length ?? 400) * 0.65));
      build.recent_exact_thread_72h = truncateOldestThreadMessageBodies(
        build.recent_exact_thread_72h,
        nextMax
      );
      recordTrunc("recent_exact_thread_72h");
    } else {
      break;
    }

    packet = serializePacket(build);
    snapshotBuilt = rebuildSnapshot(truncatedSections.length > 0);
    size = measureCombinedPrompt(packet, snapshotBuilt.snapshot);
    if (size >= prevSize) break;
  }

  snapshotBuilt = rebuildSnapshot(truncatedSections.length > 0 || size > budget);

  const userPromptJson = combinedUserPromptFromPacketAndSnapshot(packet, snapshotBuilt.snapshot);
  const threadSection = build.recent_exact_thread_72h?.data;
  const threadCount =
    threadSection?.message_count ??
    threadSection?.legacy_fallback_lines?.length ??
    null;

  const memory7dSection = build.relationship_memory_7d?.data;
  const memory30dSection = build.relationship_memory_30d_or_season?.data;

  const meta: RelationshipPacketMeta = {
    relationship_packet_version: RELATIONSHIP_PACKET_VERSION,
    relationship_packet_truncated: truncatedSections.length > 0 || size > budget,
    truncated_sections: truncatedSections,
    included_thread_message_count: threadCount,
    included_thread_window_hours: threadSection ? RECENT_EXACT_THREAD_WINDOW_HOURS : null,
    included_thread_oldest_at:
      threadSection?.messages[0]?.at ?? null,
    included_thread_newest_at:
      threadSection?.messages[threadSection.messages.length - 1]?.at ?? null,
    had_preview_messages: threadSection?.had_preview_messages ?? false,
    had_system_no_send: threadSection?.had_system_no_send ?? false,
    included_memory_7d_window_days: memory7dSection ? RELATIONSHIP_MEMORY_7D_WINDOW_DAYS : null,
    included_memory_7d_item_count: memory7dSection ? countRelationshipMemory7dItems(memory7dSection) : null,
    relationship_memory_7d_truncated: memory7dTruncated,
    included_memory_30d_window_days: memory30dSection ? RELATIONSHIP_MEMORY_30D_WINDOW_DAYS : null,
    included_memory_30d_item_count: memory30dSection
      ? countRelationshipMemory30dItems(memory30dSection)
      : null,
    relationship_memory_30d_truncated: memory30dTruncated,
    total_chars: userPromptJson.length,
    budget_chars: budget,
    ...(anchorTelemetry
      ? {
          relationship_anchor_available_count: anchorTelemetry.relationship_anchor_available_count,
          schedule_anchor_available_count: anchorTelemetry.schedule_anchor_available_count,
          relationship_anchor_recently_used_count: anchorTelemetry.relationship_anchor_recently_used_count,
          relationship_anchor_source_onboarding_count:
            anchorTelemetry.relationship_anchor_source_onboarding_count,
          relationship_anchor_source_sms_confirmed_count:
            anchorTelemetry.relationship_anchor_source_sms_confirmed_count,
          strategy_card_relationship_anchor_boundary_present:
            anchorTelemetry.strategy_card_relationship_anchor_boundary_present,
        }
      : {}),
    ...(args.lane === "daily" && isDailyFacts(args.sourceFacts, args.lane)
      ? staleAskAvoidanceTelemetryFromSummary(
          buildStaleAskAvoidanceSummaryFromDailyFacts(args.sourceFacts)
        )
      : {}),
  };

  return {
    packet,
    userPromptJson,
    meta,
    snapshotV2: snapshotBuilt.snapshot,
    snapshotV2Meta: snapshotBuilt.meta,
  };
}

export const RELATIONSHIP_PACKET_V1_USER_PROMPT_HEADER =
  "RELATIONSHIP_PACKET_V1 (facts only; not copyable prose):" as const;

const RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_HEADER =
  "RELATIONSHIP_SNAPSHOT_V2 (authority-labeled context; not copyable prose):" as const;

const RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_MARKER = `\n\n${RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_HEADER}`;

export type StripWriterStrategyHintsLane = "inbound" | "daily" | "weekly";

export type StripWriterStrategyHintsArgs = {
  lane: StripWriterStrategyHintsLane;
};

export type StripWriterStrategyHintsResult = {
  prompt: string;
  stripped_fields: string[];
};

/** Parse packet JSON embedded in combined lane user prompt (packet + snapshot appendix). */
export function parseRelationshipPacketFromUserPrompt(
  userPromptJson: string
): { packet: RelationshipPacketV1; header: string; tail: string } | null {
  const header = `${RELATIONSHIP_PACKET_V1_USER_PROMPT_HEADER}\n`;
  if (!userPromptJson.startsWith(header)) return null;
  const rest = userPromptJson.slice(header.length);
  const snapshotIdx = rest.indexOf(RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_MARKER);
  const packetJson =
    snapshotIdx >= 0 ? rest.slice(0, snapshotIdx) : rest.split("\n\nWrite JSON only.")[0] ?? rest;
  try {
    const packet = JSON.parse(packetJson) as RelationshipPacketV1;
    const tail = snapshotIdx >= 0 ? rest.slice(snapshotIdx) : rest.slice(packetJson.length);
    return { packet, header, tail };
  } catch {
    return null;
  }
}

function stripFieldsFromCurrentTurn(
  packet: RelationshipPacketV1,
  fieldNames: (keyof RelationshipPacketCurrentTurn)[]
): string[] {
  const stripped: string[] = [];
  const data = packet.current_turn?.data;
  if (!data) return stripped;
  for (const name of fieldNames) {
    if (data[name] !== undefined && data[name] !== null) {
      delete data[name];
      stripped.push(String(name));
    }
  }
  return stripped;
}

/**
 * Remove stale writer-facing move hints from the OpenAI user prompt when Strategy Card is active.
 * Does not mutate the in-memory packet used for telemetry — only the writer prompt string.
 */
export function stripCardSupersededWriterStrategyHintsFromUserPrompt(
  userPromptJson: string,
  args: StripWriterStrategyHintsArgs
): StripWriterStrategyHintsResult {
  const parsed = parseRelationshipPacketFromUserPrompt(userPromptJson);
  if (!parsed) {
    return { prompt: userPromptJson, stripped_fields: [] };
  }

  const fieldNames: (keyof RelationshipPacketCurrentTurn)[] = [];
  if (args.lane === "inbound") {
    fieldNames.push("suggested_coaching_move");
  } else if (args.lane === "daily") {
    fieldNames.push("server_strategy");
  }

  if (fieldNames.length === 0) {
    return { prompt: userPromptJson, stripped_fields: [] };
  }

  const stripped_fields = stripFieldsFromCurrentTurn(parsed.packet, fieldNames);

  let tail = parsed.tail;
  const snapshotHeader = `${RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_HEADER}\n`;
  if (tail.startsWith(RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_MARKER)) {
    const snapshotRest = tail.slice(RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_MARKER.length);
    const writeIdx = snapshotRest.indexOf("\n\nWrite JSON only.");
    const snapshotJson =
      writeIdx >= 0 ? snapshotRest.slice(0, writeIdx) : snapshotRest;
    const snapshotTail = writeIdx >= 0 ? snapshotRest.slice(writeIdx) : "";
    try {
      const snapshot = JSON.parse(snapshotJson) as {
        current_turn?: RelationshipPacketSection<RelationshipPacketCurrentTurn>;
      };
      if (snapshot.current_turn?.data) {
        for (const name of fieldNames) {
          if (
            snapshot.current_turn.data[name] !== undefined &&
            snapshot.current_turn.data[name] !== null &&
            !stripped_fields.includes(String(name))
          ) {
            stripped_fields.push(String(name));
          }
          delete snapshot.current_turn.data[name];
        }
      }
      tail =
        RELATIONSHIP_SNAPSHOT_V2_USER_PROMPT_MARKER +
        JSON.stringify(snapshot) +
        snapshotTail;
    } catch {
      // keep original tail if snapshot parse fails
    }
  }

  const uniqueStripped = [...new Set(stripped_fields)];
  if (uniqueStripped.length === 0) {
    return { prompt: userPromptJson, stripped_fields: [] };
  }

  const prompt = parsed.header + JSON.stringify(parsed.packet) + tail;
  return { prompt, stripped_fields: uniqueStripped };
}

/** Writer user prompt: optional packet hint strip + Strategy Card appendix. Telemetry packet unchanged. */
export function buildWriterUserPromptWithStrategyCard(args: {
  userPromptJson: string;
  strategyCardAppendix: string;
  stripWhenCardActive?: StripWriterStrategyHintsArgs;
}): StripWriterStrategyHintsResult & { prompt: string } {
  let base = args.userPromptJson;
  let stripped_fields: string[] = [];
  if (args.stripWhenCardActive) {
    const stripped = stripCardSupersededWriterStrategyHintsFromUserPrompt(
      base,
      args.stripWhenCardActive
    );
    base = stripped.prompt;
    stripped_fields = stripped.stripped_fields;
  }
  const prompt =
    base + (args.strategyCardAppendix ? `\n\n${args.strategyCardAppendix}` : "");
  return { prompt, stripped_fields };
}

export function relationshipPacketMetaForLaneTelemetry(
  meta: RelationshipPacketMeta,
  snapshotMeta?: RelationshipSnapshotV2Meta
): Record<string, unknown> {
  return {
    relationship_packet_version: meta.relationship_packet_version,
    relationship_packet_truncated: meta.relationship_packet_truncated,
    truncated_sections: meta.truncated_sections,
    relationship_packet_total_chars: meta.total_chars,
    relationship_packet_budget_chars: meta.budget_chars,
    included_thread_message_count: meta.included_thread_message_count,
    included_thread_window_hours: meta.included_thread_window_hours,
    included_thread_oldest_at: meta.included_thread_oldest_at,
    included_thread_newest_at: meta.included_thread_newest_at,
    had_preview_messages: meta.had_preview_messages,
    had_system_no_send: meta.had_system_no_send,
    included_memory_7d_window_days: meta.included_memory_7d_window_days,
    included_memory_7d_item_count: meta.included_memory_7d_item_count,
    relationship_memory_7d_truncated: meta.relationship_memory_7d_truncated,
    included_memory_30d_window_days: meta.included_memory_30d_window_days,
    included_memory_30d_item_count: meta.included_memory_30d_item_count,
    relationship_memory_30d_truncated: meta.relationship_memory_30d_truncated,
    ...(meta.relationship_anchor_available_count != null
      ? {
          relationship_anchor_available_count: meta.relationship_anchor_available_count,
          schedule_anchor_available_count: meta.schedule_anchor_available_count,
          relationship_anchor_recently_used_count: meta.relationship_anchor_recently_used_count,
          relationship_anchor_source_onboarding_count: meta.relationship_anchor_source_onboarding_count,
          relationship_anchor_source_sms_confirmed_count:
            meta.relationship_anchor_source_sms_confirmed_count,
          strategy_card_relationship_anchor_boundary_present:
            meta.strategy_card_relationship_anchor_boundary_present,
        }
      : {}),
    ...(snapshotMeta
      ? {
          relationship_snapshot_version: snapshotMeta.relationship_snapshot_version,
          active_pending_state_item_count: snapshotMeta.active_pending_state_item_count,
          active_pending_state_source: snapshotMeta.active_pending_state_source,
          active_pending_state_has_commitment_row: snapshotMeta.active_pending_state_has_commitment_row,
          row_authoritative_pending_kinds: snapshotMeta.row_authoritative_pending_kinds,
          facts_fallback_pending_kinds: snapshotMeta.facts_fallback_pending_kinds,
          relationship_snapshot_truncated: snapshotMeta.relationship_snapshot_truncated,
          thread_fallback_used: snapshotMeta.thread_fallback_used,
          open_loop_count: snapshotMeta.open_loop_count,
          satisfied_ask_count: snapshotMeta.satisfied_ask_count,
          do_not_repeat_ask_count: snapshotMeta.do_not_repeat_ask_count,
          recent_unanswered_question_count: snapshotMeta.recent_unanswered_question_count,
          open_loops_sources: snapshotMeta.open_loops_sources,
          open_loops_truncated: snapshotMeta.open_loops_truncated,
          proof_permission_emitted: snapshotMeta.proof_permission_emitted,
          can_claim_completion: snapshotMeta.can_claim_completion,
          can_claim_miss: snapshotMeta.can_claim_miss,
          can_claim_partial: snapshotMeta.can_claim_partial,
          can_claim_proof: snapshotMeta.can_claim_proof,
          can_reference_victory_room: snapshotMeta.can_reference_victory_room,
          proof_evidence_count: snapshotMeta.proof_evidence_count,
          proof_permission_sources: snapshotMeta.proof_permission_sources,
          proof_permission_has_legacy_v1: snapshotMeta.proof_permission_has_legacy_v1,
          no_send_silence_history_emitted: snapshotMeta.no_send_silence_history_emitted,
          days_since_last_visible_coach_sms: snapshotMeta.days_since_last_visible_coach_sms,
          days_since_last_user_reply: snapshotMeta.days_since_last_user_reply,
          days_since_last_outcome: snapshotMeta.days_since_last_outcome,
          silence_tier: snapshotMeta.silence_tier,
          reentry_context: snapshotMeta.reentry_context,
          recent_questions_not_delivered_count: snapshotMeta.recent_questions_not_delivered_count,
          recent_questions_delivered_unanswered_count:
            snapshotMeta.recent_questions_delivered_unanswered_count,
          no_send_silence_history_truncated: snapshotMeta.no_send_silence_history_truncated,
        }
      : {}),
    ...(meta.stale_ask_avoidance_has_satisfied_recent_ask !== undefined
      ? {
          stale_ask_avoidance_has_satisfied_recent_ask:
            meta.stale_ask_avoidance_has_satisfied_recent_ask,
          stale_ask_avoidance_satisfied_label_count:
            meta.stale_ask_avoidance_satisfied_label_count ?? 0,
          stale_ask_avoidance_do_not_reask_label_count:
            meta.stale_ask_avoidance_do_not_reask_label_count ?? 0,
          stale_ask_avoidance_recent_question_label_count:
            meta.stale_ask_avoidance_recent_question_label_count ?? 0,
        }
      : {}),
  };
}

/** Keys copied from lane metadata into send/job observability blobs (SQL-friendly). */
const RELATIONSHIP_PACKET_OBSERVABILITY_KEYS = [
  "relationship_packet_version",
  "relationship_packet_truncated",
  "truncated_sections",
  "relationship_packet_total_chars",
  "relationship_packet_budget_chars",
  "included_thread_message_count",
  "included_thread_window_hours",
  "included_thread_oldest_at",
  "included_thread_newest_at",
  "had_preview_messages",
  "had_system_no_send",
  "included_memory_7d_window_days",
  "included_memory_7d_item_count",
  "relationship_memory_7d_truncated",
  "included_memory_30d_window_days",
  "included_memory_30d_item_count",
  "relationship_memory_30d_truncated",
  "relationship_snapshot_version",
  "active_pending_state_item_count",
  "active_pending_state_source",
  "active_pending_state_has_commitment_row",
  "row_authoritative_pending_kinds",
  "facts_fallback_pending_kinds",
  "relationship_snapshot_truncated",
  "thread_fallback_used",
  "open_loop_count",
  "satisfied_ask_count",
  "do_not_repeat_ask_count",
  "recent_unanswered_question_count",
  "open_loops_sources",
  "open_loops_truncated",
  "proof_permission_emitted",
  "can_claim_completion",
  "can_claim_miss",
  "can_claim_partial",
  "can_claim_proof",
  "can_reference_victory_room",
  "proof_evidence_count",
  "proof_permission_sources",
  "proof_permission_has_legacy_v1",
  "no_send_silence_history_emitted",
  "days_since_last_visible_coach_sms",
  "days_since_last_user_reply",
  "days_since_last_outcome",
  "silence_tier",
  "reentry_context",
  "recent_questions_not_delivered_count",
  "recent_questions_delivered_unanswered_count",
  "no_send_silence_history_truncated",
  "strategy_card_version",
  "strategy_card_surface",
  "strategy_card_route_kind",
  "strategy_card_move_type",
  "strategy_card_move_confidence",
  "strategy_card_validation_status",
  "strategy_card_validation_reasons",
  "strategy_card_legacy_suggested_coaching_move",
  "strategy_card_legacy_coaching_move_source",
  "strategy_card_legacy_hint_used",
  "strategy_card_legacy_hint_replaced",
  "strategy_card_tone_posture",
  "strategy_card_can_claim_proof",
  "strategy_card_can_reference_victory_room",
  "strategy_card_plan_ack_source",
  "strategy_card_open_question_answer_kind",
  "strategy_card_open_question_satisfied",
  "strategy_card_arc_tentative_outcome",
  "strategy_card_arc_context_age",
  "strategy_card_arc_clarification_reason",
  "strategy_card_central_turn_purpose",
  "strategy_card_central_pivot_blocked_outcome_scoring",
  "strategy_card_central_pivot_should_answer_without_scoring",
  "strategy_card_legacy_server_strategy",
  "strategy_card_legacy_next_move_type",
  "strategy_card_daily_purpose",
  "strategy_card_daily_reactivation",
  "strategy_card_daily_conversation_intent",
  "strategy_card_local_date",
  "strategy_card_local_weekday",
  "strategy_card_user_timezone",
  "strategy_card_is_new_accountability_day",
  "strategy_card_high_repeat_risk",
  "strategy_card_zero_question_required",
  "strategy_card_zero_question_reason",
  "daily_zero_question_mode_active",
  "memory_repeat_repair_skipped_zero_question_mode",
  "memory_repeat_repair_skipped_reason",
  "stale_ask_avoidance_has_satisfied_recent_ask",
  "stale_ask_avoidance_satisfied_label_count",
  "stale_ask_avoidance_do_not_reask_label_count",
  "stale_ask_avoidance_recent_question_label_count",
  "strategy_card_legacy_v2_contract_proposal_kind",
  "strategy_card_daily_contract_proposal_kind",
  "strategy_card_daily_refresh_step",
  "strategy_card_daily_refresh_session_written_before_sms",
  "strategy_card_daily_refresh_required_anchor_fingerprint",
  "strategy_card_daily_refresh_required_ask_fingerprint",
  "strategy_card_daily_pending_resolution_kind",
  "strategy_card_daily_pending_state_written_before_sms",
  "strategy_card_daily_pending_candidate_fingerprint",
  "strategy_card_daily_pending_awaiting_user_confirmation",
  "strategy_card_weekly_completed_count",
  "strategy_card_weekly_missed_count",
  "strategy_card_weekly_partial_count",
  "strategy_card_weekly_silent_week",
  "strategy_card_weekly_rough_week",
  "strategy_card_weekly_strong_week",
  "strategy_card_weekly_has_proof_hints",
  "strategy_card_weekly_can_claim_proof",
  "strategy_card_weekly_can_reference_victory_room",
  "strategy_card_weekly_proof_state_written_before_sms",
  "strategy_card_packet_writer_hints_stripped",
  "strategy_card_packet_stripped_fields",
  "relationship_anchor_available_count",
  "schedule_anchor_available_count",
  "relationship_anchor_recently_used_count",
  "relationship_anchor_source_onboarding_count",
  "relationship_anchor_source_sms_confirmed_count",
  "strategy_card_relationship_anchor_boundary_present",
] as const;

const REPAIR_SNAPSHOT_OBSERVABILITY_KEYS = [
  "repair_snapshot_version",
  "repair_snapshot_kind",
  "repair_snapshot_chars",
  "repair_snapshot_truncated",
  "lane_repair_attempted",
  "lane_repair_succeeded",
  "thread_freshness_repair_attempted",
  "thread_freshness_repair_succeeded",
  "thread_freshness_violation_reason",
  "memory_repeat_guard_attempted",
  "memory_repeat_guard_succeeded",
  "memory_repeat_guard_reason",
  "memory_repeat_no_send_reason",
  "still_repeated_after_repair",
] as const;

const LANE_CONTEXT_OBSERVABILITY_KEYS = [
  "lane_stage",
  "route_purpose",
  "v3_lane_reply_source",
  "v3_lane_turn_purpose",
  "no_send_reason",
  "temporal_contract_version",
  "user_timezone",
  "today_key",
  "yesterday_key",
  "tomorrow_key",
  "send_day_key",
  "temporal_wording_violation_detected",
  "temporal_wording_violation_reason",
  "temporal_wording_repair_attempted",
  "temporal_wording_repair_succeeded",
] as const;

/** Compact DailySmsWritingBriefV1 + proof/freshness/seatbelt telemetry for sent-row SQL. */
export const DAILY_WRITING_BRIEF_OBSERVABILITY_KEYS = [
  "writer_prompt_path",
  "daily_writing_brief_used",
  "daily_writing_brief_version",
  "daily_writing_brief_build_status",
  "daily_writing_brief_skip_reason",
  "writer_system_chars",
  "writer_payload_chars",
  "writer_total_chars",
  "daily_proof_wins_7d",
  "daily_proof_misses_7d",
  "daily_proof_partials_7d",
  "daily_proof_last_user_yes_age_days",
  "daily_praise_allowed_level",
  "daily_consistency_claim_allowed",
  "daily_strong_commitment_claim_allowed",
  "daily_freshness_avoid_count",
  "daily_freshness_avoid_phrases_preview",
  "daily_brief_thread_message_count",
  "daily_brief_thread_char_count",
  "daily_brief_thread_window_mode",
  "daily_brief_thread_floor_message_count",
  "daily_brief_thread_extension_message_count",
  "daily_brief_thread_oldest_at_local",
  "daily_brief_thread_newest_at_local",
  "daily_suggested_move",
  "daily_suggested_posture",
  "daily_suggested_max_questions",
  "daily_suggested_move_reason_preview",
  "daily_suggested_move_must_not_do_count",
  "daily_open_loop_pending_active",
  "daily_open_question_pending",
  "daily_satisfied_do_not_repeat_count",
  "daily_goal_evolution_invite_active",
  "daily_pending_plan_active",
  "daily_thread_freshness_do_not_reask_count",
  "daily_local_daypart",
  "daily_timing_copy_guidance_count",
  "daily_timing_anchor_active",
  "daily_timing_anchor_confidence",
  "daily_timing_guidance_present",
  "daily_timing_guidance_reason",
  "daily_durable_memory_item_count",
  "daily_durable_people_count",
  "daily_durable_blocker_theme_count",
  "daily_durable_memory_background_only",
  "daily_durable_memory_has_identity_anchor",
  "daily_durable_memory_has_profile_hint",
  "daily_unsupported_praise_detected",
  "unsupported_praise_phrase",
  "unsupported_praise_claim",
  "daily_repeated_cta_detected",
  "repeated_cta_phrase",
  "daily_fresh_move_guard_blocked",
] as const;

function inferRepairSnapshotRepairSucceeded(metadata: Record<string, unknown>): boolean | null {
  if (metadata.lane_repair_succeeded === true) return true;
  if (metadata.lane_repair_succeeded === false) return false;
  if (metadata.thread_freshness_repair_succeeded === true) return true;
  if (metadata.thread_freshness_repair_succeeded === false) return false;
  if (metadata.memory_repeat_guard_succeeded === true) return true;
  if (metadata.memory_repeat_guard_succeeded === false) return false;
  if (metadata.still_repeated_after_repair === true) return false;
  if (metadata.temporal_wording_repair_succeeded === true) return true;
  if (metadata.temporal_wording_repair_succeeded === false) return false;
  return null;
}

/**
 * Compact packet + repair telemetry for sms_send_events / inbound spine / weekly metadata.
 * Does not affect OpenAI prompts or visible SMS.
 */
export function relationshipObservabilityFromLaneMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (metadata == null || typeof metadata !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const key of [
    ...RELATIONSHIP_PACKET_OBSERVABILITY_KEYS,
    ...REPAIR_SNAPSHOT_OBSERVABILITY_KEYS,
    ...LANE_CONTEXT_OBSERVABILITY_KEYS,
    ...DAILY_WRITING_BRIEF_OBSERVABILITY_KEYS,
  ]) {
    if (metadata[key] !== undefined) out[key] = metadata[key];
  }
  const repairSucceeded = inferRepairSnapshotRepairSucceeded(metadata);
  if (repairSucceeded !== null) {
    out.repair_snapshot_repair_succeeded = repairSucceeded;
  }
  return out;
}
