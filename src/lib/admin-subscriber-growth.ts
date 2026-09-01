import "server-only";

import Stripe from "stripe";

import { listAdSpendInRange } from "@/lib/admin-ad-spend";
import {
  activationSeedsFromTrials,
  clerkIdsActivatedWithin24h,
} from "@/lib/admin-growth-activation";
import {
  addDaysToDateKey,
  aggregateTrafficSourceRows,
  appleSubscriberIdentity,
  clerkUserIdFromStripeSub,
  computeGrowthSnapshot,
  emptyUnknownSnapshot,
  growthPeriodUtcMs,
  paidConversionUnix,
  parseGrowthDateRange,
  parseGrowthTrafficSource,
  stripeSubscriberIdentity,
  SUBSCRIBER_GROWTH_TZ,
  unixSecondsInPeriod,
  type GrowthAppleRow,
  type GrowthStripeSubscription,
  type GrowthTrafficSource,
  type MarketingAttributionRow,
  type MarketingEventRow,
  type MetricNumber,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";
import { attributionMatchesDashboardSource } from "@/lib/marketing-attribution-pure";
import { isAppleRowCurrentlyGranting } from "@/lib/summitt-membership-entitlement";
import { listClerkUsers } from "@/lib/clerk-rest";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";

const STRIPE_PAGE_SIZE = 100;
const STRIPE_MAX_PAGES = 80;
const CLERK_LIST_BATCH_SIZE = 200;
const MAX_CLERK_SCAN_BATCHES = 100;
const MARKETING_EVENT_PAGE = 1000;
const MARKETING_MAX_PAGES = 50;

export type { SubscriberGrowthDashboardData };

function firstQueryValue(
  raw: string | string[] | undefined
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function mapStripeSubscription(
  sub: Stripe.Subscription
): GrowthStripeSubscription {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const mappedPrice =
    typeof price === "string"
      ? { id: price }
      : price
        ? {
            id: price.id,
            unit_amount: price.unit_amount,
            recurring: price.recurring
              ? { interval: price.recurring.interval }
              : null,
          }
        : null;

  return {
    id: sub.id,
    status: sub.status,
    customer:
      typeof sub.customer === "string"
        ? sub.customer
        : sub.customer && !("deleted" in sub.customer && sub.customer.deleted)
          ? sub.customer.id
          : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at,
    ended_at: sub.ended_at,
    trial_start: sub.trial_start,
    trial_end: sub.trial_end,
    created: sub.created ?? null,
    start_date: sub.start_date ?? null,
    pause_collection: sub.pause_collection
      ? { behavior: sub.pause_collection.behavior ?? null }
      : null,
    metadata: (sub.metadata ?? null) as Record<string, string> | null,
    items: { data: [{ price: mappedPrice }] },
  };
}

async function listStripeSubscriptions(
  stripe: Stripe
): Promise<{ subs: GrowthStripeSubscription[]; complete: boolean }> {
  const subs: GrowthStripeSubscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < STRIPE_MAX_PAGES; page += 1) {
    const res = await stripe.subscriptions.list({
      status: "all",
      limit: STRIPE_PAGE_SIZE,
      starting_after: startingAfter,
      expand: ["data.items.data.price"],
    });
    for (const sub of res.data) {
      subs.push(mapStripeSubscription(sub));
    }
    if (!res.has_more) return { subs, complete: true };
    startingAfter = res.data[res.data.length - 1]?.id;
    if (!startingAfter) return { subs, complete: false };
  }
  return { subs, complete: false };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = (invoice as { subscription?: string | { id?: string } | null })
    .subscription;
  if (typeof raw === "string" && raw) return raw;
  if (raw && typeof raw === "object" && typeof raw.id === "string") {
    return raw.id;
  }
  return null;
}

function invoiceHasRecognizedPrice(
  invoice: Stripe.Invoice,
  recognized: ReadonlySet<string>
): boolean {
  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    const price = (
      line as {
        price?: string | { id?: string | null } | null;
        pricing?: { price_details?: { price?: string | null } | null } | null;
      }
    ).price;
    const id =
      typeof price === "string"
        ? price
        : price?.id ??
          (line as { pricing?: { price_details?: { price?: string | null } } })
            .pricing?.price_details?.price;
    if (typeof id === "string" && recognized.has(id)) return true;
  }
  return false;
}

function isSummittInvoice(
  invoice: Stripe.Invoice,
  recognized: ReadonlySet<string>,
  summitSubIds: ReadonlySet<string>
): boolean {
  const subId = invoiceSubscriptionId(invoice);
  if (subId && summitSubIds.has(subId)) return true;
  return invoiceHasRecognizedPrice(invoice, recognized);
}

async function listPeriodStripeInvoices(args: {
  stripe: Stripe;
  startMs: number | null;
  endMs: number;
  recognized: ReadonlySet<string>;
  summitSubIds: ReadonlySet<string>;
}): Promise<{
  revenueCents: MetricNumber;
  paidInvoiceSubIds: Set<string>;
  failedIdentities: Set<string>;
  complete: boolean;
}> {
  const paidInvoiceSubIds = new Set<string>();
  const failedIdentities = new Set<string>();
  let cents = 0;
  let startingAfter: string | undefined;
  const created: Stripe.RangeQueryParam =
    args.startMs != null
      ? {
          gte: Math.floor(args.startMs / 1000),
          lt: Math.floor(args.endMs / 1000),
        }
      : { lt: Math.floor(args.endMs / 1000) };

  for (let page = 0; page < STRIPE_MAX_PAGES; page += 1) {
    const res = await args.stripe.invoices.list({
      created,
      limit: STRIPE_PAGE_SIZE,
      starting_after: startingAfter,
    });
    for (const invoice of res.data) {
      if (!isSummittInvoice(invoice, args.recognized, args.summitSubIds)) {
        continue;
      }
      const subId = invoiceSubscriptionId(invoice);
      if (invoice.status === "paid" && invoice.amount_paid && invoice.amount_paid > 0) {
        cents += invoice.amount_paid;
        if (subId) paidInvoiceSubIds.add(subId);
      }
      const attempted = Boolean(
        (invoice as { attempted?: boolean }).attempted ?? invoice.attempt_count > 0
      );
      const failedStatus =
        invoice.status === "open" || invoice.status === "uncollectible";
      if (attempted && failedStatus && invoice.status !== "paid") {
        failedIdentities.add(subId ? `sub:${subId}` : `inv:${invoice.id}`);
      }
    }
    if (!res.has_more) {
      return { revenueCents: cents, paidInvoiceSubIds, failedIdentities, complete: true };
    }
    startingAfter = res.data[res.data.length - 1]?.id;
    if (!startingAfter) {
      return {
        revenueCents: null,
        paidInvoiceSubIds,
        failedIdentities,
        complete: false,
      };
    }
  }
  return {
    revenueCents: null,
    paidInvoiceSubIds,
    failedIdentities,
    complete: false,
  };
}

async function countClerkAccountsCreated(args: {
  startMs: number | null;
  endMs: number;
}): Promise<MetricNumber> {
  let offset = 0;
  let counted = 0;
  for (let batch = 0; batch < MAX_CLERK_SCAN_BATCHES; batch += 1) {
    const users = await listClerkUsers({
      limit: CLERK_LIST_BATCH_SIZE,
      offset,
    });
    for (const user of users) {
      const createdAt = user.created_at;
      if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) continue;
      if (args.startMs != null && createdAt < args.startMs) continue;
      if (createdAt >= args.endMs) continue;
      counted += 1;
    }
    if (users.length < CLERK_LIST_BATCH_SIZE) return counted;
    offset += CLERK_LIST_BATCH_SIZE;
  }
  return null;
}

async function loadAppleRows(now: Date): Promise<{
  granting: GrowthAppleRow[];
  cancelRequestedStillActive: GrowthAppleRow[];
  byOriginalTxn: Map<string, GrowthAppleRow>;
  complete: boolean;
}> {
  const { data, error } = await supabaseServer
    .from("apple_subscriptions")
    .select(
      "clerk_user_id, original_transaction_id, product_id, status, expires_at, auto_renew_enabled"
    );

  if (error) {
    return {
      granting: [],
      cancelRequestedStillActive: [],
      byOriginalTxn: new Map(),
      complete: false,
    };
  }

  const grantingByIdentity = new Map<string, GrowthAppleRow>();
  const cancelByIdentity = new Map<string, GrowthAppleRow>();
  const byOriginalTxn = new Map<string, GrowthAppleRow>();
  for (const raw of data ?? []) {
    const row: GrowthAppleRow = {
      clerk_user_id:
        typeof raw.clerk_user_id === "string" ? raw.clerk_user_id : null,
      original_transaction_id:
        typeof raw.original_transaction_id === "string"
          ? raw.original_transaction_id
          : null,
      product_id: typeof raw.product_id === "string" ? raw.product_id : null,
      status: typeof raw.status === "string" ? raw.status : null,
      expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null,
      auto_renew_enabled: raw.auto_renew_enabled === true,
    };
    if (row.original_transaction_id) {
      byOriginalTxn.set(row.original_transaction_id, row);
    }
    if (
      !row.product_id ||
      !row.status ||
      !isAppleRowCurrentlyGranting(
        {
          product_id: row.product_id,
          status: row.status,
          expires_at: row.expires_at ?? null,
        },
        now
      )
    ) {
      continue;
    }
    const identity = appleSubscriberIdentity(row);
    grantingByIdentity.set(identity, row);
    if (row.auto_renew_enabled === false) {
      cancelByIdentity.set(identity, row);
    }
  }

  return {
    granting: [...grantingByIdentity.values()],
    cancelRequestedStillActive: [...cancelByIdentity.values()],
    byOriginalTxn,
    complete: true,
  };
}

async function loadAppleNotificationClerkIds(args: {
  types: string[];
  startMs: number | null;
  endMs: number;
  byOriginalTxn: Map<string, GrowthAppleRow>;
}): Promise<Set<string>> {
  const out = new Set<string>();
  if (args.types.length === 0) return out;
  let q = supabaseServer
    .from("apple_notification_events")
    .select("notification_type, original_transaction_id, created_at")
    .in("notification_type", args.types)
    .lt("created_at", new Date(args.endMs).toISOString());
  if (args.startMs != null) {
    q = q.gte("created_at", new Date(args.startMs).toISOString());
  }
  const { data, error } = await q;
  if (error) {
    console.warn("[subscriber-growth] apple notifications query failed", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const txn =
      typeof row.original_transaction_id === "string"
        ? row.original_transaction_id
        : null;
    if (!txn) continue;
    const sub = args.byOriginalTxn.get(txn);
    const clerk = sub?.clerk_user_id?.trim();
    if (clerk) out.add(clerk);
  }
  return out;
}

async function loadMarketingAttribution(): Promise<MarketingAttributionRow[]> {
  const { data, error } = await supabaseServer
    .from("marketing_attribution")
    .select(
      "clerk_user_id, visitor_id, source_normalized, is_paid_acquisition, source_detail, utm_campaign, utm_content"
    );
  if (error) {
    console.warn("[subscriber-growth] attribution query failed", error.message);
    return [];
  }
  const rows: MarketingAttributionRow[] = [];
  for (const raw of data ?? []) {
    if (typeof raw.clerk_user_id !== "string" || typeof raw.visitor_id !== "string") {
      continue;
    }
    if (typeof raw.source_normalized !== "string") continue;
    rows.push({
      clerk_user_id: raw.clerk_user_id,
      visitor_id: raw.visitor_id,
      source_normalized: raw.source_normalized,
      is_paid_acquisition: raw.is_paid_acquisition === true,
      source_detail: typeof raw.source_detail === "string" ? raw.source_detail : null,
      utm_campaign: typeof raw.utm_campaign === "string" ? raw.utm_campaign : null,
      utm_content: typeof raw.utm_content === "string" ? raw.utm_content : null,
    });
  }
  return rows;
}

async function loadMarketingEvents(args: {
  startMs: number | null;
  endMs: number;
}): Promise<{ rows: MarketingEventRow[]; earliestMs: number | null; complete: boolean }> {
  const rows: MarketingEventRow[] = [];
  let earliestMs: number | null = null;
  let from = 0;
  for (let page = 0; page < MARKETING_MAX_PAGES; page += 1) {
    let q = supabaseServer
      .from("marketing_events")
      .select(
        "event_type, visitor_id, occurred_at, source_normalized, is_paid_acquisition, utm_campaign, utm_content, clerk_user_id"
      )
      .lt("occurred_at", new Date(args.endMs).toISOString())
      .order("occurred_at", { ascending: true })
      .range(from, from + MARKETING_EVENT_PAGE - 1);
    if (args.startMs != null) {
      q = q.gte("occurred_at", new Date(args.startMs).toISOString());
    }
    const { data, error } = await q;
    if (error) {
      console.warn("[subscriber-growth] marketing_events query failed", error.message);
      return { rows: [], earliestMs: null, complete: false };
    }
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.event_type !== "string" || typeof raw.visitor_id !== "string") continue;
      if (typeof raw.occurred_at !== "string") continue;
      const at = Date.parse(raw.occurred_at);
      if (Number.isFinite(at) && (earliestMs == null || at < earliestMs)) earliestMs = at;
      rows.push({
        event_type: raw.event_type,
        visitor_id: raw.visitor_id,
        occurred_at: raw.occurred_at,
        source_normalized:
          typeof raw.source_normalized === "string" ? raw.source_normalized : null,
        is_paid_acquisition: raw.is_paid_acquisition === true,
        utm_campaign: typeof raw.utm_campaign === "string" ? raw.utm_campaign : null,
        utm_content: typeof raw.utm_content === "string" ? raw.utm_content : null,
        clerk_user_id: typeof raw.clerk_user_id === "string" ? raw.clerk_user_id : null,
      });
    }
    if (batch.length < MARKETING_EVENT_PAGE) {
      return { rows, earliestMs, complete: true };
    }
    from += MARKETING_EVENT_PAGE;
  }
  return { rows, earliestMs, complete: false };
}

async function loadInstrumentationStartMs(): Promise<number | null> {
  const envRaw = process.env.MARKETING_INSTRUMENTATION_START?.trim();
  if (envRaw) {
    const parsed = Date.parse(envRaw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const { data, error } = await supabaseServer
    .from("marketing_events")
    .select("occurred_at")
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.occurred_at) return null;
  const ms = Date.parse(String(data.occurred_at));
  return Number.isFinite(ms) ? ms : null;
}

function formatNyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SUBSCRIBER_GROWTH_TZ,
    dateStyle: "medium",
  }).format(new Date(ms));
}

export async function loadSubscriberGrowthDashboard(args: {
  searchParams?: Record<string, string | string[] | undefined>;
  now?: Date;
}): Promise<SubscriberGrowthDashboardData> {
  const now = args.now ?? new Date();
  const range = parseGrowthDateRange(firstQueryValue(args.searchParams?.range));
  const source = parseGrowthTrafficSource(
    firstQueryValue(args.searchParams?.source)
  );
  const todayKey = getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ);
  const period = growthPeriodUtcMs(range, todayKey);
  const asOfNowLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: SUBSCRIBER_GROWTH_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
  const warnings: string[] = [];

  if (!period) {
    warnings.push("Could not resolve the America/New_York period bounds.");
    return {
      range,
      source,
      timezone: SUBSCRIBER_GROWTH_TZ,
      asOfNowLabel,
      snapshot: emptyUnknownSnapshot(),
      warnings,
      adSpendEntries: [],
    };
  }

  const recognized = getRecognizedSummittPriceIds();
  const key = process.env.STRIPE_SECRET_KEY;
  let stripeSubs: GrowthStripeSubscription[] = [];
  let stripeListComplete = false;
  let stripeRevenueCents: MetricNumber = null;
  let paidInvoiceSubIds = new Set<string>();
  let stripeFailedIdentities = new Set<string>();

  if (!key) {
    warnings.push("Stripe is not configured; Stripe metrics are unavailable.");
  } else {
    try {
      const stripe = new Stripe(key);
      const listed = await listStripeSubscriptions(stripe);
      stripeSubs = listed.subs;
      stripeListComplete = listed.complete;
      if (!listed.complete) {
        warnings.push(
          "Stripe subscription list was truncated. Stripe-derived metrics are shown as —."
        );
      }
      const summitSubIds = new Set(
        stripeSubs
          .filter((sub) => {
            const uid = sub.metadata?.userId?.trim();
            const plan = sub.metadata?.plan;
            const priceId = sub.items?.data?.[0]?.price;
            const id = typeof priceId === "string" ? priceId : priceId?.id;
            return Boolean(
              uid ||
                plan === "monthly" ||
                plan === "annual" ||
                (id && recognized.has(id))
            );
          })
          .map((sub) => sub.id)
      );
      const invoices = await listPeriodStripeInvoices({
        stripe,
        startMs: period.startMs,
        endMs: period.endMs,
        recognized,
        summitSubIds,
      });
      paidInvoiceSubIds = invoices.paidInvoiceSubIds;
      stripeFailedIdentities = invoices.failedIdentities;
      stripeRevenueCents = invoices.complete ? invoices.revenueCents : null;
      if (!invoices.complete) {
        warnings.push(
          "Stripe invoice list was truncated. Collected revenue and payment-failed are shown as —."
        );
      }
    } catch {
      stripeListComplete = false;
      stripeRevenueCents = null;
      warnings.push("Stripe could not be queried. Stripe metrics are shown as —.");
    }
  }

  let appleGranting: GrowthAppleRow[] = [];
  let appleCancelRequestedStillActive: GrowthAppleRow[] = [];
  let appleByTxn = new Map<string, GrowthAppleRow>();
  let appleQueryComplete = false;
  try {
    const apple = await loadAppleRows(now);
    appleGranting = apple.granting;
    appleCancelRequestedStillActive = apple.cancelRequestedStillActive;
    appleByTxn = apple.byOriginalTxn;
    appleQueryComplete = apple.complete;
    if (!apple.complete) {
      warnings.push("Apple subscriptions could not be queried. Related metrics are shown as —.");
    }
  } catch {
    appleQueryComplete = false;
    warnings.push("Apple subscriptions could not be queried. Related metrics are shown as —.");
  }

  const appleFailedClerkIds = await loadAppleNotificationClerkIds({
    types: ["DID_FAIL_TO_RENEW"],
    startMs: period.startMs,
    endMs: period.endMs,
    byOriginalTxn: appleByTxn,
  });
  const appleEndedClerkIds = await loadAppleNotificationClerkIds({
    types: ["EXPIRED", "REVOKE", "REFUND"],
    startMs: period.startMs,
    endMs: period.endMs,
    byOriginalTxn: appleByTxn,
  });

  const attributions = await loadMarketingAttribution();
  const attrByClerk = new Map(attributions.map((a) => [a.clerk_user_id, a] as const));

  const sourceFilteredSubs =
    source === "all"
      ? stripeSubs
      : stripeSubs.filter((sub) => {
          const clerk = clerkUserIdFromStripeSub(sub);
          if (!clerk) return false;
          const attr = attrByClerk.get(clerk);
          if (!attr) return false;
          return attributionMatchesDashboardSource(attr.source_normalized, source);
        });

  const eventsWindowStart = period.startMs;
  const marketing = await loadMarketingEvents({
    startMs: eventsWindowStart,
    endMs: period.endMs,
  });
  const instrumentationStartMs = await loadInstrumentationStartMs();
  const instrumentationStartLabel =
    instrumentationStartMs != null ? formatNyDate(instrumentationStartMs) : null;

  const trackingAvailable = instrumentationStartMs != null;
  const eventsForPeriod = marketing.rows.filter((ev) => {
    if (!attributionMatchesDashboardSource(ev.source_normalized, source)) return false;
    return true;
  });

  const uniqueVisitors: MetricNumber = trackingAvailable
    ? new Set(
        eventsForPeriod
          .filter((e) => e.event_type === "page_viewed")
          .map((e) => e.visitor_id)
      ).size
    : null;
  const ctaClicks: MetricNumber = trackingAvailable
    ? eventsForPeriod.filter((e) => e.event_type === "trial_cta_clicked").length
    : null;

  let accountsCreated: MetricNumber = null;
  if (source === "all") {
    try {
      accountsCreated = await countClerkAccountsCreated({
        startMs: period.startMs,
        endMs: period.endMs,
      });
      if (accountsCreated == null) {
        warnings.push(
          "Clerk user list was truncated. Accounts created is shown as —."
        );
      }
    } catch {
      accountsCreated = null;
      warnings.push("Clerk could not be queried. Accounts created is shown as —.");
    }
  } else if (trackingAvailable) {
    accountsCreated = eventsForPeriod.filter(
      (e) => e.event_type === "account_created"
    ).length;
  }

  const trialSubs = sourceFilteredSubs.filter((sub) =>
    unixSecondsInPeriod(sub.trial_start, period.startMs, period.endMs)
  );
  const trialClerkIds = trialSubs
    .map((s) => clerkUserIdFromStripeSub(s))
    .filter((id): id is string => Boolean(id));

  let activatedIds = new Set<string>();
  try {
    activatedIds = await clerkIdsActivatedWithin24h(
      activationSeedsFromTrials(
        trialSubs.map((s) => ({
          clerkUserId: clerkUserIdFromStripeSub(s),
          trialStartUnix: s.trial_start,
        }))
      )
    );
  } catch (err) {
    console.warn("[subscriber-growth] activation query failed", err);
  }

  const paidConversionClerkIds: string[] = [];
  for (const sub of sourceFilteredSubs) {
    const conv = paidConversionUnix(sub, paidInvoiceSubIds.has(sub.id));
    if (!unixSecondsInPeriod(conv, period.startMs, period.endMs)) continue;
    const clerk = clerkUserIdFromStripeSub(sub);
    if (clerk) paidConversionClerkIds.push(clerk);
  }

  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const startDateKey =
    period.startMs == null
      ? null
      : getDateKeyInTimezone(new Date(period.startMs), SUBSCRIBER_GROWTH_TZ);
  const adSpendEntries = await listAdSpendInRange({
    startDate: startDateKey,
    endDateExclusive: tomorrowKey,
  });
  const spendForFilter = adSpendEntries.filter((row) => {
    if (source === "all") return true;
    if (source === "meta_ads") return row.source_normalized === "meta";
    if (source === "google") return row.source_normalized === "google";
    return false;
  });
  const advertisingSpend = spendForFilter.reduce(
    (sum, row) => sum + row.amount_cents,
    0
  );

  const newPaidAttributedToAds = trackingAvailable
    ? paidConversionClerkIds.filter((clerk) => {
        const attr = attrByClerk.get(clerk);
        if (!attr || !attr.is_paid_acquisition) return false;
        return attributionMatchesDashboardSource(attr.source_normalized, source);
      }).length
    : null;

  const failedStripeDistinct = (() => {
    const identities = new Set<string>();
    const bySubId = new Map(stripeSubs.map((sub) => [sub.id, sub] as const));
    for (const token of stripeFailedIdentities) {
      if (token.startsWith("sub:")) {
        const sub = bySubId.get(token.slice(4));
        identities.add(sub ? stripeSubscriberIdentity(sub) : token);
      } else {
        identities.add(token);
      }
    }
    return identities.size;
  })();
  const appleFailed = appleFailedClerkIds.size;
  const paymentFailedPeriod =
    stripeListComplete
      ? failedStripeDistinct + appleFailed
      : null;
  const paymentFailedScope =
    appleFailed > 0
      ? "Stripe invoices + linked Apple DID_FAIL_TO_RENEW"
      : "Stripe invoices in selected period";

  const appleEndedCount = appleEndedClerkIds.size;
  const paidEndedScope =
    appleEndedCount > 0 ? "Stripe + linked Apple expirations" : "Stripe";

  const trafficRows = trackingAvailable
    ? aggregateTrafficSourceRows({
        events: eventsForPeriod,
        attributions,
        trialClerkIds,
        activatedClerkIds: activatedIds,
        paidConversionClerkIds,
        adSpend: spendForFilter.map((r) => ({
          source_normalized: r.source_normalized,
          utm_campaign: r.utm_campaign,
          amount_cents: r.amount_cents,
        })),
        sourceFilter: source,
      })
    : [];

  if (instrumentationStartLabel) {
    warnings.push(`Traffic & attribution data available from ${instrumentationStartLabel}.`);
  } else if (source !== "all") {
    warnings.push(
      "Source-specific traffic begins after first-party instrumentation is deployed."
    );
  }

  const snapshot = computeGrowthSnapshot({
    stripeSubs: sourceFilteredSubs,
    appleGranting: source === "all" ? appleGranting : [],
    appleCancelRequestedStillActive:
      source === "all" ? appleCancelRequestedStillActive : [],
    recognizedPriceIds: recognized,
    nowUnix: Math.floor(now.getTime() / 1000),
    startMs: period.startMs,
    endMs: period.endMs,
    accountsCreated,
    stripeRevenueCents: source === "all" ? stripeRevenueCents : stripeRevenueCents,
    stripeListComplete,
    appleQueryComplete: source === "all" ? appleQueryComplete : true,
    paidInvoiceSubIds,
    uniqueVisitors,
    freeTrialButtonClicks: ctaClicks,
    activatedWithin24h: stripeListComplete ? activatedIds.size : null,
    advertisingSpend,
    newPaidAttributedToAds,
    paymentFailedPeriod,
    paidFullyEnded:
      stripeListComplete
        ? undefined
        : null,
    trafficRows,
    instrumentationStartMs,
    instrumentationStartLabel,
    sourceTrackingUnavailable: !trackingAvailable,
    paymentFailedScope,
    paidEndedScope,
  });

  if (appleEndedCount > 0 && snapshot.period.paidFullyEnded != null) {
    snapshot.period.paidFullyEnded += appleEndedCount;
  }

  return {
    range,
    source,
    timezone: SUBSCRIBER_GROWTH_TZ,
    asOfNowLabel,
    snapshot,
    warnings,
    adSpendEntries: spendForFilter,
  };
}
