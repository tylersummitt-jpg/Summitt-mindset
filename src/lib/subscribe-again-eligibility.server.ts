import "server-only";

import Stripe from "stripe";

import { resolveAppleMembershipGrantForUser } from "@/lib/summitt-membership-entitlement.server";
import {
  clerkStripeSubscriptionId,
  shouldShowSubscribeAgain,
} from "@/lib/subscribe-again-eligibility";
import type { SummittSubscriptionLike } from "@/lib/summitt-subscription-membership";

function stripeCustomerIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeCustomerId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isStripeMissingError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: unknown; statusCode?: unknown };
  return e.code === "resource_missing" || e.statusCode === 404;
}

function asMembershipLike(sub: Stripe.Subscription): SummittSubscriptionLike {
  return sub as SummittSubscriptionLike;
}

export type ResolveShowSubscribeAgainArgs = {
  userId: string;
  isNativeApp: boolean;
  publicMetadata: Record<string, unknown> | null | undefined;
};

export async function resolveShowSubscribeAgain(
  args: ResolveShowSubscribeAgainArgs
): Promise<boolean> {
  const customerId = stripeCustomerIdFromMetadata(args.publicMetadata);
  const base = {
    isNativeApp: args.isNativeApp,
    stripeCustomerId: customerId,
    publicMetadata: args.publicMetadata,
    appleGrantsAccess: false,
    lookupFailed: false,
    linkedSubscription: null as SummittSubscriptionLike | null,
    customerSubscriptions: [] as SummittSubscriptionLike[],
  };

  if (args.isNativeApp || !customerId) {
    return shouldShowSubscribeAgain(base);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return shouldShowSubscribeAgain({ ...base, lookupFailed: true });
  }

  try {
    const appleGrant = await resolveAppleMembershipGrantForUser(args.userId);
    if (appleGrant?.grantsAccess === true) {
      return shouldShowSubscribeAgain({ ...base, appleGrantsAccess: true });
    }

    const stripe = new Stripe(key);
    const linkedId = clerkStripeSubscriptionId(args.publicMetadata);
    let linkedSubscription: SummittSubscriptionLike | null = null;
    if (linkedId) {
      try {
        linkedSubscription = asMembershipLike(
          await stripe.subscriptions.retrieve(linkedId)
        );
      } catch (err) {
        if (!isStripeMissingError(err)) throw err;
        linkedSubscription = null;
      }
    }

    const listed = await stripe.subscriptions.list({
      customer: customerId,
      limit: 50,
    });
    const customerSubscriptions = listed.data.map(asMembershipLike);

    return shouldShowSubscribeAgain({
      ...base,
      linkedSubscription,
      customerSubscriptions,
    });
  } catch (err) {
    console.warn("[subscribe-again] eligibility lookup failed; hiding CTA", {
      userId: args.userId,
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return shouldShowSubscribeAgain({ ...base, lookupFailed: true });
  }
}
