/**
 * Stripe-verified trial and first payment → Google Ads Data Manager.
 * Fail-open: a Google failure must not affect membership or Meta.
 * HTTP acceptance is recorded as ingestion_accepted. It is not attribution.
 */

import "server-only";

import Stripe from "stripe";

import {
  acquireOperatorGoogleAdsSend,
  assessOperatorSendHold,
  claimGoogleAdsConversion,
  finishOperatorGoogleAdsSend,
  insertOperatorGoogleAdsSend,
  inspectGoogleAdsTrialOccupancy,
  listRetryableGoogleAdsConversions,
  markGoogleAdsConversionError,
  markGoogleAdsIngestionAccepted,
  markOperatorGoogleAdsAmbiguous,
  markOperatorGoogleAdsBlocked,
  readGoogleAdsOperatorGate,
  GOOGLE_ADS_CONVERSION_MAX_EVENT_AGE_SECONDS,
  GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS,
  type GoogleAdsLedgerRow,
  type GoogleAdsTrialOccupancy,
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
import { googleClickIdFromIntent } from "@/lib/marketing-attribution-pure";
import {
  type OperatorClickType,
  type OperatorTrialView,
} from "@/lib/google-ads/operator-trial-view";
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
  const gate = await readGoogleAdsOperatorGate(row.id);
  if (!gate || gate.status !== "pending" || gate.lock !== "open") return;

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

const OPERATOR_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,64}$/;
const AMBIGUOUS_INGEST = new Set(["timeout", "network", "missing_request_id"]);

export type { OperatorClickType, OperatorTrialView } from "@/lib/google-ads/operator-trial-view";

type OperatorTrialDeps = {
  loadSubscription?: (subscriptionId: string) => Promise<Stripe.Subscription>;
  nowUnix?: number;
};

type ReadyTrial = {
  ok: true;
  subscriptionId: string;
  click: { type: OperatorClickType; value: string };
  eventTime: number;
  transactionId: string;
  country: "US";
};

function operatorView(args: {
  eligibility: OperatorTrialView["eligibility"];
  subscriptionId: string;
  clickType: OperatorClickType | null;
  requestCountry: string | null;
  transactionId: string | null;
  deliveryStatus: string;
  requestId?: string | null;
}): OperatorTrialView {
  const deliveryStatus = args.deliveryStatus.replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "stopped";
  return {
    eligibility: args.eligibility,
    subscriptionId: args.subscriptionId,
    clickType: args.clickType,
    requestCountry: args.requestCountry,
    transactionId: args.transactionId,
    deliveryStatus,
    requestId: publicRequestId(args.requestId ?? null),
  };
}

function publicRequestId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/[\s@]/.test(trimmed)) return null;
  if (/bearer|ya29|access_token/i.test(trimmed)) return null;
  return trimmed;
}

function countryCode(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
}

function clickTypeOf(intent: GoogleAdsCheckoutEvidence | null): OperatorClickType | null {
  const click = googleClickIdFromIntent(intent);
  return click?.type ?? null;
}

async function loadOperatorSubscription(
  subscriptionId: string,
  deps: OperatorTrialDeps | undefined
): Promise<Stripe.Subscription> {
  if (deps?.loadSubscription) return deps.loadSubscription(subscriptionId);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error("stripe_unavailable"), { code: "stripe_unavailable" });
  return new Stripe(key).subscriptions.retrieve(subscriptionId);
}

function stripeLoadStatus(err: unknown): "not_found" | "stripe_unavailable" {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (code === "resource_missing") return "not_found";
  }
  return "stripe_unavailable";
}

function stoppedView(
  subscriptionId: string,
  intent: GoogleAdsCheckoutEvidence | null,
  deliveryStatus: string,
  requestId: string | null = null
): OperatorTrialView {
  const parsed = OPERATOR_SUBSCRIPTION_ID.test(subscriptionId) ? subscriptionId : "";
  return operatorView({
    eligibility: "ineligible",
    subscriptionId: parsed,
    clickType: clickTypeOf(intent),
    requestCountry: countryCode(intent?.request_country),
    transactionId: parsed ? googleAdsTransactionId("trial_started", parsed) : null,
    deliveryStatus,
    requestId,
  });
}

function decideTrial(args: {
  subscription: Stripe.Subscription;
  intent: GoogleAdsCheckoutEvidence | null;
  nowUnix: number;
}): ReadyTrial | { ok: false; view: OperatorTrialView } {
  const subscriptionId =
    typeof args.subscription.id === "string" ? args.subscription.id.trim() : "";
  if (!OPERATOR_SUBSCRIPTION_ID.test(subscriptionId)) {
    return { ok: false, view: stoppedView("", args.intent, "invalid_subscription_id") };
  }
  const base = {
    subscriptionId,
    intent: args.intent,
  };
  if (!isRecognizedSummittSubscription(args.subscription)) {
    return { ok: false, view: stoppedView(base.subscriptionId, base.intent, "not_recognized") };
  }
  if (!subscriptionHasActiveTrial(args.subscription, args.nowUnix)) {
    return { ok: false, view: stoppedView(base.subscriptionId, base.intent, "trial_inactive") };
  }
  const eligible = googleAdsUploadEligibility({
    ownerCanary: isOwnerCanaryMetadata(args.subscription.metadata),
    subscriptionLivemode: args.subscription.livemode,
    intent: args.intent,
  });
  if (!eligible.ok) {
    return { ok: false, view: stoppedView(base.subscriptionId, base.intent, eligible.reason) };
  }
  const eventTime = metaStartTrialEventUnix(
    args.subscription,
    typeof args.subscription.created === "number" ? args.subscription.created : args.nowUnix
  );
  const transactionId = googleAdsTransactionId("trial_started", subscriptionId);
  if (!transactionId || eventTime < args.nowUnix - GOOGLE_ADS_CONVERSION_MAX_EVENT_AGE_SECONDS) {
    return { ok: false, view: stoppedView(base.subscriptionId, base.intent, "event_too_old") };
  }
  return {
    ok: true,
    subscriptionId,
    click: eligible.click,
    eventTime,
    transactionId,
    country: "US",
  };
}

async function loadReadyTrial(
  rawSubscriptionId: string,
  deps: OperatorTrialDeps | undefined
): Promise<{ subscription: Stripe.Subscription; intent: GoogleAdsCheckoutEvidence | null; ready: ReadyTrial } | { view: OperatorTrialView }> {
  const subscriptionId = rawSubscriptionId.trim();
  if (!OPERATOR_SUBSCRIPTION_ID.test(subscriptionId)) {
    return { view: stoppedView("", null, "invalid_subscription_id") };
  }
  if (googleAdsIngestEnabled(process.env)) {
    return { view: stoppedView(subscriptionId, null, "automatic_ingestion_enabled") };
  }
  if (!readGoogleAdsConfig(process.env)) {
    return { view: stoppedView(subscriptionId, null, "credentials_missing") };
  }
  let subscription: Stripe.Subscription;
  try {
    subscription = await loadOperatorSubscription(subscriptionId, deps);
  } catch (err) {
    return { view: stoppedView(subscriptionId, null, stripeLoadStatus(err)) };
  }
  if (subscription.id.trim() !== subscriptionId) {
    return { view: stoppedView(subscriptionId, null, "not_found") };
  }
  let intent: GoogleAdsCheckoutEvidence | null;
  try {
    intent = await loadIntentBySubscriptionId(subscriptionId);
  } catch {
    return { view: stoppedView(subscriptionId, null, "intent_unavailable") };
  }
  const decision = decideTrial({
    subscription,
    intent,
    nowUnix: deps?.nowUnix ?? Math.floor(Date.now() / 1000),
  });
  if (!decision.ok) return { view: decision.view };
  return { subscription, intent, ready: decision };
}

function viewFromReady(
  ready: ReadyTrial,
  intent: GoogleAdsCheckoutEvidence | null,
  deliveryStatus: string,
  eligibility: OperatorTrialView["eligibility"],
  requestId: string | null = null
): OperatorTrialView {
  return operatorView({
    eligibility,
    subscriptionId: ready.subscriptionId,
    clickType: clickTypeOf(intent) ?? ready.click.type,
    requestCountry: countryCode(intent?.request_country) ?? ready.country,
    transactionId: ready.transactionId,
    deliveryStatus,
    requestId,
  });
}

function occupancyStops(
  occupancy: GoogleAdsTrialOccupancy,
  ready: ReadyTrial,
  intent: GoogleAdsCheckoutEvidence | null
): OperatorTrialView | null {
  if (occupancy.status === "empty") return null;
  if (occupancy.status === "blocked") {
    return viewFromReady(ready, intent, "ledger_occupied", "ineligible");
  }
  if (occupancy.status === "unavailable") {
    return viewFromReady(ready, intent, "ledger_unavailable", "ineligible");
  }
  if (occupancy.ledgerStatus === "ingestion_accepted") {
    return viewFromReady(ready, intent, "already_accepted", "eligible", occupancy.requestId);
  }
  if (occupancy.ledgerStatus === "suppressed") {
    return viewFromReady(ready, intent, "suppressed", "ineligible");
  }
  if (occupancy.lock === "sending") return viewFromReady(ready, intent, "in_flight", "ineligible");
  if (occupancy.lock === "ambiguous") return viewFromReady(ready, intent, "ambiguous", "ineligible");
  if (occupancy.lock === "blocked") return viewFromReady(ready, intent, "blocked", "ineligible");
  return null;
}

/** Read-only eligibility. Does not claim a row or call Google. */
export async function previewOperatorGoogleAdsTrial(
  rawSubscriptionId: string,
  deps?: OperatorTrialDeps
): Promise<OperatorTrialView> {
  try {
    const loaded = await loadReadyTrial(rawSubscriptionId, deps);
    if ("view" in loaded) return loaded.view;
    const occupancy = await inspectGoogleAdsTrialOccupancy(loaded.ready.subscriptionId);
    const stopped = occupancyStops(occupancy, loaded.ready, loaded.intent);
    if (stopped) return stopped;
    return viewFromReady(loaded.ready, loaded.intent, "not_sent", "eligible");
  } catch {
    console.warn("[google-ads] operator preview unexpected");
    return stoppedView("", null, "unavailable");
  }
}

/** One authorized trial upload. Automatic ingestion stays behind the global flag. */
export async function confirmOperatorGoogleAdsTrial(
  rawSubscriptionId: string,
  deps?: OperatorTrialDeps
): Promise<OperatorTrialView> {
  try {
    const loaded = await loadReadyTrial(rawSubscriptionId, deps);
    if ("view" in loaded) return loaded.view;
    const before = await inspectGoogleAdsTrialOccupancy(loaded.ready.subscriptionId);
    const blocked = occupancyStops(before, loaded.ready, loaded.intent);
    if (blocked) return blocked;

    const inserted = await insertOperatorGoogleAdsSend({
      eventKind: "trial_started",
      stripeSubscriptionId: loaded.ready.subscriptionId,
      transactionId: loaded.ready.transactionId,
      eventTime: loaded.ready.eventTime,
      value: null,
      currency: null,
      clickType: loaded.ready.click.type,
      clickId: loaded.ready.click.value,
    });
    if (inserted.status === "busy") {
      return viewFromReady(loaded.ready, loaded.intent, "busy", "ineligible");
    }
    if (inserted.status === "ingestion_accepted" || inserted.status === "suppressed") {
      const again = await inspectGoogleAdsTrialOccupancy(loaded.ready.subscriptionId);
      const settled = occupancyStops(again, loaded.ready, loaded.intent);
      if (settled) return settled;
      return viewFromReady(
        loaded.ready,
        loaded.intent,
        inserted.status === "ingestion_accepted" ? "already_accepted" : "suppressed",
        inserted.status === "ingestion_accepted" ? "eligible" : "ineligible"
      );
    }
    if (inserted.status !== "locked" && inserted.status !== "existing") {
      return viewFromReady(loaded.ready, loaded.intent, "ledger_unavailable", "ineligible");
    }

    const row = inserted.row;
    if (inserted.status === "existing") {
      const acquired = await acquireOperatorGoogleAdsSend(row.id);
      if (acquired.status === "busy") {
        return viewFromReady(loaded.ready, loaded.intent, "busy", "ineligible");
      }
      if (acquired.status !== "acquired") {
        const gate = await readGoogleAdsOperatorGate(row.id);
        if (gate?.status === "ingestion_accepted") {
          return viewFromReady(loaded.ready, loaded.intent, "already_accepted", "eligible", gate.requestId);
        }
        if (gate?.status === "suppressed" || gate?.lock === "blocked") {
          return viewFromReady(
            loaded.ready,
            loaded.intent,
            gate?.status === "suppressed" ? "suppressed" : "blocked",
            "ineligible"
          );
        }
        if (gate?.lock === "ambiguous") {
          return viewFromReady(loaded.ready, loaded.intent, "ambiguous", "ineligible");
        }
        if (gate?.lock === "sending") {
          return viewFromReady(loaded.ready, loaded.intent, "in_flight", "ineligible");
        }
        return viewFromReady(loaded.ready, loaded.intent, "ledger_unavailable", "ineligible");
      }
    }

    const tokenConfig = readGoogleAdsConfig(process.env);
    if (!tokenConfig || googleAdsIngestEnabled(process.env)) {
      await markOperatorGoogleAdsBlocked(row.id);
      return viewFromReady(
        loaded.ready,
        loaded.intent,
        googleAdsIngestEnabled(process.env) ? "automatic_ingestion_enabled" : "credentials_missing",
        "ineligible"
      );
    }
    const accessToken = await googleAdsAccessToken(tokenConfig);
    if (!accessToken) {
      await finishOperatorGoogleAdsSend(row.id, "token_rejected");
      return viewFromReady(loaded.ready, loaded.intent, "token_rejected", "ineligible");
    }

    const fresh = await loadReadyTrial(rawSubscriptionId, deps);
    if ("view" in fresh) {
      if (
        fresh.view.deliveryStatus === "stripe_unavailable" ||
        fresh.view.deliveryStatus === "intent_unavailable"
      ) {
        await finishOperatorGoogleAdsSend(row.id, fresh.view.deliveryStatus);
      } else {
        await markOperatorGoogleAdsBlocked(row.id);
      }
      return fresh.view;
    }
    if (
      fresh.ready.click.type !== row.google_click_id_type ||
      fresh.ready.click.value !== row.google_click_id ||
      fresh.ready.eventTime !== row.event_time
    ) {
      await markOperatorGoogleAdsBlocked(row.id);
      return viewFromReady(fresh.ready, fresh.intent, "eligibility_changed", "ineligible");
    }
    if (googleAdsIngestEnabled(process.env) || !readGoogleAdsConfig(process.env)) {
      await markOperatorGoogleAdsBlocked(row.id);
      return viewFromReady(
        fresh.ready,
        fresh.intent,
        googleAdsIngestEnabled(process.env) ? "automatic_ingestion_enabled" : "credentials_missing",
        "ineligible"
      );
    }
    const hold = await assessOperatorSendHold(row.id);
    if (hold.status === "suppressed") {
      return viewFromReady(fresh.ready, fresh.intent, "suppressed", "ineligible");
    }
    if (hold.status === "accepted") {
      return viewFromReady(fresh.ready, fresh.intent, "already_accepted", "eligible", hold.requestId);
    }
    if (hold.status !== "clear") {
      if (hold.status === "unavailable") {
        await finishOperatorGoogleAdsSend(row.id, "ledger_unavailable");
      } else {
        await markOperatorGoogleAdsBlocked(row.id);
      }
      return viewFromReady(
        fresh.ready,
        fresh.intent,
        hold.status === "unavailable" ? "ledger_unavailable" : "ledger_occupied",
        "ineligible"
      );
    }
    const gate = await readGoogleAdsOperatorGate(row.id);
    if (gate?.status === "suppressed") {
      return viewFromReady(fresh.ready, fresh.intent, "suppressed", "ineligible");
    }
    if (gate?.status === "ingestion_accepted") {
      return viewFromReady(fresh.ready, fresh.intent, "already_accepted", "eligible", gate.requestId);
    }
    if (!gate) {
      await finishOperatorGoogleAdsSend(row.id, "ledger_unavailable");
      return viewFromReady(fresh.ready, fresh.intent, "ledger_unavailable", "ineligible");
    }
    if (gate.status !== "pending" || gate.lock !== "sending") {
      return viewFromReady(fresh.ready, fresh.intent, "in_flight", "ineligible");
    }

    const config = readGoogleAdsConfig(process.env);
    if (googleAdsIngestEnabled(process.env) || !config) {
      await markOperatorGoogleAdsBlocked(row.id);
      return viewFromReady(
        fresh.ready,
        fresh.intent,
        googleAdsIngestEnabled(process.env) ? "automatic_ingestion_enabled" : "credentials_missing",
        "ineligible"
      );
    }
    const result = await postGoogleAdsIngest({
      config,
      accessToken,
      draft: {
        kind: "trial_started",
        transactionId: row.transaction_id,
        eventTimeUnix: row.event_time,
        click: { type: row.google_click_id_type, value: row.google_click_id },
        valueUsd: null,
      },
    });
    if (result.outcome === "ingestion_accepted") {
      await markGoogleAdsIngestionAccepted(row.id, result.requestId);
      return viewFromReady(fresh.ready, fresh.intent, "ingestion_accepted", "eligible", result.requestId);
    }
    if (AMBIGUOUS_INGEST.has(result.reason)) {
      await markOperatorGoogleAdsAmbiguous(row.id);
      return viewFromReady(fresh.ready, fresh.intent, result.reason, "ineligible");
    }
    await finishOperatorGoogleAdsSend(row.id, result.reason);
    return viewFromReady(fresh.ready, fresh.intent, result.reason, "ineligible");
  } catch {
    console.warn("[google-ads] operator confirm unexpected");
    return stoppedView("", null, "unavailable");
  }
}
