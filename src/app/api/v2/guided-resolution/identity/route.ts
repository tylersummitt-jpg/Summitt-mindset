import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { validateIdentityAnchorTiered } from "@/lib/onboarding-intake-validation";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
} from "@/lib/v2-guided-resolution";
import { normalizeIdentityAnchorText } from "@/lib/v2-identity-anchor-validation";
import { persistGuidedIdentityAnchorEdit } from "@/lib/v2-persist-identity-edit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/guided-resolution/identity
 * Versioned identity anchor update for pending guided resolution, then clears pending.
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

    const anchorTier = validateIdentityAnchorTiered(raw);
    if (anchorTier.tier === "block") {
      return NextResponse.json({ ok: false, error: anchorTier.error }, { status: 400 });
    }

    const normalized = normalizeIdentityAnchorText(raw);
    if (!normalized) {
      return NextResponse.json({ ok: false, error: "Add who you are becoming." }, { status: 400 });
    }

    const result = await persistGuidedIdentityAnchorEdit({
      clerkUserId: userId,
      identityAnchorText: normalized,
    });

    if (!result.ok) {
      const status =
        result.code === "identity_setup_incomplete" || result.code === "version_conflict"
          ? 409
          : 500;
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status }
      );
    }

    await clearPendingResolution(commitment.id);
    return NextResponse.json({ ok: true, versionId: result.versionId });
  } catch (e) {
    console.error("[guided-resolution/identity]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
