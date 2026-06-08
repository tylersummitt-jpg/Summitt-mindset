/**
 * Phase 2.1f-B1 — post-unified-guard refresh identity truth / verbatim recheck.
 */

import {
  assertRequiredVerbatimSubstringsPresent,
  type InboundV3RefreshFacts,
} from "@/lib/v3-inbound-relationship-lane";
import type { RefreshIdentityLaneIntent } from "@/lib/v2-refresh-no-send-truth";

const IDENTITY_CHANGED_CLAIM_PATTERNS: RegExp[] = [
  /\bidentity(?:\s+line)?\s+(?:has\s+been\s+)?(?:updated|changed)\b/i,
  /\b(?:updated|changed)\s+(?:your\s+)?identity\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?identity\b/i,
  /\bidentity\s+is\s+(?:now\s+)?(?:updated|different)\b/i,
];

const GOAL_COMMITMENT_CHANGED_PATTERNS: RegExp[] = [
  /\bgoal(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\bcommitment(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in)\b/i,
  /\b(?:updated|changed)\s+your\s+(?:goal|commitment|focus|bar)\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?(?:goal|commitment|bar)\b/i,
];

const REFRESH_FULLY_COMPLETE_PATTERNS: RegExp[] = [
  /\brefresh\s+(?:is\s+)?(?:complete|completed|done|finished)\b/i,
  /\ball\s+(?:set|done)\s+on\s+(?:the\s+)?refresh\b/i,
  /\balignment\s+(?:check\s+)?(?:is\s+)?complete\b/i,
  /\beverything\s+(?:is\s+)?(?:aligned|updated|set)\b/i,
  /\bback\s+to\s+normal\s+checks\b/i,
];

const IDENTITY_CONFIRMED_PATTERNS: RegExp[] = [
  /\bidentity\s+(?:still\s+)?(?:fits|confirmed|locked\s+in)\b/i,
  /\b(?:confirmed|locked\s+in)\s+(?:your\s+)?identity\b/i,
  /\bidentity\s+line\s+(?:is\s+)?(?:still\s+)?(?:good|right|accurate)\b/i,
];

const FRESH_MUTATION_PATTERNS: RegExp[] = [
  /\bjust\s+(?:recorded|applied|updated|changed)\b/i,
  /\bfresh(?:ly)?\s+(?:recorded|applied|updated)\b/i,
  /\b(?:newly|now)\s+(?:recorded|applied|updated)\b/i,
];

const REFRESH_FORBIDDEN_PHRASES = [
  "victory room",
  "counts as proof",
  "fake proof",
  " rpc",
  "event_type",
  "route_purpose",
  "user_yes",
  "user_no",
  "user_partial",
  "refresh_facts",
  "mutation",
] as const;

function claimsFakeProofOrCompletion(body: string): boolean {
  return (
    /\b(great job completing|you completed your (goal|commitment)|saved to victory|that counts as proof|completed today)\b/i.test(
      body
    ) || /\b(victory room|proof moment)\b/i.test(body)
  );
}

function matchesAny(body: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(body));
}

export type RefreshPostUnifiedMutationFlags = {
  identityStill?: boolean;
  identityChangedHandoff?: boolean;
  identityClarify?: boolean;
  identityAborted?: boolean;
  alreadyApplied?: boolean;
  inactiveStep?: boolean;
  sessionAdvanced?: boolean;
  pendingCreated?: boolean;
  refreshCleared?: boolean;
};

export function evaluatePostUnifiedGuardRefreshTruthRecheck(args: {
  body: string;
  refreshIntent: RefreshIdentityLaneIntent;
  refreshFamily: "identity";
  stateTransitionSummary?: string | null;
  requiredMeaningSummary?: string | null;
  requiredVerbatimSubstrings?: string[] | null;
  refreshFacts?: InboundV3RefreshFacts | null;
  mutationFlags: RefreshPostUnifiedMutationFlags;
  routePurpose?: string | null;
  branchName?: string | null;
}): {
  blocked: boolean;
  noSendReason: string | null;
  verbatimMissing: string[] | null;
  forbiddenPhraseFailed: boolean;
  fakeProofFailed: boolean;
  refreshTruthViolations: string[];
} {
  const trimmed = args.body.trim();
  if (!trimmed) {
    return {
      blocked: true,
      noSendReason: "refresh_empty_body_after_unified_guard",
      verbatimMissing: null,
      forbiddenPhraseFailed: false,
      fakeProofFailed: false,
      refreshTruthViolations: ["empty_body"],
    };
  }

  let verbatimMissing: string[] | null = null;
  const requiredVerbatim =
    args.requiredVerbatimSubstrings ?? args.refreshFacts?.required_verbatim_substrings ?? null;
  if (requiredVerbatim && requiredVerbatim.length > 0) {
    const verbatimCheck = assertRequiredVerbatimSubstringsPresent(
      "post_final_voice_gate",
      args.body,
      requiredVerbatim
    );
    if (!verbatimCheck.ok) {
      verbatimMissing = verbatimCheck.missing;
    }
  }

  const violations: string[] = [];
  const flags = args.mutationFlags;

  if (args.refreshIntent === "identity_still_commitment_prompt" || flags.identityStill) {
    if (matchesAny(trimmed, IDENTITY_CHANGED_CLAIM_PATTERNS)) {
      violations.push("refresh_still_but_body_claims_identity_changed");
    }
    if (matchesAny(trimmed, GOAL_COMMITMENT_CHANGED_PATTERNS)) {
      violations.push("refresh_still_but_body_claims_commitment_changed");
    }
    if (flags.sessionAdvanced && matchesAny(trimmed, REFRESH_FULLY_COMPLETE_PATTERNS)) {
      violations.push("refresh_still_but_body_claims_refresh_fully_complete");
    }
  }

  if (args.refreshIntent === "identity_change_handoff" || flags.identityChangedHandoff) {
    if (matchesAny(trimmed, IDENTITY_CHANGED_CLAIM_PATTERNS)) {
      violations.push("refresh_handoff_but_body_claims_identity_already_changed");
    }
    if (matchesAny(trimmed, GOAL_COMMITMENT_CHANGED_PATTERNS)) {
      violations.push("refresh_handoff_but_body_claims_goal_changed");
    }
  }

  if (args.refreshIntent === "identity_clarify_prompt" || flags.identityClarify) {
    if (matchesAny(trimmed, IDENTITY_CONFIRMED_PATTERNS)) {
      violations.push("refresh_clarify_but_body_claims_identity_confirmed");
    }
    if (matchesAny(trimmed, IDENTITY_CHANGED_CLAIM_PATTERNS)) {
      violations.push("refresh_clarify_but_body_claims_identity_changed");
    }
    if (matchesAny(trimmed, REFRESH_FULLY_COMPLETE_PATTERNS)) {
      violations.push("refresh_clarify_but_body_claims_refresh_completed");
    }
  }

  if (args.refreshIntent === "identity_aborted_unclear" || flags.identityAborted) {
    if (matchesAny(trimmed, IDENTITY_CHANGED_CLAIM_PATTERNS)) {
      violations.push("refresh_aborted_but_body_claims_identity_changed");
    }
    if (matchesAny(trimmed, IDENTITY_CONFIRMED_PATTERNS)) {
      violations.push("refresh_aborted_but_body_claims_identity_confirmed");
    }
    if (/\brefresh\s+(?:was\s+)?(?:successful|completed)\b/i.test(trimmed)) {
      violations.push("refresh_aborted_but_body_claims_successful_alignment");
    }
  }

  if (args.refreshIntent === "identity_already_applied" || flags.alreadyApplied) {
    if (matchesAny(trimmed, FRESH_MUTATION_PATTERNS)) {
      violations.push("refresh_already_applied_but_body_claims_fresh_mutation");
    }
  }

  if (args.refreshIntent === "identity_inactive_step" || flags.inactiveStep) {
    if (matchesAny(trimmed, FRESH_MUTATION_PATTERNS)) {
      violations.push("refresh_inactive_but_body_claims_mutation");
    }
    if (matchesAny(trimmed, IDENTITY_CHANGED_CLAIM_PATTERNS)) {
      violations.push("refresh_inactive_but_body_claims_identity_changed");
    }
  }

  const bodyLc = trimmed.toLowerCase();
  let forbiddenPhraseFailed = false;
  for (const phrase of REFRESH_FORBIDDEN_PHRASES) {
    if (bodyLc.includes(phrase)) {
      forbiddenPhraseFailed = true;
      violations.push("refresh_forbidden_internal_jargon");
      break;
    }
  }

  const fakeProofFailed = claimsFakeProofOrCompletion(trimmed);
  if (fakeProofFailed) {
    violations.push("refresh_body_claims_fake_proof_or_completion");
  }

  let noSendReason: string | null = null;
  if (verbatimMissing != null) {
    noSendReason = "refresh_required_verbatim_missing_after_unified_guard";
  } else if (violations.length > 0) {
    noSendReason = "refresh_state_truth_violation_after_unified_guard";
  } else if (forbiddenPhraseFailed) {
    noSendReason = "refresh_forbidden_phrase_after_unified_guard";
  }

  return {
    blocked: noSendReason != null,
    noSendReason,
    verbatimMissing,
    forbiddenPhraseFailed,
    fakeProofFailed,
    refreshTruthViolations: violations,
  };
}
