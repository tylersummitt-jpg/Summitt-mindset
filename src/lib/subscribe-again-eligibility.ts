import {
  classifySummittMembership,
  isCheckoutBlockedMembershipClass,
  isPausedFromPublicMetadata,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";

export const SUBSCRIBE_AGAIN_HREF = "/subscribe" as const;

export type SubscribeAgainFacts = {
  isNativeApp: boolean;
  stripeCustomerId: string | null | undefined;
  publicMetadata: Record<string, unknown> | null | undefined;
  appleGrantsAccess: boolean;
  lookupFailed: boolean;
  linkedSubscription: SummittSubscriptionLike | null;
  customerSubscriptions: readonly SummittSubscriptionLike[];
};

function clerkStripeCustomerId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeCustomerId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clerkIsSubscribed(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.summittSubscribed === true;
}

function hasBlockingSubscription(sub: SummittSubscriptionLike): boolean {
  return isCheckoutBlockedMembershipClass(classifySummittMembership(sub));
}

/**
 * Slice 1: /user "Subscribe Again" — fail closed.
 * Reuses Checkout duplicate-protection classes. Does not use
 * summittSubscribed === false as sufficient proof of ended.
 */
export function shouldShowSubscribeAgain(facts: SubscribeAgainFacts): boolean {
  if (facts.lookupFailed) return false;
  if (facts.isNativeApp) return false;
  if (facts.appleGrantsAccess) return false;
  if (isPausedFromPublicMetadata(facts.publicMetadata)) return false;
  if (clerkIsSubscribed(facts.publicMetadata)) return false;

  const customerId =
    typeof facts.stripeCustomerId === "string" && facts.stripeCustomerId.trim()
      ? facts.stripeCustomerId.trim()
      : clerkStripeCustomerId(facts.publicMetadata);
  if (!customerId) return false;

  if (facts.linkedSubscription && hasBlockingSubscription(facts.linkedSubscription)) {
    return false;
  }

  for (const sub of facts.customerSubscriptions) {
    if (hasBlockingSubscription(sub)) return false;
  }

  return true;
}

export function clerkStripeSubscriptionId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeSubscriptionId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
