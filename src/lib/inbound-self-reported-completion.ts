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

function looksLikeFutureOrIntentOnlyStatusUpdate(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (hasFuturePlanIntentLanguage(t)) return true;
  if (looksLikeFutureOrConditionalCompletionLanguage(t)) return true;
  if (/\b(i\s+)?(will|gonna|going\s+to|plan\s+to|need\s+to|have\s+to|want\s+to)\b/i.test(t)) return true;
  if (/\b(later|tomorrow|tonight|this\s+evening)\b/i.test(t) && !/\b(showered|ready|got\s+up|getting\s+up)\b/i.test(t)) {
    return true;
  }
  return false;
}

const ROUTINE_COMMITMENT_THEME_RE =
  /\b(wake\s*up|waking\s*up|get\s+(?:out\s+of\s+)?bed|out\s+of\s+bed|snooz|alarm|on\s*time|morning\s+routine|shower|get\s+ready|getting\s+ready|ready\s+for\s+(?:the\s+)?day)\b/i;

const ROUTINE_STATUS_COMPLETION_RE =
  /\b(getting\s+up|got\s+up|woke\s+up|i'?m\s+up|out\s+of\s+bed|showered|got\s+showered|getting\s+showered|took\s+a\s+shower|ready\s+for\s+(?:the\s+)?day|got\s+ready|getting\s+ready)\b/i;

export type CommitmentAlignedRoutineStatusArgs = {
  raw: string;
  commitmentBehaviorStatement?: string | null;
  effectiveAsk?: string | null;
  commitmentTitle?: string | null;
};

/**
 * Narrow server-only check: routine progress/status counts as substantive completion
 * only when active commitment language aligns with wake-up / shower / get-ready themes.
 */
export function isCommitmentAlignedRoutineStatusUpdateCompletion(
  args: CommitmentAlignedRoutineStatusArgs
): boolean {
  const t = args.raw.trim();
  if (!t || t.length < 12) return false;
  if (BARE_SHORT_ACK_RE.test(t)) return false;
  if (looksLikeSupportCancelOrBillingIntent(t)) return false;
  if (isLikelySmsComplianceOrOptOutTurn(t)) return false;
  const safety = classifyInboundSmsSafetyTier(t);
  if (safety.tier === "crisis" || safety.tier === "harmful_request") return false;
  if (looksLikeGoalChangeIntent(t)) return false;
  if (looksLikeFutureOrIntentOnlyStatusUpdate(t)) return false;
  if (inboundHasExplicitMissClause(t) && !inboundHasExplicitCompletionClause(t)) return false;

  const commitmentBlob = [
    args.commitmentBehaviorStatement,
    args.effectiveAsk,
    args.commitmentTitle,
  ]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" ");
  if (!commitmentBlob.trim()) return false;
  if (!ROUTINE_COMMITMENT_THEME_RE.test(commitmentBlob)) return false;
  if (!ROUTINE_STATUS_COMPLETION_RE.test(t)) return false;
  return true;
}

export type SubstantiveSelfReportedCompletionOptions = {
  commitmentBehaviorStatement?: string | null;
  effectiveAsk?: string | null;
  commitmentTitle?: string | null;
};

/**
 * True when inbound text is a self-contained, today-scoped completion report suitable for user_yes proof.
 */
export function isSubstantiveSelfReportedCompletionForProof(
  raw: string,
  options?: SubstantiveSelfReportedCompletionOptions
): boolean {
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

  if (
    options &&
    isCommitmentAlignedRoutineStatusUpdateCompletion({
      raw: t,
      commitmentBehaviorStatement: options.commitmentBehaviorStatement,
      effectiveAsk: options.effectiveAsk,
      commitmentTitle: options.commitmentTitle,
    })
  ) {
    return true;
  }

  return false;
}
