/**
 * Phase 2.3-C3 — post-unified-guard daily pending/refresh truth recheck.
 */

import type { DailyOutboundUnifiedGuardCtx } from "@/lib/daily-outbound-final-guard-evidence";
import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";

export const DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND =
  "daily_pending_resolution_truth_violation_after_unified_guard" as const;

export const DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND =
  "daily_refresh_identity_truth_violation_after_unified_guard" as const;

export const DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND =
  "daily_refresh_commitment_truth_violation_after_unified_guard" as const;

export const DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND =
  "daily_pending_refresh_required_verbatim_missing_after_unified_guard" as const;

export const DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND =
  "daily_pending_refresh_false_state_claim_after_unified_guard" as const;

const FALSE_APPLIED_UPDATE_PATTERNS: RegExp[] = [
  /\bgoal(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\bcommitment(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\b(?:updated|changed)\s+your\s+(?:goal|commitment)\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?(?:goal|commitment)\b/i,
];

const FALSE_PENDING_RESOLVED_PATTERNS: RegExp[] = [
  /\bpending\s+(?:is\s+)?(?:resolved|complete|completed|handled|cleared|done)\b/i,
  /\b(?:already\s+)?(?:resolved|handled|applied)\s+(?:the\s+)?pending\b/i,
  /\bupdate\s+(?:is\s+)?(?:complete|completed|done|applied)\b/i,
  /\bcommitment\s+update\s+(?:is\s+)?(?:complete|done|applied)\b/i,
];

const FALSE_IDENTITY_UPDATED_PATTERNS: RegExp[] = [
  /\bidentity(?:\s+line)?\s+(?:has\s+been\s+)?(?:updated|changed)\b/i,
  /\b(?:updated|changed)\s+(?:your\s+)?identity\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?identity\b/i,
];

const FALSE_REFRESH_COMPLETE_PATTERNS: RegExp[] = [
  /\brefresh\s+(?:is\s+)?(?:complete|completed|done|finished)\b/i,
  /\ball\s+(?:set|done)\s+on\s+(?:the\s+)?refresh\b/i,
  /\balignment\s+(?:check\s+)?(?:is\s+)?complete\b/i,
];

const FALSE_COMMITMENT_CHANGED_PATTERNS: RegExp[] = [
  ...FALSE_APPLIED_UPDATE_PATTERNS,
  /\bcommitment(?:'s)?\s+(?:has\s+been\s+)?(?:tightened|replaced)\b/i,
  /\b(?:new|updated)\s+(?:commitment|focus|goal|bar)\s+(?:is\s+)?(?:active|set|live|in effect)\b/i,
];

const ROBOTIC_INTERNAL_PATTERNS: { violation: string; re: RegExp }[] = [
  { violation: "internal_route_purpose", re: /\broute_purpose\b/i },
  { violation: "internal_event_type", re: /\bevent_type\b/i },
  { violation: "internal_classifier", re: /\bclassifier\b/i },
  { violation: "internal_overlay_token", re: /\boverlay\b/i },
  { violation: "internal_rpc", re: /\brpc\b/i },
  { violation: "internal_pending_resolution", re: /\bpending_resolution\b/i },
  { violation: "internal_refresh_facts", re: /\brefresh_facts\b/i },
];

const PENDING_REMINDER_MEANING_RE =
  /\b(finish|pending|update|commitment|confirm|candidate|new bar|holding|should i make)\b/i;

const REFRESH_IDENTITY_MEANING_RE =
  /\b(identity|becoming|fit|aligned|alignment|same vibe|still fit|who you)\b/i;

const REFRESH_COMMITMENT_MEANING_RE =
  /\b(commitment|focus|bar|keep|smaller|new goal|still fit|today'?s bar)\b/i;

export type PostUnifiedDailyPendingRefreshTruthArgs = {
  body: string;
  dailyRouteKind: "pending_resolution" | "refresh_identity" | "refresh_commitment";
  dailyGuardCtx: DailyOutboundUnifiedGuardCtx;
};

function routeSpecificNoSendReason(
  routeKind: PostUnifiedDailyPendingRefreshTruthArgs["dailyRouteKind"],
  kind: "truth" | "verbatim" | "false_state"
): string {
  if (kind === "verbatim") return DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND;
  if (kind === "false_state") return DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND;
  if (routeKind === "pending_resolution") return DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND;
  if (routeKind === "refresh_identity") return DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND;
  return DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND;
}

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function significantTokens(text: string): string[] {
  const lower = normalizeText(text);
  const words = lower.match(/\b[a-z]{4,}\b/g) ?? [];
  const nums = lower.match(/\b\d[\d,]*\b/g) ?? [];
  return [...new Set([...words, ...nums.map((n) => n.replace(/,/g, ""))])].filter(Boolean);
}

function bodyRepresentsPendingCandidate(body: string, candidate: string): boolean {
  const candTokens = significantTokens(candidate);
  if (candTokens.length === 0) return true;
  const bodyL = normalizeText(body);
  let hits = 0;
  for (const t of candTokens) {
    if (t.length >= 4 && bodyL.includes(t)) hits += 1;
  }
  if (candTokens.length === 1) return hits >= 1;
  return hits >= Math.min(2, candTokens.length);
}

function bodyCoachesStaleCanonicalBar(
  body: string,
  canonical: string,
  candidate: string
): boolean {
  if (bodyRepresentsPendingCandidate(body, candidate)) return false;
  const canonTokens = significantTokens(canonical).filter(
    (t) => !significantTokens(candidate).includes(t)
  );
  if (canonTokens.length === 0) return false;
  const bodyL = normalizeText(body);
  return canonTokens.some((t) => t.length >= 5 && bodyL.includes(t));
}

function assertRequiredVerbatimPresent(
  body: string,
  requiredSubstrings: string[] | undefined | null
): string[] {
  const missing: string[] = [];
  if (!requiredSubstrings?.length) return missing;
  for (const sub of requiredSubstrings) {
    const t = sub.trim();
    if (!t) continue;
    if (!body.includes(t)) missing.push(t);
  }
  return missing;
}

function detectRoboticInternalLanguage(body: string): string[] {
  const hits = userVisibleInternalLabelBlockedReasons(body);
  const t = body.trim();
  for (const { violation, re } of ROBOTIC_INTERNAL_PATTERNS) {
    if (re.test(t) && !hits.includes(violation)) hits.push(violation);
  }
  return hits;
}

function evaluatePendingResolutionRecheck(
  body: string,
  ctx: DailyOutboundUnifiedGuardCtx
): { violations: string[]; noSendReason: string | null } {
  const violations: string[] = [];
  const pr = ctx.pendingResolutionFacts;
  if (!pr) {
    violations.push("missing_pending_facts");
    return {
      violations,
      noSendReason: DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
    };
  }

  for (const re of FALSE_PENDING_RESOLVED_PATTERNS) {
    if (re.test(body)) {
      violations.push("pending_false_resolved_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }

  for (const re of FALSE_APPLIED_UPDATE_PATTERNS) {
    if (re.test(body)) {
      violations.push("pending_false_applied_language");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }

  const candidate = pr.candidateSnippet?.trim() ?? "";
  const canonical = pr.canonicalBehaviorStatement.trim();
  if (candidate) {
    if (!bodyRepresentsPendingCandidate(body, candidate)) {
      violations.push("pending_replace_candidate_not_represented");
      return {
        violations,
        noSendReason: DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
      };
    }
    if (canonical && bodyCoachesStaleCanonicalBar(body, canonical, candidate)) {
      violations.push("pending_replace_coaches_stale_canonical_bar");
      return {
        violations,
        noSendReason: DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
      };
    }
  } else if (pr.awaitingUserConfirmation) {
    violations.push("pending_candidate_not_represented");
    return {
      violations,
      noSendReason: DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
    };
  }

  if (!PENDING_REMINDER_MEANING_RE.test(body)) {
    violations.push("pending_reminder_meaning_missing");
    return {
      violations,
      noSendReason: DAILY_PENDING_RESOLUTION_TRUTH_VIOLATION_NO_SEND,
    };
  }

  return { violations, noSendReason: null };
}

function evaluateRefreshIdentityRecheck(
  body: string,
  ctx: DailyOutboundUnifiedGuardCtx
): { violations: string[]; noSendReason: string | null } {
  const violations: string[] = [];
  const rf = ctx.refreshGuardFacts;
  if (!rf) {
    violations.push("missing_refresh_identity_facts");
    return {
      violations,
      noSendReason: DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND,
    };
  }

  for (const re of FALSE_IDENTITY_UPDATED_PATTERNS) {
    if (re.test(body)) {
      violations.push("refresh_identity_false_updated_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }
  for (const re of FALSE_COMMITMENT_CHANGED_PATTERNS) {
    if (re.test(body)) {
      violations.push("refresh_identity_false_commitment_changed_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }
  for (const re of FALSE_REFRESH_COMPLETE_PATTERNS) {
    if (re.test(body)) {
      violations.push("refresh_identity_false_complete_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }

  if (!REFRESH_IDENTITY_MEANING_RE.test(body)) {
    violations.push("refresh_identity_meaning_missing");
    return {
      violations,
      noSendReason: DAILY_REFRESH_IDENTITY_TRUTH_VIOLATION_NO_SEND,
    };
  }

  return { violations, noSendReason: null };
}

function evaluateRefreshCommitmentRecheck(
  body: string,
  ctx: DailyOutboundUnifiedGuardCtx
): { violations: string[]; noSendReason: string | null } {
  const violations: string[] = [];
  const rf = ctx.refreshGuardFacts;
  if (!rf) {
    violations.push("missing_refresh_commitment_facts");
    return {
      violations,
      noSendReason: DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND,
    };
  }

  for (const re of FALSE_COMMITMENT_CHANGED_PATTERNS) {
    if (re.test(body)) {
      violations.push("refresh_commitment_false_changed_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }
  for (const re of FALSE_REFRESH_COMPLETE_PATTERNS) {
    if (re.test(body)) {
      violations.push("refresh_commitment_false_complete_claim");
      return {
        violations,
        noSendReason: DAILY_PENDING_REFRESH_FALSE_STATE_CLAIM_NO_SEND,
      };
    }
  }

  if (!REFRESH_COMMITMENT_MEANING_RE.test(body)) {
    violations.push("refresh_commitment_meaning_missing");
    return {
      violations,
      noSendReason: DAILY_REFRESH_COMMITMENT_TRUTH_VIOLATION_NO_SEND,
    };
  }

  return { violations, noSendReason: null };
}

export function evaluatePostUnifiedGuardDailyPendingRefreshTruthRecheck(
  args: PostUnifiedDailyPendingRefreshTruthArgs
): {
  blocked: boolean;
  noSendReason: string | null;
  violations: string[];
} {
  const body = args.body.trim();
  const violations: string[] = [];

  if (!body) {
    return {
      blocked: true,
      noSendReason: routeSpecificNoSendReason(args.dailyRouteKind, "truth"),
      violations: ["empty_body"],
    };
  }

  const requiredVerbatim =
    args.dailyRouteKind === "pending_resolution"
      ? (args.dailyGuardCtx.pendingResolutionFacts?.requiredVerbatimSubstrings ?? [])
      : (args.dailyGuardCtx.refreshGuardFacts?.requiredVerbatimSubstrings ?? []);

  const verbatimMissing = assertRequiredVerbatimPresent(body, requiredVerbatim);
  if (verbatimMissing.length > 0) {
    violations.push(...verbatimMissing.map((m) => `missing_verbatim:${m.slice(0, 40)}`));
    return {
      blocked: true,
      noSendReason: DAILY_PENDING_REFRESH_REQUIRED_VERBATIM_MISSING_NO_SEND,
      violations,
    };
  }

  let routeResult: { violations: string[]; noSendReason: string | null };
  if (args.dailyRouteKind === "pending_resolution") {
    routeResult = evaluatePendingResolutionRecheck(body, args.dailyGuardCtx);
  } else if (args.dailyRouteKind === "refresh_identity") {
    routeResult = evaluateRefreshIdentityRecheck(body, args.dailyGuardCtx);
  } else {
    routeResult = evaluateRefreshCommitmentRecheck(body, args.dailyGuardCtx);
  }

  if (routeResult.noSendReason) {
    violations.push(...routeResult.violations);
    return {
      blocked: true,
      noSendReason: routeResult.noSendReason,
      violations,
    };
  }

  const robotic = detectRoboticInternalLanguage(body);
  if (robotic.length > 0) {
    violations.push(...robotic);
    return {
      blocked: true,
      noSendReason: routeSpecificNoSendReason(args.dailyRouteKind, "truth"),
      violations,
    };
  }

  return {
    blocked: false,
    noSendReason: null,
    violations: [],
  };
}
