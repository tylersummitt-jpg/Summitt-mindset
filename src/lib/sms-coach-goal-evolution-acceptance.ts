/**
 * Slice 3B — coach goal-evolution invite acceptance classification (pure, no DB writes).
 *
 * Policy (2,500-user safe):
 * - OpenAI/TU may help classify English meaning when already available.
 * - Server opens hallway only on keep_current? never; change/raise/concrete only when clear.
 * - Length / bare yes-ok-sure alone never opens commitment_replace.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull, isPendingResolutionExpired } from "@/lib/v2-guided-resolution";
import type {
  ReconciledGoalChangeIntent,
  TurnUnderstandingGoalAdjustmentType,
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

export type GoalInviteReplyMeaning =
  | "keep_current"
  | "change_goal"
  | "raise_current_goal"
  | "concrete_candidate"
  | "unclear";

export type CoachInviteAcceptanceContext = {
  disposition: CoachInviteAcceptanceDisposition;
  acceptance_kind: CoachGoalEvolutionInviteKindForAcceptance | null;
  skip_reason: string | null;
  concrete_bar_present: boolean;
  proposed_bar_text: string | null;
  reply_meaning: GoalInviteReplyMeaning | null;
  invite: RecentCoachGoalEvolutionInvite;
  reconciled_intent: ReconciledGoalChangeIntent | null;
  telemetry: Record<string, unknown>;
};

/**
 * Invite/pending-scoped keep-current / decline-change.
 * Do not use as a global phrase router outside invite or active hallway.
 */
export const CONTEXT_SCOPED_KEEP_CURRENT_GOAL_RE =
  /\b(?:not\s+now|not\s+yet|never\s*mind|nevermind|don'?t\s+change|dont\s+change|do\s+not\s+change|i\s+don'?t\s+want\s+to\s+change|i'?m\s+good|leave\s+it|keep\s+it(?:\s+the\s+same)?|keep\s+(?:the\s+|my\s+)?(?:current|same)(?:\s+goal)?|keep\s+what\s+we\s+have|same\s+goal|stay\s+the\s+course|stick\s+with\s+(?:this|that|it|the\s+current)(?:\s+goal)?|continue\s+(?:this|the\s+current|with\s+(?:this|that))(?:\s+goal)?|stay\s+with\s+(?:this|that|it)(?:\s+goal)?|stay\s+(?:\d+\s+)?(?:one\s+)?(?:more\s+)?week(?:s)?\s+(?:more\s+)?(?:with\s+)?(?:that|this|the\s+current)?(?:\s+goal)?|one\s+more\s+week|let'?s\s+do\s+one\s+more\s+week|let'?s\s+stay\s+with\s+(?:this|that|it)(?:\s+goal)?|let'?s\s+keep\s+going(?:\s+with\s+(?:this|that|it))?|i(?:'?ll|\s+will)\s+keep\s+working\s+on\s+(?:this|that)\s+one|no[,.\s]+(?:keep\s+(?:this|that|the\s+same)(?:\s+one)?|same\s+goal))\b/i;

const EXPLICIT_CHANGE_GOAL_RE =
  /\b(?:(?:i\s+)?(?:want|need)\s+(?:to\s+)?change(?:\s+(?:my|the)\s+goal)?|(?:let'?s\s+)?change\s+it|focus\s+on\s+another\s+goal|(?:a\s+)?(?:new|different)\s+goal|another\s+goal|switch\s+goals?|reset\s+(?:it|my\s+goal|the\s+goal)|(?:i\s+)?(?:want|need)\s+a\s+(?:change|reset)|(?:i\s+)?think\s+i\s+need\s+(?:a\s+change|to\s+change)|can\s+we\s+change(?:\s+(?:my|the)\s+goal)?|something\s+different|let'?s\s+do\s+something\s+different|i\s+need\s+to\s+switch\s+goals?|let'?s\s+change|shrink\s+it|make\s+it\s+smaller|focus\s+on\s+the\s+blocker|new\s+chapter)\b/i;

const EXPLICIT_RAISE_GOAL_RE =
  /\b(?:raise\s+(?:the\s+)?(?:bar|standard|it)|raise\s+it|make\s+it\s+harder|make\s+(?:it|the\s+goal)\s+(?:bigger|more\s+challenging)|increase\s+(?:it|the\s+bar)|add\s+more|step\s+it\s+up|push\s+it|want\s+(?:a\s+)?(?:stronger|harder)\s+version|ready\s+for\s+more|bigger\s+challenge|raise\s+the\s+standard)\b/i;

const COACH_INVITE_IGNORE_ACCOUNTABILITY_RE =
  /\b(done|did it|missed|didn't|did not|travel|sick|vacation|thanks|thank you|tonight|tomorrow|later today)\b/i;

const INVITE_NOISE_ONLY_RE =
  /^(❤️|👍|😂|🙏|ok|okay|k|thanks|thank you|thx|ty)\.?$/i;

const INVITE_COMPLIANCE_ONLY_RE = /^(stop|start|help|unstop|unsubscribe|cancel|end)$/i;

const BEHAVIOR_EXTRACT_MAX = 180;

const VAGUE_AFFIRMATIVE_RE =
  /^(yes|yeah|yep|yup|y|sure|ok|okay|k|fine|i agree|sounds good|that works|that sounds right|i'?m ready|works for me|let'?s do it)\.?!?$/i;

function isBareAffirmativeReply(body: string): boolean {
  return VAGUE_AFFIRMATIVE_RE.test(body.trim().toLowerCase());
}

/**
 * Context-scoped keep-current / decline-change (invite reply or active pending hallway).
 * Not a global router — callers must already be in invite or pending context.
 *
 * `treatBareNoAsKeep`:
 * - invite replies: true (bare no/nah = decline change)
 * - pending hallway clear: false (bare no rejects candidate → awaiting_candidate)
 */
export function isContextScopedKeepCurrentGoalReply(
  raw: string,
  opts?: { treatBareNoAsKeep?: boolean }
): boolean {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return false;
  // Keep-current phrases first (includes "don't change it") — before change-intent cues.
  if (CONTEXT_SCOPED_KEEP_CURRENT_GOAL_RE.test(t)) return true;
  if (/^same\.?$/i.test(t)) return true;
  const bareNo = /^(no|nah|nope|n)\.?$/i.test(t);
  if (bareNo) return opts?.treatBareNoAsKeep === true;
  return false;
}

/** Pending hallway: clear commitment_replace on keep-current; bare "no" does not clear. */
export function isPendingHallwayKeepCurrentClearReply(raw: string): boolean {
  return isContextScopedKeepCurrentGoalReply(raw, { treatBareNoAsKeep: false });
}

/**
 * @deprecated Not a state-opening authority. Always false — length never opens hallway.
 * Kept exported so older imports do not accidentally re-enable length-based acceptance.
 */
export function isSubstantiveGoalChangeInviteContinuation(_body: string): boolean {
  return false;
}

/**
 * Invite-only concrete-bar helpers. Never returns the raw full inbound as a candidate.
 * Prefer concise normalized goals when the reply names clear daily actions.
 */
export function tryNormalizeInviteScopedConcreteBar(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || t.length < 12) return null;
  if (isBareAffirmativeReply(t)) return null;
  if (isContextScopedKeepCurrentGoalReply(t, { treatBareNoAsKeep: true })) return null;
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

function tuHighConfidenceGoalChange(args: {
  tuIntent: ReconciledGoalChangeIntent | null;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
}): { ok: true; type: TurnUnderstandingGoalAdjustmentType } | { ok: false } {
  const tu = args.tuIntent;
  if (!tu?.authoritative || !tu.detected) return { ok: false };
  if (tu.adjustment_type === "none") return { ok: false };
  if (tu.confidence !== "high") return { ok: false };
  if (
    tu.source !== "user_requested" &&
    args.relationshipMeaning !== "goal_adjustment_request"
  ) {
    return { ok: false };
  }
  return { ok: true, type: tu.adjustment_type };
}

function meaningFromTuAdjustmentType(
  type: TurnUnderstandingGoalAdjustmentType
): GoalInviteReplyMeaning {
  if (type === "raise") return "raise_current_goal";
  if (type === "lower" || type === "shrink") return "change_goal";
  return "change_goal";
}

/**
 * Classify reply meaning after a live coach goal-change invite (or for pending keep-current).
 * Prefer concrete extract + keep-current + explicit phrases; TU only when high-confidence.
 */
export function classifyGoalInviteReplyMeaning(args: {
  userMessage: string;
  concreteBarPresent: boolean;
  reconciledGoalChangeIntent?: ReconciledGoalChangeIntent | null;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
}): {
  meaning: GoalInviteReplyMeaning;
  source: "concrete" | "keep_current" | "explicit_change" | "explicit_raise" | "tu" | "unclear";
} {
  const body = args.userMessage.trim().replace(/\s+/g, " ");

  if (args.concreteBarPresent) {
    return { meaning: "concrete_candidate", source: "concrete" };
  }

  if (isContextScopedKeepCurrentGoalReply(body, { treatBareNoAsKeep: true })) {
    return { meaning: "keep_current", source: "keep_current" };
  }

  if (EXPLICIT_RAISE_GOAL_RE.test(body)) {
    return { meaning: "raise_current_goal", source: "explicit_raise" };
  }

  if (EXPLICIT_CHANGE_GOAL_RE.test(body)) {
    return { meaning: "change_goal", source: "explicit_change" };
  }

  // Vague affirmatives after invite are unclear even if TU guesses — multi-option invites
  // make "sure/ok/yes" unsafe to treat as hallway acceptance.
  if (isBareAffirmativeReply(body)) {
    return { meaning: "unclear", source: "unclear" };
  }

  const tu = tuHighConfidenceGoalChange({
    tuIntent: args.reconciledGoalChangeIntent ?? null,
    relationshipMeaning: args.relationshipMeaning,
  });

  if (tu.ok) {
    return {
      meaning: meaningFromTuAdjustmentType(tu.type),
      source: "tu",
    };
  }

  return { meaning: "unclear", source: "unclear" };
}

export function buildCoachInviteAcceptedReconciledGoalChangeIntent(args: {
  invite: RecentCoachGoalEvolutionInvite;
  userMessage: string;
  proposedBarText?: string | null;
  tuIntent?: ReconciledGoalChangeIntent | null;
  replyMeaning?: GoalInviteReplyMeaning | null;
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

  if (args.replyMeaning === "raise_current_goal") {
    adjustment_type = "raise";
  } else if (args.replyMeaning === "change_goal") {
    if (adjustment_type === "raise") adjustment_type = "replace";
  }

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
  replyMeaning?: GoalInviteReplyMeaning | null;
  handoffOpened?: boolean;
  pendingCreated?: boolean;
  pendingKind?: string | null;
}): Record<string, unknown> {
  return {
    coach_goal_evolution_user_accepted: args.disposition === "accepted",
    coach_goal_evolution_user_declined: args.disposition === "declined",
    coach_goal_evolution_user_ignored: args.disposition === "ignored",
    coach_goal_evolution_acceptance_ttl_valid: args.invite.ttl_valid,
    coach_goal_evolution_reply_meaning: args.replyMeaning ?? null,
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
    reply_meaning: null as GoalInviteReplyMeaning | null,
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

  const classified = classifyGoalInviteReplyMeaning({
    userMessage: body,
    concreteBarPresent: concrete_bar_present,
    reconciledGoalChangeIntent: tuIntent,
    relationshipMeaning: args.relationshipMeaning,
  });
  const reply_meaning = classified.meaning;

  if (reply_meaning === "keep_current") {
    return {
      ...skipBase,
      disposition: "declined",
      skip_reason: null,
      reply_meaning,
      telemetry: buildCoachInviteAcceptanceTelemetry({
        disposition: "declined",
        invite,
        replyMeaning: reply_meaning,
      }),
    };
  }

  const ignoreAccountability =
    reply_meaning === "unclear" &&
    (args.relationshipMeaning === "reported_completion" ||
      args.relationshipMeaning === "miss" ||
      args.relationshipMeaning === "partial_attempt" ||
      COACH_INVITE_IGNORE_ACCOUNTABILITY_RE.test(body));

  if (ignoreAccountability) {
    return {
      ...skipBase,
      disposition: "ignored",
      skip_reason: null,
      reply_meaning,
      telemetry: buildCoachInviteAcceptanceTelemetry({
        disposition: "ignored",
        invite,
        replyMeaning: reply_meaning,
      }),
    };
  }

  const accepted =
    reply_meaning === "concrete_candidate" ||
    reply_meaning === "change_goal" ||
    reply_meaning === "raise_current_goal";

  if (!accepted) {
    return {
      ...skipBase,
      disposition: "ignored",
      skip_reason: null,
      reply_meaning,
      concrete_bar_present,
      proposed_bar_text,
      telemetry: buildCoachInviteAcceptanceTelemetry({
        disposition: "ignored",
        invite,
        replyMeaning: reply_meaning,
      }),
    };
  }

  const reconciled_intent = buildCoachInviteAcceptedReconciledGoalChangeIntent({
    invite,
    userMessage: body,
    proposedBarText: proposed_bar_text,
    tuIntent,
    replyMeaning: reply_meaning,
  });

  return {
    disposition: "accepted",
    acceptance_kind: invite.invite_kind,
    skip_reason: null,
    concrete_bar_present,
    proposed_bar_text,
    reply_meaning,
    invite,
    reconciled_intent,
    telemetry: buildCoachInviteAcceptanceTelemetry({
      disposition: "accepted",
      invite,
      replyMeaning: reply_meaning,
    }),
  };
}
