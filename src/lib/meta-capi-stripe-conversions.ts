/**
 * Stripe webhook → Meta CAPI StartTrial / Subscribe.
 * Fail-open: never throw into membership processing.
 */

import "server-only";

import type Stripe from "stripe";

import {
  hashMetaExternalId,
  sendMetaCapiEvent,
} from "@/lib/meta-capi";
import {
  claimMetaConversionEvent,
  listPendingMetaConversionsForSubscription,
  markMetaConversionError,
  markMetaConversionSent,
  type MetaConversionClaimRow,
} from "@/lib/meta-conversion-ledger";
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

async function sendClaimedRow(row: MetaConversionClaimRow): Promise<void> {
  const send = await sendMetaCapiEvent({
    eventName: row.event_name,
    eventTime: row.event_time,
    eventId: row.meta_event_id,
    externalIdHash: row.external_id_hash,
    value: row.value,
    currency: row.currency,
  });

  if (send.ok) {
    await markMetaConversionSent(row.id);
    return;
  }
  await markMetaConversionError(row.id, send.reason);
}

async function claimAndSend(args: {
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

  if (claim.status === "already_sent" || claim.status === "unavailable") return;
  await sendClaimedRow(claim.row);
}

async function retryPendingClaims(subscriptionId: string): Promise<void> {
  const pending = await listPendingMetaConversionsForSubscription(subscriptionId);
  for (const row of pending) {
    await sendClaimedRow(row);
  }
}

/**
 * After checkout.session.completed membership projection succeeds.
 */
export async function maybeEmitMetaStartTrialFromCheckout(args: {
  subscription: Stripe.Subscription;
  userId: string | null;
  eventCreatedUnix: number;
}): Promise<void> {
  try {
    const subscriptionId =
      typeof args.subscription.id === "string" ? args.subscription.id.trim() : "";
    if (!subscriptionId) return;
    if (!isRecognizedSummittSubscription(args.subscription)) return;
    if (!subscriptionHasActiveTrial(args.subscription)) return;

    const eventTime =
      typeof args.eventCreatedUnix === "number" && Number.isFinite(args.eventCreatedUnix)
        ? Math.floor(args.eventCreatedUnix)
        : Math.floor(Date.now() / 1000);

    await claimAndSend({
      eventName: "StartTrial",
      subscriptionId,
      eventId: metaStartTrialEventId(subscriptionId),
      eventTime,
      externalIdHash: hashMetaExternalId(args.userId),
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

    const eventTime =
      typeof args.invoice.status_transitions?.paid_at === "number"
        ? args.invoice.status_transitions.paid_at
        : typeof args.invoice.created === "number"
          ? args.invoice.created
          : typeof args.eventCreatedUnix === "number" && Number.isFinite(args.eventCreatedUnix)
            ? Math.floor(args.eventCreatedUnix)
            : Math.floor(Date.now() / 1000);

    await claimAndSend({
      eventName: "Subscribe",
      subscriptionId,
      eventId: metaSubscribeEventId(subscriptionId),
      eventTime,
      value: amountPaid / 100,
      currency: "USD",
      externalIdHash: hashMetaExternalId(args.userId),
    });
  } catch {
    console.warn("[meta-capi] Subscribe unexpected");
  }
}
