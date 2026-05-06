/**
 * Shared SMS copy quality checks (wording only; no I/O).
 * Used by inbound/outbound AI validation and overlay-decline ack.
 */

/** Judgmental or moralizing phrasing for overlay "no" acknowledgements. */
const OVERLAY_DECLINE_JUDGMENT_PATTERNS: readonly RegExp[] = [
  /\bchosen not to\b/i,
  /\byou chose not\b/i,
  /\bchose not to hold\b/i,
  /\bnot hold the same standard\b/i,
  /\blower standard\b/i,
  /\bless committed\b/i,
  /\bdeclined the standard\b/i,
  /\bdon'?t want to hold yourself accountable\b/i,
  /\byou failed\b/i,
];

/** Shelly-style moralizing ("I see you've chosen…"). */
const OVERLAY_DECLINE_MORALIZING: readonly RegExp[] = [
  /\bI see you('?ve| have) chosen\b/i,
  /\bnot to hold the same standard\b/i,
  /\bchosen not to hold\b/i,
  /\bdeclin(e|ed) (the |your )?standard\b/i,
];

const OVERLAY_DECLINE_INTERNAL_SUBSTRINGS: readonly string[] = [
  "overlay",
  "contract proposal",
  "pending resolution",
  "v2",
  "event spine",
  "commitment event",
  "accountability system",
  "adaptive overlay",
  "database",
  "supabase",
];

/** Weak motivational filler — discouraged for Pat-style coach SMS. */
const WEAK_GENERIC_PHRASES: readonly RegExp[] = [
  /\bgreat job\b/i,
  /\bkeep pushing forward\b/i,
  /\bkeep building momentum\b/i,
  /\byou'?ve got this\b/i,
  /\bkeep it up\b/i,
  /\blet'?s aim for\b/i,
  /\bthat'?s progress\b/i,
  /\bnice work\b/i,
  /\bawesome job\b/i,
];

/**
 * Returns null if OK, else a short reason string for validation failures.
 */
export function overlayDeclinedAckFailsQualityScan(message: string): string | null {
  const t = (message || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  for (const re of OVERLAY_DECLINE_MORALIZING) {
    if (re.test(t)) return "overlay_decline_judgment_tone";
  }
  for (const re of OVERLAY_DECLINE_JUDGMENT_PATTERNS) {
    if (re.test(t)) return "overlay_decline_judgment_tone";
  }
  for (const s of OVERLAY_DECLINE_INTERNAL_SUBSTRINGS) {
    if (lower.includes(s)) return "overlay_decline_internal_term";
  }
  if (/\b(this|the) proposal\b/i.test(t)) return "overlay_decline_internal_term";
  return null;
}

/** Generic cheerlead lines — validation rejects model output using these cheap fillers. */
export function weakGenericMotivationalPhraseFailReason(message: string): string | null {
  const t = (message || "").trim();
  if (!t) return null;
  for (const re of WEAK_GENERIC_PHRASES) {
    if (re.test(t)) return "weak_generic_motivation";
  }
  return null;
}

/** Internal product jargon in user-visible coach SMS (additional to banned-internal-terms). */
export function internalCoachJargonFailReason(message: string): string | null {
  const m = (message || "").trim();
  if (!m) return null;
  const jargonRes: readonly RegExp[] = [
    /\bevent spine\b/i,
    /\bcommitment event\b/i,
    /\baccountability system\b/i,
    /\bpending resolution\b/i,
    /\bcontract overlay\b/i,
    /\bv2\b/i,
  ];
  for (const re of jargonRes) {
    if (re.test(m)) return "internal_jargon";
  }
  if (/\bas an ai\b/i.test(m)) return "internal_jargon";
  return null;
}

/** User is asking about proof logging / Victory Room — allow those words in validator. */
export function userInboundAsksVictoryRoomProofLog(raw: string): boolean {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return false;
  if (/\bvictory\s+room\b/i.test(raw)) return true;
  if (/\bvictory\s+log\b/i.test(raw)) return true;
  if (/\bproof\b/.test(t) && /\b(log|record|save|put|count|track)/.test(t)) return true;
  if (/\bwill you\b/.test(t) && /\b(log|put|save|count)/.test(t)) return true;
  if (/\bdoes (that|this|it) count\b/i.test(raw)) return true;
  return false;
}
