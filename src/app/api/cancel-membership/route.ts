import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import {
  EXIT_SURVEY_VERSION,
  parseExitSurveyBody,
  type ParsedExitSurvey,
} from "@/lib/exit-survey";
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

async function projectMembershipAfterCanceledSubscription(
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  try {
    const projection = await recomputeMembershipFromAuthoritativeStripeSubscription(
      userId,
      subscription
    );
    if (
      isRetryableMembershipSourceOrClerkFailure(projection) ||
      !membershipProjectionClerkSucceeded(projection)
    ) {
      console.error(
        "[cancel-membership] membership sync failed after canceled subscription"
      );
    } else if (isSmsReplicaFailureAfterClerkSuccess(projection)) {
      console.error(
        "[cancel-membership] SMS replica failed after Clerk projection"
      );
    }
  } catch (err) {
    console.error("[cancel-membership] membership sync threw after canceled subscription", {
      message: err instanceof Error ? err.name : "sync_threw",
    });
  }
}

async function readOptionalSurvey(req: Request): Promise<ParsedExitSurvey> {
  try {
    const text = await req.text();
    if (!text.trim()) {
      return parseExitSurveyBody(null);
    }
    return parseExitSurveyBody(JSON.parse(text));
  } catch {
    return parseExitSurveyBody(null);
  }
}

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

  const metadata = user.publicMetadata as { stripeSubscriptionId?: unknown };
  const subscriptionId =
    typeof metadata?.stripeSubscriptionId === "string"
      ? metadata.stripeSubscriptionId.trim()
      : "";

  if (!subscriptionId) {
    return NextResponse.json(
      { error: "Subscription not found." },
      { status: 400 }
    );
  }

  const survey = await readOptionalSurvey(req);

  let current: Stripe.Subscription;
  try {
    current = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error("[cancel-membership] subscription retrieve failed", {
      message: err instanceof Error ? err.name : "retrieve_failed",
    });
    return NextResponse.json(
      { error: "We couldn't cancel the membership. Please try again." },
      { status: 500 }
    );
  }

  if (current.status === "canceled") {
    await projectMembershipAfterCanceledSubscription(userId, current);
    return NextResponse.json({ ok: true });
  }

  let canceledSubscription: Stripe.Subscription;
  try {
    canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);
  } catch (err) {
    console.error("[cancel-membership] stripe cancel failed", {
      message: err instanceof Error ? err.name : "cancel_failed",
    });
    try {
      const after = await stripe.subscriptions.retrieve(subscriptionId);
      if (after.status === "canceled") {
        await projectMembershipAfterCanceledSubscription(userId, after);
        return NextResponse.json({ ok: true });
      }
    } catch (retrieveErr) {
      console.error("[cancel-membership] status check after cancel failure", {
        message: retrieveErr instanceof Error ? retrieveErr.name : "retrieve_failed",
      });
    }
    return NextResponse.json(
      { error: "We couldn't cancel the membership. Please try again." },
      { status: 500 }
    );
  }

  if (canceledSubscription.status !== "canceled") {
    console.error("[cancel-membership] stripe cancel did not return canceled");
    return NextResponse.json(
      { error: "We couldn't cancel the membership. Please try again." },
      { status: 500 }
    );
  }

  await projectMembershipAfterCanceledSubscription(userId, canceledSubscription);

  try {
    const { error } = await supabaseServer.from("feedback_events").insert({
      clerk_user_id: userId,
      source: "cancel_flow",
      moment: "cancel_attempt",
      type: "churn",
      rating: null,
      sentiment: null,
      reason_code: survey.reasonCode,
      message: survey.message,
      share_permission: false,
      metadata: {
        canonical: true,
        survey_version: EXIT_SURVEY_VERSION,
        confirmed_stripe_cancel: true,
        skipped_reason: survey.skippedReason,
        skipped_comment: survey.skippedComment,
      },
    });
    if (error) {
      console.error("[cancel-membership] feedback insert failed", {
        code: error.code,
      });
    }
  } catch (err) {
    console.error("[cancel-membership] feedback insert threw", {
      message: err instanceof Error ? err.name : "insert_threw",
    });
  }

  return NextResponse.json({ ok: true });
}
