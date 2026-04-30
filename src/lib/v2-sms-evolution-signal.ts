/**
 * Wave 7 — SMS-native commitment evolution signals (read-only; no commitment mutation).
 * Combines pending DB rows (dashboard engine) with pure evaluator hints for copy only.
 */

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { EvolutionRecommendationRow } from "@/lib/v2-commitment-evolution-recommendation";
import {
  evaluateCommitmentEvolutionV1,
  type EvolutionV1EvaluationResult,
  type EvolutionV1RecommendedAction,
} from "@/lib/v2-commitment-evolution-engine-v1";
import { getPendingResolutionOrNull, isPendingResolutionExpired } from "@/lib/v2-guided-resolution";
import { parseIsoMs } from "@/lib/v2-identity-anchor";
import { isRefreshSessionActive } from "@/lib/v2-refresh-session";

const MS_DAY = 86400000;
const MS_HOUR = 3600000;

/** Pending recommendation rows older than this are ignored for SMS surfacing. */
export const WAVE7_PENDING_REC_MAX_AGE_MS = 14 * MS_DAY;
/** Avoid evolution-pattern daily SMS more than once per this window (event spine). */
export const WAVE7_EVOLUTION_COOLDOWN_MS = 3 * MS_DAY;
/** Fresh pending rows bypass cooldown when newer than this. */
export const WAVE7_PENDING_FRESH_MS = 36 * MS_HOUR;

export function summarizeEvolutionEvidenceJson(ev: Record<string, unknown>): string | null {
  const rules = ev.rules;
  const bits: string[] = [];
  if (Array.isArray(rules)) {
    for (const r of rules.slice(0, 4)) {
      if (typeof r === "string" && r.trim()) bits.push(r.trim());
    }
  }
  const latest = ev.latest_outcome;
  if (typeof latest === "string") bits.push(`latest=${latest}`);
  const no12 = ev.user_no_count_last_12_outcomes;
  if (typeof no12 === "number") bits.push(`no_last_12=${no12}`);
  const neg5 = ev.negative_outcomes_in_last_5;
  if (typeof neg5 === "number") bits.push(`neg_last_5=${neg5}`);
  if (bits.length === 0) return null;
  const s = bits.join(" · ").replace(/\s+/g, " ");
  return s.length <= 140 ? s : `${s.slice(0, 139)}…`;
}

function blockerEvents7dCount(events: V2EventRowForAi[], nowMs: number): number {
  const cutoff = nowMs - 7 * MS_DAY;
  let n = 0;
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (e.event_type === "blocker_captured") n += 1;
  }
  return n;
}

/**
 * Count recent daily SMS that used evolution_pattern_check (from check_sent payload ai).
 */
export function recentEvolutionPatternCheckSentCount(args: {
  eventsNewestFirst: V2EventRowForAi[];
  nowMs: number;
  withinMs: number;
}): number {
  const cutoff = args.nowMs - args.withinMs;
  let n = 0;
  for (const e of args.eventsNewestFirst) {
    if (e.event_type !== "check_sent") continue;
    const t = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const payload = e.payload_json as Record<string, unknown> | undefined;
    const ai = payload?.ai as Record<string, unknown> | undefined;
    if (ai?.daily_message_purpose === "evolution_pattern_check") n += 1;
  }
  return n;
}

export type Wave7DailyEvolutionPick = {
  action: EvolutionV1RecommendedAction;
  evidenceSummary: string | null;
  source: "pending_row" | "evaluator";
};

/**
 * Prefer an auditable pending row when fresh; otherwise use pure evaluator (no DB write).
 */
export function pickWave7DailyEvolutionAction(args: {
  commitment: ActiveV2CommitmentRow;
  pendingRow: EvolutionRecommendationRow | null;
  evaluation: EvolutionV1EvaluationResult;
  nowMs: number;
}): Wave7DailyEvolutionPick | null {
  const { pendingRow, evaluation, nowMs, commitment } = args;

  if (pendingRow?.status === "pending") {
    const age = nowMs - new Date(pendingRow.created_at).getTime();
    if (
      age >= 0 &&
      age <= WAVE7_PENDING_REC_MAX_AGE_MS &&
      pendingRow.recommended_action !== "keep_commitment"
    ) {
      return {
        action: pendingRow.recommended_action,
        evidenceSummary: summarizeEvolutionEvidenceJson(pendingRow.evidence_json),
        source: "pending_row",
      };
    }
  }

  const ev = evaluation;
  if (ev.recommended_action === "keep_commitment") return null;
  if (ev.recommended_action === "adapt_commitment_temporary") return null;
  if (ev.recommended_action === "refresh_commitment_only" && isRefreshSessionActive(commitment)) {
    return null;
  }

  return {
    action: ev.recommended_action,
    evidenceSummary: summarizeEvolutionEvidenceJson(ev.evidence_json),
    source: "evaluator",
  };
}

function firstWeekStrongEnoughForEvaluatorPick(args: {
  pick: Wave7DailyEvolutionPick;
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst: V2EventRowForAi[];
  nowMs: number;
}): boolean {
  const a = args.pick.action;
  if (args.pick.source === "pending_row") return true;
  if (a === "replace_commitment" || a === "reframe_commitment") return true;
  if (a === "tighten_commitment" && blockerEvents7dCount(args.eventsNewestFirst, args.nowMs) >= 2) {
    return true;
  }
  if (a === "refresh_commitment_only") return false;
  return false;
}

export function shouldSurfaceWave7EvolutionDailyPurpose(args: {
  pick: Wave7DailyEvolutionPick | null;
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst: V2EventRowForAi[];
  nowMs: number;
  reentryActive: boolean;
  silenceTier: "none" | "quiet" | "nudge";
  serverStrategy: string;
  adaptiveProposalPending: boolean;
  pendingRow: EvolutionRecommendationRow | null;
}): boolean {
  if (!args.pick) return false;
  if (args.adaptiveProposalPending) return false;

  const pend = getPendingResolutionOrNull(args.commitment);
  if (pend && !isPendingResolutionExpired(args.commitment, args.nowMs)) return false;

  if (isRefreshSessionActive(args.commitment)) return false;
  if (args.reentryActive) return false;
  if (args.silenceTier !== "none") return false;
  if (args.serverStrategy === "silence_nudge" || args.serverStrategy === "reentry_check") return false;

  const startedMs = parseIsoMs(args.commitment.started_at);
  const inFirstWeek = startedMs != null && args.nowMs - startedMs <= 7 * MS_DAY;
  if (inFirstWeek && !firstWeekStrongEnoughForEvaluatorPick({ pick: args.pick, commitment: args.commitment, eventsNewestFirst: args.eventsNewestFirst, nowMs: args.nowMs })) {
    return false;
  }

  const recentEvolutionSends = recentEvolutionPatternCheckSentCount({
    eventsNewestFirst: args.eventsNewestFirst,
    nowMs: args.nowMs,
    withinMs: WAVE7_EVOLUTION_COOLDOWN_MS,
  });
  if (recentEvolutionSends >= 1) {
    const pr = args.pendingRow;
    if (pr?.status === "pending") {
      const fresh = args.nowMs - new Date(pr.created_at).getTime() < WAVE7_PENDING_FRESH_MS;
      if (fresh) return true;
    }
    return false;
  }

  return true;
}

/** Build compact lines for SMS context pack / prompts (no raw JSON). */
export function formatWave7EvolutionContextLines(args: {
  pick: Wave7DailyEvolutionPick | null;
  pendingRowAppVisible: boolean;
  pendingAgeMs: number | null;
}): { summaryLine: string | null; influencesSmsCopy: boolean } {
  if (!args.pick) {
    return { summaryLine: null, influencesSmsCopy: false };
  }
  const ageDays =
    args.pendingAgeMs != null && args.pendingAgeMs >= 0
      ? Math.floor(args.pendingAgeMs / MS_DAY)
      : null;
  const parts = [
    `recommended_action=${args.pick.action}`,
    args.pick.source === "pending_row" ? "source=dashboard_pending_row" : "source=server_evaluator_hint",
    args.pick.evidenceSummary ? `evidence_hint=${args.pick.evidenceSummary}` : null,
    ageDays != null ? `age_days≈${ageDays}` : null,
    args.pendingRowAppVisible ? "app_pending_card=true" : "app_pending_card=false",
  ].filter((x): x is string => Boolean(x));
  return {
    summaryLine: parts.join("; ").slice(0, 280),
    influencesSmsCopy: true,
  };
}

export function evaluateCommitmentEvolutionForSms(args: {
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst: V2EventRowForAi[];
  nowMs: number;
}): EvolutionV1EvaluationResult {
  return evaluateCommitmentEvolutionV1(args);
}
