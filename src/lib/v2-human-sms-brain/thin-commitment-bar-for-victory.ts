/**
 * Heuristic for “thin” daily bars where Victory Room SMS callouts are suppressed
 * unless V2_PENDING_RESOLUTION_VICTORY_CALLOUT_ALLOWED is on (Phase 1).
 */

export function isThinCommitmentBarForVictoryCallout(cand: string): boolean {
  const t = cand.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (t.length <= 30 && t.split(/\s+/).filter(Boolean).length <= 4) return true;
  if (/^(?:\d{1,3}\s*(?:hours?|hrs?|minutes?|mins?))\s*$/i.test(t)) return true;
  return false;
}
