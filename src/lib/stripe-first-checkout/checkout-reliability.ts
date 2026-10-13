import {
  classifySummittMembership,
  type SummittMembershipClass,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";
import {
  BINDING_MAX_AGE_SECONDS,
  PUBLIC_CHECKOUT_RETURN_PATH,
} from "@/lib/stripe-first-checkout/constants";

/** Existing memberships that must not receive the new trial. */
export type DuplicateTrialBlock = "apple" | "stripe" | "paused" | "past_due";

/**
 * A stored subscription id that Stripe no longer has is not a membership.
 * A failed or mismatched lookup is not proof that the membership is gone.
 */
export type StoredSubscriptionLookup =
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "found"; classification: SummittMembershipClass };

export function duplicateTrialBlockForClass(
  classification: SummittMembershipClass
): Exclude<DuplicateTrialBlock, "apple"> | null {
  if (classification === "entitled") return "stripe";
  if (classification === "paused_recoverable") return "paused";
  if (classification === "past_due_recoverable") return "past_due";
  return null;
}

export function entitlementFromStoredSubscription(
  lookup: StoredSubscriptionLookup
): Exclude<DuplicateTrialBlock, "apple"> | "retry" | null {
  if (lookup.kind === "unavailable") return "retry";
  if (lookup.kind === "missing") return null;
  return duplicateTrialBlockForClass(lookup.classification);
}

export function duplicateTrialBlockFromSubscription(
  subscription: SummittSubscriptionLike
): Exclude<DuplicateTrialBlock, "apple"> | null {
  return duplicateTrialBlockForClass(classifySummittMembership(subscription));
}

/** Where an authenticated person with a protected membership should land. */
export function duplicateTrialNextPath(block: DuplicateTrialBlock): string {
  if (block === "paused") return "/subscribe";
  return "/post-sign-in";
}

export type PriorSessionState = "open" | "complete" | "expired" | "unknown";

export type PriorCheckoutAction = "reuse" | "finish" | "replace" | "keep";

/**
 * A second start must not rotate the browser binding while an older Checkout
 * Session can still be paid. A payment that wins the expire race is "finish",
 * not "replace".
 */
export function priorCheckoutAction(args: {
  status: PriorSessionState;
  samePlan: boolean;
  hasUrl: boolean;
  expireResult?: PriorSessionState | "failed" | null;
}): PriorCheckoutAction {
  if (args.status === "complete") return "finish";
  if (args.status === "expired") return "replace";
  if (args.status === "unknown") return "keep";
  if (args.samePlan && args.hasUrl && args.expireResult == null) return "reuse";

  const after = args.expireResult;
  if (after === "complete") return "finish";
  if (after === "expired") return "replace";
  return "keep";
}

export function bindingMaxAgeSeconds(
  sessionExpiresAtUnix: number | null | undefined,
  nowMs: number
): number {
  if (sessionExpiresAtUnix == null || !Number.isFinite(sessionExpiresAtUnix)) {
    return BINDING_MAX_AGE_SECONDS;
  }
  const remaining = Math.floor(sessionExpiresAtUnix - nowMs / 1000);
  if (remaining < 60) return 60;
  return remaining;
}

/** Return URL carries the Checkout Session id only. The binding stays in the cookie. */
export function publicCheckoutFinishUrl(origin: string, sessionId: string): string {
  return `${origin}${PUBLIC_CHECKOUT_RETURN_PATH}?session_id=${encodeURIComponent(sessionId)}`;
}

/** Paid, no Clerk user, and not waiting on the email-code sign-in. */
export const STRANDED_NEW_CUSTOMER_GRACE_MS = 60 * 60 * 1000;

export function isStrandedNewCustomerIntent(args: {
  trialConfirmedAt: string | null;
  provisionedAt: string | null;
  signInRequiredAt: string | null;
  sessionStartedAt: string | null;
  trialEndAt: string | null;
  nowMs: number;
}): boolean {
  if (!args.trialConfirmedAt) return false;
  if (args.provisionedAt || args.signInRequiredAt || args.sessionStartedAt) return false;
  const confirmed = Date.parse(args.trialConfirmedAt);
  if (!Number.isFinite(confirmed)) return false;
  if (args.nowMs - confirmed < STRANDED_NEW_CUSTOMER_GRACE_MS) return false;
  if (!args.trialEndAt) return false;
  const trialEnd = Date.parse(args.trialEndAt);
  if (!Number.isFinite(trialEnd) || trialEnd <= args.nowMs) return false;
  return true;
}
