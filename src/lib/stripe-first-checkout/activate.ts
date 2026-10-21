import "server-only";

import Stripe from "stripe";

import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import {
  matchFromCheckoutRequest,
  saveMetaCapiWebMatchForUser,
} from "@/lib/meta-capi-web-identifiers";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  isVisitorId,
  readAcquisitionCookieFromRequest,
} from "@/lib/marketing-attribution-pure";
import { parsePersonalVideoId } from "@/lib/personal-videos/analytics";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import { resolveStripeCheckoutReturnOrigin } from "@/lib/stripe-checkout-return-origin";
import {
  BINDING_MAX_AGE_SECONDS,
  CANARY_METADATA_KEY,
  CANARY_METADATA_VALUE,
  HOLD_METADATA_KEY,
  HOSTED_TEST_RETURN_PATH,
  PUBLIC_CHECKOUT_FLOW_KEY,
  PUBLIC_CHECKOUT_FLOW_VALUE,
  PUBLIC_CHECKOUT_RETURN_PATH,
  INTENT_METADATA_KEY,
  ONBOARDING_IDENTITY_PATH,
  STRIPE_FIRST_RESERVED_EMAIL_METADATA,
} from "@/lib/stripe-first-checkout/constants";
import {
  canaryCheckoutStartAllowed,
  checkoutSessionIdempotencyKey,
  hostedCheckoutCredentialModeFromEnv,
  hostedCompletionAllowed,
  stripeFirstServerLivemode,
  stripeKeyMatchesLivemode,
} from "@/lib/stripe-first-checkout/credentials";
import {
  checkoutSessionBindingMatches,
  hashCheckoutBinding,
  newCheckoutBinding,
} from "@/lib/stripe-first-checkout/binding";
import {
  createClerkSignInTicket,
  createReservedClerkUser,
  lookupClerkUserIdByExternalId,
  lookupClerkUserIdsByEmail,
} from "@/lib/stripe-first-checkout/clerk-provision";
import {
  bindingMaxAgeSeconds,
  duplicateTrialNextPath,
  entitlementFromStoredSubscription,
  priorCheckoutAction,
  publicCheckoutFinishUrl,
  type PriorSessionState,
} from "@/lib/stripe-first-checkout/checkout-reliability";
import {
  alignBindingExpiry,
  attachCheckoutSession,
  confirmStripeTrial,
  deleteUnstartedLiveIntent,
  insertCheckoutIntent,
  liveCanaryIntentExists,
  loadIntentByBindingHash,
  loadIntentById,
  loadIntentBySubscriptionId,
  markClerkProvisioned,
  saveCheckoutMatchFields,
  saveGoogleClickId,
  markSessionStartedForExistingUser,
  markSessionStartedForProvisionedUser,
  markSignInRequired,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";
import {
  isOwnerCanaryMetadata,
  notifyConfirmedStripeFirstTrial,
} from "@/lib/stripe-first-checkout/member-notify";
import {
  assessCheckoutSession,
  readCheckoutIntentId,
} from "@/lib/stripe-first-checkout/reconcile";
import { reconcileActivationHold } from "@/lib/stripe-first-checkout/stripe-hold";
import { recomputeMembershipFromAuthoritativeStripeSubscription } from "@/lib/summitt-membership-entitlement.server";
import { resolveAppleMembershipGrantForUser } from "@/lib/summitt-membership-entitlement.server";
import {
  classifySummittMembership,
  resolvePlanFromSubscription,
} from "@/lib/summitt-subscription-membership";

export type ActivateResult =
  | { status: "ticket"; ticket: string }
  | { status: "sign_in_required" }
  | { status: "continue" }
  | { status: "preserved" }
  | { status: "incomplete" }
  | { status: "unprotected" }
  | { status: "rejected" }
  | { status: "retry" };

export type ConfirmResult =
  | { status: "ready"; next: string }
  | { status: "preserved"; next: string }
  | { status: "rejected" }
  | { status: "retry" };

export type LinkResult =
  | { status: "linked"; next: string }
  | { status: "already_member"; next: string }
  | { status: "not_linked"; next: string }
  | { status: "rejected" }
  | { status: "retry" };

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  return new Stripe(key);
}

function assertHostedCredentials(): "test" | "canary" {
  const mode = hostedCheckoutCredentialModeFromEnv();
  if (mode !== "test" && mode !== "canary") {
    throw new Error("hosted_credentials_required");
  }
  return mode;
}

async function captureCheckoutMatch(intentId: string, request: Request): Promise<void> {
  try {
    const match = await matchFromCheckoutRequest(request);
    await saveCheckoutMatchFields({
      intentId,
      fbc: match.fbc,
      fbp: match.fbp,
      clientIp: match.clientIpAddress,
      clientUserAgent: match.clientUserAgent,
    });
  } catch {
    console.warn("[stripe-first] checkout match capture failed");
  }
}

async function captureGoogleClickId(intentId: string, request: Request): Promise<void> {
  try {
    const attribution = readAcquisitionCookieFromRequest(request);
    if (
      !attribution ||
      attribution.source_normalized !== "google" ||
      !attribution.is_paid_acquisition ||
      !attribution.google_click_id_type ||
      !attribution.google_click_id
    ) {
      return;
    }
    await saveGoogleClickId({
      intentId,
      type: attribution.google_click_id_type,
      value: attribution.google_click_id,
    });
  } catch {
    console.warn("[stripe-first] google click id capture failed");
  }
}

async function copyCheckoutMatchToClerkUser(
  subscriptionId: string,
  clerkUserId: string
): Promise<void> {
  try {
    const intent = await loadIntentBySubscriptionId(subscriptionId);
    if (!intent) return;
    await saveMetaCapiWebMatchForUser({
      userId: clerkUserId,
      match: {
        fbc: intent.meta_fbc,
        fbp: intent.meta_fbp,
        clientIpAddress: intent.client_ip,
        clientUserAgent: intent.client_user_agent,
      },
    });
  } catch {
    console.warn("[stripe-first] checkout match copy failed");
  }
}

function priceIdForPlan(plan: "monthly" | "annual"): string | null {
  const raw =
    plan === "annual"
      ? process.env.STRIPE_PRICE_ID_ANNUAL
      : process.env.STRIPE_PRICE_ID_MONTHLY;
  const priceId = raw?.trim() ?? "";
  return priceId || null;
}

function submitMessage(plan: "monthly" | "annual"): string {
  if (plan === "annual") {
    return "**$0 due today.** 7 days free, then $249/year. Cancel anytime. After checkout, you'll set up Coach Pat.";
  }
  return "**$0 due today.** 7 days free, then $29/month. Cancel anytime. After checkout, you'll set up Coach Pat.";
}

export async function beginHostedCheckout(args: {
  request: Request;
  plan: "monthly" | "annual";
  visitorCookie: string | null;
  experimentId: string | null;
  experimentVariant: "control" | "challenger" | null;
  /** Public signup. Does not use the owner-canary switch. */
  publicCheckout?: boolean;
  attribution?: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    sourceNormalized: string | null;
  };
  /** Ready personal video visited in the last 30 days. Omitted from canary checkout. */
  personalVideoId?: string | null;
}): Promise<{
  url: string;
  bindingSecret: string;
  sessionId: string;
  bindingMaxAgeSeconds: number;
}> {
  const publicCheckout = args.publicCheckout === true;
  let canary = false;
  let livemode = false;
  if (publicCheckout) {
    const serverLivemode = stripeFirstServerLivemode({
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      clerkSecretKey: process.env.CLERK_SECRET_KEY,
    });
    if (serverLivemode == null) throw new Error("hosted_credentials_required");
    livemode = serverLivemode;
  } else {
    const mode = assertHostedCredentials();
    canary = mode === "canary";
    livemode = canary;
    const liveIntentExists = canary ? await liveCanaryIntentExists() : false;
    if (
      !canaryCheckoutStartAllowed({
        mode,
        plan: args.plan,
        liveIntentExists,
      })
    ) {
      throw new Error(liveIntentExists ? "canary_already_used" : "hosted_checkout_refused");
    }
  }
  const priceId = priceIdForPlan(args.plan);
  if (!priceId) throw new Error("missing_price");

  const binding = newCheckoutBinding();
  const visitorId =
    canary || !isVisitorId(args.visitorCookie) ? null : args.visitorCookie;
  const experimentId = canary ? null : args.experimentId;
  const experimentVariant = canary ? null : args.experimentVariant;
  const personalVideoId = publicCheckout ? parsePersonalVideoId(args.personalVideoId) : null;
  const intent = await insertCheckoutIntent({
    bindingHash: binding.hash,
    bindingExpiresAt: new Date(Date.now() + BINDING_MAX_AGE_SECONDS * 1000).toISOString(),
    visitorId,
    experimentId,
    experimentVariant,
    livemode,
  });

  if (!canary) {
    await captureCheckoutMatch(intent.id, args.request);
    await captureGoogleClickId(intent.id, args.request);
  }

  const origin = resolveStripeCheckoutReturnOrigin(args.request);
  const stripe = stripeClient();
  let session: Stripe.Checkout.Session | null = null;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        custom_text: { submit: { message: submitMessage(args.plan) } },
        metadata: {
          [INTENT_METADATA_KEY]: intent.id,
          plan: args.plan,
          ...(canary ? { [CANARY_METADATA_KEY]: CANARY_METADATA_VALUE } : {}),
          ...(publicCheckout
            ? { [PUBLIC_CHECKOUT_FLOW_KEY]: PUBLIC_CHECKOUT_FLOW_VALUE }
            : {}),
          ...(visitorId ? { visitorId } : {}),
          ...(experimentId && experimentVariant
            ? { experimentId, experimentVariant }
            : {}),
          ...(args.attribution?.utmSource ? { utm_source: args.attribution.utmSource } : {}),
          ...(args.attribution?.utmMedium ? { utm_medium: args.attribution.utmMedium } : {}),
          ...(args.attribution?.utmCampaign ? { utm_campaign: args.attribution.utmCampaign } : {}),
          ...(args.attribution?.utmContent ? { utm_content: args.attribution.utmContent } : {}),
          ...(args.attribution?.sourceNormalized
            ? { sourceNormalized: args.attribution.sourceNormalized }
            : {}),
          ...(personalVideoId ? { personalVideoId } : {}),
        },
        subscription_data: {
          trial_period_days: 7,
          metadata: {
            [INTENT_METADATA_KEY]: intent.id,
            plan: args.plan,
            [HOLD_METADATA_KEY]: "pending",
            ...(canary ? { [CANARY_METADATA_KEY]: CANARY_METADATA_VALUE } : {}),
            ...(publicCheckout
              ? { [PUBLIC_CHECKOUT_FLOW_KEY]: PUBLIC_CHECKOUT_FLOW_VALUE }
              : {}),
            ...(visitorId ? { visitorId } : {}),
            ...(experimentId && experimentVariant
              ? { experimentId, experimentVariant }
              : {}),
            ...(personalVideoId ? { personalVideoId } : {}),
          },
        },
        success_url: `${origin}${
          publicCheckout ? PUBLIC_CHECKOUT_RETURN_PATH : HOSTED_TEST_RETURN_PATH
        }?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: publicCheckout
          ? `${origin}/checkout/start?canceled=1${args.plan === "annual" ? "&plan=annual" : ""}`
          : `${origin}/checkout/hosted-test?canceled=1`,
      },
      {
        idempotencyKey: checkoutSessionIdempotencyKey(intent.id),
      }
    );

    if (!session.url || session.livemode !== livemode) {
      const expired = session.id
        ? await stripe.checkout.sessions
            .expire(session.id)
            .then(() => true)
            .catch(() => false)
        : false;
      if (canary && expired) await deleteUnstartedLiveIntent(intent.id);
      throw new Error(livemode ? "livemode_required" : "livemode_refused");
    }

    const attached = await attachCheckoutSession({
      intentId: intent.id,
      sessionId: session.id,
    });
    if (!attached) throw new Error("intent_update_failed");
    const maxAgeSeconds = bindingMaxAgeSeconds(session.expires_at, Date.now());
    await alignBindingExpiry({
      intentId: intent.id,
      bindingExpiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
    });
    return {
      url: session.url,
      bindingSecret: binding.secret,
      sessionId: session.id,
      bindingMaxAgeSeconds: maxAgeSeconds,
    };
  } catch (err) {
    if (canary && !session?.id) await deleteUnstartedLiveIntent(intent.id);
    throw err;
  }
}

function sessionState(status: string | null | undefined): PriorSessionState {
  if (status === "open" || status === "complete" || status === "expired") return status;
  return "unknown";
}

function stripeErrorCode(err: unknown): string {
  if (!err || typeof err !== "object" || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

/**
 * Expire only when the follow-up read is still expired.
 * A payment that completes during expire stays "complete" and keeps its binding.
 */
async function retireOpenCheckoutSession(sessionId: string): Promise<PriorSessionState | "failed"> {
  const stripe = stripeClient();
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch {
    try {
      const current = await stripe.checkout.sessions.retrieve(sessionId);
      return sessionState(current.status);
    } catch {
      return "failed";
    }
  }
  try {
    const current = await stripe.checkout.sessions.retrieve(sessionId);
    return sessionState(current.status);
  } catch {
    return "failed";
  }
}

export type PublicCheckoutResume =
  | {
      action: "reuse" | "finish";
      url: string;
      bindingSecret: string;
      maxAgeSeconds: number;
    }
  | { action: "replace" }
  | { action: "keep" };

/**
 * Second public start. Reuses the open session, or expires it before a new
 * binding is issued. Does not rotate the cookie when expiration is uncertain
 * or when payment won the race.
 */
export async function resumeOrReplacePublicCheckout(args: {
  bindingSecret: string | undefined;
  plan: "monthly" | "annual";
  request: Request;
  /** Signed-in checkout must not leave an older anonymous session payable. */
  displaceOpenSession?: boolean;
}): Promise<PublicCheckoutResume> {
  if (!args.bindingSecret) return { action: "replace" };
  const intent = await loadIntentByBindingHash(hashCheckoutBinding(args.bindingSecret));
  if (!intent?.stripe_checkout_session_id) return { action: "replace" };

  const stripe = stripeClient();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(intent.stripe_checkout_session_id);
  } catch {
    return { action: "keep" };
  }
  if (session.metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE) {
    if (session.status === "open") {
      const after = await retireOpenCheckoutSession(session.id);
      const action = priorCheckoutAction({
        status: "open",
        samePlan: false,
        hasUrl: false,
        expireResult: after,
      });
      if (action === "replace") return { action: "replace" };
      return { action: "keep" };
    }
    return { action: "replace" };
  }

  const status = sessionState(session.status);
  const samePlan = session.metadata?.plan === args.plan;
  const hasUrl = typeof session.url === "string" && session.url.length > 0;
  let action = priorCheckoutAction({
    status,
    samePlan: args.displaceOpenSession ? false : samePlan,
    hasUrl: args.displaceOpenSession ? false : hasUrl,
  });
  if (status === "open" && action !== "reuse") {
    const after = await retireOpenCheckoutSession(session.id);
    action = priorCheckoutAction({
      status: "open",
      samePlan,
      hasUrl,
      expireResult: after,
    });
    if (after === "complete") {
      session = await stripe.checkout.sessions.retrieve(session.id);
    }
  }

  const maxAgeSeconds = bindingMaxAgeSeconds(session.expires_at, Date.now());
  if (action === "reuse" && session.url) {
    await alignBindingExpiry({
      intentId: intent.id,
      bindingExpiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
    });
    await captureCheckoutMatch(intent.id, args.request);
    await captureGoogleClickId(intent.id, args.request);
    return {
      action: "reuse",
      url: session.url,
      bindingSecret: args.bindingSecret,
      maxAgeSeconds,
    };
  }
  if (action === "finish") {
    const origin = resolveStripeCheckoutReturnOrigin(args.request);
    return {
      action: "finish",
      url: publicCheckoutFinishUrl(origin, session.id),
      bindingSecret: args.bindingSecret,
      maxAgeSeconds,
    };
  }
  if (action === "replace") return { action: "replace" };
  return { action: "keep" };
}

async function finishActivationHold(
  intentId: string
): Promise<{ status: "ready" } | { status: "preserved" } | { status: "retry" }> {
  const hold = await reconcileActivationHold(intentId);
  if (hold === "retry" || hold === "unprotected") return { status: "retry" };
  if (hold === "preserved") return { status: "preserved" };
  return { status: "ready" };
}

async function requireBoundIntent(bindingSecret: string): Promise<CheckoutBrowserIntent | null> {
  if (!bindingSecret) return null;
  const intent = await loadIntentByBindingHash(hashCheckoutBinding(bindingSecret));
  if (!intent) return null;
  if (!intent.stripe_checkout_session_id) return null;
  if (Date.parse(intent.binding_expires_at) < Date.now()) {
    try {
      const session = await stripeClient().checkout.sessions.retrieve(
        intent.stripe_checkout_session_id
      );
      const sessionExpiresMs = (session.expires_at ?? 0) * 1000;
      if (!sessionExpiresMs || sessionExpiresMs < Date.now()) return null;
    } catch {
      return null;
    }
  }
  if (
    !hostedCompletionAllowed({
      bindingCookiePresent: true,
      sessionStored: true,
      intentLivemode: intent.livemode,
      serverMode: hostedCheckoutCredentialModeFromEnv(),
    })
  ) {
    return null;
  }
  return intent;
}

async function requireTrial(intent: CheckoutBrowserIntent, sessionId: string) {
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const matches = checkoutSessionBindingMatches({
    requestedSessionId: sessionId,
    storedSessionId: intent.stripe_checkout_session_id,
    retrievedSessionId: session.id,
    retrievedIntentId: readCheckoutIntentId(session.metadata),
    intentId: intent.id,
  });
  if (!matches || session.livemode !== intent.livemode) return { session, proof: null };
  const proof = await assessCheckoutSession(session);
  return { session, proof };
}

async function protectTrial(intentId: string): Promise<ActivateResult | null> {
  const hold = await reconcileActivationHold(intentId);
  if (hold === "retry") return { status: "retry" };
  if (hold === "unprotected") return { status: "unprotected" };
  if (hold === "preserved") return { status: "incomplete" };
  return null;
}

async function linkProviderIdentity(args: {
  clerkUserId: string;
  customerId: string;
  subscriptionId: string;
  plan: string | null;
  markReservedCheckoutEmail?: boolean;
}) {
  const stripe = stripeClient();
  await stripe.customers.update(args.customerId, {
    metadata: { userId: args.clerkUserId },
  });
  await stripe.subscriptions.update(args.subscriptionId, {
    metadata: {
      userId: args.clerkUserId,
      ...(args.plan ? { plan: args.plan } : {}),
    },
  });
  const subscription = await stripe.subscriptions.retrieve(args.subscriptionId);
  await updateClerkPublicMetadata(args.clerkUserId, {
    stripeCustomerId: args.customerId,
    stripeSubscriptionId: args.subscriptionId,
    ...(args.markReservedCheckoutEmail
      ? { [STRIPE_FIRST_RESERVED_EMAIL_METADATA]: true }
      : {}),
  });
  await recomputeMembershipFromAuthoritativeStripeSubscription(
    args.clerkUserId,
    subscription
  );
  await copyCheckoutMatchToClerkUser(args.subscriptionId, args.clerkUserId);
}

async function issueTicketIfNeeded(intent: CheckoutBrowserIntent): Promise<ActivateResult> {
  const fresh = await loadIntentById(intent.id);
  if (!fresh?.clerk_user_id || !fresh.clerk_user_provisioned_at || fresh.sign_in_required_at) {
    return { status: "retry" };
  }
  if (fresh.session_started_at) return { status: "continue" };
  const ticket = await createClerkSignInTicket(fresh.clerk_user_id);
  return { status: "ticket", ticket };
}

async function provisionNewCustomer(
  intent: CheckoutBrowserIntent,
  email: string,
  proof: Extract<Awaited<ReturnType<typeof assessCheckoutSession>>, { ok: true }>
): Promise<ActivateResult> {
  const externalUserId = await lookupClerkUserIdByExternalId(intent.id);
  const emailUserIds = await lookupClerkUserIdsByEmail(email);
  const emailOwnerIsSomeoneElse = emailUserIds.some((id) => id !== externalUserId);

  const ownerCanary = proof.subscription.metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE;
  if (emailOwnerIsSomeoneElse || (emailUserIds.length > 0 && !externalUserId)) {
    if (ownerCanary) return { status: "rejected" };
    const marked = await markSignInRequired(intent.id);
    if (!marked) {
      const fresh = await loadIntentById(intent.id);
      if (fresh?.clerk_user_provisioned_at && fresh.clerk_user_id) {
        return issueTicketIfNeeded(fresh);
      }
    }
    return { status: "sign_in_required" };
  }

  let clerkUserId = externalUserId;
  if (!clerkUserId) {
    const created = await createReservedClerkUser({
      email,
      externalId: intent.id,
    });
    if ("conflict" in created) {
      clerkUserId = await lookupClerkUserIdByExternalId(intent.id);
      if (!clerkUserId) {
        const taken = await lookupClerkUserIdsByEmail(email);
        if (taken.length > 0) {
          if (ownerCanary) return { status: "rejected" };
          await markSignInRequired(intent.id);
          return { status: "sign_in_required" };
        }
        return { status: "retry" };
      }
    } else {
      clerkUserId = created.id;
    }
  }

  const marked = await markClerkProvisioned({
    intentId: intent.id,
    clerkUserId,
  });
  if (!marked) {
    const fresh = await loadIntentById(intent.id);
    if (fresh?.sign_in_required_at && !fresh.clerk_user_provisioned_at) {
      return { status: "sign_in_required" };
    }
    if (fresh?.clerk_user_id !== clerkUserId || !fresh.clerk_user_provisioned_at) {
      return { status: "retry" };
    }
  }

  const plan = proof.subscription.metadata?.plan;
  await linkProviderIdentity({
    clerkUserId,
    customerId: proof.customerId,
    subscriptionId: proof.subscriptionId,
    plan: plan === "monthly" || plan === "annual" ? plan : null,
    markReservedCheckoutEmail: true,
  });
  await linkMarketingVisitorToClerkUser(clerkUserId);
  return issueTicketIfNeeded(intent);
}

/**
 * Browser return. POST only. A copied success URL fails without the binding cookie.
 * Does not sign into an existing Clerk account.
 */
export async function activateHostedCheckout(args: {
  sessionId: string;
  bindingSecret: string;
}): Promise<ActivateResult> {
  try {
    const intent = await requireBoundIntent(args.bindingSecret);
    if (!intent) return { status: "rejected" };
    if (intent.session_started_at && intent.clerk_user_provisioned_at) {
      const finished = await finishActivationHold(intent.id);
      if (finished.status === "retry") return { status: "retry" };
      if (finished.status === "preserved") return { status: "preserved" };
      return { status: "continue" };
    }
    if (intent.sign_in_required_at && !intent.session_started_at) {
      return { status: "sign_in_required" };
    }

    const { session, proof } = await requireTrial(intent, args.sessionId);
    if (!proof) return { status: "rejected" };
    if (!proof.ok) {
      return proof.reason === "retry" ? { status: "retry" } : { status: "incomplete" };
    }

    const saved = await confirmStripeTrial({
      intentId: intent.id,
      sessionId: args.sessionId,
      customerId: proof.customerId,
      subscriptionId: proof.subscriptionId,
      email: proof.email,
      trialEndIso: new Date(proof.trialEndUnix * 1000).toISOString(),
    });
    if (saved === "mismatch") return { status: "rejected" };

    if (saved === "saved" || saved === "already") {
      try {
        await notifyConfirmedStripeFirstTrial({
          ownerCanary:
            isOwnerCanaryMetadata(session.metadata) ||
            isOwnerCanaryMetadata(proof.subscription.metadata),
          subscriptionStatus: proof.subscription.status,
          paused: proof.subscription.pause_collection != null,
          clerkUserId: intent.clerk_user_id,
          email: proof.email,
          name: session.customer_details?.name ?? null,
          phone: session.customer_details?.phone ?? null,
          customerId: proof.customerId,
          subscriptionId: proof.subscriptionId,
          checkoutSessionId: session.id,
          plan: resolvePlanFromSubscription(proof.subscription),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.warn("[stripe-first] member notification failed", err);
      }
    }

    const blocked = await protectTrial(intent.id);
    if (blocked) return blocked;

    return provisionNewCustomer(intent, proof.email, proof);
  } catch (err) {
    console.error("[stripe-first] activate failed", {
      reason: err instanceof Error ? err.message : "activate_failed",
    });
    return { status: "retry" };
  }
}

export async function confirmHostedSession(args: {
  bindingSecret: string;
  clerkUserId: string;
}): Promise<ConfirmResult> {
  try {
    const intent = await requireBoundIntent(args.bindingSecret);
    if (!intent?.clerk_user_id || intent.clerk_user_id !== args.clerkUserId) {
      return { status: "rejected" };
    }
    if (intent.sign_in_required_at || !intent.clerk_user_provisioned_at) {
      return { status: "rejected" };
    }
    if (!intent.session_started_at) {
      const started = await markSessionStartedForProvisionedUser(intent.id, args.clerkUserId);
      if (!started) {
        const fresh = await loadIntentById(intent.id);
        if (!fresh?.session_started_at) return { status: "retry" };
      }
    }
    const finished = await finishActivationHold(intent.id);
    if (finished.status === "retry") return { status: "retry" };
    if (finished.status === "preserved") {
      return { status: "preserved", next: "/post-sign-in" };
    }
    return { status: "ready", next: ONBOARDING_IDENTITY_PATH };
  } catch (err) {
    console.error("[stripe-first] confirm session failed", {
      reason: err instanceof Error ? err.message : "confirm_failed",
    });
    return { status: "retry" };
  }
}

async function cancelUnlinkedTrial(subscriptionId: string) {
  await stripeClient().subscriptions.cancel(subscriptionId);
}

async function existingEntitlement(args: {
  clerkUserId: string;
  newSubscriptionId: string;
}): Promise<"apple" | "stripe" | "paused" | "past_due" | "retry" | null> {
  const apple = await resolveAppleMembershipGrantForUser(args.clerkUserId);
  if (apple?.grantsAccess) return "apple";

  const metadata = await getClerkPublicMetadata(args.clerkUserId);
  const existingId =
    typeof metadata.stripeSubscriptionId === "string"
      ? metadata.stripeSubscriptionId.trim()
      : "";
  if (!existingId || existingId === args.newSubscriptionId) return null;

  let existing: Stripe.Subscription;
  try {
    existing = await stripeClient().subscriptions.retrieve(existingId);
  } catch (err) {
    if (stripeErrorCode(err) === "resource_missing") {
      return entitlementFromStoredSubscription({ kind: "missing" });
    }
    throw err;
  }
  if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, existing.livemode)) {
    return entitlementFromStoredSubscription({ kind: "unavailable" });
  }
  return entitlementFromStoredSubscription({
    kind: "found",
    classification: classifySummittMembership(existing),
  });
}

/**
 * Existing email path, after the person signs in with their email code.
 * Does not set clerk_user_provisioned_at.
 */
export async function linkExistingHostedCheckout(args: {
  bindingSecret: string;
  clerkUserId: string;
  signedInEmail: string;
}): Promise<LinkResult> {
  try {
    const intent = await requireBoundIntent(args.bindingSecret);
    if (!intent) return { status: "rejected" };
    if (!intent.sign_in_required_at || intent.clerk_user_provisioned_at) {
      return { status: "rejected" };
    }
    if (!intent.email || intent.email !== args.signedInEmail) {
      return { status: "rejected" };
    }
    if (!intent.stripe_subscription_id || !intent.stripe_customer_id) {
      return { status: "retry" };
    }
    const opened = await stripeClient().subscriptions.retrieve(intent.stripe_subscription_id);
    if (opened.metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE) {
      return { status: "rejected" };
    }
    const entitlement = await existingEntitlement({
      clerkUserId: args.clerkUserId,
      newSubscriptionId: intent.stripe_subscription_id,
    });
    if (entitlement === "retry") return { status: "retry" };
    if (entitlement) {
      const current = await stripeClient().subscriptions.retrieve(intent.stripe_subscription_id);
      if (current.status !== "canceled") {
        await cancelUnlinkedTrial(intent.stripe_subscription_id);
      }
      const started = await markSessionStartedForExistingUser({
        intentId: intent.id,
        clerkUserId: args.clerkUserId,
      });
      if (!started && !intent.session_started_at) {
        const fresh = await loadIntentById(intent.id);
        if (fresh?.clerk_user_id !== args.clerkUserId) return { status: "retry" };
      }
      return {
        status: "already_member",
        next: duplicateTrialNextPath(entitlement),
      };
    }

    await linkProviderIdentity({
      clerkUserId: args.clerkUserId,
      customerId: intent.stripe_customer_id,
      subscriptionId: intent.stripe_subscription_id,
      plan: null,
    });
    const started = await markSessionStartedForExistingUser({
      intentId: intent.id,
      clerkUserId: args.clerkUserId,
    });
    if (!started) {
      const fresh = await loadIntentById(intent.id);
      if (fresh?.clerk_user_id !== args.clerkUserId || !fresh.session_started_at) {
        return { status: "retry" };
      }
    }
    const hold = await reconcileActivationHold(intent.id);
    if (hold === "retry" || hold === "unprotected") return { status: "retry" };
    await linkMarketingVisitorToClerkUser(args.clerkUserId);
    return { status: "linked", next: ONBOARDING_IDENTITY_PATH };
  } catch (err) {
    console.error("[stripe-first] link existing failed", {
      reason: err instanceof Error ? err.message : "link_failed",
    });
    return { status: "retry" };
  }
}
