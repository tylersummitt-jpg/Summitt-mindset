import { inboundSignalsCompletion } from "@/lib/north-star-coach-sms";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";

/** Clear completion / yes-no answers that must not be hijacked by open-question lanes. */
export function isClearAccountabilityCompletionReply(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;

  if (/\btomorrow\b/i.test(trimmed) && /\b(will|have to|gonna|going to|'ll)\b/i.test(trimmed)) {
    return false;
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
  if (/\b(i\s+)?did\s+it\b/i.test(lower)) return true;
  if (/\b(got\s+it\s+done|got\s+that\s+done|finished\s+it|knocked\s+it\s+out)\b/i.test(lower)) return true;

  return false;
}
