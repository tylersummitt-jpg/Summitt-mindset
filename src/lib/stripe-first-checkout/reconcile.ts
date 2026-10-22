import "server-only";

import Stripe from "stripe";

import { noteAcquisitionTrial } from "@/lib/acquisition/store";
import { META_CAPI_STRIPE_FIRST_SOURCE_URL } from "@/lib/meta-capi";
import { maybeEmitGoogleAdsTrial } from "@/lib/google-ads/stripe-conversions";
import {
  maybeEmitMetaStartTrialFromCheckout,
  metaStartTrialEventUnix,
} from "@/lib/meta-capi-stripe-conversions";
import { INTENT_METADATA_KEY } from "@/lib/stripe-first-checkout/constants";
import { stripeKeyMatchesLivemode } from "@/lib/stripe-first-checkout/credentials";
import { confirmStripeTrial, loadIntentById } from "@/lib/stripe-first-checkout/intent-store";
import {
  isOwnerCanaryMetadata,
  notifyConfirmedStripeFirstTrial,
} from "@/lib/stripe-first-checkout/member-notify";
import { reconcileActivationHold } from "@/lib/stripe-first-checkout/stripe-hold";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import { normalizeCheckoutEmail } from "@/lib/stripe-first-checkout/email-typo";
import { resolvePlanFromSubscription } from "@/lib/summitt-subscription-membership";

export type TrialProof =
  | {
      ok: true;
      email: string;
      customerId: string;
      subscriptionId: string;
      trialEndUnix: number;
      subscription: Stripe.Subscription;
    }
  | { ok: false; reason: "incomplete" | "rejected" | "retry" };

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  return new Stripe(key);
}

export function readCheckoutIntentId(
  metadata: Stripe.Metadata | null | undefined
): string | null {
  const value = metadata?.[INTENT_METADATA_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recognizedPrice(subscription: Stripe.Subscription): boolean {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return false;
  return getRecognizedSummittPriceIds().has(priceId);
}

/**
 * Provider proof for a Checkout Session. The success URL is not proof.
 * This does not create a Clerk user or start a session.
 */
export async function assessCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<TrialProof> {
  if (session.status !== "complete") return { ok: false, reason: "incomplete" };
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return { ok: false, reason: "rejected" };
  }
  if (session.mode !== "subscription") return { ok: false, reason: "rejected" };

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const email = normalizeCheckoutEmail(
    session.customer_details?.email || session.customer_email || ""
  );
  if (!subscriptionId || !customerId || !email) {
    return { ok: false, reason: "retry" };
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  } catch {
    return { ok: false, reason: "retry" };
  }

  if (subscription.livemode !== session.livemode) {
    return { ok: false, reason: "rejected" };
  }
  if (subscription.status !== "trialing" || subscription.trial_end == null) {
    return { ok: false, reason: "rejected" };
  }
  if (subscription.pause_collection != null) return { ok: false, reason: "rejected" };
  if (!recognizedPrice(subscription)) return { ok: false, reason: "rejected" };

  return {
    ok: true,
    email,
    customerId,
    subscriptionId,
    trialEndUnix: subscription.trial_end,
    subscription,
  };
}

export async function reconcileStripeFirstFromCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<"ack" | "retry"> {
  const intentId = readCheckoutIntentId(session.metadata);
  if (!intentId) return "ack";

  const intent = await loadIntentById(intentId);
  if (!intent) {
    console.error("[stripe-first] checkout intent missing", { intentId });
    return "ack";
  }
  if (session.livemode !== intent.livemode) {
    console.error("[stripe-first] checkout livemode does not match intent", { intentId });
    return "ack";
  }
  if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, intent.livemode)) {
    console.error("[stripe-first] server stripe key does not match intent", { intentId });
    return "ack";
  }
  if (
    intent.stripe_checkout_session_id &&
    intent.stripe_checkout_session_id !== session.id
  ) {
    console.error("[stripe-first] webhook session does not match stored checkout", {
      intentId,
    });
    return "ack";
  }

  const proof = await assessCheckoutSession(session);
  if (!proof.ok) return proof.reason === "retry" ? "retry" : "ack";

  const saved = await confirmStripeTrial({
    intentId,
    sessionId: session.id,
    customerId: proof.customerId,
    subscriptionId: proof.subscriptionId,
    email: proof.email,
    trialEndIso: new Date(proof.trialEndUnix * 1000).toISOString(),
  });
  if (saved === "mismatch") {
    console.error("[stripe-first] trial confirmation did not match intent", { intentId });
    return "ack";
  }

  const hold = await reconcileActivationHold(intentId);
  if (saved === "saved" || saved === "already") {
    const ownerCanary =
      isOwnerCanaryMetadata(session.metadata) ||
      isOwnerCanaryMetadata(proof.subscription.metadata);
    if (!ownerCanary) {
      try {
        const created = session.created;
        const clerkUserId = intent.clerk_user_id;
        await maybeEmitMetaStartTrialFromCheckout({
          subscription: proof.subscription,
          userId:
            typeof clerkUserId === "string" && clerkUserId.trim()
              ? clerkUserId.trim()
              : null,
          eventCreatedUnix: metaStartTrialEventUnix(
            proof.subscription,
            typeof created === "number" && Number.isFinite(created) ? created : 0
          ),
          eventSourceUrl: META_CAPI_STRIPE_FIRST_SOURCE_URL,
          webMatch: {
            fbc: intent.meta_fbc ?? null,
            fbp: intent.meta_fbp ?? null,
            clientIpAddress: intent.client_ip ?? null,
            clientUserAgent: intent.client_user_agent ?? null,
          },
        });
      } catch {
        console.warn("[stripe-first] Meta StartTrial isolated failure");
      }
      try {
        const created = session.created;
        await maybeEmitGoogleAdsTrial({
          subscription: proof.subscription,
          intent,
          eventCreatedUnix: metaStartTrialEventUnix(
            proof.subscription,
            typeof created === "number" && Number.isFinite(created) ? created : 0
          ),
        });
      } catch {
        console.warn("[stripe-first] Google Ads trial isolated failure");
      }
      try {
        await noteAcquisitionTrial({
          email: proof.email,
          clerkUserId: typeof intent.clerk_user_id === "string" ? intent.clerk_user_id : null,
          customerId: proof.customerId,
          subscriptionId: proof.subscriptionId,
          eventId: session.id,
        });
      } catch {
        console.warn("[stripe-first] acquisition trial link isolated failure");
      }
    }
    const notified = await notifyConfirmedStripeFirstTrial({
      ownerCanary,
      subscriptionStatus: proof.subscription.status,
      paused: proof.subscription.pause_collection != null,
      clerkUserId: intent.clerk_user_id,
      email: proof.email,
      name: session.customer_details?.name ?? null,
      phone: session.customer_details?.phone ?? null,
      customerId: proof.customerId,
      subscriptionId: proof.subscriptionId,
      checkoutSessionId: session.id,
      plan: resolvePlanFromSubscription(proof.subscription),
      timestamp: new Date().toISOString(),
    });
    if (notified === "failed") return "retry";
  }
  return hold === "retry" ? "retry" : "ack";
}

export async function reconcileStripeFirstSubscription(
  intentId: string
): Promise<"ack" | "retry"> {
  const hold = await reconcileActivationHold(intentId);
  return hold === "retry" ? "retry" : "ack";
}
