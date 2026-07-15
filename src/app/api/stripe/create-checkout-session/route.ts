/* eslint-disable no-console */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";
import { maySetCoachAcquisitionSource } from "@/lib/coach-attribution";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  checkoutBlockErrorForClass,
  classifySummittMembership,
  isCheckoutBlockedMembershipClass,
  isSummittEntitledFromSubscription,
  resolvePlanFromSubscription,
  type SummittMembershipClass,
} from "@/lib/summitt-subscription-membership";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
const annualPriceId = process.env.STRIPE_PRICE_ID_ANNUAL;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

if (!stripeSecretKey) {
  console.warn("Missing STRIPE_SECRET_KEY in env.");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type Plan = "monthly" | "annual";

const ALLOWED_SRC = new Set(["coach"]);

function isTruthySubscribed(raw: unknown): boolean {
  return raw === true || raw === "true";
}

/**
 * Avoid blocking on unrelated Stripe subscriptions on the same customer/email.
 */
function isLikelySummittSubscription(
  sub: Stripe.Subscription,
  clerkUserId: string
): boolean {
  const mdUser = sub.metadata?.userId;
  if (typeof mdUser === "string" && mdUser.trim() === clerkUserId) return true;
  const mdPlan = sub.metadata?.plan;
  if (mdPlan === "monthly" || mdPlan === "annual") return true;
  const pid = sub.items.data[0]?.price?.id;
  if (typeof pid === "string") {
    const recognized = getRecognizedSummittPriceIds({
      monthly: monthlyPriceId,
      annual: annualPriceId,
      legacyCsv: process.env.STRIPE_LEGACY_PRICE_IDS,
    });
    if (recognized.has(pid)) return true;
  }
  return false;
}

type BlockingHit = {
  subscription: Stripe.Subscription;
  customerId: string;
  source: "clerk_stripe_customer_id" | "stripe_email_lookup";
  classification: SummittMembershipClass;
};

/**
 * Find any Summitt-like subscription that should block Checkout
 * (entitled, past_due, or paused_recoverable) for this user email
 * and/or Clerk-linked Stripe customer.
 */
async function findBlockingSummittSubscription(args: {
  stripe: Stripe;
  clerkUserId: string;
  userEmail: string;
  existingCustomerId: string | null;
}): Promise<BlockingHit | null> {
  const { stripe, clerkUserId, userEmail, existingCustomerId } = args;
  const candidates: BlockingHit[] = [];
  const seenSubIds = new Set<string>();

  const consider = (
    sub: Stripe.Subscription,
    customerId: string,
    source: BlockingHit["source"]
  ) => {
    const classification = classifySummittMembership(sub);
    if (!isCheckoutBlockedMembershipClass(classification)) return;
    if (!isLikelySummittSubscription(sub, clerkUserId)) return;
    if (seenSubIds.has(sub.id)) return;
    seenSubIds.add(sub.id);
    candidates.push({ subscription: sub, customerId, source, classification });
  };

  if (existingCustomerId) {
    const list = await stripe.subscriptions.list({
      customer: existingCustomerId,
      limit: 50,
    });
    for (const sub of list.data) {
      consider(sub, existingCustomerId, "clerk_stripe_customer_id");
    }
  }

  const email = userEmail.trim();
  if (email) {
    const customers = await stripe.customers.list({ email, limit: 25 });
    for (const c of customers.data) {
      if (!c.id) continue;
      const list = await stripe.subscriptions.list({ customer: c.id, limit: 50 });
      for (const sub of list.data) {
        consider(sub, c.id, "stripe_email_lookup");
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const rank = (c: SummittMembershipClass) => {
      if (c === "entitled") return 0;
      if (c === "past_due_recoverable") return 1;
      if (c === "paused_recoverable") return 2;
      return 3;
    };
    const r = rank(a.classification) - rank(b.classification);
    if (r !== 0) return r;
    const endA = a.subscription.items.data[0]?.current_period_end ?? 0;
    const endB = b.subscription.items.data[0]?.current_period_end ?? 0;
    return endB - endA;
  });

  return candidates[0] ?? null;
}

export async function POST(req: Request) {
  try {
    if (!stripe) {
      return new NextResponse(
        "Stripe is not configured. Check STRIPE_SECRET_KEY.",
        { status: 500 }
      );
    }

    // ✅ Canonical auth
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const user = await currentUser();
    const userEmail =
      user?.emailAddresses?.[0]?.emailAddress || null;

    if (!userEmail) {
      return new NextResponse(
        "Unable to determine user email for checkout",
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as Plan | undefined;
    const rawSrc = body?.src;
    const src =
      typeof rawSrc === "string" && ALLOWED_SRC.has(rawSrc) ? rawSrc : null;

    if (plan !== "monthly" && plan !== "annual") {
      return new NextResponse("Missing or invalid plan", { status: 400 });
    }

    let publicMetadata = await getClerkPublicMetadata(userId);

    if (src === "coach") {
      if (maySetCoachAcquisitionSource(publicMetadata?.acquisitionSource)) {
        try {
          await updateClerkPublicMetadata(userId, {
            acquisitionSource: "coach",
          });
          publicMetadata = {
            ...publicMetadata,
            acquisitionSource: "coach",
          };
        } catch (err) {
          console.warn(
            "Unable to set acquisitionSource on checkout session:",
            err
          );
        }
      }
    }

    const priceId = plan === "annual" ? annualPriceId : monthlyPriceId;

    if (!priceId) {
      return new NextResponse(
        "Stripe price ID not configured for this plan",
        { status: 500 }
      );
    }

    // 🔎 Check if we already have a Stripe customer ID saved
    const existingCustomerId =
      typeof publicMetadata?.stripeCustomerId === "string"
        ? publicMetadata.stripeCustomerId
        : null;

    const existingSubscriptionId =
      typeof publicMetadata?.stripeSubscriptionId === "string"
        ? publicMetadata.stripeSubscriptionId.trim()
        : "";

    if (existingSubscriptionId) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(existingSubscriptionId);
        const classification = classifySummittMembership(existingSub);
        const blockBody = checkoutBlockErrorForClass(classification);
        if (blockBody) {
          console.log(
            "[stripe/create-checkout-session] blocked: Clerk stripeSubscriptionId classification",
            {
              userId,
              stripeSubscriptionId: existingSub.id,
              status: existingSub.status,
              classification,
            }
          );
          return NextResponse.json(blockBody, { status: 409 });
        }
      } catch (retrieveErr) {
        const mdSaysActive =
          isTruthySubscribed(publicMetadata?.summittSubscribed) &&
          existingSubscriptionId.length > 0;
        if (mdSaysActive) {
          console.warn(
            "[stripe/create-checkout-session] blocked: Stripe retrieve failed; fail-closed on Clerk subscription flags",
            {
              userId,
              stripeSubscriptionId: existingSubscriptionId,
              message: retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr),
            }
          );
          return NextResponse.json(
            {
              error: "already_subscribed",
              message: "You already have an active Summitt Mindset membership.",
            },
            { status: 409 }
          );
        }
        console.warn(
          "[stripe/create-checkout-session] subscription retrieve failed; continuing duplicate scan",
          {
            userId,
            stripeSubscriptionId: existingSubscriptionId,
            message: retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr),
          }
        );
      }
    }

    const blockingHit = await findBlockingSummittSubscription({
      stripe,
      clerkUserId: userId,
      userEmail,
      existingCustomerId,
    });

    if (blockingHit) {
      const sub = blockingHit.subscription;
      const planResolved = resolvePlanFromSubscription(sub);
      const summittSubscribed = isSummittEntitledFromSubscription(sub);
      const classification = blockingHit.classification;
      const blockBody = checkoutBlockErrorForClass(classification);

      console.warn(
        "[stripe/create-checkout-session] blocked: Summitt subscription found via Stripe customer/email scan",
        {
          userId,
          stripeCustomerId: blockingHit.customerId,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          classification,
          source: blockingHit.source,
        }
      );

      try {
        const clerkPatch: Record<string, unknown> = {
          summittSubscribed,
          stripeCustomerId: blockingHit.customerId,
          stripeSubscriptionId: sub.id,
        };
        if (classification === "paused_recoverable") {
          clerkPatch.summittPlan = "paused";
        } else {
          clerkPatch.summittPlan =
            planResolved === "unknown" ? null : planResolved;
        }
        await updateClerkPublicMetadata(userId, clerkPatch);
      } catch (reconcileErr) {
        console.error(
          "[stripe/create-checkout-session] reconcile Clerk from Stripe subscription failed",
          {
            userId,
            stripeCustomerId: blockingHit.customerId,
            stripeSubscriptionId: sub.id,
            message: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
          }
        );
      }

      try {
        await stripe.customers.update(blockingHit.customerId, {
          metadata: { userId },
        });
      } catch (custErr) {
        console.warn(
          "[stripe/create-checkout-session] unable to set customer metadata userId during reconcile",
          {
            stripeCustomerId: blockingHit.customerId,
            message: custErr instanceof Error ? custErr.message : String(custErr),
          }
        );
      }

      return NextResponse.json(
        blockBody ?? {
          error: "already_subscribed",
          message: "You already have an active Summitt Mindset membership.",
        },
        { status: 409 }
      );
    }

    // Hourly bucket: still dedupes rapid double-clicks, but a new hour gets a new key so abandoned
    // Checkout does not reuse the same session for the full Stripe idempotency window.
    const utc = new Date();
    const utcHourBucket = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}-${String(utc.getUTCHours()).padStart(2, "0")}`;
    const checkoutIdempotencyKey = `checkout-subscription-v1:${userId}:${plan}:${utcHourBucket}`;

    const sessionMetadata: Stripe.MetadataParam = {
      userId,
      plan,
    };
    const subscriptionMetadata: Stripe.MetadataParam = {
      userId,
      plan,
    };
    if (src === "coach") {
      sessionMetadata.summittAcquisition = "coach";
      subscriptionMetadata.summittAcquisition = "coach";
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",

        client_reference_id: userId,

        line_items: [{ price: priceId, quantity: 1 }],

        allow_promotion_codes: true,

        // 🔥 Correct behavior for subscription mode
        customer: existingCustomerId || undefined,
        customer_email: existingCustomerId ? undefined : userEmail,

        metadata: sessionMetadata,

        subscription_data: {
          trial_period_days: 7,
          metadata: subscriptionMetadata,
        },

        success_url: `${appUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:
          src === "coach"
            ? `${appUrl}/subscribe?canceled=1&src=coach`
            : `${appUrl}/subscribe?canceled=1`,
      },
      { idempotencyKey: checkoutIdempotencyKey }
    );

    if (!session.url) {
      return new NextResponse("Failed to create checkout session", {
        status: 500,
      });
    }

    // Optional: Pre-link customer id immediately
    const customerId =
      typeof session.customer === "string" ? session.customer : null;

    if (customerId && customerId !== existingCustomerId) {
      try {
        await updateClerkPublicMetadata(userId, {
          stripeCustomerId: customerId,
        });
      } catch (err) {
        console.warn("Unable to pre-link stripeCustomerId:", err);
      }
    }

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Error creating checkout session:", err);
    return new NextResponse(
      "Internal Server Error creating checkout session",
      { status: 500 }
    );
  }
}
