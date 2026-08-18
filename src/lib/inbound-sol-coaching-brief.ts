/**
 * Inbound Coaching Brief — six Morning sections plus compact inbound extras.
 * Persistence reads only inbound.accountability_interpretation, not prose most_alive.
 */

import {
  MORNING_COACHING_BRIEF_VERSION,
  parseMorningCoachingBriefV1,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";

export const INBOUND_SOL_ANSWER_PRIORITY = ["first", "normal", "unknown"] as const;
export type InboundSolAnswerPriority = (typeof INBOUND_SOL_ANSWER_PRIORITY)[number];

export const INBOUND_SOL_COACHING_AFTER_ANSWER = ["yes", "no", "unknown"] as const;
export type InboundSolCoachingAfterAnswer =
  (typeof INBOUND_SOL_COACHING_AFTER_ANSWER)[number];

export const INBOUND_SOL_BOOL_OR_UNKNOWN = [true, false, "unknown"] as const;
export type InboundSolBoolOrUnknown = boolean | "unknown";

export const INBOUND_SOL_ACCOUNTABILITY_RELEVANCE = [
  "central",
  "related",
  "unrelated",
  "unclear",
] as const;
export type InboundSolAccountabilityRelevance =
  (typeof INBOUND_SOL_ACCOUNTABILITY_RELEVANCE)[number];

export const INBOUND_SOL_ACCOUNTABILITY_OUTCOME = [
  "completed",
  "partial",
  "missed",
  "attempt",
  "plan",
  "unclear",
  "not_applicable",
] as const;
export type InboundSolAccountabilityOutcome =
  (typeof INBOUND_SOL_ACCOUNTABILITY_OUTCOME)[number];

export const INBOUND_SOL_CONFIDENCE = ["low", "medium", "high"] as const;
export type InboundSolConfidence = (typeof INBOUND_SOL_CONFIDENCE)[number];

export const INBOUND_SOL_WIN_RELATIONSHIP = [
  "goal",
  "mixed",
  "life",
  "unclear",
] as const;
export type InboundSolWinRelationship = (typeof INBOUND_SOL_WIN_RELATIONSHIP)[number];

export type InboundSolMeaningfulWin = {
  present: true;
  grounded_action: string;
  relationship: InboundSolWinRelationship;
};

export type InboundSolBriefExtras = {
  answer_priority: InboundSolAnswerPriority;
  coaching_after_answer: InboundSolCoachingAfterAnswer;
  user_is_correcting_coach: InboundSolBoolOrUnknown;
  accountability_interpretation: {
    relevance: InboundSolAccountabilityRelevance;
    outcome: InboundSolAccountabilityOutcome;
    confidence: InboundSolConfidence;
    evidence: string;
  };
  meaningful_win: InboundSolMeaningfulWin | null;
};

export type InboundCoachingBriefV1 = MorningCoachingBriefV1 & {
  inbound: InboundSolBriefExtras;
};

function isInSet<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function parseBoolOrUnknown(value: unknown): InboundSolBoolOrUnknown | null {
  if (value === true || value === false) return value;
  if (value === "unknown") return "unknown";
  return null;
}

export function parseInboundSolBriefExtras(raw: unknown): InboundSolBriefExtras | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (!isInSet(o.answer_priority, INBOUND_SOL_ANSWER_PRIORITY)) return null;
  if (!isInSet(o.coaching_after_answer, INBOUND_SOL_COACHING_AFTER_ANSWER)) return null;
  const user_is_correcting_coach = parseBoolOrUnknown(o.user_is_correcting_coach);
  if (user_is_correcting_coach == null) return null;

  const acc = o.accountability_interpretation;
  if (!acc || typeof acc !== "object" || Array.isArray(acc)) return null;
  const a = acc as Record<string, unknown>;
  if (!isInSet(a.relevance, INBOUND_SOL_ACCOUNTABILITY_RELEVANCE)) return null;
  if (!isInSet(a.outcome, INBOUND_SOL_ACCOUNTABILITY_OUTCOME)) return null;
  if (!isInSet(a.confidence, INBOUND_SOL_CONFIDENCE)) return null;
  if (typeof a.evidence !== "string") return null;
  const evidence = a.evidence.trim().slice(0, 400);

  let meaningful_win: InboundSolMeaningfulWin | null = null;
  if (o.meaningful_win != null) {
    if (typeof o.meaningful_win !== "object" || Array.isArray(o.meaningful_win)) return null;
    const w = o.meaningful_win as Record<string, unknown>;
    if (w.present !== true) return null;
    if (typeof w.grounded_action !== "string" || !w.grounded_action.trim()) return null;
    if (!isInSet(w.relationship, INBOUND_SOL_WIN_RELATIONSHIP)) return null;
    meaningful_win = {
      present: true,
      grounded_action: w.grounded_action.trim().slice(0, 240),
      relationship: w.relationship,
    };
  }

  return {
    answer_priority: o.answer_priority,
    coaching_after_answer: o.coaching_after_answer,
    user_is_correcting_coach,
    accountability_interpretation: {
      relevance: a.relevance,
      outcome: a.outcome,
      confidence: a.confidence,
      evidence,
    },
    meaningful_win,
  };
}

export function parseInboundCoachingBriefV1(raw: unknown): InboundCoachingBriefV1 | null {
  const morning = parseMorningCoachingBriefV1(raw);
  if (!morning) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const extras = parseInboundSolBriefExtras((raw as Record<string, unknown>).inbound);
  if (!extras) return null;
  return { ...morning, inbound: extras };
}

export function compactInboundSolBriefForTelemetry(
  brief: InboundCoachingBriefV1
): Record<string, unknown> {
  return {
    inbound_sol_brief_version: MORNING_COACHING_BRIEF_VERSION,
    inbound_sol_primary_move: brief.coaching_direction.primary_move,
    inbound_sol_goal_role: brief.goal_role_today.role,
    inbound_sol_answer_priority: brief.inbound.answer_priority,
    inbound_sol_coaching_after_answer: brief.inbound.coaching_after_answer,
    inbound_sol_user_is_correcting_coach: brief.inbound.user_is_correcting_coach,
    inbound_sol_accountability_relevance: brief.inbound.accountability_interpretation.relevance,
    inbound_sol_accountability_outcome: brief.inbound.accountability_interpretation.outcome,
    inbound_sol_accountability_confidence: brief.inbound.accountability_interpretation.confidence,
    inbound_sol_meaningful_win_relationship:
      brief.inbound.meaningful_win?.relationship ?? null,
    inbound_sol_most_alive_preview:
      typeof brief.human_situation.most_alive === "string"
        ? brief.human_situation.most_alive.slice(0, 160)
        : brief.human_situation.most_alive,
  };
}
