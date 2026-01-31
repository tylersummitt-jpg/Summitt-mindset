/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!stripeSecretKey) console.warn("Missing STRIPE_SECRET_KEY");
if (!webhookSecret) console.warn("Missing STRIPE_WEBHOOK_SECRET");
if (!clerkSecretKey) console.warn("Missing CLERK_SECRET_KEY");

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

/**
 * ======================================================
 * Clerk Metadata Patch (Single Source of Truth)
 * ======================================================
 */
async function updateClerkMetadata(
  userId: string,
  publicMetadata: Record<string, any>
) {
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      public_metadata: publicMetadata,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ Clerk metadata update failed:", text);
    throw new Error(text);
  }

  console.log("✅ Clerk metadata updated:", userId);
}

/**
 * ======================================================
 * STRIPE WEBHOOK (CANONICAL MEMBERSHIP TRUTH)
 * ======================================================
 */
export async function POST(req: NextRequest) {
  if (!stripe || !webhookSecret || !clerkSecretKey) {
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new NextResponse("Missing Stripe signature", { status: 400 });
  }

  let event: Stripe.Event;

  // ✅ Verify webhook signature
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("❌ Invalid webhook signature:", err.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    /**
     * ======================================================
     * ✅ EVENT 1 — Checkout Completed (Initial Purchase)
     * ======================================================
     */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId = session.client_reference_id;
      if (!userId) return NextResponse.json({ received: true });

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : null;

      const customerId =
        typeof session.customer === "string" ? session.customer : null;

      if (!subscriptionId || !customerId) {
        console.warn("Missing subscription/customer on checkout");
        return NextResponse.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      const interval =
        subscription.items.data[0]?.price?.recurring?.interval;

      const plan =
        interval === "year"
          ? "annual"
          : interval === "month"
          ? "monthly"
          : "unknown";

      await updateClerkMetadata(userId, {
        summittSubscribed: true,
        summittPlan: plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
    }

    /**
     * ======================================================
     * ✅ EVENT 2 — Subscription Updated
     * ======================================================
     */
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;

      const userId = subscription.metadata?.userId;
      if (!userId) return NextResponse.json({ received: true });

      const status = subscription.status;

      const interval =
        subscription.items.data[0]?.price?.recurring?.interval;

      const plan =
        interval === "year"
          ? "annual"
          : interval === "month"
          ? "monthly"
          : "unknown";

      await updateClerkMetadata(userId, {
        summittSubscribed: status === "active" || status === "trialing",
        summittPlan: plan,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : null,
        stripeSubscriptionId: subscription.id,
      });
    }

    /**
     * ======================================================
     * ✅ EVENT 3 — Subscription Deleted (Canceled)
     * ======================================================
     */
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;

      const userId = subscription.metadata?.userId;
      if (!userId) return NextResponse.json({ received: true });

      console.log("🚫 Subscription canceled → locking access", userId);

      await updateClerkMetadata(userId, {
        summittSubscribed: false,
        summittPlan: null,
      });
    }

    /**
     * ======================================================
     * ✅ EVENT 4 — Payment Failed
     * ======================================================
     */
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string;
      };

      const subscriptionId = invoice.subscription;
      if (!subscriptionId) return NextResponse.json({ received: true });

      const subscription =
        await stripe.subscriptions.retrieve(subscriptionId);

      const userId = subscription.metadata?.userId;
      if (!userId) return NextResponse.json({ received: true });

      console.log("⚠️ Payment failed → locking access", userId);

      await updateClerkMetadata(userId, {
        summittSubscribed: false,
      });
    }

    /**
     * ======================================================
     * ✅ EVENT 5 — Payment Restored
     * ======================================================
     */
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string;
      };

      const subscriptionId = invoice.subscription;
      if (!subscriptionId) return NextResponse.json({ received: true });

      const subscription =
        await stripe.subscriptions.retrieve(subscriptionId);

      const userId = subscription.metadata?.userId;
      if (!userId) return NextResponse.json({ received: true });

      console.log("✅ Payment restored → unlocking access", userId);

      await updateClerkMetadata(userId, {
        summittSubscribed: true,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("🔥 Webhook processing error:", err);
    return new NextResponse("Webhook error", { status: 500 });
  }
}
