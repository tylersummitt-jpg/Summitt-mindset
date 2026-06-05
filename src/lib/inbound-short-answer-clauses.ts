/**
 * Clause-level inbound analysis — compound messages may carry plan + outcome in separate clauses.
 */

import {
  extractCompletionDisqualifiers,
  hasFuturePlanIntentLanguage,
} from "@/lib/pending-plan-proof";

export type InboundClauseOutcomeKind =
  | "completion"
  | "miss"
  | "partial"
  | "plan_intent"
  | "neutral";

export type InboundClauseAnalysis = {
  text: string;
  outcome_kind: InboundClauseOutcomeKind;
  disqualifiers: string[];
};

const CLAUSE_SPLIT_RE =
  /[!.;]+|\s+and\s+also\s+|\s+i\s+also\s+|\s+but\s+|\s+however\s+/i;

export function splitInboundClauses(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [t];
}

function clauseHasExplicitCompletion(clause: string): boolean {
  const t = clause.trim();
  if (!t || extractCompletionDisqualifiers(t).length > 0) return false;
  if (/\b(got\s+my|got\s+(the\s+)?\d+|reached|hit\s+my)\b[^.!?]{0,48}\b(steps|hours|calls|reps?|workout)\b/i.test(t)) {
    return true;
  }
  if (/\b(got\s+my\s+[^.!?]{2,40}\s+in\s+today)\b/i.test(t)) return true;
  if (/\b(i\s+)?(did\s+it|got\s+it\s+done|finished|completed|knocked\s+it\s+out)\b/i.test(t)) {
    if (/\b(did not|didn't|almost|wish|plan to)\b/i.test(t)) return false;
    return true;
  }
  if (/\b(i\s+)?did\s+(the\s+|my\s+)?\w+/i.test(t) && /\b(today|this morning|tonight)\b/i.test(t)) {
    return true;
  }
  if (/\b(completed|finished)\s+(my\s+|the\s+)?/i.test(t) && /\b(today|this morning)\b/i.test(t)) {
    return true;
  }
  return false;
}

function clauseHasExplicitMiss(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (/\b(didn'?t|did not|didnt|never|not done|haven'?t|have not|missed|wasn'?t able|couldn'?t)\b/i.test(t)) {
    return true;
  }
  if (/^(no|nope|nah)\b/i.test(t) && /\b(miss|didn'?t|not)\b/i.test(t)) return true;
  return false;
}

function clauseHasExplicitPartial(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (/\b(almost|halfway|partially|part of|not finished|only did part)\b/i.test(t)) return true;
  if (/\bhalf\b/i.test(t) && /\b(done|got|did)\b/i.test(t)) return true;
  if (/\bstarted\s+but\b/i.test(t)) return true;
  if (/\btried\s+but\b/i.test(t) && /\b(couldn'?t|could not|didn'?t|did not)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function analyzeInboundClause(clause: string): InboundClauseAnalysis {
  const text = clause.trim();
  const disqualifiers = extractCompletionDisqualifiers(text);

  if (clauseHasExplicitPartial(text)) {
    return { text, outcome_kind: "partial", disqualifiers };
  }
  if (clauseHasExplicitMiss(text)) {
    return { text, outcome_kind: "miss", disqualifiers };
  }
  if (clauseHasExplicitCompletion(text)) {
    return { text, outcome_kind: "completion", disqualifiers };
  }
  if (hasFuturePlanIntentLanguage(text) || /\b(i will continue|that works|sounds good)\b/i.test(text)) {
    return { text, outcome_kind: "plan_intent", disqualifiers };
  }
  return { text, outcome_kind: "neutral", disqualifiers };
}

export function analyzeInboundClauses(text: string): InboundClauseAnalysis[] {
  return splitInboundClauses(text).map(analyzeInboundClause);
}

export function inboundHasExplicitCompletionClause(text: string): boolean {
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "completion");
}

export function inboundHasExplicitPartialClause(text: string): boolean {
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "partial");
}

export function inboundHasExplicitMissClause(text: string): boolean {
  if (inboundHasExplicitPartialClause(text)) return false;
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "miss");
}

export function inboundHasPlanConfirmationClause(text: string): boolean {
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "plan_intent");
}

export function strongestExplicitOutcomeClause(
  text: string
): InboundClauseAnalysis | null {
  const clauses = analyzeInboundClauses(text);
  const completion = clauses.find((c) => c.outcome_kind === "completion");
  if (completion) return completion;
  const miss = clauses.find((c) => c.outcome_kind === "miss");
  if (miss) return miss;
  const partial = clauses.find((c) => c.outcome_kind === "partial");
  if (partial) return partial;
  return null;
}
