/**
 * Phase 2.3-B — post-unified-guard weekly proof truth recheck.
 */

import type { WeeklyOutboundProofGuardFacts } from "@/lib/weekly-outbound-final-guard-evidence";
import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";

export const WEEKLY_PROOF_TRUTH_VIOLATION_NO_SEND =
  "weekly_proof_truth_violation_after_unified_guard" as const;

export const WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND =
  "weekly_false_streak_or_progress_after_unified_guard" as const;

export const WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND =
  "weekly_unsupported_proof_or_victory_after_unified_guard" as const;

export const WEEKLY_INTERNAL_LABEL_NO_SEND =
  "weekly_internal_label_after_unified_guard" as const;

const EVERY_DAY_CLAIM_RE =
  /\b(?:every\s+day|all\s+week|perfect\s+week|completed\s+every\s+day|never\s+missed|each\s+day|seven\s+for\s+seven|7\s+for\s+7)\b/i;

const EXPLICIT_PROOF_VICTORY_RE =
  /\b(?:victory\s+room|counts\s+as\s+proof|that\s+counts|you\s+proved|proof\s+moment|milestone)\b/i;

const INVENTED_PROGRESS_RE =
  /\b(?:great\s+week|strong\s+momentum|nice\s+progress|solid\s+progress|you\s+showed\s+up|crushing\s+it|amazing\s+week|strong\s+week|real\s+momentum|building\s+momentum)\b/i;

const STRONG_WEEK_OVERPRAISE_RE =
  /\b(?:crushing\s+it|amazing\s+week|perfect\s+week|incredible\s+week|best\s+week)\b/i;

const EXACT_MULTI_MISS_COUNT_RE =
  /\b(a few days missed|several days missed|a couple missed|couple missed|a few missed|few missed|several missed|a few misses|few misses|several misses|two missed|2 missed|two misses|missed two days|missed 2 days|missed a few|missed several)\b/i;

export const WEEKLY_FALSE_EXACT_MISS_COUNT_NO_SEND =
  "weekly_false_exact_miss_count_after_unified_guard" as const;

const FALSE_GOAL_CHANGE_RE =
  /\b(?:goal(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)|commitment(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in|tightened|replaced)|(?:updated|changed)\s+your\s+(?:goal|commitment)|i(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?(?:goal|commitment)|(?:new|updated)\s+(?:commitment|focus|goal|bar)\s+(?:is\s+)?(?:active|set|live|in effect))\b/i;

const WEEKLY_INTERNAL_JARGON: { violation: string; re: RegExp }[] = [
  { violation: "internal_route_purpose", re: /\bweekly_proof_v2\b/i },
  { violation: "internal_proof_pack", re: /\bproof_pack\b/i },
  { violation: "internal_event_type", re: /\bevent_type\b/i },
  { violation: "internal_classifier", re: /\bclassifier\b/i },
  { violation: "internal_route_purpose_token", re: /\broute_purpose\b/i },
];

export type PostUnifiedWeeklyProofTruthArgs = {
  body: string;
  weeklyProof: WeeklyOutboundProofGuardFacts;
  hasProofOrKnownOutcome: boolean;
  effectiveAsk?: string | null;
};

function countsSupportEveryDayClaim(wp: WeeklyOutboundProofGuardFacts): boolean {
  if (wp.silentWeek || wp.responseCount === 0) return false;
  if (wp.missedCount > 0 || wp.partialCount > 0) return false;
  if (wp.checkSentCount > 0) {
    return wp.completedCount >= wp.checkSentCount;
  }
  return wp.completedCount >= 5;
}

function countsSupportProofClaim(
  wp: WeeklyOutboundProofGuardFacts,
  hasProof: boolean
): boolean {
  if (hasProof) return true;
  return wp.proofMomentHints.length > 0;
}

function bodyAlignsWithProofHints(body: string, hints: string[]): boolean {
  if (hints.length === 0) return false;
  const lower = body.toLowerCase();
  for (const hint of hints) {
    const tokens = hint
      .toLowerCase()
      .match(/\b[a-z]{4,}\b/g)
      ?.filter((t) => !["that", "this", "with", "your", "week", "from"].includes(t));
    if (!tokens?.length) continue;
    const hits = tokens.filter((t) => lower.includes(t)).length;
    if (hits >= Math.min(2, tokens.length)) return true;
  }
  return false;
}

export function evaluatePostUnifiedGuardWeeklyProofTruthRecheck(
  args: PostUnifiedWeeklyProofTruthArgs
): {
  blocked: boolean;
  noSendReason: string | null;
  violations: string[];
} {
  const body = args.body.trim();
  const wp = args.weeklyProof;
  const violations: string[] = [];

  if (!body) {
    return { blocked: true, noSendReason: WEEKLY_PROOF_TRUTH_VIOLATION_NO_SEND, violations: ["empty_body"] };
  }

  const internalLabels = userVisibleInternalLabelBlockedReasons(body);
  if (internalLabels.length > 0) {
    return {
      blocked: true,
      noSendReason: WEEKLY_INTERNAL_LABEL_NO_SEND,
      violations: internalLabels,
    };
  }

  for (const { violation, re } of WEEKLY_INTERNAL_JARGON) {
    if (re.test(body)) violations.push(violation);
  }
  if (violations.length > 0) {
    return {
      blocked: true,
      noSendReason: WEEKLY_INTERNAL_LABEL_NO_SEND,
      violations,
    };
  }

  if (EVERY_DAY_CLAIM_RE.test(body) && !countsSupportEveryDayClaim(wp)) {
    return {
      blocked: true,
      noSendReason: WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
      violations: ["false_every_day_or_perfect_week_claim"],
    };
  }

  if (EXPLICIT_PROOF_VICTORY_RE.test(body)) {
    const hintsAlign = bodyAlignsWithProofHints(body, wp.proofMomentHints);
    if (!countsSupportProofClaim(wp, args.hasProofOrKnownOutcome) && !hintsAlign) {
      return {
        blocked: true,
        noSendReason: WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND,
        violations: ["unsupported_proof_or_victory_claim"],
      };
    }
  }

  if ((wp.silentWeek || wp.responseCount === 0) && INVENTED_PROGRESS_RE.test(body)) {
    return {
      blocked: true,
      noSendReason: WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
      violations: ["invented_progress_on_silent_or_no_data_week"],
    };
  }

  if (wp.roughWeek && STRONG_WEEK_OVERPRAISE_RE.test(body)) {
    return {
      blocked: true,
      noSendReason: WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
      violations: ["rough_week_overpraised_as_strong_week"],
    };
  }

  if (!wp.strongWeek && /\bstrong\s+week\b/i.test(body) && wp.completedCount < 2) {
    return {
      blocked: true,
      noSendReason: WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
      violations: ["unsupported_strong_week_claim"],
    };
  }

  if (EXACT_MULTI_MISS_COUNT_RE.test(body)) {
    const distinct = wp.distinctMissedDayCount ?? wp.missedCount;
    if (distinct < 2 || !wp.exactMissCountClaimReliable) {
      return {
        blocked: true,
        noSendReason: WEEKLY_FALSE_EXACT_MISS_COUNT_NO_SEND,
        violations: ["false_exact_multi_miss_count_claim"],
      };
    }
  }

  if (FALSE_GOAL_CHANGE_RE.test(body)) {
    return {
      blocked: true,
      noSendReason: WEEKLY_PROOF_TRUTH_VIOLATION_NO_SEND,
      violations: ["false_goal_or_commitment_changed_claim"],
    };
  }

  return { blocked: false, noSendReason: null, violations: [] };
}
