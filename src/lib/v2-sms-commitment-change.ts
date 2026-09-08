/**
 * Wave 4: SMS-native commitment change / tighten / replace — first pass.
 * Conservative on DB mutation; uses pending_resolution_* when safe.
 */

import { isRefreshSessionActive } from "@/lib/v2-refresh-session";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
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
import type {
  ReconciledGoalChangeIntent,
  TurnUnderstandingGoalAdjustmentType,
  TurnUnderstandingGoalChangeSource,
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
  // Acknowledgments / meta change-requests are not goals (hygiene; not a conversation router).
  if (
    /^(yes|yeah|yep|yup|y|no|nope|ok|okay|sure|i\s+agree|sounds\s+good)[\s.!?]*$/i.test(t)
  ) {
    return true;
  }
  if (
    /^(yes[,.\s]+)?(i'?m\s+thinking\s+i\s+need\s+a\s+change|i\s+think\s+i\s+need\s+(a\s+change|to\s+change(\s+my\s+goal)?)|i\s+(want|need)\s+a\s+change|change\s+it|let'?s\s+change(\s+it)?|i\s+(want|need)\s+to\s+change(\s+my\s+goal)?|i\s+(want|need)\s+a\s+different\s+goal|can\s+we\s+change(\s+my)?\s+goal|that\s+goal\s+isn'?t\s+right|not\s+that\s+goal|what\s+is\s+the\s+lock|what\s+does\s+(the\s+)?lock\s+mean)[\s.!?]*$/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^(be healthier|healthier|better|more consistent|something different)$/i.test(t)) {
    return true;
  }
  if (
    /\b(what\s+(is|does)\s+(the\s+)?lock|what\s+i\s+agree|the\s+lock)\b/i.test(t) &&
    !/\b(every\s+day|each\s+day|daily|minutes?|steps?|walk|read|compliment|pray|call|write)\b/i.test(t)
  ) {
    return true;
  }
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
    /\b(?:(?:i\s+)?(?:want|need)\s+to\s+)?change\s+(?:my\s+|the\s+)?(?:goal|commitment)\s+to\s+(.{3,180}?)(?:[.!?]|$)/i
  );
  if (changeGoalTo?.[1]?.trim()) {
    const bar = sliceCandidateClause(changeGoalTo[1]!);
    if (!isIdentityLikeGoalCandidate(bar) && !isVagueOrInvalidSmsGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const wantMyGoalToBe = t.match(
    /\b(?:i\s+)?(?:just\s+)?want\s+(?:my\s+)?(?:new\s+)?goal\s+to\s+be\s+(.{3,180}?)(?:[.!?]|$)/i
  );
  if (wantMyGoalToBe?.[1]?.trim()) {
    const bar = sliceCandidateClause(wantMyGoalToBe[1]!);
    if (!isIdentityLikeGoalCandidate(bar) && !isVagueOrInvalidSmsGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const makeMyGoal = t.match(/\bmake\s+(?:my\s+)?goal\s+(.{3,180}?)(?:[.!?]|$)/i);
  if (makeMyGoal?.[1]?.trim()) {
    const bar = sliceCandidateClause(makeMyGoal[1]!);
    if (!isIdentityLikeGoalCandidate(bar) && !isVagueOrInvalidSmsGoalCandidate(bar)) {
      return { candidateTightenedBar: null, candidateNewBar: bar };
    }
  }

  const changeItTo = t.match(
    /\b(?:can\s+you\s+|please\s+)?change\s+it\s+to\s+(.{3,180}?)(?:[.!?]|$)/i
  );
  if (changeItTo?.[1]?.trim() && !/\b(?:my\s+|the\s+)?new\s+goal\b/i.test(changeItTo[1]!)) {
    const bar = sliceCandidateClause(changeItTo[1]!);
    if (!isIdentityLikeGoalCandidate(bar) && !isVagueOrInvalidSmsGoalCandidate(bar)) {
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

/** Stale goal-change clarify phrases — remaining V3 writers must not repeat when a shell is live. */
export const GOAL_CHANGE_STALE_ASK_FORBIDDEN_SUBSTRINGS = [
  "what specific changes",
  "adjustments are you considering",
  "adjustments you have in mind",
  "changes or adjustments",
] as const;

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

function normalizeGoalBarForCompare(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
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
