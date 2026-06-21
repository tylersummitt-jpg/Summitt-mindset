/**
 * Post-writer seatbelt — blocks unsupported consistency/commitment praise on daily SMS.
 */

import type { DailyProofCalibration } from "@/lib/sms-daily-proof-calibration";

export type DailyUnsupportedPraiseViolation = {
  phrase: string;
  reason: "unsupported_consistency_praise" | "unsupported_strong_commitment" | "stale_recent_wording";
};

const STRONG_COMMITMENT_RES: RegExp[] = [
  /\bgreat\s+commitment\b/i,
  /\bstrong\s+commitment\b/i,
  /\bshown\s+great\s+commitment\b/i,
  /\bshown\s+strong\s+commitment\b/i,
  /\bgreat\s+follow[\s-]?through\b/i,
  /\bstrong\s+follow[\s-]?through\b/i,
];

const CONSISTENCY_RES: RegExp[] = [
  /\bbeen\s+consistent\b/i,
  /\bconsistently\b/i,
  /\bon\s+a\s+roll\b/i,
  /\bdominating\b/i,
  /\bcrushing\s+it\b/i,
  /\bkept\s+showing\s+up\b/i,
  /\bkept\s+hitting\b/i,
  /\bbeen\s+hitting\s+this\b/i,
  /\bshown\s+commitment\b/i,
  /\byou'?ve\s+shown\s+commitment\b/i,
];

const STALE_RECENT_RES: RegExp[] = [
  /\brecently\s+(?:completed|finished|did|got|hit)\b/i,
  /\bjust\s+(?:completed|finished|did|got|hit)\b/i,
  /\byesterday\s+(?:you|completed|finished|did|got|hit)\b/i,
  /\btoday\s+(?:you|completed|finished|did|got|hit)\b/i,
];

/** Allowed weak-proof capability phrasing — not violations. */
const CAPABILITY_ALLOW_RES: RegExp[] = [
  /\bshown\s+you\s+can\s+do\s+it\b/i,
  /\bcan\s+do\s+it\b/i,
  /\bone\s+honest\s+win\b/i,
  /\bthe\s+job\s+(?:now\s+is|is)\b/i,
];

function matchesAny(body: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = body.match(re);
    if (m?.[0]) return m[0];
  }
  return null;
}

function isCapabilityAllowed(body: string): boolean {
  return CAPABILITY_ALLOW_RES.some((re) => re.test(body));
}

export function detectDailyUnsupportedPraiseViolation(args: {
  body: string;
  calibration: DailyProofCalibration | null | undefined;
}): DailyUnsupportedPraiseViolation | null {
  const body = args.body.trim();
  const cal = args.calibration;
  if (!body || !cal) return null;

  if (!cal.strong_commitment_claim_allowed) {
    const hit = matchesAny(body, STRONG_COMMITMENT_RES);
    if (hit && !isCapabilityAllowed(body)) {
      return { phrase: hit, reason: "unsupported_strong_commitment" };
    }
  }

  if (!cal.consistency_claim_allowed) {
    const hit = matchesAny(body, CONSISTENCY_RES);
    if (hit && !isCapabilityAllowed(body)) {
      return { phrase: hit, reason: "unsupported_consistency_praise" };
    }
  }

  if (cal.proof_age_days != null && cal.proof_age_days > 1 && !cal.recent_completion_claim_allowed) {
    const hit = matchesAny(body, STALE_RECENT_RES);
    if (hit) {
      return { phrase: hit, reason: "stale_recent_wording" };
    }
  }

  if (cal.proof_age_days != null && cal.proof_age_days >= 3) {
    if (/\brecently\b/i.test(body) && !isCapabilityAllowed(body)) {
      return { phrase: "recently", reason: "stale_recent_wording" };
    }
  }

  return null;
}

export function dailyUnsupportedPraiseTelemetry(
  violation: DailyUnsupportedPraiseViolation,
  cal: DailyProofCalibration
): Record<string, unknown> {
  return {
    daily_unsupported_praise_detected: true,
    unsupported_praise_phrase: violation.phrase,
    unsupported_praise_reason: violation.reason,
    daily_praise_allowed_level: cal.praise_allowed_level,
    daily_consistency_claim_allowed: cal.consistency_claim_allowed,
    daily_proof_last_user_yes_age_days: cal.proof_age_days,
    unsupported_praise_claim: true,
  };
}
