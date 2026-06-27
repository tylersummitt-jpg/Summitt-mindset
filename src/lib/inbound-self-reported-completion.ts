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
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import { hasFuturePlanIntentLanguage } from "@/lib/pending-plan-proof";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import {
  isAuthoritativeReconciledGoalChangeIntent,
} from "@/lib/openai-relationship-turn-understanding-v1";

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

const STEP_THEME_RE =
  /\b(steps?|walk(?:ing|ed)?|10,?000|ten\s+thousand|\d[\d,]*\s+steps?|miles?)\b/i;

const DENTAL_ACTIVITY_RE = /\b(brush(?:ed|ing)?\s+(?:my\s+)?teeth|teeth|floss(?:ed|ing)?)\b/i;

const EXPLICIT_GOAL_OF_RE =
  /\b(?:hit|met|completed|finished|reached|achieved)\s+(?:the|my|today'?s?)\s+goal\s+of\s+(.+)/i;

const ALIGNMENT_STOP_WORDS = new Set([
  "the",
  "my",
  "a",
  "an",
  "of",
  "to",
  "for",
  "and",
  "or",
  "today",
  "tonight",
  "though",
  "well",
  "this",
  "morning",
  "evening",
  "goal",
  "goals",
]);

function significantAlignmentTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !ALIGNMENT_STOP_WORDS.has(w));
  return new Set(tokens);
}

function tokenOverlapCount(a: string, b: string): number {
  const ta = significantAlignmentTokens(a);
  const tb = significantAlignmentTokens(b);
  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap += 1;
  }
  return overlap;
}

function extractExplicitClaimedGoalObject(raw: string): string | null {
  const m = raw.trim().match(EXPLICIT_GOAL_OF_RE);
  if (!m?.[1]) return null;
  return m[1]
    .replace(/\b(today|tonight|this morning|this evening|though|well)\b/gi, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function commitmentBlobFromContext(ctx: CompletionAlignmentContext): string {
  return [ctx.commitmentBehaviorStatement, ctx.effectiveAsk, ctx.commitmentTitle]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" ")
    .trim();
}

function claimedObjectAlignsWithCommitment(
  claimedObject: string,
  commitmentBlob: string,
  rawMessage: string
): boolean {
  if (!claimedObject.trim() || !commitmentBlob.trim()) return true;

  if (tokenOverlapCount(claimedObject, commitmentBlob) >= 1) return true;

  const claimedLower = claimedObject.toLowerCase();
  const blobLower = commitmentBlob.toLowerCase();
  const commitmentIsSteps = STEP_THEME_RE.test(commitmentBlob);
  const messageHasSteps = STEP_THEME_RE.test(rawMessage);
  const claimedIsDental = DENTAL_ACTIVITY_RE.test(claimedObject);
  const messageIsDental = DENTAL_ACTIVITY_RE.test(rawMessage);

  if (commitmentIsSteps) {
    if (STEP_THEME_RE.test(claimedObject) || messageHasSteps) return true;
    if (claimedIsDental || (messageIsDental && !messageHasSteps)) return false;
  }

  if (ROUTINE_COMMITMENT_THEME_RE.test(commitmentBlob)) {
    if (ROUTINE_STATUS_COMPLETION_RE.test(rawMessage) || ROUTINE_COMMITMENT_THEME_RE.test(claimedObject)) {
      return true;
    }
  }

  if (claimedLower.length >= 6 && blobLower.includes(claimedLower.slice(0, Math.min(claimedLower.length, 24)))) {
    return true;
  }

  return false;
}

function hasDominantOffGoalActivityWithoutAnchor(raw: string, commitmentBlob: string): boolean {
  if (!commitmentBlob.trim()) return false;
  if (!STEP_THEME_RE.test(commitmentBlob)) return false;
  if (STEP_THEME_RE.test(raw)) return false;
  if (DENTAL_ACTIVITY_RE.test(raw)) return true;
  return false;
}

export type CompletionAlignmentContext = {
  commitmentBehaviorStatement?: string | null;
  effectiveAsk?: string | null;
  commitmentTitle?: string | null;
};

export type CompletionAlignmentSkipReason =
  | "completion_mismatch_active_commitment"
  | "off_goal_completion_claim";

export type CompletionAlignmentResult = {
  checked: true;
  aligned: boolean;
  skipReason?: CompletionAlignmentSkipReason;
};

/**
 * Narrow gate: block proof when the user names a different goal object than the active commitment.
 * Generic "hit the goal" without naming a conflicting object stays aligned.
 */
export function evaluateCompletionAlignmentForProof(
  raw: string,
  ctx: CompletionAlignmentContext
): CompletionAlignmentResult {
  const t = raw.trim();
  const commitmentBlob = commitmentBlobFromContext(ctx);
  if (!t || !commitmentBlob) {
    return { checked: true, aligned: true };
  }

  const explicitGoalObject = extractExplicitClaimedGoalObject(t);
  if (explicitGoalObject) {
    if (!claimedObjectAlignsWithCommitment(explicitGoalObject, commitmentBlob, t)) {
      return { checked: true, aligned: false, skipReason: "off_goal_completion_claim" };
    }
    return { checked: true, aligned: true };
  }

  if (hasDominantOffGoalActivityWithoutAnchor(t, commitmentBlob)) {
    return { checked: true, aligned: false, skipReason: "off_goal_completion_claim" };
  }

  return { checked: true, aligned: true };
}

/** Explicit on-goal completion in inbound/coalesced body — alignment-checked when commitment context exists. */
export function detectExplicitAlignedInboundCompletion(
  raw: string,
  alignmentCtx?: CompletionAlignmentContext | null
): boolean {
  const t = raw.trim();
  if (!t || !inboundHasExplicitCompletionClause(t)) return false;
  if (!alignmentCtx) return true;
  return evaluateCompletionAlignmentForProof(t, alignmentCtx).aligned;
}

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

function passesCommitmentAlignmentForProof(
  raw: string,
  options?: SubstantiveSelfReportedCompletionOptions
): boolean {
  if (!options) return true;
  const alignment = evaluateCompletionAlignmentForProof(raw, options);
  return alignment.aligned;
}

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
    if (!passesCommitmentAlignmentForProof(t, options)) return false;
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

/** High-confidence TU threshold for semantic completion alignment unlock. */
export const SEMANTIC_TU_HIGH_CONFIDENCE_THRESHOLD = 0.75;

export type SemanticCompletionTense =
  | "completed_today"
  | "future_plan"
  | "partial"
  | "unrelated"
  | "ambiguous";

export type SemanticCompletionAlignment = "aligned" | "off_goal" | "ambiguous";

export type SemanticCompletionConfidence = "high" | "medium" | "low";

export type SemanticCompletionAlignmentFromTurnUnderstandingResult = {
  checked: boolean;
  source: "turn_understanding";
  completion_claimed: boolean;
  completion_object_preview?: string;
  tense: SemanticCompletionTense;
  alignment: SemanticCompletionAlignment;
  confidence: SemanticCompletionConfidence;
  reason: string;
};

function semanticConfidenceFromTuScore(score: number): SemanticCompletionConfidence {
  if (score >= SEMANTIC_TU_HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function tenseFromTurnUnderstandingTemporalScope(
  scope: string | null | undefined
): SemanticCompletionTense {
  switch (scope) {
    case "today":
      return "completed_today";
    case "future":
      return "future_plan";
    case "yesterday":
    case "past":
      return "unrelated";
    default:
      return "ambiguous";
  }
}

function cappedSemanticPreview(text: string, max = 64): string {
  const t = text.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function evidenceQuotesGroundedInInbound(raw: string, quotes: string[]): boolean {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;
  for (const quote of quotes) {
    const q = quote.trim().toLowerCase();
    if (q.length >= 4 && normalized.includes(q)) return true;
  }
  return false;
}

function deterministicMeaningAllowsSemanticTuCompletion(
  meaning: InboundMeaningFacts,
  raw: string
): boolean {
  if (
    meaning.persistence_decision === "write_user_no" ||
    meaning.persistence_decision === "write_user_partial"
  ) {
    return false;
  }
  if (meaning.relationship_meaning === "miss" && inboundHasExplicitMissClause(raw)) {
    return false;
  }
  if (meaning.relationship_meaning === "partial_attempt" && inboundHasExplicitPartialClause(raw)) {
    return false;
  }
  if (meaning.relationship_meaning === "plan_made") return false;
  return true;
}

/**
 * Narrow semantic backup: use existing reconciled Turn Understanding to interpret aligned
 * completed-today claims when deterministic proof did not already unlock user_yes.
 */
export function evaluateSemanticCompletionAlignmentFromTurnUnderstanding(args: {
  rawBody: string;
  commitmentBehaviorStatement?: string | null;
  effectiveAsk?: string | null;
  commitmentTitle?: string | null;
  reconciledTurnUnderstanding: ReconciledTurnUnderstanding | null | undefined;
  deterministicMeaning: InboundMeaningFacts;
}): SemanticCompletionAlignmentFromTurnUnderstandingResult {
  const unchecked = (
    reason: string,
    partial?: Partial<SemanticCompletionAlignmentFromTurnUnderstandingResult>
  ): SemanticCompletionAlignmentFromTurnUnderstandingResult => ({
    checked: false,
    source: "turn_understanding",
    completion_claimed: false,
    tense: "ambiguous",
    alignment: "ambiguous",
    confidence: "low",
    reason,
    ...partial,
  });

  const raw = args.rawBody.trim();
  const tu = args.reconciledTurnUnderstanding;
  const meaning = args.deterministicMeaning;

  if (meaning.persistence_decision === "write_user_yes_today") {
    return unchecked("deterministic_write_user_yes_already");
  }

  if (!raw || !tu?.proposal) {
    return unchecked("turn_understanding_unavailable");
  }

  if (isAuthoritativeReconciledGoalChangeIntent(tu.reconciled_goal_change_intent)) {
    return unchecked("goal_change_not_outcome_write");
  }

  if (!deterministicMeaningAllowsSemanticTuCompletion(meaning, raw)) {
    return unchecked("deterministic_hard_block");
  }

  if (
    isLikelySmsComplianceOrOptOutTurn(raw) ||
    classifyInboundSmsSafetyTier(raw).tier === "crisis" ||
    classifyInboundSmsSafetyTier(raw).tier === "harmful_request"
  ) {
    return unchecked("safety_or_compliance_block");
  }

  if (hasFuturePlanIntentLanguage(raw) || looksLikeFutureOrConditionalCompletionLanguage(raw)) {
    return unchecked("deterministic_future_plan_block", {
      checked: true,
      tense: "future_plan",
    });
  }

  if (inboundHasExplicitMissClause(raw) && !inboundHasExplicitCompletionClause(raw)) {
    return unchecked("deterministic_miss_block", { checked: true });
  }

  if (inboundHasExplicitPartialClause(raw) && !inboundHasExplicitCompletionClause(raw)) {
    return unchecked("deterministic_partial_block", {
      checked: true,
      tense: "partial",
    });
  }

  const proposal = tu.proposal;
  const confidence = semanticConfidenceFromTuScore(tu.confidence);
  const tense = tenseFromTurnUnderstandingTemporalScope(proposal.temporal_scope);
  const evidence = proposal.evidence_quotes ?? [];
  const completionObjectPreview = cappedSemanticPreview(
    evidence[0]?.trim() || proposal.user_turn_summary.trim()
  );

  const baseChecked: SemanticCompletionAlignmentFromTurnUnderstandingResult = {
    checked: true,
    source: "turn_understanding",
    completion_claimed: false,
    completion_object_preview: completionObjectPreview || undefined,
    tense,
    alignment: "ambiguous",
    confidence,
    reason: "semantic_completion_not_claimed",
  };

  if (tu.reconciled_relationship_meaning !== "reported_completion") {
    return { ...baseChecked, reason: "tu_not_reported_completion" };
  }

  if (proposal.commitment_outcome_recommendation !== "write_user_yes_today") {
    return {
      ...baseChecked,
      reason: `tu_outcome_${proposal.commitment_outcome_recommendation}`,
    };
  }

  if (proposal.persistence_safety !== "safe_to_write") {
    return { ...baseChecked, reason: `tu_persistence_${proposal.persistence_safety}` };
  }

  if (tense !== "completed_today") {
    return { ...baseChecked, reason: `tu_temporal_${proposal.temporal_scope}` };
  }

  if (!evidenceQuotesGroundedInInbound(raw, evidence)) {
    return { ...baseChecked, reason: "tu_evidence_not_grounded_in_inbound" };
  }

  const alignment = evaluateCompletionAlignmentForProof(raw, {
    commitmentBehaviorStatement: args.commitmentBehaviorStatement ?? null,
    effectiveAsk: args.effectiveAsk ?? null,
    commitmentTitle: args.commitmentTitle ?? null,
  });

  if (!alignment.aligned) {
    return {
      ...baseChecked,
      completion_claimed: true,
      alignment: alignment.skipReason === "off_goal_completion_claim" ? "off_goal" : "ambiguous",
      reason: alignment.skipReason ?? "completion_alignment_failed",
    };
  }

  if (confidence !== "high") {
    return {
      ...baseChecked,
      completion_claimed: true,
      alignment: "aligned",
      reason: `tu_confidence_${confidence}`,
    };
  }

  return {
    checked: true,
    source: "turn_understanding",
    completion_claimed: true,
    completion_object_preview: completionObjectPreview || undefined,
    tense: "completed_today",
    alignment: "aligned",
    confidence: "high",
    reason: "semantic_turn_understanding_aligned_completed_today",
  };
}

export function semanticCompletionTelemetryFromEvaluation(
  evaluation: SemanticCompletionAlignmentFromTurnUnderstandingResult,
  persistDecisionReason?: string | null
): Record<string, unknown> {
  return {
    semantic_completion_checked: evaluation.checked,
    semantic_completion_source: evaluation.checked ? "turn_understanding" : "none",
    semantic_completion_claimed: evaluation.completion_claimed,
    semantic_completion_alignment: evaluation.alignment,
    semantic_completion_confidence: evaluation.confidence,
    semantic_completion_tense: evaluation.tense,
    ...(evaluation.completion_object_preview
      ? { semantic_completion_object_preview: evaluation.completion_object_preview }
      : {}),
    ...(persistDecisionReason ? { proof_persist_decision_reason: persistDecisionReason } : {}),
  };
}
