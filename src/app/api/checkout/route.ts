import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // ✅ Do NOT set apiVersion
  // Stripe uses your account’s pinned version automatically
});

export async function POST() {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID!,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/success`,
      cancel_url: `${baseUrl}/subscribe`,
    });

    // ✅ Preserve your existing redirect behavior
    return NextResponse.redirect(session.url!, { status: 303 });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return new NextResponse("Stripe checkout failed", { status: 500 });
  }
}
