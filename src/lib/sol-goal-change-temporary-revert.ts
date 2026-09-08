/**
 * Slice 7F-1 — Sol-owned early revert of a still-active temporary Goal Change overlay.
 *
 * Sol owns English (reverts_active_temporary_overlay). This module owns
 * clear → reload → prove. Canonical Current Goal never mutates here.
 *
 * Two clocks:
 * - semantic/turn time: inbound created_at (overlay snapshot on interpreter input).
 * - mutation/proof wall-clock (mutationClock): live-overlay precondition and proof.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
} from "@/lib/v2-adaptive-contract";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import type { SolGoalChangeAuthoritativeActiveOverlay } from "@/lib/sol-goal-change-semantic";
import {
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import { refreshUnsentTtoDraftsAfterRelationshipChange } from "@/lib/sol-goal-change-tto-draft-refresh";

export type ClearActiveTemporaryOverlayResult =
  | { ok: true; alreadyCleared: boolean; updatedAt: string | null }
  | { ok: false; error: string };

export type ProveTemporaryOverlayRevertedResult =
  | { ok: true }
  | { ok: false; reason: string };

export type SolActiveTemporaryOverlayRevertForensics = {
  overlay_revert_attempted: boolean;
  overlay_revert_proved: boolean | null;
  overlay_revert_reason: string | null;
  already_cleared: boolean;
};

export type SolActiveTemporaryOverlayRevertResult = {
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  forensics: SolActiveTemporaryOverlayRevertForensics;
};

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function overlayLastIncludedLocalDate(
  expiresAt: string | null | undefined,
  timezone: string | null
): string | null {
  const exp = Date.parse(expiresAt ?? "");
  if (!Number.isFinite(exp)) return null;
  const tz = timezone?.trim() || "UTC";
  return getDateKeyInTimezone(new Date(exp - 1), tz);
}

/** Live applied overlay only. Proposal columns are never this. */
export function buildAuthoritativeActiveOverlaySnapshot(
  commitment: ActiveV2CommitmentRow,
  nowMs: number,
  timezone?: string | null
): SolGoalChangeAuthoritativeActiveOverlay | null {
  if (!isV2AdaptiveOverlayActive(commitment, nowMs)) return null;
  const text = commitment.adaptive_ask_text?.trim() || null;
  const expires = commitment.adaptive_ask_expires_at?.trim() || null;
  if (!text || !expires) return null;
  return {
    active: true,
    overlay_behavior_statement: text,
    overlay_expires_at: expires,
    overlay_last_included_local_date: overlayLastIncludedLocalDate(expires, timezone ?? null),
  };
}

export function proveTemporaryOverlayReverted(args: {
  before: ActiveV2CommitmentRow;
  after: ActiveV2CommitmentRow | null;
  canonicalSnapshot: string;
  nowMs: number;
}): ProveTemporaryOverlayRevertedResult {
  if (!args.after) return { ok: false, reason: "reload_missing_active" };
  if (args.after.id !== args.before.id) return { ok: false, reason: "reload_commitment_id_changed" };
  if (args.after.status !== "active") return { ok: false, reason: "reload_not_active" };
  const beforeCanon = (args.before.behavior_statement ?? "").trim();
  const afterCanon = (args.after.behavior_statement ?? "").trim();
  const snap = args.canonicalSnapshot.trim();
  if (afterCanon !== beforeCanon) return { ok: false, reason: "reload_canonical_changed" };
  if (afterCanon !== snap) return { ok: false, reason: "reload_canonical_snapshot_mismatch" };
  if (isV2AdaptiveOverlayActive(args.after, args.nowMs)) {
    return { ok: false, reason: "reload_overlay_still_active" };
  }
  if ((args.after.adaptive_ask_text ?? "").trim()) {
    return { ok: false, reason: "reload_overlay_text_still_present" };
  }
  if ((args.after.adaptive_ask_active_from ?? "").trim()) {
    return { ok: false, reason: "reload_overlay_active_from_still_present" };
  }
  if ((args.after.adaptive_ask_expires_at ?? "").trim()) {
    return { ok: false, reason: "reload_overlay_expires_at_still_present" };
  }
  const effective = getEffectiveCoachingAsk(args.after, args.nowMs);
  if (normalizeBarKey(effective) !== normalizeBarKey(afterCanon)) {
    return { ok: false, reason: "reload_effective_ask_not_canonical" };
  }
  return { ok: true };
}

export function buildTemporaryRevertedAuthorization(args: {
  commitment: ActiveV2CommitmentRow;
}): SolGoalChangeConfirmationAuthorization {
  const canonical = (args.commitment.behavior_statement ?? "").trim();
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: false,
    temporary_adjustment_apply_authorized: false,
    temporary_adjustment_reverted: true,
    candidate_behavior_statement: null,
    canonical_behavior_statement: canonical,
    pending_state: null,
    previous_behavior_statement: null,
    previous_commitment_id: null,
    active_commitment_id: args.commitment.id,
    pending_cleared: false,
  };
}

/**
 * Goal Change-scoped clear of a still-active temporary overlay on the same row.
 * Does not mutate canonical behavior_statement or pending_resolution_*.
 * CAS on updated_at. Duplicate retry observes already-cleared columns.
 */
export async function clearActiveTemporaryOverlay(args: {
  commitmentId: string;
  expectedUpdatedAt?: string | null;
  nowMs: number;
}): Promise<ClearActiveTemporaryOverlayResult> {
  const nowIso = new Date(args.nowMs).toISOString();
  let q = supabaseServer
    .from("v2_commitment")
    .update({
      adaptive_ask_text: null,
      adaptive_ask_active_from: null,
      adaptive_ask_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", args.commitmentId)
    .eq("status", "active")
    .not("adaptive_ask_text", "is", null);
  if (typeof args.expectedUpdatedAt === "string" && args.expectedUpdatedAt.trim()) {
    q = q.eq("updated_at", args.expectedUpdatedAt.trim());
  }
  const { data, error } = await q.select("updated_at").maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  if (data) {
    return {
      ok: true,
      alreadyCleared: false,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : nowIso,
    };
  }
  return { ok: true, alreadyCleared: true, updatedAt: null };
}

function neitherAuth(commitment: ActiveV2CommitmentRow): SolGoalChangeConfirmationAuthorization {
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: (commitment.behavior_statement ?? "").trim(),
    active_commitment_id: commitment.id,
  };
}

/** Side effect after proved revert/canonical. Repeatable. Never rolls back Goal Change. */
async function refreshTtoDraftsAfterProvenRevert(clerkUserId: string): Promise<void> {
  try {
    await refreshUnsentTtoDraftsAfterRelationshipChange({
      clerkUserId,
    });
  } catch (error) {
    console.warn("[sol-goal-change-tto-draft-refresh] after_overlay_revert", error);
  }
}

export async function applySolActiveTemporaryOverlayRevert(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  inboundMessageSid: string;
  mutationClock?: () => number;
}): Promise<SolActiveTemporaryOverlayRevertResult> {
  void args.inboundMessageSid;
  const mutationClock = args.mutationClock ?? Date.now;
  const liveStart = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  const canonicalSnapshot = (liveStart.behavior_statement ?? "").trim();

  if (isSmsInboundPendingResolutionActionable(liveStart)) {
    return {
      commitment: liveStart,
      authorization: neitherAuth(liveStart),
      forensics: {
        overlay_revert_attempted: false,
        overlay_revert_proved: false,
        overlay_revert_reason: "actionable_pending_owns_turn",
        already_cleared: false,
      },
    };
  }

  const mutationNowMs = mutationClock();
  const overlayLive = isV2AdaptiveOverlayActive(liveStart, mutationNowMs);
  const overlayTextPresent = Boolean((liveStart.adaptive_ask_text ?? "").trim());

  if (!overlayLive && overlayTextPresent) {
    return {
      commitment: liveStart,
      authorization: neitherAuth(liveStart),
      forensics: {
        overlay_revert_attempted: false,
        overlay_revert_proved: false,
        overlay_revert_reason: "overlay_expired_not_live",
        already_cleared: false,
      },
    };
  }

  if (!overlayLive && !overlayTextPresent) {
    const proved = proveTemporaryOverlayReverted({
      before: liveStart,
      after: liveStart,
      canonicalSnapshot,
      nowMs: mutationNowMs,
    });
    if (!proved.ok) {
      return {
        commitment: liveStart,
        authorization: neitherAuth(liveStart),
        forensics: {
          overlay_revert_attempted: false,
          overlay_revert_proved: false,
          overlay_revert_reason: proved.reason,
          already_cleared: true,
        },
      };
    }
    await refreshTtoDraftsAfterProvenRevert(args.clerkUserId);
    return {
      commitment: liveStart,
      authorization: buildTemporaryRevertedAuthorization({ commitment: liveStart }),
      forensics: {
        overlay_revert_attempted: false,
        overlay_revert_proved: true,
        overlay_revert_reason: "already_canonical",
        already_cleared: true,
      },
    };
  }

  const cleared = await clearActiveTemporaryOverlay({
    commitmentId: liveStart.id,
    expectedUpdatedAt: liveStart.updated_at,
    nowMs: mutationNowMs,
  });
  if (!cleared.ok) {
    return {
      commitment: liveStart,
      authorization: neitherAuth(liveStart),
      forensics: {
        overlay_revert_attempted: true,
        overlay_revert_proved: false,
        overlay_revert_reason: `clear_failed:${cleared.error}`,
        already_cleared: false,
      },
    };
  }

  const after = (await getActiveCommitment(args.clerkUserId)) ?? liveStart;
  const proofNowMs = mutationClock();

  if (cleared.alreadyCleared && isV2AdaptiveOverlayActive(after, proofNowMs)) {
    return {
      commitment: after,
      authorization: neitherAuth(after),
      forensics: {
        overlay_revert_attempted: true,
        overlay_revert_proved: false,
        overlay_revert_reason: "cas_mismatch",
        already_cleared: false,
      },
    };
  }

  const proved = proveTemporaryOverlayReverted({
    before: liveStart,
    after,
    canonicalSnapshot,
    nowMs: proofNowMs,
  });
  if (!proved.ok) {
    return {
      commitment: after,
      authorization: neitherAuth(after),
      forensics: {
        overlay_revert_attempted: true,
        overlay_revert_proved: false,
        overlay_revert_reason: proved.reason,
        already_cleared: cleared.alreadyCleared,
      },
    };
  }

  await recomputeV2CoachingMemory(liveStart.id, {
    reasonCode: "sol_temporary_overlay_reverted",
  });

  await refreshTtoDraftsAfterProvenRevert(args.clerkUserId);

  return {
    commitment: after,
    authorization: buildTemporaryRevertedAuthorization({ commitment: after }),
    forensics: {
      overlay_revert_attempted: !cleared.alreadyCleared,
      overlay_revert_proved: true,
      overlay_revert_reason: cleared.alreadyCleared ? "already_canonical" : null,
      already_cleared: cleared.alreadyCleared,
    },
  };
}
