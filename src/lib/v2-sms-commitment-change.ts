/**
 * Wave 4: SMS-native commitment change / tighten / replace — first pass.
 * Conservative on DB mutation; uses pending_resolution_* when safe.
 */

import { isRefreshSessionActive } from "@/lib/v2-refresh-session";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import type { V2InboundShadowInterpretationResult } from "@/lib/v2-ai-inbound";
import {
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  setPendingResolution,
  type V2PendingResolutionKind,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { deriveSeasonModeForSmsGoalChange } from "@/lib/v2-sms-season-mode";
import {
  classifyInboundSmsSafetyTier,
  isUnsafeSmsGoalCandidateText,
} from "@/lib/sms-inbound-safety";
import type { SmsGoalAdjustmentMove } from "@/lib/sms-goal-adjustment-signal";
import { isLikelyCommitmentChangeIntentTurn, isUserCompletedGoalWantsToMoveOnLanguage } from "@/lib/v2-sms-conversation-brain-eligibility";
import { isStrongV2YesNoOutcome } from "@/lib/v2-sms-accountability";
import {
  isAuthoritativeReconciledGoalChangeIntent,
  type ReconciledGoalChangeIntent,
  type TurnUnderstandingGoalAdjustmentType,
  type TurnUnderstandingGoalChangeSource,
  type TurnUnderstandingRelationshipMeaning,
} from "@/lib/openai-relationship-turn-understanding-v1";
import type { CoachInviteAcceptanceContext } from "@/lib/sms-coach-goal-evolution-acceptance";

/** Server-owned SMS commitment-change intent (prompt/logging only; not shown to user). */
export type V2SmsCommitmentServerIntent =
  | "sms_tighten_request"
  | "sms_replace_request"
  | "sms_change_unspecified"
  | "sms_soft_quit_or_frustration"
  | "sms_raise_bar_request";

const CANDIDATE_EXTRACT_MAX = 200;

const COMMITMENT_CHANGE_CUE_RE =
  /\b(change|new|switch|replace|different|goal|commitment|bar|instead)\b/i;

const RAISE_BAR_PHRASE_RE =
  /\b(too\s+easy|want\s+more|raise\s+the\s+bar|make\s+it\s+harder|ready\s+for\s+more|increase\s+the\s+bar|harder\s+bar|bigger\s+challenge)\b/i;

const THIS_WEEK_IMPOSSIBLE_RE = /\bthis\s+week\s+is\s+impossible\b/i;

export function hasSmsCommitmentChangeExtractionCue(raw: string): boolean {
  return COMMITMENT_CHANGE_CUE_RE.test(raw.trim());
}

/** Identity-shaped bars must not silently replace Current Goal via SMS. */
export function isIdentityLikeGoalCandidate(text: string): boolean {
  const b = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!b) return false;
  return /\b(be a better|become a better|better person|better version|better provider|better dad|better mom|better father|better mother)\b/.test(
    b
  );
}

export function isVagueOrInvalidSmsGoalCandidate(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (isIdentityLikeGoalCandidate(t)) return true;
  if (!t || t.length < 3) return true;
  if (/^(be better|do better|try harder|just\s+be|more)$/i.test(t)) return true;
  if (/^(feel healthier|be happier)$/i.test(t)) return true;
  return false;
}

export type V2SmsCommitmentIntentPack = {
  intent: V2SmsCommitmentServerIntent;
  candidateTightenedBar: string | null;
  candidateNewBar: string | null;
  aiConfidence: number | null;
};

const DURATION_BAR_RE = /\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i;

export type V2DurationAnchorExtraction =
  | { phrase: string; mode: "bare" | "widened" }
  | { phrase: null; mode: "none" | "deferred" };

function pickDurationPhraseStart(full: string, durIndex: number): number {
  const before = full.slice(0, durIndex).trimEnd();
  if (!before) return durIndex;
  if (
    /^(walk|read|run|write|pray|call|go|do|lift|study|meditat|stretch|journal)\b/i.test(full.trim())
  ) {
    return 0;
  }
  if (
    /\b(let'?s|let\s+us|make\s+it|change\s+it(\s+to)?|switch\s+to|want\s+(it\s*)?to|need\s+to|try|gonna)\b/i.test(
      before
    )
  ) {
    return 0;
  }
  if (/\b(read|study|pray)\s+my\s+/i.test(before)) return 0;
  if (/\b(my|the|our|a)\s+\w+\s+for\s*$/i.test(before)) return 0;
  if (before.length > 40) return durIndex;
  return durIndex;
}

function extendDurationPhraseEnd(full: string, durEnd: number): number {
  const after = full.slice(durEnd);
  if (!after.trim()) return durEnd;
  const punct = after.search(/[.;!?](?=\s|$)/);
  const window = punct === -1 ? after : after.slice(0, punct);
  const words = window.match(/^\s*((?:[\w']+\s+){0,14}[\w']+)/);
  if (!words?.[1]) return durEnd;
  return durEnd + words[0].length;
}

/**
 * Wave 15.1 — duration-based bar candidate: keep action/context (e.g. "1 hour per day on distribution",
 * "walk 20 minutes after lunch") instead of bare "1 hour" / "20 minutes" when more text follows.
 * Returns deferred when bare duration would drop meaningful trailing context (caller may use AI).
 */
export function extractDurationAnchoredBarPhrase(raw: string, maxLen: number): V2DurationAnchorExtraction {
  const full = raw.trim().replace(/\s+/g, " ");
  if (!full) return { phrase: null, mode: "none" };

  const m = DURATION_BAR_RE.exec(full);
  if (!m) return { phrase: null, mode: "none" };

  const durStart = m.index;
  const durEnd = m.index + m[0].length;
  const durText = m[0].trim();

  const start = pickDurationPhraseStart(full, durStart);
  const end = extendDurationPhraseEnd(full, durEnd);

  let phrase = full.slice(start, end).trim().replace(/\s+/g, " ");
  if (phrase.length > maxLen) phrase = phrase.slice(0, maxLen).trim();

  const trimmedAfter = full.slice(durEnd).trim();
  const hadTrailing = trimmedAfter.length > 0;
  const trailingLooksMeaningful =
    hadTrailing &&
    trimmedAfter.length >= 3 &&
    /\b(per|day|daily|each|every|on|for|after|before|during|with|until|distribution|lunch|morning|evening|night|today|tomorrow|minute|minutes|hour|hours)\b/i.test(
      trimmedAfter
    );

  if (phrase === durText && trailingLooksMeaningful) {
    return { phrase: null, mode: "deferred" };
  }

  const mode: "bare" | "widened" = phrase !== durText ? "widened" : "bare";
  return { phrase, mode };
}

function sliceCandidateClause(clause: string): string {
  return clause.trim().replace(/\s+/g, " ").slice(0, CANDIDATE_EXTRACT_MAX);
}

/** Pull coarse candidate phrases from natural language (no mutation). */
export function extractCandidateBarsFromSms(raw: string): {
  candidateTightenedBar: string | null;
  candidateNewBar: string | null;
} {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || !hasSmsCommitmentChangeExtractionCue(t)) {
    return { candidateTightenedBar: null, candidateNewBar: null };
  }

  const changeGoalTo = t.match(
    /\bchange\s+(?:my\s+|the\s+)?(?:goal|commitment)\s+to\s+(.{3,180}?)(?:[.!?]|$)/i
  );
  if (changeGoalTo?.[1]?.trim()) {
    const bar = sliceCandidateClause(changeGoalTo[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const newGoalColon = t.match(/\bnew\s+(?:goal|commitment)\s*:\s*(.{3,180}?)(?:[.!?]|$)/i);
  if (newGoalColon?.[1]?.trim()) {
    const bar = sliceCandidateClause(newGoalColon[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const goalShouldBe = t.match(/\b(?:my\s+)?goal\s+should\s+be\s+(.{3,180}?)(?:[.!?]|$)/i);
  if (goalShouldBe?.[1]?.trim()) {
    const bar = sliceCandidateClause(goalShouldBe[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const switchTo = t.match(/\bswitch\s+from\s+.+?\s+to\s+(.{3,180}?)(?:[.!?]|$)/i);
  if (switchTo?.[1]?.trim()) {
    const bar = sliceCandidateClause(switchTo[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const insteadBar = t.match(/\b(?:let'?s|let\s+us)\s+(?:do|make\s+it)\s+(.{3,180}?)\s+instead\b/i);
  if (insteadBar?.[1]?.trim()) {
    const bar = sliceCandidateClause(insteadBar[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const myNew = t.match(
    /\b(?:my\s+)?new\s+(?:goal|commitment|bar)\s+is\s+(.{3,180}?)(?:[.!?]|$)/i
  );
  if (myNew?.[1]?.trim()) {
    const bar = sliceCandidateClause(myNew[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const goalIs = t.match(/\bgoal\s+is\s+to\s+(.{3,180}?)(?:[.!?]|$)/i);
  if (goalIs?.[1]?.trim()) {
    const bar = sliceCandidateClause(goalIs[1]!);
    if (!isIdentityLikeGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const durEx = extractDurationAnchoredBarPhrase(t, CANDIDATE_EXTRACT_MAX);
  if (durEx.phrase) {
    const phrase = durEx.phrase.trim().replace(/\s+/g, " ");
    if (!isIdentityLikeGoalCandidate(phrase)) {
      return { candidateTightenedBar: phrase, candidateNewBar: phrase };
    }
  }

  return { candidateTightenedBar: null, candidateNewBar: null };
}

/**
 * Map AI shadow interpretation + heuristics to a server intent for SMS handling.
 */
/** Slice 2A — TU types that may open Wave4 pending when a concrete bar is present. */
const TU_CONCRETE_BAR_PENDING_TYPES = new Set<TurnUnderstandingGoalAdjustmentType>([
  "replace",
  "new_goal",
  "raise",
  "lower",
  "shrink",
  "blocker_focus",
]);

/** Slice 2B — explicit amend/restate/reset always eligible for awaiting_candidate shell. */
const TU_EXPLICIT_SHELL_TYPES = new Set<TurnUnderstandingGoalAdjustmentType>([
  "amend",
  "restate",
  "reset",
]);

/** Slice 2B — adjust/replace types eligible when no valid bar but user asks to change standard. */
const TU_ADJUSTMENT_SHELL_TYPES = new Set<TurnUnderstandingGoalAdjustmentType>([
  "replace",
  "new_goal",
  "raise",
  "lower",
  "shrink",
  "blocker_focus",
  "unspecified",
]);

/** Slice 3 — coach-initiated progression uses same hallway later; block proactive sources in 2B. */
const TU_PROACTIVE_GOAL_CHANGE_SOURCES = new Set<TurnUnderstandingGoalChangeSource>([
  "consistency_signal",
  "recurring_blocker",
]);

const MULTIPLE_GOALS_DEFER_RE =
  /\b(add\s+(another|a\s+second)|also\s+(want|track|add)|second\s+goal|multiple\s+goals?|another\s+goal\s+(too|also)|nutrition\s+(goal|too))\b/i;

/** Stale goal-change clarify phrases — handoff lane must not repeat when shell opens. */
export const GOAL_CHANGE_STALE_ASK_FORBIDDEN_SUBSTRINGS = [
  "what specific changes",
  "adjustments are you considering",
  "adjustments you have in mind",
  "changes or adjustments",
] as const;

export type TuGoalChangePendingMode =
  | "concrete_bar_pending"
  | "awaiting_candidate_shell"
  | "skip";

export type TuGoalChangePendingShellReason =
  | "goal_change_without_concrete_bar"
  | "accepted_coach_goal_evolution_invite"
  | "user_completed_goal_wants_new_bar"
  | "vague_theme_needs_concrete_bar";

/** Forbidden coach phrases when user completed/moved on from the current goal. */
export const OLD_GOAL_REASK_FORBIDDEN_SUBSTRINGS = [
  "wake up without snoozing",
  "wake-up time",
  "get out of bed",
  "snoozing tomorrow",
  "stay committed to your wake",
] as const;

export function buildOldGoalReaskForbiddenSubstrings(args: {
  behaviorStatement?: string | null;
  effectiveAsk?: string | null;
}): string[] {
  const out = new Set<string>(OLD_GOAL_REASK_FORBIDDEN_SUBSTRINGS);
  const phrase = (args.behaviorStatement ?? args.effectiveAsk ?? "").trim().replace(/\s+/g, " ");
  if (phrase.length >= 15) {
    out.add(phrase.slice(0, 80));
  }
  const lower = phrase.toLowerCase();
  if (/\bwake\b/.test(lower) || /\bsnooz/.test(lower)) {
    out.add("wake");
    out.add("snooz");
  }
  return [...out];
}

function isBroadThemeNotConcreteDailyBar(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (/\b(self discipline|discipline through|build discipline|work on discipline)\b/i.test(t)) {
    return true;
  }
  if (/\b(focus on|work on)\b/i.test(t) && /\b(tasks?|discipline|mindset)\b/i.test(t) && t.length < 48) {
    return true;
  }
  if (DURATION_BAR_RE.test(t)) return false;
  if (
    /\b(every\s+(day|morning|night)|each\s+(day|morning|night)|daily|before\s+bed|per\s+day)\b/i.test(t) &&
    t.length >= 22
  ) {
    return false;
  }
  return false;
}

function resolveShellReasonForGoalTransition(args: {
  userMessage: string;
  hadVagueProposedBar: boolean;
  intent: ReconciledGoalChangeIntent;
}): TuGoalChangePendingShellReason {
  if (isUserCompletedGoalWantsToMoveOnLanguage(args.userMessage)) {
    return "user_completed_goal_wants_new_bar";
  }
  if (args.hadVagueProposedBar) {
    return "vague_theme_needs_concrete_bar";
  }
  if (
    args.intent.adjustment_type === "replace" ||
    args.intent.adjustment_type === "reset" ||
    args.intent.adjustment_type === "new_goal"
  ) {
    return "user_completed_goal_wants_new_bar";
  }
  return "goal_change_without_concrete_bar";
}

function shouldBypassStrongOutcomeForGoalTransition(args: {
  userMessage: string;
  intent: ReconciledGoalChangeIntent;
  recentThreadContext?: string | null;
  priorGoalChangeAskSatisfied?: boolean;
}): boolean {
  if (isUserCompletedGoalWantsToMoveOnLanguage(args.userMessage)) return true;
  const thread = args.recentThreadContext?.trim();
  if (thread && isUserCompletedGoalWantsToMoveOnLanguage(thread)) return true;
  if (
    args.priorGoalChangeAskSatisfied &&
    (args.intent.adjustment_type === "replace" ||
      args.intent.adjustment_type === "reset" ||
      args.intent.adjustment_type === "new_goal" ||
      args.intent.adjustment_type === "unspecified" ||
      args.intent.adjustment_type === "amend" ||
      args.intent.adjustment_type === "restate")
  ) {
    return true;
  }
  return false;
}

export type TuGoalChangePendingShellMetadata = {
  tu_goal_change_type: TurnUnderstandingGoalAdjustmentType;
  tu_goal_change_source: TurnUnderstandingGoalChangeSource;
  tu_goal_change_confidence: ReconciledGoalChangeIntent["confidence"];
  awaiting_candidate_reason: TuGoalChangePendingShellReason;
  goal_change_requires_confirmation: true;
  prior_goal_change_ask_satisfied: boolean;
  stale_ask_goal_change_bridge_eligible: boolean;
  no_outcome_write: true;
  no_state_change_taken: true;
  coach_initiated_goal_evolution?: true;
  accepted_invite_kind?: string | null;
  accepted_invite_source?: string | null;
  accepted_invite_sent_at?: string | null;
  accepted_invite_evidence_summary?: string | null;
};

export type TuGoalChangePendingSkipReason =
  | "not_authoritative"
  | "missing_proposed_bar"
  | "unsafe_or_invalid_bar"
  | "vague_candidate"
  | "identical_to_current_bar"
  | "existing_pending"
  | "planned_interruption"
  | "unsafe_inbound"
  | "strong_outcome_classification"
  | "no_active_commitment"
  | "mapper_failed"
  | "shell_deferred_low_confidence"
  | "shell_deferred_not_goal_change"
  | "shell_deferred_avoidance_or_miss_only"
  | "shell_deferred_multiple_goals"
  | "shell_deferred_proactive_source"
  | "shell_deferred_unspecified_no_evidence"
  | "shell_deferred_general_goal_talk";

export type TuGoalChangePendingHandoffEval = {
  open: boolean;
  mode: TuGoalChangePendingMode;
  skipReason: TuGoalChangePendingSkipReason | null;
  intentPack: V2SmsCommitmentIntentPack | null;
  validatedProposedBar: string | null;
  pendingShellReason: TuGoalChangePendingShellReason | null;
  shellMetadata: TuGoalChangePendingShellMetadata | null;
};

function normalizeGoalBarForCompare(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function tuConfidenceToAiScore(
  confidence: ReconciledGoalChangeIntent["confidence"]
): number {
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.7;
  return 0.5;
}

/** Server validation for TU proposed_new_goal_text — no DB writes. */
export function validateTuProposedGoalBarText(args: {
  proposedText: string | null | undefined;
  currentBehaviorStatement: string | null | undefined;
}): {
  ok: boolean;
  normalized: string | null;
  skipReason: TuGoalChangePendingSkipReason | null;
} {
  const normalized = normalizeGoalBarForCompare(args.proposedText ?? "");
  if (!normalized) {
    return { ok: false, normalized: null, skipReason: "missing_proposed_bar" };
  }
  const display = args.proposedText!.trim().replace(/\s+/g, " ").slice(0, CANDIDATE_EXTRACT_MAX);
  if (isUnsafeSmsGoalCandidateText(display)) {
    return { ok: false, normalized: null, skipReason: "unsafe_or_invalid_bar" };
  }
  if (isVagueOrInvalidSmsGoalCandidate(display)) {
    return { ok: false, normalized: null, skipReason: "vague_candidate" };
  }
  const current = normalizeGoalBarForCompare(args.currentBehaviorStatement ?? "");
  if (current && current === normalizeGoalBarForCompare(display)) {
    return { ok: false, normalized: null, skipReason: "identical_to_current_bar" };
  }
  return { ok: true, normalized: display, skipReason: null };
}

/**
 * Maps authoritative reconciled TU goal-change (with validated bar) into existing Wave4 intent pack.
 * Server-only — no OpenAI calls, no DB writes, no SMS copy.
 */
export function deriveIntentPackFromReconciledGoalChange(args: {
  intent: ReconciledGoalChangeIntent;
  validatedProposedBar: string;
}): V2SmsCommitmentIntentPack | null {
  const type = args.intent.adjustment_type;
  if (!TU_CONCRETE_BAR_PENDING_TYPES.has(type)) return null;

  const bar = args.validatedProposedBar.trim().replace(/\s+/g, " ").slice(0, CANDIDATE_EXTRACT_MAX);
  if (!bar) return null;

  const aiConfidence = tuConfidenceToAiScore(args.intent.confidence);

  if (type === "lower" || type === "shrink") {
    return {
      intent: "sms_tighten_request",
      candidateTightenedBar: bar,
      candidateNewBar: null,
      aiConfidence,
    };
  }

  if (type === "raise") {
    return {
      intent: "sms_raise_bar_request",
      candidateTightenedBar: null,
      candidateNewBar: bar,
      aiConfidence,
    };
  }

  // replace, new_goal, blocker_focus
  return {
    intent: "sms_replace_request",
    candidateTightenedBar: null,
    candidateNewBar: bar,
    aiConfidence,
  };
}

function hasCurrentGoalChangeEvidence(quote: string | null | undefined): boolean {
  const q = (quote ?? "").trim().toLowerCase();
  if (!q) return false;
  return /\b(goal|bar|commitment|standard|reset|amend|restate|replace|raise|lower|shrink|too\s+(easy|hard)|no longer fits|doesn't fit|does not fit)\b/.test(
    q
  );
}

function isMissOrAvoidanceOnlyMeaning(
  meaning: TurnUnderstandingRelationshipMeaning | null | undefined
): boolean {
  return (
    meaning === "miss" ||
    meaning === "partial_attempt" ||
    meaning === "emotional_reflection"
  );
}

/**
 * Slice 2B — maps authoritative TU goal-change without valid bar into Wave4 intent pack (no candidates).
 * Slice 3 may reuse this hallway for coach-initiated progression with the same shape.
 */
export function deriveAwaitingCandidateIntentPackFromReconciledGoalChange(args: {
  intent: ReconciledGoalChangeIntent;
}): V2SmsCommitmentIntentPack {
  const type = args.intent.adjustment_type;
  const aiConfidence = tuConfidenceToAiScore(args.intent.confidence);

  if (type === "lower" || type === "shrink") {
    return {
      intent: "sms_tighten_request",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence,
    };
  }

  if (type === "raise") {
    return {
      intent: "sms_raise_bar_request",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence,
    };
  }

  return {
    intent: "sms_change_unspecified",
    candidateTightenedBar: null,
    candidateNewBar: null,
    aiConfidence,
  };
}

function evaluateAwaitingCandidateShellEligibility(args: {
  intent: ReconciledGoalChangeIntent;
  userMessage: string;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
}): TuGoalChangePendingSkipReason | null {
  const type = args.intent.adjustment_type;
  const body = args.userMessage.trim();

  if (args.intent.confidence === "low") {
    return "shell_deferred_low_confidence";
  }

  if (TU_PROACTIVE_GOAL_CHANGE_SOURCES.has(args.intent.source)) {
    return "shell_deferred_proactive_source";
  }

  if (MULTIPLE_GOALS_DEFER_RE.test(body)) {
    return "shell_deferred_multiple_goals";
  }

  if (TU_EXPLICIT_SHELL_TYPES.has(type)) {
    return null;
  }

  if (type === "unspecified") {
    const meaningOk = args.relationshipMeaning === "goal_adjustment_request";
    const evidenceOk = hasCurrentGoalChangeEvidence(args.intent.evidence_quote);
    if (!meaningOk && !evidenceOk) {
      return "shell_deferred_unspecified_no_evidence";
    }
    if (!meaningOk && evidenceOk) {
      return null;
    }
    return null;
  }

  if (!TU_ADJUSTMENT_SHELL_TYPES.has(type)) {
    return "shell_deferred_not_goal_change";
  }

  if (
    isMissOrAvoidanceOnlyMeaning(args.relationshipMeaning) &&
    type !== "blocker_focus" &&
    !/\b(too\s+(easy|hard)|no longer fits|doesn't fit|does not fit|reset|amend|restate|change\s+(the\s+)?(goal|standard|bar))\b/i.test(
      body
    )
  ) {
    return "shell_deferred_avoidance_or_miss_only";
  }

  if (type === "raise" && args.relationshipMeaning === "reported_completion") {
    return "shell_deferred_avoidance_or_miss_only";
  }

  if (
    (type === "lower" || type === "shrink") &&
    args.relationshipMeaning === "miss" &&
    !/\b(too\s+hard|make\s+(it|this)\s+(smaller|easier|less)|lower|shrink|change\s+(the\s+)?(goal|standard|bar))\b/i.test(
      body
    )
  ) {
    return "shell_deferred_avoidance_or_miss_only";
  }

  return null;
}

function buildTuGoalChangeShellMetadata(args: {
  intent: ReconciledGoalChangeIntent;
  priorGoalChangeAskSatisfied: boolean;
  awaitingCandidateReason: TuGoalChangePendingShellReason;
}): TuGoalChangePendingShellMetadata {
  return {
    tu_goal_change_type: args.intent.adjustment_type,
    tu_goal_change_source: args.intent.source,
    tu_goal_change_confidence: args.intent.confidence,
    awaiting_candidate_reason: args.awaitingCandidateReason,
    goal_change_requires_confirmation: true,
    prior_goal_change_ask_satisfied: args.priorGoalChangeAskSatisfied,
    stale_ask_goal_change_bridge_eligible:
      args.priorGoalChangeAskSatisfied && args.intent.authoritative,
    no_outcome_write: true,
    no_state_change_taken: true,
  };
}

function skipEval(
  skipReason: TuGoalChangePendingSkipReason
): TuGoalChangePendingHandoffEval {
  return {
    open: false,
    mode: "skip",
    skipReason,
    intentPack: null,
    validatedProposedBar: null,
    pendingShellReason: null,
    shellMetadata: null,
  };
}

export function shouldOpenTuGoalChangePendingHandoff(args: {
  reconciledGoalChangeIntent: ReconciledGoalChangeIntent | null | undefined;
  commitment: ActiveV2CommitmentRow | null | undefined;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
  priorGoalChangeAskSatisfied?: boolean;
}): boolean {
  return evaluateTuGoalChangePendingHandoff(args).open;
}

/** Gate + mapper for TU goal-change → existing Wave4 pending hallway (Slice 2A concrete bar, Slice 2B shell). */
export function evaluateTuGoalChangePendingHandoff(args: {
  reconciledGoalChangeIntent: ReconciledGoalChangeIntent | null | undefined;
  commitment: ActiveV2CommitmentRow | null | undefined;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
  relationshipMeaning?: TurnUnderstandingRelationshipMeaning | null;
  priorGoalChangeAskSatisfied?: boolean;
  /** Slice 3B — validated coach invite acceptance may bypass bare yes/no outcome block. */
  bypassStrongOutcomeForCoachInviteAcceptance?: boolean;
  /** Recent thread excerpt for completed-goal / move-on context on readiness replies. */
  recentThreadContext?: string | null;
}): TuGoalChangePendingHandoffEval {
  const intent = args.reconciledGoalChangeIntent;
  if (!isAuthoritativeReconciledGoalChangeIntent(intent)) {
    return skipEval("not_authoritative");
  }

  if (!args.commitment?.id) {
    return skipEval("no_active_commitment");
  }

  if (args.plannedInterruptionActionable) {
    return skipEval("planned_interruption");
  }

  const body = args.userMessage.trim();
  const safety = classifyInboundSmsSafetyTier(body, { fromPhone: null, messageSid: null });
  if (safety.tier !== "safe") {
    return skipEval("unsafe_inbound");
  }

  const bypassStrongOutcome =
    args.bypassStrongOutcomeForCoachInviteAcceptance === true ||
    shouldBypassStrongOutcomeForGoalTransition({
      userMessage: body,
      intent: intent!,
      recentThreadContext: args.recentThreadContext,
      priorGoalChangeAskSatisfied: args.priorGoalChangeAskSatisfied,
    });

  if (
    args.classificationEventType &&
    isStrongV2YesNoOutcome(args.classificationEventType) &&
    !bypassStrongOutcome
  ) {
    return skipEval("strong_outcome_classification");
  }

  if (getPendingResolutionOrNull(args.commitment)) {
    return skipEval("existing_pending");
  }

  let intentForShell = intent!;
  let hadVagueProposedBar = false;
  const proposedPresent = Boolean(intent!.proposed_new_goal_text?.trim());
  let validated = validateTuProposedGoalBarText({
    proposedText: intent!.proposed_new_goal_text,
    currentBehaviorStatement: args.commitment.behavior_statement,
  });

  if (
    validated.ok &&
    validated.normalized &&
    isBroadThemeNotConcreteDailyBar(validated.normalized)
  ) {
    validated = { ok: false, normalized: null, skipReason: "vague_candidate" };
  }

  if (validated.ok && validated.normalized && TU_CONCRETE_BAR_PENDING_TYPES.has(intent!.adjustment_type)) {
    const intentPack = deriveIntentPackFromReconciledGoalChange({
      intent: intent!,
      validatedProposedBar: validated.normalized,
    });
    if (!intentPack) {
      return skipEval("mapper_failed");
    }
    return {
      open: true,
      mode: "concrete_bar_pending",
      skipReason: null,
      intentPack,
      validatedProposedBar: validated.normalized,
      pendingShellReason: null,
      shellMetadata: null,
    };
  }

  if (
    proposedPresent &&
    !validated.ok &&
    validated.skipReason === "vague_candidate"
  ) {
    const proposedText = (intent!.proposed_new_goal_text ?? "").trim();
    const redirectVagueToShell =
      hadVagueProposedBar ||
      isUserCompletedGoalWantsToMoveOnLanguage(body) ||
      isBroadThemeNotConcreteDailyBar(proposedText) ||
      Boolean(
        args.recentThreadContext?.trim() &&
          isUserCompletedGoalWantsToMoveOnLanguage(args.recentThreadContext)
      );
    if (redirectVagueToShell) {
      hadVagueProposedBar = true;
      intentForShell = { ...intent!, proposed_new_goal_text: null };
    } else {
      return skipEval("vague_candidate");
    }
  } else if (
    proposedPresent &&
    !validated.ok &&
    validated.skipReason &&
    validated.skipReason !== "missing_proposed_bar"
  ) {
    return skipEval(validated.skipReason);
  }

  const shellDefer = evaluateAwaitingCandidateShellEligibility({
    intent: intentForShell,
    userMessage: body,
    relationshipMeaning: args.relationshipMeaning,
  });
  if (shellDefer) {
    return skipEval(shellDefer);
  }

  const shellReason = resolveShellReasonForGoalTransition({
    userMessage: body,
    hadVagueProposedBar,
    intent: intentForShell,
  });
  const intentPack = deriveAwaitingCandidateIntentPackFromReconciledGoalChange({ intent: intentForShell });
  const priorAsk = args.priorGoalChangeAskSatisfied === true;
  return {
    open: true,
    mode: "awaiting_candidate_shell",
    skipReason: null,
    intentPack,
    validatedProposedBar: null,
    pendingShellReason: shellReason,
    shellMetadata: buildTuGoalChangeShellMetadata({
      intent: intentForShell,
      priorGoalChangeAskSatisfied: priorAsk,
      awaitingCandidateReason: shellReason,
    }),
  };
}

export function buildTuGoalChangeHandoffTelemetry(
  evalResult: TuGoalChangePendingHandoffEval,
  wave4?: {
    pendingApplied: boolean;
    pendingKind: V2PendingResolutionKind | null;
    skipReason: Wave4PendingSkipReason | null;
  } | null,
  coachInviteExtra?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    tu_goal_change_handoff_opened: evalResult.open,
    tu_goal_change_handoff_mode: evalResult.mode,
    awaiting_candidate_reason: evalResult.pendingShellReason,
    goal_change_handoff_reason: evalResult.pendingShellReason,
    user_completed_goal_wants_new_bar:
      evalResult.pendingShellReason === "user_completed_goal_wants_new_bar",
    old_goal_reask_blocked_after_move_on:
      evalResult.open &&
      (evalResult.pendingShellReason === "user_completed_goal_wants_new_bar" ||
        evalResult.pendingShellReason === "vague_theme_needs_concrete_bar"),
    goal_change_proposed_new_goal_text_present: Boolean(evalResult.validatedProposedBar),
    goal_change_pending_skip_reason:
      evalResult.skipReason ?? wave4?.skipReason ?? null,
    goal_change_pending_resolution_created: wave4?.pendingApplied === true,
    goal_change_pending_kind: wave4?.pendingKind ?? null,
    goal_change_routed_to_existing_handoff: evalResult.open || wave4?.pendingApplied === true,
    goal_change_requires_confirmation: evalResult.shellMetadata?.goal_change_requires_confirmation ?? true,
    goal_change_not_outcome_write: true,
    goal_change_no_state_mutation_without_confirmation: true,
    prior_goal_change_ask_satisfied: evalResult.shellMetadata?.prior_goal_change_ask_satisfied ?? null,
    stale_ask_goal_change_bridge_eligible:
      evalResult.shellMetadata?.stale_ask_goal_change_bridge_eligible ?? null,
    tu_goal_change_type: evalResult.shellMetadata?.tu_goal_change_type ?? null,
    coach_initiated_goal_evolution:
      evalResult.shellMetadata?.coach_initiated_goal_evolution === true,
    accepted_invite_kind: evalResult.shellMetadata?.accepted_invite_kind ?? null,
    accepted_invite_source: evalResult.shellMetadata?.accepted_invite_source ?? null,
    accepted_invite_sent_at: evalResult.shellMetadata?.accepted_invite_sent_at ?? null,
    ...(coachInviteExtra ?? {}),
  };
}

/** Slice 3B — validated coach invite acceptance → existing 2A/2B Wave4 hallway. */
export function evaluateCoachAcceptedGoalEvolutionHandoff(args: {
  acceptance: CoachInviteAcceptanceContext;
  commitment: ActiveV2CommitmentRow;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
}): TuGoalChangePendingHandoffEval {
  if (args.acceptance.disposition !== "accepted" || !args.acceptance.reconciled_intent) {
    return skipEval("not_authoritative");
  }

  const evalResult = evaluateTuGoalChangePendingHandoff({
    reconciledGoalChangeIntent: args.acceptance.reconciled_intent,
    commitment: args.commitment,
    userMessage: args.userMessage,
    plannedInterruptionActionable: args.plannedInterruptionActionable,
    classificationEventType: args.classificationEventType,
    relationshipMeaning: "goal_adjustment_request",
    bypassStrongOutcomeForCoachInviteAcceptance: true,
  });

  if (!evalResult.open || !evalResult.shellMetadata) {
    return evalResult;
  }

  const invite = args.acceptance.invite;
  const shellMetadata: TuGoalChangePendingShellMetadata = {
    ...evalResult.shellMetadata,
    awaiting_candidate_reason: "accepted_coach_goal_evolution_invite",
    coach_initiated_goal_evolution: true,
    accepted_invite_kind: invite.invite_kind,
    accepted_invite_source: invite.invite_source,
    accepted_invite_sent_at: invite.sent_at,
    accepted_invite_evidence_summary: invite.evidence_summary,
  };

  return {
    ...evalResult,
    pendingShellReason:
      evalResult.mode === "awaiting_candidate_shell"
        ? "accepted_coach_goal_evolution_invite"
        : evalResult.pendingShellReason,
    shellMetadata,
  };
}

export function shouldOpenCommitmentChangeHandoff(args: {
  gatedMode: string;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
}): boolean {
  if (args.plannedInterruptionActionable) return false;
  if (args.gatedMode === "commitment_change_handoff") return true;
  const body = args.userMessage.trim();
  if (!body) return false;
  const safety = classifyInboundSmsSafetyTier(body, { fromPhone: null, messageSid: null });
  if (safety.tier !== "safe") return false;
  if (!isLikelyCommitmentChangeIntentTurn(body)) return false;
  if (args.classificationEventType && isStrongV2YesNoOutcome(args.classificationEventType)) {
    return false;
  }
  return true;
}

export function deriveSmsCommitmentChangeIntent(args: {
  rawBody: string;
  interpretation: V2InboundShadowInterpretationResult | null;
  goalAdjustmentMove?: SmsGoalAdjustmentMove | null;
  plannedInterruptionActionable?: boolean;
}): V2SmsCommitmentIntentPack {
  const raw = args.rawBody.trim();
  const lower = raw.toLowerCase();
  const ai = args.interpretation?.ok === true ? args.interpretation.data : null;
  const conf = typeof ai?.confidence === "number" ? ai.confidence : null;
  const candidates = extractCandidateBarsFromSms(raw);

  if (args.plannedInterruptionActionable === true) {
    return {
      intent: "sms_change_unspecified",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  if (THIS_WEEK_IMPOSSIBLE_RE.test(raw)) {
    return {
      intent: "sms_change_unspecified",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  const quitLike =
    /\b(i\s+quit|i\s+want\s+to\s+quit|i\s+can't\s+do\s+this|i\s+cannot\s+do\s+this|i'?m\s+done|im\s+done|this\s+is\s+pointless|i\s+give\s+up)\b/i.test(
      raw
    ) ||
    (ai?.discouraged_or_frustrated === true &&
      /\b(quit|done|pointless|can'?t|cannot|give\s+up)\b/i.test(lower));

  if (quitLike) {
    return {
      intent: "sms_soft_quit_or_frustration",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  const raiseFromSignal = args.goalAdjustmentMove === "raise_bar";
  const explicitRaisePhrase = RAISE_BAR_PHRASE_RE.test(raw);
  if (
    explicitRaisePhrase ||
    (raiseFromSignal && (explicitRaisePhrase || candidates.candidateNewBar))
  ) {
    return {
      intent: "sms_raise_bar_request",
      candidateTightenedBar: null,
      candidateNewBar: candidates.candidateNewBar,
      aiConfidence: conf,
    };
  }

  const replaceLike =
    /\b(new\s+goal|replace|different\s+goal|doesn'?t\s+fit|does\s+not\s+fit|change\s+(the\s+)?goal|switch\s+to|not\s+the\s+right\s+goal)\b/i.test(
      lower
    ) ||
    isUserCompletedGoalWantsToMoveOnLanguage(raw) ||
    ai?.intent === "commitment_change_request";

  const tightenLike =
    /\b(smaller|too\s+much|lower\s+(the\s+)?bar|tighten|scale\s+it\s+down|make\s+it\s+easier|less\s+time|overwhelming)\b/i.test(
      lower
    );

  if (replaceLike && !tightenLike) {
    return {
      intent: "sms_replace_request",
      candidateTightenedBar: null,
      candidateNewBar: candidates.candidateNewBar,
      aiConfidence: conf,
    };
  }

  if (tightenLike && !replaceLike) {
    return {
      intent: "sms_tighten_request",
      candidateTightenedBar: candidates.candidateTightenedBar,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  if (tightenLike && replaceLike) {
    if (candidates.candidateTightenedBar && !candidates.candidateNewBar) {
      return {
        intent: "sms_tighten_request",
        candidateTightenedBar: candidates.candidateTightenedBar,
        candidateNewBar: null,
        aiConfidence: conf,
      };
    }
    return {
      intent: "sms_replace_request",
      candidateTightenedBar: null,
      candidateNewBar: candidates.candidateNewBar,
      aiConfidence: conf,
    };
  }

  return {
    intent: "sms_change_unspecified",
    candidateTightenedBar: candidates.candidateTightenedBar,
    candidateNewBar: candidates.candidateNewBar,
    aiConfidence: conf,
  };
}

export function buildSmsCommitmentChangeCoachReply(pack: V2SmsCommitmentIntentPack): string {
  switch (pack.intent) {
    case "sms_soft_quit_or_frustration":
      return "I hear you. That may mean the bar is wrong, not that you're done. Want to make it smaller, change the goal, or tell me what's honest right now?";
    case "sms_tighten_request":
      if (pack.candidateTightenedBar?.trim()) {
        const bar = pack.candidateTightenedBar.trim();
        return `Good — I won't rewrite the full commitment from here, but I'll hold you to this honest smaller version: ${bar}. Same fight, clearer bar.`;
      }
      return "What smaller version would still be honest tomorrow?";
    case "sms_replace_request":
      if (pack.candidateNewBar?.trim()) {
        const nb = pack.candidateNewBar.trim();
        return `Got it. I'm holding this as your candidate new bar: ${nb}. When you're ready to lock it in, say it again as one clear daily-action sentence.`;
      }
      return "What should the new daily bar be?";
    case "sms_change_unspecified":
    default:
      return "Something needs to change — I get it. Is it the size of the bar, or the goal itself? Tell me what feels honest.";
  }
}

const SMS_MAX_WAVE4 = 300;

/** Shown when an SMS commitment update is already in flight (Wave4 / lane facts only). */
export const COMMITMENT_CHANGE_EXISTING_PENDING_FOLLOWUP_NOTE =
  "You already have a commitment update in progress—reply here to finish it before starting another.";

export function appendWhenExistingPendingResolution(base: string): string {
  const tail = " " + COMMITMENT_CHANGE_EXISTING_PENDING_FOLLOWUP_NOTE;
  const merged = base.trimEnd() + tail;
  return merged.length <= SMS_MAX_WAVE4 ? merged : base;
}

export type Wave4PendingSkipReason =
  | "soft_quit"
  | "paused_reactivation"
  | "refresh_session_active"
  | "existing_pending"
  | "unsafe_goal_content";

/**
 * Optionally sets pending_resolution_* from SMS (no commitment mutation).
 * Skips when paused, refresh session active, existing pending, or soft-quit-only.
 */
export async function applyWave4SmsCommitmentPendingResolution(args: {
  commitmentId: string;
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  messageSid: string;
  rawBody: string;
  intentPack: V2SmsCommitmentIntentPack;
  shellMetadata?: TuGoalChangePendingShellMetadata | null;
}): Promise<{
  pendingApplied: boolean;
  pendingKind: V2PendingResolutionKind | null;
  skipReason: Wave4PendingSkipReason | null;
}> {
  const { intentPack } = args;
  if (intentPack.intent === "sms_soft_quit_or_frustration") {
    return { pendingApplied: false, pendingKind: null, skipReason: "soft_quit" };
  }

  const rawSafety = classifyInboundSmsSafetyTier(args.rawBody, {
    fromPhone: null,
    messageSid: args.messageSid,
  });
  if (rawSafety.tier !== "safe") {
    return { pendingApplied: false, pendingKind: null, skipReason: "unsafe_goal_content" };
  }

  if (
    isUnsafeSmsGoalCandidateText(intentPack.candidateNewBar ?? "") ||
    isUnsafeSmsGoalCandidateText(intentPack.candidateTightenedBar ?? "")
  ) {
    return { pendingApplied: false, pendingKind: null, skipReason: "unsafe_goal_content" };
  }

  if (args.commitment.accountability_phase === "low_pressure_reactivation") {
    return { pendingApplied: false, pendingKind: null, skipReason: "paused_reactivation" };
  }

  if (isRefreshSessionActive(args.commitment)) {
    return { pendingApplied: false, pendingKind: null, skipReason: "refresh_session_active" };
  }

  await clearPendingResolutionIfExpired(args.commitmentId, args.commitment);
  const row = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  if (getPendingResolutionOrNull(row)) {
    return { pendingApplied: false, pendingKind: null, skipReason: "existing_pending" };
  }

  const kind: V2PendingResolutionKind =
    intentPack.intent === "sms_tighten_request" ? "commitment_tighten" : "commitment_replace";

  const payload: V2SmsPendingResolutionPayload = {
    source: "sms_inbound",
    sms_state: "awaiting_candidate",
    detected_intent: intentPack.intent,
    raw_user_text: args.rawBody,
    inbound_message_sid: args.messageSid,
    ai_confidence: intentPack.aiConfidence,
    candidate_tightened_bar: intentPack.candidateTightenedBar,
    candidate_new_bar: intentPack.candidateNewBar,
    ...(args.shellMetadata
      ? {
          tu_goal_change_type: args.shellMetadata.tu_goal_change_type,
          tu_goal_change_source: args.shellMetadata.tu_goal_change_source,
          tu_goal_change_confidence: args.shellMetadata.tu_goal_change_confidence,
          awaiting_candidate_reason: args.shellMetadata.awaiting_candidate_reason,
          goal_change_requires_confirmation: args.shellMetadata.goal_change_requires_confirmation,
          prior_goal_change_ask_satisfied: args.shellMetadata.prior_goal_change_ask_satisfied,
          stale_ask_goal_change_bridge_eligible:
            args.shellMetadata.stale_ask_goal_change_bridge_eligible,
          no_outcome_write: args.shellMetadata.no_outcome_write,
          no_state_change_taken: args.shellMetadata.no_state_change_taken,
          ...(args.shellMetadata.coach_initiated_goal_evolution === true
            ? {
                coach_initiated_goal_evolution: true as const,
                accepted_invite_kind: args.shellMetadata.accepted_invite_kind ?? null,
                accepted_invite_source: args.shellMetadata.accepted_invite_source ?? null,
                accepted_invite_sent_at: args.shellMetadata.accepted_invite_sent_at ?? null,
                accepted_invite_evidence_summary:
                  args.shellMetadata.accepted_invite_evidence_summary ?? null,
              }
            : {}),
        }
      : {}),
    ...(kind === "commitment_replace"
      ? (() => {
          const season = deriveSeasonModeForSmsGoalChange({
            rawBody: args.rawBody,
            candidateBar: intentPack.candidateNewBar ?? intentPack.candidateTightenedBar,
            currentBehaviorStatement: args.commitment.behavior_statement,
          });
          return {
            season_mode: season.mode,
            season_mode_reason: season.reason,
            season_mode_set_at: new Date().toISOString(),
          };
        })()
      : {}),
  };

  await setPendingResolution({
    commitmentId: args.commitmentId,
    kind,
    payload,
    expectedUpdatedAt: row.updated_at,
  });

  return { pendingApplied: true, pendingKind: kind, skipReason: null };
}
