/**
 * Stripe-verified trial and first payment → Google Ads Data Manager.
 * Fail-open: a Google failure must not affect membership or Meta.
 * HTTP acceptance is recorded as ingestion_accepted. It is not attribution.
 */

import "server-only";

import type Stripe from "stripe";

import {
  claimGoogleAdsConversion,
  listRetryableGoogleAdsConversions,
  markGoogleAdsConversionError,
  markGoogleAdsIngestionAccepted,
  readGoogleAdsConversionStatus,
  GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS,
  type GoogleAdsLedgerRow,
} from "@/lib/google-ads/conversion-ledger";
import {
  googleAdsAccessToken,
  postGoogleAdsIngest,
} from "@/lib/google-ads/data-manager-client";
import {
  googleAdsIngestEnabled,
  googleAdsTransactionId,
  readGoogleAdsConfig,
  usdAmountFromStripeCents,
  type GoogleAdsEventDraft,
} from "@/lib/google-ads/data-manager-payload";
import {
  googleAdsUploadEligibility,
  type GoogleAdsCheckoutEvidence,
} from "@/lib/google-ads/google-ads-eligibility";
import {
  checkFirstPaidInvoiceForSubscription,
  invoiceCurrencyIsUsd,
  isRecognizedSummittSubscription,
  isSubscriptionPaymentBillingReason,
  metaStartTrialEventUnix,
  subscriptionHasActiveTrial,
} from "@/lib/meta-capi-stripe-conversions";
import { isOwnerCanaryMetadata } from "@/lib/stripe-first-checkout/member-notify";
import { loadIntentBySubscriptionId } from "@/lib/stripe-first-checkout/intent-store";

function paymentEventUnix(invoice: Stripe.Invoice, fallbackUnix: number): number {
  if (typeof invoice.status_transitions?.paid_at === "number") {
    return invoice.status_transitions.paid_at;
  }
  if (typeof invoice.created === "number") return invoice.created;
  if (typeof fallbackUnix === "number" && Number.isFinite(fallbackUnix)) {
    return Math.floor(fallbackUnix);
  }
  return Math.floor(Date.now() / 1000);
}

async function evidenceFor(args: {
  subscriptionId: string;
  intent?: GoogleAdsCheckoutEvidence | null;
}): Promise<GoogleAdsCheckoutEvidence | null> {
  if (args.intent !== undefined) return args.intent;
  return loadIntentBySubscriptionId(args.subscriptionId);
}

async function deliverRow(row: GoogleAdsLedgerRow): Promise<void> {
  const status = await readGoogleAdsConversionStatus(row.id);
  if (status !== "pending") return;

  const config = readGoogleAdsConfig(process.env);
  if (!config) {
    await markGoogleAdsConversionError(row.id, "credentials_missing");
    return;
  }
  if (!googleAdsIngestEnabled(process.env)) {
    await markGoogleAdsConversionError(row.id, "ingest_disabled");
    return;
  }

  const draft: GoogleAdsEventDraft = {
    kind: row.event_kind,
    transactionId: row.transaction_id,
    eventTimeUnix: row.event_time,
    click: { type: row.google_click_id_type, value: row.google_click_id },
    valueUsd: row.event_kind === "first_payment" ? row.value : null,
  };
  if (row.event_kind === "first_payment" && !(draft.valueUsd && draft.valueUsd > 0)) {
    await markGoogleAdsConversionError(row.id, "invalid_value");
    return;
  }

  const accessToken = await googleAdsAccessToken(config);
  if (!accessToken) {
    await markGoogleAdsConversionError(row.id, "token_rejected");
    return;
  }

  const result = await postGoogleAdsIngest({ config, draft, accessToken });
  if (result.outcome === "ingestion_accepted") {
    await markGoogleAdsIngestionAccepted(row.id, result.requestId);
    return;
  }
  await markGoogleAdsConversionError(row.id, result.reason);
}

async function claimAndDeliver(args: {
  kind: GoogleAdsEventDraft["kind"];
  subscriptionId: string;
  eventTime: number;
  value: number | null;
  currency: "USD" | null;
  clickType: GoogleAdsLedgerRow["google_click_id_type"];
  clickId: string;
}): Promise<void> {
  const transactionId = googleAdsTransactionId(args.kind, args.subscriptionId);
  if (!transactionId) return;
  const claim = await claimGoogleAdsConversion({
    eventKind: args.kind,
    stripeSubscriptionId: args.subscriptionId,
    transactionId,
    eventTime: args.eventTime,
    value: args.value,
    currency: args.currency,
    clickType: args.clickType,
    clickId: args.clickId,
  });
  if (claim.status === "claimed" || claim.status === "pending_retry") {
    await deliverRow(claim.row);
  }
}

export async function maybeEmitGoogleAdsTrial(args: {
  subscription: Stripe.Subscription;
  eventCreatedUnix: number;
  intent?: GoogleAdsCheckoutEvidence | null;
}): Promise<void> {
  try {
    const subscriptionId =
      typeof args.subscription.id === "string" ? args.subscription.id.trim() : "";
    if (!subscriptionId) return;
    if (!isRecognizedSummittSubscription(args.subscription)) return;
    if (!subscriptionHasActiveTrial(args.subscription)) return;

    const intent = await evidenceFor({ subscriptionId, intent: args.intent });
    const eligible = googleAdsUploadEligibility({
      ownerCanary: isOwnerCanaryMetadata(args.subscription.metadata),
      subscriptionLivemode: args.subscription.livemode,
      intent,
    });
    if (!eligible.ok) return;

    await claimAndDeliver({
      kind: "trial_started",
      subscriptionId,
      eventTime: metaStartTrialEventUnix(args.subscription, args.eventCreatedUnix),
      value: null,
      currency: null,
      clickType: eligible.click.type,
      clickId: eligible.click.value,
    });
  } catch {
    console.warn("[google-ads] trial unexpected");
  }
}

export async function maybeEmitGoogleAdsFirstPayment(args: {
  stripe: {
    invoices: {
      list: (params: {
        subscription: string;
        limit: number;
        starting_after?: string;
      }) => Promise<{
        data: Array<{ id?: string | null; amount_paid?: number | null }>;
        has_more?: boolean | null;
      }>;
    };
  };
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  eventCreatedUnix: number;
  intent?: GoogleAdsCheckoutEvidence | null;
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

    const valueUsd = usdAmountFromStripeCents(amountPaid);
    if (valueUsd == null) return;

    const firstPaid = await checkFirstPaidInvoiceForSubscription({
      stripe: args.stripe,
      subscriptionId,
      currentInvoiceId: invoiceId,
    });
    if (firstPaid.status !== "first_paid") return;

    const intent = await evidenceFor({ subscriptionId, intent: args.intent });
    const eligible = googleAdsUploadEligibility({
      ownerCanary: isOwnerCanaryMetadata(args.subscription.metadata),
      subscriptionLivemode: args.subscription.livemode,
      intent,
    });
    if (!eligible.ok) return;

    await claimAndDeliver({
      kind: "first_payment",
      subscriptionId,
      eventTime: paymentEventUnix(args.invoice, args.eventCreatedUnix),
      value: valueUsd,
      currency: "USD",
      clickType: eligible.click.type,
      clickId: eligible.click.value,
    });
  } catch {
    console.warn("[google-ads] payment unexpected");
  }
}

export async function retryBoundedPendingGoogleAdsConversions(
  nowMs: number = Date.now()
): Promise<void> {
  try {
    const rows = await listRetryableGoogleAdsConversions(nowMs);
    for (const row of rows) {
      if (row.created_at) {
        const createdMs = Date.parse(row.created_at);
        if (Number.isFinite(createdMs) && nowMs - createdMs < GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS) {
          continue;
        }
      }
      await deliverRow(row);
    }
  } catch {
    console.warn("[google-ads] retry unexpected");
  }
}
