import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  computeIdentityRefreshDueAtIsoFromNow,
  normalizeIdentityAnchorText,
} from "@/lib/v2-identity-anchor";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
} from "@/lib/v2-guided-resolution";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/guided-resolution/identity
 * Same identity semantics as /api/profile/update for `identity_anchor_text`, then clears pending.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const raw =
      typeof body.identity_anchor_text === "string" ? body.identity_anchor_text : null;
    if (raw === null) {
      return NextResponse.json({ ok: false, error: "identity_anchor_text required" }, {
        status: 400,
      });
    }

    let commitment = await getActiveCommitment(userId);
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    await clearPendingResolutionIfExpired(commitment.id, commitment);
    commitment = await getActiveCommitment(userId);
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    const pending = getPendingResolutionOrNull(commitment);
    if (!pending || pending.kind !== "identity_anchor_update") {
      return NextResponse.json(
        { ok: false, error: "No pending identity update" },
        { status: 409 }
      );
    }

    if (commitment.accountability_phase === "low_pressure_reactivation") {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "guided_resolution_identity_paused_blocked",
      });
      return NextResponse.json(
        { ok: false, error: "Guided resolution is not available during low-pressure pause." },
        { status: 409 }
      );
    }

    const normalized = normalizeIdentityAnchorText(raw);
    const nowIso = new Date().toISOString();
    const row: Record<string, unknown> = { clerk_user_id: userId };
    if (!normalized) {
      row.identity_anchor_text = null;
      row.identity_source = null;
      row.identity_last_confirmed_at = null;
      row.identity_refresh_due_at = null;
      row.identity_last_referenced_at = null;
    } else {
      row.identity_anchor_text = normalized;
      row.identity_source = "user_edited";
      row.identity_last_confirmed_at = nowIso;
      row.identity_refresh_due_at = computeIdentityRefreshDueAtIsoFromNow();
    }

    const { error } = await supabaseServer.from("user_profiles").upsert(row, {
      onConflict: "clerk_user_id",
    });

    if (error) {
      console.error("[guided-resolution/identity] upsert failed", error.message);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    await clearPendingResolution(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "guided_resolution_identity",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[guided-resolution/identity]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
