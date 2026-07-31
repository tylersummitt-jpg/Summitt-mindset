/**
 * Morning TTO canonical state maintenance (no model calls, no prose, no body mutation).
 * Clears expired pending resolution and abandons timed-out refresh identity sessions.
 */

import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { clearPendingResolutionIfExpired } from "@/lib/v2-guided-resolution";
import {
  abandonRefreshSessionTimeout,
  parseRefreshSession,
  shouldAbandonStaleIdentityStep,
} from "@/lib/v2-refresh-session";

export type MorningTtoCanonicalStateMaintenanceResult = {
  pending_expired_cleared: boolean;
  refresh_timeout_abandoned: boolean;
  commitment: ActiveV2CommitmentRow | null;
};

/**
 * Run before Morning Twilio send (after adaptive clear / cadence gate).
 * Does not inspect or alter SMS body.
 */
export async function runMorningTtoPreSendCanonicalStateMaintenance(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow | null;
  nowMs?: number;
}): Promise<MorningTtoCanonicalStateMaintenanceResult> {
  const nowMs = args.nowMs ?? Date.now();
  let commitment = args.commitment;
  let pending_expired_cleared = false;
  let refresh_timeout_abandoned = false;

  if (!commitment?.id || !commitment.behavior_statement?.trim()) {
    return { pending_expired_cleared, refresh_timeout_abandoned, commitment };
  }

  const refreshSession = parseRefreshSession(commitment.refresh_session);
  if (refreshSession && shouldAbandonStaleIdentityStep(refreshSession, nowMs)) {
    await abandonRefreshSessionTimeout({
      commitmentId: commitment.id,
      clerkUserId: args.clerkUserId,
      session: refreshSession,
    });
    refresh_timeout_abandoned = true;
    const reloaded = await getActiveCommitment(args.clerkUserId);
    if (reloaded?.behavior_statement?.trim()) {
      commitment = reloaded;
    }
  }

  if (commitment?.id) {
    pending_expired_cleared = await clearPendingResolutionIfExpired(
      commitment.id,
      commitment,
      nowMs
    );
    if (pending_expired_cleared) {
      const reloaded = await getActiveCommitment(args.clerkUserId);
      if (reloaded?.behavior_statement?.trim()) {
        commitment = reloaded;
      }
    }
  }

  return { pending_expired_cleared, refresh_timeout_abandoned, commitment };
}
