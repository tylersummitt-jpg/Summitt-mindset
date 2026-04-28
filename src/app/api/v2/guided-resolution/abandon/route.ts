import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { clearPendingResolution, getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/guided-resolution/abandon
 * Clears pending guided resolution (user tapped Not now).
 */
export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const commitment = await getActiveCommitment(userId);
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    if (!getPendingResolutionOrNull(commitment)) {
      return NextResponse.json({ ok: true, cleared: false });
    }

    await clearPendingResolution(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "guided_resolution_abandon",
    });
    return NextResponse.json({ ok: true, cleared: true });
  } catch (e) {
    console.error("[guided-resolution/abandon]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
