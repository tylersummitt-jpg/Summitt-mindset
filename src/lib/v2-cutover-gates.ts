/**
 * V2 cutover readiness: shared rules for “fully on V2” (active commitment + behavior_statement).
 * Side crons and product gates use these helpers; main SMS crons are V2-only (PR6).
 */

import { getActiveCommitment } from "@/lib/v2-commitment";

export type FullyOnV2MessagingReason =
  | "active_commitment_with_behavior"
  | "no_active_commitment"
  | "empty_behavior_statement";

export type FullyOnV2MessagingStatus = {
  fullyOnV2: boolean;
  reason: FullyOnV2MessagingReason;
};

/**
 * True when the same conditions that enable the V2 daily/inbound fork are met:
 * active `v2_commitment` and non-empty `behavior_statement` (matches `buildDailySmsContent` gate).
 *
 * Callers that iterate `sms_audience` (summitt_subscribed + sms_enabled) already enforce SMS list membership.
 */
export async function resolveUserFullyOnV2ForCutoverMessaging(
  clerkUserId: string
): Promise<FullyOnV2MessagingStatus> {
  const c = await getActiveCommitment(clerkUserId);
  if (!c) {
    return { fullyOnV2: false, reason: "no_active_commitment" };
  }
  if (!c.behavior_statement?.trim()) {
    return { fullyOnV2: false, reason: "empty_behavior_statement" };
  }
  return { fullyOnV2: true, reason: "active_commitment_with_behavior" };
}

/** Same rule as cutover / daily-sms V2 fork: active commitment + non-empty behavior_statement. */
export async function isUserFullyOnV2AccountabilityPath(clerkUserId: string): Promise<boolean> {
  const s = await resolveUserFullyOnV2ForCutoverMessaging(clerkUserId);
  return s.fullyOnV2;
}

/** Clerk public metadata mirror of dashboard subscription gate (read-only). */
export function isSummittSubscribedFromClerkMetadata(md: Record<string, unknown>): boolean {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;
  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}
