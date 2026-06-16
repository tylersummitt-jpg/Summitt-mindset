/**
 * Substantive self-reported completion — proof-spine eligible without live accountability prompt.
 * Bare yes/no/done and future-only plans are excluded.
 */

import {
  inboundHasExplicitCompletionClause,
  inboundHasExplicitMissClause,
  inboundHasExplicitPartialClause,
  looksLikeFutureOrConditionalCompletionLanguage,
} from "@/lib/inbound-short-answer-clauses";
import { classifyInboundSmsSafetyTier } from "@/lib/sms-inbound-safety";
import { SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE } from "@/lib/sms-relationship-exit-intent";
import { hasFuturePlanIntentLanguage } from "@/lib/pending-plan-proof";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

const BARE_SHORT_ACK_RE =
  /^\s*(yes|y|yeah|yep|yup|sure|ok|okay|absolutely|definitely|totally|for sure|heck yeah|sure did|done|sounds good|love it)\s*[!.]*\s*$/i;

function looksLikeSupportCancelOrBillingIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE.test(t)) return true;
  if (/\b(cancel|help)\s+(my\s+)?(account|subscription|membership|billing)\b/i.test(t)) return true;
  if (/\bhelp\s+cancel\b/i.test(t)) return true;
  if (
    /\b(need|want)\s+to\s+cancel\b/i.test(t) &&
    /\b(subscription|membership|account|billing|charging|sign\s+up)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function looksLikeGoalChangeIntent(text: string): boolean {
  return (
    /\b(change|update|edit)\s+my\s+goal\b/i.test(text) ||
    /\bwant\s+to\s+change\s+my\s+goal\b/i.test(text)
  );
}

/**
 * True when inbound text is a self-contained, today-scoped completion report suitable for user_yes proof.
 */
export function isSubstantiveSelfReportedCompletionForProof(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;

  if (BARE_SHORT_ACK_RE.test(t)) return false;

  if (looksLikeSupportCancelOrBillingIntent(t)) return false;
  if (isLikelySmsComplianceOrOptOutTurn(t)) return false;
  const safety = classifyInboundSmsSafetyTier(t);
  if (safety.tier === "crisis" || safety.tier === "harmful_request") return false;
  if (looksLikeGoalChangeIntent(t)) return false;

  if (inboundHasExplicitMissClause(t) && !inboundHasExplicitCompletionClause(t)) return false;
  if (inboundHasExplicitPartialClause(t) && !inboundHasExplicitCompletionClause(t)) return false;

  if (inboundHasExplicitCompletionClause(t)) {
    if (
      looksLikeFutureOrConditionalCompletionLanguage(t) &&
      !/\b(today|this morning|this evening)\b/i.test(t) &&
      !/\b(did\s+it|got\s+my|got\s+in|completed|finished)\b/i.test(t)
    ) {
      return false;
    }
    return true;
  }

  if (hasFuturePlanIntentLanguage(t)) return false;
  if (looksLikeFutureOrConditionalCompletionLanguage(t)) return false;

  return false;
}
