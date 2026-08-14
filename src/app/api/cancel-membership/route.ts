import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import {
  isRetryableMembershipSourceOrClerkFailure,
  isSmsReplicaFailureAfterClerkSuccess,
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromAuthoritativeStripeSubscription,
} from "@/lib/summitt-membership-entitlement.server";

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

  const deletionGate =
    await assertEntitlementMutationAllowedForAccountDeletion(userId);
  if (!deletionGate.ok) {
    if (deletionGate.code === "lookup_failed") {
      console.error(
        "[cancel-membership] account deletion lookup failed; fail closed"
      );
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 }
      );
    }
    return NextResponse.json(ACCOUNT_DELETION_IN_PROGRESS_BODY, {
      status: 409,
    });
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
  const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);

  // ======================================================
  // ✅ 3. PROJECT MEMBERSHIP FROM THIS CANCELED SUBSCRIPTION
  // ======================================================
  const projection = await recomputeMembershipFromAuthoritativeStripeSubscription(
    userId,
    canceledSubscription
  );
  if (isRetryableMembershipSourceOrClerkFailure(projection)) {
    console.error(
      "[cancel-membership] membership projection retryable failure",
      projection.reason
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
  if (!membershipProjectionClerkSucceeded(projection)) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
  if (isSmsReplicaFailureAfterClerkSuccess(projection)) {
    console.error(
      "[cancel-membership] SMS replica failed after Clerk projection"
    );
  }

  return NextResponse.json({ ok: true });
}
