/**
 * Phase 3F-3 — server-only gate: pending adaptive proposal + proposal prompt still latest outbound,
 * but inbound is not deterministic YES/NO and looks consent-adjacent (not accountability scoring).
 * No OpenAI / V3 classification — route lock only.
 */

import {
  classifyV2InboundReply,
  messageHasKeywordPartialLanguage,
} from "@/lib/v2-sms-accountability";

export type AdaptiveConsentClarificationInboundParse =
  | "ambiguous"
  | "question"
  | "explanation_request"
  | "consent_adjacent";

export type AdaptiveProposalAmbiguousConsentGateResult =
  | { shouldRoute: false; denyReason: string }
  | { shouldRoute: true; inboundParse: AdaptiveConsentClarificationInboundParse };

type Classification = ReturnType<typeof classifyV2InboundReply>;

function saysMissOrNonCompletion(original: string): boolean {
  return (
    /\b(not\s+done|missed|wasn'?t able|couldn'?t)\b/i.test(original) ||
    /\b(didn'?t|did not)\s+(do|finish|complete|get\s+it\s+done|get\s+that\s+done)\b/i.test(original) ||
    /\b(not\s+done|didn'?t|did not|didnt|missed)\b/i.test(original)
  );
}

/** Mirrors classifier completion proof path — excludes “accountability answer” masquerading as hedged consent. */
function looksLikeAccountabilityCompletionProof(original: string): boolean {
  if (saysMissOrNonCompletion(original)) return false;
  const completion =
    /\b(already\s+)?(got\s+it\s+done|got\s+that\s+done|did\s+it|finished|completed|knocked\s+it\s+out|done)\b/i.test(
      original
    ) || /^\s*\d+\s+\w+(\s+\w+)?\s*(today)?\s*$/i.test(original);
  if (!completion) return false;
  if (/\b(not\s+done|didn'?t|did not|didnt|missed)\b/i.test(original)) return false;
  return true;
}

function looksLikeBlockerReport(original: string): boolean {
  return /\bmy\s+blocker\b/i.test(original) || /\bblocker\s+was\b/i.test(original) || /\bblocker\s+is\b/i.test(original);
}

function hardExclusions(original: string, classification: Classification): { excluded: boolean; reason: string } {
  const t = original.trim();
  if (!t) return { excluded: true, reason: "empty_inbound" };

  if (classification.eventType === "user_yes" || classification.eventType === "user_no") {
    return { excluded: true, reason: "deterministic_yes_no_use_contract_path" };
  }

  if (messageHasKeywordPartialLanguage(t)) {
    return { excluded: true, reason: "keyword_partial_accountability_language" };
  }

  if (looksLikeAccountabilityCompletionProof(t)) {
    return { excluded: true, reason: "completion_or_proof_language" };
  }

  if (saysMissOrNonCompletion(t)) {
    return { excluded: true, reason: "miss_or_non_completion_language" };
  }

  if (looksLikeBlockerReport(t)) {
    return { excluded: true, reason: "blocker_report_language" };
  }

  return { excluded: false, reason: "" };
}

function matchInboundParse(original: string): AdaptiveConsentClarificationInboundParse | null {
  const lower = original.toLowerCase();
  const collapsed = lower.replace(/\s+/g, " ");

  if (
    /\bcan you explain\b/i.test(original) ||
    /\bwhat does that mean\b/i.test(original) ||
    /\bwhat do you mean\b/i.test(original) ||
    /\bclarify\b/i.test(original) ||
    /\bconfus(ed|ing)\b/i.test(original)
  ) {
    return "explanation_request";
  }

  if (
    /\bmaybe\b/i.test(original) ||
    /\bprobably\b/i.test(original) ||
    /\bnot sure\b/i.test(original) ||
    /\bunsure\b/i.test(original) ||
    /\bi think so\b/i.test(original) ||
    /\bidk\b/i.test(collapsed) ||
    /\bdunno\b/i.test(collapsed)
  ) {
    return "ambiguous";
  }

  if (/\bsounds good\b/i.test(original) || /\bi'?ll try\b/i.test(original) || /\bwe'?ll see\b/i.test(original)) {
    return "consent_adjacent";
  }

  if (original.includes("?") && collapsed.length <= 120) {
    return "question";
  }

  return null;
}

/**
 * Conservative consent-adjacent allowlist. If exclusions hit, returns shouldRoute:false
 * even when allowlist would match (product: default to normal inbound).
 */
export function evaluateAdaptiveProposalAmbiguousConsentGate(args: {
  inboundBody: string;
  classification: Classification;
}): AdaptiveProposalAmbiguousConsentGateResult {
  const original = (args.inboundBody || "").trim();
  const ex = hardExclusions(original, args.classification);
  if (ex.excluded) {
    return { shouldRoute: false, denyReason: ex.reason };
  }

  const inboundParse = matchInboundParse(original);
  if (inboundParse == null) {
    return { shouldRoute: false, denyReason: "no_consent_adjacent_allowlist_match" };
  }

  return { shouldRoute: true, inboundParse };
}
