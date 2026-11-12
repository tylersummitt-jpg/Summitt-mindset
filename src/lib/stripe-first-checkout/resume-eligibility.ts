import { unixFromIso } from "@/lib/stripe-first-checkout/hold-decision";

/**
 * Read-only decision for resumable Stripe-first activation.
 * No Stripe, Clerk, or database writes.
 */

export type ResumeStripeSnapshot = {
  subscriptionId: string;
  customerId: string;
  livemode: boolean;
  status: string;
  paused: boolean;
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  priceRecognized: boolean;
  checkoutIntentId: string | null;
  subscriptionUserId: string | null;
  canary: boolean;
  stripeFirst: boolean;
  customerDeleted: boolean;
  customerEmail: string | null;
  customerUserId: string | null;
};

export type ResumeIntentSnapshot = {
  id: string;
  livemode: boolean;
  email: string;
  customerId: string;
  subscriptionId: string;
  holdCancelAt: string | null;
  trialEndAt: string | null;
  sessionStarted: boolean;
  claimedByThisUser: boolean;
};

export type ResumeStripeDecision =
  | { outcome: "ready" }
  | { outcome: "preserved" }
  | { outcome: "conflict" };

function ourHoldUnix(intent: ResumeIntentSnapshot, trialEnd: number | null): number | null {
  return unixFromIso(intent.holdCancelAt) ?? trialEnd;
}

export function activationHoldIsOurs(
  intent: ResumeIntentSnapshot,
  stripe: ResumeStripeSnapshot
): boolean {
  if (stripe.cancelAtPeriodEnd || stripe.cancelAt == null) return false;
  const holdUnix = ourHoldUnix(intent, stripe.trialEnd);
  return holdUnix != null && stripe.cancelAt === holdUnix;
}

function customerCanceled(intent: ResumeIntentSnapshot, stripe: ResumeStripeSnapshot): boolean {
  if (stripe.status === "canceled" || stripe.status === "incomplete_expired") return true;
  if (stripe.cancelAtPeriodEnd) return true;
  if (stripe.cancelAt == null) return false;
  return !activationHoldIsOurs(intent, stripe);
}

function entitled(stripe: ResumeStripeSnapshot): boolean {
  return (stripe.status === "trialing" || stripe.status === "active") && !stripe.paused;
}

/**
 * Whether this subscription may be linked.
 * `ready` is the only outcome that permits writes.
 * A cleared hold is ready only after this user already claimed the intent,
 * so a fresh unpaid-looking trial cannot skip the hold check.
 */
export function decideResumeStripe(args: {
  intent: ResumeIntentSnapshot;
  stripe: ResumeStripeSnapshot;
  clerkUserId: string;
  nowUnix: number;
}): ResumeStripeDecision {
  const { intent, stripe } = args;
  if (stripe.canary || !stripe.stripeFirst) return { outcome: "conflict" };
  if (stripe.customerDeleted) return { outcome: "conflict" };
  if (!stripe.customerEmail || stripe.customerEmail !== intent.email) {
    return { outcome: "conflict" };
  }
  if (!metadataUserMatches(stripe.customerUserId, args.clerkUserId)) {
    return { outcome: "conflict" };
  }
  if (!metadataUserMatches(stripe.subscriptionUserId, args.clerkUserId)) {
    return { outcome: "conflict" };
  }
  if (stripe.livemode !== intent.livemode) return { outcome: "conflict" };
  if (stripe.subscriptionId !== intent.subscriptionId) return { outcome: "conflict" };
  if (stripe.customerId !== intent.customerId) return { outcome: "conflict" };
  if (stripe.checkoutIntentId !== intent.id) return { outcome: "conflict" };
  if (!stripe.priceRecognized) return { outcome: "conflict" };

  if (customerCanceled(intent, stripe)) return { outcome: "preserved" };

  if (!entitled(stripe)) return { outcome: "conflict" };
  if (stripe.status === "trialing") {
    if (stripe.trialEnd == null || stripe.trialEnd <= args.nowUnix) {
      return { outcome: "conflict" };
    }
  }

  const holdCleared =
    stripe.cancelAt == null &&
    !stripe.cancelAtPeriodEnd &&
    entitled(stripe);
  if (holdCleared) {
    return intent.sessionStarted && intent.claimedByThisUser
      ? { outcome: "ready" }
      : { outcome: "conflict" };
  }

  if (!activationHoldIsOurs(intent, stripe)) return { outcome: "preserved" };
  return { outcome: "ready" };
}

export function metadataUserMatches(
  metadataUserId: string | null,
  clerkUserId: string
): boolean {
  if (!metadataUserId) return true;
  return metadataUserId === clerkUserId;
}
