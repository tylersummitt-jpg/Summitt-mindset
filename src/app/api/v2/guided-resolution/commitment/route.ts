import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { clearStaleAdaptiveContractColumns } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
} from "@/lib/v2-guided-resolution";

export const dynamic = "force-dynamic";

const BEHAVIOR_MAX = 2000;

/**
 * POST /api/v2/guided-resolution/commitment
 * True replacement: supersede current active commitment and create a new active row.
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
      typeof body.behavior_statement === "string" ? body.behavior_statement.trim() : "";
    if (!raw) {
      return NextResponse.json({ ok: false, error: "behavior_statement required" }, {
        status: 400,
      });
    }
    if (raw.length > BEHAVIOR_MAX) {
      return NextResponse.json(
        { ok: false, error: `behavior_statement too long (max ${BEHAVIOR_MAX})` },
        { status: 400 }
      );
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
    if (!pending || pending.kind !== "commitment_replace") {
      return NextResponse.json(
        { ok: false, error: "No pending commitment update" },
        { status: 409 }
      );
    }

    if (commitment.accountability_phase === "low_pressure_reactivation") {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "guided_resolution_replace_paused_blocked",
      });
      return NextResponse.json(
        { ok: false, error: "Guided resolution is not available during low-pressure pause." },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseServer.rpc(
      "v2_apply_guided_commitment_replace_mutation",
      {
        p_old_commitment_id: commitment.id,
        p_clerk_user_id: userId,
        p_new_behavior_statement: raw,
        p_expected_old_updated_at: commitment.updated_at,
        p_now: new Date().toISOString(),
      }
    );
    if (error) {
      console.error("[guided-resolution/commitment] wrapper rpc failed", error.message);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    const row = Array.isArray(data) ? data[0] : null;
    const result = typeof row?.result === "string" ? row.result : "error";
    const oldCommitmentId =
      typeof row?.old_commitment_id === "string" ? row.old_commitment_id : commitment.id;
    const newCommitmentId =
      typeof row?.new_commitment_id === "string" && row.new_commitment_id.trim()
        ? row.new_commitment_id.trim()
        : null;

    if (result === "not_found") {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }
    if (result === "state_conflict") {
      return NextResponse.json(
        { ok: false, error: "Replacement changed by another request. Refresh and try again." },
        { status: 409 }
      );
    }
    if (result !== "applied" && result !== "already_applied") {
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }
    if (!newCommitmentId) {
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    await clearStaleAdaptiveContractColumns(newCommitmentId);
    await recomputeV2CoachingMemory(newCommitmentId, {
      reasonCode:
        result === "already_applied"
          ? "guided_resolution_replace_raced_winner"
          : "guided_resolution_replace",
    });
    return NextResponse.json({ ok: true, replacedCommitmentId: oldCommitmentId, newCommitmentId });
  } catch (e) {
    console.error("[guided-resolution/commitment]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
