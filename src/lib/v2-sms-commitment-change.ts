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
import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import { isStrongV2YesNoOutcome } from "@/lib/v2-sms-accountability";
import {
  isAuthoritativeReconciledGoalChangeIntent,
  type ReconciledGoalChangeIntent,
  type TurnUnderstandingGoalAdjustmentType,
} from "@/lib/openai-relationship-turn-understanding-v1";

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

export type TuGoalChangePendingSkipReason =
  | "not_authoritative"
  | "deferred_slice_2b_type"
  | "missing_proposed_bar"
  | "unsafe_or_invalid_bar"
  | "vague_candidate"
  | "identical_to_current_bar"
  | "existing_pending"
  | "planned_interruption"
  | "unsafe_inbound"
  | "strong_outcome_classification"
  | "no_active_commitment"
  | "mapper_failed";

export type TuGoalChangePendingHandoffEval = {
  open: boolean;
  skipReason: TuGoalChangePendingSkipReason | null;
  intentPack: V2SmsCommitmentIntentPack | null;
  validatedProposedBar: string | null;
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

export function shouldOpenTuGoalChangePendingHandoff(args: {
  reconciledGoalChangeIntent: ReconciledGoalChangeIntent | null | undefined;
  commitment: ActiveV2CommitmentRow | null | undefined;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
}): boolean {
  return evaluateTuGoalChangePendingHandoff(args).open;
}

/** Gate + mapper for TU concrete proposed bar → existing Wave4 pending hallway (Slice 2A). */
export function evaluateTuGoalChangePendingHandoff(args: {
  reconciledGoalChangeIntent: ReconciledGoalChangeIntent | null | undefined;
  commitment: ActiveV2CommitmentRow | null | undefined;
  userMessage: string;
  plannedInterruptionActionable: boolean;
  classificationEventType: "user_yes" | "user_no" | "user_partial" | null;
}): TuGoalChangePendingHandoffEval {
  const intent = args.reconciledGoalChangeIntent;
  if (!isAuthoritativeReconciledGoalChangeIntent(intent)) {
    return { open: false, skipReason: "not_authoritative", intentPack: null, validatedProposedBar: null };
  }

  if (!args.commitment?.id) {
    return { open: false, skipReason: "no_active_commitment", intentPack: null, validatedProposedBar: null };
  }

  if (args.plannedInterruptionActionable) {
    return { open: false, skipReason: "planned_interruption", intentPack: null, validatedProposedBar: null };
  }

  const body = args.userMessage.trim();
  const safety = classifyInboundSmsSafetyTier(body, { fromPhone: null, messageSid: null });
  if (safety.tier !== "safe") {
    return { open: false, skipReason: "unsafe_inbound", intentPack: null, validatedProposedBar: null };
  }

  if (args.classificationEventType && isStrongV2YesNoOutcome(args.classificationEventType)) {
    return {
      open: false,
      skipReason: "strong_outcome_classification",
      intentPack: null,
      validatedProposedBar: null,
    };
  }

  if (!TU_CONCRETE_BAR_PENDING_TYPES.has(intent!.adjustment_type)) {
    return {
      open: false,
      skipReason: "deferred_slice_2b_type",
      intentPack: null,
      validatedProposedBar: null,
    };
  }

  if (getPendingResolutionOrNull(args.commitment)) {
    return {
      open: false,
      skipReason: "existing_pending",
      intentPack: null,
      validatedProposedBar: null,
    };
  }

  const validated = validateTuProposedGoalBarText({
    proposedText: intent!.proposed_new_goal_text,
    currentBehaviorStatement: args.commitment.behavior_statement,
  });
  if (!validated.ok || !validated.normalized) {
    return {
      open: false,
      skipReason: validated.skipReason ?? "unsafe_or_invalid_bar",
      intentPack: null,
      validatedProposedBar: null,
    };
  }

  const intentPack = deriveIntentPackFromReconciledGoalChange({
    intent: intent!,
    validatedProposedBar: validated.normalized,
  });
  if (!intentPack) {
    return {
      open: false,
      skipReason: "mapper_failed",
      intentPack: null,
      validatedProposedBar: validated.normalized,
    };
  }

  return {
    open: true,
    skipReason: null,
    intentPack,
    validatedProposedBar: validated.normalized,
  };
}

export function buildTuGoalChangeHandoffTelemetry(
  evalResult: TuGoalChangePendingHandoffEval,
  wave4?: {
    pendingApplied: boolean;
    pendingKind: V2PendingResolutionKind | null;
    skipReason: Wave4PendingSkipReason | null;
  } | null
): Record<string, unknown> {
  return {
    tu_goal_change_handoff_opened: evalResult.open,
    goal_change_proposed_new_goal_text_present: Boolean(evalResult.validatedProposedBar),
    goal_change_pending_skip_reason:
      evalResult.skipReason ?? wave4?.skipReason ?? null,
    goal_change_pending_resolution_created: wave4?.pendingApplied === true,
    goal_change_pending_kind: wave4?.pendingKind ?? null,
    goal_change_routed_to_existing_handoff: evalResult.open || wave4?.pendingApplied === true,
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
    ) || ai?.intent === "commitment_change_request";

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
