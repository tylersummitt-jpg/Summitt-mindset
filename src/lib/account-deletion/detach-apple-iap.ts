/**
 * Apple IAP detach for account deletion (no public API).
 *
 * Runs during canceling_subscription after Stripe cancel/skip.
 * Does not cancel App Store billing. Does not call App Store Server API.
 * Does not write Clerk entitlement. Does not delete Apple rows.
 *
 * Idempotent:
 * - live binding tombstone: clerk_user_id NULL + unbound_at now, token kept
 * - apple_subscriptions: clerk_user_id NULL, billing/audit columns kept
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

export type AppleBindingTombstoneOutcome =
  | "tombstoned"
  | "already_unbound"
  | "failed";

export type AppleSubscriptionDetachOutcome = "detached" | "none" | "failed";

export type DetachAppleIapForDeletionResult =
  | {
      ok: true;
      binding: Exclude<AppleBindingTombstoneOutcome, "failed">;
      subscriptions: Exclude<AppleSubscriptionDetachOutcome, "failed">;
    }
  | {
      ok: false;
      reason: "binding_tombstone_failed" | "subscription_detach_failed";
      binding: AppleBindingTombstoneOutcome;
      subscriptions: AppleSubscriptionDetachOutcome;
    };

export type AppleIapDetachStore = {
  tombstoneLiveBinding: (
    clerkUserId: string
  ) => Promise<AppleBindingTombstoneOutcome>;
  detachSubscriptions: (
    clerkUserId: string
  ) => Promise<AppleSubscriptionDetachOutcome>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createSupabaseAppleIapDetachStore(): AppleIapDetachStore {
  return {
    async tombstoneLiveBinding(clerkUserId) {
      const { data, error } = await supabaseServer
        .from("apple_account_bindings")
        .update({
          clerk_user_id: null,
          unbound_at: new Date().toISOString(),
        })
        .eq("clerk_user_id", clerkUserId)
        .is("unbound_at", null)
        .select("app_account_token");
      if (error) return "failed";
      const rows = Array.isArray(data) ? data : [];
      return rows.length > 0 ? "tombstoned" : "already_unbound";
    },

    async detachSubscriptions(clerkUserId) {
      const { data, error } = await supabaseServer
        .from("apple_subscriptions")
        .update({ clerk_user_id: null })
        .eq("clerk_user_id", clerkUserId)
        .select(
          "original_transaction_id, latest_transaction_id, app_account_token, last_signed_at"
        );
      if (error) return "failed";
      const rows = Array.isArray(data) ? data : [];
      return rows.length > 0 ? "detached" : "none";
    },
  };
}

/**
 * Tombstone the live Apple binding and detach apple_subscriptions for this
 * Clerk user. Both operations always run (independently idempotent).
 * Failure of either is retryable; do not roll the other back.
 */
export async function detachAppleIapForDeletion(
  clerkUserId: string,
  deps: { store?: AppleIapDetachStore } = {}
): Promise<DetachAppleIapForDeletionResult> {
  const trimmed = clerkUserId.trim();
  if (!isNonEmptyString(trimmed)) {
    return {
      ok: false,
      reason: "binding_tombstone_failed",
      binding: "failed",
      subscriptions: "failed",
    };
  }

  const store = deps.store ?? createSupabaseAppleIapDetachStore();
  const binding = await store.tombstoneLiveBinding(trimmed);
  const subscriptions = await store.detachSubscriptions(trimmed);

  if (binding === "failed") {
    return {
      ok: false,
      reason: "binding_tombstone_failed",
      binding,
      subscriptions,
    };
  }
  if (subscriptions === "failed") {
    return {
      ok: false,
      reason: "subscription_detach_failed",
      binding,
      subscriptions,
    };
  }

  return { ok: true, binding, subscriptions };
}
