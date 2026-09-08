/**
 * Slice 7C — Sol-owned temporary overlay confirmation, overlay RPC apply,
 * and post-RPC reload proof.
 *
 * Sol owns English via the shared Goal Change semantic interpreter.
 * Code owns state, overlay mutation, and proof.
 * Canonical Current Goal never mutates here.
 *
 * Two clocks:
 * - semantic/turn time (`now`): inbound created_at. Interpretation only.
 * - mutation/proof wall-clock (`mutationClock`, default Date.now): pre-apply
 *   expiry, immediately-before-RPC expiry, overlay-active conflict, and
 *   post-RPC overlay-active proof. Never authorize overlay apply from
 *   stale job.created_at.
 *
 * Sol-down fallback is the same microscopic protocol as saved Goal Change:
 * exact Yes / Y confirm, exact No / N reject. Synonyms require Sol.
 */

import type OpenAI from "openai";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
  persistContractOverlayProposed,
} from "@/lib/v2-adaptive-contract";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  mergeSmsPendingResolutionPayload,
  setPendingResolution,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  buildSolGoalChangeSemanticInput,
  type SolGoalChangeAuthoritativePending,
  type SolGoalChangeSemanticResult,
  type SolGoalChangeSemanticThreadMessage,
} from "@/lib/sol-goal-change-semantic";
import {
  liveOverlayMatchesReplacementSnapshot,
  replaceActiveTemporaryOverlay,
} from "@/lib/sol-goal-change-temporary-replace";
import { runSolGoalChangeSemanticInterpreter } from "@/lib/sol-goal-change-semantic-interpreter";
import { confirmationAuthorizationFromReloadedCommitment } from "@/lib/sol-goal-change-pending-open";
import {
  isExactPendingProtocolNo,
  isExactPendingProtocolYes,
} from "@/lib/sol-goal-change-pending-confirm";
import {
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import { refreshUnsentTtoDraftsAfterRelationshipChange } from "@/lib/sol-goal-change-tto-draft-refresh";
import {
  applySolTemporaryHallwayMerge,
  canPromoteSolTemporaryConfirmation,
  freezeTemporaryDurationFromSemantic,
  frozenDurationFromExistingPayload,
  isSolOwnedTemporaryAwaitingConfirmationPending,
  isSolOwnedTemporaryOverlayPending,
  isTemporaryExpiryStillConfirmable,
  normalizeSemanticTemporaryCandidate,
  resolveSolTemporaryHallwayFrozenDuration,
  runSolTemporaryOverlayHoldingForInbound,
  semanticSuppliesTemporaryDuration,
  temporaryConfirmationAuthorizationFromReloadedCommitment,
} from "@/lib/sol-goal-change-temporary-pending";

export const SOL_TEMPORARY_OVERLAY_CONTRACT_KIND = "temporary_ask" as const;

const RAW_LOG_MAX = 280;

export type SolTemporaryConfirmConsequence =
  | "applied"
  | "rejected"
  | "modified"
  | "ambiguous"
  | "permanent_instead"
  | "permanent_instead_failed"
  | "overlay_conflict"
  | "rpc_failed"
  | "reload_mismatch"
  | "not_applicable";

export type SolTemporaryConfirmMeaning =
  | "confirm"
  | "reject"
  | "modify"
  | "ambiguous"
  | "permanent_instead";

export type SolTemporaryConfirmForensics = {
  interpreter_ok: boolean | null;
  interpreter_error: string | null;
  semantic_confirms: boolean | null;
  semantic_rejects: boolean | null;
  semantic_modifies: boolean | null;
  semantic_intent: string | null;
  qualification_veto: boolean;
  deterministic_yes_fallback: boolean;
  meaning: SolTemporaryConfirmMeaning | null;
  mutation_attempted: boolean;
  rpc_ok: boolean | null;
  rpc_code: string | null;
  reload_proved: boolean | null;
  reload_fail_reason: string | null;
  pending_cleared: boolean | null;
  overlay_expires_at_passed: string | null;
};

export type SolTemporaryConfirmResult = {
  handled: boolean;
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  consequence: SolTemporaryConfirmConsequence;
  forensics: SolTemporaryConfirmForensics;
};

function emptyForensics(
  extras: Partial<SolTemporaryConfirmForensics> = {}
): SolTemporaryConfirmForensics {
  return {
    interpreter_ok: null,
    interpreter_error: null,
    semantic_confirms: null,
    semantic_rejects: null,
    semantic_modifies: null,
    semantic_intent: null,
    qualification_veto: false,
    deterministic_yes_fallback: false,
    meaning: null,
    mutation_attempted: false,
    rpc_ok: null,
    rpc_code: null,
    reload_proved: null,
    reload_fail_reason: null,
    pending_cleared: null,
    overlay_expires_at_passed: null,
    ...extras,
  };
}

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function overlayExpiryMatches(live: string | null | undefined, expected: string): boolean {
  const a = Date.parse(live ?? "");
  const b = Date.parse(expected);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function pendingSnapshotFromCommitment(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeAuthoritativePending | null {
  if (!isSmsInboundPendingResolutionActionable(commitment)) return null;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending) return null;
  const payload = pending.payload;
  if (!payload || payload.source !== "sms_inbound") return null;
  if (pending.kind !== "commitment_tighten") return null;
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
      payload.candidate_tightened_bar?.trim() ||
      null,
    source: "sms_inbound",
  };
}

function smsTempPayload(commitment: ActiveV2CommitmentRow): V2SmsPendingResolutionPayload | null {
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending?.payload || pending.payload.source !== "sms_inbound") return null;
  if (pending.kind !== "commitment_tighten") return null;
  if (pending.payload.sol_temporary_overlay !== true) return null;
  return pending.payload;
}

function isReplacementPending(payload: V2SmsPendingResolutionPayload): boolean {
  return payload.replaces_active_temporary_overlay === true;
}

function tempCandidate(payload: V2SmsPendingResolutionPayload): string | null {
  return (
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_tightened_bar?.trim() ||
    null
  );
}

function neitherAuth(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeConfirmationAuthorization {
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: (commitment.behavior_statement ?? "").trim(),
    active_commitment_id: commitment.id,
    pending_cleared: !isSmsInboundPendingResolutionActionable(commitment),
    temporary_adjustment_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: false,
  };
}

function pendingAuthFromLive(
  commitment: ActiveV2CommitmentRow,
  nowMs: number,
  expectedCandidate?: string | null
): SolGoalChangeConfirmationAuthorization {
  return temporaryConfirmationAuthorizationFromReloadedCommitment(
    commitment,
    expectedCandidate,
    nowMs
  );
}

export function durationFieldsDifferFromPayload(
  semantic: SolGoalChangeSemanticResult,
  payload: V2SmsPendingResolutionPayload
): boolean {
  if (!semanticSuppliesTemporaryDuration(semantic)) return false;
  const g = semantic.goal_change;
  return (
    g.temporary_duration_kind !== (payload.temporary_duration_kind ?? "unspecified") ||
    (g.temporary_duration_days ?? null) !== (payload.temporary_duration_days ?? null) ||
    (g.temporary_weekday ?? null) !== (payload.temporary_weekday ?? null) ||
    (g.temporary_end_local_date ?? null) !== (payload.temporary_end_local_date ?? null)
  );
}

export function resolveSolTemporaryConfirmMeaning(args: {
  inboundRaw: string;
  semantic: SolGoalChangeSemanticResult | null;
  interpreterOk: boolean;
  payload: V2SmsPendingResolutionPayload;
  liveCanonical: string;
}): {
  meaning: SolTemporaryConfirmMeaning;
  qualificationVeto: boolean;
  deterministicYesFallback: boolean;
} {
  const inbound = args.inboundRaw.trim();
  const g = args.semantic?.goal_change;
  const semanticConfirm = g?.confirms_existing_pending === true;
  const semanticReject = g?.rejects_existing_pending === true;
  const semanticModifyFlag = g?.modifies_existing_pending_candidate === true;
  const qualificationVeto = false;

  if (!args.interpreterOk) {
    if (isExactPendingProtocolNo(inbound)) {
      return { meaning: "reject", qualificationVeto: false, deterministicYesFallback: false };
    }
    if (isExactPendingProtocolYes(inbound)) {
      return { meaning: "confirm", qualificationVeto: false, deterministicYesFallback: true };
    }
    return { meaning: "ambiguous", qualificationVeto: false, deterministicYesFallback: false };
  }

  if (semanticReject && !semanticModifyFlag) {
    return { meaning: "reject", qualificationVeto, deterministicYesFallback: false };
  }

  if (g?.intent === "saved_replace") {
    return { meaning: "permanent_instead", qualificationVeto, deterministicYesFallback: false };
  }

  const current = tempCandidate(args.payload);
  let nextCandidate: string | null = null;
  if (g?.candidate_behavior_statement?.trim()) {
    const normalized = normalizeSemanticTemporaryCandidate({
      semanticCandidate: g.candidate_behavior_statement,
      canonicalBehaviorStatement: args.liveCanonical,
    });
    if (normalized.ok) nextCandidate = normalized.candidate;
  }
  const candidateChanged =
    Boolean(nextCandidate) &&
    Boolean(current) &&
    normalizeBarKey(nextCandidate!) !== normalizeBarKey(current!);
  const durationChanged =
    args.semantic != null && durationFieldsDifferFromPayload(args.semantic, args.payload);

  if (semanticModifyFlag || candidateChanged || durationChanged) {
    return { meaning: "modify", qualificationVeto, deterministicYesFallback: false };
  }

  if (semanticConfirm && !semanticReject && !semanticModifyFlag) {
    return { meaning: "confirm", qualificationVeto, deterministicYesFallback: false };
  }

  return { meaning: "ambiguous", qualificationVeto, deterministicYesFallback: false };
}

export function proveTemporaryOverlayApply(args: {
  before: ActiveV2CommitmentRow;
  after: ActiveV2CommitmentRow | null;
  expectedCandidate: string;
  expectedExpiresAt: string;
  canonicalSnapshot: string;
  nowMs: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.after) return { ok: false, reason: "reload_missing_active" };
  if (args.after.id !== args.before.id) return { ok: false, reason: "reload_commitment_id_changed" };
  if (args.after.status !== "active") return { ok: false, reason: "reload_not_active" };
  const beforeCanon = (args.before.behavior_statement ?? "").trim();
  const afterCanon = (args.after.behavior_statement ?? "").trim();
  const snap = args.canonicalSnapshot.trim();
  if (afterCanon !== beforeCanon) return { ok: false, reason: "reload_canonical_changed" };
  if (afterCanon !== snap) return { ok: false, reason: "reload_canonical_snapshot_mismatch" };
  if (normalizeBarKey(args.after.adaptive_ask_text ?? "") !== normalizeBarKey(args.expectedCandidate)) {
    return { ok: false, reason: "reload_overlay_text_mismatch" };
  }
  if (!args.after.adaptive_ask_active_from?.trim()) {
    return { ok: false, reason: "reload_overlay_active_from_missing" };
  }
  if (!overlayExpiryMatches(args.after.adaptive_ask_expires_at, args.expectedExpiresAt)) {
    return { ok: false, reason: "reload_overlay_expiry_mismatch" };
  }
  if (isSmsInboundPendingResolutionActionable(args.after)) {
    return { ok: false, reason: "reload_pending_still_active" };
  }
  if (!isV2AdaptiveOverlayActive(args.after, args.nowMs)) {
    return { ok: false, reason: "reload_overlay_not_active" };
  }
  const effective = getEffectiveCoachingAsk(args.after, args.nowMs);
  if (normalizeBarKey(effective) !== normalizeBarKey(args.expectedCandidate)) {
    return { ok: false, reason: "reload_effective_ask_mismatch" };
  }
  return { ok: true };
}

export function buildTemporaryAppliedAuthorization(args: {
  commitment: ActiveV2CommitmentRow;
  candidate: string;
  expiresAt: string;
  lastIncludedLocalDate: string | null;
  replacesActiveTemporaryOverlay?: boolean;
}): SolGoalChangeConfirmationAuthorization {
  const canonical = (args.commitment.behavior_statement ?? "").trim();
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: false,
    temporary_adjustment_apply_authorized: true,
    candidate_behavior_statement: args.candidate,
    temporary_candidate_behavior_statement: args.candidate,
    canonical_behavior_statement: canonical,
    pending_state: null,
    previous_behavior_statement: null,
    previous_commitment_id: null,
    active_commitment_id: args.commitment.id,
    pending_cleared: true,
    temporary_expires_at: args.expiresAt,
    temporary_last_included_local_date: args.lastIncludedLocalDate,
    ...(args.replacesActiveTemporaryOverlay === true
      ? { replaces_active_temporary_overlay: true }
      : {}),
  };
}

function overlayAlreadyMatchesConfirmedTemp(args: {
  commitment: ActiveV2CommitmentRow;
  candidate: string;
  expiresAt: string;
  nowMs: number;
}): boolean {
  if (!isV2AdaptiveOverlayActive(args.commitment, args.nowMs)) return false;
  if (normalizeBarKey(args.commitment.adaptive_ask_text ?? "") !== normalizeBarKey(args.candidate)) {
    return false;
  }
  return overlayExpiryMatches(args.commitment.adaptive_ask_expires_at, args.expiresAt);
}

function replacementAlreadyMatchesConfirmed(args: {
  expectedCommitmentId: string;
  commitment: ActiveV2CommitmentRow;
  candidate: string;
  expiresAt: string;
  canonicalSnapshot: string;
  nowMs: number;
}): boolean {
  if (args.commitment.id !== args.expectedCommitmentId) return false;
  if (args.commitment.status !== "active") return false;
  if ((args.commitment.behavior_statement ?? "").trim() !== args.canonicalSnapshot.trim()) {
    return false;
  }
  if (
    !overlayAlreadyMatchesConfirmedTemp({
      commitment: args.commitment,
      candidate: args.candidate,
      expiresAt: args.expiresAt,
      nowMs: args.nowMs,
    })
  ) {
    return false;
  }
  return (
    normalizeBarKey(getEffectiveCoachingAsk(args.commitment, args.nowMs)) ===
    normalizeBarKey(args.candidate)
  );
}

function conflictingActiveOverlay(args: {
  commitment: ActiveV2CommitmentRow;
  candidate: string;
  expiresAt: string;
  nowMs: number;
}): boolean {
  if (!isV2AdaptiveOverlayActive(args.commitment, args.nowMs)) return false;
  return !overlayAlreadyMatchesConfirmedTemp(args);
}

function preApplyTempOverlayReady(args: {
  commitment: ActiveV2CommitmentRow;
  payload: V2SmsPendingResolutionPayload;
  nowMs: number;
  inboundSid: string;
}): { ok: true; candidate: string; expiresAt: string } | { ok: false; reason: string } {
  if (args.commitment.status !== "active") return { ok: false, reason: "commitment_not_active" };
  if (!isSolOwnedTemporaryAwaitingConfirmationPending(args.commitment)) {
    return { ok: false, reason: "pending_not_temp_awaiting_confirmation" };
  }
  const candidate = tempCandidate(args.payload);
  if (!candidate) return { ok: false, reason: "candidate_missing" };
  const expiresAt = args.payload.temporary_expires_at?.trim() || "";
  if (!expiresAt) return { ok: false, reason: "expiry_missing" };
  if (!isTemporaryExpiryStillConfirmable(expiresAt, args.nowMs)) {
    return { ok: false, reason: "expiry_not_future" };
  }
  const liveCanonical = (args.commitment.behavior_statement ?? "").trim();
  const snapshot = (args.payload.canonical_behavior_snapshot ?? "").trim();
  if (!snapshot || snapshot !== liveCanonical) {
    return { ok: false, reason: "canonical_snapshot_mismatch" };
  }
  if (!canPromoteSolTemporaryConfirmation({
    candidate,
    expiresAt,
    canonicalSnapshot: snapshot,
    liveCanonical,
    nowMs: args.nowMs,
  })) {
    return { ok: false, reason: "not_promotable" };
  }
  if (isReplacementPending(args.payload)) {
    return { ok: true, candidate, expiresAt };
  }
  if (conflictingActiveOverlay({
    commitment: args.commitment,
    candidate,
    expiresAt,
    nowMs: args.nowMs,
  })) {
    return { ok: false, reason: "active_overlay_conflict" };
  }
  if (!args.inboundSid.trim()) return { ok: false, reason: "inbound_sid_missing" };
  return { ok: true, candidate, expiresAt };
}

async function clearPendingKeepCurrent(args: {
  commitment: ActiveV2CommitmentRow;
  reasonCode: string;
}): Promise<ActiveV2CommitmentRow> {
  await clearPendingResolution(args.commitment.id, {
    expectedUpdatedAt: args.commitment.updated_at,
  });
  await recomputeV2CoachingMemory(args.commitment.id, { reasonCode: args.reasonCode });
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

async function restageTemporaryPending(args: {
  commitment: ActiveV2CommitmentRow;
  nextCandidate: string | null;
  frozen: ReturnType<typeof frozenDurationFromExistingPayload>;
  inboundRaw: string;
  messageSid: string;
  nowMs: number;
}): Promise<ActiveV2CommitmentRow> {
  const liveCanonical = (args.commitment.behavior_statement ?? "").trim();
  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: args.commitment.id,
    merge: (prev) =>
      applySolTemporaryHallwayMerge({
        prev,
        nextCandidate: args.nextCandidate,
        frozen: args.frozen,
        inboundRaw: args.inboundRaw.slice(0, RAW_LOG_MAX),
        messageSid: args.messageSid,
        liveCanonical,
        nowMs: args.nowMs,
      }),
  });
  if (merged.ok) {
    await recomputeV2CoachingMemory(args.commitment.id, {
      reasonCode: "sol_temporary_overlay_confirm_restage",
    });
  }
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

async function convertTempPendingToSavedReplace(args: {
  commitment: ActiveV2CommitmentRow;
  candidate: string;
  inboundRaw: string;
  messageSid: string;
}): Promise<ActiveV2CommitmentRow> {
  const payload: V2SmsPendingResolutionPayload = {
    source: "sms_inbound",
    sms_state: "awaiting_confirmation",
    detected_intent: "sms_replace_request",
    raw_user_text: args.inboundRaw.slice(0, RAW_LOG_MAX),
    inbound_message_sid: args.messageSid,
    ai_confidence: null,
    candidate_behavior_statement: args.candidate,
    candidate_new_bar: args.candidate,
    candidate_tightened_bar: null,
    confirmation_prompt_sent_at: new Date().toISOString(),
  };
  await setPendingResolution({
    commitmentId: args.commitment.id,
    kind: "commitment_replace",
    payload,
    expectedUpdatedAt: args.commitment.updated_at,
  });
  await recomputeV2CoachingMemory(args.commitment.id, {
    reasonCode: "sol_temporary_overlay_convert_saved_replace",
  });
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

export async function runSolTemporaryOverlayConfirmForInbound(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  inboundRaw: string;
  messageSid: string;
  timezone?: string | null;
  /** Semantic/turn time (inbound created_at). Not mutation authorization. */
  now?: Date;
  /** Wall-clock for apply/proof. Defaults to Date.now. Tests inject a sequence. */
  mutationClock?: () => number;
  recentExactThread?: SolGoalChangeSemanticThreadMessage[] | null;
  client?: OpenAI | null;
}): Promise<SolTemporaryConfirmResult> {
  const inbound = args.inboundRaw.trim();
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const mutationClock = args.mutationClock ?? Date.now;
  const liveStart = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;

  if (!isSolOwnedTemporaryOverlayPending(liveStart)) {
    return {
      handled: false,
      commitment: liveStart,
      authorization: neitherAuth(liveStart),
      consequence: "not_applicable",
      forensics: emptyForensics(),
    };
  }

  const handledBase = { handled: true as const };

  if (!isSolOwnedTemporaryAwaitingConfirmationPending(liveStart)) {
    return {
      ...handledBase,
      commitment: liveStart,
      authorization: pendingAuthFromLive(liveStart, nowMs),
      consequence: "ambiguous",
      forensics: emptyForensics({ reload_fail_reason: "not_awaiting_confirmation" }),
    };
  }

  const startPayload = smsTempPayload(liveStart);
  if (!startPayload) {
    return {
      ...handledBase,
      commitment: liveStart,
      authorization: neitherAuth(liveStart),
      consequence: "ambiguous",
      forensics: emptyForensics({ reload_fail_reason: "payload_missing" }),
    };
  }

  const startPromote = canPromoteSolTemporaryConfirmation({
    candidate: tempCandidate(startPayload),
    expiresAt: startPayload.temporary_expires_at,
    canonicalSnapshot: startPayload.canonical_behavior_snapshot,
    liveCanonical: (liveStart.behavior_statement ?? "").trim(),
    nowMs,
  });
  if (!startPromote) {
    const held = await runSolTemporaryOverlayHoldingForInbound({
      commitment: liveStart,
      nowMs,
    });
    return {
      ...handledBase,
      commitment: held.commitment,
      authorization: held.authorization,
      consequence: "ambiguous",
      forensics: emptyForensics({
        reload_proved: false,
        reload_fail_reason: "not_promotable_demoted_or_stayed",
      }),
    };
  }

  const semanticInput = buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: liveStart.behavior_statement ?? "",
    effectiveCoachingAsk: getEffectiveCoachingAsk(liveStart, nowMs),
    authoritativePending: pendingSnapshotFromCommitment(liveStart),
    latestInboundText: inbound,
    recentExactThread: args.recentExactThread,
    plannedInterruptionKnown: false,
    timezone: args.timezone,
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

  const resolved = resolveSolTemporaryConfirmMeaning({
    inboundRaw: inbound,
    semantic,
    interpreterOk,
    payload: startPayload,
    liveCanonical: (liveStart.behavior_statement ?? "").trim(),
  });

  const baseForensics = emptyForensics({
    interpreter_ok: interpreterOk,
    interpreter_error: interpreterError,
    semantic_confirms: semantic?.goal_change.confirms_existing_pending ?? null,
    semantic_rejects: semantic?.goal_change.rejects_existing_pending ?? null,
    semantic_modifies: semantic?.goal_change.modifies_existing_pending_candidate ?? null,
    semantic_intent: semantic?.goal_change.intent ?? null,
    qualification_veto: resolved.qualificationVeto,
    deterministic_yes_fallback: resolved.deterministicYesFallback,
    meaning: resolved.meaning,
  });

  if (resolved.meaning === "reject") {
    try {
      const cleared = await clearPendingKeepCurrent({
        commitment: liveStart,
        reasonCode: "sol_temporary_overlay_rejected",
      });
      const provedCleared = !isSmsInboundPendingResolutionActionable(cleared);
      return {
        ...handledBase,
        commitment: cleared,
        authorization: {
          ...neitherAuth(cleared),
          pending_cleared: provedCleared,
          temporary_candidate_behavior_statement: tempCandidate(startPayload),
        },
        consequence: provedCleared ? "rejected" : "reload_mismatch",
        forensics: {
          ...baseForensics,
          pending_cleared: provedCleared,
          reload_proved: provedCleared,
          reload_fail_reason: provedCleared ? null : "reject_pending_still_active",
        },
      };
    } catch {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, nowMs),
        consequence: "ambiguous",
        forensics: baseForensics,
      };
    }
  }

  if (resolved.meaning === "permanent_instead") {
    let candidate = tempCandidate(startPayload);
    if (semantic?.goal_change.candidate_behavior_statement?.trim()) {
      const normalized = normalizeSemanticTemporaryCandidate({
        semanticCandidate: semantic.goal_change.candidate_behavior_statement,
        canonicalBehaviorStatement: liveStart.behavior_statement ?? "",
      });
      if (normalized.ok) candidate = normalized.candidate;
    }
    if (!candidate) {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, nowMs),
        consequence: "permanent_instead_failed",
        forensics: {
          ...baseForensics,
          reload_fail_reason: "permanent_instead_candidate_missing",
        },
      };
    }
    try {
      const converted = await convertTempPendingToSavedReplace({
        commitment: liveStart,
        candidate,
        inboundRaw: inbound,
        messageSid: args.messageSid,
      });
      const auth = confirmationAuthorizationFromReloadedCommitment(converted, candidate);
      if (auth.goal_change_confirmation_authorized !== true) {
        return {
          ...handledBase,
          commitment: converted,
          authorization: pendingAuthFromLive(liveStart, nowMs),
          consequence: "permanent_instead_failed",
          forensics: {
            ...baseForensics,
            reload_proved: false,
            reload_fail_reason: "permanent_instead_reload_not_saved_confirmable",
          },
        };
      }
      return {
        ...handledBase,
        commitment: converted,
        authorization: auth,
        consequence: "permanent_instead",
        forensics: { ...baseForensics, reload_proved: true },
      };
    } catch {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, nowMs),
        consequence: "permanent_instead_failed",
        forensics: {
          ...baseForensics,
          reload_fail_reason: "permanent_instead_write_failed",
        },
      };
    }
  }

  if (resolved.meaning === "modify") {
    if (!interpreterOk || !semantic) {
      return {
        ...handledBase,
        commitment: liveStart,
        authorization: pendingAuthFromLive(liveStart, nowMs),
        consequence: "ambiguous",
        forensics: baseForensics,
      };
    }
    const current = tempCandidate(startPayload);
    let nextCandidate = current;
    if (semantic.goal_change.candidate_behavior_statement?.trim()) {
      const normalized = normalizeSemanticTemporaryCandidate({
        semanticCandidate: semantic.goal_change.candidate_behavior_statement,
        canonicalBehaviorStatement: liveStart.behavior_statement ?? "",
      });
      if (normalized.ok) nextCandidate = normalized.candidate;
    }
    const durationChanged = durationFieldsDifferFromPayload(semantic, startPayload);
    let frozen = frozenDurationFromExistingPayload(startPayload, nowMs);
    if (durationChanged) {
      const freezeResult = freezeTemporaryDurationFromSemantic({
        semantic,
        timezone: args.timezone ?? null,
        now,
      });
      if (freezeResult.resolver_threw) {
        return {
          ...handledBase,
          commitment: liveStart,
          authorization: pendingAuthFromLive(liveStart, nowMs),
          consequence: "ambiguous",
          forensics: {
            ...baseForensics,
            reload_fail_reason: "temporary_duration_resolver_threw",
          },
        };
      }
      frozen = freezeResult.frozen;
    } else {
      frozen = resolveSolTemporaryHallwayFrozenDuration({
        prev: startPayload,
        semantic,
        timezone: args.timezone ?? null,
        now,
      }).frozen;
    }
    const restaged = await restageTemporaryPending({
      commitment: liveStart,
      nextCandidate,
      frozen,
      inboundRaw: inbound,
      messageSid: args.messageSid,
      nowMs,
    });
    return {
      ...handledBase,
      commitment: restaged,
      authorization: pendingAuthFromLive(restaged, nowMs, nextCandidate),
      consequence: "modified",
      forensics: baseForensics,
    };
  }

  if (resolved.meaning !== "confirm") {
    return {
      ...handledBase,
      commitment: liveStart,
      authorization: pendingAuthFromLive(liveStart, nowMs),
      consequence: "ambiguous",
      forensics: baseForensics,
    };
  }

  return applyConfirmedTemporaryOverlay({
    clerkUserId: args.clerkUserId,
    liveStart,
    startPayload,
    inboundSid: args.messageSid,
    mutationClock,
    baseForensics,
  });
}

async function applyConfirmedTemporaryOverlayReplacement(args: {
  clerkUserId: string;
  liveStart: ActiveV2CommitmentRow;
  startPayload: V2SmsPendingResolutionPayload;
  inboundSid: string;
  mutationClock: () => number;
  baseForensics: SolTemporaryConfirmForensics;
}): Promise<SolTemporaryConfirmResult> {
  const handledBase = { handled: true as const };
  const mutationClock = args.mutationClock;
  const liveBefore = (await getActiveCommitment(args.clerkUserId)) ?? args.liveStart;
  const payload = smsTempPayload(liveBefore) ?? args.startPayload;
  const lastIncluded = payload.temporary_last_included_local_date ?? null;
  const mutationNowMs = mutationClock();

  const ready = preApplyTempOverlayReady({
    commitment: liveBefore,
    payload,
    nowMs: mutationNowMs,
    inboundSid: args.inboundSid,
  });
  if (!ready.ok) {
    if (ready.reason === "expiry_not_future" || ready.reason === "canonical_snapshot_mismatch") {
      try {
        const cleared = await clearPendingKeepCurrent({
          commitment: liveBefore,
          reasonCode: "sol_temporary_overlay_replace_fail_closed",
        });
        return {
          ...handledBase,
          commitment: cleared,
          authorization: neitherAuth(cleared),
          consequence: "ambiguous",
          forensics: {
            ...args.baseForensics,
            reload_proved: false,
            reload_fail_reason: ready.reason,
            pending_cleared: !isSmsInboundPendingResolutionActionable(cleared),
          },
        };
      } catch {
        return {
          ...handledBase,
          commitment: liveBefore,
          authorization: pendingAuthFromLive(liveBefore, mutationNowMs),
          consequence: "ambiguous",
          forensics: {
            ...args.baseForensics,
            reload_fail_reason: ready.reason,
          },
        };
      }
    }
    return {
      ...handledBase,
      commitment: liveBefore,
      authorization: pendingAuthFromLive(liveBefore, mutationNowMs),
      consequence: "ambiguous",
      forensics: {
        ...args.baseForensics,
        reload_proved: false,
        reload_fail_reason: ready.reason,
      },
    };
  }

  const { candidate, expiresAt } = ready;
  const snapshot = (payload.canonical_behavior_snapshot ?? liveBefore.behavior_statement ?? "").trim();
  const expectedOverlayText = (payload.replaced_overlay_behavior_statement ?? "").trim();
  const expectedOverlayExpiresAt = (payload.replaced_overlay_expires_at ?? "").trim();
  if (
    replacementAlreadyMatchesConfirmed({
      expectedCommitmentId: args.liveStart.id,
      commitment: liveBefore,
      candidate,
      expiresAt,
      canonicalSnapshot: snapshot,
      nowMs: mutationNowMs,
    })
  ) {
    return finishProvenOverlay({
      clerkUserId: args.clerkUserId,
      before: liveBefore,
      candidate,
      expiresAt,
      lastIncluded,
      snapshot,
      mutationClock,
      baseForensics: {
        ...args.baseForensics,
        mutation_attempted: false,
        rpc_ok: true,
        rpc_code: "already_applied_state",
        overlay_expires_at_passed: expiresAt,
      },
      skipRpc: true,
      replacesActiveTemporaryOverlay: true,
    });
  }

  const snapshotMatch = liveOverlayMatchesReplacementSnapshot({
    commitment: liveBefore,
    expectedCanonical: snapshot,
    expectedOverlayText,
    expectedOverlayExpiresAt,
    nowMs: mutationNowMs,
  });
  if (!snapshotMatch.ok) {
    try {
      const cleared = await clearPendingKeepCurrent({
        commitment: liveBefore,
        reasonCode: "sol_temporary_overlay_replace_fail_closed",
      });
      return {
        ...handledBase,
        commitment: cleared,
        authorization: neitherAuth(cleared),
        consequence: "ambiguous",
        forensics: {
          ...args.baseForensics,
          reload_proved: false,
          reload_fail_reason: snapshotMatch.reason,
          pending_cleared: !isSmsInboundPendingResolutionActionable(cleared),
        },
      };
    } catch {
      return {
        ...handledBase,
        commitment: liveBefore,
        authorization: pendingAuthFromLive(liveBefore, mutationNowMs),
        consequence: "ambiguous",
        forensics: {
          ...args.baseForensics,
          reload_fail_reason: snapshotMatch.reason,
        },
      };
    }
  }

  const replaced = await replaceActiveTemporaryOverlay({
    commitmentId: liveBefore.id,
    expectedUpdatedAt: liveBefore.updated_at,
    expectedCanonical: snapshot,
    expectedOverlayText,
    expectedOverlayExpiresAt,
    nextOverlayText: candidate,
    nextOverlayExpiresAt: expiresAt,
    nowMs: mutationNowMs,
  });
  if (!replaced.ok) {
    const afterFail = (await getActiveCommitment(args.clerkUserId)) ?? liveBefore;
    if (
      replacementAlreadyMatchesConfirmed({
        expectedCommitmentId: args.liveStart.id,
        commitment: afterFail,
        candidate,
        expiresAt,
        canonicalSnapshot: snapshot,
        nowMs: mutationNowMs,
      })
    ) {
      return finishProvenOverlay({
        clerkUserId: args.clerkUserId,
        before: liveBefore,
        candidate,
        expiresAt,
        lastIncluded,
        snapshot,
        mutationClock,
        baseForensics: {
          ...args.baseForensics,
          mutation_attempted: true,
          rpc_ok: true,
          rpc_code: "already_applied_state",
          overlay_expires_at_passed: expiresAt,
        },
        skipRpc: true,
        replacesActiveTemporaryOverlay: true,
      });
    }
    return {
      ...handledBase,
      commitment: afterFail,
      authorization: pendingAuthFromLive(afterFail, mutationNowMs),
      consequence: "rpc_failed",
      forensics: {
        ...args.baseForensics,
        mutation_attempted: true,
        rpc_ok: false,
        rpc_code: replaced.error,
        overlay_expires_at_passed: expiresAt,
      },
    };
  }

  return finishProvenOverlay({
    clerkUserId: args.clerkUserId,
    before: liveBefore,
    candidate,
    expiresAt,
    lastIncluded,
    snapshot,
    mutationClock,
    baseForensics: {
      ...args.baseForensics,
      mutation_attempted: true,
      rpc_ok: true,
      rpc_code: "replaced",
      overlay_expires_at_passed: expiresAt,
    },
    skipRpc: true,
    replacesActiveTemporaryOverlay: true,
  });
}

async function applyConfirmedTemporaryOverlay(args: {
  clerkUserId: string;
  liveStart: ActiveV2CommitmentRow;
  startPayload: V2SmsPendingResolutionPayload;
  inboundSid: string;
  mutationClock: () => number;
  baseForensics: SolTemporaryConfirmForensics;
}): Promise<SolTemporaryConfirmResult> {
  if (isReplacementPending(args.startPayload)) {
    return applyConfirmedTemporaryOverlayReplacement(args);
  }

  const handledBase = { handled: true as const };
  const mutationClock = args.mutationClock;
  await clearStaleAdaptiveContractColumns(args.liveStart.id);
  const liveBefore = (await getActiveCommitment(args.clerkUserId)) ?? args.liveStart;
  const payload = smsTempPayload(liveBefore) ?? args.startPayload;
  const lastIncluded = payload.temporary_last_included_local_date ?? null;
  const mutationNowMs = mutationClock();

  const ready = preApplyTempOverlayReady({
    commitment: liveBefore,
    payload,
    nowMs: mutationNowMs,
    inboundSid: args.inboundSid,
  });
  if (!ready.ok) {
    if (ready.reason === "active_overlay_conflict") {
      try {
        const cleared = await clearPendingKeepCurrent({
          commitment: liveBefore,
          reasonCode: "sol_temporary_overlay_conflict_cleared",
        });
        return {
          ...handledBase,
          commitment: cleared,
          authorization: neitherAuth(cleared),
          consequence: "overlay_conflict",
          forensics: {
            ...args.baseForensics,
            reload_proved: false,
            reload_fail_reason: "active_overlay_conflict",
            pending_cleared: !isSmsInboundPendingResolutionActionable(cleared),
          },
        };
      } catch {
        return {
          ...handledBase,
          commitment: liveBefore,
          authorization: pendingAuthFromLive(liveBefore, mutationNowMs),
          consequence: "overlay_conflict",
          forensics: {
            ...args.baseForensics,
            reload_fail_reason: "active_overlay_conflict",
          },
        };
      }
    }
    if (ready.reason === "expiry_not_future" || ready.reason === "canonical_snapshot_mismatch") {
      const held = await runSolTemporaryOverlayHoldingForInbound({
        commitment: liveBefore,
        nowMs: mutationNowMs,
      });
      return {
        ...handledBase,
        commitment: held.commitment,
        authorization: held.authorization,
        consequence: "ambiguous",
        forensics: {
          ...args.baseForensics,
          reload_proved: false,
          reload_fail_reason: ready.reason,
        },
      };
    }
    return {
      ...handledBase,
      commitment: liveBefore,
      authorization: pendingAuthFromLive(liveBefore, mutationNowMs),
      consequence: "ambiguous",
      forensics: {
        ...args.baseForensics,
        reload_proved: false,
        reload_fail_reason: ready.reason,
      },
    };
  }

  const { candidate, expiresAt } = ready;
  const snapshot = (payload.canonical_behavior_snapshot ?? liveBefore.behavior_statement ?? "").trim();

  if (overlayAlreadyMatchesConfirmedTemp({
    commitment: liveBefore,
    candidate,
    expiresAt,
    nowMs: mutationNowMs,
  })) {
    return finishProvenOverlay({
      clerkUserId: args.clerkUserId,
      before: liveBefore,
      candidate,
      expiresAt,
      lastIncluded,
      snapshot,
      mutationClock,
      baseForensics: {
        ...args.baseForensics,
        mutation_attempted: false,
        rpc_ok: true,
        rpc_code: "already_applied_state",
        overlay_expires_at_passed: expiresAt,
      },
      skipRpc: true,
    });
  }

  const proposalAlready =
    normalizeBarKey(liveBefore.adaptive_proposal_text ?? "") === normalizeBarKey(candidate);
  if (!proposalAlready) {
    const dayKey = getDateKeyInTimezone(new Date(mutationNowMs), "UTC");
    const persisted = await persistContractOverlayProposed({
      commitmentId: liveBefore.id,
      clerkUserId: args.clerkUserId,
      proposalText: candidate,
      dayKey,
      messageSid: args.inboundSid,
      contractKind: SOL_TEMPORARY_OVERLAY_CONTRACT_KIND,
      idempotencySuffix: `sol_temp_overlay:${args.inboundSid}`,
      expectedUpdatedAt: liveBefore.updated_at,
      requireFreshProposalSlot: true,
      skipEventWrite: false,
    });
    if (!persisted.ok) {
      const afterFail = (await getActiveCommitment(args.clerkUserId)) ?? liveBefore;
      if (
        overlayAlreadyMatchesConfirmedTemp({
          commitment: afterFail,
          candidate,
          expiresAt,
          nowMs: mutationNowMs,
        })
      ) {
        return finishProvenOverlay({
          clerkUserId: args.clerkUserId,
          before: liveBefore,
          candidate,
          expiresAt,
          lastIncluded,
          snapshot,
          mutationClock,
          baseForensics: {
            ...args.baseForensics,
            mutation_attempted: true,
            rpc_ok: true,
            rpc_code: "already_applied_state",
            overlay_expires_at_passed: expiresAt,
          },
          skipRpc: true,
        });
      }
      if (normalizeBarKey(afterFail.adaptive_proposal_text ?? "") !== normalizeBarKey(candidate)) {
        return {
          ...handledBase,
          commitment: afterFail,
          authorization: pendingAuthFromLive(afterFail, mutationNowMs),
          consequence: "rpc_failed",
          forensics: {
            ...args.baseForensics,
            mutation_attempted: true,
            rpc_ok: false,
            rpc_code: persisted.error,
          },
        };
      }
    }
  }

  const afterProposal = (await getActiveCommitment(args.clerkUserId)) ?? liveBefore;
  const preRpcNowMs = mutationClock();
  if (!isTemporaryExpiryStillConfirmable(expiresAt, preRpcNowMs)) {
    const held = await runSolTemporaryOverlayHoldingForInbound({
      commitment: afterProposal,
      nowMs: preRpcNowMs,
    });
    return {
      ...handledBase,
      commitment: held.commitment,
      authorization: held.authorization,
      consequence: "ambiguous",
      forensics: {
        ...args.baseForensics,
        mutation_attempted: true,
        reload_fail_reason: "expiry_race_before_rpc",
      },
    };
  }

  const act = await activateAdaptiveOverlayFromProposal({
    commitmentId: afterProposal.id,
    clerkUserId: args.clerkUserId,
    proposalText: candidate,
    inboundMessageSid: args.inboundSid,
    contractKind: SOL_TEMPORARY_OVERLAY_CONTRACT_KIND,
    expectedProposalExpiresAt: afterProposal.adaptive_proposal_expires_at,
    expectedUpdatedAt: afterProposal.updated_at,
    overlayExpiresAt: expiresAt,
  });

  const rpcOk = act.ok || act.result === "already_applied";
  if (!rpcOk) {
    return {
      ...handledBase,
      commitment: afterProposal,
      authorization: pendingAuthFromLive(afterProposal, preRpcNowMs),
      consequence: "rpc_failed",
      forensics: {
        ...args.baseForensics,
        mutation_attempted: true,
        rpc_ok: false,
        rpc_code: act.error ?? "activate_failed",
        overlay_expires_at_passed: expiresAt,
      },
    };
  }

  return finishProvenOverlay({
    clerkUserId: args.clerkUserId,
    before: liveBefore,
    candidate,
    expiresAt,
    lastIncluded,
    snapshot,
    mutationClock,
    baseForensics: {
      ...args.baseForensics,
      mutation_attempted: true,
      rpc_ok: true,
      rpc_code: act.result ?? "applied",
      overlay_expires_at_passed: expiresAt,
    },
    skipRpc: false,
  });
}

async function finishProvenOverlay(args: {
  clerkUserId: string;
  before: ActiveV2CommitmentRow;
  candidate: string;
  expiresAt: string;
  lastIncluded: string | null;
  snapshot: string;
  mutationClock: () => number;
  baseForensics: SolTemporaryConfirmForensics;
  skipRpc: boolean;
  replacesActiveTemporaryOverlay?: boolean;
}): Promise<SolTemporaryConfirmResult> {
  const handledBase = { handled: true as const };
  let live = (await getActiveCommitment(args.clerkUserId)) ?? args.before;
  if (isSmsInboundPendingResolutionActionable(live)) {
    try {
      live = await clearPendingKeepCurrent({
        commitment: live,
        reasonCode: "sol_temporary_overlay_applied_clear",
      });
    } catch {
      return {
        ...handledBase,
        commitment: live,
        authorization: neitherAuth(live),
        consequence: "reload_mismatch",
        forensics: {
          ...args.baseForensics,
          reload_proved: false,
          reload_fail_reason: "pending_clear_threw",
          pending_cleared: false,
        },
      };
    }
  }

  const proofNowMs = args.mutationClock();
  const proved = proveTemporaryOverlayApply({
    before: args.before,
    after: live,
    expectedCandidate: args.candidate,
    expectedExpiresAt: args.expiresAt,
    canonicalSnapshot: args.snapshot,
    nowMs: proofNowMs,
  });
  const pendingCleared = !isSmsInboundPendingResolutionActionable(live);
  if (!proved.ok || !pendingCleared) {
    return {
      ...handledBase,
      commitment: live,
      authorization: neitherAuth(live),
      consequence: "reload_mismatch",
      forensics: {
        ...args.baseForensics,
        reload_proved: false,
        reload_fail_reason: proved.ok ? "pending_not_cleared" : proved.reason,
        pending_cleared: pendingCleared,
      },
    };
  }

  try {
    await refreshUnsentTtoDraftsAfterRelationshipChange({
      clerkUserId: args.clerkUserId,
    });
  } catch (error) {
    console.warn("[sol-goal-change-tto-draft-refresh] after_overlay_apply", error);
  }

  return {
    ...handledBase,
    commitment: live,
    authorization: buildTemporaryAppliedAuthorization({
      commitment: live,
      candidate: args.candidate,
      expiresAt: args.expiresAt,
      lastIncludedLocalDate: args.lastIncluded,
      replacesActiveTemporaryOverlay: args.replacesActiveTemporaryOverlay === true,
    }),
    consequence: "applied",
    forensics: {
      ...args.baseForensics,
      reload_proved: true,
      pending_cleared: true,
    },
  };
}
