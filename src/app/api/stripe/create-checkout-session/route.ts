/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
const annualPriceId = process.env.STRIPE_PRICE_ID_ANNUAL;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY in env.");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function POST(req: Request) {
  try {
    if (!stripe) {
      return new NextResponse(
        "Stripe is not configured. Check STRIPE_SECRET_KEY.",
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { plan, userId } = body as {
      plan?: "monthly" | "annual";
      userId?: string | null;
    };

    if (!plan) {
      return new NextResponse("Missing plan", { status: 400 });
    }

    if (!userId) {
      return new NextResponse("Missing userId", { status: 400 });
    }

    const priceId = plan === "annual" ? annualPriceId : monthlyPriceId;

    if (!priceId) {
      return new NextResponse(
        "Stripe price ID not configured for this plan",
        { status: 500 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: userId,

      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      allow_promotion_codes: true,

      subscription_data: {
        trial_period_days: 7,

        // 🔥 THIS IS THE FIX 🔥
        metadata: {
          userId,
        },
      },

      success_url: `${appUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe?canceled=1`,
    });

    if (!session.url) {
      return new NextResponse(
        "Failed to create checkout session",
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Error creating checkout session:", err);
    return new NextResponse(
      "Internal Server Error creating checkout session",
      { status: 500 }
    );
  }
}
