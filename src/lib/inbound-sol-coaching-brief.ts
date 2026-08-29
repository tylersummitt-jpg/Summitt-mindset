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

export const INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE = [
  "yes",
  "no",
  "unknown",
] as const;
export type InboundSolRequiresPatPersonalKnowledge =
  (typeof INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE)[number];

export const DEFAULT_INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE =
  "unknown" as const satisfies InboundSolRequiresPatPersonalKnowledge;

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

export type InboundSolDurableUserEvidence = {
  exact_user_evidence: string;
};

export const DURABLE_USER_EVIDENCE_PARSER_MAX_CHARS = 400 as const;

export const INBOUND_SOL_PENDING_PHOTO_RELATION = [
  "none",
  "uncertain",
  "current_turn_win",
  "existing_win",
] as const;
export type InboundSolPendingPhotoRelationKind =
  (typeof INBOUND_SOL_PENDING_PHOTO_RELATION)[number];

export type InboundSolPendingPhotoRelation = {
  relation: InboundSolPendingPhotoRelationKind;
  target_win_id: string | null;
};

export const EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION: InboundSolPendingPhotoRelation = {
  relation: "none",
  target_win_id: null,
};

/** Matches v2_win.display_title CHECK / WIN_FIELD_LIMITS.display_title. */
export const SOL_TROPHY_TITLE_MAX_CHARS = 80 as const;

export type InboundSolWinPresentation = {
  accountability_trophy_title: string | null;
  life_trophy_title: string | null;
};

export const EMPTY_INBOUND_SOL_WIN_PRESENTATION: InboundSolWinPresentation = {
  accountability_trophy_title: null,
  life_trophy_title: null,
};

export type InboundSolBriefExtras = {
  answer_priority: InboundSolAnswerPriority;
  coaching_after_answer: InboundSolCoachingAfterAnswer;
  /**
   * Whether a truthful answer to the newest inbound requires Pat Summitt
   * autobiographical / historical fact. Parser defaults missing to unknown.
   */
  requires_pat_personal_knowledge: InboundSolRequiresPatPersonalKnowledge;
  user_is_correcting_coach: InboundSolBoolOrUnknown;
  accountability_interpretation: {
    relevance: InboundSolAccountabilityRelevance;
    outcome: InboundSolAccountabilityOutcome;
    confidence: InboundSolConfidence;
    evidence: string;
  };
  meaningful_win: InboundSolMeaningfulWin | null;
  pending_photo_relation: InboundSolPendingPhotoRelation;
  durable_user_evidence: InboundSolDurableUserEvidence | null;
  /** Display-only. Never Win truth. Parser defaults when missing/malformed. */
  win_presentation: InboundSolWinPresentation;
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

/**
 * Missing / undefined → unknown (fail closed; no retrieval in later commits).
 * Invalid explicit value → null so the extras parse fails (interpreter retry).
 */
function parseRequiresPatPersonalKnowledge(
  value: unknown
): InboundSolRequiresPatPersonalKnowledge | null {
  if (value === undefined) return DEFAULT_INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE;
  if (!isInSet(value, INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE)) return null;
  return value;
}

export function parseInboundSolBriefExtras(raw: unknown): InboundSolBriefExtras | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (!isInSet(o.answer_priority, INBOUND_SOL_ANSWER_PRIORITY)) return null;
  if (!isInSet(o.coaching_after_answer, INBOUND_SOL_COACHING_AFTER_ANSWER)) return null;
  const requires_pat_personal_knowledge = parseRequiresPatPersonalKnowledge(
    o.requires_pat_personal_knowledge
  );
  if (requires_pat_personal_knowledge == null) return null;
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
    requires_pat_personal_knowledge,
    user_is_correcting_coach,
    accountability_interpretation: {
      relevance: a.relevance,
      outcome: a.outcome,
      confidence: a.confidence,
      evidence,
    },
    meaningful_win,
    pending_photo_relation: parsePendingPhotoRelation(o.pending_photo_relation),
    durable_user_evidence: parseDurableUserEvidence(o.durable_user_evidence),
    win_presentation: parseWinPresentation(o.win_presentation),
  };
}

function parseDurableUserEvidence(raw: unknown): InboundSolDurableUserEvidence | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.exact_user_evidence !== "string") return null;
  const excerpt = o.exact_user_evidence;
  if (excerpt.length === 0) return null;
  if (excerpt.length > DURABLE_USER_EVIDENCE_PARSER_MAX_CHARS) return null;
  return { exact_user_evidence: excerpt };
}

/**
 * Shape-only trophy title validator. No grammar, no banned-word list, no conjugator.
 * Invalid or >80 after trim → null (caller falls back). Never slice mid-word.
 */
export function normalizeSolTrophyTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  const collapsed = raw.replace(/ +/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length > SOL_TROPHY_TITLE_MAX_CHARS) return null;
  return collapsed;
}

function parseWinPresentation(raw: unknown): InboundSolWinPresentation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_INBOUND_SOL_WIN_PRESENTATION };
  }
  const o = raw as Record<string, unknown>;
  return {
    accountability_trophy_title: normalizeSolTrophyTitle(o.accountability_trophy_title),
    life_trophy_title: normalizeSolTrophyTitle(o.life_trophy_title),
  };
}

function parsePendingPhotoRelation(raw: unknown): InboundSolPendingPhotoRelation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION;
  }
  const o = raw as Record<string, unknown>;
  if (!isInSet(o.relation, INBOUND_SOL_PENDING_PHOTO_RELATION)) {
    return EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION;
  }
  let target_win_id: string | null = null;
  if (typeof o.target_win_id === "string" && o.target_win_id.trim()) {
    target_win_id = o.target_win_id.trim();
  }
  if (o.relation !== "existing_win") {
    return { relation: o.relation, target_win_id: null };
  }
  return { relation: "existing_win", target_win_id };
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
    inbound_sol_requires_pat_personal_knowledge:
      brief.inbound.requires_pat_personal_knowledge,
    inbound_sol_user_is_correcting_coach: brief.inbound.user_is_correcting_coach,
    inbound_sol_accountability_relevance: brief.inbound.accountability_interpretation.relevance,
    inbound_sol_accountability_outcome: brief.inbound.accountability_interpretation.outcome,
    inbound_sol_accountability_confidence: brief.inbound.accountability_interpretation.confidence,
    inbound_sol_meaningful_win_relationship:
      brief.inbound.meaningful_win?.relationship ?? null,
    inbound_sol_durable_user_evidence_returned:
      brief.inbound.durable_user_evidence != null,
    inbound_sol_pending_photo_relation: brief.inbound.pending_photo_relation.relation,
    inbound_sol_most_alive_preview:
      typeof brief.human_situation.most_alive === "string"
        ? brief.human_situation.most_alive.slice(0, 160)
        : brief.human_situation.most_alive,
  };
}
