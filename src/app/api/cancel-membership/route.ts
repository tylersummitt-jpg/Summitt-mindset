import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey);

export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metadata = user.publicMetadata as any;
  const subscriptionId = metadata?.stripeSubscriptionId;

  if (!subscriptionId) {
    return NextResponse.json(
      { error: "Subscription not found." },
      { status: 400 }
    );
  }

  const { reasonCode, message } = await req.json();

  // ======================================================
  // ✅ 1. LOG CHURN TRUTH (Stream C — Highest Signal)
  // ======================================================
  await supabaseServer.from("feedback_events").insert({
    clerk_user_id: userId,
    source: "cancel_flow",
    moment: "cancel_attempt",
    type: "churn",

    rating: null,
    sentiment: null,

    reason_code: reasonCode,
    message: message || null,

    share_permission: false,
    metadata: { canonical: true },
  });

  // ======================================================
  // ✅ 2. CANCEL STRIPE SUBSCRIPTION
  // ======================================================
  await stripe.subscriptions.cancel(subscriptionId);

  // ======================================================
  // ✅ 3. IMMEDIATE CLERK LOCK (Do NOT wait for webhook)
  // ======================================================
  await updateClerkPublicMetadata(userId, {
    summittSubscribed: false,
    summittPlan: null,
  });

  await syncSmsAudience({
    userId,
    phoneNumber: metadata?.phoneNumber ?? null,
    smsEnabled: metadata?.smsEnabled ?? null,
    timezone: metadata?.timezone ?? null,
    smsTimePreference: metadata?.smsTimePreference ?? null,
    summittSubscribed: false,
  });

  return NextResponse.json({ ok: true });
}
