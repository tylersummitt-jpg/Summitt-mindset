/**
 * Phase 2.1d-A1 — post-unified-guard contract consent truth / verbatim recheck.
 */

import {
  buildContractConsentAckIntent,
  validateContractConsentAckForbiddenLanguage,
  validateContractConsentAckRequiredMeaning,
  type ContractConsentAckIntent,
} from "@/lib/v2-contract-consent-ack-send";
import {
  assertRequiredVerbatimSubstringsPresent,
  type InboundV3ContractConsentFacts,
} from "@/lib/v3-inbound-relationship-lane";
import type { V2ContractOverlayKind } from "@/lib/v2-sms-accountability";

function asksUserToAcceptAgain(body: string): boolean {
  return (
    /\b(reply|text|send)\s+(yes|no)\b/i.test(body) ||
    /\b(yes or no|reply yes|reply no|text yes|text no)\b/i.test(body)
  );
}

function claimsDeclinedOrUnchanged(body: string): boolean {
  return (
    /\b(declined|won't apply|will not apply|not applying|keeping your current|unchanged|without applying|didn't accept|did not accept)\b/i.test(
      body
    ) || /\b(staying with your current|keep your current written)\b/i.test(body)
  );
}

function claimsOverlayActiveOrAdopted(body: string): boolean {
  return (
    /\b(now active|is active|adopted|tighter ask|new ask is|overlay is|plan is locked|locked in for the week|hold you to the sharper)\b/i.test(
      body
    ) || /\b(your plan is active|ask is now in effect|new bar is in effect)\b/i.test(body)
  );
}

function claimsFreshActivation(body: string): boolean {
  if (/\b(already recorded|already handled|already applied|from a prior reply)\b/i.test(body)) {
    return false;
  }
  return (
    /\b(just activated|freshly applied|now activated|new ask is now|just locked|just adopted)\b/i.test(
      body
    ) || claimsOverlayActiveOrAdopted(body)
  );
}

function claimsDefinitiveConsentResolution(body: string): boolean {
  return claimsOverlayActiveOrAdopted(body) || claimsDeclinedOrUnchanged(body);
}

export function detectContractConsentStateTruthViolations(
  body: string,
  args: {
    overlayAction: InboundV3ContractConsentFacts["overlay_action"];
    consentParse: "user_yes" | "user_no";
    pendingRemainsActive?: boolean;
  }
): string[] {
  const trimmed = body.trim();
  if (!trimmed) return ["empty_body"];

  const violations: string[] = [];
  const { overlayAction } = args;

  if (overlayAction === "activated") {
    if (claimsDeclinedOrUnchanged(trimmed)) violations.push("activated_but_body_claims_declined_or_unchanged");
    if (asksUserToAcceptAgain(trimmed)) violations.push("activated_but_body_reasks_consent");
  }

  if (overlayAction === "declined") {
    if (claimsOverlayActiveOrAdopted(trimmed)) violations.push("declined_but_body_claims_overlay_active");
  }

  if (overlayAction === "noop_already_applied") {
    if (claimsFreshActivation(trimmed)) violations.push("noop_already_applied_but_body_claims_fresh_activation");
  }

  if (overlayAction === "noop_not_found" || overlayAction === "noop_state_conflict") {
    if (claimsDefinitiveConsentResolution(trimmed)) {
      violations.push("pending_active_but_body_claims_consent_resolved");
    }
  }

  if (args.pendingRemainsActive && overlayAction !== "activated" && overlayAction !== "declined") {
    if (claimsDefinitiveConsentResolution(trimmed)) {
      violations.push("proposal_still_active_but_body_claims_consent_resolved");
    }
  }

  return violations;
}

export function evaluatePostUnifiedGuardContractTruthRecheck(args: {
  body: string;
  contractConsentFacts: InboundV3ContractConsentFacts;
  consentParse: "user_yes" | "user_no";
  proposalText: string;
  contractKind: V2ContractOverlayKind;
  behaviorStatement: string;
  effectiveAsk: string;
  optionalBindingSubstring?: string | null;
  proposalStillActive: boolean;
}): {
  blocked: boolean;
  noSendReason: string | null;
  verbatimMissing: string[] | null;
  contractTruthFailed: boolean;
  forbiddenPhraseFailed: boolean;
  meaningFailed: boolean;
  contractTruthViolations: string[];
} {
  const requiredVerbatim = args.contractConsentFacts.required_verbatim_substrings;
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

  const contractTruthViolations = detectContractConsentStateTruthViolations(args.body, {
    overlayAction: args.contractConsentFacts.overlay_action,
    consentParse: args.consentParse,
    pendingRemainsActive:
      args.proposalStillActive ||
      args.contractConsentFacts.overlay_action === "noop_not_found" ||
      args.contractConsentFacts.overlay_action === "noop_state_conflict",
  });

  const forbidden = validateContractConsentAckForbiddenLanguage(args.body);
  const intent: ContractConsentAckIntent = buildContractConsentAckIntent({
    consentParse: args.consentParse,
    messageSid: args.contractConsentFacts.inbound_message_sid,
    proposalText: args.proposalText,
    contractKind: args.contractKind,
    behaviorStatement: args.behaviorStatement,
    effectiveAsk: args.effectiveAsk,
    contractConsentFacts: {
      overlay_action: args.contractConsentFacts.overlay_action,
      rpc_result: args.contractConsentFacts.rpc_result,
      proposal_text_digest: args.contractConsentFacts.proposal_text_digest,
      required_meaning_summary: args.contractConsentFacts.required_meaning_summary ?? null,
    },
    optionalBindingHint: args.optionalBindingSubstring ?? null,
  });
  const meaning = validateContractConsentAckRequiredMeaning({ body: args.body, intent });

  let noSendReason: string | null = null;
  if (verbatimMissing != null) {
    noSendReason = "contract_required_verbatim_missing_after_unified_guard";
  } else if (contractTruthViolations.length > 0) {
    noSendReason = "contract_state_truth_violation_after_unified_guard";
  } else if (!forbidden.ok) {
    noSendReason = "contract_forbidden_phrase_after_unified_guard";
  } else if (!meaning.ok) {
    noSendReason = "contract_required_meaning_missing_after_unified_guard";
  }

  return {
    blocked: noSendReason != null,
    noSendReason,
    verbatimMissing,
    contractTruthFailed: contractTruthViolations.length > 0,
    forbiddenPhraseFailed: !forbidden.ok,
    meaningFailed: !meaning.ok,
    contractTruthViolations,
  };
}
