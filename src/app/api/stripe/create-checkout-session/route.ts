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
  type SummittMembershipClass,
} from "@/lib/summitt-subscription-membership";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import { isNativeSummittMindsetAppRequestFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR } from "@/lib/native-app/membership-paths";
import {
  isSmsReplicaFailureAfterClerkSuccess,
  recomputeMembershipFromAuthoritativeStripeSubscription,
  resolveAppleMembershipGrantForUser,
} from "@/lib/summitt-membership-entitlement.server";
import {
  CHECKOUT_PENDING_BODY,
  CHECKOUT_PROCESSING_BODY,
  CHECKOUT_UNAVAILABLE_BODY,
  checkoutChannelFromSrc,
  checkoutCustomerIdempotencyKey,
  checkoutIdempotencyKeyV2,
  decidePendingCheckoutAction,
  isReusableOpenCheckoutSession,
  isStripeIdempotencyError,
  isUsableOpenCheckoutUrl,
  type PendingCheckoutSessionLike,
} from "@/lib/stripe-pending-checkout-session";

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

const OPEN_CHECKOUT_LIST_PAGE_SIZE = 100;
const OPEN_CHECKOUT_LIST_MAX_PAGES = 10;

function asPendingCheckoutSession(
  raw: Stripe.Checkout.Session
): PendingCheckoutSessionLike {
  return {
    id: raw.id,
    status: raw.status,
    mode: raw.mode,
    url: raw.url,
    client_reference_id: raw.client_reference_id,
    metadata: (raw.metadata ?? null) as Record<string, string> | null,
    line_items: raw.line_items
      ? { data: raw.line_items.data }
      : null,
  };
}

async function listOpenCheckoutSessionsForCustomer(args: {
  stripe: Stripe;
  customerId: string;
}): Promise<PendingCheckoutSessionLike[] | "lookup_failed"> {
  const out: PendingCheckoutSessionLike[] = [];
  let startingAfter: string | undefined;
  try {
    for (let page = 0; page < OPEN_CHECKOUT_LIST_MAX_PAGES; page += 1) {
      const listed = await args.stripe.checkout.sessions.list({
        customer: args.customerId,
        status: "open",
        limit: OPEN_CHECKOUT_LIST_PAGE_SIZE,
        starting_after: startingAfter,
        expand: ["data.line_items"],
      });
      for (const session of listed.data) {
        out.push(asPendingCheckoutSession(session));
      }
      if (!listed.has_more) return out;
      const lastId = listed.data[listed.data.length - 1]?.id;
      if (!lastId) return out;
      startingAfter = lastId;
    }
    console.error(
      "[stripe/create-checkout-session] open checkout list exceeded page cap; fail closed"
    );
    return "lookup_failed";
  } catch (err) {
    console.error(
      "[stripe/create-checkout-session] open checkout list failed; fail closed",
      err
    );
    return "lookup_failed";
  }
}

async function retrieveOpenCheckoutSession(args: {
  stripe: Stripe;
  sessionId: string;
}): Promise<PendingCheckoutSessionLike | "lookup_failed"> {
  try {
    const raw = await args.stripe.checkout.sessions.retrieve(args.sessionId, {
      expand: ["line_items"],
    });
    return asPendingCheckoutSession(raw);
  } catch (err) {
    console.error(
      "[stripe/create-checkout-session] checkout session retrieve failed; fail closed",
      err
    );
    return "lookup_failed";
  }
}

/**
 * Stable Stripe Customer for Checkout create params.
 * Clerk id is used when present; otherwise an idempotent customers.create
 * keyed only by Clerk user id. Session create always passes `customer`
 * and never an email prefill field, so v2 idempotency params stay stable.
 */
async function resolveStripeCustomerForCheckout(args: {
  stripe: Stripe;
  userId: string;
  userEmail: string;
  existingCustomerId: string | null;
}): Promise<string | "lookup_failed"> {
  if (args.existingCustomerId) return args.existingCustomerId;
  try {
    const customer = await args.stripe.customers.create(
      {
        email: args.userEmail,
        metadata: { userId: args.userId },
      },
      { idempotencyKey: checkoutCustomerIdempotencyKey(args.userId) }
    );
    const id = typeof customer.id === "string" ? customer.id.trim() : "";
    if (!id) return "lookup_failed";
    return id;
  } catch (err) {
    console.error(
      "[stripe/create-checkout-session] customer create failed; fail closed",
      err
    );
    return "lookup_failed";
  }
}

export async function POST(req: Request) {
  try {
    if (isNativeSummittMindsetAppRequestFromRequest(req)) {
      return NextResponse.json(
        { error: NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR },
        { status: 403 }
      );
    }

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

    const deletionGate =
      await assertEntitlementMutationAllowedForAccountDeletion(userId);
    if (!deletionGate.ok) {
      if (deletionGate.code === "lookup_failed") {
        console.error(
          "[stripe/create-checkout-session] account deletion lookup failed; fail closed"
        );
        return new NextResponse("Internal Server Error", { status: 500 });
      }
      return NextResponse.json(ACCOUNT_DELETION_IN_PROGRESS_BODY, {
        status: 409,
      });
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

    try {
      const appleGrant = await resolveAppleMembershipGrantForUser(userId);
      if (appleGrant?.grantsAccess === true) {
        console.log(
          "[stripe/create-checkout-session] blocked: Apple membership currently grants",
          { userId }
        );
        return NextResponse.json(
          {
            error: "already_subscribed",
            message: "You already have an active Summitt Mindset membership.",
          },
          { status: 409 }
        );
      }
    } catch (appleErr) {
      console.error(
        "[stripe/create-checkout-session] Apple grant lookup failed; fail closed",
        appleErr
      );
      return new NextResponse("Internal Server Error", { status: 500 });
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
          stripeCustomerId: blockingHit.customerId,
          stripeSubscriptionId: sub.id,
        };
        // Second guard: Stripe scan already found a sub; only skip local entitlement
        // restore if deletion began mid-flight (Stripe/Postgres/Clerk are not atomic).
        const secondGate =
          await assertEntitlementMutationAllowedForAccountDeletion(userId);
        if (!secondGate.ok) {
          if (secondGate.code === "lookup_failed") {
            console.error(
              "[stripe/create-checkout-session] reconcile second deletion lookup failed; fail closed"
            );
            return new NextResponse("Internal Server Error", { status: 500 });
          }
          return NextResponse.json(ACCOUNT_DELETION_IN_PROGRESS_BODY, {
            status: 409,
          });
        }
        await updateClerkPublicMetadata(userId, clerkPatch);
        const projection =
          await recomputeMembershipFromAuthoritativeStripeSubscription(
            userId,
            sub
          );
        if (isSmsReplicaFailureAfterClerkSuccess(projection)) {
          console.error(
            "[stripe/create-checkout-session] SMS replica failed after Clerk projection"
          );
        } else if (!projection.ok) {
          console.error(
            "[stripe/create-checkout-session] membership recompute failed during reconcile",
            projection.reason
          );
        }
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

    const channel = checkoutChannelFromSrc(src);
    const recognizedPriceIds = getRecognizedSummittPriceIds({
      monthly: monthlyPriceId,
      annual: annualPriceId,
      legacyCsv: process.env.STRIPE_LEGACY_PRICE_IDS,
    });

    const resolvedCustomerId = await resolveStripeCustomerForCheckout({
      stripe,
      userId,
      userEmail,
      existingCustomerId,
    });
    if (resolvedCustomerId === "lookup_failed") {
      return new NextResponse("Internal Server Error", { status: 500 });
    }
    if (resolvedCustomerId !== existingCustomerId) {
      try {
        await updateClerkPublicMetadata(userId, {
          stripeCustomerId: resolvedCustomerId,
        });
      } catch (err) {
        console.warn("Unable to pre-link stripeCustomerId:", err);
      }
    }

    const openSessions = await listOpenCheckoutSessionsForCustomer({
      stripe,
      customerId: resolvedCustomerId,
    });
    if (openSessions === "lookup_failed") {
      return new NextResponse("Internal Server Error", { status: 500 });
    }

    const pendingArgs = {
      userId,
      plan,
      channel,
      expectedPriceId: priceId,
      recognizedPriceIds,
    };
    const pendingDecision = decidePendingCheckoutAction(openSessions, pendingArgs);
    if (pendingDecision.kind === "conflict") {
      return NextResponse.json(CHECKOUT_PENDING_BODY, { status: 409 });
    }
    if (pendingDecision.kind === "reuse" || pendingDecision.kind === "retrieve") {
      let reusable = pendingDecision.session;
      if (pendingDecision.kind === "retrieve") {
        const sessionId =
          typeof reusable.id === "string" ? reusable.id.trim() : "";
        if (!sessionId) {
          return NextResponse.json(CHECKOUT_PENDING_BODY, { status: 409 });
        }
        const retrieved = await retrieveOpenCheckoutSession({
          stripe,
          sessionId,
        });
        if (retrieved === "lookup_failed") {
          return new NextResponse("Internal Server Error", { status: 500 });
        }
        reusable = retrieved;
      }
      if (
        isReusableOpenCheckoutSession(reusable, {
          userId,
          plan,
          channel,
          expectedPriceId: priceId,
        })
      ) {
        const reuseUrl = reusable.url;
        if (typeof reuseUrl === "string" && reuseUrl.trim()) {
          return NextResponse.json({ url: reuseUrl.trim() });
        }
      }
      return NextResponse.json(CHECKOUT_PENDING_BODY, { status: 409 });
    }

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

    const createParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer: resolvedCustomerId,
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
    };

    const primaryIdempotencyKey = checkoutIdempotencyKeyV2({
      userId,
      plan,
      channel,
    });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(createParams, {
        idempotencyKey: primaryIdempotencyKey,
      });
    } catch (createErr: unknown) {
      if (isStripeIdempotencyError(createErr)) {
        console.warn(
          "[stripe/create-checkout-session] Stripe idempotency error; not creating successor",
          { userId, plan, channel }
        );
        return NextResponse.json(CHECKOUT_UNAVAILABLE_BODY, { status: 409 });
      }
      throw createErr;
    }
    let usable = asPendingCheckoutSession(session);

    if (
      session.status === "open" &&
      !isUsableOpenCheckoutUrl(usable) &&
      session.id
    ) {
      const retrieved = await retrieveOpenCheckoutSession({
        stripe,
        sessionId: session.id,
      });
      if (retrieved === "lookup_failed") {
        return new NextResponse("Internal Server Error", { status: 500 });
      }
      usable = retrieved;
    }

    if (isUsableOpenCheckoutUrl(usable) && usable.url) {
      return NextResponse.json({ url: usable.url.trim() });
    }

    if (session.status === "complete") {
      const blockingAgain = await findBlockingSummittSubscription({
        stripe,
        clerkUserId: userId,
        userEmail,
        existingCustomerId: resolvedCustomerId,
      });
      if (blockingAgain) {
        const blockBody = checkoutBlockErrorForClass(blockingAgain.classification);
        return NextResponse.json(
          blockBody ?? {
            error: "already_subscribed",
            message: "You already have an active Summitt Mindset membership.",
          },
          { status: 409 }
        );
      }
      console.warn(
        "[stripe/create-checkout-session] idempotent replay returned complete session; not creating successor",
        { userId, sessionId: session.id }
      );
      return NextResponse.json(CHECKOUT_PROCESSING_BODY, { status: 409 });
    }

    console.warn(
      "[stripe/create-checkout-session] checkout session is not a usable open URL; fail closed",
      { userId, sessionId: session.id, status: session.status }
    );
    return NextResponse.json(CHECKOUT_UNAVAILABLE_BODY, { status: 409 });
  } catch (err: unknown) {
    console.error("Error creating checkout session:", err);
    return new NextResponse(
      "Internal Server Error creating checkout session",
      { status: 500 }
    );
  }
}
