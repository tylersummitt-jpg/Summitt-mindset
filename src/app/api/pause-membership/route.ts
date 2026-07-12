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

  // ======================================================
  // ✅ 1. LOG PAUSE SAVE MOMENT (Retention Signal)
  // ======================================================
  await supabaseServer.from("feedback_events").insert({
    clerk_user_id: userId,
    source: "cancel_flow",
    moment: "pause_offer_accepted",
    type: "churn",

    reason_code: "pause_instead",
    message: null,

    share_permission: false,
    metadata: { canonical: true },
  });

  // ======================================================
  // ✅ 2. PAUSE STRIPE SUBSCRIPTION (No billing)
  // ======================================================
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: "mark_uncollectible",
    },
  });

  // ======================================================
  // ✅ 3. IMMEDIATE CLERK LOCK (Paused State)
  // ======================================================
  await updateClerkPublicMetadata(userId, {
    summittSubscribed: false,
    summittPlan: "paused",
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
