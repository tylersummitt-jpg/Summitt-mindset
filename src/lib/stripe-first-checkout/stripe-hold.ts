import "server-only";

import Stripe from "stripe";

import {
  HOLD_METADATA_KEY,
  INTENT_METADATA_KEY,
  UNPROTECTED_ALERTED_METADATA_KEY,
} from "@/lib/stripe-first-checkout/constants";
import { stripeKeyMatchesLivemode } from "@/lib/stripe-first-checkout/credentials";
import {
  decideHold,
  unprotectedAlertAlreadySent,
  type HoldSubscriptionView,
} from "@/lib/stripe-first-checkout/hold-decision";
import { notifyUnprotectedStripeTrial } from "@/lib/stripe-first-checkout/unprotected-alert";
import {
  holdView,
  loadIntentById,
  markHoldConfirmed,
  markHoldConfirmedAndReleased,
  markHoldReleased,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";

export type HoldReconcileResult = "ok" | "retry" | "preserved" | "unprotected";

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  return new Stripe(key);
}

export function subscriptionHoldView(sub: Stripe.Subscription): HoldSubscriptionView {
  return {
    status: sub.status,
    cancelAt: sub.cancel_at,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEnd: sub.trial_end,
    paused: sub.pause_collection != null,
  };
}

export function logUnprotectedTrial(args: {
  intentId: string;
  subscriptionId: string;
  livemode: boolean;
}) {
  console.error("[stripe-first] unprotected trial", {
    intentId: args.intentId,
    subscriptionId: args.subscriptionId,
    livemode: args.livemode,
  });
}

/**
 * One staff email per intent. Metadata records the send. It does not record a hold
 * and it does not change cancel_at.
 */
async function alertUnprotectedOnce(
  intent: CheckoutBrowserIntent,
  sub: Stripe.Subscription
) {
  if (!intent.stripe_subscription_id) return;
  if (sub.status === "canceled" || sub.cancel_at_period_end) return;
  if (unprotectedAlertAlreadySent(sub.metadata, intent.id)) return;
  logUnprotectedTrial({
    intentId: intent.id,
    subscriptionId: intent.stripe_subscription_id,
    livemode: intent.livemode,
  });
  try {
    const sent = await notifyUnprotectedStripeTrial({
      intentId: intent.id,
      subscriptionId: intent.stripe_subscription_id,
      livemode: intent.livemode,
    });
    if (!sent) return;
    const fresh = await stripeClient().subscriptions.retrieve(intent.stripe_subscription_id);
    if (fresh.status === "canceled" || fresh.cancel_at_period_end) return;
    await stripeClient().subscriptions.update(intent.stripe_subscription_id, {
      metadata: { [UNPROTECTED_ALERTED_METADATA_KEY]: intent.id },
    });
  } catch (err) {
    console.error("[stripe-first] unprotected trial alert failed", {
      intentId: intent.id,
      subscriptionId: intent.stripe_subscription_id,
      reason: err instanceof Error ? err.message : "alert_failed",
    });
  }
}

async function clearHoldOnStripe(subscriptionId: string): Promise<Stripe.Subscription> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  const body = new URLSearchParams();
  body.set("cancel_at", "");
  body.set(`metadata[${HOLD_METADATA_KEY}]`, "");
  const res = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );
  if (!res.ok) throw new Error("stripe_clear_hold_failed");
  return stripeClient().subscriptions.retrieve(subscriptionId);
}

function holdStillOurs(sub: Stripe.Subscription, cancelAt: number): boolean {
  return sub.cancel_at === cancelAt && sub.cancel_at_period_end !== true && sub.status !== "canceled";
}

function releasedReadback(sub: Stripe.Subscription): boolean {
  return (
    sub.cancel_at == null &&
    sub.cancel_at_period_end !== true &&
    (sub.status === "trialing" || sub.status === "active") &&
    sub.pause_collection == null
  );
}

async function compensateClear(
  intent: CheckoutBrowserIntent,
  cancelAt: number
): Promise<HoldReconcileResult> {
  const current = await stripeClient().subscriptions.retrieve(intent.stripe_subscription_id!);
  if (!holdStillOurs(current, cancelAt)) return "preserved";
  const fresh = await clearHoldOnStripe(intent.stripe_subscription_id!);
  if (!releasedReadback(fresh)) return "retry";
  const holdIso = new Date(cancelAt * 1000).toISOString();
  if (intent.hold_confirmed_at) {
    await markHoldReleased(intent.id);
  } else if (intent.session_started_at) {
    await markHoldConfirmedAndReleased({
      intentId: intent.id,
      holdCancelAtIso: holdIso,
    });
  }
  return "ok";
}

export async function reconcileActivationHold(
  intentId: string
): Promise<HoldReconcileResult> {
  const intent = await loadIntentById(intentId);
  if (!intent?.stripe_subscription_id) return "ok";
  if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, intent.livemode)) {
    console.error("[stripe-first] stripe key mode does not match intent", {
      intentId: intent.id,
      livemode: intent.livemode,
    });
    return "ok";
  }

  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(intent.stripe_subscription_id);
  const decision = decideHold(holdView(intent), subscriptionHoldView(sub));

  if (decision.action === "wait") return "ok";
  if (decision.action === "preserve_cancellation") return "preserved";

  if (decision.action === "unprotected") {
    await alertUnprotectedOnce(intent, sub);
    return "unprotected";
  }

  if (decision.action === "record_hold") {
    await markHoldConfirmed({
      intentId: intent.id,
      holdCancelAtIso: new Date(decision.cancelAt * 1000).toISOString(),
      allowAfterSession: false,
    });
    return "ok";
  }

  if (decision.action === "apply") {
    await stripe.subscriptions.update(intent.stripe_subscription_id, {
      cancel_at: decision.cancelAt,
      metadata: {
        [HOLD_METADATA_KEY]: String(decision.cancelAt),
        [INTENT_METADATA_KEY]: intent.id,
      },
    });
    const fresh = await stripe.subscriptions.retrieve(intent.stripe_subscription_id);
    if (fresh.cancel_at !== decision.cancelAt) {
      await alertUnprotectedOnce(intent, fresh);
      return "retry";
    }
    const wrote = await markHoldConfirmed({
      intentId: intent.id,
      holdCancelAtIso: new Date(decision.cancelAt * 1000).toISOString(),
      allowAfterSession: false,
    });
    if (!wrote) {
      const latest = await loadIntentById(intent.id);
      if (latest?.session_started_at || latest?.hold_released_at) {
        return compensateClear(latest, decision.cancelAt);
      }
    }
    return "ok";
  }

  if (decision.action === "mark_released") {
    const fresh = await stripe.subscriptions.retrieve(intent.stripe_subscription_id);
    if (!releasedReadback(fresh)) return "retry";
    await markHoldReleased(intent.id);
    return "ok";
  }

  if (decision.action === "release") {
    if (!intent.session_started_at) return "ok";
    const holdUnix = intent.stripe_hold_cancel_at
      ? Math.floor(Date.parse(intent.stripe_hold_cancel_at) / 1000)
      : sub.cancel_at;
    const current = await stripe.subscriptions.retrieve(intent.stripe_subscription_id);
    if (
      holdUnix == null ||
      current.status === "canceled" ||
      current.cancel_at_period_end ||
      current.cancel_at !== holdUnix
    ) {
      return "preserved";
    }
    const fresh = await clearHoldOnStripe(intent.stripe_subscription_id);
    if (fresh.status === "canceled" || fresh.cancel_at_period_end) return "preserved";
    if (fresh.cancel_at != null) return "retry";
    if (!releasedReadback(fresh)) return "retry";
    if (!intent.hold_confirmed_at) {
      await markHoldConfirmedAndReleased({
        intentId: intent.id,
        holdCancelAtIso: new Date(holdUnix * 1000).toISOString(),
      });
    } else {
      await markHoldReleased(intent.id);
    }
    return "ok";
  }

  if (decision.action === "compensate_clear") {
    return compensateClear(intent, decision.cancelAt);
  }

  return "ok";
}
