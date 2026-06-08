/**
 * Phase 2.1d-A2 — post-unified-guard adaptive ambiguous consent clarify truth recheck.
 */

import {
  assertRequiredVerbatimSubstringsPresent,
  type InboundV3AdaptiveConsentClarificationFacts,
} from "@/lib/v3-inbound-relationship-lane";

const ADAPTIVE_CLARIFY_FORBIDDEN_PHRASES = [
  "victory room",
  "counts as proof",
  "fake proof",
  " overlay",
  "mutation",
  " rpc",
  "adaptive overlay",
  "pending resolution",
] as const;

function claimsAccepted(body: string): boolean {
  return (
    /\b(accepted|you said yes|got it.*locked|locked in for|we('ll| will) hold you|adopted|applied your)\b/i.test(
      body
    ) || /\b(your (new|tighter) ask is (now )?in effect|plan is (now )?active)\b/i.test(body)
  );
}

function claimsDeclined(body: string): boolean {
  return (
    /\b(declined|you said no|won't apply|will not apply|not applying|keeping your current|didn't accept|did not accept)\b/i.test(
      body
    ) || /\b(staying with your current|keep your current written)\b/i.test(body)
  );
}

function claimsPlanActive(body: string): boolean {
  return (
    /\b(now active|is active|tighter ask|new ask is|overlay is|plan is locked|new bar is in effect)\b/i.test(
      body
    ) || /\b(your plan is active|ask is now in effect)\b/i.test(body)
  );
}

function claimsProposalResolved(body: string): boolean {
  return /\b(all set|we're good|that's handled|decision is made|proposal is (done|resolved)|consent is (recorded|handled))\b/i.test(
    body
  );
}

function claimsFakeProofOrCompletion(body: string): boolean {
  return (
    /\b(great job completing|you completed your (goal|commitment)|saved to victory|that counts as proof|completed today)\b/i.test(
      body
    ) || /\b(victory room|proof moment)\b/i.test(body)
  );
}

function bodyInvitesClearerConsentAnswer(body: string): boolean {
  if (/\?/.test(body)) return true;
  return (
    /\b(make sure|want to (be sure|confirm|clarify)|are you saying|did you mean|not sure i understood|help me understand|clear (yes|no)|saying yes|saying no|yes to that|no to that|or not yet|which way|what did you mean|before (we|i) (change|apply)|still pending|need a clear)\b/i.test(
      body
    )
  );
}

export function detectAdaptiveClarifyPendingStateTruthViolations(
  body: string,
  args: {
    stateRemainsPending: boolean;
    pendingProposalValid: boolean;
  }
): string[] {
  const trimmed = body.trim();
  if (!trimmed) return ["empty_body"];

  const violations: string[] = [];
  if (!args.stateRemainsPending && !args.pendingProposalValid) {
    return violations;
  }

  if (claimsAccepted(trimmed)) violations.push("clarify_but_body_claims_accepted");
  if (claimsDeclined(trimmed)) violations.push("clarify_but_body_claims_declined");
  if (claimsPlanActive(trimmed)) violations.push("clarify_but_body_claims_plan_active");
  if (claimsProposalResolved(trimmed)) violations.push("clarify_but_body_claims_proposal_resolved");
  if (claimsFakeProofOrCompletion(trimmed)) violations.push("clarify_but_body_claims_fake_proof_or_completion");

  return violations;
}

export function validateAdaptiveClarifyForbiddenLanguage(body: string): {
  ok: true;
} | { ok: false; phrase: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, phrase: "(empty)" };
  const bodyLc = trimmed.toLowerCase();
  for (const phrase of ADAPTIVE_CLARIFY_FORBIDDEN_PHRASES) {
    if (bodyLc.includes(phrase)) {
      return { ok: false, phrase };
    }
  }
  return { ok: true };
}

export function evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck(args: {
  body: string;
  adaptiveConsentClarificationFacts: InboundV3AdaptiveConsentClarificationFacts;
  requiredVerbatimSubstrings?: string[] | null;
}): {
  blocked: boolean;
  noSendReason: string | null;
  verbatimMissing: string[] | null;
  pendingTruthFailed: boolean;
  clarificationMeaningFailed: boolean;
  forbiddenPhraseFailed: boolean;
  adaptiveTruthViolations: string[];
} {
  const requiredVerbatim = args.requiredVerbatimSubstrings;
  let verbatimMissing: string[] | null = null;
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

  const adaptiveTruthViolations = detectAdaptiveClarifyPendingStateTruthViolations(args.body, {
    stateRemainsPending: args.adaptiveConsentClarificationFacts.state_remains_pending,
    pendingProposalValid: args.adaptiveConsentClarificationFacts.pending_proposal_valid,
  });

  const forbidden = validateAdaptiveClarifyForbiddenLanguage(args.body);
  const clarificationMeaningFailed = !bodyInvitesClearerConsentAnswer(args.body);

  let noSendReason: string | null = null;
  if (verbatimMissing != null) {
    noSendReason = "adaptive_clarify_required_verbatim_missing_after_unified_guard";
  } else if (adaptiveTruthViolations.length > 0) {
    noSendReason = "adaptive_clarify_state_truth_violation_after_unified_guard";
  } else if (!forbidden.ok) {
    noSendReason = "adaptive_clarify_forbidden_phrase_after_unified_guard";
  } else if (clarificationMeaningFailed) {
    noSendReason = "adaptive_clarify_missing_clarification_meaning_after_unified_guard";
  }

  return {
    blocked: noSendReason != null,
    noSendReason,
    verbatimMissing,
    pendingTruthFailed: adaptiveTruthViolations.length > 0,
    clarificationMeaningFailed,
    forbiddenPhraseFailed: !forbidden.ok,
    adaptiveTruthViolations,
  };
}
