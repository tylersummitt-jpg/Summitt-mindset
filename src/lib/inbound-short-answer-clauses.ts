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

const NEWLINE_CLAUSE_SPLIT_RE = /\r?\n+/;

/** Explicit step-count completion — shared by clause analysis and reported-completion candidate. */
export function clauseMatchesExplicitStepCountCompletion(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (/\b(hit|reached|got)\s+[\d,.]+\s+steps\b/i.test(t)) return true;
  if (/\bgot\s+my\s+step\s+goal\b/i.test(t)) return true;
  return false;
}

function splitSegmentIntoClauses(segment: string): string[] {
  const t = segment.trim();
  if (!t) return [];
  const parts = t
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [t];
}

export function splitInboundClauses(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const newlineSegments = t
    .split(NEWLINE_CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const segments = newlineSegments.length > 0 ? newlineSegments : [t];
  const parts: string[] = [];
  for (const segment of segments) {
    parts.push(...splitSegmentIntoClauses(segment));
  }
  return parts.length > 0 ? parts : [t];
}

function clauseHasExplicitCompletion(clause: string): boolean {
  const t = clause.trim();
  if (!t || extractCompletionDisqualifiers(t).length > 0) return false;
  if (looksLikeFutureOrConditionalCompletionLanguage(t)) return false;
  if (/\bhit\s+(the|my|today'?s?)\s+goal\b/i.test(t)) return true;
  if (/\bgot\s+(the\s+)?goal\s+done\b/i.test(t)) return true;
  if (/\bgot\s+my\s+[\w',-]{2,48}\s+done(\s+today)?\b/i.test(t)) return true;
  if (/\b(got\s+my|got\s+(the\s+)?\d+|reached|hit\s+my)\b[^.!?]{0,48}\b(steps|hours|calls|reps?|workout)\b/i.test(t)) {
    return true;
  }
  if (/\bgot\s+my\s+[\d,.]+\s+steps\b/i.test(t)) return true;
  if (clauseMatchesExplicitStepCountCompletion(t)) return true;
  if (/\bwalked\s+[\d,.]+\s+steps\b/i.test(t)) return true;
  if (/\bgot\s+my\s+(steps|run|walk|workout|calls|distribution|mileage)\s+in\b/i.test(t)) {
    return true;
  }
  if (/\bgot\s+my\s+[\d,.]+\s+miles?\s+in\b/i.test(t)) return true;
  if (/\bgot\s+in\s+[\d,.]+\s+miles?\b/i.test(t)) return true;
  if (/\bgot\s+(the\s+)?[\d,.]+\s+miles?\s+done\b/i.test(t)) return true;
  if (/\b(got\s+my\s+[^.!?]{2,40}\s+in\s+today)\b/i.test(t)) return true;
  if (/\b(i\s+)?did\s+it\s+before\b/i.test(t)) return true;
  if (/\bcompleted\s+(my\s+[\w',-]+|today'?s?\s+commitment)\b/i.test(t)) return true;
  if (/\bfinished\s+(my\s+[\w',-]+|another)\b/i.test(t)) return true;
  if (/\bdid\s+my\s+hour\b/i.test(t)) return true;
  if (/\b(just\s+)?finished\s+another\b/i.test(t)) return true;
  if (/^(done|completed)\.?$/i.test(t)) return true;
  if (/\b(i\s+)?(did\s+it|got\s+it\s+done|finished|completed|knocked\s+it\s+out)\b/i.test(t)) {
    if (/\b(did not|didn't|almost|wish|plan to)\b/i.test(t)) return false;
    return true;
  }
  if (/\bi\s+did\s+\d+\s+minutes?\s+of\s+onboarding\b/i.test(t)) return false;
  if (/\bonboarding\b/i.test(t) && !/\b(hit|goal|steps|commitment|workout|run|walk)\b/i.test(t)) {
    return false;
  }
  if (/\b(i\s+)?did\s+(the\s+|my\s+)?\w+/i.test(t) && /\b(today|this morning|tonight)\b/i.test(t)) {
    return true;
  }
  if (/\b(completed|finished)\s+(my\s+|the\s+)?/i.test(t) && /\b(today|this morning)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Future confidence / intent to complete — not proof of completed-today. */
export function looksLikeFutureOrConditionalCompletionLanguage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bshould\s+(still\s+)?be\s+able\s+to\b/i.test(t)) return true;
  if (/\b(might|may|could|would|hope\s+to|try\s+to)\s+(still\s+)?(hit|get|finish|complete)\b/i.test(t)) {
    return true;
  }
  if (/\b(i'?ll|i will|going to|gonna|plan to)\b[^.!?]{0,40}\b(hit|get|finish|complete|done)\b/i.test(t)) {
    return true;
  }
  if (/\b(haven'?t|have not)\s+hit\b/i.test(t)) return true;
  if (/\bnot\s+yet\b/i.test(t) && /\b(hit|done|finish|complete)\b/i.test(t)) return true;
  if (/\b(get|hit)\s+it\s+done\s+later\b/i.test(t)) return true;
  if (/\bhit\s+the\s+goals?\b/i.test(t) && /\b(should|will|going to|gonna|thursday|tomorrow|later)\b/i.test(t)) {
    return true;
  }
  return false;
}

const SPEECH_META_AFTER_NEGATION_RE =
  /\b(didn'?t|did not|didnt|never)\s+(say|said|mean|meant|promise|promised|agree|agreed|tell|told|mention|mentioned)\b/i;

const ACCOUNTABILITY_MISS_IDIOMS_RE =
  /\b(missed\s+(it|my\s+goal)|failed\s+today|skipped\s+it|didn'?t\s+happen|wasn'?t\s+able|couldn'?t\s+get\s+it\s+done|not\s+done|haven'?t|have\s+not)\b/i;

const ACCOUNTABILITY_ACTION_AFTER_NEGATION_RE =
  /\b(didn'?t|did not|didnt)\s+(do|finish|complete|hit|make|run|walk|workout|work\s+out|get|follow\s+through|follow\s+up|call|write|read|practice|show\s+up)\b/i;

function clauseHasSpeechMetaNegation(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (SPEECH_META_AFTER_NEGATION_RE.test(t)) return true;
  if (/\b(that'?s\s+not\s+what\s+i\s+said|not\s+what\s+i\s+meant)\b/i.test(t)) return true;
  return false;
}

function clauseHasExplicitMiss(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (clauseHasSpeechMetaNegation(t)) return false;
  if (ACCOUNTABILITY_MISS_IDIOMS_RE.test(t)) return true;
  if (ACCOUNTABILITY_ACTION_AFTER_NEGATION_RE.test(t)) return true;
  if (/\b(missed|wasn'?t able|couldn'?t)\b/i.test(t)) return true;
  if (/\bnever\b/i.test(t) && !/\bnever\s+(said|meant)\b/i.test(t)) return true;
  // Do not treat bare "not" as a miss ("No, that's not right" is correction, not accountability).
  if (
    /^(no|nope|nah)\b/i.test(t) &&
    /\b(miss|didn'?t|did not|not done|haven'?t|have not)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Stale-goal / goal-mismatch / "wrong ask" correction language — not an accountability miss.
 * Prefer this over classifier leading-"No" when deciding failed-safe persistence.
 */
export function looksLikeStaleGoalOrContextCorrection(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (inboundHasExplicitAccountabilityMissClause(t)) return false;

  return (
    /\bwrong\b/i.test(t) ||
    /\bnot\s+my\s+goal\b/i.test(t) ||
    /\bremoved\s+this\s+(accountability\s+)?goal\b/i.test(t) ||
    /\bwe\s+removed\s+this\b/i.test(t) ||
    /\bchanged\s+this\s+goal\b/i.test(t) ||
    /\balready\s+changed\s+this\b/i.test(t) ||
    /\bthat'?s\s+not\s+right\b/i.test(t) ||
    /\bthat\s+is\s+not\s+right\b/i.test(t) ||
    /\bincorrect\s+goal\b/i.test(t) ||
    /\bold\s+goal\b/i.test(t) ||
    /\bstale\s+goal\b/i.test(t) ||
    /\bthat\s+is\s+not\s+the\s+goal\b/i.test(t) ||
    /\bthat'?s\s+not\s+the\s+goal\b/i.test(t) ||
    /\bthat'?s\s+not\s+my\s+(accountability\s+)?goal\b/i.test(t) ||
    /\bthat\s+is\s+not\s+my\s+(accountability\s+)?goal\b/i.test(t) ||
    /\bnot\s+my\s+(accountability\s+)?goal\s+anymore\b/i.test(t) ||
    /\bgoal\s+anymore\b/i.test(t)
  );
}

/** Onboarding / coach-process dispute — not an accountability miss. */
export function looksLikeOnboardingProcessDispute(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return (
    /\b(did|does)\s+(the|my)\s+onboarding\s+matter\b/i.test(t) ||
    /\bonboarding\s+matter\b/i.test(t) ||
    /\bwhat\s+i\s+chose\s+in\s+onboarding\b/i.test(t) ||
    /\bmy\s+onboarding\s+answers?\b/i.test(t) ||
    /\b(didn'?t|did not)\s+ask\s+(me\s+)?(anything\s+)?about\s+(what\s+i\s+chose|onboarding|my\s+onboarding)/i.test(
      t
    ) ||
    /\bwhy\s+(didn'?t|did not)\s+you\s+ask\s+me\s+about\s+(onboarding|my\s+onboarding)/i.test(t) ||
    /\bwhy\s+did\s+you\s+not\s+ask\s+me\s+about\s+(onboarding|my\s+onboarding)/i.test(t) ||
    (/\bonboarding\b/i.test(t) &&
      /\b(you\s+(didn'?t|did not)\s+ask|didn'?t\s+ask\s+me|did\s+not\s+ask\s+me)\b/i.test(t))
  );
}

/** Coach disputing prior coach wording or process — not an accountability miss. */
export function looksLikeCoachContextCorrectionOrMetaDispute(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (inboundHasExplicitAccountabilityMissClause(t)) return false;

  if (looksLikeOnboardingProcessDispute(t)) return true;
  if (looksLikeStaleGoalOrContextCorrection(t)) return true;

  return (
    /\b(didn'?t|did not|didnt)\s+say\b/i.test(t) ||
    /\bnever\s+said\b/i.test(t) ||
    /\b(didn'?t|did not)\s+mean\b/i.test(t) ||
    /\bthat'?s\s+not\s+what\s+i\s+said\b/i.test(t) ||
    /\bnot\s+what\s+i\s+meant\b/i.test(t) ||
    /\bwhy\s+did\s+you\s+(say|ask)\b/i.test(t) ||
    /\bwhere\s+did\s+you\s+get\s+that\b/i.test(t) ||
    /\b(was\s+)?wondering\s+why\s+you\s+(asked|said)\b/i.test(t) ||
    /\byou\s+misunderstood\b/i.test(t) ||
    /\bno,?\s+i\s+was\s+asking\s+why\b/i.test(t) ||
    /\bi'?m\s+correcting\s+you\b/i.test(t) ||
    /\b(didn'?t|did not)\s+say\s+i\s+would\b/i.test(t) ||
    /\b(didn'?t|did not)\s+say\s+that\b/i.test(t) ||
    /\byou\s+(didn'?t|did not)\s+ask\b/i.test(t) ||
    /\b(didn'?t|did not)\s+ask\s+me\b/i.test(t) ||
    /\b(didn'?t|did not)\s+ask\s+(me\s+)?anything\s+about\b/i.test(t) ||
    /\byou\s+(didn'?t|did not)\s+ask\s+me\s+anything\s+about\s+what\s+i\s+chose\b/i.test(t) ||
    /\b(didn'?t|did not)\s+ask\s+about\s+what\s+i\s+chose\b/i.test(t)
  );
}

/** Narrow miss: accountability action/idiom only — excludes "did not say/mean". */
export function inboundHasExplicitAccountabilityMissClause(text: string): boolean {
  if (inboundHasExplicitPartialClause(text)) return false;
  if (/\bstarted\s+but\b/i.test(text)) return false;
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "miss");
}

function clauseHasExplicitPartial(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (/\b(almost|halfway|partially|part of|not finished|only did part|some of it|got some of it done|started it|not all of it)\b/i.test(t)) {
    return true;
  }
  if (/\bgot part of it done\b/i.test(t)) return true;
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
  return inboundHasExplicitAccountabilityMissClause(text);
}

export function inboundHasPlanConfirmationClause(text: string): boolean {
  return analyzeInboundClauses(text).some((c) => c.outcome_kind === "plan_intent");
}

export function inboundExplicitOutcomeDetected(text: string): boolean {
  return (
    inboundHasExplicitCompletionClause(text) ||
    inboundHasExplicitMissClause(text) ||
    inboundHasExplicitPartialClause(text)
  );
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
