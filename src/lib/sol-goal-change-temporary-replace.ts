/**
 * Slice 7F-2 — one Goal Change transition: replace the live temporary overlay
 * on the same v2_commitment row.
 *
 * Sol owns English. This module only CAS-updates overlay columns when the
 * staged snapshot still matches. Canonical behavior_statement is never written.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { supabaseServer } from "@/lib/supabase-server";
import { isV2AdaptiveOverlayActive } from "@/lib/v2-adaptive-contract";

export type ReplaceActiveTemporaryOverlayResult =
  | { ok: true; alreadyReplaced: boolean; updatedAt: string | null }
  | { ok: false; error: string };

function overlayExpiryMatches(
  live: string | null | undefined,
  expected: string | null | undefined
): boolean {
  const a = Date.parse(live ?? "");
  const b = Date.parse(expected ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function normalizeBarKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function liveOverlayMatchesReplacementSnapshot(args: {
  commitment: ActiveV2CommitmentRow;
  expectedCanonical: string;
  expectedOverlayText: string;
  expectedOverlayExpiresAt: string;
  nowMs: number;
}): { ok: true } | { ok: false; reason: string } {
  if (args.commitment.status !== "active") {
    return { ok: false, reason: "commitment_not_active" };
  }
  if ((args.commitment.behavior_statement ?? "").trim() !== args.expectedCanonical.trim()) {
    return { ok: false, reason: "canonical_snapshot_mismatch" };
  }
  if (!isV2AdaptiveOverlayActive(args.commitment, args.nowMs)) {
    return { ok: false, reason: "overlay_expired_not_live" };
  }
  if (
    normalizeBarKey(args.commitment.adaptive_ask_text ?? "") !==
    normalizeBarKey(args.expectedOverlayText)
  ) {
    return { ok: false, reason: "overlay_snapshot_mismatch" };
  }
  if (
    !overlayExpiryMatches(
      args.commitment.adaptive_ask_expires_at,
      args.expectedOverlayExpiresAt
    )
  ) {
    return { ok: false, reason: "overlay_snapshot_mismatch" };
  }
  return { ok: true };
}

/**
 * Single-row CAS replace of a still-active temporary overlay.
 * Does not mutate canonical behavior_statement or pending_resolution_*.
 */
export async function replaceActiveTemporaryOverlay(args: {
  commitmentId: string;
  expectedUpdatedAt?: string | null;
  expectedCanonical: string;
  expectedOverlayText: string;
  expectedOverlayExpiresAt: string;
  nextOverlayText: string;
  nextOverlayExpiresAt: string;
  nowMs: number;
}): Promise<ReplaceActiveTemporaryOverlayResult> {
  const nowIso = new Date(args.nowMs).toISOString();
  const nextText = args.nextOverlayText.trim();
  const nextExpiry = args.nextOverlayExpiresAt.trim();
  const expectedCanonical = args.expectedCanonical.trim();
  const expectedText = args.expectedOverlayText.trim();
  const expectedExpiry = args.expectedOverlayExpiresAt.trim();
  if (!nextText || !nextExpiry || !expectedCanonical || !expectedText || !expectedExpiry) {
    return { ok: false, error: "replace_args_incomplete" };
  }

  let q = supabaseServer
    .from("v2_commitment")
    .update({
      adaptive_ask_text: nextText,
      adaptive_ask_active_from: nowIso,
      adaptive_ask_expires_at: nextExpiry,
      updated_at: nowIso,
    })
    .eq("id", args.commitmentId)
    .eq("status", "active")
    .eq("behavior_statement", expectedCanonical)
    .eq("adaptive_ask_text", expectedText)
    .eq("adaptive_ask_expires_at", expectedExpiry);
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
      alreadyReplaced: false,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : nowIso,
    };
  }
  return { ok: false, error: "state_conflict" };
}
