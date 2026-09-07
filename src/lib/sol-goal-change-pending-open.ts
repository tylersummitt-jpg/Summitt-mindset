/**
 * Slice 2 — open durable SMS Goal Change pending from Sol semantic interpretation.
 * Does not apply the canonical Goal Change RPC. Planned interruption must not
 * suppress this path. Confirmation is authorized only after reload proves pending.
 */

import type OpenAI from "openai";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
} from "@/lib/v2-guided-resolution";
import {
  applyWave4SmsCommitmentPendingResolution,
  validateTuProposedGoalBarText,
} from "@/lib/v2-sms-commitment-change";
import { isUnsafeSmsGoalCandidateText } from "@/lib/sms-inbound-safety";
import {
  bootstrapSmsPendingConfirmationFromInbound,
  extractDeterministicDailyBarCandidate,
  isVagueOrInvalidCandidateBar,
} from "@/lib/v2-sms-pending-resolution-complete";
import {
  buildSolGoalChangeSemanticInput,
  type SolGoalChangeAuthoritativePending,
  type SolGoalChangeSemanticInput,
  type SolGoalChangeSemanticResult,
  type SolGoalChangeSemanticThreadMessage,
} from "@/lib/sol-goal-change-semantic";
import { runSolGoalChangeSemanticInterpreter } from "@/lib/sol-goal-change-semantic-interpreter";

import {
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  isSolGoalChangeClockOnlyFragment,
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-clock-substitute";

export type { SolGoalChangeConfirmationAuthorization };
export { SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED };
export { trySubstituteClockFragmentIntoCanonical };

/**
 * Slice 5 correction: Sol-owned first-turn saved-replace hallway when the member
 * wants a durable Goal Change but has not named a usable candidate.
 * New first-turn Wave4 tighten/raise-bar English is intentionally NOT restored.
 * Overlay remains live via adaptive / guided / refresh / predeploy tighten pending.
 */

export type SolGoalChangePendingOpenForensics = {
  interpreter_ok: boolean | null;
  interpreter_error: string | null;
  semantic_intent: string | null;
  pending_attempted: boolean;
  pending_write_applied: boolean;
  pending_skip_reason: string | null;
  bootstrap_promoted: boolean | null;
  reload_authorized: boolean;
  candidate_normalize_ok: boolean | null;
  hallway_opened: boolean;
};

export type SolGoalChangePendingOpenResult = {
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  forensics: SolGoalChangePendingOpenForensics;
};

function unauthorized(
  commitment: ActiveV2CommitmentRow,
  forensics: Partial<SolGoalChangePendingOpenForensics>
): SolGoalChangePendingOpenResult {
  return {
    commitment,
    authorization: {
      ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
      canonical_behavior_statement: (commitment.behavior_statement ?? "").trim(),
    },
    forensics: {
      interpreter_ok: null,
      interpreter_error: null,
      semantic_intent: null,
      pending_attempted: false,
      pending_write_applied: false,
      pending_skip_reason: null,
      bootstrap_promoted: null,
      reload_authorized: false,
      candidate_normalize_ok: null,
      hallway_opened: false,
      ...forensics,
    },
  };
}

function pendingSnapshotFromCommitment(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeAuthoritativePending | null {
  if (!isSmsInboundPendingResolutionActionable(commitment)) return null;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending) return null;
  const payload = pending.payload;
  if (!payload || payload.source !== "sms_inbound") return null;
  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return null;
  }
  const smsState = payload.sms_state ?? "awaiting_candidate";
  return {
    actionable: true,
    kind: pending.kind,
    sms_state:
      smsState === "awaiting_confirmation" || smsState === "awaiting_candidate"
        ? smsState
        : null,
    candidate_behavior_statement:
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_new_bar?.trim() ||
      payload.candidate_tightened_bar?.trim() ||
      null,
    source: payload.source === "sms_inbound" ? "sms_inbound" : null,
  };
}

export function confirmationAuthorizationFromReloadedCommitment(
  commitment: ActiveV2CommitmentRow,
  expectedCandidate?: string | null
): SolGoalChangeConfirmationAuthorization {
  const canonical = (commitment.behavior_statement ?? "").trim();
  const none: SolGoalChangeConfirmationAuthorization = {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: canonical,
  };
  if (!isSmsInboundPendingResolutionActionable(commitment)) return none;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending || pending.kind !== "commitment_replace") return none;
  const payload = pending.payload;
  if (!payload || payload.source !== "sms_inbound") return none;
  if ((payload.sms_state ?? "") !== "awaiting_confirmation") return none;
  const candidate =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_new_bar?.trim() ||
    "";
  if (!candidate) return none;
  if (expectedCandidate?.trim()) {
    if (normalizeBarKey(candidate) !== normalizeBarKey(expectedCandidate)) return none;
  }
  return {
    goal_change_confirmation_authorized: true,
    goal_change_apply_authorized: false,
    candidate_behavior_statement: candidate,
    canonical_behavior_statement: canonical,
    pending_state: "awaiting_confirmation",
    previous_behavior_statement: null,
    previous_commitment_id: null,
    active_commitment_id: commitment.id,
    pending_cleared: false,
  };
}

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

const WEEKDAY_TOKEN_RE =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|weekdays?|weekends?)\b/gi;

const FREQUENCY_FRAGMENT_RE =
  /^(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|times?|nights?|workouts?)(?:\s+(?:a|per|each)\s+week)?$/i;

const WEEKDAY_SPAN_FRAGMENT_RE =
  /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\s+(?:through|thru|to|-|–|—)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)$/i;

function isWeekdayTokensOnly(text: string): boolean {
  const stripped = text
    .replace(WEEKDAY_TOKEN_RE, " ")
    .replace(/\b(?:through|thru|to|and|&)\b/gi, " ")
    .replace(/[-–—,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length === 0;
}

/**
 * Structural fragment check — not an English brain.
 * Shared by first-turn pending-open, Turn 2 awaiting_candidate, and Slice 3 modify.
 * Rejects raw clocks, frequency crumbs, and weekday-only crumbs so they cannot
 * become canonical via Slice 3 apply. Does not reconstruct a full bar.
 */
export function isStructuralIncompleteReplacementCandidate(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return true;
  if (isSolGoalChangeClockOnlyFragment(t)) return true;
  const bare = t.replace(/[.!?]+$/g, "").trim();
  if (FREQUENCY_FRAGMENT_RE.test(bare)) return true;
  if (WEEKDAY_SPAN_FRAGMENT_RE.test(bare)) return true;
  if (isWeekdayTokensOnly(bare)) return true;
  return false;
}

export function normalizeSemanticSavedReplaceCandidate(args: {
  semanticCandidate: string;
  canonicalBehaviorStatement: string;
  inboundRaw: string;
}): { ok: true; candidate: string } | { ok: false; reason: string } {
  const semantic = args.semanticCandidate.trim().replace(/\s+/g, " ");
  if (!semantic) return { ok: false, reason: "empty_semantic_candidate" };

  let candidate = semantic;
  const substituted = trySubstituteClockFragmentIntoCanonical(
    args.canonicalBehaviorStatement.trim(),
    semantic
  );
  if (substituted) {
    candidate = substituted.trim().replace(/\s+/g, " ");
  } else if (isSolGoalChangeClockOnlyFragment(semantic)) {
    const extracted = extractDeterministicDailyBarCandidate(args.inboundRaw);
    if (extracted?.trim()) {
      candidate = extracted.trim().replace(/\s+/g, " ");
    } else {
      return { ok: false, reason: "clock_fragment_unnormalizable" };
    }
  }

  if (isSolGoalChangeClockOnlyFragment(candidate)) {
    return { ok: false, reason: "clock_fragment_unnormalizable" };
  }
  if (isStructuralIncompleteReplacementCandidate(candidate)) {
    return { ok: false, reason: "incomplete_replacement_fragment" };
  }
  if (isUnsafeSmsGoalCandidateText(candidate)) {
    return { ok: false, reason: "unsafe_goal_content" };
  }
  if (isVagueOrInvalidCandidateBar(candidate)) {
    return { ok: false, reason: "vague_or_invalid" };
  }
  const validated = validateTuProposedGoalBarText({
    proposedText: candidate,
    currentBehaviorStatement: args.canonicalBehaviorStatement,
  });
  if (!validated.ok || !validated.normalized) {
    return { ok: false, reason: validated.skipReason ?? "validate_failed" };
  }
  return { ok: true, candidate: validated.normalized };
}

export function shouldAttemptSolSavedReplacePendingOpen(
  result: SolGoalChangeSemanticResult
): boolean {
  const g = result.goal_change;
  if (g.intent !== "saved_replace") return false;
  if (!g.candidate_behavior_statement?.trim()) return false;
  if (g.confirms_existing_pending) return false;
  if (g.rejects_existing_pending) return false;
  if (g.modifies_existing_pending_candidate) return false;
  if (g.needs_clarification) return false;
  return true;
}

/**
 * Sol-owned replace hallway: member wants a saved Goal Change, no usable candidate yet.
 * Phrase lists / Wave4 / TU must not authorize this shell.
 */
export function shouldAttemptSolSavedReplaceAwaitingCandidateHallway(
  result: SolGoalChangeSemanticResult
): boolean {
  const g = result.goal_change;
  if (g.intent !== "saved_replace" && g.intent !== "possible_saved_replace") return false;
  if (g.confirms_existing_pending) return false;
  if (g.rejects_existing_pending) return false;
  if (g.modifies_existing_pending_candidate) return false;
  if (!g.needs_clarification) return false;
  if (g.candidate_behavior_statement?.trim()) return false;
  return true;
}

function existingAwaitingConfirmationReplace(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeConfirmationAuthorization | null {
  const auth = confirmationAuthorizationFromReloadedCommitment(commitment);
  return auth.goal_change_confirmation_authorized ? auth : null;
}

export async function runSolGoalChangePendingOpenForInbound(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  inboundRaw: string;
  messageSid: string;
  plannedInterruptionKnown: boolean;
  timezone?: string | null;
  recentExactThread?: SolGoalChangeSemanticThreadMessage[] | null;
  client?: OpenAI | null;
}): Promise<SolGoalChangePendingOpenResult> {
  const liveStart = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;

  const existing = existingAwaitingConfirmationReplace(liveStart);
  if (existing) {
    return {
      commitment: liveStart,
      authorization: existing,
      forensics: {
        interpreter_ok: null,
        interpreter_error: null,
        semantic_intent: null,
        pending_attempted: false,
        pending_write_applied: false,
        pending_skip_reason: "existing_pending",
        bootstrap_promoted: null,
        reload_authorized: true,
        candidate_normalize_ok: null,
        hallway_opened: false,
      },
    };
  }

  if (isSmsInboundPendingResolutionActionable(liveStart)) {
    return unauthorized(liveStart, {
      pending_skip_reason: "existing_pending_not_confirmable",
    });
  }

  const semanticInput: SolGoalChangeSemanticInput = buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: liveStart.behavior_statement ?? "",
    effectiveCoachingAsk: getEffectiveCoachingAsk(liveStart),
    authoritativePending: pendingSnapshotFromCommitment(liveStart),
    latestInboundText: args.inboundRaw,
    recentExactThread: args.recentExactThread,
    plannedInterruptionKnown: args.plannedInterruptionKnown,
    timezone: args.timezone,
    localDaypart: "inbound",
  });

  let interpreted: Awaited<ReturnType<typeof runSolGoalChangeSemanticInterpreter>>;
  try {
    interpreted = await runSolGoalChangeSemanticInterpreter({
      input: semanticInput,
      client: args.client,
    });
  } catch (err) {
    return unauthorized(liveStart, {
      interpreter_ok: false,
      interpreter_error: err instanceof Error ? err.message.slice(0, 180) : "interpreter_threw",
    });
  }

  if (!interpreted.ok || !interpreted.result) {
    return unauthorized(liveStart, {
      interpreter_ok: false,
      interpreter_error: interpreted.ok ? "missing_result" : interpreted.error,
    });
  }

  const semantic = interpreted.result;
  if (shouldAttemptSolSavedReplaceAwaitingCandidateHallway(semantic)) {
    return writeSavedReplacePending({
      clerkUserId: args.clerkUserId,
      liveStart,
      inboundRaw: args.inboundRaw,
      messageSid: args.messageSid,
      semanticIntent: semantic.goal_change.intent,
      candidateNewBar: null,
      openedAsAwaitingCandidateShell: true,
      expectedCandidate: null,
    });
  }

  if (!shouldAttemptSolSavedReplacePendingOpen(semantic)) {
    return unauthorized(liveStart, {
      interpreter_ok: true,
      semantic_intent: semantic.goal_change.intent,
      pending_skip_reason: "semantic_not_saved_replace_open",
    });
  }

  const normalized = normalizeSemanticSavedReplaceCandidate({
    semanticCandidate: semantic.goal_change.candidate_behavior_statement!,
    canonicalBehaviorStatement: liveStart.behavior_statement ?? "",
    inboundRaw: args.inboundRaw,
  });
  if (!normalized.ok) {
    return unauthorized(liveStart, {
      interpreter_ok: true,
      semantic_intent: semantic.goal_change.intent,
      candidate_normalize_ok: false,
      pending_skip_reason: normalized.reason,
    });
  }

  return writeSavedReplacePending({
    clerkUserId: args.clerkUserId,
    liveStart,
    inboundRaw: args.inboundRaw,
    messageSid: args.messageSid,
    semanticIntent: semantic.goal_change.intent,
    candidateNewBar: normalized.candidate,
    openedAsAwaitingCandidateShell: false,
    expectedCandidate: normalized.candidate,
  });
}

async function writeSavedReplacePending(args: {
  clerkUserId: string;
  liveStart: ActiveV2CommitmentRow;
  inboundRaw: string;
  messageSid: string;
  semanticIntent: string;
  candidateNewBar: string | null;
  openedAsAwaitingCandidateShell: boolean;
  expectedCandidate: string | null;
}): Promise<SolGoalChangePendingOpenResult> {
  const { liveStart } = args;
  let pendingApplied = false;
  let skipReason: string | null = null;
  try {
    const wave4 = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: liveStart.id,
      clerkUserId: args.clerkUserId,
      commitment: liveStart,
      messageSid: args.messageSid,
      rawBody: args.inboundRaw,
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: args.candidateNewBar,
        aiConfidence: null,
      },
    });
    pendingApplied = wave4.pendingApplied === true;
    skipReason = wave4.skipReason;
    if (!pendingApplied) {
      return unauthorized(liveStart, {
        interpreter_ok: true,
        semantic_intent: args.semanticIntent,
        candidate_normalize_ok: args.candidateNewBar != null,
        pending_attempted: true,
        pending_write_applied: false,
        pending_skip_reason: skipReason ?? "wave4_not_applied",
      });
    }
    await recomputeV2CoachingMemory(liveStart.id, {
      reasonCode: args.openedAsAwaitingCandidateShell
        ? "sol_goal_change_pending_open_hallway"
        : "sol_goal_change_pending_open",
    });
  } catch (err) {
    return unauthorized(liveStart, {
      interpreter_ok: true,
      semantic_intent: args.semanticIntent,
      candidate_normalize_ok: args.candidateNewBar != null,
      pending_attempted: true,
      pending_write_applied: false,
      pending_skip_reason: err instanceof Error ? err.message.slice(0, 120) : "pending_write_threw",
    });
  }

  const afterWrite = (await getActiveCommitment(args.clerkUserId)) ?? liveStart;
  let bootstrapPromoted: boolean | null = null;
  try {
    const boot = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: afterWrite,
      rawBody: args.inboundRaw,
      openedAsAwaitingCandidateShell: args.openedAsAwaitingCandidateShell,
    });
    bootstrapPromoted = boot.promoted;
  } catch (err) {
    return unauthorized(afterWrite, {
      interpreter_ok: true,
      semantic_intent: args.semanticIntent,
      candidate_normalize_ok: args.candidateNewBar != null,
      pending_attempted: true,
      pending_write_applied: true,
      bootstrap_promoted: false,
      hallway_opened: args.openedAsAwaitingCandidateShell,
      pending_skip_reason:
        err instanceof Error ? err.message.slice(0, 120) : "bootstrap_threw",
    });
  }

  const reloaded = (await getActiveCommitment(args.clerkUserId)) ?? afterWrite;
  const authorization = args.openedAsAwaitingCandidateShell
    ? {
        ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
        canonical_behavior_statement: (reloaded.behavior_statement ?? "").trim(),
        pending_state: "awaiting_candidate" as const,
        active_commitment_id: reloaded.id,
      }
    : confirmationAuthorizationFromReloadedCommitment(reloaded, args.expectedCandidate);
  return {
    commitment: reloaded,
    authorization,
    forensics: {
      interpreter_ok: true,
      interpreter_error: null,
      semantic_intent: args.semanticIntent,
      pending_attempted: true,
      pending_write_applied: pendingApplied,
      pending_skip_reason: skipReason,
      bootstrap_promoted: bootstrapPromoted,
      reload_authorized: authorization.goal_change_confirmation_authorized,
      candidate_normalize_ok: args.candidateNewBar != null,
      hallway_opened: args.openedAsAwaitingCandidateShell,
    },
  };
}
