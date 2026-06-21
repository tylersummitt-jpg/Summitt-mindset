/**
 * Slice 3A/3B — coach-initiated goal evolution invite + inbound acceptance detection.
 * Pure evaluators: no DB writes, no pending, no mutation, no OpenAI in this module.
 * Slice 3B routes validated acceptance into existing 2A/2B Wave4 hallway (inbound route).
 */

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { EvolutionV1EvaluationResult } from "@/lib/v2-commitment-evolution-engine-v1";
import { getPendingResolutionOrNull, isPendingResolutionExpired } from "@/lib/v2-guided-resolution";
import { parseIsoMs } from "@/lib/v2-identity-anchor";
import { isRefreshSessionActive } from "@/lib/v2-refresh-session";
import type { SmsGoalAdjustmentSignalResult } from "@/lib/sms-goal-adjustment-signal";
import type { SmsPatternSignalResult } from "@/lib/sms-pattern-signal";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import type { TurnUnderstandingGoalAdjustmentType } from "@/lib/openai-relationship-turn-understanding-v1";

export type CoachGoalEvolutionInviteKind =
  | "raise"
  | "shrink"
  | "reset"
  | "blocker_focus"
  | "new_chapter"
  | "none";

export type CoachGoalEvolutionInviteSource =
  | "consistency"
  | "repeated_miss"
  | "recurring_blocker"
  | "goal_age_habit"
  | "evolution_engine"
  | "none";

export type CoachGoalEvolutionInviteAction = "invite_only" | "hold_standard" | "defer";

export type CoachInitiatedGoalEvolutionInvite = {
  invite_detected: boolean;
  invite_kind: CoachGoalEvolutionInviteKind;
  invite_source: CoachGoalEvolutionInviteSource;
  confidence: "low" | "medium" | "high";
  evidence_summary: string | null;
  hold_standard_reason: string | null;
  should_invite: boolean;
  should_create_pending: false;
  no_state_mutation_without_user_acceptance: true;
  not_outcome_write: true;
  coach_goal_evolution_action: CoachGoalEvolutionInviteAction;
};

/** Compact daily facts shape for writers (no mutation fields). */
export type DailyCoachGoalEvolutionInviteFacts = {
  coach_goal_evolution_invite_detected: boolean;
  invite_kind: CoachGoalEvolutionInviteKind;
  invite_source: CoachGoalEvolutionInviteSource;
  confidence: "low" | "medium" | "high";
  evidence_summary: string | null;
  hold_standard_reason: string | null;
  should_invite: boolean;
  should_create_pending: false;
  no_state_mutation_without_user_acceptance: true;
  current_goal_not_changed: true;
  coach_goal_evolution_action: CoachGoalEvolutionInviteAction;
};

const MS_DAY = 86400000;

export const COACH_GOAL_EVOLUTION_INVITE_COOLDOWN_DAYS = 14;
export const COACH_GOAL_EVOLUTION_RECENT_GOAL_CHANGE_COOLDOWN_DAYS = 14;
export const COACH_GOAL_EVOLUTION_RAISE_STREAK_MIN = 5;
export const COACH_GOAL_EVOLUTION_RAISE_YES7_MIN = 5;
export const COACH_GOAL_EVOLUTION_RAISE_FIRST_WEEK_STRONG_STREAK_MIN = 7;
export const COACH_GOAL_EVOLUTION_FIRST_WEEK_DAYS = 7;
export const COACH_GOAL_EVOLUTION_NEW_CHAPTER_STREAK_MIN = 7;
export const COACH_GOAL_EVOLUTION_NEW_CHAPTER_GOAL_AGE_DAYS_MIN = 21;
export const COACH_GOAL_EVOLUTION_NEW_CHAPTER_NEG14_MAX = 1;
export const COACH_GOAL_EVOLUTION_SHRINK_NEG14_MIN = 4;
export const COACH_GOAL_EVOLUTION_SHRINK_WITH_BLOCKER_NEG14_MIN = 3;
export const COACH_GOAL_EVOLUTION_RESET_NEG14_MIN = 5;
export const COACH_GOAL_EVOLUTION_RESET_NO12_MIN = 4;
export const COACH_GOAL_EVOLUTION_BLOCKER_21D_MIN = 4;
export const COACH_GOAL_EVOLUTION_BLOCKER_HIGH_CONFIDENCE_MIN = 3;
export const COACH_GOAL_EVOLUTION_BLOCKER_WITH_NEG14_MIN = 2;
export const COACH_GOAL_EVOLUTION_INVITE_MAX_ROLLING_14D = 1;
export const COACH_GOAL_EVOLUTION_INVITE_ACCEPTANCE_TTL_MS = 72 * MS_DAY;

export type CoachGoalEvolutionInviteKindForAcceptance = Exclude<
  CoachGoalEvolutionInviteKind,
  "none"
>;

export type RecentCoachGoalEvolutionInvite = {
  found: boolean;
  sent_at: string | null;
  invite_kind: CoachGoalEvolutionInviteKindForAcceptance | null;
  invite_source: string | null;
  evidence_summary: string | null;
  ttl_valid: boolean;
  last_outbound_is_invite: boolean;
  skip_reason?: string;
};

export type CoachInviteAcceptanceDisposition = "accepted" | "declined" | "ignored" | "skip";

const RECENT_GOAL_CHANGE_COOLDOWN_MS =
  COACH_GOAL_EVOLUTION_RECENT_GOAL_CHANGE_COOLDOWN_DAYS * MS_DAY;
const COACH_GOAL_EVOLUTION_INVITE_COOLDOWN_MS =
  COACH_GOAL_EVOLUTION_INVITE_COOLDOWN_DAYS * MS_DAY;

const GOAL_CHANGE_PROOF_TYPES = new Set(["commitment_tightened", "commitment_replaced"]);
const GOAL_CHANGE_REFRESH_RESOLUTIONS = new Set(["change", "tighten", "new"]);

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return null;
}

function eventOccurredAtMs(occurredAt: string): number | null {
  const t = new Date(occurredAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function isExplicitGoalChangeEvent(e: V2EventRowForAi): boolean {
  const p = payloadRecord(e.payload_json);
  if (!p) return false;

  if (p.proof_moment === true) {
    const proofType = typeof p.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
    if (GOAL_CHANGE_PROOF_TYPES.has(proofType)) return true;
  }

  if (e.event_type === "sms_memory_signal") {
    const ms = p.memory_signal;
    const msObj =
      ms != null && typeof ms === "object" && !Array.isArray(ms)
        ? (ms as Record<string, unknown>)
        : null;
    if (msObj?.wave12_commitment_change_proof === true) {
      const proofType = typeof p.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
      if (GOAL_CHANGE_PROOF_TYPES.has(proofType)) return true;
    }
  }

  if (e.event_type === "coaching_refresh_resolved") {
    const resolution = typeof p.resolution === "string" ? p.resolution.trim() : "";
    if (GOAL_CHANGE_REFRESH_RESOLUTIONS.has(resolution)) return true;
  }

  if (e.event_type === "contract_overlay_activated") {
    return true;
  }

  return false;
}

/** Latest explicit goal-change signal within cooldown window, or brand-new started_at proxy. */
export function deriveRecentGoalChangeAtMs(args: {
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst?: V2EventRowForAi[] | null;
  nowMs?: number;
}): number | null {
  const nowMs = args.nowMs ?? Date.now();
  const cutoffMs = nowMs - RECENT_GOAL_CHANGE_COOLDOWN_MS;
  let explicitLatest: number | null = null;

  for (const e of args.eventsNewestFirst ?? []) {
    if (!isExplicitGoalChangeEvent(e)) continue;
    const t = eventOccurredAtMs(e.occurred_at);
    if (t == null || t < cutoffMs || t > nowMs) continue;
    explicitLatest = explicitLatest == null ? t : Math.max(explicitLatest, t);
  }

  if (explicitLatest != null) return explicitLatest;

  const startedMs = parseIsoMs(args.commitment.started_at);
  if (startedMs != null && startedMs >= cutoffMs && startedMs <= nowMs) {
    return startedMs;
  }

  return null;
}

function coachGoalEvolutionActionFromCheckSentPayload(
  payload: Record<string, unknown>
): string | null {
  const ai = payloadRecord(payload.ai);
  if (!ai) return null;
  const v3Brain = payloadRecord(ai.v3_brain);
  if (!v3Brain) return null;
  const action = v3Brain.coach_goal_evolution_action;
  return typeof action === "string" ? action : null;
}

export function deriveCoachGoalEvolutionInviteSentSummary(args: {
  eventsNewestFirst?: V2EventRowForAi[] | null;
  nowMs?: number;
}): { lastInviteAtMs: number | null; inviteCount14d: number } {
  const nowMs = args.nowMs ?? Date.now();
  const cutoff14Ms = nowMs - COACH_GOAL_EVOLUTION_INVITE_COOLDOWN_MS;
  let lastInviteAtMs: number | null = null;
  let inviteCount14d = 0;

  for (const e of args.eventsNewestFirst ?? []) {
    if (e.event_type !== "check_sent") continue;
    const p = payloadRecord(e.payload_json);
    if (!p) continue;
    if (coachGoalEvolutionActionFromCheckSentPayload(p) !== "invite_only") continue;

    const t = eventOccurredAtMs(e.occurred_at);
    if (t == null || t > nowMs) continue;

    if (t >= cutoff14Ms) inviteCount14d += 1;
    lastInviteAtMs = lastInviteAtMs == null ? t : Math.max(lastInviteAtMs, t);
  }

  return { lastInviteAtMs, inviteCount14d };
}

export function isCoachGoalEvolutionInviteCooldownActive(args: {
  eventsNewestFirst?: V2EventRowForAi[] | null;
  nowMs?: number;
}): boolean {
  const summary = deriveCoachGoalEvolutionInviteSentSummary(args);
  return summary.inviteCount14d >= COACH_GOAL_EVOLUTION_INVITE_MAX_ROLLING_14D;
}

function hasRecurringBlockerPatternForShrink(pattern: SmsPatternSignalResult | null): boolean {
  if (!pattern?.canonical) return false;
  const conf = pattern.confidence ?? "low";
  return (
    pattern.count21d >= COACH_GOAL_EVOLUTION_BLOCKER_HIGH_CONFIDENCE_MIN ||
    (pattern.count14d >= 2 && (conf === "medium" || conf === "high"))
  );
}

function holdResult(hold_standard_reason: string): CoachInitiatedGoalEvolutionInvite {
  return {
    invite_detected: false,
    invite_kind: "none",
    invite_source: "none",
    confidence: "low",
    evidence_summary: null,
    hold_standard_reason,
    should_invite: false,
    should_create_pending: false,
    no_state_mutation_without_user_acceptance: true,
    not_outcome_write: true,
    coach_goal_evolution_action: "hold_standard",
  };
}

function inviteResult(args: {
  invite_kind: Exclude<CoachGoalEvolutionInviteKind, "none">;
  invite_source: Exclude<CoachGoalEvolutionInviteSource, "none">;
  confidence: "medium" | "high";
  evidence_summary: string;
}): CoachInitiatedGoalEvolutionInvite {
  return {
    invite_detected: true,
    invite_kind: args.invite_kind,
    invite_source: args.invite_source,
    confidence: args.confidence,
    evidence_summary: args.evidence_summary,
    hold_standard_reason: null,
    should_invite: true,
    should_create_pending: false,
    no_state_mutation_without_user_acceptance: true,
    not_outcome_write: true,
    coach_goal_evolution_action: "invite_only",
  };
}

function commitmentAgeDays(commitment: ActiveV2CommitmentRow, nowMs: number): number | null {
  const startedMs = parseIsoMs(commitment.started_at);
  if (startedMs == null) return null;
  return Math.floor((nowMs - startedMs) / MS_DAY);
}

export function mapCoachGoalEvolutionInviteToDailyFacts(
  invite: CoachInitiatedGoalEvolutionInvite
): DailyCoachGoalEvolutionInviteFacts {
  return {
    coach_goal_evolution_invite_detected: invite.should_invite,
    invite_kind: invite.invite_kind,
    invite_source: invite.invite_source,
    confidence: invite.confidence,
    evidence_summary: invite.evidence_summary,
    hold_standard_reason: invite.hold_standard_reason,
    should_invite: invite.should_invite,
    should_create_pending: false,
    no_state_mutation_without_user_acceptance: true,
    current_goal_not_changed: true,
    coach_goal_evolution_action: invite.coach_goal_evolution_action,
  };
}

export function buildCoachGoalEvolutionInviteTelemetry(
  invite: CoachInitiatedGoalEvolutionInvite
): Record<string, unknown> {
  return {
    coach_goal_evolution_signal_detected: invite.should_invite,
    coach_goal_evolution_invite_kind: invite.invite_kind,
    coach_goal_evolution_invite_source: invite.invite_source,
    coach_goal_evolution_confidence: invite.confidence,
    coach_goal_evolution_action: invite.coach_goal_evolution_action,
    coach_goal_evolution_hold_standard_reason: invite.hold_standard_reason,
    coach_goal_evolution_no_state_mutation_without_user_acceptance: true,
    coach_goal_evolution_should_create_pending: false,
    coach_goal_evolution_evidence_summary: invite.evidence_summary,
  };
}

export function buildCoachGoalEvolutionInviteLaneGuardrails(): string {
  return `
COACH_GOAL_EVOLUTION_INVITE (when structured_recent_truth.coach_goal_evolution_invite.should_invite is true):
- This is a coach-initiated INVITATION to discuss evolving the standard — not a command and not a completed change.
- current_goal_not_changed is true — do NOT say the goal changed, was raised, lowered, reset, or replaced.
- should_create_pending is false — do NOT imply a pending SMS goal update was started.
- Frame as an invitation: the user may want to raise/shrink/reset/focus the blocker or start a next chapter — they must accept and name a bar later (Slice 3B).
- For invite_kind new_chapter: do NOT say the goal is officially a habit — frame gently that it may be becoming their baseline and ask if they want a next chapter.
- Preserve accountability — do not excuse avoidance or treat this as proof/miss outcome.
- Do not use robotic contract language, fake Pat quotes, or "Reply YES/NO" unless an existing binding contract flow already requires it on this route.
- When should_invite is false, do NOT invite goal evolution — hold the current standard unless other facts already authorize a different move.`;
}

export function evaluateCoachInitiatedGoalEvolutionInvite(args: {
  commitment: ActiveV2CommitmentRow;
  routeKind?: "main_active_accountability" | "contract_prompt" | "pending_resolution" | "refresh_identity" | "refresh_commitment";
  yesStreak14d?: number | null;
  yesCount7d?: number | null;
  negativeOutcomes14d?: number | null;
  goalAdjustmentSignal?: SmsGoalAdjustmentSignalResult | null;
  patternSignal?: SmsPatternSignalResult | null;
  evolutionEvaluation?: EvolutionV1EvaluationResult | null;
  plannedInterruptionActive?: boolean;
  refreshSessionActive?: boolean;
  overlayActive?: boolean;
  adaptiveProposalPending?: boolean;
  contractProposalMode?: boolean;
  shrinkOverlayEligible?: boolean;
  nextMoveShrinkAsk?: boolean;
  eventsNewestFirst?: V2EventRowForAi[] | null;
  nowMs?: number;
}): CoachInitiatedGoalEvolutionInvite {
  const nowMs = args.nowMs ?? Date.now();
  const yesStreak = Math.max(0, args.yesStreak14d ?? 0);
  const yes7 = Math.max(0, args.yesCount7d ?? 0);
  const neg14 = Math.max(0, args.negativeOutcomes14d ?? 0);
  const pattern = args.patternSignal ?? null;
  const evolution = args.evolutionEvaluation ?? null;
  const ga = args.goalAdjustmentSignal ?? null;
  const ageDays = commitmentAgeDays(args.commitment, nowMs);

  const pending = getPendingResolutionOrNull(args.commitment);
  if (pending && !isPendingResolutionExpired(args.commitment, nowMs)) {
    return holdResult("active_pending");
  }

  if (args.routeKind && args.routeKind !== "main_active_accountability") {
    return holdResult("non_main_daily_route");
  }

  if (args.plannedInterruptionActive) {
    return holdResult("planned_interruption");
  }

  if (args.refreshSessionActive === true || isRefreshSessionActive(args.commitment)) {
    return holdResult("refresh_session_active");
  }

  if (args.overlayActive || args.adaptiveProposalPending) {
    return holdResult("adaptive_overlay_or_proposal");
  }

  if (args.contractProposalMode || args.shrinkOverlayEligible || args.nextMoveShrinkAsk) {
    return holdResult("active_contract_or_shrink_flow");
  }

  if (ga?.move === "subscription_integrity" || ga?.move === "pause_cadence") {
    return holdResult("safety_or_pause_context");
  }

  if (
    deriveRecentGoalChangeAtMs({
      commitment: args.commitment,
      eventsNewestFirst: args.eventsNewestFirst,
      nowMs,
    }) != null
  ) {
    return holdResult("recent_goal_change_cooldown");
  }

  if (
    isCoachGoalEvolutionInviteCooldownActive({
      eventsNewestFirst: args.eventsNewestFirst,
      nowMs,
    })
  ) {
    return holdResult("coach_goal_evolution_invite_cooldown");
  }

  const evAction = evolution?.recommended_action ?? "keep_commitment";
  const patternConf = pattern?.confidence ?? "low";
  const patternCanonical = pattern?.canonical ?? null;
  const count21 = pattern?.count21d ?? 0;
  const count14 = pattern?.count14d ?? 0;

  const noIn12 =
    typeof evolution?.evidence_json?.user_no_count_last_12_outcomes === "number"
      ? evolution.evidence_json.user_no_count_last_12_outcomes
      : 0;

  const evolutionReset = evAction === "replace_commitment";
  const evolutionShrink = evAction === "tighten_commitment" || evAction === "reframe_commitment";

  /** Evolution replace alone (e.g. noIn12 >= 3) is weaker than coach reset bar — require corroboration. */
  const evolutionReplaceResetCorroborated =
    evolutionReset &&
    (neg14 >= COACH_GOAL_EVOLUTION_SHRINK_NEG14_MIN ||
      noIn12 >= COACH_GOAL_EVOLUTION_RESET_NO12_MIN ||
      hasRecurringBlockerPatternForShrink(pattern));

  const blockerFocusEligible =
    Boolean(patternCanonical) &&
    (count21 >= COACH_GOAL_EVOLUTION_BLOCKER_21D_MIN ||
      (count14 >= COACH_GOAL_EVOLUTION_BLOCKER_HIGH_CONFIDENCE_MIN &&
        patternConf === "high" &&
        neg14 >= COACH_GOAL_EVOLUTION_BLOCKER_WITH_NEG14_MIN));

  if (blockerFocusEligible) {
    const conf: "medium" | "high" =
      count21 >= COACH_GOAL_EVOLUTION_BLOCKER_21D_MIN || patternConf === "high" ? "high" : "medium";
    return inviteResult({
      invite_kind: "blocker_focus",
      invite_source: "recurring_blocker",
      confidence: conf,
      evidence_summary: `recurring_blocker:${patternCanonical};14d=${count14};21d=${count21};neg14=${neg14}`,
    });
  }

  const resetEligible =
    neg14 >= COACH_GOAL_EVOLUTION_RESET_NEG14_MIN ||
    noIn12 >= COACH_GOAL_EVOLUTION_RESET_NO12_MIN ||
    evolutionReplaceResetCorroborated;

  if (resetEligible) {
    const conf: "medium" | "high" =
      neg14 >= COACH_GOAL_EVOLUTION_RESET_NEG14_MIN || evolutionReplaceResetCorroborated
        ? "high"
        : "medium";
    return inviteResult({
      invite_kind: "reset",
      invite_source: evolutionReplaceResetCorroborated ? "evolution_engine" : "repeated_miss",
      confidence: conf,
      evidence_summary: evolutionReplaceResetCorroborated
        ? `evolution_engine:${evAction};neg14=${neg14};no12=${noIn12}`
        : noIn12 >= COACH_GOAL_EVOLUTION_RESET_NO12_MIN
          ? `repeated_miss:no12=${noIn12};neg14=${neg14}`
          : `repeated_miss:neg14=${neg14}`,
    });
  }

  const shrinkEligible =
    neg14 >= COACH_GOAL_EVOLUTION_SHRINK_NEG14_MIN ||
    (neg14 >= COACH_GOAL_EVOLUTION_SHRINK_WITH_BLOCKER_NEG14_MIN &&
      hasRecurringBlockerPatternForShrink(pattern)) ||
    evolutionShrink;

  if (shrinkEligible) {
    const conf: "medium" | "high" =
      neg14 >= COACH_GOAL_EVOLUTION_SHRINK_NEG14_MIN || evolutionShrink ? "high" : "medium";
    return inviteResult({
      invite_kind: "shrink",
      invite_source: evolutionShrink ? "evolution_engine" : "repeated_miss",
      confidence: conf,
      evidence_summary: evolutionShrink
        ? `evolution_engine:${evAction};neg14=${neg14}`
        : `repeated_miss:neg14=${neg14};blocker=${patternCanonical ?? "none"}`,
    });
  }

  const raiseEligible =
    yesStreak >= COACH_GOAL_EVOLUTION_RAISE_STREAK_MIN ||
    yes7 >= COACH_GOAL_EVOLUTION_RAISE_YES7_MIN;

  if (raiseEligible) {
    const inFirstWeek =
      ageDays != null && ageDays < COACH_GOAL_EVOLUTION_FIRST_WEEK_DAYS;
    if (inFirstWeek && yesStreak < COACH_GOAL_EVOLUTION_RAISE_FIRST_WEEK_STRONG_STREAK_MIN) {
      return holdResult("commitment_too_young_for_raise_invite");
    }

    const newChapterEligible =
      yesStreak >= COACH_GOAL_EVOLUTION_NEW_CHAPTER_STREAK_MIN &&
      ageDays != null &&
      ageDays >= COACH_GOAL_EVOLUTION_NEW_CHAPTER_GOAL_AGE_DAYS_MIN &&
      neg14 <= COACH_GOAL_EVOLUTION_NEW_CHAPTER_NEG14_MAX;

    if (newChapterEligible) {
      return inviteResult({
        invite_kind: "new_chapter",
        invite_source: "goal_age_habit",
        confidence: "high",
        evidence_summary: `goal_age_habit:yes_streak=${yesStreak};age_days=${ageDays};neg14=${neg14}`,
      });
    }

    const conf: "medium" | "high" =
      yesStreak >= COACH_GOAL_EVOLUTION_RAISE_STREAK_MIN + 2 ||
      yes7 >= COACH_GOAL_EVOLUTION_RAISE_YES7_MIN + 2
        ? "high"
        : "medium";
    return inviteResult({
      invite_kind: "raise",
      invite_source: "consistency",
      confidence: conf,
      evidence_summary: `consistency:yes_streak_14d=${yesStreak};yes7=${yes7}`,
    });
  }

  if (yes7 === 1 || yesStreak === 1) {
    return holdResult("single_win_or_insufficient_evidence");
  }

  if (neg14 === 1) {
    return holdResult("single_miss_or_insufficient_evidence");
  }

  if (neg14 === 2 || neg14 === 3) {
    return holdResult("repeated_miss_below_shrink_threshold");
  }

  if (patternCanonical && count14 === 1 && patternConf === "low") {
    return {
      invite_detected: false,
      invite_kind: "none",
      invite_source: "none",
      confidence: "low",
      evidence_summary: null,
      hold_standard_reason: "blocker_pattern_below_threshold",
      should_invite: false,
      should_create_pending: false,
      no_state_mutation_without_user_acceptance: true,
      not_outcome_write: true,
      coach_goal_evolution_action: "defer",
    };
  }

  return holdResult("insufficient_evidence_hold_standard");
}

/** Count user_yes outcomes in trailing 7 days (for daily route wiring). */
export function countYesOutcomes7dForCoachInvite(
  eventsNewestFirst: V2EventRowForAi[],
  nowMs: number
): number {
  const cutoff = nowMs - 7 * MS_DAY;
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type !== "user_yes") continue;
    const t = new Date(e.occurred_at).getTime();
    if (Number.isFinite(t) && t >= cutoff && t <= nowMs) n += 1;
  }
  return n;
}

const COACH_INVITE_ACCEPTANCE_KINDS = new Set<CoachGoalEvolutionInviteKindForAcceptance>([
  "raise",
  "new_chapter",
  "shrink",
  "reset",
  "blocker_focus",
]);

function coachInviteTelemetryFromCheckSentPayload(
  payload: Record<string, unknown>
): {
  action: string | null;
  invite_kind: CoachGoalEvolutionInviteKindForAcceptance | null;
  invite_source: string | null;
  evidence_summary: string | null;
} | null {
  const ai = payloadRecord(payload.ai);
  if (!ai) return null;
  const v3Brain = payloadRecord(ai.v3_brain);
  if (!v3Brain) return null;
  const action =
    typeof v3Brain.coach_goal_evolution_action === "string"
      ? v3Brain.coach_goal_evolution_action
      : null;
  const kindRaw =
    typeof v3Brain.coach_goal_evolution_invite_kind === "string"
      ? v3Brain.coach_goal_evolution_invite_kind.trim()
      : "";
  const invite_kind = COACH_INVITE_ACCEPTANCE_KINDS.has(
    kindRaw as CoachGoalEvolutionInviteKindForAcceptance
  )
    ? (kindRaw as CoachGoalEvolutionInviteKindForAcceptance)
    : null;
  const invite_source =
    typeof v3Brain.coach_goal_evolution_invite_source === "string"
      ? v3Brain.coach_goal_evolution_invite_source
      : null;
  const evidence_summary =
    typeof v3Brain.coach_goal_evolution_evidence_summary === "string"
      ? v3Brain.coach_goal_evolution_evidence_summary
      : null;
  return { action, invite_kind, invite_source, evidence_summary };
}

function emptyRecentCoachInvite(skip_reason?: string): RecentCoachGoalEvolutionInvite {
  return {
    found: false,
    sent_at: null,
    invite_kind: null,
    invite_source: null,
    evidence_summary: null,
    ttl_valid: false,
    last_outbound_is_invite: false,
    ...(skip_reason ? { skip_reason } : {}),
  };
}

function hasLaterCoachThreadMessageAfterInvite(
  thread72h: RecentExactThread72hResult | null | undefined,
  inviteAtMs: number
): boolean {
  if (!thread72h?.messages?.length) return false;
  for (const m of thread72h.messages) {
    if (m.role !== "coach") continue;
    const t = new Date(m.at).getTime();
    if (Number.isFinite(t) && t > inviteAtMs + 2000) return true;
  }
  return false;
}

/** Latest valid coach goal-evolution invite from recent events (Slice 3B). */
export function deriveRecentCoachGoalEvolutionInviteFromEvents(args: {
  eventsNewestFirst?: V2EventRowForAi[] | null;
  commitment: ActiveV2CommitmentRow;
  nowMs?: number;
  lastOutboundSentAtMs?: number | null;
  recentExactThread72h?: RecentExactThread72hResult | null;
}): RecentCoachGoalEvolutionInvite {
  const nowMs = args.nowMs ?? Date.now();
  const events = args.eventsNewestFirst ?? [];

  let mostRecentCheckSent: V2EventRowForAi | null = null;
  let inviteEvent: V2EventRowForAi | null = null;
  let inviteTelemetry: ReturnType<typeof coachInviteTelemetryFromCheckSentPayload> = null;

  for (const e of events) {
    if (e.event_type !== "check_sent") continue;
    if (!mostRecentCheckSent) mostRecentCheckSent = e;
    const p = payloadRecord(e.payload_json);
    if (!p) continue;
    const telemetry = coachInviteTelemetryFromCheckSentPayload(p);
    if (telemetry?.action === "invite_only" && telemetry.invite_kind && !inviteEvent) {
      inviteEvent = e;
      inviteTelemetry = telemetry;
    }
  }

  if (!inviteEvent || !inviteTelemetry?.invite_kind) {
    return emptyRecentCoachInvite("no_recent_coach_invite");
  }

  const inviteAtMs = eventOccurredAtMs(inviteEvent.occurred_at);
  if (inviteAtMs == null) {
    return emptyRecentCoachInvite("invalid_invite_timestamp");
  }

  const ttl_valid = nowMs - inviteAtMs <= COACH_GOAL_EVOLUTION_INVITE_ACCEPTANCE_TTL_MS;
  const base = {
    found: true,
    sent_at: inviteEvent.occurred_at,
    invite_kind: inviteTelemetry.invite_kind,
    invite_source: inviteTelemetry.invite_source,
    evidence_summary: inviteTelemetry.evidence_summary,
    ttl_valid,
    last_outbound_is_invite: false,
  };

  if (!ttl_valid) {
    return { ...base, skip_reason: "invite_ttl_expired" };
  }

  const latestCheckAt = mostRecentCheckSent
    ? eventOccurredAtMs(mostRecentCheckSent.occurred_at)
    : null;
  const inviteIsLatestCheckSent =
    latestCheckAt != null &&
    mostRecentCheckSent === inviteEvent &&
    Math.abs(latestCheckAt - inviteAtMs) <= 2000;

  let last_outbound_is_invite = inviteIsLatestCheckSent;
  if (
    args.lastOutboundSentAtMs != null &&
    Number.isFinite(args.lastOutboundSentAtMs) &&
    args.lastOutboundSentAtMs > inviteAtMs + 2000
  ) {
    last_outbound_is_invite = false;
  }
  if (hasLaterCoachThreadMessageAfterInvite(args.recentExactThread72h, inviteAtMs)) {
    last_outbound_is_invite = false;
  }

  if (!last_outbound_is_invite) {
    return { ...base, last_outbound_is_invite: false, skip_reason: "later_coach_outbound_after_invite" };
  }

  const goalChangeAt = deriveRecentGoalChangeAtMs({
    commitment: args.commitment,
    eventsNewestFirst: events,
    nowMs,
  });
  if (goalChangeAt != null && goalChangeAt > inviteAtMs) {
    return {
      ...base,
      last_outbound_is_invite: false,
      skip_reason: "goal_changed_since_invite",
    };
  }

  return { ...base, last_outbound_is_invite: true };
}

export function mapCoachInviteKindToAdjustmentType(
  inviteKind: CoachGoalEvolutionInviteKindForAcceptance
): TurnUnderstandingGoalAdjustmentType {
  switch (inviteKind) {
    case "raise":
      return "raise";
    case "shrink":
      return "shrink";
    case "reset":
      return "reset";
    case "blocker_focus":
      return "blocker_focus";
    case "new_chapter":
      return "reset";
    default:
      return "unspecified";
  }
}
