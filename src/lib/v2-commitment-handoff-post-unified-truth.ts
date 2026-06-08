/**
 * Phase 2.1e — post-unified-guard commitment change handoff truth / verbatim recheck.
 */

import {
  assertRequiredVerbatimSubstringsPresent,
  type InboundV3CommitmentChangeFacts,
} from "@/lib/v3-inbound-relationship-lane";

const HANDOFF_FALSE_APPLIED_PATTERNS: RegExp[] = [
  /\bgoal(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in|applied)\b/i,
  /\bgoal\b[^.!?]{0,100}\b(?:has\s+been\s+)?(?:updated|changed)\b/i,
  /\bcommitment(?:'s)?\s+(?:has\s+been\s+)?(?:updated|changed|locked\s+in|applied)\b/i,
  /\bcommitment\b[^.!?]{0,100}\b(?:has\s+been\s+)?(?:updated|changed)\b/i,
  /\b(?:updated|changed)\s+your\s+goal\b/i,
  /\b(?:updated|changed)\s+your\s+commitment\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?goal\b/i,
  /\bi(?:'ve| have)\s+(?:updated|changed)\s+(?:your\s+)?commitment\b/i,
  /\bgoal\s+is\s+(?:updated|active|locked\s+in)\b/i,
  /\bcommitment\s+is\s+(?:updated|active|locked\s+in)\b/i,
  /\b(?:now|already)\s+(?:active|locked\s+in|in\s+effect)\b/i,
  /\b(?:rewritten|permanently\s+changed)\b/i,
];

const HANDOFF_FALSE_PENDING_CREATED_PATTERNS: RegExp[] = [
  /\bstarted\s+(?:a\s+)?(?:new\s+)?(?:pending|update\s+flow|commitment\s+update)\b/i,
  /\bpending\s+(?:change|update|resolution)\s+(?:was\s+)?created\b/i,
  /\bcreated\s+(?:a\s+)?pending\b/i,
  /\bnew\s+pending\s+(?:change|update)\b/i,
];

const HANDOFF_FALSE_NEW_PENDING_THIS_TURN_PATTERNS: RegExp[] = [
  /\bjust\s+started\s+(?:a\s+)?(?:new\s+)?(?:update|change|flow)\b/i,
  /\bi(?:'ve| have)\s+started\s+(?:a\s+)?(?:new\s+)?(?:pending|update)\b/i,
  /\bcreated\s+(?:a\s+)?(?:new\s+)?pending\s+(?:change|update)\b/i,
];

const HANDOFF_FORBIDDEN_PHRASES = [
  "victory room",
  "counts as proof",
  "fake proof",
  " overlay",
  " rpc",
  "event_type",
  "route_purpose",
  "user_yes",
  "user_no",
  "user_partial",
  "pending_resolution",
  "mutation",
  "adaptive overlay",
] as const;

function claimsFakeProofOrCompletion(body: string): boolean {
  return (
    /\b(great job completing|you completed your (goal|commitment)|saved to victory|that counts as proof|completed today)\b/i.test(
      body
    ) || /\b(victory room|proof moment)\b/i.test(body)
  );
}

export function detectCommitmentHandoffPendingCreatedTruthViolations(
  body: string,
  args: { pendingResolutionCreated: boolean }
): string[] {
  const trimmed = body.trim();
  if (!trimmed || !args.pendingResolutionCreated) return [];

  const violations: string[] = [];
  for (const re of HANDOFF_FALSE_APPLIED_PATTERNS) {
    if (re.test(trimmed)) {
      violations.push("handoff_pending_created_but_body_claims_applied");
      break;
    }
  }
  return violations;
}

export function detectCommitmentHandoffNoPendingCreatedTruthViolations(
  body: string,
  args: { pendingResolutionCreated: boolean }
): string[] {
  const trimmed = body.trim();
  if (!trimmed || args.pendingResolutionCreated) return [];

  const violations: string[] = [];
  for (const re of HANDOFF_FALSE_APPLIED_PATTERNS) {
    if (re.test(trimmed)) {
      violations.push("handoff_no_pending_but_body_claims_applied");
      break;
    }
  }
  for (const re of HANDOFF_FALSE_PENDING_CREATED_PATTERNS) {
    if (re.test(trimmed)) {
      violations.push("handoff_no_pending_but_body_claims_pending_created");
      break;
    }
  }
  return violations;
}

export function detectCommitmentHandoffExistingPendingTruthViolations(
  body: string,
  args: { existingPendingResolution: boolean; pendingResolutionCreated: boolean }
): string[] {
  const trimmed = body.trim();
  if (!trimmed || !args.existingPendingResolution || args.pendingResolutionCreated) return [];

  const violations: string[] = [];
  for (const re of HANDOFF_FALSE_NEW_PENDING_THIS_TURN_PATTERNS) {
    if (re.test(trimmed)) {
      violations.push("handoff_existing_pending_but_body_claims_new_pending");
      break;
    }
  }
  return violations;
}

export function validateCommitmentHandoffForbiddenLanguage(body: string): {
  ok: true;
} | { ok: false; phrase: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, phrase: "(empty)" };
  const bodyLc = trimmed.toLowerCase();
  for (const phrase of HANDOFF_FORBIDDEN_PHRASES) {
    if (bodyLc.includes(phrase)) {
      return { ok: false, phrase };
    }
  }
  return { ok: true };
}

export function evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck(args: {
  body: string;
  commitmentChangeFacts: InboundV3CommitmentChangeFacts;
  requiredVerbatimSubstrings?: string[] | null;
}): {
  blocked: boolean;
  noSendReason: string | null;
  verbatimMissing: string[] | null;
  pendingTruthFailed: boolean;
  forbiddenPhraseFailed: boolean;
  fakeProofFailed: boolean;
  handoffTruthViolations: string[];
} {
  const trimmed = args.body.trim();
  if (!trimmed) {
    return {
      blocked: true,
      noSendReason: "commitment_handoff_empty_body_after_unified_guard",
      verbatimMissing: null,
      pendingTruthFailed: true,
      forbiddenPhraseFailed: false,
      fakeProofFailed: false,
      handoffTruthViolations: ["empty_body"],
    };
  }

  let verbatimMissing: string[] | null = null;
  const requiredVerbatim =
    args.requiredVerbatimSubstrings ?? args.commitmentChangeFacts.required_verbatim_substrings ?? null;
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

  const pendingCreated = args.commitmentChangeFacts.pending_resolution_created;
  const handoffTruthViolations = [
    ...detectCommitmentHandoffPendingCreatedTruthViolations(trimmed, { pendingResolutionCreated: pendingCreated }),
    ...detectCommitmentHandoffNoPendingCreatedTruthViolations(trimmed, { pendingResolutionCreated: pendingCreated }),
    ...detectCommitmentHandoffExistingPendingTruthViolations(trimmed, {
      existingPendingResolution: args.commitmentChangeFacts.existing_pending_resolution,
      pendingResolutionCreated: pendingCreated,
    }),
  ];

  const forbidden = validateCommitmentHandoffForbiddenLanguage(trimmed);
  const fakeProofFailed = claimsFakeProofOrCompletion(trimmed);
  if (fakeProofFailed) {
    handoffTruthViolations.push("handoff_body_claims_fake_proof_or_completion");
  }

  let noSendReason: string | null = null;
  if (verbatimMissing != null) {
    noSendReason = "commitment_handoff_required_verbatim_missing_after_unified_guard";
  } else if (handoffTruthViolations.length > 0) {
    noSendReason = "commitment_handoff_state_truth_violation_after_unified_guard";
  } else if (!forbidden.ok) {
    noSendReason = "commitment_handoff_forbidden_phrase_after_unified_guard";
  }

  return {
    blocked: noSendReason != null,
    noSendReason,
    verbatimMissing,
    pendingTruthFailed: handoffTruthViolations.some((v) => v.includes("pending") || v.includes("applied")),
    forbiddenPhraseFailed: !forbidden.ok,
    fakeProofFailed,
    handoffTruthViolations,
  };
}
