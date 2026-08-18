/**
 * Sol canonical-outcome side effects — recompute + blocker pending only.
 * Authority is the already-resolved persist result. No classifier, regex, or TU.
 * No V3 learning notebook append.
 */

import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  setBlockerCapturePending,
  type V2AccountabilityOutcome,
} from "@/lib/v2-commitment";
import type { InboundOutcomePersistResult } from "@/lib/v2-inbound-accountability-outcome-persist";

export type SolInboundOutcomeSideEffectsResult = {
  recomputed: boolean;
  blockerCaptureSet: V2AccountabilityOutcome | null;
};

function persistedAccountabilityEventType(
  persistResult: InboundOutcomePersistResult
): V2AccountabilityOutcome | null {
  if (persistResult.status !== "inserted" && persistResult.status !== "duplicate") {
    return null;
  }
  if (
    persistResult.eventType === "user_yes" ||
    persistResult.eventType === "user_no" ||
    persistResult.eventType === "user_partial"
  ) {
    return persistResult.eventType;
  }
  return null;
}

/**
 * After canonical Sol outcome persist, before writer/send.
 * inserted/duplicate user_yes → recompute, no blocker.
 * inserted/duplicate user_no | user_partial → recompute + blocker pending.
 * skipped/error/plan/attempt/life-only → neither.
 */
export async function applySolInboundOutcomeSideEffects(args: {
  commitmentId: string;
  persistResult: InboundOutcomePersistResult;
}): Promise<SolInboundOutcomeSideEffectsResult> {
  const eventType = persistedAccountabilityEventType(args.persistResult);
  if (!eventType) {
    return { recomputed: false, blockerCaptureSet: null };
  }

  await recomputeV2CoachingMemory(args.commitmentId, {
    reasonCode: "inbound_user_outcome",
  });

  if (eventType === "user_no" || eventType === "user_partial") {
    await setBlockerCapturePending(args.commitmentId, eventType);
    return { recomputed: true, blockerCaptureSet: eventType };
  }

  return { recomputed: true, blockerCaptureSet: null };
}
