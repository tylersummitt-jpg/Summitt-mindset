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
  extractDurationAnchoredBarPhrase,
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
  /\b(no|nah|nope|not now|not yet|never\s*mind|nevermind|don't change|dont change|do not change|keep (the |my )?(current|same)|stay with (this|it)|i'?m good|leave it|keep it the same|i don'?t want to change)\b/i;

const COACH_INVITE_ACCEPTANCE_PHRASE_RE =
  /\b(yes|yeah|yep|i\s+agree|let'?s\s+do\s+it|sounds\s+good|that\s+sounds\s+right|i'?m\s+ready|let'?s\s+change|raise\s+it|reset\s+it|shrink\s+it|make\s+it\s+smaller|focus\s+on\s+the\s+blocker|new\s+chapter|raise\s+the\s+standard)\b/i;

const COACH_INVITE_IGNORE_ACCOUNTABILITY_RE =
  /\b(done|did it|missed|didn't|did not|travel|sick|vacation|thanks|thank you|tonight|tomorrow|later today)\b/i;

const INVITE_NOISE_ONLY_RE =
  /^(❤️|👍|😂|🙏|ok|okay|k|thanks|thank you|thx|ty)\.?$/i;

const INVITE_COMPLIANCE_ONLY_RE = /^(stop|start|help|unstop|unsubscribe|cancel|end)$/i;

const BEHAVIOR_EXTRACT_MAX = 180;

function isBareAffirmativeReply(body: string): boolean {
  const t = body.trim().toLowerCase();
  return /^(yes|yeah|yep|yup|y|sure|ok|okay|k|i agree|sounds good|that works)\.?!?$/i.test(t);
}

/**
 * Substantive answer to a live goal-change invite (not yes/decline/noise).
 * Invite-scoped referent grounding — not a general phrase router.
 */
export function isSubstantiveGoalChangeInviteContinuation(body: string): boolean {
  const t = body.trim().replace(/\s+/g, " ");
  if (!t || t.length < 12) return false;
  if (isBareAffirmativeReply(t)) return false;
  if (COACH_INVITE_DECLINE_RE.test(t)) return false;
  if (INVITE_NOISE_ONLY_RE.test(t)) return false;
  if (INVITE_COMPLIANCE_ONLY_RE.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3 && t.length < 24) return false;
  return true;
}

/**
 * Invite-only concrete-bar helpers. Never returns the raw full inbound as a candidate.
 * Prefer concise normalized goals when the reply names clear daily actions.
 */
export function tryNormalizeInviteScopedConcreteBar(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || t.length < 12) return null;
  if (isBareAffirmativeReply(t)) return null;
  if (COACH_INVITE_DECLINE_RE.test(t)) return null;
  if (INVITE_NOISE_ONLY_RE.test(t) || INVITE_COMPLIANCE_ONLY_RE.test(t)) return null;

  const hasPositiveComment =
    /\b(?:always\s+)?give\s+a\s+positive\s+comment\b|\bone\s+positive\s+comment\b|\bpositive\s+comment\s+each\s+day\b/i.test(
      t
    );
  const hasSelfTalk = /\bpositive\s+self[- ]?talk\b/i.test(t);
  if (hasPositiveComment && hasSelfTalk) {
    return "Give one positive comment and practice positive self-talk each day";
  }
  if (hasPositiveComment) {
    return "Give one positive comment each day";
  }
  if (hasSelfTalk) {
    return "Practice positive self-talk each day";
  }

  return null;
}

function resolveInviteAcceptanceProposedBar(args: {
  userMessage: string;
  commitment: ActiveV2CommitmentRow;
  tuProposedBar: string | null;
}): { concrete: boolean; proposed: string | null } {
  const body = args.userMessage.trim();
  const extracted = extractCandidateBarsFromSms(body);
  const fromSms = extracted.candidateNewBar ?? extracted.candidateTightenedBar;
  const dur = extractDurationAnchoredBarPhrase(body, BEHAVIOR_EXTRACT_MAX);
  // phrase is non-null only for bare|widened; deferred/none return phrase: null
  const fromDuration = dur.phrase ? dur.phrase.trim().replace(/\s+/g, " ") : null;
  const fromInviteScope = tryNormalizeInviteScopedConcreteBar(body);

  const candidates = [args.tuProposedBar, fromSms, fromDuration, fromInviteScope].filter(
    (x): x is string => Boolean(x?.trim())
  );

  for (const candidate of candidates) {
    // Never accept the full raw inbound as CBS unless it was already a structured extract.
    if (candidate === body && !fromSms && !fromDuration && !fromInviteScope) {
      continue;
    }
    if (fromInviteScope && candidate === fromInviteScope) {
      const validatedInvite = validateTuProposedGoalBarText({
        proposedText: candidate,
        currentBehaviorStatement: args.commitment.behavior_statement,
      });
      if (validatedInvite.ok && validatedInvite.normalized) {
        return { concrete: true, proposed: validatedInvite.normalized };
      }
      continue;
    }
    const validated = validateTuProposedGoalBarText({
      proposedText: candidate,
      currentBehaviorStatement: args.commitment.behavior_statement,
    });
    if (validated.ok && validated.normalized) {
      // Reject raw full-body pollution: structured extract must be shorter/cleaner than rambling raw.
      if (
        validated.normalized === body &&
        body.length > 90 &&
        !fromSms &&
        !fromDuration
      ) {
        continue;
      }
      return { concrete: true, proposed: validated.normalized };
    }
  }

  return { concrete: false, proposed: null };
}

export function buildCoachInviteAcceptedReconciledGoalChangeIntent(args: {
  invite: RecentCoachGoalEvolutionInvite;
  userMessage: string;
  proposedBarText?: string | null;
  tuIntent?: ReconciledGoalChangeIntent | null;
}): ReconciledGoalChangeIntent {
  const inviteKind = args.invite.invite_kind!;
  const tuType = args.tuIntent?.adjustment_type;
  const proposed =
    args.proposedBarText?.trim() ||
    args.tuIntent?.proposed_new_goal_text?.trim() ||
    null;
  let adjustment_type =
    tuType && tuType !== "none" && tuType !== "unspecified"
      ? tuType
      : mapCoachInviteKindToAdjustmentType(inviteKind);
  // Freeform invites map to reset (shell-only). A concrete bar after invite is a replace candidate.
  if (proposed && (adjustment_type === "reset" || adjustment_type === "unspecified")) {
    adjustment_type = "replace";
  }

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
  const resolvedBar = resolveInviteAcceptanceProposedBar({
    userMessage: body,
    commitment: args.commitment,
    tuProposedBar: tuBar,
  });
  const concrete_bar_present = resolvedBar.concrete;
  const proposed_bar_text = resolvedBar.proposed;

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
  const substantiveContinuation =
    invite.last_outbound_is_invite && isSubstantiveGoalChangeInviteContinuation(body);
  const ignoreAccountability =
    !tuAcceptsGoalChange &&
    !phraseAcceptance &&
    !concrete_bar_present &&
    !bareYes &&
    !substantiveContinuation &&
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
    (bareYes && invite.last_outbound_is_invite) ||
    substantiveContinuation;

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
