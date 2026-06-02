import { inboundSignalsCompletion } from "@/lib/north-star-coach-sms";
import {
  extractCompletionDisqualifiers,
  isReportedCompletionRelationshipCandidate,
} from "@/lib/pending-plan-proof";
import { classifyV2InboundReply, type V2InboundEventType } from "@/lib/v2-sms-accountability";

/**
 * Clear yes/no or hardened reported completion — for open-question lane hijack prevention only.
 * Does NOT authorize user_yes persistence; use inbound_meaning.persistence_decision for writes.
 */
export function isClearAccountabilityCompletionReply(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (extractCompletionDisqualifiers(trimmed).length > 0) return false;

  if (/\btomorrow\b/i.test(trimmed) && /\b(will|have to|gonna|going to|'ll)\b/i.test(trimmed)) {
    return false;
  }

  if (isReportedCompletionRelationshipCandidate(trimmed)) {
    return true;
  }

  const classification = classifyV2InboundReply(trimmed);

  if (classification.eventType === "user_no") {
    return (
      classification.normalizedHint === null ||
      classification.normalizedHint === "unclear" ||
      Boolean(classification.normalizedHint?.includes("honest"))
    );
  }
  if (classification.eventType === "user_partial") {
    return classification.normalizedHint === "keyword_partial";
  }
  if (classification.eventType !== "user_yes") return false;

  if (inboundSignalsCompletion(trimmed)) return true;

  const hint = classification.normalizedHint ?? "";
  if (
    hint.startsWith("completion_") ||
    hint.startsWith("success_reflection") ||
    hint === null
  ) {
    return true;
  }

  const lower = trimmed.toLowerCase();
  if (/^(yes|y|yeah|yep|yup|no|n|nope|nah)\b/i.test(lower)) return true;
  if (/^(done|got it|finished|sure\s+did)\b/i.test(lower)) return true;
  if (/\b(i\s+)?did\s+it\b/i.test(lower) && !/\b(did not|didn't|almost|wish)\b/i.test(lower)) {
    return true;
  }
  if (/\b(got\s+it\s+done|got\s+that\s+done|finished\s+it|knocked\s+it\s+out)\b/i.test(lower)) {
    return true;
  }

  return false;
}

/** @deprecated Use inbound_meaning.persistence_decision — kept for callers migrating off classifier-only promotion. */
export function effectiveInboundCompletionEventType(
  raw: string,
  deterministicEventType: V2InboundEventType
): V2InboundEventType {
  if (!isReportedCompletionRelationshipCandidate(raw.trim())) return deterministicEventType;
  if (deterministicEventType === "user_no") return deterministicEventType;
  return "user_yes";
}
