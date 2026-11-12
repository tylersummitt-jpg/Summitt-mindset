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
import { trustedRequestCountryFromRequest } from "@/lib/stripe-first-checkout/request-country";
import {
  ACQUISITION_JOURNEY_METADATA_KEY,
  ACQUISITION_JOURNEY_QUERY,
  acquisitionJourneyTokenShape,
  parseAcquisitionJourneyId,
} from "@/lib/acquisition/email-acquired-member-notice";
import { noteAcquisitionClerk } from "@/lib/acquisition/store";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import { publicCheckoutOfferMatches } from "@/lib/partner-annual-checkout";
import { loadValidatedPartnerAnnualPrice } from "@/lib/partner-annual-price.server";
import { parsePartnerChannel, parsePartnerKey } from "@/lib/partner-landing";
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
  getClerkIdentity,
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
  loadConfirmedIntentsForEmail,
  loadIntentByBindingHash,
  loadIntentById,
  loadIntentBySubscriptionId,
  loadResumeCandidateIntents,
  markClerkProvisioned,
  markHoldConfirmedAndReleased,
  markHoldReleased,
  markResumeSignInRequired,
  saveCheckoutMatchFields,
  saveCheckoutRequestCountry,
  saveGoogleClickId,
  markSessionStartedForExistingUser,
  markSessionStartedForProvisionedUser,
  markSignInRequired,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";
import { maybeNotifyEmailAcquiredMember } from "@/lib/acquisition/email-acquired-member-notice.server";
import {
  isOwnerCanaryMetadata,
  notifyConfirmedStripeFirstTrial,
  stripeFirstMemberNotification,
} from "@/lib/stripe-first-checkout/member-notify";
import {
  assessCheckoutSession,
  readCheckoutIntentId,
} from "@/lib/stripe-first-checkout/reconcile";
import { decideCheckoutContinueAccess } from "@/lib/stripe-first-checkout/checkout-reliability";
import { normalizeCheckoutEmail } from "@/lib/stripe-first-checkout/email-typo";
import { decideHold, unixFromIso } from "@/lib/stripe-first-checkout/hold-decision";
import {
  decideResumeStripe,
  type ResumeStripeSnapshot,
} from "@/lib/stripe-first-checkout/resume-eligibility";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
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

async function captureCheckoutRequestCountry(
  intentId: string,
  request: Request
): Promise<void> {
  try {
    const country = trustedRequestCountryFromRequest(request);
    if (!country) return;
    await saveCheckoutRequestCountry({ intentId, country });
  } catch {
    console.warn("[stripe-first] checkout country capture failed");
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

function submitMessage(plan: "monthly" | "annual" | "partner_annual"): string {
  if (plan === "partner_annual") {
    return "**$0 due today.** 7 days free, then $179/year. Cancel anytime. After checkout, you'll set up Coach Pat.";
  }
  if (plan === "annual") {
    return "**$0 due today.** 7 days free, then $249/year. Cancel anytime. After checkout, you'll set up Coach Pat.";
  }
  return "**$0 due today.** 7 days free, then $29/month. Cancel anytime. After checkout, you'll set up Coach Pat.";
}

export async function beginHostedCheckout(args: {
  request: Request;
  plan: "monthly" | "annual" | "partner_annual";
  visitorCookie: string | null;
  experimentId: string | null;
  experimentVariant: "control" | "challenger" | null;
  /** Public signup. Does not use the owner-canary switch. */
  publicCheckout?: boolean;
  partner?: string | null;
  partnerChannel?: "email" | "social" | "unknown" | null;
  attribution?: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    sourceNormalized: string | null;
  };
  /** Ready personal video visited in the last 30 days. Omitted from canary checkout. */
  personalVideoId?: string | null;
  /** Verified journey id. Stored on the Stripe subscription. Not an email match. */
  acquisitionJourneyId?: string | null;
  /** Signed token returned on cancel so a retry can be verified again. */
  acquisitionJourneyToken?: string | null;
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
    if (args.plan === "partner_annual") throw new Error("hosted_checkout_refused");
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
  const partnerKey = args.plan === "partner_annual" ? parsePartnerKey(args.partner) : null;
  if (args.plan === "partner_annual" && !partnerKey) throw new Error("missing_partner");
  const partnerChannel =
    args.plan === "partner_annual" ? parsePartnerChannel(args.partnerChannel) : null;
  let priceId: string | null;
  if (args.plan === "partner_annual") {
    const validated = await loadValidatedPartnerAnnualPrice({ fresh: true });
    if (!validated.ok) {
      console.error("[partner-annual] price rejected", { reason: validated.reason });
      priceId = null;
    } else {
      priceId = validated.priceId;
    }
  } else {
    priceId = priceIdForPlan(args.plan);
  }
  if (!priceId) throw new Error("missing_price");

  const binding = newCheckoutBinding();
  const visitorId =
    canary || !isVisitorId(args.visitorCookie) ? null : args.visitorCookie;
  const experimentId = canary ? null : args.experimentId;
  const experimentVariant = canary ? null : args.experimentVariant;
  const personalVideoId = publicCheckout ? parsePersonalVideoId(args.personalVideoId) : null;
  const acquisitionJourneyId = canary ? null : parseAcquisitionJourneyId(args.acquisitionJourneyId);
  const acquisitionJourneyToken = acquisitionJourneyTokenShape(args.acquisitionJourneyToken);
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
  await captureCheckoutRequestCountry(intent.id, args.request);

  const origin = resolveStripeCheckoutReturnOrigin(args.request);
  const stripe = stripeClient();
  let session: Stripe.Checkout.Session | null = null;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: args.plan === "partner_annual" ? false : true,
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
          ...(acquisitionJourneyId
            ? { [ACQUISITION_JOURNEY_METADATA_KEY]: acquisitionJourneyId }
            : {}),
          ...(partnerKey
            ? { partner: partnerKey, partner_channel: partnerChannel ?? "unknown" }
            : {}),
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
            ...(acquisitionJourneyId
              ? { [ACQUISITION_JOURNEY_METADATA_KEY]: acquisitionJourneyId }
              : {}),
            ...(partnerKey
              ? { partner: partnerKey, partner_channel: partnerChannel ?? "unknown" }
              : {}),
          },
        },
        success_url: `${origin}${
          publicCheckout ? PUBLIC_CHECKOUT_RETURN_PATH : HOSTED_TEST_RETURN_PATH
        }?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: publicCheckout
          ? `${origin}/checkout/start?canceled=1${
              args.plan === "annual"
                ? "&plan=annual"
                : args.plan === "partner_annual" && partnerKey
                  ? `&plan=partner_annual&partner=${encodeURIComponent(partnerKey)}&channel=${encodeURIComponent(partnerChannel ?? "unknown")}`
                  : ""
            }${
              acquisitionJourneyToken
                ? `&${ACQUISITION_JOURNEY_QUERY}=${encodeURIComponent(acquisitionJourneyToken)}`
                : ""
            }`
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
  plan: "monthly" | "annual" | "partner_annual";
  partner?: string | null;
  partnerChannel?: "email" | "social" | "unknown" | null;
  request: Request;
  /** Signed-in checkout must not leave an older anonymous session payable. */
  displaceOpenSession?: boolean;
  acquisitionJourneyId?: string | null;
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
  const samePlan = publicCheckoutOfferMatches({
    sessionPlan: session.metadata?.plan,
    sessionPartner: session.metadata?.partner,
    sessionChannel: session.metadata?.partner_channel,
    sessionJourney: parseAcquisitionJourneyId(session.metadata?.[ACQUISITION_JOURNEY_METADATA_KEY]),
    plan: args.plan,
    partner: args.partner ?? null,
    channel: args.partnerChannel ?? "unknown",
    journey: parseAcquisitionJourneyId(args.acquisitionJourneyId),
  });
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
    await captureCheckoutRequestCountry(intent.id, args.request);
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

export type CheckoutContinueHttpResult =
  | { http: 200; body: { status: "continue" } }
  | { http: 200; body: { status: "account_mismatch"; signedIn: boolean } }
  | { http: 503; body: { error: "retry" } }
  | { http: 403; body: { error: "rejected" } };

/**
 * Already-started checkout. Identity is allowed only when the Clerk session
 * from auth() is the user stored on this binding's intent.
 * The request body is not an identity source. Stripe is not read again here.
 */
export async function checkoutContinueHttpResult(args: {
  bindingSecret: string;
  authenticatedClerkUserId: string | null;
}): Promise<CheckoutContinueHttpResult> {
  try {
    const intent = await requireBoundIntent(args.bindingSecret);
    const access = decideCheckoutContinueAccess({
      bindingOk: Boolean(intent),
      sessionStarted: Boolean(intent?.session_started_at),
      provisioned: Boolean(intent?.clerk_user_provisioned_at),
      intentClerkUserId: intent?.clerk_user_id ?? null,
      authenticatedClerkUserId: args.authenticatedClerkUserId,
    });
    if (access === "allow") return { http: 200, body: { status: "continue" } };
    if (access === "unsigned") {
      return { http: 200, body: { status: "account_mismatch", signedIn: false } };
    }
    if (access === "mismatch") {
      return { http: 200, body: { status: "account_mismatch", signedIn: true } };
    }
    return { http: 403, body: { error: "rejected" } };
  } catch {
    console.error("[stripe-first] continue authorization failed");
    return { http: 503, body: { error: "retry" } };
  }
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
    plan: plan === "monthly" || plan === "annual" || plan === "partner_annual" ? plan : null,
    markReservedCheckoutEmail: true,
  });
  try {
    await noteAcquisitionClerk({
      email,
      clerkUserId,
      customerId: proof.customerId,
      subscriptionId: proof.subscriptionId,
    });
  } catch {
    console.warn("[stripe-first] acquisition clerk link isolated failure");
  }
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
      const memberNotice = {
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
      };
      try {
        await notifyConfirmedStripeFirstTrial(memberNotice);
      } catch (err) {
        console.warn("[stripe-first] member notification failed", err);
      }
      if (stripeFirstMemberNotification(memberNotice).send) {
        try {
          await maybeNotifyEmailAcquiredMember({
            subscriptionId: memberNotice.subscriptionId,
            memberName: memberNotice.name,
            memberEmail: memberNotice.email,
            metadata: proof.subscription.metadata,
            ownerCanary: false,
          });
        } catch (err) {
          console.warn("[stripe-first] outreach history notification failed", err);
        }
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

export type ResumeActivationStatus = "none" | "linked" | "retry" | "preserved" | "conflict";

export type ResumeActivationResult = {
  status: ResumeActivationStatus;
  subscriptionId?: string;
};

type ResumeCandidate = {
  kind: "ready";
  email: string;
  intent: CheckoutBrowserIntent;
};

type ResumeLookup =
  | { kind: "none" }
  | { kind: "conflict"; subscriptionId?: string }
  | ResumeCandidate;

function resumeSubscriptionId(intent: CheckoutBrowserIntent): string | undefined {
  const id = intent.stripe_subscription_id?.trim();
  return id || undefined;
}

function recognizedPriceId(subscription: Stripe.Subscription): boolean {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return false;
  return getRecognizedSummittPriceIds().has(priceId);
}

function resumeSnapshot(
  intent: CheckoutBrowserIntent,
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  subscription: Stripe.Subscription
): ResumeStripeSnapshot | null {
  const subscriptionUserId = subscription.metadata?.userId?.trim() || null;
  const base = {
    subscriptionId: subscription.id,
    livemode: subscription.livemode,
    status: subscription.status,
    paused: subscription.pause_collection != null,
    cancelAt: subscription.cancel_at,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: subscription.trial_end,
    priceRecognized: recognizedPriceId(subscription),
    checkoutIntentId: readCheckoutIntentId(subscription.metadata),
    subscriptionUserId,
    canary: subscription.metadata?.[CANARY_METADATA_KEY] === CANARY_METADATA_VALUE,
    stripeFirst: subscription.metadata?.[PUBLIC_CHECKOUT_FLOW_KEY] === PUBLIC_CHECKOUT_FLOW_VALUE,
  };
  if (customer.deleted) {
    return {
      ...base,
      customerId: "",
      customerDeleted: true,
      customerEmail: null,
      customerUserId: null,
    };
  }
  const customerId = typeof subscription.customer === "string" ? subscription.customer : "";
  return {
    ...base,
    customerId,
    customerDeleted: false,
    customerEmail: normalizeCheckoutEmail(customer.email ?? ""),
    customerUserId: customer.metadata?.userId?.trim() || null,
  };
}

async function findResumeCandidate(clerkUserId: string): Promise<ResumeLookup> {
  try {
    const serverLive = stripeFirstServerLivemode({
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      clerkSecretKey: process.env.CLERK_SECRET_KEY,
    });
    if (serverLive == null) return { kind: "none" };
    const identity = await getClerkIdentity(clerkUserId);
    const email = normalizeCheckoutEmail(identity?.primaryEmail ?? "");
    if (!identity || !email) return { kind: "none" };
    const rows = await loadResumeCandidateIntents({
      email,
      livemode: serverLive,
      clerkUserId,
    });
    const recordedProvision =
      rows.length === 1 &&
      rows[0].clerk_user_provisioned_at != null &&
      rows[0].clerk_user_id === clerkUserId;
    if (identity.verificationStatus !== "verified" && !recordedProvision) {
      return rows.length > 0
        ? {
            kind: "conflict",
            subscriptionId: rows.length === 1 ? resumeSubscriptionId(rows[0]) : undefined,
          }
        : { kind: "none" };
    }
    if (rows.length === 0) return { kind: "none" };
    if (rows.length > 1) return { kind: "conflict" };
    const intent = rows[0];
    if (
      !intent.email ||
      intent.email !== email ||
      !intent.stripe_subscription_id ||
      !intent.stripe_customer_id
    ) {
      return { kind: "conflict", subscriptionId: resumeSubscriptionId(intent) };
    }
    return { kind: "ready", email, intent };
  } catch (err) {
    console.error("[stripe-first] resume lookup failed", {
      reason: err instanceof Error ? err.message : "resume_lookup_failed",
    });
    return { kind: "none" };
  }
}

function otherConfirmedIntentBlocks(
  rows: Awaited<ReturnType<typeof loadConfirmedIntentsForEmail>>,
  candidateId: string,
  clerkUserId: string
): boolean {
  return rows.some((row) => {
    if (row.id === candidateId) return false;
    if (row.clerk_user_provisioned_at) return true;
    if (row.clerk_user_id && row.clerk_user_id !== clerkUserId) return true;
    if (row.session_started_at && !row.hold_released_at && row.clerk_user_id !== clerkUserId) {
      return true;
    }
    return false;
  });
}

async function otherProtectedStripeMembership(
  clerkUserId: string,
  subscriptionId: string
): Promise<"clear" | "conflict" | "retry"> {
  const metadata = await getClerkPublicMetadata(clerkUserId);
  const existingId =
    typeof metadata.stripeSubscriptionId === "string" ? metadata.stripeSubscriptionId.trim() : "";
  if (!existingId || existingId === subscriptionId) return "clear";
  try {
    const existing = await stripeClient().subscriptions.retrieve(existingId);
    if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, existing.livemode)) {
      return "retry";
    }
    const classification = classifySummittMembership(existing);
    if (
      classification === "entitled" ||
      classification === "paused_recoverable" ||
      classification === "past_due_recoverable"
    ) {
      return "conflict";
    }
    return "clear";
  } catch (err) {
    if (stripeErrorCode(err) === "resource_missing") return "clear";
    throw err;
  }
}

/**
 * A Clerk external ID limits recovery only when it is one of our checkout
 * intents. An empty or unrelated ID belongs to an ordinary account.
 * The recorded provisioned owner is not sent through this rule.
 * This reads the Backend user already returned by getClerkIdentity.
 */
async function checkoutExternalIdAllowsClaim(
  intent: CheckoutBrowserIntent,
  clerkUserId: string
): Promise<"allow" | "conflict" | "retry"> {
  if (intent.clerk_user_provisioned_at && intent.clerk_user_id === clerkUserId) {
    return "allow";
  }
  const identity = await getClerkIdentity(clerkUserId);
  if (!identity || identity.id !== clerkUserId) return "retry";
  const externalId = identity.externalId?.trim() ?? "";
  if (!externalId || externalId === intent.id) return "allow";
  const referenced = await loadIntentById(externalId);
  if (referenced?.id === externalId) return "conflict";
  return "allow";
}

/**
 * Claim the intent before any Stripe or Clerk identity write.
 * The loser of a race does not continue into provider linking.
 */
async function claimResumeIntent(
  intent: CheckoutBrowserIntent,
  clerkUserId: string,
  email: string
): Promise<"claimed" | "owned" | "conflict" | "retry"> {
  if (intent.clerk_user_provisioned_at) {
    if (intent.clerk_user_id !== clerkUserId) return "conflict";
    if (intent.session_started_at) return "owned";
    const started = await markSessionStartedForProvisionedUser(intent.id, clerkUserId);
    if (started) return "claimed";
    const fresh = await loadIntentById(intent.id);
    if (!fresh) return "retry";
    if (fresh.clerk_user_id === clerkUserId && fresh.session_started_at) return "owned";
    if (fresh.clerk_user_id && fresh.clerk_user_id !== clerkUserId) return "conflict";
    return "retry";
  }
  if (intent.clerk_user_id && intent.clerk_user_id !== clerkUserId) return "conflict";
  if (intent.session_started_at && intent.clerk_user_id === clerkUserId) return "owned";
  if (!intent.stripe_subscription_id) return "retry";

  if (!intent.sign_in_required_at) {
    await markResumeSignInRequired({
      intentId: intent.id,
      email,
      subscriptionId: intent.stripe_subscription_id,
    });
  }

  const started = await markSessionStartedForExistingUser({
    intentId: intent.id,
    clerkUserId,
  });
  if (started) return "claimed";
  const fresh = await loadIntentById(intent.id);
  if (!fresh) return "retry";
  if (fresh.clerk_user_provisioned_at) return "conflict";
  if (fresh.clerk_user_id === clerkUserId && fresh.session_started_at) return "owned";
  if (fresh.clerk_user_id && fresh.clerk_user_id !== clerkUserId) return "conflict";
  return "retry";
}

function resumeIntentSnapshot(intent: CheckoutBrowserIntent, clerkUserId: string) {
  return {
    id: intent.id,
    livemode: intent.livemode,
    email: intent.email ?? "",
    customerId: intent.stripe_customer_id ?? "",
    subscriptionId: intent.stripe_subscription_id ?? "",
    holdCancelAt: intent.stripe_hold_cancel_at,
    trialEndAt: intent.stripe_trial_end_at,
    sessionStarted: intent.session_started_at != null,
    claimedByThisUser: intent.clerk_user_id === clerkUserId,
  };
}

async function readResumeStripe(intent: CheckoutBrowserIntent): Promise<{
  customer: Stripe.Customer | Stripe.DeletedCustomer;
  subscription: Stripe.Subscription;
} | null> {
  if (!intent.stripe_customer_id || !intent.stripe_subscription_id) return null;
  const stripe = stripeClient();
  const [customer, subscription] = await Promise.all([
    stripe.customers.retrieve(intent.stripe_customer_id),
    stripe.subscriptions.retrieve(intent.stripe_subscription_id),
  ]);
  return { customer, subscription };
}

/**
 * The Stripe hold is already gone. Record that without the unprotected-trial
 * alert, which reconcile would send when the hold was never confirmed.
 */
async function acknowledgeClearedHold(
  intent: CheckoutBrowserIntent,
  subscription: Stripe.Subscription
): Promise<boolean> {
  if (intent.hold_released_at) return true;
  if (
    subscription.cancel_at != null ||
    subscription.cancel_at_period_end === true ||
    subscription.pause_collection != null ||
    (subscription.status !== "trialing" && subscription.status !== "active")
  ) {
    return false;
  }
  if (intent.hold_confirmed_at) {
    if (await markHoldReleased(intent.id)) return true;
    const fresh = await loadIntentById(intent.id);
    return fresh?.hold_released_at != null;
  }
  const holdUnix = unixFromIso(intent.stripe_hold_cancel_at) ?? subscription.trial_end;
  if (holdUnix == null) return false;
  const wrote = await markHoldConfirmedAndReleased({
    intentId: intent.id,
    holdCancelAtIso: new Date(holdUnix * 1000).toISOString(),
  });
  if (wrote) return true;
  const fresh = await loadIntentById(intent.id);
  return fresh?.hold_released_at != null;
}

function holdReleaseConfirmed(
  subscription: Stripe.Subscription,
  intent: CheckoutBrowserIntent,
  clerkUserId: string
): boolean {
  return (
    intent.clerk_user_id === clerkUserId &&
    intent.session_started_at != null &&
    intent.hold_released_at != null &&
    subscription.cancel_at == null &&
    subscription.cancel_at_period_end !== true &&
    (subscription.status === "trialing" || subscription.status === "active") &&
    subscription.pause_collection == null
  );
}

async function finishResumeLink(
  found: ResumeCandidate,
  clerkUserId: string
): Promise<ResumeActivationResult> {
  const subscriptionId = resumeSubscriptionId(found.intent);
  const owners = await lookupClerkUserIdsByEmail(found.email);
  if (owners.length !== 1 || owners[0] !== clerkUserId) {
    return { status: "conflict", subscriptionId };
  }
  const confirmed = await loadConfirmedIntentsForEmail({
    email: found.email,
    livemode: found.intent.livemode,
  });
  if (otherConfirmedIntentBlocks(confirmed, found.intent.id, clerkUserId)) {
    return { status: "conflict", subscriptionId };
  }
  const apple = await resolveAppleMembershipGrantForUser(clerkUserId);
  if (apple?.grantsAccess) return { status: "conflict", subscriptionId };
  const otherStripe = await otherProtectedStripeMembership(
    clerkUserId,
    found.intent.stripe_subscription_id ?? ""
  );
  if (otherStripe !== "clear") return { status: otherStripe, subscriptionId };

  const opened = await readResumeStripe(found.intent);
  if (!opened) return { status: "retry", subscriptionId };
  const openedSnapshot = resumeSnapshot(found.intent, opened.customer, opened.subscription);
  if (!openedSnapshot) return { status: "retry", subscriptionId };
  const before = decideResumeStripe({
    intent: resumeIntentSnapshot(found.intent, clerkUserId),
    stripe: openedSnapshot,
    clerkUserId,
    nowUnix: Math.floor(Date.now() / 1000),
  });
  if (before.outcome !== "ready") return { status: before.outcome, subscriptionId };

  const externalOwner = await checkoutExternalIdAllowsClaim(found.intent, clerkUserId);
  if (externalOwner !== "allow") return { status: externalOwner, subscriptionId };

  const claim = await claimResumeIntent(found.intent, clerkUserId, found.email);
  if (claim === "conflict" || claim === "retry") return { status: claim, subscriptionId };

  const claimed = await loadIntentById(found.intent.id);
  if (!claimed || claimed.clerk_user_id !== clerkUserId || !claimed.session_started_at) {
    return { status: "retry", subscriptionId };
  }
  const reread = await readResumeStripe(claimed);
  if (!reread) return { status: "retry", subscriptionId };
  const rereadSnapshot = resumeSnapshot(claimed, reread.customer, reread.subscription);
  if (!rereadSnapshot) return { status: "retry", subscriptionId };
  const afterClaim = decideResumeStripe({
    intent: resumeIntentSnapshot(claimed, clerkUserId),
    stripe: rereadSnapshot,
    clerkUserId,
    nowUnix: Math.floor(Date.now() / 1000),
  });
  if (afterClaim.outcome !== "ready") return { status: afterClaim.outcome, subscriptionId };

  await linkProviderIdentity({
    clerkUserId,
    customerId: claimed.stripe_customer_id ?? "",
    subscriptionId: claimed.stripe_subscription_id ?? "",
    plan: null,
  });

  const linkedIntent = await loadIntentById(claimed.id);
  const linkedStripe = linkedIntent ? await readResumeStripe(linkedIntent) : null;
  if (!linkedIntent || !linkedStripe) return { status: "retry", subscriptionId };
  const linkedSnapshot = resumeSnapshot(
    linkedIntent,
    linkedStripe.customer,
    linkedStripe.subscription
  );
  if (!linkedSnapshot) return { status: "retry", subscriptionId };
  const afterLink = decideResumeStripe({
    intent: resumeIntentSnapshot(linkedIntent, clerkUserId),
    stripe: linkedSnapshot,
    clerkUserId,
    nowUnix: Math.floor(Date.now() / 1000),
  });
  if (afterLink.outcome !== "ready") return { status: afterLink.outcome, subscriptionId };

  // Same Backend read the next onboarding request uses. Do not release the
  // hold or report success until that read shows the membership.
  const clerkAfterLink = await getClerkPublicMetadata(clerkUserId);
  if (!isSubscribedFromPublicMetadata(clerkAfterLink)) {
    return { status: "retry", subscriptionId };
  }

  const holdDecision = decideHold(
    {
      sessionStarted: true,
      holdConfirmed: linkedIntent.hold_confirmed_at != null,
      holdReleased: linkedIntent.hold_released_at != null,
      trialConfirmed: linkedIntent.stripe_trial_confirmed_at != null,
      storedHoldCancelAtUnix: unixFromIso(linkedIntent.stripe_hold_cancel_at),
    },
    {
      status: linkedStripe.subscription.status,
      cancelAt: linkedStripe.subscription.cancel_at,
      cancelAtPeriodEnd: linkedStripe.subscription.cancel_at_period_end,
      trialEnd: linkedStripe.subscription.trial_end,
      paused: linkedStripe.subscription.pause_collection != null,
    }
  );
  if (holdDecision.action === "preserve_cancellation") {
    return { status: "preserved", subscriptionId };
  }
  if (holdDecision.action === "unprotected") {
    const acknowledged = await acknowledgeClearedHold(linkedIntent, linkedStripe.subscription);
    if (!acknowledged) return { status: "retry", subscriptionId };
  } else if (
    holdDecision.action === "release" ||
    holdDecision.action === "mark_released" ||
    holdDecision.action === "compensate_clear"
  ) {
    const hold = await reconcileActivationHold(linkedIntent.id);
    if (hold === "retry" || hold === "unprotected") return { status: "retry", subscriptionId };
    if (hold === "preserved") {
      const afterHold = await readResumeStripe(linkedIntent);
      if (
        !afterHold ||
        afterHold.subscription.cancel_at != null ||
        afterHold.subscription.cancel_at_period_end === true ||
        afterHold.subscription.status === "canceled" ||
        afterHold.subscription.status === "incomplete_expired"
      ) {
        return { status: "preserved", subscriptionId };
      }
      const current = await loadIntentById(linkedIntent.id);
      if (!current) return { status: "retry", subscriptionId };
      const acknowledged = await acknowledgeClearedHold(current, afterHold.subscription);
      if (!acknowledged) return { status: "retry", subscriptionId };
    }
  }

  const finishedIntent = await loadIntentById(linkedIntent.id);
  const finishedStripe = finishedIntent ? await readResumeStripe(finishedIntent) : null;
  if (
    !finishedIntent ||
    !finishedStripe ||
    !holdReleaseConfirmed(finishedStripe.subscription, finishedIntent, clerkUserId)
  ) {
    return { status: "retry", subscriptionId };
  }
  return { status: "linked", subscriptionId };
}

/**
 * Signed-in recovery for one confirmed Stripe-first trial.
 * Does not use the browser binding and does not cancel a subscription.
 */
export async function resumeExistingAccountActivation(args: {
  clerkUserId: string;
}): Promise<ResumeActivationResult> {
  const found = await findResumeCandidate(args.clerkUserId);
  if (found.kind === "none") return { status: "none" };
  if (found.kind === "conflict") {
    return { status: "conflict", subscriptionId: found.subscriptionId };
  }
  try {
    return await finishResumeLink(found, args.clerkUserId);
  } catch (err) {
    console.error("[stripe-first] resume activation failed", {
      reason: err instanceof Error ? err.message : "resume_failed",
    });
    return { status: "retry", subscriptionId: resumeSubscriptionId(found.intent) };
  }
}

/**
 * Post-sign-in routing for one recovery result.
 * `linked` continues with subscribed metadata even if this request's Clerk
 * object was loaded before the write. Any other unfinished result stays on
 * the notice instead of opening checkout.
 */
export function applyRecoveryToSignInMetadata(args: {
  metadata: Record<string, unknown>;
  status: ResumeActivationStatus;
  subscriptionId?: string;
}):
  | {
      action: "notice";
      status: Exclude<ResumeActivationStatus, "none" | "linked">;
    }
  | { action: "continue"; metadata: Record<string, unknown> } {
  if (args.status === "linked") {
    return {
      action: "continue",
      metadata: { ...args.metadata, summittSubscribed: true },
    };
  }
  if (args.status !== "none") {
    const knownSubscriptionId =
      typeof args.metadata.stripeSubscriptionId === "string"
        ? args.metadata.stripeSubscriptionId
        : "";
    const targetsThisSubscription =
      knownSubscriptionId !== "" && knownSubscriptionId === args.subscriptionId;
    if (!isSubscribedFromPublicMetadata(args.metadata) || targetsThisSubscription) {
      return { action: "notice", status: args.status };
    }
  }
  return { action: "continue", metadata: args.metadata };
}

/** True when /subscribe must hand this signed-in user to /post-sign-in. */
export async function accountResumeNeedsPostSignIn(clerkUserId: string): Promise<boolean> {
  const found = await findResumeCandidate(clerkUserId);
  return found.kind === "ready" || found.kind === "conflict";
}
