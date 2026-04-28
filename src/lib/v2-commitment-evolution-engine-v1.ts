/**
 * Commitment Evolution Engine V1 — pure evaluator (no I/O, no mutations).
 * Callers persist rows; only `refresh_commitment_only` and `reframe_commitment`
 * may create `pending` rows (see `EVOLUTION_V1_PENDING_ROW_ACTIONS`).
 */

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import {
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
} from "@/lib/v2-adaptive-contract";
import { isRefreshSessionActive } from "@/lib/v2-refresh-session";

export const EVOLUTION_V1_ACTIONS = [
  "keep_commitment",
  "adapt_commitment_temporary",
  "tighten_commitment",
  "reframe_commitment",
  "replace_commitment",
  "refresh_commitment_only",
] as const;

export type EvolutionV1RecommendedAction = (typeof EVOLUTION_V1_ACTIONS)[number];

export type EvolutionV1EvaluationResult = {
  recommended_action: EvolutionV1RecommendedAction;
  /** Compact, reproducible evidence for the recommendation row (when persisted). */
  evidence_json: Record<string, unknown>;
};

const OUTCOME_TYPES = new Set(["user_yes", "user_no", "user_partial"]);

/** Newest-first list of the first `n` accountability outcomes. */
function firstNAccountabilityOutcomes(
  eventsNewestFirst: V2EventRowForAi[],
  n: number
): V2EventRowForAi[] {
  const out: V2EventRowForAi[] = [];
  for (const e of eventsNewestFirst) {
    if (OUTCOME_TYPES.has(e.event_type)) {
      out.push(e);
      if (out.length >= n) break;
    }
  }
  return out;
}

function countOutcomeTypeInFirstNOutcomes(
  eventsNewestFirst: V2EventRowForAi[],
  type: "user_no" | "user_partial",
  outcomeCount: number
): number {
  let n = 0;
  for (const e of firstNAccountabilityOutcomes(eventsNewestFirst, outcomeCount)) {
    if (e.event_type === type) n += 1;
  }
  return n;
}

function countNegativeOutcomesInFirstN(
  eventsNewestFirst: V2EventRowForAi[],
  outcomeCount: number
): number {
  let n = 0;
  for (const e of firstNAccountabilityOutcomes(eventsNewestFirst, outcomeCount)) {
    if (e.event_type === "user_no" || e.event_type === "user_partial") n += 1;
  }
  return n;
}

function latestAccountabilityOutcome(
  eventsNewestFirst: V2EventRowForAi[]
): { type: string; occurred_at: string } | null {
  const first = firstNAccountabilityOutcomes(eventsNewestFirst, 1)[0];
  if (!first) return null;
  return { type: first.event_type, occurred_at: first.occurred_at };
}

function hasBlockerCaptured(eventsNewestFirst: V2EventRowForAi[]): boolean {
  return eventsNewestFirst.some((e) => e.event_type === "blocker_captured");
}

function hasContractOverlayDeclined(eventsNewestFirst: V2EventRowForAi[]): boolean {
  return eventsNewestFirst.some((e) => e.event_type === "contract_overlay_declined");
}

/**
 * Priority: refresh → adaptation state → internal replace/tighten → strict reframe → keep.
 * Surfacing is gated separately via `EVOLUTION_V1_SURFACED_ACTIONS` + pending-row policy.
 */
export function evaluateCommitmentEvolutionV1(args: {
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst: V2EventRowForAi[];
  nowMs: number;
}): EvolutionV1EvaluationResult {
  const { commitment, eventsNewestFirst, nowMs } = args;
  const evidence: Record<string, unknown> = {
    engine_version: "v1",
    evaluated_at_ms: nowMs,
    rules: [] as string[],
  };

  if (isRefreshSessionActive(commitment)) {
    (evidence.rules as string[]).push("refresh_session_active");
    evidence.refresh_session_present = commitment.refresh_session != null;
    return {
      recommended_action: "refresh_commitment_only",
      evidence_json: evidence,
    };
  }

  if (isV2PendingProposalValid(commitment, nowMs) || isV2AdaptiveOverlayActive(commitment, nowMs)) {
    (evidence.rules as string[]).push("adaptive_overlay_or_proposal");
    evidence.adaptive_overlay_active = isV2AdaptiveOverlayActive(commitment, nowMs);
    evidence.adaptive_proposal_pending = isV2PendingProposalValid(commitment, nowMs);
    return {
      recommended_action: "adapt_commitment_temporary",
      evidence_json: evidence,
    };
  }

  const latest = latestAccountabilityOutcome(eventsNewestFirst);
  evidence.latest_outcome = latest?.type ?? null;
  evidence.latest_outcome_at = latest?.occurred_at ?? null;

  const noIn12 = countOutcomeTypeInFirstNOutcomes(eventsNewestFirst, "user_no", 12);
  evidence.user_no_count_last_12_outcomes = noIn12;
  const declined = hasContractOverlayDeclined(eventsNewestFirst);
  evidence.contract_overlay_declined_in_window = declined;

  if (noIn12 >= 3) {
    (evidence.rules as string[]).push("replace_three_user_no_last_12");
    return {
      recommended_action: "replace_commitment",
      evidence_json: evidence,
    };
  }

  if (noIn12 >= 2 && declined) {
    (evidence.rules as string[]).push("replace_stuck_after_declined_overlay");
    return {
      recommended_action: "replace_commitment",
      evidence_json: evidence,
    };
  }

  const partialIn12 = countOutcomeTypeInFirstNOutcomes(eventsNewestFirst, "user_partial", 12);
  evidence.user_partial_count_last_12_outcomes = partialIn12;
  const blocker = hasBlockerCaptured(eventsNewestFirst);
  evidence.blocker_captured_in_window = blocker;

  if (
    latest?.type === "user_partial" ||
    (latest?.type === "user_no" && blocker)
  ) {
    (evidence.rules as string[]).push("tighten_partial_or_no_with_blocker");
    return {
      recommended_action: "tighten_commitment",
      evidence_json: evidence,
    };
  }

  const negIn5 = countNegativeOutcomesInFirstN(eventsNewestFirst, 5);
  const noIn5 = countOutcomeTypeInFirstNOutcomes(eventsNewestFirst, "user_no", 5);
  const partialIn5 = countOutcomeTypeInFirstNOutcomes(eventsNewestFirst, "user_partial", 5);
  evidence.negative_outcomes_in_last_5 = negIn5;
  evidence.user_no_in_last_5 = noIn5;
  evidence.user_partial_in_last_5 = partialIn5;

  const latestNegative =
    latest?.type === "user_no" || latest?.type === "user_partial";
  const twoSoftPartialsOnly = partialIn5 >= 2 && noIn5 === 0 && negIn5 >= 2;

  if (
    latestNegative &&
    negIn5 >= 2 &&
    !twoSoftPartialsOnly
  ) {
    (evidence.rules as string[]).push("reframe_strict_last_5_negatives");
    return {
      recommended_action: "reframe_commitment",
      evidence_json: evidence,
    };
  }

  (evidence.rules as string[]).push("default_keep");
  return {
    recommended_action: "keep_commitment",
    evidence_json: evidence,
  };
}

/** Dashboard cards only for these actions. */
export const EVOLUTION_V1_SURFACED_ACTIONS: ReadonlySet<EvolutionV1RecommendedAction> = new Set([
  "refresh_commitment_only",
  "reframe_commitment",
]);

/**
 * Only these actions create / maintain a `pending` row. Others internal-only without pending churn.
 */
export const EVOLUTION_V1_PENDING_ROW_ACTIONS: ReadonlySet<EvolutionV1RecommendedAction> = new Set([
  "refresh_commitment_only",
  "reframe_commitment",
]);
