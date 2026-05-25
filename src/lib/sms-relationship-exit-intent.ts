/**
 * Slice D-lite — deterministic relationship exit / subscription integrity routing.
 * Facts + gated policy only; V3 owns visible SMS. No Stripe/Twilio opt-out mutations.
 */

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import { isDoneAbandonmentContext } from "@/lib/v2-sms-accountability";

export type RelationshipExitIntentCategory =
  | "subscription_billing"
  | "app_abandonment"
  | "goal_abandonment"
  | "texting_soft_opt_out"
  | "frustration"
  | "coach_directed_exit"
  | "unclear";

export type RelationshipExitIntentConfidence = "high" | "medium" | "low";

export type SmsRelationshipExitDetection = {
  detected: boolean;
  category: RelationshipExitIntentCategory | null;
  confidence: RelationshipExitIntentConfidence;
  reasonCode: string | null;
  noProof: boolean;
  noOutcomeEvent: boolean;
  subscriptionIntegrity: boolean;
  textOptOutSoft: boolean;
  goalAbandonment: boolean;
};

/** Shared billing/cancel language (not SMS STOP compliance). */
export const SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE =
  /\b(cancel\s+my\s+subscription|cancel\s+my\s+membership|stop\s+charging\s+me|billing\s+issue|need\s+a\s+refund|refund\s+my|charged\s+me|i\s+want\s+to\s+cancel)\b/i;

const EXACT_STOP_COMPLIANCE_RE = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i;

const COACH_DIRECTED_EXIT_RE = /\b(?:i'?m|i\s+am)\s+done\s+with\s+you\b|\bdone\s+with\s+you\b/i;

const GOAL_ABANDONMENT_RE =
  /\bdone\s+with\s+(?:this\s+|the\s+)?(?:goal|goals|commitment|commitments)\b/i;

const GOAL_ABANDONMENT_EXPLICIT_RE =
  /\bi\s+don'?t\s+want\s+(?:this\s+|the\s+)?(?:goal|commitment)\s+anymore\b/i;

const APP_ABANDONMENT_RE =
  /\bdone\s+with\s+(?:this\s+|the\s+)?(?:app|apps|program|programs|summitt\s+mindset|subscription|subscriptions|membership|memberships)\b/i;

/** "Done with texting/SMS" quit — not accountability completion; distinct from stop-texting commands. */
const DONE_WITH_TEXTING_ABANDON_RE =
  /\b(?:i'?m|i\s+am)\s+done\s+with\s+(?:this\s+|the\s+)?(?:texts?|texting|sms)\b|\bdone\s+with\s+(?:this\s+|the\s+)?(?:texts?|texting|sms)\b/i;

function normalizeInbound(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function matchesTextingSoftOptOut(t: string): boolean {
  if (/\b(?:stop|please\s+stop)\s+texting(?:\s+me)?\b/i.test(t)) return true;
  if (/\bdon'?t\s+text\s+me\b/i.test(t)) return true;
  if (/\bdo\s+not\s+text\s+me\b/i.test(t)) return true;
  if (/\bleave\s+me\s+alone\b/i.test(t)) return true;
  if (/\bno\s+more\s+texts?\b/i.test(t)) return true;
  if (/\bstop\s+the\s+texts?\b/i.test(t)) return true;
  return false;
}

function matchesFrustration(t: string): boolean {
  if (/\bthis\s+is\s+annoying\b/i.test(t)) return true;
  if (/\bthis\s+isn'?t\s+helping\b/i.test(t)) return true;
  if (/\bthis\s+is\s+not\s+helping\b/i.test(t)) return true;
  if (/\bi\s+want\s+to\s+quit\b/i.test(t)) return true;
  if (/\bi\s+don'?t\s+want\s+to\s+do\s+this\s+anymore\b/i.test(t)) return true;
  if (/\bthis\s+(?:feels\s+)?pointless\b/i.test(t)) return true;
  if (/\bi'?m\s+frustrated\s+with\s+this\b/i.test(t)) return true;
  return false;
}

function isGoalAbandonmentPhrase(t: string): boolean {
  return GOAL_ABANDONMENT_RE.test(t) || GOAL_ABANDONMENT_EXPLICIT_RE.test(t);
}

function isDoneWithTextingAbandonmentPhrase(t: string): boolean {
  if (isGoalAbandonmentPhrase(t)) return false;
  return DONE_WITH_TEXTING_ABANDON_RE.test(t);
}

function isAppAbandonmentPhrase(t: string): boolean {
  if (isGoalAbandonmentPhrase(t)) return false;
  if (APP_ABANDONMENT_RE.test(t)) return true;
  if (isDoneAbandonmentContext(t)) {
    if (/\b(texts?|texting|sms)\b/i.test(t)) return false;
    if (GOAL_ABANDONMENT_RE.test(t)) return false;
    return true;
  }
  return false;
}

function buildDetection(
  category: RelationshipExitIntentCategory,
  confidence: RelationshipExitIntentConfidence,
  reasonCode: string
): SmsRelationshipExitDetection {
  const subscriptionIntegrity = category === "subscription_billing";
  const textOptOutSoft = category === "texting_soft_opt_out";
  const goalAbandonment = category === "goal_abandonment";
  const actionable = confidence === "high" || confidence === "medium";
  return {
    detected: actionable,
    category,
    confidence,
    reasonCode,
    noProof: actionable,
    noOutcomeEvent: actionable,
    subscriptionIntegrity,
    textOptOutSoft,
    goalAbandonment,
  };
}

function noneDetection(): SmsRelationshipExitDetection {
  return {
    detected: false,
    category: null,
    confidence: "low",
    reasonCode: null,
    noProof: false,
    noOutcomeEvent: false,
    subscriptionIntegrity: false,
    textOptOutSoft: false,
    goalAbandonment: false,
  };
}

export function detectSmsRelationshipExitIntent(text: string): SmsRelationshipExitDetection {
  const t = normalizeInbound(text);
  if (!t) return noneDetection();

  if (EXACT_STOP_COMPLIANCE_RE.test(t)) {
    return noneDetection();
  }

  if (SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE.test(t)) {
    return buildDetection("subscription_billing", "high", "subscription_billing_phrase");
  }

  if (COACH_DIRECTED_EXIT_RE.test(t)) {
    return buildDetection("coach_directed_exit", "high", "coach_directed_exit_phrase");
  }

  if (isGoalAbandonmentPhrase(t)) {
    return buildDetection("goal_abandonment", "high", "goal_abandonment_phrase");
  }

  if (isDoneWithTextingAbandonmentPhrase(t)) {
    return buildDetection("texting_soft_opt_out", "high", "done_with_texting_abandonment");
  }

  if (matchesTextingSoftOptOut(t)) {
    return buildDetection("texting_soft_opt_out", "high", "texting_soft_opt_out_phrase");
  }

  if (isAppAbandonmentPhrase(t)) {
    return buildDetection("app_abandonment", "high", "app_abandonment_phrase");
  }

  if (matchesFrustration(t)) {
    return buildDetection("frustration", "medium", "frustration_phrase");
  }

  return noneDetection();
}

export function shouldDeferRelationshipExitToGoalHandoff(args: {
  detection: SmsRelationshipExitDetection;
  commitmentChangeIntentLikely: boolean;
  plannedInterruptionActionable: boolean;
}): boolean {
  if (!args.detection.detected || !args.detection.goalAbandonment) return false;
  if (args.plannedInterruptionActionable) return false;
  return args.commitmentChangeIntentLikely;
}

export function isRelationshipExitLaneActive(args: {
  detection: SmsRelationshipExitDetection;
  deferToGoalHandoff: boolean;
}): boolean {
  if (args.deferToGoalHandoff) return false;
  if (!args.detection.detected) return false;
  return args.detection.confidence === "high" || args.detection.confidence === "medium";
}

export function applyRelationshipExitGatedOverride(
  detection: SmsRelationshipExitDetection
): V2InboundGatedDecision {
  return {
    mode: "relationship_exit_integrity",
    final_event_type: null,
    decision_reason: `relationship_exit:${detection.category ?? "unclear"}:${detection.reasonCode ?? "unknown"}`,
    confidence_used: null,
    should_write_outcome_event: false,
    should_open_blocker_capture: false,
    reply_style: "relationship_exit",
    overrode_deterministic: true,
  };
}

export type InboundV3RelationshipExitFacts = {
  detected: true;
  category: RelationshipExitIntentCategory;
  confidence: RelationshipExitIntentConfidence;
  reason_code: string | null;
  no_outcome_event: true;
  no_proof: true;
  should_not_say_completed: true;
  should_not_claim_cancelled: true;
  should_not_claim_opted_out: true;
  exact_stop_required_for_carrier_opt_out: true;
  subscription_integrity: boolean;
  text_opt_out_soft: boolean;
  goal_abandonment_deferred_to_handoff: boolean;
  suggested_next_moves: readonly string[];
  support_or_account_path: string | null;
};

export function resolveSmsSupportOrAccountPath(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/user`;
}

export function buildInboundV3RelationshipExitFacts(args: {
  detection: SmsRelationshipExitDetection;
  goalAbandonmentDeferredToHandoff: boolean;
}): InboundV3RelationshipExitFacts {
  const category = args.detection.category ?? "unclear";
  const moves: string[] = [];
  if (category === "texting_soft_opt_out" || category === "frustration" || category === "app_abandonment") {
    moves.push("pause_or_fewer_texts");
    moves.push("carrier_stop_instructions");
  }
  if (category === "subscription_billing") {
    moves.push("billing_help");
  }
  if (category === "goal_abandonment" || category === "frustration" || category === "app_abandonment") {
    moves.push("change_goal");
    moves.push("reset_bar");
  }
  if (category === "coach_directed_exit" || category === "frustration") {
    moves.push("reset_bar");
  }

  return {
    detected: true,
    category,
    confidence: args.detection.confidence,
    reason_code: args.detection.reasonCode,
    no_outcome_event: true,
    no_proof: true,
    should_not_say_completed: true,
    should_not_claim_cancelled: true,
    should_not_claim_opted_out: true,
    exact_stop_required_for_carrier_opt_out: true,
    subscription_integrity: args.detection.subscriptionIntegrity,
    text_opt_out_soft: args.detection.textOptOutSoft,
    goal_abandonment_deferred_to_handoff: args.goalAbandonmentDeferredToHandoff,
    suggested_next_moves: moves.length > 0 ? moves : ["pause_or_fewer_texts", "billing_help", "change_goal"],
    support_or_account_path: category === "subscription_billing" ? resolveSmsSupportOrAccountPath() : null,
  };
}

export function buildRelationshipExitLaneGuardrails(): string {
  return `
RELATIONSHIP_EXIT (relationship_exit facts when present):
- Server did NOT score this as today's accountability completion; do NOT congratulate or treat as proof.
- Do NOT shame, beg, or use generic motivation filler.
- Do NOT say the subscription is cancelled, billing stopped, or membership ended unless server state explicitly proves it (it does not here).
- Do NOT say SMS texts are fully stopped or that they are unsubscribed unless exact STOP compliance ran or comms prefs write succeeded (neither is implied here).
- Do NOT convert non-exact "stop texting" into carrier opt-out — do not claim you unsubscribed them.
- If text_opt_out_soft: you MAY mention once, calmly: "Reply STOP to opt out of all texts" — not repeatedly.
- If subscription_integrity: point to support_or_account_path when set; otherwise say they can manage billing in their account on the site without inventing URLs.
- If frustration or app_abandonment: acknowledge plainly; offer ONE useful path (pause/fewer texts, reset bar, change goal, or billing help) — not a menu lecture.
- If goal_abandonment_deferred_to_handoff: follow commitment-change handoff tone — do not claim the goal already changed.
- Never say they completed the goal or today's bar.`;
}
