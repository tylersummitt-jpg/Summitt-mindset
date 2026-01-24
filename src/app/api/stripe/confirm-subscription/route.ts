/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY in env.");
}
if (!clerkSecretKey) {
  console.warn("Missing CLERK_SECRET_KEY in env.");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

async function updateClerkMetadata(userId: string, metadata: any) {
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ public_metadata: metadata }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clerk PATCH failed: ${text}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!stripe) {
      return new NextResponse(
        "Stripe is not configured. Check STRIPE_SECRET_KEY.",
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { sessionId } = body as { sessionId?: string };

    if (!sessionId) {
      return new NextResponse("Missing sessionId", { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const userId =
      typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null;

    const subscription = session.subscription as Stripe.Subscription | null;
    if (!subscription) {
      return new NextResponse("No subscription found.", { status: 400 });
    }

    const status = subscription.status;
    const item = subscription.items.data[0];
    const priceId = item?.price?.id || null;
    const interval = item?.price?.recurring?.interval || null;

    const plan =
      interval === "year"
        ? "annual"
        : interval === "month"
        ? "monthly"
        : "unknown";

    let stripeCustomerId: string | null = null;
    if (typeof session.customer === "string") {
      stripeCustomerId = session.customer;
    } else if (
      session.customer &&
      typeof (session.customer as any).id === "string"
    ) {
      stripeCustomerId = (session.customer as any).id;
    }

    console.log("Confirmed Stripe subscription:", {
      userId,
      status,
      plan,
      priceId,
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
    });

    if (userId && clerkSecretKey) {
      await updateClerkMetadata(userId, {
        summittSubscribed: status === "active" || status === "trialing",
        summittPlan: plan,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
      });
    }

    return NextResponse.json({
      ok: true,
      status,
      plan,
    });
  } catch (err: any) {
    console.error("Error confirming subscription:", err);
    return new NextResponse(
      "Internal Server Error confirming subscription",
      { status: 500 }
    );
  }
}
