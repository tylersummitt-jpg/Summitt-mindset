import {
  CANARY_METADATA_KEY,
  CANARY_METADATA_VALUE,
} from "@/lib/stripe-first-checkout/constants";
import {
  notifyMemberSubscribedInternal,
  type MemberNotifyOutcome,
  type MemberSubscriptionPlan,
  type NotifyMemberSubscribedInternalArgs,
} from "@/lib/notify-member-subscribed";

/**
 * Same key for the webhook and the browser return.
 * Resend keeps an idempotency key for 24 hours, so the second caller does not
 * create a second email after the first send is accepted.
 */
export function stripeFirstMemberNotifyKey(subscriptionId: string): string {
  return `stripe-first-member-${subscriptionId.trim()}`;
}

export function isOwnerCanaryMetadata(
  metadata: { [key: string]: string | undefined } | null | undefined
): boolean {
  return metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE;
}

export type StripeFirstMemberNotice = {
  ownerCanary: boolean;
  subscriptionStatus: string;
  paused: boolean;
  clerkUserId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  customerId: string;
  subscriptionId: string;
  checkoutSessionId: string;
  plan: MemberSubscriptionPlan;
  timestamp: string;
};

function filled(value: string | null | undefined, empty: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || empty;
}

/**
 * Send only after Stripe has an entitled subscription. An opened Checkout
 * Session, a paused subscription, and the owner canary are not new members.
 */
export function stripeFirstMemberNotification(
  args: StripeFirstMemberNotice
):
  | { send: false }
  | {
      send: true;
      payload: NotifyMemberSubscribedInternalArgs;
      idempotencyKey: string;
    } {
  const entitled =
    args.subscriptionStatus === "trialing" || args.subscriptionStatus === "active";
  const email = args.email.trim();
  const customerId = args.customerId.trim();
  const subscriptionId = args.subscriptionId.trim();
  const checkoutSessionId = args.checkoutSessionId.trim();
  if (
    args.ownerCanary ||
    args.paused ||
    !entitled ||
    !email ||
    !customerId ||
    !subscriptionId ||
    !checkoutSessionId
  ) {
    return { send: false };
  }

  return {
    send: true,
    idempotencyKey: stripeFirstMemberNotifyKey(subscriptionId),
    payload: {
      memberName: filled(args.name, "not provided"),
      memberEmail: email,
      memberPhone: filled(args.phone, "not provided"),
      clerkUserId: filled(args.clerkUserId, "not created yet"),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: args.subscriptionStatus,
      checkoutSessionId,
      plan: args.plan,
      timestamp: args.timestamp,
    },
  };
}

/**
 * One existing new-member email. Never throws.
 * "failed" is a temporary Resend problem. "skipped" is not retryable.
 */
export async function notifyConfirmedStripeFirstTrial(
  args: StripeFirstMemberNotice
): Promise<MemberNotifyOutcome> {
  const decision = stripeFirstMemberNotification(args);
  if (!decision.send) return "skipped";
  try {
    return await notifyMemberSubscribedInternal(decision.payload, {
      idempotencyKey: decision.idempotencyKey,
    });
  } catch (err) {
    console.warn("[stripe-first] member notification failed", err);
    return "failed";
  }
}
