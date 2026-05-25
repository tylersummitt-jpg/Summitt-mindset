/**
 * Slice B Phase 1 — SMS identity clarification / integrity routing.
 * Facts + gated policy only; V3 owns visible SMS. No profile or version mutations.
 */

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import {
  extractCandidateBarsFromSms,
  isIdentityLikeGoalCandidate,
  isVagueOrInvalidSmsGoalCandidate,
} from "@/lib/v2-sms-commitment-change";

export type IdentityEditIntentCategory =
  | "explicit_identity_edit"
  | "identity_review_request"
  | "identity_aspiration"
  | "goal_identity_confusion"
  | "identity_discouragement"
  | "identity_rejection"
  | "none";

export type IdentityEditIntentConfidence = "high" | "medium" | "low";

export type SmsIdentityEditDetection = {
  detected: boolean;
  category: IdentityEditIntentCategory;
  confidence: IdentityEditIntentConfidence;
  reasonCode: string | null;
  explicitIdentityLanguage: boolean;
  noIdentityMutation: true;
  shouldRouteToIdentityLane: boolean;
  shouldInviteVictoryRoomReview: boolean;
  goalConfusionRisk: boolean;
  discouragementRisk: boolean;
};

const EXPLICIT_IDENTITY_EDIT_RE =
  /\b(?:change|update|switch)\s+(?:my\s+)?identity\b|\bmy\s+identity\s+changed\b|\bidentity\s+(?:has\s+)?changed\b/i;

const IDENTITY_REVIEW_RE =
  /\b(?:that|this)\s+identity\s+doesn'?t\s+fit\b|\bidentity\s+doesn'?t\s+fit\b|\bcan\s+we\s+change\s+(?:my\s+)?identity\b|\bcan\s+we\s+change\s+who\s+i'?m\s+becoming\b|\bwho\s+i'?m\s+becoming\b|\bwho\s+i\s+am\s+becoming\b/i;

const IDENTITY_REJECTION_RE =
  /\b(?:i'?m|i\s+am)\s+done\s+with\s+(?:this\s+|the\s+)?identity\b|\bdone\s+with\s+(?:this\s+|the\s+)?identity\b|\bi\s+don'?t\s+care\s+about\s+(?:this\s+|that\s+|the\s+)?identity\b/i;

const GOAL_IDENTITY_CONFUSION_RE =
  /\b(?:change|switch)\s+(?:my\s+)?(?:the\s+)?goal\s+to\s+(?:be(?:ing)?|become)\b|\b(?:my\s+)?goal\s+should\s+be\s+to\s+(?:be(?:ing)?|become)\b|\bi\s+want\s+my\s+goal\s+to\s+be\s+(?:being\s+)?/i;

const ASPIRATION_RE =
  /\b(?:i\s+)?want\s+to\s+(?:be|become)\s+(?:a\s+)?(?:better|more)\b|\b(?:i'?m|i\s+am)\s+trying\s+to\s+become\b|\b(?:i'?m|i\s+am)\s+a\s+\w+.*\b(?:want|need)\s+to\s+(?:lead|become)\b/i;

const DISCOURAGEMENT_RE =
  /\bi\s+failed\b.*\bnot\s+who\s+i\s+said\b|\bnot\s+who\s+i\s+said\s+i\s+was\b|\bi'?m\s+not\s+(?:a\s+)?disciplined\b|\bthat'?s\s+not\s+me\b|\bi'?m\s+not\s+who\s+i'?m\s+becoming\b/i;

function normalizeInbound(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function hasExplicitIdentityLanguage(text: string): boolean {
  const t = normalizeInbound(text);
  if (!t) return false;
  if (/\bidentity\b/i.test(t)) return true;
  if (/\bwho\s+i'?m\s+becoming\b/i.test(t)) return true;
  if (/\bwho\s+i\s+am\s+becoming\b/i.test(t)) return true;
  return false;
}

/** Identity-shaped goal tails (who-you-are) — not safe for A3 handoff over identity lane. */
function isIdentityShapedSmsGoalConfusionCandidate(text: string): boolean {
  const b = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!b) return true;
  if (isIdentityLikeGoalCandidate(b)) return true;
  if (/^(?:to\s+)?(?:be(?:ing)?\s+)?(?:a\s+)?(?:better|more)\b/.test(b)) return true;
  if (/\b(?:become|be)\s+(?:a\s+)?(?:better|more)\s+\w+/i.test(b)) return true;
  if (/\bbe(?:ing)?\s+a\s+better\b/i.test(b)) return true;
  if (/\bbe(?:ing)?\s+more\s+(?:disciplined|consistent|patient|focused)\b/i.test(b)) return true;
  return false;
}

/** True when a concrete daily-behavior candidate exists (goal handoff should win). */
export function hasSafeBehaviorGoalCandidateForIdentityConfusion(text: string): boolean {
  const extracted = extractCandidateBarsFromSms(text);
  const c = extracted.candidateNewBar?.trim() || extracted.candidateTightenedBar?.trim() || null;
  if (!c) return false;
  if (isIdentityShapedSmsGoalConfusionCandidate(c)) return false;
  if (isVagueOrInvalidSmsGoalCandidate(c)) return false;
  return true;
}

function noneDetection(): SmsIdentityEditDetection {
  return {
    detected: false,
    category: "none",
    confidence: "low",
    reasonCode: null,
    explicitIdentityLanguage: false,
    noIdentityMutation: true,
    shouldRouteToIdentityLane: false,
    shouldInviteVictoryRoomReview: false,
    goalConfusionRisk: false,
    discouragementRisk: false,
  };
}

function buildDetection(
  category: IdentityEditIntentCategory,
  confidence: IdentityEditIntentConfidence,
  reasonCode: string,
  args: {
    explicitIdentityLanguage: boolean;
    shouldRouteToIdentityLane: boolean;
    shouldInviteVictoryRoomReview: boolean;
    goalConfusionRisk: boolean;
    discouragementRisk: boolean;
  }
): SmsIdentityEditDetection {
  return {
    detected: category !== "none",
    category,
    confidence,
    reasonCode,
    explicitIdentityLanguage: args.explicitIdentityLanguage,
    noIdentityMutation: true,
    shouldRouteToIdentityLane: args.shouldRouteToIdentityLane,
    shouldInviteVictoryRoomReview: args.shouldInviteVictoryRoomReview,
    goalConfusionRisk: args.goalConfusionRisk,
    discouragementRisk: args.discouragementRisk,
  };
}

export function detectSmsIdentityEditIntent(text: string): SmsIdentityEditDetection {
  const t = normalizeInbound(text);
  if (!t) return noneDetection();

  const explicitLang = hasExplicitIdentityLanguage(t);

  if (GOAL_IDENTITY_CONFUSION_RE.test(t)) {
    const safeBehavior = hasSafeBehaviorGoalCandidateForIdentityConfusion(t);
    return buildDetection("goal_identity_confusion", "high", "goal_identity_confusion_phrase", {
      explicitIdentityLanguage: explicitLang,
      shouldRouteToIdentityLane: !safeBehavior,
      shouldInviteVictoryRoomReview: false,
      goalConfusionRisk: true,
      discouragementRisk: false,
    });
  }

  if (IDENTITY_REJECTION_RE.test(t)) {
    return buildDetection("identity_rejection", "high", "identity_rejection_phrase", {
      explicitIdentityLanguage: true,
      shouldRouteToIdentityLane: true,
      shouldInviteVictoryRoomReview: false,
      goalConfusionRisk: false,
      discouragementRisk: false,
    });
  }

  if (DISCOURAGEMENT_RE.test(t)) {
    return buildDetection("identity_discouragement", "medium", "identity_discouragement_phrase", {
      explicitIdentityLanguage: explicitLang,
      shouldRouteToIdentityLane: true,
      shouldInviteVictoryRoomReview: false,
      goalConfusionRisk: false,
      discouragementRisk: true,
    });
  }

  if (IDENTITY_REVIEW_RE.test(t)) {
    return buildDetection("identity_review_request", "high", "identity_review_request_phrase", {
      explicitIdentityLanguage: true,
      shouldRouteToIdentityLane: true,
      shouldInviteVictoryRoomReview: true,
      goalConfusionRisk: false,
      discouragementRisk: false,
    });
  }

  if (EXPLICIT_IDENTITY_EDIT_RE.test(t)) {
    return buildDetection("explicit_identity_edit", "high", "explicit_identity_edit_phrase", {
      explicitIdentityLanguage: true,
      shouldRouteToIdentityLane: true,
      shouldInviteVictoryRoomReview: true,
      goalConfusionRisk: false,
      discouragementRisk: false,
    });
  }

  if (ASPIRATION_RE.test(t)) {
    const routeAspiration = explicitLang;
    return buildDetection("identity_aspiration", "medium", "identity_aspiration_phrase", {
      explicitIdentityLanguage: explicitLang,
      shouldRouteToIdentityLane: routeAspiration,
      shouldInviteVictoryRoomReview: routeAspiration,
      goalConfusionRisk: false,
      discouragementRisk: false,
    });
  }

  return noneDetection();
}

export function isIdentityEditLaneActive(args: {
  detection: SmsIdentityEditDetection;
  relationshipExitLaneActive: boolean;
}): boolean {
  if (args.relationshipExitLaneActive) return false;
  if (!args.detection.shouldRouteToIdentityLane) return false;
  return args.detection.confidence === "high" || args.detection.confidence === "medium";
}

export function shouldSuppressCommitmentChangeHandoffForIdentity(args: {
  detection: SmsIdentityEditDetection;
  identityLaneActive: boolean;
}): boolean {
  return args.identityLaneActive && args.detection.shouldRouteToIdentityLane;
}

export function applyIdentityEditGatedOverride(
  detection: SmsIdentityEditDetection
): V2InboundGatedDecision {
  return {
    mode: "identity_edit_integrity",
    final_event_type: null,
    decision_reason: `identity_edit:${detection.category}:${detection.reasonCode ?? "unknown"}`,
    confidence_used: null,
    should_write_outcome_event: false,
    should_open_blocker_capture: false,
    reply_style: "identity_edit",
    overrode_deterministic: true,
  };
}

export type InboundV3IdentityEditFacts = {
  detected: boolean;
  category: string;
  confidence: string;
  explicit_identity_language: boolean;
  no_identity_mutation: true;
  current_identity_snapshot: string | null;
  should_not_claim_identity_updated: true;
  should_not_change_goal: true;
  should_invite_victory_room_review: boolean;
  goal_confusion_risk: boolean;
  discouragement_risk: boolean;
  suggested_next_moves: readonly string[];
};

export function buildInboundV3IdentityEditFacts(args: {
  detection: SmsIdentityEditDetection;
  identityAnchorPreview: string | null;
}): InboundV3IdentityEditFacts {
  const moves: string[] = [];
  if (
    args.detection.category === "explicit_identity_edit" ||
    args.detection.category === "identity_review_request"
  ) {
    moves.push("clarify_identity");
    if (args.detection.shouldInviteVictoryRoomReview) {
      moves.push("invite_victory_room_review");
    }
  }
  if (args.detection.category === "goal_identity_confusion") {
    moves.push("separate_identity_from_goal");
    moves.push("clarify_identity");
  }
  if (args.detection.discouragementRisk) {
    moves.push("protect_identity_after_bad_day");
  }
  if (args.detection.category === "identity_rejection") {
    moves.push("ask_what_no_longer_fits");
  }
  if (args.detection.category === "identity_aspiration") {
    moves.push("clarify_identity");
  }

  const snap = args.identityAnchorPreview?.trim().replace(/\s+/g, " ").slice(0, 200) ?? null;

  return {
    detected: true,
    category: args.detection.category,
    confidence: args.detection.confidence,
    explicit_identity_language: args.detection.explicitIdentityLanguage,
    no_identity_mutation: true,
    current_identity_snapshot: snap && snap.length > 0 ? snap : null,
    should_not_claim_identity_updated: true,
    should_not_change_goal: true,
    should_invite_victory_room_review: args.detection.shouldInviteVictoryRoomReview,
    goal_confusion_risk: args.detection.goalConfusionRisk,
    discouragement_risk: args.detection.discouragementRisk,
    suggested_next_moves:
      moves.length > 0
        ? moves
        : ["clarify_identity", "protect_identity_after_bad_day", "separate_identity_from_goal"],
  };
}

export function buildIdentityEditLaneGuardrails(): string {
  return `
IDENTITY_EDIT (identity_edit facts when present — Slice B Phase 1):
- Server did NOT update identity or goal; do NOT claim either was changed, saved, or locked in.
- Do NOT use "Reply YES to confirm" or keyword-robot confirmation menus.
- Do NOT automatically say "go to Victory Room" — Victory Room review is optional and fact-based (should_invite_victory_room_review); only invite when true and it fits naturally.
- If discouragement_risk: protect the identity line — one bad day does not rename who they are becoming.
- If goal_confusion_risk: ask ONE human question — is this who they are becoming (identity) or what they will do tomorrow (daily bar)?
- If explicit_identity_language: take the identity moment seriously; help them name what fits without inventing a new anchor for them.
- If category is identity_aspiration: coach aspiration unless they explicitly asked to change their stored identity line.
- Never treat this as today's accountability completion; v2_accountability.should_write_outcome_event is false.`;
}

export function slimIdentityEditFactsForTelemetry(
  f: InboundV3IdentityEditFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    category: f.category,
    confidence: f.confidence,
    explicit_identity_language: f.explicit_identity_language,
    no_identity_mutation: f.no_identity_mutation,
    should_invite_victory_room_review: f.should_invite_victory_room_review,
    goal_confusion_risk: f.goal_confusion_risk,
    discouragement_risk: f.discouragement_risk,
    suggested_next_moves: [...f.suggested_next_moves],
  };
}
