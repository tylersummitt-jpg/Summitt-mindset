/* eslint-disable no-console */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getClerkPublicMetadata,
  getClerkUser,
} from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { notifyCoachSubscribedInternal } from "@/lib/notify-coach-subscribed";
import { notifyMemberSubscribedInternal } from "@/lib/notify-member-subscribed";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";
import {
  evaluateEntitlementIncreasingWebhookWrite,
  type EntitlementRestorationDecision,
} from "@/lib/account-deletion/deletion-guards";
import { releaseStripeWebhookEventDedupe } from "@/lib/stripe-webhook-dedupe";
import {
  isRetryableMembershipSourceOrClerkFailure,
  recomputeMembershipFromAuthoritativeStripeSubscription,
  isSmsReplicaFailureAfterClerkSuccess,
} from "@/lib/summitt-membership-entitlement.server";
import {
  isSummittEntitledFromSubscription,
  resolvePlanFromSubscription,
} from "@/lib/summitt-subscription-membership";

export const runtime = "nodejs";

/**
 * Entitlement-increase gate for webhooks (after dedupe insert).
 * - blocked_due_to_deletion → keep dedupe, caller returns 200
 * - lookup_failed → release this event_id only, caller returns 500 (Stripe retries)
 * - allowed → proceed (caller should recheck immediately before Clerk/SMS unlock)
 *
 * Stripe / Postgres / Clerk are not one atomic transaction.
 */
async function gateEntitlementIncreasingWebhook(
  eventId: string,
  userId: string
): Promise<
  | { outcome: "proceed" }
  | { outcome: "ack_blocked"; decision: EntitlementRestorationDecision }
  | { outcome: "retry_lookup_failed" }
> {
  const decision = await evaluateEntitlementIncreasingWebhookWrite(userId);
  if (decision.decision === "allowed") {
    return { outcome: "proceed" };
  }
  if (decision.decision === "lookup_failed") {
    await releaseStripeWebhookEventDedupe(eventId);
    console.warn(
      "[webhook] entitlement gate lookup_failed; released dedupe for retry",
      { event_id: eventId }
    );
    return { outcome: "retry_lookup_failed" };
  }
  console.warn(
    "[webhook] entitlement restore blocked (account deletion); ack no-op",
    { event_id: eventId, scope: decision.scope }
  );
  return { outcome: "ack_blocked", decision };
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!stripeSecretKey) console.warn("Missing STRIPE_SECRET_KEY");
if (!webhookSecret) console.warn("Missing STRIPE_WEBHOOK_SECRET");
if (!clerkSecretKey) console.warn("Missing CLERK_SECRET_KEY");

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

async function releaseDedupeAndRetry(
  eventId: string,
  reason: string
): Promise<NextResponse> {
  await releaseStripeWebhookEventDedupe(eventId);
  console.warn(
    "[webhook] retryable membership projection failure; released dedupe",
    { event_id: eventId, reason }
  );
  return new NextResponse("Webhook error", { status: 500 });
}

/**
 * Project Clerk + SMS from the authoritative Stripe subscription for this event.
 * Source/Clerk failures → caller must return 500 (dedupe already released).
 * SMS-only failure after Clerk success → log, treat as processed (keep dedupe).
 */
async function projectMembershipFromEventSubscription(args: {
  eventId: string;
  userId: string;
  subscription: Stripe.Subscription;
}): Promise<"ok" | "retry"> {
  const result = await recomputeMembershipFromAuthoritativeStripeSubscription(
    args.userId,
    args.subscription
  );
  if (isRetryableMembershipSourceOrClerkFailure(result)) {
    await releaseStripeWebhookEventDedupe(args.eventId);
    console.warn(
      "[webhook] retryable membership projection failure; released dedupe",
      { event_id: args.eventId, reason: result.reason }
    );
    return "retry";
  }
  if (isSmsReplicaFailureAfterClerkSuccess(result)) {
    console.error(
      "[webhook] SMS replica failed after Clerk projection; keeping dedupe",
      { event_id: args.eventId, userId: args.userId }
    );
  }
  return "ok";
}

/**
 * ======================================================
 * Helpers
 * ======================================================
 */

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

      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (err) {
        console.error(
          "[webhook] checkout.session.completed Stripe retrieve failed",
          err
        );
        return releaseDedupeAndRetry(event.id, "stripe_lookup_failed");
      }

      const firstGate = await gateEntitlementIncreasingWebhook(event.id, userId);
      if (firstGate.outcome === "ack_blocked") {
        return NextResponse.json({ received: true });
      }
      if (firstGate.outcome === "retry_lookup_failed") {
        return new NextResponse("Webhook lookup failed", { status: 500 });
      }

      // Ensure Stripe customer has metadata too (backup for future events)
      try {
        await stripe.customers.update(customerId, {
          metadata: { userId },
        });
      } catch (err) {
        console.warn("Unable to set Stripe customer metadata:", err);
      }

      const plan = resolvePlanFromSubscription(subscription);
      const entitled = isSummittEntitledFromSubscription(subscription);

      const sessionMd = session.metadata as Record<string, unknown> | null | undefined;
      const subMd = subscription.metadata as Record<string, unknown> | null | undefined;
      const isCoachAcquisitionFromStripe =
        sessionMd?.summittAcquisition === "coach" ||
        subMd?.summittAcquisition === "coach";

      // Second guard: deletion may have begun after first gate / Stripe reads.
      const secondGate = await gateEntitlementIncreasingWebhook(event.id, userId);
      if (secondGate.outcome === "ack_blocked") {
        return NextResponse.json({ received: true });
      }
      if (secondGate.outcome === "retry_lookup_failed") {
        return new NextResponse("Webhook lookup failed", { status: 500 });
      }

      try {
        await updateClerkPublicMetadata(userId, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          ...(isCoachAcquisitionFromStripe ? { acquisitionSource: "coach" } : {}),
        });
      } catch (err) {
        console.error(
          "[webhook] checkout.session.completed linkage Clerk write failed",
          err
        );
        return releaseDedupeAndRetry(event.id, "clerk_projection_failed");
      }

      const projected = await projectMembershipFromEventSubscription({
        eventId: event.id,
        userId,
        subscription,
      });
      if (projected === "retry") {
        return new NextResponse("Webhook error", { status: 500 });
      }

      const existing = await getClerkPublicMetadata(userId);

      if (
        isCoachAcquisitionFromStripe &&
        entitled &&
        subscriptionId &&
        customerId
      ) {
        try {
          let coachName = "not provided";
          let coachEmail = "not found";
          try {
            const clerkUser = await getClerkUser(userId);
            const primaryId = clerkUser.primary_email_address_id;
            const emails = clerkUser.email_addresses ?? [];
            const primary = emails.find((e) => e.id === primaryId);
            coachEmail =
              primary?.email_address ??
              emails[0]?.email_address ??
              "not found";
            const fn = clerkUser.first_name?.trim() ?? "";
            const ln = clerkUser.last_name?.trim() ?? "";
            coachName =
              [fn, ln].filter(Boolean).join(" ") || "not provided";
          } catch (clerkErr) {
            console.warn(
              "[webhook] coach subscription notify: could not load Clerk user",
              clerkErr
            );
          }

          await notifyCoachSubscribedInternal({
            coachName,
            coachEmail,
            clerkUserId: userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            plan,
            source: "coach",
            timestamp: new Date().toISOString(),
          });
        } catch (notifyErr) {
          console.warn(
            "[webhook] coach subscription notify unexpected:",
            notifyErr
          );
        }
      }

      if (
        !isCoachAcquisitionFromStripe &&
        entitled &&
        subscriptionId &&
        customerId
      ) {
        try {
          let memberName = "not provided";
          let memberEmail = "not found";
          try {
            const clerkUser = await getClerkUser(userId);
            const primaryId = clerkUser.primary_email_address_id;
            const emails = clerkUser.email_addresses ?? [];
            const primary = emails.find((e) => e.id === primaryId);
            memberEmail =
              primary?.email_address ??
              emails[0]?.email_address ??
              "not found";
            const fn = clerkUser.first_name?.trim() ?? "";
            const ln = clerkUser.last_name?.trim() ?? "";
            memberName =
              [fn, ln].filter(Boolean).join(" ") || "not provided";
          } catch (clerkErr) {
            console.warn(
              "[webhook] member subscription notify: could not load Clerk user",
              clerkErr
            );
          }

          const memberPhone =
            typeof existing?.phoneNumber === "string" &&
            existing.phoneNumber.trim()
              ? existing.phoneNumber.trim()
              : "not provided";

          await notifyMemberSubscribedInternal({
            memberName,
            memberEmail,
            memberPhone,
            clerkUserId: userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            subscriptionStatus: subscription.status,
            checkoutSessionId: session.id,
            plan,
            timestamp: new Date().toISOString(),
          });
        } catch (notifyErr) {
          console.warn(
            "[webhook] member subscription notify unexpected:",
            notifyErr
          );
        }
      }

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

      const entitled = isSummittEntitledFromSubscription(subscription);

      // Deletion-aware branch (any status row blocks restoration side channels).
      // Preferred safe write when !entitled during deletion: only
      // summittSubscribed=false + summittPlan=null (no active plan / Stripe linkage /
      // SMS enable). Entitled + deletion → intentional full no-op (keep dedupe, 200).
      const deletionDecision =
        await evaluateEntitlementIncreasingWebhookWrite(userId);
      if (deletionDecision.decision === "lookup_failed") {
        await releaseStripeWebhookEventDedupe(event.id);
        console.warn(
          "[webhook] subscription.updated lookup_failed; released dedupe for retry",
          { event_id: event.id }
        );
        return new NextResponse("Webhook lookup failed", { status: 500 });
      }
      if (deletionDecision.decision === "blocked_due_to_deletion") {
        if (entitled) {
          console.warn(
            "[webhook] customer.subscription.updated: skip entitlement restore (account deletion)",
            { scope: deletionDecision.scope }
          );
          return NextResponse.json({ received: true });
        }
        await updateClerkPublicMetadata(userId, {
          summittSubscribed: false,
          summittPlan: null,
        });
        const existingBlocked = await getClerkPublicMetadata(userId);
        await syncSmsAudience({
          userId: userId,
          phoneNumber: existingBlocked?.phoneNumber ?? null,
          smsEnabled: existingBlocked?.smsEnabled ?? null,
          timezone: existingBlocked?.timezone ?? null,
          smsTimePreference: existingBlocked?.smsTimePreference ?? null,
          summittSubscribed: false,
        });
        console.log(
          "✅ customer.subscription.updated → deletion-safe false/null only",
          userId
        );
        return NextResponse.json({ received: true });
      }

      if (entitled) {
        // Second guard immediately before entitlement-increasing Clerk/SMS writes.
        const secondGate = await gateEntitlementIncreasingWebhook(
          event.id,
          userId
        );
        if (secondGate.outcome === "ack_blocked") {
          return NextResponse.json({ received: true });
        }
        if (secondGate.outcome === "retry_lookup_failed") {
          return new NextResponse("Webhook lookup failed", { status: 500 });
        }
      }

      const clerkPatch: Record<string, unknown> = {
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : null,
        stripeSubscriptionId: subscription.id,
      };

      const subMeta = subscription.metadata as Record<string, unknown> | null | undefined;
      if (subMeta?.summittAcquisition === "coach") {
        clerkPatch.acquisitionSource = "coach";
      }

      try {
        await updateClerkPublicMetadata(userId, clerkPatch as Record<string, any>);
      } catch (err) {
        console.error(
          "[webhook] customer.subscription.updated linkage Clerk write failed",
          err
        );
        return releaseDedupeAndRetry(event.id, "clerk_projection_failed");
      }

      const projected = await projectMembershipFromEventSubscription({
        eventId: event.id,
        userId,
        subscription,
      });
      if (projected === "retry") {
        return new NextResponse("Webhook error", { status: 500 });
      }

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

      console.log("🚫 Subscription canceled → projecting membership", userId);

      try {
        await updateClerkPublicMetadata(userId, {
          stripeSubscriptionId: subscription.id,
        });
      } catch (err) {
        console.error(
          "[webhook] customer.subscription.deleted linkage Clerk write failed",
          err
        );
        return releaseDedupeAndRetry(event.id, "clerk_projection_failed");
      }

      const projected = await projectMembershipFromEventSubscription({
        eventId: event.id,
        userId,
        subscription,
      });
      if (projected === "retry") {
        return new NextResponse("Webhook error", { status: 500 });
      }
    }

    // ======================================================
    // EVENT 4 — Payment Failed
    // ======================================================
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;

      const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
      if (!subscriptionId) {
        console.warn("invoice.payment_failed missing subscription on invoice");
        return NextResponse.json({ received: true });
      }

      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (err) {
        console.error(
          "[webhook] invoice.payment_failed Stripe retrieve failed",
          err
        );
        return releaseDedupeAndRetry(event.id, "stripe_lookup_failed");
      }

      const userId = await resolveUserIdForSubscription(subscription);
      if (!userId) {
        console.warn("invoice.payment_failed missing userId");
        return NextResponse.json({ received: true });
      }

      console.log("⚠️ Payment failed → projecting membership", userId);

      const projected = await projectMembershipFromEventSubscription({
        eventId: event.id,
        userId,
        subscription,
      });
      if (projected === "retry") {
        return new NextResponse("Webhook error", { status: 500 });
      }
    }

    // ======================================================
    // EVENT 5 — Payment Restored
    // ======================================================
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;

      const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
      if (!subscriptionId) {
        console.warn("invoice.paid missing subscription on invoice");
        return NextResponse.json({ received: true });
      }

      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (err) {
        console.error("[webhook] invoice.paid Stripe retrieve failed", err);
        return releaseDedupeAndRetry(event.id, "stripe_lookup_failed");
      }

      const userId = await resolveUserIdForSubscription(subscription);
      if (!userId) {
        console.warn("invoice.paid missing userId");
        return NextResponse.json({ received: true });
      }

      const entitled = isSummittEntitledFromSubscription(subscription);

      if (entitled) {
        const firstGate = await gateEntitlementIncreasingWebhook(
          event.id,
          userId
        );
        if (firstGate.outcome === "ack_blocked") {
          return NextResponse.json({ received: true });
        }
        if (firstGate.outcome === "retry_lookup_failed") {
          return new NextResponse("Webhook lookup failed", { status: 500 });
        }
        // Second guard immediately before unlock writes.
        const secondGate = await gateEntitlementIncreasingWebhook(
          event.id,
          userId
        );
        if (secondGate.outcome === "ack_blocked") {
          return NextResponse.json({ received: true });
        }
        if (secondGate.outcome === "retry_lookup_failed") {
          return new NextResponse("Webhook lookup failed", { status: 500 });
        }
        console.log("✅ Payment restored → unlocking access", userId);
      } else {
        console.log(
          "✅ invoice.paid → subscription not entitled (e.g. paused); projecting membership",
          userId
        );
      }

      const projected = await projectMembershipFromEventSubscription({
        eventId: event.id,
        userId,
        subscription,
      });
      if (projected === "retry") {
        return new NextResponse("Webhook error", { status: 500 });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    // Keep stripe_webhook_events row (event_id) so Stripe retries dedupe via 23505 and do not re-run handlers.
    console.error("🔥 Webhook processing error (dedupe row retained):", {
      event_id: event.id,
      err,
    });
    return new NextResponse("Webhook error", { status: 500 });
  }
}
