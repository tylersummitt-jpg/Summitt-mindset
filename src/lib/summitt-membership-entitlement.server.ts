/**
 * Production deps for recomputeSummittMembershipEntitlement.
 *
 * Stripe truth is the Subscription object from THIS request/event — never
 * re-fetched from Clerk stripeSubscriptionId when the caller already has it.
 * Apple truth is public.apple_subscriptions. Empty rows = no grant.
 * Query errors throw (retryable). SMS remains best-effort via syncSmsAudience.
 */

import "server-only";

import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import {
  recomputeSummittMembershipEntitlement,
  resolveAppleMembershipGrantFromRecords,
  resolveStripeMembershipGrantFromSubscription,
  type MembershipEntitlementDeps,
  type MembershipGrant,
  type RecomputeSummittMembershipResult,
} from "@/lib/summitt-membership-entitlement";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import type { SummittSubscriptionLike } from "@/lib/summitt-subscription-membership";

export async function resolveAppleMembershipGrantForUser(
  userId: string
): Promise<MembershipGrant | null> {
  const { data, error } = await supabaseServer
    .from("apple_subscriptions")
    .select("product_id, status, expires_at")
    .eq("clerk_user_id", userId);

  if (error) {
    throw new Error(`apple_subscriptions lookup failed: ${error.message}`);
  }

  return resolveAppleMembershipGrantFromRecords(data ?? [], new Date());
}

export function createMembershipEntitlementDeps(args: {
  stripeSubscription: SummittSubscriptionLike;
}): MembershipEntitlementDeps {
  const { stripeSubscription } = args;
  return {
    resolveStripeMembershipGrant: async () =>
      resolveStripeMembershipGrantFromSubscription(stripeSubscription),
    resolveAppleMembershipGrant: resolveAppleMembershipGrantForUser,
    updateClerkPublicMetadata: async (userId, fields) => {
      await updateClerkPublicMetadata(userId, fields);
    },
    syncSmsAudience: async (params) => {
      await syncSmsAudience({
        userId: params.userId,
        summittSubscribed: params.summittSubscribed,
      });
    },
  };
}

export async function recomputeMembershipFromAuthoritativeStripeSubscription(
  userId: string,
  stripeSubscription: SummittSubscriptionLike
): Promise<RecomputeSummittMembershipResult> {
  return recomputeSummittMembershipEntitlement(
    userId,
    createMembershipEntitlementDeps({ stripeSubscription })
  );
}

type RetryableSourceOrClerkFailure = {
  ok: false;
  retryable: true;
  reason: "stripe_lookup_failed" | "apple_lookup_failed" | "clerk_projection_failed";
  clerkUpdated: boolean;
};

type SmsReplicaFailureAfterClerk = {
  ok: false;
  retryable: true;
  reason: "sms_sync_failed";
  clerkUpdated: boolean;
};

/** Source or Clerk failures must not be treated as billing success. */
export function isRetryableMembershipSourceOrClerkFailure(
  result: RecomputeSummittMembershipResult
): result is RetryableSourceOrClerkFailure {
  return (
    result.ok === false &&
    result.retryable &&
    (result.reason === "stripe_lookup_failed" ||
      result.reason === "apple_lookup_failed" ||
      result.reason === "clerk_projection_failed")
  );
}

/**
 * Clerk projection succeeded. SMS replica failure after that is best-effort
 * and must not roll back product access.
 */
export function membershipProjectionClerkSucceeded(
  result: RecomputeSummittMembershipResult
): boolean {
  return result.ok === true || result.clerkUpdated === true;
}

export function isSmsReplicaFailureAfterClerkSuccess(
  result: RecomputeSummittMembershipResult
): result is SmsReplicaFailureAfterClerk {
  return result.ok === false && result.reason === "sms_sync_failed";
}
