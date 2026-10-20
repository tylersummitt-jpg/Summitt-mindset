/**
 * Stripe webhook → Meta CAPI StartTrial / Subscribe.
 * Fail-open: never throw into membership processing.
 */

import "server-only";

import type Stripe from "stripe";

import {
  hashMetaExternalId,
  META_CAPI_CLERK_CHECKOUT_SOURCE_URL,
  META_CAPI_STRIPE_FIRST_SOURCE_URL,
  sendMetaCapiEvent,
} from "@/lib/meta-capi";
import {
  claimMetaConversionEvent,
  isMetaConversionUnsent,
  listPendingMetaConversionsForSubscription,
  listRetryableMetaConversions,
  markMetaConversionError,
  markMetaConversionSent,
  metaConversionEventWithinMaxAge,
  META_CONVERSION_RETRY_MIN_AGE_MS,
  type MetaConversionClaimRow,
} from "@/lib/meta-conversion-ledger";
import { failOpenWithTimeout } from "@/lib/meta-capi-fail-open-timeout";
import {
  loadMetaCapiWebIdentifiersForUser,
  type MetaCapiWebMatch,
} from "@/lib/meta-capi-web-identifiers";
import {
  clearStaleCheckoutMatchFields,
  loadIntentBySubscriptionId,
  type CheckoutBrowserIntent,
} from "@/lib/stripe-first-checkout/intent-store";
import {
  getRecognizedSummittPriceIds,
  isRecognizedSummittPriceId,
} from "@/lib/stripe-recognized-price-ids";

const INVOICE_LIST_PAGE_SIZE = 100;
const INVOICE_LIST_MAX_PAGES = 20;

type StripeInvoiceListClient = {
  invoices: {
    list: (params: {
      subscription: string;
      limit: number;
      starting_after?: string;
    }) => Promise<{
      data: Array<{
        id?: string | null;
        amount_paid?: number | null;
      }>;
      has_more?: boolean | null;
    }>;
  };
};

export function metaStartTrialEventId(subscriptionId: string): string {
  return `start_trial:${subscriptionId.trim()}`;
}

export function metaSubscribeEventId(subscriptionId: string): string {
  return `subscribe:${subscriptionId.trim()}`;
}

function positiveUnix(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/** Stripe trial_start, then subscription.created, then the caller fallback. Never "now" when one of those exists. */
export function metaStartTrialEventUnix(
  subscription: { trial_start?: number | null; created?: number | null },
  fallbackUnix: number
): number {
  return (
    positiveUnix(subscription.trial_start) ??
    positiveUnix(subscription.created) ??
    positiveUnix(fallbackUnix) ??
    Math.floor(Date.now() / 1000)
  );
}

function matchFromIntent(intent: CheckoutBrowserIntent | null): MetaCapiWebMatch | null {
  if (!intent) return null;
  const match: MetaCapiWebMatch = {
    fbc: intent.meta_fbc ?? null,
    fbp: intent.meta_fbp ?? null,
    clientIpAddress: intent.client_ip ?? null,
    clientUserAgent: intent.client_user_agent ?? null,
  };
  if (!match.fbc && !match.fbp && !match.clientIpAddress && !match.clientUserAgent) {
    return null;
  }
  return match;
}

function mergeMatch(
  primary: MetaCapiWebMatch | null | undefined,
  fallback: MetaCapiWebMatch | null | undefined
): MetaCapiWebMatch | null {
  if (!primary && !fallback) return null;
  return {
    fbc: primary?.fbc || fallback?.fbc || null,
    fbp: primary?.fbp || fallback?.fbp || null,
    clientIpAddress: primary?.clientIpAddress || fallback?.clientIpAddress || null,
    clientUserAgent: primary?.clientUserAgent || fallback?.clientUserAgent || null,
  };
}

function sourceUrlForIntent(intent: CheckoutBrowserIntent | null): string {
  return intent ? META_CAPI_STRIPE_FIRST_SOURCE_URL : META_CAPI_CLERK_CHECKOUT_SOURCE_URL;
}

const INTENT_LOOKUP_FAILED = Symbol("intent_lookup_failed");

type IntentLookup =
  | { status: "ready"; intent: CheckoutBrowserIntent | null }
  | { status: "unavailable" };

/**
 * A successful read of no row is a genuine absence.
 * A timeout or error is not absence: the caller must not send unmatched.
 */
async function lookupCheckoutIntent(subscriptionId: string): Promise<IntentLookup> {
  try {
    const result = await failOpenWithTimeout<
      CheckoutBrowserIntent | null | typeof INTENT_LOOKUP_FAILED
    >(loadIntentBySubscriptionId(subscriptionId), INTENT_LOOKUP_FAILED);
    if (result === INTENT_LOOKUP_FAILED) return { status: "unavailable" };
    return { status: "ready", intent: result };
  } catch {
    return { status: "unavailable" };
  }
}

async function loadClerkMatchFailOpen(
  userId: string | null | undefined
): Promise<MetaCapiWebMatch | null> {
  try {
    return await failOpenWithTimeout(loadMetaCapiWebIdentifiersForUser(userId), null);
  } catch {
    return null;
  }
}

function subscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  const items = subscription.items?.data ?? [];
  const ids: string[] = [];
  for (const item of items) {
    const price = item.price;
    const id = typeof price === "string" ? price : price?.id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return ids;
}

export function isRecognizedSummittSubscription(
  subscription: Stripe.Subscription
): boolean {
  const recognized = getRecognizedSummittPriceIds();
  if (recognized.size === 0) return false;
  return subscriptionPriceIds(subscription).some((id) =>
    isRecognizedSummittPriceId(id, recognized)
  );
}

export function subscriptionHasActiveTrial(
  subscription: Stripe.Subscription,
  nowUnix: number = Math.floor(Date.now() / 1000)
): boolean {
  if (subscription.status === "trialing") return true;
  const trialEnd = subscription.trial_end;
  return typeof trialEnd === "number" && trialEnd > nowUnix;
}

export function invoiceCurrencyIsUsd(currency: string | null | undefined): boolean {
  return typeof currency === "string" && currency.trim().toLowerCase() === "usd";
}

export function isSubscriptionPaymentBillingReason(
  billingReason: string | null | undefined
): boolean {
  return billingReason === "subscription_cycle" || billingReason === "subscription_create";
}

export type FirstPaidInvoiceCheck =
  | { status: "first_paid" }
  | { status: "not_first_paid" }
  | { status: "unknown" };

export async function checkFirstPaidInvoiceForSubscription(args: {
  stripe: StripeInvoiceListClient;
  subscriptionId: string;
  currentInvoiceId: string;
}): Promise<FirstPaidInvoiceCheck> {
  try {
    const subscriptionId = args.subscriptionId.trim();
    const currentInvoiceId = args.currentInvoiceId.trim();
    if (!subscriptionId || !currentInvoiceId) return { status: "unknown" };

    let startingAfter: string | undefined;
    for (let page = 0; page < INVOICE_LIST_MAX_PAGES; page += 1) {
      const res = await args.stripe.invoices.list({
        subscription: subscriptionId,
        limit: INVOICE_LIST_PAGE_SIZE,
        starting_after: startingAfter,
      });
      const data = res.data ?? [];
      for (const invoice of data) {
        const id = typeof invoice.id === "string" ? invoice.id : "";
        if (!id || id === currentInvoiceId) continue;
        const paid = invoice.amount_paid;
        if (typeof paid === "number" && paid > 0) {
          return { status: "not_first_paid" };
        }
      }
      if (!res.has_more) return { status: "first_paid" };
      const lastId = data[data.length - 1]?.id;
      if (typeof lastId !== "string" || !lastId) return { status: "unknown" };
      startingAfter = lastId;
    }
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

async function sendClaimedRow(
  row: MetaConversionClaimRow,
  webMatch?: MetaCapiWebMatch | null,
  eventSourceUrl?: string
): Promise<void> {
  if (!(await isMetaConversionUnsent(row.id))) return;
  const nowUnix = Math.floor(Date.now() / 1000);
  if (!metaConversionEventWithinMaxAge(row.event_time, nowUnix)) return;
  const send = await sendMetaCapiEvent({
    eventName: row.event_name,
    eventTime: row.event_time,
    eventId: row.meta_event_id,
    eventSourceUrl,
    externalIdHash: row.external_id_hash,
    value: row.value,
    currency: row.currency,
    fbc: webMatch?.fbc,
    fbp: webMatch?.fbp,
    clientIpAddress: webMatch?.clientIpAddress,
    clientUserAgent: webMatch?.clientUserAgent,
  });

  if (send.ok) {
    await markMetaConversionSent(row.id);
    return;
  }
  await markMetaConversionError(row.id, send.reason);
}

/** Checkout-intent fields win. Account identifiers fill only what the checkout did not store. */
function attributionMatch(args: {
  intent: CheckoutBrowserIntent | null;
  passed?: MetaCapiWebMatch | null;
  clerkMatch: MetaCapiWebMatch | null;
}): MetaCapiWebMatch | null {
  return mergeMatch(mergeMatch(matchFromIntent(args.intent), args.passed), args.clerkMatch);
}

async function storedMatchForSubscription(
  subscriptionId: string
): Promise<
  | { status: "ready"; match: MetaCapiWebMatch | null; sourceUrl: string }
  | { status: "unavailable" }
> {
  const lookup = await lookupCheckoutIntent(subscriptionId);
  if (lookup.status === "unavailable") return { status: "unavailable" };
  const clerkMatch = await loadClerkMatchFailOpen(lookup.intent?.clerk_user_id ?? null);
  return {
    status: "ready",
    match: attributionMatch({ intent: lookup.intent, clerkMatch }),
    sourceUrl: sourceUrlForIntent(lookup.intent),
  };
}

async function holdUnsentConversion(args: {
  eventName: "StartTrial" | "Subscribe";
  subscriptionId: string;
  eventId: string;
  eventTime: number;
  value?: number | null;
  currency?: string | null;
  externalIdHash: string | null;
}): Promise<void> {
  const claim = await claimMetaConversionEvent({
    eventName: args.eventName,
    stripeSubscriptionId: args.subscriptionId,
    metaEventId: args.eventId,
    eventTime: args.eventTime,
    value: args.value ?? null,
    currency: args.currency ?? null,
    externalIdHash: args.externalIdHash,
  });
  if (claim.status === "claimed" || claim.status === "pending_retry") {
    await markMetaConversionError(claim.row.id, "intent_lookup_failed");
  }
}

async function sendStoredRowIfMatchKnown(row: MetaConversionClaimRow): Promise<void> {
  const stored = await storedMatchForSubscription(row.stripe_subscription_id);
  if (stored.status === "unavailable") {
    await markMetaConversionError(row.id, "intent_lookup_failed");
    return;
  }
  await sendClaimedRow(row, stored.match, stored.sourceUrl);
}

async function claimAndSend(args: {
  eventName: "StartTrial" | "Subscribe";
  subscriptionId: string;
  eventId: string;
  eventTime: number;
  value?: number | null;
  currency?: string | null;
  externalIdHash: string | null;
  webMatch?: MetaCapiWebMatch | null;
  eventSourceUrl?: string;
}): Promise<void> {
  const claim = await claimMetaConversionEvent({
    eventName: args.eventName,
    stripeSubscriptionId: args.subscriptionId,
    metaEventId: args.eventId,
    eventTime: args.eventTime,
    value: args.value ?? null,
    currency: args.currency ?? null,
    externalIdHash: args.externalIdHash,
  });

  if (claim.status === "already_sent" || claim.status === "unavailable") return;
  await sendClaimedRow(claim.row, args.webMatch, args.eventSourceUrl);
}

async function retryPendingClaims(subscriptionId: string): Promise<void> {
  const pending = await listPendingMetaConversionsForSubscription(subscriptionId);
  for (const row of pending) {
    await sendStoredRowIfMatchKnown(row);
  }
}

/**
 * After checkout.session.completed membership projection succeeds.
 */
export async function maybeEmitMetaStartTrialFromCheckout(args: {
  subscription: Stripe.Subscription;
  userId: string | null;
  eventCreatedUnix: number;
  eventSourceUrl?: string | null;
  webMatch?: MetaCapiWebMatch | null;
}): Promise<void> {
  try {
    const subscriptionId =
      typeof args.subscription.id === "string" ? args.subscription.id.trim() : "";
    if (!subscriptionId) return;
    if (!isRecognizedSummittSubscription(args.subscription)) return;
    if (!subscriptionHasActiveTrial(args.subscription)) return;

    const eventTime = metaStartTrialEventUnix(args.subscription, args.eventCreatedUnix);
    const eventId = metaStartTrialEventId(subscriptionId);
    const externalIdHash = hashMetaExternalId(args.userId);
    let intent: CheckoutBrowserIntent | null = null;
    let webMatch: MetaCapiWebMatch | null;
    if (args.webMatch !== undefined) {
      const clerkMatch = await loadClerkMatchFailOpen(args.userId);
      webMatch = attributionMatch({ intent: null, passed: args.webMatch, clerkMatch });
    } else {
      const lookup = await lookupCheckoutIntent(subscriptionId);
      if (lookup.status === "unavailable") {
        await holdUnsentConversion({
          eventName: "StartTrial",
          subscriptionId,
          eventId,
          eventTime,
          externalIdHash,
        });
        return;
      }
      intent = lookup.intent;
      const clerkMatch = await loadClerkMatchFailOpen(args.userId ?? intent?.clerk_user_id);
      webMatch = attributionMatch({ intent, clerkMatch });
    }
    const eventSourceUrl =
      args.eventSourceUrl === META_CAPI_STRIPE_FIRST_SOURCE_URL ||
      args.eventSourceUrl === META_CAPI_CLERK_CHECKOUT_SOURCE_URL
        ? args.eventSourceUrl
        : sourceUrlForIntent(intent);

    await claimAndSend({
      eventName: "StartTrial",
      subscriptionId,
      eventId,
      eventTime,
      externalIdHash,
      webMatch,
      eventSourceUrl,
    });
  } catch {
    console.warn("[meta-capi] StartTrial unexpected");
  }
}

/**
 * After invoice.paid membership projection succeeds.
 */
export async function maybeEmitMetaSubscribeFromInvoicePaid(args: {
  stripe: StripeInvoiceListClient;
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  userId: string | null;
  eventCreatedUnix: number;
  /** Already loaded by the caller. When present, this send does not read the intent again. */
  checkoutIntent?: CheckoutBrowserIntent;
}): Promise<void> {
  try {
    const subscriptionId =
      typeof args.subscription.id === "string" ? args.subscription.id.trim() : "";
    const invoiceId = typeof args.invoice.id === "string" ? args.invoice.id.trim() : "";
    if (!subscriptionId || !invoiceId) return;
    if (!isRecognizedSummittSubscription(args.subscription)) return;

    const amountPaid = args.invoice.amount_paid;
    if (typeof amountPaid !== "number" || amountPaid <= 0) return;
    if (!invoiceCurrencyIsUsd(args.invoice.currency)) return;
    if (!isSubscriptionPaymentBillingReason(args.invoice.billing_reason)) return;

    const firstPaid = await checkFirstPaidInvoiceForSubscription({
      stripe: args.stripe,
      subscriptionId,
      currentInvoiceId: invoiceId,
    });
    if (firstPaid.status !== "first_paid") {
      if (firstPaid.status === "not_first_paid") {
        await retryPendingClaims(subscriptionId);
      }
      return;
    }

    await retryPendingClaims(subscriptionId);

    const eventTime =
      typeof args.invoice.status_transitions?.paid_at === "number"
        ? args.invoice.status_transitions.paid_at
        : typeof args.invoice.created === "number"
          ? args.invoice.created
          : typeof args.eventCreatedUnix === "number" && Number.isFinite(args.eventCreatedUnix)
            ? Math.floor(args.eventCreatedUnix)
            : Math.floor(Date.now() / 1000);
    const eventId = metaSubscribeEventId(subscriptionId);
    const externalIdHash = hashMetaExternalId(args.userId);
    const value = amountPaid / 100;

    const lookup: IntentLookup =
      args.checkoutIntent !== undefined
        ? { status: "ready", intent: args.checkoutIntent }
        : await lookupCheckoutIntent(subscriptionId);
    if (lookup.status === "unavailable") {
      await holdUnsentConversion({
        eventName: "Subscribe",
        subscriptionId,
        eventId,
        eventTime,
        value,
        currency: "USD",
        externalIdHash,
      });
      return;
    }

    const intent = lookup.intent;
    const clerkMatch = await loadClerkMatchFailOpen(args.userId ?? intent?.clerk_user_id);
    const webMatch = attributionMatch({ intent, clerkMatch });

    await claimAndSend({
      eventName: "Subscribe",
      subscriptionId,
      eventId,
      eventTime,
      value,
      currency: "USD",
      externalIdHash,
      webMatch,
      eventSourceUrl: sourceUrlForIntent(intent),
    });
  } catch {
    console.warn("[meta-capi] Subscribe unexpected");
  }
}

/**
 * At most 20 pending rows, each at least two minutes old and inside seven days.
 * Sends the stored event id and event_time. Does not rewrite either.
 */
export async function retryBoundedPendingMetaConversions(
  nowMs: number = Date.now()
): Promise<void> {
  const rows = await listRetryableMetaConversions(nowMs);
  const nowUnix = Math.floor(nowMs / 1000);
  for (const row of rows) {
    if (row.created_at) {
      const createdMs = Date.parse(row.created_at);
      if (Number.isFinite(createdMs) && nowMs - createdMs < META_CONVERSION_RETRY_MIN_AGE_MS) {
        continue;
      }
    }
    if (!metaConversionEventWithinMaxAge(row.event_time, nowUnix)) continue;
    await sendStoredRowIfMatchKnown(row);
  }
}

/** Hourly Meta pass. Either half can fail without affecting the other or the recovery JSON. */
export async function runHourlyMetaConversionMaintenance(
  nowMs: number = Date.now()
): Promise<void> {
  try {
    await retryBoundedPendingMetaConversions(nowMs);
  } catch {
    console.warn("[meta-capi] hourly retry failed");
  }
  try {
    await clearStaleCheckoutMatchFields(nowMs);
  } catch {
    console.warn("[meta-capi] checkout match cleanup failed");
  }
}
