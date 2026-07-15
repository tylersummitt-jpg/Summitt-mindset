/**
 * Narrow Summitt membership classification for Checkout duplicate prevention
 * and resume-membership. Pure helpers — no Stripe/Clerk I/O.
 */

export type SummittMembershipClass =
  | "entitled"
  | "past_due_recoverable"
  | "paused_recoverable"
  | "ended"
  | "other_non_blocking";

export type SummittPlanInterval = "monthly" | "annual" | "unknown";

/** Minimal shape so callers can pass Stripe.Subscription or test fixtures. */
export type SummittSubscriptionLike = {
  status: string;
  pause_collection?: unknown | null;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
        recurring?: { interval?: string | null } | null;
      } | null;
    }>;
  } | null;
  metadata?: Record<string, string> | null;
  customer?: string | { id?: string | null } | null;
};

export function hasPauseCollection(sub: SummittSubscriptionLike): boolean {
  return sub.pause_collection != null;
}

export function resolvePlanFromSubscription(
  sub: SummittSubscriptionLike
): SummittPlanInterval {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return "unknown";
}

/**
 * Product entitlement: active or trialing, and not billing-paused.
 * Aligned with webhook isSummittEntitledFromSubscription.
 */
export function isSummittEntitledFromSubscription(
  sub: SummittSubscriptionLike
): boolean {
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (hasPauseCollection(sub)) return false;
  return true;
}

export function classifySummittMembership(
  sub: SummittSubscriptionLike
): SummittMembershipClass {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    return "ended";
  }

  if (hasPauseCollection(sub)) {
    return "paused_recoverable";
  }

  if (sub.status === "active" || sub.status === "trialing") {
    return "entitled";
  }

  if (sub.status === "past_due") {
    return "past_due_recoverable";
  }

  return "other_non_blocking";
}

export function isCheckoutBlockedMembershipClass(
  classification: SummittMembershipClass
): boolean {
  return (
    classification === "entitled" ||
    classification === "past_due_recoverable" ||
    classification === "paused_recoverable"
  );
}

export function checkoutBlockErrorForClass(
  classification: SummittMembershipClass
):
  | {
      error: "membership_paused";
      action: "resume";
      message: string;
    }
  | {
      error: "already_subscribed";
      message: string;
    }
  | null {
  if (classification === "paused_recoverable") {
    return {
      error: "membership_paused",
      action: "resume",
      message:
        "Your membership is paused. Resume your existing membership instead of starting a new subscription.",
    };
  }
  if (
    classification === "entitled" ||
    classification === "past_due_recoverable"
  ) {
    return {
      error: "already_subscribed",
      message: "You already have an active Summitt Mindset membership.",
    };
  }
  return null;
}

/** Clerk-facing: membership is paused (may resume). */
export function isPausedFromPublicMetadata(metadata: unknown): boolean {
  if (metadata == null || typeof metadata !== "object") return false;
  const plan = (metadata as Record<string, unknown>).summittPlan;
  return plan === "paused";
}

export function customerIdFromSubscription(
  sub: SummittSubscriptionLike
): string | null {
  const c = sub.customer;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (c && typeof c === "object" && typeof c.id === "string" && c.id.trim()) {
    return c.id.trim();
  }
  return null;
}
