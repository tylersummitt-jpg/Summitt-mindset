/**
 * Slice 7B — Sol-owned temporary overlay pending-open helpers.
 *
 * Sol owns English. This module switches only on structured duration enums and
 * authoritative pending/overlay state. It does not apply overlay or mutate
 * canonical Current Goal.
 *
 * Temporal binding: freeze structured duration + exact expiry (when supported)
 * at pending-open. Later candidate turns must not recompute "this week".
 */

import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { isV2AdaptiveOverlayActive } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  mergeSmsPendingResolutionPayload,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { isUnsafeSmsGoalCandidateText } from "@/lib/sms-inbound-safety";
import { isVagueOrInvalidCandidateBar } from "@/lib/v2-sms-pending-resolution-complete";
import {
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-clock-substitute";
import {
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeAuthoritativeActiveOverlay } from "@/lib/sol-goal-change-semantic";
import {
  resolveTemporaryOverlayExpiry,
  type TemporaryOverlayExpiryResult,
} from "@/lib/sol-goal-change-temporary-duration";

export const SOL_TEMPORARY_OVERLAY_PENDING_MARKER = true as const;
export const SOL_TEMPORARY_OVERLAY_REPLACEMENT_MARKER = true as const;

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export type SolTemporaryPendingMode =
  | "awaiting_confirmation"
  | "awaiting_candidate"
  | "duration_clarification";

export type SolTemporaryFrozenDuration = {
  temporary_duration_kind: string | null;
  temporary_duration_days: number | null;
  temporary_weekday: string | null;
  temporary_end_local_date: string | null;
  temporary_expires_at: string | null;
  temporary_last_included_local_date: string | null;
  temporary_interpreted_local_date: string;
  temporary_interpreted_at: string;
  duration_supported: boolean;
  duration_clarification_required: boolean;
};

export function isSolOwnedTemporaryOverlayPending(
  commitment: ActiveV2CommitmentRow
): boolean {
  if (!isSmsInboundPendingResolutionActionable(commitment)) return false;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending?.payload || pending.payload.source !== "sms_inbound") return false;
  if (pending.kind !== "commitment_tighten") return false;
  return pending.payload.sol_temporary_overlay === true;
}

export function isSolOwnedTemporaryAwaitingCandidatePending(
  commitment: ActiveV2CommitmentRow
): boolean {
  if (!isSolOwnedTemporaryOverlayPending(commitment)) return false;
  const pending = getPendingResolutionOrNull(commitment);
  const st = pending?.payload && pending.payload.source === "sms_inbound"
    ? pending.payload.sms_state ?? "awaiting_candidate"
    : null;
  return st === "awaiting_candidate";
}

export function isSolOwnedTemporaryAwaitingConfirmationPending(
  commitment: ActiveV2CommitmentRow
): boolean {
  if (!isSolOwnedTemporaryOverlayPending(commitment)) return false;
  const pending = getPendingResolutionOrNull(commitment);
  const st = pending?.payload && pending.payload.source === "sms_inbound"
    ? pending.payload.sms_state ?? "awaiting_candidate"
    : null;
  return st === "awaiting_confirmation";
}

export function shouldAttemptSolTemporaryPendingOpen(
  result: SolGoalChangeSemanticResult
): boolean {
  const g = result.goal_change;
  if (g.intent !== "temporary_adjustment") return false;
  if (g.confirms_existing_pending) return false;
  if (g.rejects_existing_pending) return false;
  if (g.modifies_existing_pending_candidate) return false;
  return true;
}

export function normalizeSemanticTemporaryCandidate(args: {
  semanticCandidate: string | null;
  canonicalBehaviorStatement: string;
}): { ok: true; candidate: string } | { ok: false; reason: "missing" | "unsafe" | "vague" } {
  const semantic = (args.semanticCandidate ?? "").trim().replace(/\s+/g, " ");
  if (!semantic) return { ok: false, reason: "missing" };
  let candidate = semantic;
  const substituted = trySubstituteClockFragmentIntoCanonical(
    args.canonicalBehaviorStatement.trim(),
    semantic
  );
  if (substituted?.trim()) {
    candidate = substituted.trim().replace(/\s+/g, " ");
  }
  if (isUnsafeSmsGoalCandidateText(candidate)) return { ok: false, reason: "unsafe" };
  if (isVagueOrInvalidCandidateBar(candidate) && !/\d/.test(candidate)) {
    return { ok: false, reason: "vague" };
  }
  return { ok: true, candidate };
}

export type FreezeTemporaryDurationResult = {
  frozen: SolTemporaryFrozenDuration;
  resolver_threw: boolean;
};

export function freezeTemporaryDurationFromSemantic(args: {
  semantic: SolGoalChangeSemanticResult;
  timezone: string | null;
  now: Date;
}): FreezeTemporaryDurationResult {
  const g = args.semantic.goal_change;
  const interpretedAt = args.now.toISOString();
  const interpretedLocalDate = getDateKeyInTimezone(
    args.now,
    resolveUserTimezone(args.timezone)
  );
  const base: SolTemporaryFrozenDuration = {
    temporary_duration_kind: g.temporary_duration_kind,
    temporary_duration_days: g.temporary_duration_days,
    temporary_weekday: g.temporary_weekday,
    temporary_end_local_date: g.temporary_end_local_date,
    temporary_expires_at: null,
    temporary_last_included_local_date: null,
    temporary_interpreted_local_date: interpretedLocalDate,
    temporary_interpreted_at: interpretedAt,
    duration_supported: false,
    duration_clarification_required: true,
  };

  let resolved: TemporaryOverlayExpiryResult;
  try {
    resolved = resolveTemporaryOverlayExpiry({
      temporary_duration_kind: g.temporary_duration_kind,
      temporary_duration_days: g.temporary_duration_days,
      temporary_weekday: g.temporary_weekday,
      temporary_end_local_date: g.temporary_end_local_date,
      timezone: args.timezone,
      now: args.now,
    });
  } catch {
    return { frozen: base, resolver_threw: true };
  }

  if (!resolved.supported || resolved.clarification_required || !resolved.expires_at_utc) {
    return {
      frozen: {
        ...base,
        duration_clarification_required: true,
        duration_supported: false,
      },
      resolver_threw: false,
    };
  }

  return {
    frozen: {
      ...base,
      temporary_expires_at: resolved.expires_at_utc,
      temporary_last_included_local_date: resolved.last_included_local_date,
      duration_supported: true,
      duration_clarification_required: false,
    },
    resolver_threw: false,
  };
}

export function isTemporaryExpiryStillConfirmable(
  expiresAt: string | null | undefined,
  nowMs: number
): boolean {
  const raw = expiresAt?.trim() ?? "";
  if (!raw) return false;
  const expMs = Date.parse(raw);
  return Number.isFinite(expMs) && expMs > nowMs;
}

export function canPromoteSolTemporaryConfirmation(args: {
  candidate: string | null | undefined;
  expiresAt: string | null | undefined;
  canonicalSnapshot: string | null | undefined;
  liveCanonical: string;
  nowMs: number;
}): boolean {
  if (!args.candidate?.trim()) return false;
  const live = args.liveCanonical.trim();
  if (!live) return false;
  const snap = (args.canonicalSnapshot ?? "").trim();
  if (!snap || snap !== live) return false;
  return isTemporaryExpiryStillConfirmable(args.expiresAt, args.nowMs);
}

export function semanticSuppliesTemporaryDuration(
  semantic: SolGoalChangeSemanticResult
): boolean {
  if (semantic.goal_change.rejects_existing_pending) return false;
  return semantic.goal_change.temporary_duration_kind !== "unspecified";
}

export type ActiveOverlayReplacementFill =
  | { ok: true; candidate: string; frozen: SolTemporaryFrozenDuration }
  | { ok: false; reason: string };

/**
 * Fill rules for replacing a live overlay. Sol supplies structured candidate
 * and/or duration; omitted fields keep the current overlay values.
 */
export function resolveActiveOverlayReplacementFill(args: {
  semantic: SolGoalChangeSemanticResult;
  overlay: SolGoalChangeAuthoritativeActiveOverlay;
  canonicalBehaviorStatement: string;
  timezone: string | null;
  now: Date;
}): ActiveOverlayReplacementFill {
  const nowMs = args.now.getTime();
  if (args.overlay.active !== true) {
    return { ok: false, reason: "overlay_not_active" };
  }
  const overlayText = args.overlay.overlay_behavior_statement?.trim() || "";
  const overlayExpires = args.overlay.overlay_expires_at?.trim() || "";
  if (!overlayText || !overlayExpires) {
    return { ok: false, reason: "overlay_snapshot_incomplete" };
  }
  if (!isTemporaryExpiryStillConfirmable(overlayExpires, nowMs)) {
    return { ok: false, reason: "overlay_expired_not_live" };
  }

  let candidate: string | null = null;
  if (args.semantic.goal_change.candidate_behavior_statement?.trim()) {
    const normalized = normalizeSemanticTemporaryCandidate({
      semanticCandidate: args.semantic.goal_change.candidate_behavior_statement,
      canonicalBehaviorStatement: args.canonicalBehaviorStatement,
    });
    if (!normalized.ok && normalized.reason === "unsafe") {
      return { ok: false, reason: "unsafe_goal_content" };
    }
    if (normalized.ok) candidate = normalized.candidate;
  }
  if (!candidate) {
    const fromOverlay = normalizeSemanticTemporaryCandidate({
      semanticCandidate: overlayText,
      canonicalBehaviorStatement: args.canonicalBehaviorStatement,
    });
    if (!fromOverlay.ok) {
      return { ok: false, reason: "overlay_candidate_unusable" };
    }
    candidate = fromOverlay.candidate;
  }

  let frozen: SolTemporaryFrozenDuration;
  if (semanticSuppliesTemporaryDuration(args.semantic)) {
    const freezeResult = freezeTemporaryDurationFromSemantic({
      semantic: args.semantic,
      timezone: args.timezone,
      now: args.now,
    });
    if (freezeResult.resolver_threw) {
      return { ok: false, reason: "temporary_duration_resolver_threw" };
    }
    if (
      !freezeResult.frozen.duration_supported ||
      !freezeResult.frozen.temporary_expires_at?.trim()
    ) {
      return { ok: false, reason: "temporary_duration_needs_clarification" };
    }
    frozen = freezeResult.frozen;
  } else {
    const interpretedAt = args.now.toISOString();
    const interpretedLocalDate = getDateKeyInTimezone(
      args.now,
      resolveUserTimezone(args.timezone)
    );
    frozen = {
      temporary_duration_kind: args.semantic.goal_change.temporary_duration_kind,
      temporary_duration_days: args.semantic.goal_change.temporary_duration_days,
      temporary_weekday: args.semantic.goal_change.temporary_weekday,
      temporary_end_local_date: args.semantic.goal_change.temporary_end_local_date,
      temporary_expires_at: overlayExpires,
      temporary_last_included_local_date:
        args.overlay.overlay_last_included_local_date ?? null,
      temporary_interpreted_local_date: interpretedLocalDate,
      temporary_interpreted_at: interpretedAt,
      duration_supported: true,
      duration_clarification_required: false,
    };
  }

  if (!isTemporaryExpiryStillConfirmable(frozen.temporary_expires_at, nowMs)) {
    return { ok: false, reason: "replacement_expiry_not_future" };
  }

  const sameText = normalizeBarKey(candidate) === normalizeBarKey(overlayText);
  const sameExpiry =
    Date.parse(frozen.temporary_expires_at ?? "") === Date.parse(overlayExpires);
  if (sameText && sameExpiry) {
    return { ok: false, reason: "replacement_matches_current_overlay" };
  }

  return { ok: true, candidate, frozen };
}

export type SolTemporaryReplacementSnapshot = {
  replaces_active_temporary_overlay: true;
  replaced_overlay_behavior_statement: string;
  replaced_overlay_expires_at: string;
};

export function classifySolTemporaryPendingMode(args: {
  candidate: string | null;
  frozen: SolTemporaryFrozenDuration;
  nowMs: number;
  liveCanonical: string;
}): SolTemporaryPendingMode {
  if (
    canPromoteSolTemporaryConfirmation({
      candidate: args.candidate,
      expiresAt: args.frozen.temporary_expires_at,
      canonicalSnapshot: args.liveCanonical,
      liveCanonical: args.liveCanonical,
      nowMs: args.nowMs,
    })
  ) {
    return "awaiting_confirmation";
  }
  if (!args.frozen.duration_supported || args.frozen.duration_clarification_required) {
    return "duration_clarification";
  }
  return "awaiting_candidate";
}

export function buildSolTemporaryPendingPayloadMerge(args: {
  prev: V2SmsPendingResolutionPayload;
  mode: SolTemporaryPendingMode;
  candidate: string | null;
  frozen: SolTemporaryFrozenDuration;
  canonicalBehaviorStatement: string;
  inboundRaw: string;
  messageSid: string;
  replacement?: SolTemporaryReplacementSnapshot | null;
}): V2SmsPendingResolutionPayload {
  const smsState =
    args.mode === "awaiting_confirmation" ? "awaiting_confirmation" : "awaiting_candidate";
  const candidate = args.candidate?.trim() || null;
  const replacement = args.replacement ?? null;
  return {
    ...args.prev,
    sol_temporary_overlay: SOL_TEMPORARY_OVERLAY_PENDING_MARKER,
    sms_state: smsState,
    detected_intent: "sms_tighten_request",
    candidate_tightened_bar: candidate,
    candidate_new_bar: args.prev.candidate_new_bar ?? null,
    candidate_behavior_statement: candidate,
    confirmation_prompt_sent_at:
      smsState === "awaiting_confirmation" ? new Date().toISOString() : args.prev.confirmation_prompt_sent_at,
    raw_user_text: args.inboundRaw,
    inbound_message_sid: args.messageSid,
    temporary_duration_kind: args.frozen.temporary_duration_kind,
    temporary_duration_days: args.frozen.temporary_duration_days,
    temporary_weekday: args.frozen.temporary_weekday,
    temporary_end_local_date: args.frozen.temporary_end_local_date,
    temporary_expires_at: args.frozen.temporary_expires_at,
    temporary_last_included_local_date: args.frozen.temporary_last_included_local_date,
    canonical_behavior_snapshot: args.canonicalBehaviorStatement.trim(),
    temporary_interpreted_local_date: args.frozen.temporary_interpreted_local_date,
    temporary_interpreted_at: args.frozen.temporary_interpreted_at,
    ...(replacement
      ? {
          replaces_active_temporary_overlay: SOL_TEMPORARY_OVERLAY_REPLACEMENT_MARKER,
          replaced_overlay_behavior_statement: replacement.replaced_overlay_behavior_statement,
          replaced_overlay_expires_at: replacement.replaced_overlay_expires_at,
        }
      : {}),
  };
}

export function resolveSolTemporaryHallwayFrozenDuration(args: {
  prev: V2SmsPendingResolutionPayload;
  semantic: SolGoalChangeSemanticResult | null;
  timezone: string | null;
  now: Date;
}): FreezeTemporaryDurationResult {
  const nowMs = args.now.getTime();
  const existing = frozenDurationFromExistingPayload(args.prev, nowMs);
  if (isTemporaryExpiryStillConfirmable(existing.temporary_expires_at, nowMs)) {
    return { frozen: existing, resolver_threw: false };
  }
  if (args.semantic && semanticSuppliesTemporaryDuration(args.semantic)) {
    return freezeTemporaryDurationFromSemantic({
      semantic: args.semantic,
      timezone: args.timezone,
      now: args.now,
    });
  }
  return { frozen: existing, resolver_threw: false };
}

export function applySolTemporaryHallwayMerge(args: {
  prev: V2SmsPendingResolutionPayload;
  nextCandidate: string | null;
  frozen: SolTemporaryFrozenDuration;
  inboundRaw: string;
  messageSid: string;
  liveCanonical: string;
  nowMs: number;
}): V2SmsPendingResolutionPayload {
  const candidate =
    args.nextCandidate?.trim() ||
    args.prev.candidate_behavior_statement?.trim() ||
    args.prev.candidate_tightened_bar?.trim() ||
    null;
  const storedSnapshot = (args.prev.canonical_behavior_snapshot ?? "").trim();
  const snapshot = storedSnapshot || args.liveCanonical.trim();
  const promote = canPromoteSolTemporaryConfirmation({
    candidate,
    expiresAt: args.frozen.temporary_expires_at,
    canonicalSnapshot: storedSnapshot || args.liveCanonical.trim(),
    liveCanonical: args.liveCanonical,
    nowMs: args.nowMs,
  });
  const expiryConfirmable = isTemporaryExpiryStillConfirmable(
    args.frozen.temporary_expires_at,
    args.nowMs
  );
  return {
    ...args.prev,
    sol_temporary_overlay: SOL_TEMPORARY_OVERLAY_PENDING_MARKER,
    sms_state: promote ? "awaiting_confirmation" : "awaiting_candidate",
    detected_intent: "sms_tighten_request",
    candidate_tightened_bar: candidate,
    candidate_behavior_statement: candidate,
    raw_user_text: args.inboundRaw.slice(0, 280),
    inbound_message_sid: args.messageSid,
    confirmation_prompt_sent_at: promote
      ? new Date().toISOString()
      : args.prev.confirmation_prompt_sent_at,
    temporary_duration_kind: args.frozen.temporary_duration_kind,
    temporary_duration_days: args.frozen.temporary_duration_days,
    temporary_weekday: args.frozen.temporary_weekday,
    temporary_end_local_date: args.frozen.temporary_end_local_date,
    temporary_expires_at: expiryConfirmable ? args.frozen.temporary_expires_at : null,
    temporary_last_included_local_date: expiryConfirmable
      ? args.frozen.temporary_last_included_local_date
      : null,
    canonical_behavior_snapshot: snapshot,
    temporary_interpreted_local_date: args.frozen.temporary_interpreted_local_date,
    temporary_interpreted_at: args.frozen.temporary_interpreted_at,
    ...(args.prev.replaces_active_temporary_overlay === true
      ? {
          replaces_active_temporary_overlay: SOL_TEMPORARY_OVERLAY_REPLACEMENT_MARKER,
          replaced_overlay_behavior_statement:
            args.prev.replaced_overlay_behavior_statement ?? null,
          replaced_overlay_expires_at: args.prev.replaced_overlay_expires_at ?? null,
        }
      : {}),
  };
}

export function frozenDurationFromExistingPayload(
  payload: V2SmsPendingResolutionPayload,
  nowMs: number
): SolTemporaryFrozenDuration {
  const expiryConfirmable = isTemporaryExpiryStillConfirmable(
    payload.temporary_expires_at,
    nowMs
  );
  return {
    temporary_duration_kind: payload.temporary_duration_kind ?? "unspecified",
    temporary_duration_days: payload.temporary_duration_days ?? null,
    temporary_weekday: payload.temporary_weekday ?? null,
    temporary_end_local_date: payload.temporary_end_local_date ?? null,
    temporary_expires_at: expiryConfirmable ? payload.temporary_expires_at ?? null : null,
    temporary_last_included_local_date: expiryConfirmable
      ? payload.temporary_last_included_local_date ?? null
      : null,
    temporary_interpreted_local_date: payload.temporary_interpreted_local_date ?? "",
    temporary_interpreted_at: payload.temporary_interpreted_at ?? "",
    duration_supported: expiryConfirmable,
    duration_clarification_required: !expiryConfirmable,
  };
}

export async function runSolTemporaryOverlayHoldingForInbound(args: {
  commitment: ActiveV2CommitmentRow;
  nowMs: number;
}): Promise<{
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  demoted: boolean;
}> {
  const live = (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
  const pending = getPendingResolutionOrNull(live);
  const payload =
    pending?.payload && pending.payload.source === "sms_inbound" ? pending.payload : null;
  if (!isSolOwnedTemporaryOverlayPending(live) || !payload) {
    return {
      commitment: live,
      authorization: temporaryConfirmationAuthorizationFromReloadedCommitment(
        live,
        null,
        args.nowMs
      ),
      demoted: false,
    };
  }

  const liveCanonical = (live.behavior_statement ?? "").trim();
  const candidate =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_tightened_bar?.trim() ||
    null;
  const promote = canPromoteSolTemporaryConfirmation({
    candidate,
    expiresAt: payload.temporary_expires_at,
    canonicalSnapshot: payload.canonical_behavior_snapshot,
    liveCanonical,
    nowMs: args.nowMs,
  });
  const smsState = payload.sms_state ?? "awaiting_candidate";
  const needsDemote =
    smsState === "awaiting_confirmation" && !promote;

  if (!needsDemote) {
    return {
      commitment: live,
      authorization: temporaryConfirmationAuthorizationFromReloadedCommitment(
        live,
        null,
        args.nowMs
      ),
      demoted: false,
    };
  }

  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: live.id,
    merge: (prev) =>
      applySolTemporaryHallwayMerge({
        prev,
        nextCandidate: candidate,
        frozen: frozenDurationFromExistingPayload(prev, args.nowMs),
        inboundRaw: prev.raw_user_text,
        messageSid: prev.inbound_message_sid,
        liveCanonical,
        nowMs: args.nowMs,
      }),
  });
  if (merged.ok) {
    await recomputeV2CoachingMemory(live.id, {
      reasonCode: "sol_temporary_overlay_holding_demote",
    });
  }
  const reloaded = (await getActiveCommitment(live.clerk_user_id)) ?? live;
  return {
    commitment: reloaded,
    authorization: temporaryConfirmationAuthorizationFromReloadedCommitment(
      reloaded,
      null,
      args.nowMs
    ),
    demoted: true,
  };
}

export function deterministicTemporaryDurationSummary(args: {
  lastIncludedLocalDate: string | null;
  durationKind: string | null;
  durationDays: number | null;
}): string | null {
  const last = args.lastIncludedLocalDate?.trim() || null;
  if (last) return `through ${last}`;
  if (args.durationKind === "days" && args.durationDays != null) {
    return `for ${args.durationDays} day${args.durationDays === 1 ? "" : "s"}`;
  }
  return null;
}

export function temporaryConfirmationAuthorizationFromReloadedCommitment(
  commitment: ActiveV2CommitmentRow,
  expectedCandidate?: string | null,
  nowMs: number = Date.now()
): SolGoalChangeConfirmationAuthorization {
  const canonical = (commitment.behavior_statement ?? "").trim();
  const none: SolGoalChangeConfirmationAuthorization = {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: canonical,
    active_commitment_id: commitment.id,
    temporary_adjustment_confirmation_authorized: false,
  };
  if (!isSolOwnedTemporaryOverlayPending(commitment)) return none;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending || pending.payload?.source !== "sms_inbound") return none;
  const payload = pending.payload;
  const smsState = payload.sms_state ?? "awaiting_candidate";
  const candidate =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_tightened_bar?.trim() ||
    "";
  const snapshot = (payload.canonical_behavior_snapshot ?? "").trim();
  if (snapshot && snapshot !== canonical) return none;

  if (smsState === "awaiting_candidate") {
    const expiryConfirmable = isTemporaryExpiryStillConfirmable(
      payload.temporary_expires_at,
      nowMs
    );
    return {
      ...none,
      pending_state: "awaiting_candidate",
      candidate_behavior_statement: candidate || null,
      duration_clarification_required:
        !expiryConfirmable || payload.temporary_duration_kind === "unspecified",
      temporary_duration_kind: payload.temporary_duration_kind ?? null,
      temporary_last_included_local_date: expiryConfirmable
        ? payload.temporary_last_included_local_date ?? null
        : null,
      temporary_expires_at: expiryConfirmable ? payload.temporary_expires_at ?? null : null,
      pending_cleared: false,
    };
  }

  if (smsState !== "awaiting_confirmation") return none;
  if (!candidate) return none;
  if (!payload.temporary_expires_at?.trim()) return none;
  if (expectedCandidate?.trim()) {
    const a = candidate.trim().replace(/\s+/g, " ").toLowerCase();
    const b = expectedCandidate.trim().replace(/\s+/g, " ").toLowerCase();
    if (a !== b) return none;
  }
  const expMs = Date.parse(payload.temporary_expires_at);
  if (!Number.isFinite(expMs) || expMs <= nowMs) return none;

  return {
    ...none,
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: true,
    candidate_behavior_statement: candidate,
    canonical_behavior_statement: canonical,
    pending_state: "awaiting_confirmation",
    temporary_duration_kind: payload.temporary_duration_kind ?? null,
    temporary_last_included_local_date: payload.temporary_last_included_local_date ?? null,
    temporary_expires_at: payload.temporary_expires_at,
    duration_clarification_required: false,
    pending_cleared: false,
    ...(payload.replaces_active_temporary_overlay === true
      ? { replaces_active_temporary_overlay: true }
      : {}),
  };
}

export function activeOverlayBlocksTemporaryPending(
  commitment: ActiveV2CommitmentRow,
  nowMs: number = Date.now()
): boolean {
  return isV2AdaptiveOverlayActive(commitment, nowMs);
}
