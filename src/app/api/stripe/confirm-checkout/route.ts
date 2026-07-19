/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

/**
 * ======================================================
 * CONFIRM CHECKOUT (SYNCHRONOUS MEMBERSHIP UNLOCK)
 * ======================================================
 *
 * This endpoint:
 * 1. Verifies logged-in user
 * 2. Retrieves Checkout Session from Stripe
 * 3. Verifies it belongs to the user
 * 4. Retrieves subscription
 * 5. Immediately updates Clerk metadata
 *
 * Webhook still remains canonical long-term truth.
 */

export async function POST(req: Request) {
  try {
    if (!stripe) {
      return new NextResponse("Stripe not configured", { status: 500 });
    }

    const { userId } = await auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const deletionGate =
      await assertEntitlementMutationAllowedForAccountDeletion(userId);
    if (!deletionGate.ok) {
      if (deletionGate.code === "lookup_failed") {
        console.error(
          "[stripe/confirm-checkout] account deletion lookup failed; fail closed"
        );
        return new NextResponse("Internal Server Error", { status: 500 });
      }
      return NextResponse.json(ACCOUNT_DELETION_IN_PROGRESS_BODY, {
        status: 409,
      });
    }

    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId;

    if (!sessionId) {
      return new NextResponse("Missing sessionId", { status: 400 });
    }

    // 🔎 Retrieve session directly from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return new NextResponse("Session not found", { status: 404 });
    }

    // 🔐 Ensure session belongs to this Clerk user
    const sessionUserId =
      typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : typeof (session.metadata as any)?.userId === "string"
        ? (session.metadata as any).userId
        : null;

    if (!sessionUserId || sessionUserId !== userId) {
      console.warn("Session user mismatch", {
        expected: userId,
        found: sessionUserId,
      });

      return new NextResponse("Session does not belong to user", {
        status: 403,
      });
    }

    if (typeof session.subscription !== "string") {
      return new NextResponse("No subscription attached to session", {
        status: 400,
      });
    }

    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    );

    const interval =
      subscription.items.data[0]?.price?.recurring?.interval;

    const plan =
      interval === "year"
        ? "annual"
        : interval === "month"
        ? "monthly"
        : null;

    const isActive =
      subscription.status === "active" ||
      subscription.status === "trialing";

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : null;

    const existingMd = await getClerkPublicMetadata(userId);
    const existingSubId =
      typeof existingMd?.stripeSubscriptionId === "string"
        ? existingMd.stripeSubscriptionId.trim()
        : "";
    const existingSubscribed =
      existingMd?.summittSubscribed === true || existingMd?.summittSubscribed === "true";
    const existingPlan = existingMd?.summittPlan;
    const planMatches = plan === null ? true : existingPlan === plan;

    if (
      existingSubId === subscription.id &&
      existingSubscribed === isActive &&
      planMatches
    ) {
      console.log("[stripe/confirm-checkout] idempotent skip; Clerk already matches session", {
        userId,
        stripeSubscriptionId: subscription.id,
      });
      return NextResponse.json({
        success: true,
        plan,
        isActive,
        idempotent: true,
      });
    }

    // Second guard before entitlement-increasing Clerk write. Stripe session may
    // already exist; this only prevents local unlock if deletion began mid-flight.
    if (isActive) {
      const secondGate =
        await assertEntitlementMutationAllowedForAccountDeletion(userId);
      if (!secondGate.ok) {
        if (secondGate.code === "lookup_failed") {
          console.error(
            "[stripe/confirm-checkout] second deletion lookup failed; fail closed"
          );
          return new NextResponse("Internal Server Error", { status: 500 });
        }
        return NextResponse.json(ACCOUNT_DELETION_IN_PROGRESS_BODY, {
          status: 409,
        });
      }
    }

    // 🔥 Immediately patch Clerk metadata
    await updateClerkPublicMetadata(userId, {
      summittSubscribed: isActive,
      summittPlan: plan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
    });

    return NextResponse.json({
      success: true,
      plan,
      isActive,
    });
  } catch (err: any) {
    console.error("Confirm checkout error:", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}