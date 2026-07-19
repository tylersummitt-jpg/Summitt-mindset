/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import {
  classifySummittMembership,
  customerIdFromSubscription,
  isSummittEntitledFromSubscription,
  resolvePlanFromSubscription,
} from "@/lib/summitt-subscription-membership";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey);

function json(
  body: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(body, { status });
}

type SuccessCode = "resumed" | "already_active";

/**
 * Write Clerk + SMS from an authoritative Stripe subscription.
 * Does not mutate Stripe. Returns a NextResponse on Clerk failure; null on success.
 *
 * Callers must run a second deletion guard immediately before this when the write
 * can increase entitlement. Stripe resume may already have succeeded; this helper
 * only prevents local Clerk/SMS unlock (Stripe/Postgres/Clerk are not atomic).
 */
async function reconcileMembershipFromStripeSubscription(args: {
  userId: string;
  metadata: Record<string, unknown>;
  subscription: Stripe.Subscription;
  fallbackCustomerId: string | null;
  code: SuccessCode;
}): Promise<NextResponse | null> {
  const { userId, metadata, subscription, fallbackCustomerId, code } = args;

  const entitled = isSummittEntitledFromSubscription(subscription);
  const plan = resolvePlanFromSubscription(subscription);
  const verifiedCustomerId =
    customerIdFromSubscription(subscription) || fallbackCustomerId;

  if (entitled) {
    const secondGate =
      await assertEntitlementMutationAllowedForAccountDeletion(userId);
    if (!secondGate.ok) {
      if (secondGate.code === "lookup_failed") {
        console.error(
          "[resume-membership] second deletion lookup failed; fail closed (no Clerk unlock)"
        );
        return json({ ok: false, error: "Internal Server Error" }, 500);
      }
      console.warn(
        "[resume-membership] deletion began before Clerk unlock; Stripe may already be resumed",
        { userId, subscriptionId: subscription.id, code }
      );
      return json({ ...ACCOUNT_DELETION_IN_PROGRESS_BODY, ok: false }, 409);
    }
  }

  try {
    await updateClerkPublicMetadata(userId, {
      summittSubscribed: entitled,
      summittPlan: plan === "unknown" ? null : plan,
      stripeCustomerId: verifiedCustomerId,
      stripeSubscriptionId: subscription.id,
    });
  } catch (err) {
    console.error("[resume-membership] Clerk update failed", {
      userId,
      subscriptionId: subscription.id,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, code: "clerk_error" }, 500);
  }

  try {
    await syncSmsAudience({
      userId,
      phoneNumber:
        typeof metadata?.phoneNumber === "string" ? metadata.phoneNumber : null,
      smsEnabled:
        typeof metadata?.smsEnabled === "boolean" ? metadata.smsEnabled : null,
      timezone: typeof metadata?.timezone === "string" ? metadata.timezone : null,
      smsTimePreference:
        typeof metadata?.smsTimePreference === "string"
          ? metadata.smsTimePreference
          : null,
      summittSubscribed: entitled,
    });
  } catch (err) {
    // Audience sync is repairable via webhook/cron; membership reconcile succeeded.
    console.error("[resume-membership] syncSmsAudience failed (non-fatal)", {
      userId,
      subscriptionId: subscription.id,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const deletionGate =
    await assertEntitlementMutationAllowedForAccountDeletion(userId);
  if (!deletionGate.ok) {
    if (deletionGate.code === "lookup_failed") {
      console.error(
        "[resume-membership] account deletion lookup failed; fail closed"
      );
      return json({ ok: false, error: "Internal Server Error" }, 500);
    }
    return json({ ...ACCOUNT_DELETION_IN_PROGRESS_BODY, ok: false }, 409);
  }

  const user = await currentUser();

  if (!user) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const metadata = user.publicMetadata as Record<string, unknown>;
  const subscriptionIdRaw = metadata?.stripeSubscriptionId;
  const subscriptionId =
    typeof subscriptionIdRaw === "string" ? subscriptionIdRaw.trim() : "";

  if (!subscriptionId) {
    return json({ ok: false, code: "no_subscription" }, 400);
  }

  const clerkCustomerId =
    typeof metadata?.stripeCustomerId === "string"
      ? metadata.stripeCustomerId.trim()
      : "";

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error("[resume-membership] Stripe retrieve failed", {
      userId,
      subscriptionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, code: "stripe_error" }, 502);
  }

  const stripeCustomerId = customerIdFromSubscription(subscription);
  if (clerkCustomerId && stripeCustomerId && clerkCustomerId !== stripeCustomerId) {
    console.warn("[resume-membership] ownership_mismatch customer", {
      userId,
      subscriptionId,
    });
    return json({ ok: false, code: "ownership_mismatch" }, 403);
  }

  const mdUserId = subscription.metadata?.userId;
  if (
    typeof mdUserId === "string" &&
    mdUserId.trim() &&
    mdUserId.trim() !== userId
  ) {
    console.warn("[resume-membership] ownership_mismatch metadata.userId", {
      userId,
      subscriptionId,
    });
    return json({ ok: false, code: "ownership_mismatch" }, 403);
  }

  const classification = classifySummittMembership(subscription);

  if (classification === "ended") {
    return json({ ok: false, code: "subscription_not_recoverable" }, 409);
  }

  if (subscription.pause_collection == null) {
    if (isSummittEntitledFromSubscription(subscription)) {
      const clerkError = await reconcileMembershipFromStripeSubscription({
        userId,
        metadata,
        subscription,
        fallbackCustomerId: stripeCustomerId || clerkCustomerId || null,
        code: "already_active",
      });
      if (clerkError) return clerkError;

      const plan = resolvePlanFromSubscription(subscription);
      return json(
        {
          ok: true,
          code: "already_active",
          plan: plan === "unknown" ? null : plan,
          entitled: true,
        },
        200
      );
    }
    return json({ ok: false, code: "not_paused" }, 409);
  }

  if (classification !== "paused_recoverable") {
    return json({ ok: false, code: "subscription_not_recoverable" }, 409);
  }

  let resumed: Stripe.Subscription;
  try {
    resumed = await stripe.subscriptions.update(subscriptionId, {
      pause_collection: null,
    });
  } catch (err) {
    console.error("[resume-membership] Stripe update failed", {
      userId,
      subscriptionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, code: "stripe_error" }, 502);
  }

  if (resumed.pause_collection != null) {
    console.error("[resume-membership] pause_collection still set after update", {
      userId,
      subscriptionId,
    });
    return json({ ok: false, code: "stripe_error" }, 502);
  }

  const entitled = isSummittEntitledFromSubscription(resumed);
  const successCode: SuccessCode = entitled ? "resumed" : "already_active";

  const clerkError = await reconcileMembershipFromStripeSubscription({
    userId,
    metadata,
    subscription: resumed,
    fallbackCustomerId: stripeCustomerId || clerkCustomerId || null,
    code: successCode,
  });
  if (clerkError) return clerkError;

  const plan = resolvePlanFromSubscription(resumed);
  return json(
    {
      ok: true,
      code: successCode,
      plan: plan === "unknown" ? null : plan,
      entitled,
    },
    200
  );
}
