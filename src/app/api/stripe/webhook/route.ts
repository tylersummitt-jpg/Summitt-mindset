/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";

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
 * Helpers
 * ======================================================
 */

function resolvePlanFromSubscription(
  sub: Stripe.Subscription
): "monthly" | "annual" | "unknown" {
  const interval = sub.items.data[0]?.price?.recurring?.interval;

  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return "unknown";
}

function isActiveStatus(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "trialing";
}

/**
 * Robustly find Clerk userId for a subscription event.
 *
 * Priority order:
 * 1) subscription.metadata.userId
 * 2) customer.metadata.userId
 * 3) checkout session lookup by subscription id
 */
async function resolveUserIdForSubscription(
  subscription: Stripe.Subscription
): Promise<string | null> {
  // 1) subscription metadata
  const mdUserId = subscription.metadata?.userId;
  if (typeof mdUserId === "string" && mdUserId.trim()) return mdUserId.trim();

  // 2) customer metadata
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;

  if (customerId) {
    try {
      const customer = await stripe!.customers.retrieve(customerId);

      // Stripe can return DeletedCustomer
      if ((customer as any)?.deleted) {
        return null;
      }

      const cUserId = (customer as Stripe.Customer)?.metadata?.userId;
      if (typeof cUserId === "string" && cUserId.trim()) return cUserId.trim();
    } catch (err) {
      console.warn("Unable to retrieve customer for userId lookup:", err);
    }
  }

  // 3) checkout session search by subscription
  try {
    const sessions = await stripe!.checkout.sessions.list({
      subscription: subscription.id,
      limit: 1,
    });

    const s = sessions.data?.[0];

    const sessionUserId =
      typeof s?.client_reference_id === "string" ? s.client_reference_id : null;

    if (sessionUserId && sessionUserId.trim()) return sessionUserId.trim();

    const metaUserId = (s?.metadata as any)?.userId;
    if (typeof metaUserId === "string" && metaUserId.trim())
      return metaUserId.trim();
  } catch (err) {
    console.warn("Unable to list checkout sessions for subscription:", err);
  }

  return null;
}

/**
 * Stripe Invoice typing can vary by Stripe SDK version and invoice shape.
 * We extract subscription id robustly without relying on invoice.subscription typing.
 *
 * Priority:
 * 1) invoice.lines.data[0].subscription (common in many invoice shapes)
 * 2) (invoice as any).subscription (fallback)
 */
function extractSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  try {
    const lineSub =
      invoice.lines?.data?.[0] &&
      typeof (invoice.lines.data[0] as any)?.subscription === "string"
        ? ((invoice.lines.data[0] as any).subscription as string)
        : null;

    if (lineSub) return lineSub;

    const topLevel = (invoice as any)?.subscription;
    if (typeof topLevel === "string" && topLevel.trim()) return topLevel.trim();

    return null;
  } catch {
    return null;
  }
}

/**
 * Robustly find Clerk userId for invoice events.
 */
async function resolveUserIdForInvoice(
  invoice: Stripe.Invoice
): Promise<string | null> {
  const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return null;

  const subscription = await stripe!.subscriptions.retrieve(subscriptionId);
  return resolveUserIdForSubscription(subscription);
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

  const { error: insertError } = await supabaseServer
    .from("stripe_webhook_events")
    .insert({ event_id: event.id });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ received: true });
    }
    console.error("stripe_webhook_events insert error:", insertError);
    return new NextResponse("Webhook error", { status: 500 });
  }

  try {
    // ======================================================
    // EVENT 1 — Checkout Completed
    // ======================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId =
        typeof session.client_reference_id === "string"
          ? session.client_reference_id
          : typeof (session.metadata as any)?.userId === "string"
          ? (session.metadata as any).userId
          : null;

      if (!userId) {
        console.warn("checkout.session.completed missing userId");
        return NextResponse.json({ received: true });
      }

      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      const customerId =
        typeof session.customer === "string" ? session.customer : null;

      if (!subscriptionId || !customerId) {
        console.warn("Missing subscription/customer on checkout");
        return NextResponse.json({ received: true });
      }

      // Ensure Stripe customer has metadata too (backup for future events)
      try {
        await stripe.customers.update(customerId, {
          metadata: { userId },
        });
      } catch (err) {
        console.warn("Unable to set Stripe customer metadata:", err);
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const plan = resolvePlanFromSubscription(subscription);

      await updateClerkPublicMetadata(userId, {
        summittSubscribed: isActiveStatus(subscription.status),
        summittPlan: plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });

      const existing = await getClerkPublicMetadata(userId);
      await syncSmsAudience({
        userId: userId,
        phoneNumber: existing?.phoneNumber ?? null,
        smsEnabled: existing?.smsEnabled ?? null,
        stoppedAt: null,
        timezone: existing?.timezone ?? null,
        smsTimePreference: existing?.smsTimePreference ?? null,
        summittSubscribed: isActiveStatus(subscription.status),
      });

      console.log("✅ checkout.session.completed → metadata updated", userId);
    }

    // ======================================================
    // EVENT 2 — Subscription Updated
    // ======================================================
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;

      const userId = await resolveUserIdForSubscription(subscription);
      if (!userId) {
        console.warn("subscription.updated missing userId", subscription.id);
        return NextResponse.json({ received: true });
      }

      const plan = resolvePlanFromSubscription(subscription);

      await updateClerkPublicMetadata(userId, {
        summittSubscribed: isActiveStatus(subscription.status),
        summittPlan: plan,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : null,
        stripeSubscriptionId: subscription.id,
      });

      const existing = await getClerkPublicMetadata(userId);
      await syncSmsAudience({
        userId: userId,
        phoneNumber: existing?.phoneNumber ?? null,
        smsEnabled: existing?.smsEnabled ?? null,
        stoppedAt: null,
        timezone: existing?.timezone ?? null,
        smsTimePreference: existing?.smsTimePreference ?? null,
        summittSubscribed: isActiveStatus(subscription.status),
      });

      console.log("✅ customer.subscription.updated → metadata updated", userId);
    }

    // ======================================================
    // EVENT 3 — Subscription Deleted (Canceled)
    // ======================================================
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;

      const userId = await resolveUserIdForSubscription(subscription);
      if (!userId) {
        console.warn("subscription.deleted missing userId", subscription.id);
        return NextResponse.json({ received: true });
      }

      console.log("🚫 Subscription canceled → locking access", userId);

      await updateClerkPublicMetadata(userId, {
        summittSubscribed: false,
        summittPlan: null,
        stripeSubscriptionId: subscription.id,
      });

      const existing = await getClerkPublicMetadata(userId);
      await syncSmsAudience({
        userId: userId,
        phoneNumber: existing?.phoneNumber ?? null,
        smsEnabled: existing?.smsEnabled ?? null,
        stoppedAt: null,
        timezone: existing?.timezone ?? null,
        smsTimePreference: existing?.smsTimePreference ?? null,
        summittSubscribed: false,
      });
    }

    // ======================================================
    // EVENT 4 — Payment Failed
    // ======================================================
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;

      const userId = await resolveUserIdForInvoice(invoice);
      if (!userId) {
        console.warn("invoice.payment_failed missing userId");
        return NextResponse.json({ received: true });
      }

      console.log("⚠️ Payment failed → locking access", userId);

      await updateClerkPublicMetadata(userId, {
        summittSubscribed: false,
      });

      const existing = await getClerkPublicMetadata(userId);
      await syncSmsAudience({
        userId: userId,
        phoneNumber: existing?.phoneNumber ?? null,
        smsEnabled: existing?.smsEnabled ?? null,
        stoppedAt: null,
        timezone: existing?.timezone ?? null,
        smsTimePreference: existing?.smsTimePreference ?? null,
        summittSubscribed: false,
      });
    }

    // ======================================================
    // EVENT 5 — Payment Restored
    // ======================================================
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;

      const userId = await resolveUserIdForInvoice(invoice);
      if (!userId) {
        console.warn("invoice.paid missing userId");
        return NextResponse.json({ received: true });
      }

      console.log("✅ Payment restored → unlocking access", userId);

      await updateClerkPublicMetadata(userId, {
        summittSubscribed: true,
      });

      const existing = await getClerkPublicMetadata(userId);
      await syncSmsAudience({
        userId: userId,
        phoneNumber: existing?.phoneNumber ?? null,
        smsEnabled: existing?.smsEnabled ?? null,
        stoppedAt: null,
        timezone: existing?.timezone ?? null,
        smsTimePreference: existing?.smsTimePreference ?? null,
        summittSubscribed: true,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    await supabaseServer
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", event.id);
    console.error("🔥 Webhook processing error:", err);
    return new NextResponse("Webhook error", { status: 500 });
  }
}
