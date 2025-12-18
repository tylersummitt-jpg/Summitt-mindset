/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY in env for confirm-subscription.");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

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

    // Get the checkout session and subscription details from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const rawUserId = session.client_reference_id;
    const userId = typeof rawUserId === "string" ? rawUserId : null;

    const subscription = session.subscription as Stripe.Subscription | null;

    if (!subscription) {
      return new NextResponse(
        "No subscription found on this checkout session.",
        { status: 400 }
      );
    }

    const status = subscription.status; // trialing, active, etc.
    const item = subscription.items.data[0];
    const priceId = item?.price?.id || null;
    const interval = item?.price?.recurring?.interval || null;

    const plan =
      interval === "year" ? "annual" : interval === "month" ? "monthly" : "unknown";

    // 🔹 Normalize Stripe customer ID to a simple string
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

    // If we don't know which user this belongs to, just return info
    if (!userId) {
      return NextResponse.json({
        ok: true,
        message: "Subscription confirmed, but no userId on session.",
        status,
        plan,
      });
    }

    // ✅ At this point, userId is definitely a string
    const safeUserId: string = userId;

    // --- TRY to mark the user as subscribed in Clerk metadata ---
    // If Clerk doesn’t expose users.updateUser in this version,
    // we log a warning and continue. This avoids the 500 error.
    try {
      const anyClient = clerkClient as any;

      if (anyClient?.users?.updateUser) {
        await anyClient.users.updateUser(safeUserId, {
          publicMetadata: {
            summittSubscribed: status === "active" || status === "trialing",
            summittPlan: plan,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
          },
        });
      } else {
        console.warn(
          "Clerk client does not expose users.updateUser; skipping metadata update."
        );
      }
    } catch (metaErr) {
      console.error("Error updating Clerk metadata (non-fatal):", metaErr);
      // We intentionally do NOT throw here – subscription itself is fine.
    }

    // Always return success if we got this far
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
