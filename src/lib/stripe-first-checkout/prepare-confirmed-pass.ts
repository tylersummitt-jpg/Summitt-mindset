import "server-only";

import Stripe from "stripe";

import { PREPARE_AFTER_ENV } from "@/lib/stripe-first-checkout/constants";
import { stripeKeyMatchesLivemode } from "@/lib/stripe-first-checkout/credentials";
import { decideHold } from "@/lib/stripe-first-checkout/hold-decision";
import {
  holdView,
  loadIntentById,
  loadPrepareEligibleIntents,
  markPrepareClosed,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";
import { prepareConfirmedCheckout } from "@/lib/stripe-first-checkout/activate";
import { recordSignupFailure } from "@/lib/stripe-first-checkout/signup-failures";
import { readPrepareAfterCutoff } from "@/lib/stripe-first-checkout/prepare-cutoff";
import {
  assessCheckoutSession,
  readCheckoutIntentId,
} from "@/lib/stripe-first-checkout/reconcile";
import {
  reconcileActivationHold,
  subscriptionHoldView,
} from "@/lib/stripe-first-checkout/stripe-hold";

const PREPARE_PASS_LIMIT = 10;

export type PreparePassResult = {
  examined: number;
  prepared: number;
  signInRequired: number;
  retry: number;
  preserved: number;
};

type IntentOutcome = "prepared" | "sign_in_required" | "retry" | "preserved" | "skipped";

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  return new Stripe(key);
}

function emptyResult(): PreparePassResult {
  return { examined: 0, prepared: 0, signInRequired: 0, retry: 0, preserved: 0 };
}

function stillUnprepared(intent: CheckoutBrowserIntent, cutoffIso: string, nowMs: number): boolean {
  const confirmedMs = Date.parse(intent.stripe_trial_confirmed_at ?? "");
  const cutoffMs = Date.parse(cutoffIso);
  const trialEndMs = Date.parse(intent.stripe_trial_end_at ?? "");
  if (!Number.isFinite(confirmedMs) || !Number.isFinite(cutoffMs) || !Number.isFinite(trialEndMs)) {
    return false;
  }
  if (confirmedMs <= cutoffMs) return false;
  if (trialEndMs <= nowMs) return false;
  if (!intent.stripe_subscription_id || !intent.stripe_checkout_session_id) return false;
  if (intent.clerk_user_provisioned_at || intent.sign_in_required_at) return false;
  if (intent.session_started_at || intent.hold_released_at || intent.prepare_closed_at) return false;
  return true;
}

function subscriptionEnded(subscription: Stripe.Subscription): boolean {
  return subscription.status === "canceled" || subscription.status === "incomplete_expired";
}

async function holdDuringPreparation(intentId: string) {
  try {
    return await reconcileActivationHold(intentId);
  } catch (err) {
    await recordSignupFailure({ intentId, step: "hold", error: err });
    throw err;
  }
}

async function closeTerminalPreparation(intentId: string): Promise<IntentOutcome> {
  let closed = false;
  try {
    closed = await markPrepareClosed(intentId);
  } catch (err) {
    await recordSignupFailure({ intentId, step: "prepare", error: err });
    return "retry";
  }
  if (closed) return "preserved";
  const fresh = await loadIntentById(intentId);
  if (fresh?.prepare_closed_at) return "preserved";
  if (
    fresh?.clerk_user_provisioned_at ||
    fresh?.sign_in_required_at ||
    fresh?.session_started_at ||
    fresh?.clerk_user_id ||
    fresh?.hold_released_at
  ) {
    return "skipped";
  }
  return "retry";
}

function holdProtectsOpenTrial(subscription: Stripe.Subscription, nowMs: number): boolean {
  return (
    subscription.status === "trialing" &&
    subscription.trial_end != null &&
    subscription.trial_end * 1000 > nowMs &&
    subscription.cancel_at === subscription.trial_end &&
    subscription.cancel_at_period_end !== true &&
    subscription.pause_collection == null
  );
}

async function prepareEligibleIntent(
  intentId: string,
  cutoffIso: string,
  nowMs: number
): Promise<IntentOutcome> {
  const intent = await loadIntentById(intentId);
  if (!intent || !stillUnprepared(intent, cutoffIso, nowMs)) return "skipped";
  if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, intent.livemode)) return "retry";

  const sessionId = intent.stripe_checkout_session_id;
  const subscriptionId = intent.stripe_subscription_id;
  if (!sessionId || !subscriptionId) return "skipped";

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.retrieve(sessionId);
  } catch (err) {
    await recordSignupFailure({ intentId, step: "prepare", error: err });
    return "retry";
  }
  if (session.id !== sessionId || session.livemode !== intent.livemode) return "skipped";
  if (readCheckoutIntentId(session.metadata) !== intent.id) return "skipped";

  const proof = await assessCheckoutSession(session);
  if (!proof.ok) {
    if (proof.reason !== "rejected") return proof.reason === "retry" ? "retry" : "skipped";
    let rejectedSubscription: Stripe.Subscription;
    try {
      rejectedSubscription = await stripeClient().subscriptions.retrieve(subscriptionId);
    } catch (err) {
      await recordSignupFailure({ intentId, step: "prepare", error: err });
      return "retry";
    }
    if (
      rejectedSubscription.id !== subscriptionId ||
      rejectedSubscription.livemode !== intent.livemode
    ) {
      return "skipped";
    }
    if (subscriptionEnded(rejectedSubscription)) return closeTerminalPreparation(intent.id);
    return "skipped";
  }
  if (proof.subscriptionId !== subscriptionId) return "skipped";
  if (intent.stripe_customer_id && proof.customerId !== intent.stripe_customer_id) return "skipped";
  if (proof.subscription.trial_end == null || proof.subscription.trial_end * 1000 <= nowMs) {
    return "skipped";
  }

  const beforeHold = await loadIntentById(intent.id);
  if (!beforeHold || beforeHold.session_started_at || beforeHold.hold_released_at) return "skipped";

  const hold = await holdDuringPreparation(intent.id);
  if (hold === "preserved") {
    let preservedSubscription: Stripe.Subscription;
    try {
      preservedSubscription = await stripeClient().subscriptions.retrieve(subscriptionId);
    } catch (err) {
      await recordSignupFailure({ intentId, step: "prepare", error: err });
      return "retry";
    }
    const latest = await loadIntentById(intent.id);
    if (!latest || !stillUnprepared(latest, cutoffIso, nowMs)) return "skipped";
    const decision = decideHold(holdView(latest), subscriptionHoldView(preservedSubscription));
    if (decision.action === "preserve_cancellation") return closeTerminalPreparation(latest.id);
    return "retry";
  }
  if (hold !== "ok") return "retry";

  const protectedSubscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  if (!holdProtectsOpenTrial(protectedSubscription, nowMs)) return "retry";

  const current = await loadIntentById(intent.id);
  if (!current || !stillUnprepared(current, cutoffIso, nowMs)) return "skipped";

  const prepared = await prepareConfirmedCheckout(current, proof.email, proof);
  if (prepared.status === "prepared") return "prepared";
  if (prepared.status === "sign_in_required") return "sign_in_required";
  if (prepared.status === "rejected") return closeTerminalPreparation(current.id);
  return "retry";
}

/**
 * One bounded page of confirmed trials that still need an account.
 * A failure on one intent does not stop the rest of the page.
 */
export async function runConfirmedCheckoutPreparationPass(
  nowMs = Date.now()
): Promise<PreparePassResult> {
  const cutoff = readPrepareAfterCutoff(process.env[PREPARE_AFTER_ENV]);
  if (!cutoff) return emptyResult();

  const result = emptyResult();
  const candidates = await loadPrepareEligibleIntents(cutoff, PREPARE_PASS_LIMIT, new Date(nowMs).toISOString());
  for (const candidate of candidates) {
    result.examined += 1;
    try {
      const outcome = await prepareEligibleIntent(candidate.id, cutoff, nowMs);
      if (outcome === "prepared") result.prepared += 1;
      else if (outcome === "sign_in_required") result.signInRequired += 1;
      else if (outcome === "retry") result.retry += 1;
      else if (outcome === "preserved") result.preserved += 1;
    } catch (err) {
      result.retry += 1;
      await recordSignupFailure({ intentId: candidate.id, step: "prepare", error: err });
      console.error("[stripe-first] preparation pass intent failed", {
        intentId: candidate.id,
        reason: err instanceof Error ? err.message : "prepare_failed",
      });
    }
  }
  return result;
}
