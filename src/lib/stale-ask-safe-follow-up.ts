/**
 * P0 Step A — safe recovery / outcome-close follow-ups exempt from stale-ask blocking.
 * Shared by inbound TU stale guard and daily stale-ask guard (via paraphraseRepeatsStaleCoachAsk).
 */

export function normalizeTextForStaleAskOverlap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const STALE_ASK_OVERLAP_STOP_WORDS = new Set([
  "your",
  "the",
  "for",
  "with",
  "that",
  "this",
  "have",
  "has",
  "will",
  "when",
  "where",
  "why",
  "how",
  "did",
  "does",
  "was",
  "were",
  "you",
  "ready",
  "about",
  "from",
  "into",
  "what",
  "would",
  "could",
  "should",
  "been",
  "they",
  "them",
  "then",
  "than",
  "also",
  "just",
  "like",
  "know",
  "tell",
  "let",
  "one",
]);

/** Recovery questions after explicit miss/partial — different coaching move than re-asking outcome. */
const RECOVERY_FOLLOW_UP_RES: ReadonlyArray<RegExp> = [
  /\bwhat (do you )?think led to (that|it)\b/i,
  /\bwhat led to (that|it)\b/i,
  /\bwhat got in the way\b/i,
  /\bwhat blocked (it|that)\b/i,
  /\bwhat stopped you\b/i,
  /\bwhat made it hard\b/i,
  /\bwhat contributed\b/i,
  /\bwhat happened (there|with that)\b/i,
  /\bwhat would help you recover\b/i,
  /\bwhat is the next honest step\b/i,
  /\bhow can you get back on track\b/i,
  /\bwhat would make tomorrow different\b/i,
];

/** Outcome-close after concrete plan detail — did the planned thing happen? */
const OUTCOME_CLOSE_FOLLOW_UP_RES: ReadonlyArray<RegExp> = [
  /\bdid the planned (action|block) happen\b/i,
  /\bdid the plan happen\b/i,
  /\bdid the call happen\b/i,
  /\bdid (that|the) conversation happen\b/i,
  /\bwere you able to\b/i,
  /\bdid you follow through\b/i,
  /\bdid (it|that) happen,?\s*or did something get in the way\b/i,
  /\bdid something get in the way\b/i,
  /\bwhat happened with the plan\b/i,
  /\bwhat happened with the call\b/i,
  /\bwhat got in the way of the plan\b/i,
  /\bor did something get in the way\b/i,
];

export function extractQuestionClausesForStaleAskGuard(body: string): string[] {
  const stripped = body
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
  const clauses = stripped.match(/[^?!.]+[?]/g) ?? [];
  if (clauses.length) return clauses.map((c) => c.trim()).filter(Boolean);
  if (/\?/.test(stripped)) return [stripped];
  return [];
}

export function isRecoveryOrOutcomeCloseFollowUp(proposedBody: string): boolean {
  const text = proposedBody.trim();
  if (!text || !/\?/.test(text)) return false;

  const targets = extractQuestionClausesForStaleAskGuard(text);
  const clauses = targets.length ? targets : [text];

  return clauses.some(
    (clause) =>
      RECOVERY_FOLLOW_UP_RES.some((rx) => rx.test(clause)) ||
      OUTCOME_CLOSE_FOLLOW_UP_RES.some((rx) => rx.test(clause))
  );
}

/** Conservative: candidate restates the same open ask frame as the prior coach line. */
export function isExactOrNearRepeatOfPriorCoachAsk(proposedBody: string, coachLine: string): boolean {
  const p = normalizeTextForStaleAskOverlap(proposedBody);
  const c = normalizeTextForStaleAskOverlap(coachLine);
  if (c.length < 12 || p.length < 8) return false;
  if (p === c) return true;
  if (p.includes(c) || c.includes(p)) return true;

  const cWords = c
    .split(" ")
    .filter((w) => w.length > 3 && !STALE_ASK_OVERLAP_STOP_WORDS.has(w));
  const pWords = new Set(
    p
      .split(" ")
      .filter((w) => w.length > 3 && !STALE_ASK_OVERLAP_STOP_WORDS.has(w))
  );
  if (!cWords.length) return false;

  let overlap = 0;
  for (const w of cWords) if (pWords.has(w)) overlap++;
  const ratio = overlap / cWords.length;

  const hasAskShape = /\?/.test(proposedBody);
  if (ratio >= 0.55 && hasAskShape) return true;
  if (p.includes(c.slice(0, Math.min(72, c.length)))) return true;
  return false;
}

export function isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk(
  proposedBody: string,
  coachLine: string
): boolean {
  if (!isRecoveryOrOutcomeCloseFollowUp(proposedBody)) return false;
  return !isExactOrNearRepeatOfPriorCoachAsk(proposedBody, coachLine);
}
