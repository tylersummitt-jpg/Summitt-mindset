/**
 * Slice 3 — semantic confirmation of an EXISTING authoritative Goal Change pending,
 * then deterministic canonical apply + post-mutation reload proof.
 *
 * Does not create pending (Slice 2). Does not infer pending from conversation history.
 * The model never mutates Current Goal. Only applyCanonicalGoalChangeWithSeasonMutation
 * (the live production RPC wrapper) may replace.
 *
 * AUTHORITY: Sol interprets English. Code does not.
 * When runSolGoalChangeSemanticInterpreter succeeds, Sol owns meaning.
 * Server then verifies live pending, executes consequence, reloads, authorizes.
 *
 * Sol-down fallback is a microscopic protocol response to an authoritative
 * pending yes/no confirmation question — not NLP / synonym matching:
 * - exact Yes / Y → confirm (optional trailing . !)
 * - exact No / N → reject (optional trailing . !)
 * Y/N are the same SMS protocol tokens already treated as yes/no elsewhere.
 * Yep / Sounds good / Absolutely / Keep 9:30 / Never mind / Yes but 10:15
 * require Sol. Without Sol: pending unchanged, re-ask. No restage, no clear,
 * no apply of the old candidate.
 *
 * parseSmsConfirmation remains in the repo for legacy/tests. Its synonym
 * matching must not cause mutation when Sol is unavailable.
 *
 * Qualification heuristics may veto unsafe clean-confirm (Yes but 10:15).
 * They must not override Sol rejects_existing_pending (Actually keep 9:30).
 */

import type OpenAI from "openai";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  mergeSmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { applyCanonicalGoalChangeWithSeasonMutation } from "@/lib/v2-apply-canonical-goal-change";
import type { SmsGoalSeasonMutationResult } from "@/lib/v2-sms-goal-season-mutation";
import { tryMergeWeekdaysIntoCandidate } from "@/lib/v2-sms-pending-resolution-complete";
import {
  buildSolGoalChangeSemanticInput,
  inboundHasMaterialGoalChangeConfirmationQualification,
  pendingHasConfirmableCandidate,
  type SolGoalChangeAuthoritativePending,
  type SolGoalChangeSemanticResult,
  type SolGoalChangeSemanticThreadMessage,
} from "@/lib/sol-goal-change-semantic";
import { runSolGoalChangeSemanticInterpreter } from "@/lib/sol-goal-change-semantic-interpreter";
import {
  confirmationAuthorizationFromReloadedCommitment,
  normalizeSemanticSavedReplaceCandidate,
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-pending-open";
import {
  AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK,
  buildAppliedGoalChangeAuthorization,
  buildAuthorizedAppliedGoalAck,
  buildAuthorizedPendingConfirmationAsk,
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import { refreshUnsentTtoDraftsAfterRelationshipChange } from "@/lib/sol-goal-change-tto-draft-refresh";

const RAW_LOG_MAX = 280;
const CLOCK_IN_TEXT_RE = /\b(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?))?\b/gi;
/** Exact protocol confirm to an authoritative pending yes/no ask. Not NLP. */
const EXACT_PROTOCOL_YES_RE = /^(yes|y)\.?!?$/i;
/** Exact protocol reject to an authoritative pending yes/no ask. Not NLP. */
const EXACT_PROTOCOL_NO_RE = /^(no|n)\.?!?$/i;

export type SolGoalChangePendingConfirmConsequence =
  | "applied"
  | "rejected"
  | "modified"
  | "ambiguous"
  | "rpc_failed"
  | "reload_mismatch"
  | "not_applicable";

export type SolGoalChangePendingConfirmMeaning =
  | "confirm"
  | "reject"
  | "modify"
  | "ambiguous";

export type SolGoalChangePendingConfirmForensics = {
  interpreter_ok: boolean | null;
  interpreter_error: string | null;
  semantic_confirms: boolean | null;
  semantic_rejects: boolean | null;
  semantic_modifies: boolean | null;
  qualification_veto: boolean;
  deterministic_yes_fallback: boolean;
  meaning: SolGoalChangePendingConfirmMeaning | null;
  mutation_attempted: boolean;
  rpc_ok: boolean | null;
  rpc_code: string | null;
  reload_proved: boolean | null;
  reload_fail_reason: string | null;
};

export type SolGoalChangePendingConfirmResult = {
  handled: boolean;
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  consequence: SolGoalChangePendingConfirmConsequence;
  forensics: SolGoalChangePendingConfirmForensics;
};

function emptyForensics(
  extras: Partial<SolGoalChangePendingConfirmForensics> = {}
): SolGoalChangePendingConfirmForensics {
  return {
    interpreter_ok: null,
    interpreter_error: null,
    semantic_confirms: null,
    semantic_rejects: null,
    semantic_modifies: null,
    qualification_veto: false,
    deterministic_yes_fallback: false,
    meaning: null,
    mutation_attempted: false,
    rpc_ok: null,
    rpc_code: null,
    reload_proved: null,
    reload_fail_reason: null,
    ...extras,
  };
}

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
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

export function liveReplaceConfirmationCandidate(
  commitment: ActiveV2CommitmentRow
): string | null {
  const snap = pendingSnapshotFromCommitment(commitment);
  if (!pendingHasConfirmableCandidate(snap) || snap?.kind !== "commitment_replace") {
    return null;
  }
  return snap.candidate_behavior_statement?.trim() || null;
}

/**
 * Sol-down confirm fallback: exact protocol Yes / Y only.
 * Not Yep / Yeah / Sounds good / Okay / I agree / Absolutely.
 */
export function isExactPendingProtocolYes(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (inboundHasMaterialGoalChangeConfirmationQualification(t)) return false;
  return EXACT_PROTOCOL_YES_RE.test(t);
}

/**
 * Sol-down reject fallback: exact protocol No / N only.
 * Not Keep 9:30 / Never mind / Leave it / I changed my mind.
 */
export function isExactPendingProtocolNo(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (inboundHasMaterialGoalChangeConfirmationQualification(t)) return false;
  return EXACT_PROTOCOL_NO_RE.test(t);
}

/** @deprecated Use isExactPendingProtocolYes. Kept as the Sol-down confirm gate. */
export function isSafeDeterministicPendingYesFallback(raw: string): boolean {
  return isExactPendingProtocolYes(raw);
}

/** @deprecated Use isExactPendingProtocolNo. Kept as the Sol-down reject gate. */
export function isDeterministicPendingReject(raw: string): boolean {
  return isExactPendingProtocolNo(raw);
}

function extractSingleClockFragment(raw: string): string | null {
  const matches = [...raw.matchAll(new RegExp(CLOCK_IN_TEXT_RE.source, "gi"))];
  if (matches.length !== 1) return null;
  return matches[0]![0]!.trim();
}

export function resolveModifiedPendingCandidate(args: {
  inboundRaw: string;
  canonicalBehaviorStatement: string;
  currentCandidate: string;
  semanticCandidate: string | null;
}): string | null {
  const currentKey = normalizeBarKey(args.currentCandidate);
  const inboundClock = extractSingleClockFragment(args.inboundRaw);

  const acceptIfDifferent = (candidate: string | null): string | null => {
    if (!candidate?.trim()) return null;
    if (normalizeBarKey(candidate) === currentKey) return null;
    const normalized = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: candidate,
      canonicalBehaviorStatement: args.canonicalBehaviorStatement,
      inboundRaw: args.inboundRaw,
    });
    if (!normalized.ok) return null;
    if (normalizeBarKey(normalized.candidate) === currentKey) return null;
    return normalized.candidate;
  };

  if (inboundClock) {
    const fromCanon = trySubstituteClockFragmentIntoCanonical(
      args.canonicalBehaviorStatement,
      inboundClock
    );
    const acceptedCanon = acceptIfDifferent(fromCanon ?? inboundClock);
    if (acceptedCanon) return acceptedCanon;
    const fromPending = trySubstituteClockFragmentIntoCanonical(
      args.currentCandidate,
      inboundClock
    );
    const acceptedPending = acceptIfDifferent(fromPending ?? inboundClock);
    if (acceptedPending) return acceptedPending;
  }

  const weekdays = tryMergeWeekdaysIntoCandidate(args.currentCandidate, args.inboundRaw);
  const acceptedDays = acceptIfDifferent(weekdays);
  if (acceptedDays) return acceptedDays;

  if (args.semanticCandidate?.trim()) {
    const acceptedSemantic = acceptIfDifferent(args.semanticCandidate);
    if (acceptedSemantic) return acceptedSemantic;
  }

  return null;
}

export function resolveSolGoalChangePendingConfirmMeaning(args: {
  inboundRaw: string;
  semantic: SolGoalChangeSemanticResult | null;
  interpreterOk: boolean;
}): {
  meaning: SolGoalChangePendingConfirmMeaning;
  qualificationVeto: boolean;
  deterministicYesFallback: boolean;
} {
  const inbound = args.inboundRaw.trim();
  const qualificationVeto = inboundHasMaterialGoalChangeConfirmationQualification(inbound);
  const g = args.semantic?.goal_change;
  const semanticConfirm = g?.confirms_existing_pending === true;
  const semanticReject = g?.rejects_existing_pending === true;
  const semanticModify = g?.modifies_existing_pending_candidate === true;

  if (!args.interpreterOk) {
    if (isExactPendingProtocolNo(inbound)) {
      return { meaning: "reject", qualificationVeto, deterministicYesFallback: false };
    }
    if (isExactPendingProtocolYes(inbound)) {
      return { meaning: "confirm", qualificationVeto, deterministicYesFallback: true };
    }
    return { meaning: "ambiguous", qualificationVeto, deterministicYesFallback: false };
  }

  // Sol owns English. Qualification heuristics may not override a Sol rejection
  // (`Actually keep 9:30`). They may still veto unsafe clean-confirm.
  if (semanticReject && !semanticModify) {
    return { meaning: "reject", qualificationVeto, deterministicYesFallback: false };
  }

  if (qualificationVeto || semanticModify) {
    return { meaning: "modify", qualificationVeto, deterministicYesFallback: false };
  }

  if (semanticConfirm && !semanticReject && !semanticModify) {
    return { meaning: "confirm", qualificationVeto, deterministicYesFallback: false };
  }

  return { meaning: "ambiguous", qualificationVeto, deterministicYesFallback: false };
}

export function provePostMutationGoalChangeReload(args: {
  before: ActiveV2CommitmentRow;
  after: ActiveV2CommitmentRow | null;
  expectedBehaviorStatement: string;
  rpc: SmsGoalSeasonMutationResult;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.after) return { ok: false, reason: "reload_missing_active" };
  if (normalizeBarKey(args.after.behavior_statement ?? "") !==
    normalizeBarKey(args.expectedBehaviorStatement)) {
    return { ok: false, reason: "reload_behavior_mismatch" };
  }
  if (isSmsInboundPendingResolutionActionable(args.after)) {
    return { ok: false, reason: "reload_pending_still_active" };
  }
  if (args.after.id !== args.rpc.newCommitmentId) {
    return { ok: false, reason: "reload_commitment_id_mismatch" };
  }
  if (!args.rpc.idempotentReplay && args.after.id === args.before.id) {
    return { ok: false, reason: "reload_same_commitment_id" };
  }
  return { ok: true };
}

export function buildSolGoalChangePendingConfirmFallbackBody(
  authorization: SolGoalChangeConfirmationAuthorization
): string {
  if (authorization.goal_change_apply_authorized) {
    return buildAuthorizedAppliedGoalAck(authorization);
  }
  if (
    authorization.goal_change_confirmation_authorized &&
    authorization.pending_state === "awaiting_confirmation"
  ) {
    return buildAuthorizedPendingConfirmationAsk(authorization);
  }
  if (
    authorization.pending_state === "awaiting_candidate" &&
    !(authorization.candidate_behavior_statement ?? "").trim()
  ) {
    return AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK;
  }
  const canon = (authorization.canonical_behavior_statement ?? "").trim().replace(/\.+$/, "");
  if (canon) {
    return `Got it. Your current goal is unchanged: ${canon}.`;
  }
  return "Got it. Your current goal is unchanged.";
}

function pendingAuthFromLive(
  commitment: ActiveV2CommitmentRow,
  expectedCandidate?: string | null
): SolGoalChangeConfirmationAuthorization {
  return confirmationAuthorizationFromReloadedCommitment(commitment, expectedCandidate);
}

function neitherAuth(commitment: ActiveV2CommitmentRow): SolGoalChangeConfirmationAuthorization {
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: (commitment.behavior_statement ?? "").trim(),
    active_commitment_id: commitment.id,
    pending_cleared: !isSmsInboundPendingResolutionActionable(commitment),
  };
}

async function restageModifiedCandidate(args: {
  commitment: ActiveV2CommitmentRow;
  nextCandidate: string;
  inboundRaw: string;
  messageSid: string;
}): Promise<ActiveV2CommitmentRow> {
  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: args.commitment.id,
    merge: (prev) => ({
      ...prev,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: args.nextCandidate,
      candidate_new_bar: args.nextCandidate,
      raw_user_text: args.inboundRaw.slice(0, RAW_LOG_MAX),
      inbound_message_sid: args.messageSid,
      confirmation_prompt_sent_at: new Date().toISOString(),
    }),
  });
  if (merged.ok) {
    await recomputeV2CoachingMemory(args.commitment.id, {
      reasonCode: "sms_pending_resolution_candidate_refined",
    });
  }
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

async function clearPendingKeepCurrent(args: {
  commitment: ActiveV2CommitmentRow;
}): Promise<ActiveV2CommitmentRow> {
  await clearPendingResolution(args.commitment.id, {
    expectedUpdatedAt: args.commitment.updated_at,
  });
  await recomputeV2CoachingMemory(args.commitment.id, {
    reasonCode: "sms_pending_resolution_keep_current_cleared",
  });
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

export async function runSolGoalChangePendingConfirmForInbound(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  inboundRaw: string;
  messageSid: string;
  timezone?: string | null;
  recentExactThread?: SolGoalChangeSemanticThreadMessage[] | null;
  client?: OpenAI | null;
}): Promise<SolGoalChangePendingConfirmResult> {
  const inbound = args.inboundRaw.trim();
  const liveStart = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  const startCandidate = liveReplaceConfirmationCandidate(liveStart);

  if (!startCandidate) {
    return {
      handled: false,
      commitment: liveStart,
      authorization: confirmationAuthorizationFromReloadedCommitment(liveStart),
      consequence: "not_applicable",
      forensics: emptyForensics(),
    };
  }

  const semanticInput = buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: liveStart.behavior_statement ?? "",
    effectiveCoachingAsk: getEffectiveCoachingAsk(liveStart),
    authoritativePending: pendingSnapshotFromCommitment(liveStart),
    latestInboundText: inbound,
    recentExactThread: args.recentExactThread,
    plannedInterruptionKnown: false,
  });

  let semantic: SolGoalChangeSemanticResult | null = null;
  let interpreterOk = false;
  let interpreterError: string | null = null;
  try {
    const interpreted = await runSolGoalChangeSemanticInterpreter({
      input: semanticInput,
      client: args.client,
    });
    interpreterOk = interpreted.ok;
    if (interpreted.ok) {
      semantic = interpreted.result;
    } else {
      interpreterError = interpreted.error;
    }
  } catch (e) {
    interpreterOk = false;
    interpreterError = e instanceof Error ? e.message : "interpreter_threw";
  }

  const resolved = resolveSolGoalChangePendingConfirmMeaning({
    inboundRaw: inbound,
    semantic,
    interpreterOk,
  });

  const baseForensics = emptyForensics({
    interpreter_ok: interpreterOk,
    interpreter_error: interpreterError,
    semantic_confirms: semantic?.goal_change.confirms_existing_pending ?? null,
    semantic_rejects: semantic?.goal_change.rejects_existing_pending ?? null,
    semantic_modifies: semantic?.goal_change.modifies_existing_pending_candidate ?? null,
    qualification_veto: resolved.qualificationVeto,
    deterministic_yes_fallback: resolved.deterministicYesFallback,
    meaning: resolved.meaning,
  });

  const handledBase = {
    handled: true as const,
  };

  if (resolved.meaning === "modify") {
    if (!interpreterOk) {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, startCandidate),
        consequence: "ambiguous",
        forensics: baseForensics,
      };
    }
    const nextCandidate = resolveModifiedPendingCandidate({
      inboundRaw: inbound,
      canonicalBehaviorStatement: liveStart.behavior_statement ?? "",
      currentCandidate: startCandidate,
      semanticCandidate: semantic?.goal_change.candidate_behavior_statement ?? null,
    });
    if (!nextCandidate) {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, startCandidate),
        consequence: "ambiguous",
        forensics: baseForensics,
      };
    }
    const restaged = await restageModifiedCandidate({
      commitment: liveStart,
      nextCandidate,
      inboundRaw: inbound,
      messageSid: args.messageSid,
    });
    return {
      ...handledBase,
      commitment: restaged,
      authorization: pendingAuthFromLive(restaged, nextCandidate),
      consequence: "modified",
      forensics: baseForensics,
    };
  }

  if (resolved.meaning === "reject") {
    try {
      const cleared = await clearPendingKeepCurrent({ commitment: liveStart });
      return {
        ...handledBase,
        commitment: cleared,
        authorization: {
          ...neitherAuth(cleared),
          pending_cleared: true,
        },
        consequence: "rejected",
        forensics: baseForensics,
      };
    } catch {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, startCandidate),
        consequence: "ambiguous",
        forensics: baseForensics,
      };
    }
  }

  if (resolved.meaning !== "confirm") {
    return {
      ...handledBase,
      commitment: liveStart,
      authorization: pendingAuthFromLive(liveStart, startCandidate),
      consequence: "ambiguous",
      forensics: baseForensics,
    };
  }

  const liveBeforeRpc = (await getActiveCommitment(args.clerkUserId)) ?? liveStart;
  const liveCandidate = liveReplaceConfirmationCandidate(liveBeforeRpc);
  if (!liveCandidate || normalizeBarKey(liveCandidate) !== normalizeBarKey(startCandidate)) {
    return {
      ...handledBase,
      commitment: liveBeforeRpc,
      authorization: confirmationAuthorizationFromReloadedCommitment(liveBeforeRpc),
      consequence: "ambiguous",
      forensics: {
        ...baseForensics,
        reload_proved: false,
        reload_fail_reason: "live_pending_mismatch_before_rpc",
      },
    };
  }

  let rpc: SmsGoalSeasonMutationResult | { ok: false; code: string };
  try {
    rpc = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: args.clerkUserId,
      commitment: liveBeforeRpc,
      behaviorStatement: liveCandidate,
      seasonMode: "new_chapter",
      idempotencyKey: args.messageSid,
      proofMessageSid: args.messageSid,
      memoryReasonCode: "sms_pending_resolution_replace",
      memoryReasonCodeIdempotentReplay: "sms_pending_resolution_replace_raced_winner",
    });
  } catch (e) {
    return {
      ...handledBase,
      commitment: liveBeforeRpc,
      authorization: pendingAuthFromLive(liveBeforeRpc, liveCandidate),
      consequence: "rpc_failed",
      forensics: {
        ...baseForensics,
        mutation_attempted: true,
        rpc_ok: false,
        rpc_code: e instanceof Error ? e.message : "rpc_threw",
        reload_proved: false,
      },
    };
  }

  if (!rpc.ok) {
    return {
      ...handledBase,
      commitment: liveBeforeRpc,
      authorization: pendingAuthFromLive(liveBeforeRpc, liveCandidate),
      consequence: "rpc_failed",
      forensics: {
        ...baseForensics,
        mutation_attempted: true,
        rpc_ok: false,
        rpc_code: rpc.code,
        reload_proved: false,
      },
    };
  }

  const liveAfter = await getActiveCommitment(args.clerkUserId);
  const proved = provePostMutationGoalChangeReload({
    before: liveBeforeRpc,
    after: liveAfter,
    expectedBehaviorStatement: liveCandidate,
    rpc,
  });

  if (!proved.ok || !liveAfter) {
    return {
      ...handledBase,
      commitment: liveAfter ?? liveBeforeRpc,
      authorization: neitherAuth(liveAfter ?? liveBeforeRpc),
      consequence: "reload_mismatch",
      forensics: {
        ...baseForensics,
        mutation_attempted: true,
        rpc_ok: true,
        rpc_code: rpc.rpcResult,
        reload_proved: false,
        reload_fail_reason: proved.ok ? "reload_missing_active" : proved.reason,
      },
    };
  }

  try {
    await refreshUnsentTtoDraftsAfterRelationshipChange({
      clerkUserId: args.clerkUserId,
    });
  } catch (error) {
    console.warn("[sol-goal-change-tto-draft-refresh] after_saved_apply", error);
  }

  return {
    ...handledBase,
    commitment: liveAfter,
    authorization: buildAppliedGoalChangeAuthorization({
      previousBehaviorStatement: liveBeforeRpc.behavior_statement ?? "",
      previousCommitmentId: liveBeforeRpc.id,
      activeBehaviorStatement: liveAfter.behavior_statement ?? "",
      activeCommitmentId: liveAfter.id,
    }),
    consequence: "applied",
    forensics: {
      ...baseForensics,
      mutation_attempted: true,
      rpc_ok: true,
      rpc_code: rpc.rpcResult,
      reload_proved: true,
    },
  };
}
