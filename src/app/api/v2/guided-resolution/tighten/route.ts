import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  normalizeShrinkProposalBindingText,
  proposeShrinkAskFromGuidedResolution,
} from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
} from "@/lib/v2-guided-resolution";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/guided-resolution/tighten
 * Creates shrink_ask proposal + consent SMS; does not activate overlay or change base commitment.
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
      typeof body.proposal_binding_text === "string" ? body.proposal_binding_text : "";
    const normalized = normalizeShrinkProposalBindingText(raw);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "proposal_binding_text invalid (3–240 chars, trimmed)" },
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
    if (!pending || pending.kind !== "commitment_tighten") {
      return NextResponse.json(
        { ok: false, error: "No pending tighten handoff" },
        { status: 409 }
      );
    }

    if (commitment.accountability_phase === "low_pressure_reactivation") {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "guided_resolution_tighten_paused_blocked",
      });
      return NextResponse.json(
        { ok: false, error: "Guided tighten is not available during low-pressure pause." },
        { status: 409 }
      );
    }

    const result = await proposeShrinkAskFromGuidedResolution({
      commitmentId: commitment.id,
      clerkUserId: userId,
      proposalBindingText: normalized,
      originalBehaviorStatement: commitment.behavior_statement,
    });

    if (!result.ok) {
      if (
        result.error === "proposal_already_pending" ||
        result.error === "overlay_already_active"
      ) {
        await clearPendingResolution(commitment.id);
        await recomputeV2CoachingMemory(commitment.id, {
          reasonCode: "guided_resolution_tighten_pending_cleared",
        });
      }
      return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
    }

    await clearPendingResolution(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "guided_resolution_tighten",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[guided-resolution/tighten]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
