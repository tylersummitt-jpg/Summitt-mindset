/**
 * Slice 3B — coach goal-evolution invite acceptance classification (pure, no DB writes).
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull, isPendingResolutionExpired } from "@/lib/v2-guided-resolution";
import type {
  ReconciledGoalChangeIntent,
  TurnUnderstandingRelationshipMeaning,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  extractCandidateBarsFromSms,
  validateTuProposedGoalBarText,
} from "@/lib/v2-sms-commitment-change";
import {
  mapCoachInviteKindToAdjustmentType,
  type CoachGoalEvolutionInviteKindForAcceptance,
  type CoachInviteAcceptanceDisposition,
  type RecentCoachGoalEvolutionInvite,
} from "@/lib/sms-coach-initiated-goal-evolution-invite";

export type CoachInviteAcceptanceContext = {
  disposition: CoachInviteAcceptanceDisposition;
  acceptance_kind: CoachGoalEvolutionInviteKindForAcceptance | null;
  skip_reason: string | null;
  concrete_bar_present: boolean;
  proposed_bar_text: string | null;
  invite: RecentCoachGoalEvolutionInvite;
  reconciled_intent: ReconciledGoalChangeIntent | null;
  telemetry: Record<string, unknown>;
};

const COACH_INVITE_DECLINE_RE =
  /\b(no|nah|nope|not now|not yet|don't change|dont change|do not change|keep (the )?current|stay with (this|it)|i'?m good|leave it|keep it the same)\b/i;

const COACH_INVITE_ACCEPTANCE_PHRASE_RE =
  /\b(yes|yeah|yep|i\s+agree|let'?s\s+do\s+it|sounds\s+good|that\s+sounds\s+right|i'?m\s+ready|let'?s\s+change|raise\s+it|reset\s+it|shrink\s+it|make\s+it\s+smaller|focus\s+on\s+the\s+blocker|new\s+chapter|raise\s+the\s+standard)\b/i;

const COACH_INVITE_IGNORE_ACCOUNTABILITY_RE =
  /\b(done|did it|missed|didn't|did not|travel|sick|vacation|thanks|thank you|tonight|tomorrow|later today)\b/i;

function isBareAffirmativeReply(body: string): boolean {
  const t = body.trim().toLowerCase();
  return /^(yes|yeah|yep|yup|y|sure|ok|okay|k|i agree|sounds good|that works)\.?!?$/i.test(t);
}

export function buildCoachInviteAcceptedReconciledGoalChangeIntent(args: {
  invite: RecentCoachGoalEvolutionInvite;
  userMessage: string;
  proposedBarText?: string | null;
  tuIntent?: ReconciledGoalChangeIntent | null;
}): ReconciledGoalChangeIntent {
  const inviteKind = args.invite.invite_kind!;
  const tuType = args.tuIntent?.adjustment_type;
  const adjustment_type =
    tuType && tuType !== "none" && tuType !== "unspecified"
      ? tuType
      : mapCoachInviteKindToAdjustmentType(inviteKind);
  const proposed =
    args.proposedBarText?.trim() ||
    args.tuIntent?.proposed_new_goal_text?.trim() ||
    null;

  return {
    authoritative: true,
    detected: true,
    adjustment_type,
    source: "user_requested",
    requires_confirmation: true,
    proposed_new_goal_text: proposed,
    evidence_quote: args.userMessage.trim().slice(0, 120) || null,
    confidence: args.tuIntent?.confidence ?? "high",
    goal_change_not_outcome_write: true,
    goal_change_no_state_mutation_without_confirmation: true,
  };
}

export function buildCoachInviteAcceptanceTelemetry(args: {
  disposition: CoachInviteAcceptanceDisposition;
  invite: RecentCoachGoalEvolutionInvite;
  handoffOpened?: boolean;
  pendingCreated?: boolean;
  pendingKind?: string | null;
}): Record<string, unknown> {
  return {
    coach_goal_evolution_user_accepted: args.disposition === "accepted",
    coach_goal_evolution_user_declined: args.disposition === "declined",
    coach_goal_evolution_user_ignored: args.disposition === "ignored",
    coach_goal_evolution_acceptance_ttl_valid: args.invite.ttl_valid,
    accepted_invite_kind: args.invite.invite_kind,
    accepted_invite_source: args.invite.invite_source,
    accepted_invite_sent_at: args.invite.sent_at,
    accepted_invite_evidence_summary: args.invite.evidence_summary,
    proactive_goal_change_handoff_opened: args.handoffOpened === true,
    proactive_goal_change_pending_created: args.pendingCreated === true,
    proactive_goal_change_pending_kind: args.pendingKind ?? null,
    proactive_goal_change_no_state_mutation_without_confirmation: true,
    proactive_goal_change_not_outcome_write: true,
  };
}

/** Classify inbound reply against a validated recent coach invite (Slice 3B). */
export function evaluateCoachInviteAcceptanceContext(args: {
  invite: RecentCoachGoalEvolutionInvite;
  userMessage: string;
  commitment: ActiveV2CommitmentRow;
  reconciledGoalChangeIntent?: ReconciledGoalChangeIntent | null;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
  classificationEventType?: "user_yes" | "user_no" | "user_partial" | null;
  plannedInterruptionActionable?: boolean;
  activePending?: boolean;
  nowMs?: number;
}): CoachInviteAcceptanceContext {
  const body = args.userMessage.trim();
  const invite = args.invite;
  const skipBase = {
    invite,
    acceptance_kind: invite.invite_kind,
    concrete_bar_present: false,
    proposed_bar_text: null as string | null,
    reconciled_intent: null as ReconciledGoalChangeIntent | null,
  };

  if (
    !invite.found ||
    !invite.ttl_valid ||
    !invite.last_outbound_is_invite ||
    !invite.invite_kind
  ) {
    return {
      ...skipBase,
      disposition: "skip",
      skip_reason: invite.skip_reason ?? "no_valid_coach_invite",
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "skip", invite }),
    };
  }

  if (args.activePending) {
    return {
      ...skipBase,
      disposition: "skip",
      skip_reason: "existing_pending",
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "skip", invite }),
    };
  }

  if (args.plannedInterruptionActionable) {
    return {
      ...skipBase,
      disposition: "skip",
      skip_reason: "planned_interruption",
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "skip", invite }),
    };
  }

  const pending = getPendingResolutionOrNull(args.commitment);
  if (pending && !isPendingResolutionExpired(args.commitment, args.nowMs ?? Date.now())) {
    return {
      ...skipBase,
      disposition: "skip",
      skip_reason: "existing_pending",
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "skip", invite }),
    };
  }

  const tuIntent = args.reconciledGoalChangeIntent ?? null;
  const tuBar = tuIntent?.proposed_new_goal_text?.trim() ?? null;
  const extracted = extractCandidateBarsFromSms(body);
  const extractedBar = extracted.candidateNewBar ?? extracted.candidateTightenedBar;
  const validatedBar = validateTuProposedGoalBarText({
    proposedText: tuBar ?? extractedBar,
    currentBehaviorStatement: args.commitment.behavior_statement,
  });
  const concrete_bar_present = validatedBar.ok && Boolean(validatedBar.normalized);
  const proposed_bar_text = concrete_bar_present ? validatedBar.normalized : null;

  if (COACH_INVITE_DECLINE_RE.test(body)) {
    return {
      ...skipBase,
      disposition: "declined",
      skip_reason: null,
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "declined", invite }),
    };
  }

  const tuAcceptsGoalChange =
    tuIntent?.authoritative === true &&
    tuIntent.detected &&
    tuIntent.adjustment_type !== "none" &&
    (tuIntent.source === "user_requested" ||
      args.relationshipMeaning === "goal_adjustment_request");

  const bareYes = isBareAffirmativeReply(body);
  const phraseAcceptance = COACH_INVITE_ACCEPTANCE_PHRASE_RE.test(body);
  const ignoreAccountability =
    !tuAcceptsGoalChange &&
    !phraseAcceptance &&
    !concrete_bar_present &&
    !bareYes &&
    (args.relationshipMeaning === "reported_completion" ||
      args.relationshipMeaning === "miss" ||
      args.relationshipMeaning === "partial_attempt" ||
      COACH_INVITE_IGNORE_ACCOUNTABILITY_RE.test(body));

  if (ignoreAccountability) {
    return {
      ...skipBase,
      disposition: "ignored",
      skip_reason: null,
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "ignored", invite }),
    };
  }

  const accepted =
    concrete_bar_present ||
    tuAcceptsGoalChange ||
    phraseAcceptance ||
    (bareYes && invite.last_outbound_is_invite);

  if (!accepted) {
    return {
      ...skipBase,
      disposition: "ignored",
      skip_reason: null,
      telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "ignored", invite }),
    };
  }

  const reconciled_intent = buildCoachInviteAcceptedReconciledGoalChangeIntent({
    invite,
    userMessage: body,
    proposedBarText: proposed_bar_text,
    tuIntent,
  });

  return {
    disposition: "accepted",
    acceptance_kind: invite.invite_kind,
    skip_reason: null,
    concrete_bar_present,
    proposed_bar_text,
    invite,
    reconciled_intent,
    telemetry: buildCoachInviteAcceptanceTelemetry({ disposition: "accepted", invite }),
  };
}
