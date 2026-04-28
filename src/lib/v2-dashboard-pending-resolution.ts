import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  clearPendingResolution,
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  type V2PendingResolutionKind,
} from "@/lib/v2-guided-resolution";

/**
 * Same cleanup + visibility rules as `guided-resolution/page.tsx` entry:
 * clears expired pending, clears pending in low-pressure reactivation, then
 * returns an actionable pending kind for dashboard banner (or null).
 */
export async function resolveActionablePendingResolutionKindForDashboard(
  clerkUserId: string
): Promise<V2PendingResolutionKind | null> {
  let commitment = await getActiveCommitment(clerkUserId);
  if (!commitment) return null;

  const pendingBefore = getPendingResolutionOrNull(commitment);
  if (pendingBefore && isPendingResolutionExpired(commitment, Date.now())) {
    await clearPendingResolution(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "dashboard_pending_resolution_expired_cleanup",
    });
    commitment = await getActiveCommitment(clerkUserId);
  }

  if (!commitment) return null;

  if (commitment.accountability_phase === "low_pressure_reactivation") {
    const p = getPendingResolutionOrNull(commitment);
    if (p) {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "dashboard_pending_resolution_pause_cleanup",
      });
      commitment = await getActiveCommitment(clerkUserId);
    }
  }

  if (!commitment) return null;

  const pending = getPendingResolutionOrNull(commitment);
  return pending?.kind ?? null;
}
