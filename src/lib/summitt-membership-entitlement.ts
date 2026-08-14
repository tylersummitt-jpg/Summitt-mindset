/**
 * Central Summitt membership projection (Phase 2 helper).
 *
 * Product access is the OR of a valid Stripe grant and a valid Apple grant.
 * Clerk `summittSubscribed` / `summittPlan` and `sms_audience.summitt_subscribed`
 * are outputs, not payment evidence.
 *
 * Not wired into Stripe/Apple routes in this phase. Callers must inject source
 * and write helpers so unit tests never hit live Stripe/Clerk/Supabase.
 *
 * Fail-safe: unexpected source-lookup errors return a retryable failure and
 * perform no membership writes. A temporary infra error must never project
 * `summittSubscribed: false`.
 */

import {
  classifySummittMembership,
  isSummittEntitledFromSubscription,
  resolvePlanFromSubscription,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";

export const APPLE_IAP_MONTHLY_PRODUCT_ID =
  "com.summittmindset.ios.membership.monthly";

const APPLE_GRANTING_STATUSES = new Set([
  "active",
  "grace_period",
  "billing_retry",
]);

export type SummittProjectedPlan = "monthly" | "annual" | "paused" | null;

/** Derived display hint only. Never treat as entitlement truth. */
export type SummittPaymentSource = "stripe" | "apple" | "multiple" | null;

export type MembershipGrant = {
  grantsAccess: boolean;
  plan: SummittProjectedPlan;
  source: "stripe" | "apple";
};

export type AppleSubscriptionGrantRecord = {
  product_id: string;
  status: string;
  expires_at: string | Date | null;
};

export type MembershipProjection = {
  summittSubscribed: boolean;
  summittPlan: SummittProjectedPlan;
  summittPaymentSource: SummittPaymentSource;
};

export type MembershipEntitlementDeps = {
  resolveStripeMembershipGrant: (
    userId: string
  ) => Promise<MembershipGrant | null>;
  resolveAppleMembershipGrant: (
    userId: string
  ) => Promise<MembershipGrant | null>;
  updateClerkPublicMetadata: (
    userId: string,
    fields: Record<string, unknown>
  ) => Promise<void>;
  syncSmsAudience: (params: {
    userId: string;
    summittSubscribed: boolean;
  }) => Promise<void>;
};

export type RecomputeSummittMembershipResult =
  | ({ ok: true } & MembershipProjection)
  | {
      ok: false;
      retryable: true;
      reason:
        | "stripe_lookup_failed"
        | "apple_lookup_failed"
        | "clerk_projection_failed"
        | "sms_sync_failed";
      clerkUpdated: boolean;
    };

/**
 * Map an already-fetched Stripe subscription to a grant using current
 * production classification (`isSummittEntitledFromSubscription`).
 *
 * `null` / missing subscription means no Stripe evidence (not an error).
 * past_due does not grant. pause_collection projects plan `paused` without access.
 * Entitled unknown interval → access true, plan null (matches resume-membership).
 */
export function resolveStripeMembershipGrantFromSubscription(
  sub: SummittSubscriptionLike | null | undefined
): MembershipGrant | null {
  if (sub == null) return null;

  const entitled = isSummittEntitledFromSubscription(sub);
  if (entitled) {
    const interval = resolvePlanFromSubscription(sub);
    const plan: SummittProjectedPlan =
      interval === "monthly" || interval === "annual" ? interval : null;
    return { grantsAccess: true, plan, source: "stripe" };
  }

  if (classifySummittMembership(sub) === "paused_recoverable") {
    return { grantsAccess: false, plan: "paused", source: "stripe" };
  }

  return { grantsAccess: false, plan: null, source: "stripe" };
}

/**
 * Apple expiry law for granting statuses (`active` / `grace_period` /
 * `billing_retry`):
 *
 * - `expires_at` is mandatory. A granting status with null/invalid expiry
 *   does not grant (fail closed on that row; it is malformed evidence, not
 *   an infrastructure failure).
 * - Grant only while `expires_at` is strictly after `now`. Status `active`
 *   with a past expiry is a stale row and must not grant.
 * - Timestamps are compared as instants (ISO / timestamptz → Date).
 * - No cron in this phase; callers pass `now` (tests) or wall clock.
 */
export function isAppleRowCurrentlyGranting(
  row: AppleSubscriptionGrantRecord,
  now: Date
): boolean {
  if (row.product_id !== APPLE_IAP_MONTHLY_PRODUCT_ID) return false;
  if (!APPLE_GRANTING_STATUSES.has(row.status)) return false;
  if (row.expires_at == null) return false;

  const expiresAt =
    row.expires_at instanceof Date
      ? row.expires_at
      : new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}

/**
 * Multiple Apple rows: any one valid allowed-product grant wins. Invalid,
 * expired, wrong-product, or malformed rows do not cancel another valid row.
 * Row order is not entitlement truth.
 */
export function resolveAppleMembershipGrantFromRecords(
  rows: AppleSubscriptionGrantRecord[],
  now: Date
): MembershipGrant | null {
  for (const row of rows) {
    if (isAppleRowCurrentlyGranting(row, now)) {
      return { grantsAccess: true, plan: "monthly", source: "apple" };
    }
  }
  return null;
}

/**
 * Combine Stripe + Apple grants into the product projection.
 *
 * Plan precedence: Stripe monthly/annual while Stripe grants; otherwise Apple
 * monthly while Apple grants; otherwise paused if Stripe is paused; else null.
 * `summittPaymentSource` is derived from who currently grants — never a gate.
 */
export function combineMembershipGrants(
  stripe: MembershipGrant | null,
  apple: MembershipGrant | null
): MembershipProjection {
  const stripeGrants = stripe?.grantsAccess === true;
  const appleGrants = apple?.grantsAccess === true;
  const summittSubscribed = stripeGrants || appleGrants;

  let summittPlan: SummittProjectedPlan = null;
  if (stripeGrants) {
    summittPlan = stripe?.plan ?? null;
  } else if (appleGrants) {
    summittPlan = "monthly";
  } else if (stripe?.plan === "paused") {
    summittPlan = "paused";
  }

  let summittPaymentSource: SummittPaymentSource = null;
  if (stripeGrants && appleGrants) {
    summittPaymentSource = "multiple";
  } else if (stripeGrants) {
    summittPaymentSource = "stripe";
  } else if (appleGrants) {
    summittPaymentSource = "apple";
  }

  return { summittSubscribed, summittPlan, summittPaymentSource };
}

/**
 * Recompute Clerk + SMS membership projection from injected Stripe and Apple
 * sources. Looks up both sources before any write. Either source throwing is
 * retryable and skips all writes.
 *
 * Write order matches current Stripe routes: Clerk first, then
 * `syncSmsAudience` with an explicit `summittSubscribed` boolean (never omit
 * it — a Clerk re-read failure inside SMS sync would default false).
 *
 * Clerk is the canonical product-facing projection. An SMS replica failure
 * after Clerk success is retryable; do not roll back Clerk. Retry is
 * idempotent. `syncSmsAudience` currently logs DB errors without throwing;
 * a thrown SMS helper is treated as retryable here.
 *
 * Phase 2 does not write `summittPaymentSource` to Clerk (deferred display
 * field). It is returned on success for later Account UI.
 */
export async function recomputeSummittMembershipEntitlement(
  userId: string,
  deps: MembershipEntitlementDeps
): Promise<RecomputeSummittMembershipResult> {
  const [stripeSettled, appleSettled] = await Promise.allSettled([
    deps.resolveStripeMembershipGrant(userId),
    deps.resolveAppleMembershipGrant(userId),
  ]);

  if (stripeSettled.status === "rejected") {
    return {
      ok: false,
      retryable: true,
      reason: "stripe_lookup_failed",
      clerkUpdated: false,
    };
  }
  if (appleSettled.status === "rejected") {
    return {
      ok: false,
      retryable: true,
      reason: "apple_lookup_failed",
      clerkUpdated: false,
    };
  }

  const projection = combineMembershipGrants(
    stripeSettled.value,
    appleSettled.value
  );

  try {
    await deps.updateClerkPublicMetadata(userId, {
      summittSubscribed: projection.summittSubscribed,
      summittPlan: projection.summittPlan,
    });
  } catch {
    return {
      ok: false,
      retryable: true,
      reason: "clerk_projection_failed",
      clerkUpdated: false,
    };
  }

  try {
    await deps.syncSmsAudience({
      userId,
      summittSubscribed: projection.summittSubscribed,
    });
  } catch {
    return {
      ok: false,
      retryable: true,
      reason: "sms_sync_failed",
      clerkUpdated: true,
    };
  }

  return { ok: true, ...projection };
}
