/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const portalReturnUrl =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/dashboard";

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function POST() {
  try {
    if (!stripe) {
      return new NextResponse("Stripe not configured", { status: 500 });
    }

    // ✅ Auth
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const metadata = user.publicMetadata as any;

    const stripeCustomerId = metadata?.stripeCustomerId;

    // ✅ HARD GUARD
    if (!stripeCustomerId) {
      console.warn("No stripeCustomerId found for user:", userId);

      return NextResponse.json(
        {
          error:
            "Membership not fully linked yet. Please refresh in a few seconds.",
        },
        { status: 400 }
      );
    }

    // ✅ Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: portalReturnUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Customer portal error:", err);

    return NextResponse.json(
      { error: "Unable to open billing portal" },
      { status: 500 }
    );
  }
}
