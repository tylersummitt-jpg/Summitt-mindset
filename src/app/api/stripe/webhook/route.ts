/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!stripeSecretKey) console.warn("Missing STRIPE_SECRET_KEY");
if (!webhookSecret) console.warn("Missing STRIPE_WEBHOOK_SECRET");
if (!clerkSecretKey) console.warn("Missing CLERK_SECRET_KEY");

// ✅ DO NOT set apiVersion (avoids TS conflicts)
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function POST(req: NextRequest) {
  if (!stripe || !webhookSecret || !clerkSecretKey) {
    console.error("Webhook not fully configured");
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    console.error("Missing Stripe signature");
    return new NextResponse("Missing Stripe signature", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("❌ Invalid Stripe webhook signature:", err.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    // ✅ SINGLE SOURCE OF TRUTH
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId = session.client_reference_id;
      if (!userId) {
        console.warn("checkout.session.completed missing client_reference_id");
        return NextResponse.json({ received: true });
      }

      if (typeof session.subscription !== "string") {
        console.warn("checkout.session.completed missing subscription");
        return NextResponse.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription
      );

      const item = subscription.items.data[0];
      const interval = item?.price?.recurring?.interval;

      const plan =
        interval === "year"
          ? "annual"
          : interval === "month"
          ? "monthly"
          : "unknown";

      const subscribed =
        subscription.status === "active" ||
        subscription.status === "trialing";

      console.log("✅ Checkout completed → updating Clerk", {
        userId,
        subscribed,
        plan,
      });

      await updateClerkMetadata(userId, {
        summittSubscribed: subscribed,
        summittPlan: plan,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : null,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("🔥 Webhook processing error:", err);
    return new NextResponse("Webhook error", { status: 500 });
  }
}

async function updateClerkMetadata(
  userId: string,
  publicMetadata: Record<string, any>
) {
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
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

  console.log("✅ Clerk metadata updated for user:", userId);
}
