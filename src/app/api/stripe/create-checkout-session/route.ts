/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
const annualPriceId = process.env.STRIPE_PRICE_ID_ANNUAL;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY in env.");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type Plan = "monthly" | "annual";

const ALLOWED_SRC = new Set(["coach"]);

export async function POST(req: Request) {
  try {
    if (!stripe) {
      return new NextResponse(
        "Stripe is not configured. Check STRIPE_SECRET_KEY.",
        { status: 500 }
      );
    }

    // ✅ Canonical auth
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const user = await currentUser();
    const userEmail =
      user?.emailAddresses?.[0]?.emailAddress || null;

    if (!userEmail) {
      return new NextResponse(
        "Unable to determine user email for checkout",
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as Plan | undefined;
    const rawSrc = body?.src;
    const src =
      typeof rawSrc === "string" && ALLOWED_SRC.has(rawSrc) ? rawSrc : null;

    if (plan !== "monthly" && plan !== "annual") {
      return new NextResponse("Missing or invalid plan", { status: 400 });
    }

    if (src === "coach") {
      try {
        await updateClerkPublicMetadata(userId, {
          acquisitionSource: "coach",
        });
      } catch (err) {
        console.warn(
          "Unable to set acquisitionSource on checkout session:",
          err
        );
      }
    }

    const priceId = plan === "annual" ? annualPriceId : monthlyPriceId;

    if (!priceId) {
      return new NextResponse(
        "Stripe price ID not configured for this plan",
        { status: 500 }
      );
    }

    // 🔎 Check if we already have a Stripe customer ID saved
    const publicMetadata = await getClerkPublicMetadata(userId);
    const existingCustomerId =
      typeof publicMetadata?.stripeCustomerId === "string"
        ? publicMetadata.stripeCustomerId
        : null;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",

      client_reference_id: userId,

      line_items: [{ price: priceId, quantity: 1 }],

      allow_promotion_codes: true,

      // 🔥 Correct behavior for subscription mode
      customer: existingCustomerId || undefined,
      customer_email: existingCustomerId ? undefined : userEmail,

      metadata: {
        userId,
        plan,
      },

      subscription_data: {
        trial_period_days: 7,
        metadata: {
          userId,
          plan,
        },
      },

      success_url: `${appUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:
        src === "coach"
          ? `${appUrl}/subscribe?canceled=1&src=coach`
          : `${appUrl}/subscribe?canceled=1`,
    });

    if (!session.url) {
      return new NextResponse("Failed to create checkout session", {
        status: 500,
      });
    }

    // Optional: Pre-link customer id immediately
    const customerId =
      typeof session.customer === "string" ? session.customer : null;

    if (customerId && customerId !== existingCustomerId) {
      try {
        await updateClerkPublicMetadata(userId, {
          stripeCustomerId: customerId,
        });
      } catch (err) {
        console.warn("Unable to pre-link stripeCustomerId:", err);
      }
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
