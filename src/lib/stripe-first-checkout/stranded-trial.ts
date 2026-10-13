import "server-only";

import Stripe from "stripe";

import {
  CANARY_METADATA_KEY,
  CANARY_METADATA_VALUE,
  STRANDED_ALERTED_METADATA_KEY,
} from "@/lib/stripe-first-checkout/constants";
import { isStrandedNewCustomerIntent } from "@/lib/stripe-first-checkout/checkout-reliability";
import {
  loadUnprovisionedPaidIntents,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";
import { notifyStrandedStripeTrial } from "@/lib/stripe-first-checkout/unprotected-alert";

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

async function considerStrandedIntent(
  stripe: Stripe,
  intent: CheckoutBrowserIntent,
  nowMs: number
): Promise<boolean> {
  if (
    !isStrandedNewCustomerIntent({
      trialConfirmedAt: intent.stripe_trial_confirmed_at,
      provisionedAt: intent.clerk_user_provisioned_at,
      signInRequiredAt: intent.sign_in_required_at,
      sessionStartedAt: intent.session_started_at,
      trialEndAt: intent.stripe_trial_end_at,
      nowMs,
    })
  ) {
    return false;
  }
  if (!intent.stripe_subscription_id) return false;
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(intent.stripe_subscription_id);
  } catch {
    return false;
  }
  if (subscription.metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE) return false;
  if (subscription.metadata?.[STRANDED_ALERTED_METADATA_KEY] === intent.id) return false;
  if (typeof subscription.metadata?.userId === "string" && subscription.metadata.userId) {
    return false;
  }
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    return false;
  }
  const alerted = await notifyStrandedStripeTrial({
    intentId: intent.id,
    subscriptionId: intent.stripe_subscription_id,
    livemode: intent.livemode,
    trialEndAt: intent.stripe_trial_end_at,
  });
  if (!alerted) return false;
  try {
    await stripe.subscriptions.update(intent.stripe_subscription_id, {
      metadata: { [STRANDED_ALERTED_METADATA_KEY]: intent.id },
    });
    return true;
  } catch (err) {
    console.error("[stripe-first] stranded alert mark failed", {
      intentId: intent.id,
      reason: err instanceof Error ? err.message : "mark_failed",
    });
    return false;
  }
}

/**
 * Hourly scan of checkout intents. Alerts once, before trial end, when a paid
 * trial never became an account. Email-code sign-ins are excluded.
 */
export async function alertStrandedNewCustomerTrials(nowMs = Date.now()): Promise<number> {
  const stripe = stripeClient();
  if (!stripe) return 0;
  let sent = 0;
  for (let offset = 0; offset < 250 && sent < 20; offset += 50) {
    const rows = await loadUnprovisionedPaidIntents(offset);
    if (rows.length === 0) break;
    for (const intent of rows) {
      if (sent >= 20) break;
      if (await considerStrandedIntent(stripe, intent, nowMs)) sent += 1;
    }
    if (rows.length < 50) break;
  }
  return sent;
}
