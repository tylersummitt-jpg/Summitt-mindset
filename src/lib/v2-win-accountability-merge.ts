/**
 * Item #2 — merge confirmed user_yes accountability Wins with OpenAI recognition.
 * Server owns whether the accountability Win exists; OpenAI may supply wording and
 * same-vs-distinct judgments for a second Win.
 */

import {
  WIN_FIELD_LIMITS,
  type WinCandidateV1,
  type WinRecognitionModeV1,
  type WinRecognitionResultV1,
  type WinRelationshipTypeV1,
} from "@/lib/openai-win-recognition-v1";
import {
  fallbackEquivalenceForRelationship,
  type WinEquivalenceJudgment,
} from "@/lib/openai-win-candidate-equivalence-v1";
import { limitWinDisplayTitleOrFallback } from "@/lib/v2-win-display-title";

export function buildAccountabilityWinIdempotencyKey(messageSid: string): string {
  const sid = messageSid.trim();
  if (!sid) throw new Error("acc_yes_idempotency_requires_message_sid");
  return `win_v1:acc_yes:${sid}`;
}

export function isGoalLinkedWinRelationship(rel: WinRelationshipTypeV1): boolean {
  return rel === "goal" || rel === "mixed";
}

export function isIndependentWinRelationship(rel: WinRelationshipTypeV1): boolean {
  return rel === "whole_life" || rel === "identity";
}

export type AccountabilityWinPresentation = {
  action_fact: string;
  why_meaningful: string | null;
  display_title: string;
  display_body: string;
  supporting_quote: string | null;
  relationship_type: "goal" | "mixed";
  recognition_mode: WinRecognitionModeV1;
  user_expressed_pride: boolean;
  identity_related: boolean;
  sensitivity_caution: boolean;
  celebration_appropriate: boolean;
  model_confidence: number | null;
  presentation_source: "recognized_goal_candidate" | "structural_fallback";
};

export type MergedInboundWinPlan = {
  accountability: AccountabilityWinPresentation | null;
  /**
   * Surviving DISTINCT second Win (any relationship_type), normalized to durable ordinal 1.
   * May be whole_life, identity, goal, or mixed.
   */
  independent: WinCandidateV1 | null;
  /** Candidates judged SAME as the accountability completion (suppressed as separate rows). */
  suppressed_same_candidate_count: number;
  /** @deprecated alias — same as suppressed_same_candidate_count for older tests */
  suppressed_goal_candidate_count: number;
  distinct_candidates_considered: number;
  /** @deprecated alias — distinct candidates considered */
  independent_candidates_considered: number;
};

function trimTo(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd();
}

function goalAnchorText(args: {
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
}): string {
  const ask = typeof args.effectiveAsk === "string" ? args.effectiveAsk.trim() : "";
  if (ask) return ask;
  const behavior =
    typeof args.behaviorStatement === "string" ? args.behaviorStatement.trim() : "";
  return behavior;
}

/**
 * Minimal grounded presentation when recognition did not supply a same completion Win.
 * Uses authoritative goal text only — no hype / "Win detected" copy.
 */
export function buildStructuralAccountabilityWinPresentation(args: {
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
}): AccountabilityWinPresentation {
  const goal = goalAnchorText(args);
  const action = goal
    ? trimTo(goal, WIN_FIELD_LIMITS.action_fact)
    : "Confirmed today's commitment follow-through";
  const title = goal
    ? limitWinDisplayTitleOrFallback(goal)
    : "Today's follow-through";
  const body = goal
    ? trimTo(goal, WIN_FIELD_LIMITS.display_body)
    : "You confirmed completing today's commitment.";

  return {
    action_fact: action,
    why_meaningful: null,
    display_title: title,
    display_body: body,
    supporting_quote: null,
    relationship_type: "goal",
    recognition_mode: "coach_recognized",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: true,
    model_confidence: null,
    presentation_source: "structural_fallback",
  };
}

function presentationFromGoalCandidate(
  candidate: WinCandidateV1
): AccountabilityWinPresentation {
  const supportingQuote = candidate.sensitivity_caution
    ? null
    : candidate.evidence_quote
      ? trimTo(candidate.evidence_quote, WIN_FIELD_LIMITS.supporting_quote)
      : null;

  return {
    action_fact: trimTo(candidate.grounded_action, WIN_FIELD_LIMITS.action_fact),
    why_meaningful: candidate.why_meaningful
      ? trimTo(candidate.why_meaningful, WIN_FIELD_LIMITS.why_meaningful)
      : null,
    display_title: limitWinDisplayTitleOrFallback(candidate.suggested_title),
    display_body: trimTo(candidate.suggested_body, WIN_FIELD_LIMITS.display_body),
    supporting_quote: supportingQuote,
    relationship_type: candidate.relationship_type === "mixed" ? "mixed" : "goal",
    recognition_mode: candidate.recognition_mode,
    user_expressed_pride: candidate.user_expressed_pride,
    identity_related: candidate.identity_related,
    sensitivity_caution: candidate.sensitivity_caution,
    celebration_appropriate: candidate.celebration_appropriate,
    model_confidence: candidate.model_confidence,
    presentation_source: "recognized_goal_candidate",
  };
}

function scoreWordingDonor(c: WinCandidateV1): number {
  const conf = typeof c.model_confidence === "number" ? c.model_confidence : 0;
  return conf * 10 - c.ordinal;
}

function scoreDistinctCandidate(c: WinCandidateV1): number {
  const typeBoost =
    c.relationship_type === "whole_life"
      ? 3
      : c.relationship_type === "identity"
        ? 2.5
        : c.relationship_type === "mixed"
          ? 1.5
          : 1;
  const conf = typeof c.model_confidence === "number" ? c.model_confidence : 0;
  return typeBoost * 10 + conf * 5 - c.ordinal;
}

function pickBest<T>(items: T[], score: (item: T) => number): T | null {
  if (items.length === 0) return null;
  let best = items[0]!;
  let bestScore = score(best);
  for (let i = 1; i < items.length; i++) {
    const item = items[i]!;
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

function resolveEquivalenceForCandidate(
  candidate: WinCandidateV1,
  equivalenceByOrdinal?: Record<number, WinEquivalenceJudgment> | null
): WinEquivalenceJudgment {
  const mapped = equivalenceByOrdinal?.[candidate.ordinal];
  if (mapped === "same" || mapped === "distinct") return mapped;
  return fallbackEquivalenceForRelationship(candidate.relationship_type);
}

/**
 * Merge confirmed user_yes with recognition candidates.
 *
 * Rules:
 * - user_yes → exactly one accountability Win (presentation may come from a SAME goal/mixed candidate)
 * - SAME candidates → suppressed as separate durable Wins (wording may transfer)
 * - at most one DISTINCT candidate survives as ordinal 1 (goal|mixed|identity|whole_life)
 * - max two durable Wins total
 *
 * Equivalence must come from OpenAI (or explicit test map). Missing map → relationship fallback
 * (whole_life/identity=distinct, goal/mixed=same). No regex/token-similarity heuristics.
 */
export function mergeInboundWinsForPersistence(args: {
  userYesConfirmed: boolean;
  recognition?: WinRecognitionResultV1 | null;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  /** same|distinct by recognition ordinal; omit to use relationship-type fallback */
  equivalenceByOrdinal?: Record<number, WinEquivalenceJudgment> | null;
}): MergedInboundWinPlan {
  const wins =
    args.recognition?.has_win && Array.isArray(args.recognition.wins)
      ? args.recognition.wins
      : [];

  if (!args.userYesConfirmed) {
    return {
      accountability: null,
      independent: null,
      suppressed_same_candidate_count: 0,
      suppressed_goal_candidate_count: 0,
      distinct_candidates_considered: 0,
      independent_candidates_considered: 0,
    };
  }

  const same: WinCandidateV1[] = [];
  const distinct: WinCandidateV1[] = [];
  for (const w of wins) {
    const eq = resolveEquivalenceForCandidate(w, args.equivalenceByOrdinal);
    if (eq === "distinct") distinct.push(w);
    else same.push(w);
  }

  const sameGoalLinked = same.filter((w) => isGoalLinkedWinRelationship(w.relationship_type));
  const bestSameGoal = pickBest(sameGoalLinked, scoreWordingDonor);
  const accountability = bestSameGoal
    ? presentationFromGoalCandidate(bestSameGoal)
    : buildStructuralAccountabilityWinPresentation({
        effectiveAsk: args.effectiveAsk,
        behaviorStatement: args.behaviorStatement,
      });

  const bestDistinct = pickBest(distinct, scoreDistinctCandidate);
  const normalizedDistinct: WinCandidateV1 | null = bestDistinct
    ? {
        ...bestDistinct,
        ordinal: 1,
      }
    : null;

  const suppressed = same.length;
  const distinctCount = distinct.length;

  return {
    accountability,
    independent: normalizedDistinct,
    suppressed_same_candidate_count: suppressed,
    suppressed_goal_candidate_count: suppressed,
    distinct_candidates_considered: distinctCount,
    independent_candidates_considered: distinctCount,
  };
}

/** Accountability action_fact used as equivalence context (structural or donor). */
export function accountabilityActionFactForEquivalence(args: {
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
}): string {
  return buildStructuralAccountabilityWinPresentation(args).action_fact;
}
