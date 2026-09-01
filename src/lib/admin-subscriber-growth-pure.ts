/**
 * Slice 1 subscriber-growth math. No Stripe/Apple I/O.
 * Unknown metrics stay `null` and must render as "—", never a guessed 0.
 */

import { hasPauseCollection } from "@/lib/summitt-subscription-membership";
import { utcInstantForLocalMidnight } from "@/lib/timezone";

export const SUBSCRIBER_GROWTH_TZ = "America/New_York";
export const UNKNOWN_METRIC = "—";

export type GrowthDateRange = "today" | "last_7" | "last_30" | "all_time";
export type GrowthTrafficSource =
  | "all"
  | "direct"
  | "organic_social"
  | "meta_ads"
  | "google"
  | "referral";

export type MetricNumber = number | null;

export type GrowthStripePrice = {
  id?: string | null;
  unit_amount?: number | null;
  recurring?: { interval?: string | null } | null;
};

export type GrowthStripeItem = {
  price?: GrowthStripePrice | null;
};

export type GrowthStripeSubscription = {
  id: string;
  status: string;
  customer?: string | { id?: string | null } | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  created?: number | null;
  start_date?: number | null;
  pause_collection?: { behavior?: string | null } | null;
  metadata?: Record<string, string> | null;
  items?: { data?: GrowthStripeItem[] } | null;
};

export type GrowthAppleRow = {
  clerk_user_id?: string | null;
  original_transaction_id?: string | null;
  product_id?: string | null;
  status?: string | null;
  expires_at?: string | null;
  auto_renew_enabled?: boolean | null;
};

export function parseGrowthDateRange(raw: string | undefined | null): GrowthDateRange {
  if (raw === "today" || raw === "last_7" || raw === "last_30" || raw === "all_time") {
    return raw;
  }
  return "last_7";
}

export function parseGrowthTrafficSource(
  raw: string | undefined | null
): GrowthTrafficSource {
  if (
    raw === "direct" ||
    raw === "organic_social" ||
    raw === "meta_ads" ||
    raw === "google" ||
    raw === "referral"
  ) {
    return raw;
  }
  return "all";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function growthPeriodUtcMs(
  range: GrowthDateRange,
  todayKey: string
): { startMs: number | null; endMs: number } | null {
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const end = utcInstantForLocalMidnight(tomorrowKey, SUBSCRIBER_GROWTH_TZ);
  if (!end) return null;
  const endMs = end.getTime();
  if (range === "all_time") {
    return { startMs: null, endMs };
  }
  const startOffsetDays = range === "today" ? 0 : range === "last_7" ? -6 : -29;
  const startKey = addDaysToDateKey(todayKey, startOffsetDays);
  const start = utcInstantForLocalMidnight(startKey, SUBSCRIBER_GROWTH_TZ);
  if (!start) return null;
  return { startMs: start.getTime(), endMs };
}

export function unixSecondsInPeriod(
  unixSeconds: number | null | undefined,
  startMs: number | null,
  endMs: number
): boolean {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return false;
  const ms = unixSeconds * 1000;
  if (startMs != null && ms < startMs) return false;
  return ms < endMs;
}

export function formatUnknownableCount(value: MetricNumber): string {
  if (value == null) return UNKNOWN_METRIC;
  return String(value);
}

export function formatUnknownablePercent(ratio: MetricNumber): string {
  if (ratio == null || !Number.isFinite(ratio)) return UNKNOWN_METRIC;
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatUnknownableUsdFromCents(cents: MetricNumber): string {
  if (cents == null) return UNKNOWN_METRIC;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function conversionRate(
  numerator: MetricNumber,
  denominator: MetricNumber
): MetricNumber {
  if (numerator == null || denominator == null) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function stripePriceFromItem(
  item: GrowthStripeItem | undefined
): GrowthStripePrice | null {
  const price = item?.price;
  if (!price) return null;
  return price;
}

export function stripeCustomerId(
  sub: GrowthStripeSubscription
): string | null {
  if (typeof sub.customer === "string" && sub.customer) return sub.customer;
  if (sub.customer && typeof sub.customer === "object" && sub.customer.id) {
    return sub.customer.id;
  }
  return null;
}

export function stripeSubscriberIdentity(sub: GrowthStripeSubscription): string {
  const uid = sub.metadata?.userId?.trim();
  if (uid) return `clerk:${uid}`;
  const customerId = stripeCustomerId(sub);
  if (customerId) return `cus:${customerId}`;
  return `sub:${sub.id}`;
}

export function appleSubscriberIdentity(row: GrowthAppleRow): string {
  const uid = row.clerk_user_id?.trim();
  if (uid) return `clerk:${uid}`;
  const txn = row.original_transaction_id?.trim();
  if (txn) return `apple:${txn}`;
  return `apple-row:${row.product_id ?? "unknown"}`;
}

export function isLikelySummittStripeSubscription(
  sub: GrowthStripeSubscription,
  recognizedPriceIds: ReadonlySet<string>
): boolean {
  const uid = sub.metadata?.userId?.trim();
  if (uid) return true;
  const plan = sub.metadata?.plan;
  if (plan === "monthly" || plan === "annual") return true;
  const price = stripePriceFromItem(sub.items?.data?.[0]);
  return Boolean(price?.id && recognizedPriceIds.has(price.id));
}

export function isStripePaidActive(sub: GrowthStripeSubscription): boolean {
  if (sub.status !== "active") return false;
  if (hasPauseCollection(sub)) return false;
  return true;
}

export function stripeInterval(
  sub: GrowthStripeSubscription
): "month" | "year" | null {
  const fromPrice = stripePriceFromItem(sub.items?.data?.[0])?.recurring
    ?.interval;
  if (fromPrice === "month" || fromPrice === "year") return fromPrice;
  const plan = sub.metadata?.plan;
  if (plan === "monthly") return "month";
  if (plan === "annual") return "year";
  return null;
}

export function mrrCentsFromStripePriceAmount(
  sub: GrowthStripeSubscription
): number | null {
  const amount = stripePriceFromItem(sub.items?.data?.[0])?.unit_amount;
  if (amount == null || !Number.isFinite(amount)) return null;
  const interval = stripeInterval(sub);
  if (interval === "month") return amount;
  if (interval === "year") return Math.round(amount / 12);
  return null;
}

export function becamePaidAfterTrial(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): boolean {
  const trialEnd = sub.trial_end;
  if (trialEnd == null) return false;
  if (cancelledDuringFreeTrial(sub)) return false;
  if (hadPaidInvoice) return true;
  if (
    sub.status === "active" ||
    sub.status === "past_due" ||
    sub.status === "unpaid"
  ) {
    return true;
  }
  if (hasPauseCollection(sub) && sub.status !== "trialing") return true;
  if (sub.canceled_at != null && sub.canceled_at > trialEnd) return true;
  if (sub.ended_at != null && sub.ended_at > trialEnd) return true;
  return false;
}

export function cancelledDuringFreeTrial(sub: GrowthStripeSubscription): boolean {
  if (sub.trial_end == null || sub.canceled_at == null) return false;
  return sub.canceled_at <= sub.trial_end;
}

export function finishedTrialWithoutPaid(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): boolean {
  if (sub.trial_end == null) return false;
  if (becamePaidAfterTrial(sub, hadPaidInvoice)) return false;
  if (cancelledDuringFreeTrial(sub)) return false;
  if (sub.status === "trialing") return false;
  return true;
}

export function endedAtUnix(sub: GrowthStripeSubscription): number | null {
  return sub.ended_at ?? sub.canceled_at ?? null;
}

export function paidSubscriptionFullyEnded(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): boolean {
  if (hasPauseCollection(sub)) return false;
  if (sub.status === "past_due") return false;
  if (
    sub.status !== "canceled" &&
    sub.status !== "incomplete_expired" &&
    sub.status !== "unpaid"
  ) {
    return false;
  }
  if (sub.trial_end != null && !becamePaidAfterTrial(sub, hadPaidInvoice)) {
    return false;
  }
  const end = endedAtUnix(sub);
  if (end == null) return false;
  if (sub.trial_end != null && end <= sub.trial_end) return false;
  return true;
}

export function paidStartUnix(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): number | null {
  if (sub.trial_end != null) {
    if (!becamePaidAfterTrial(sub, hadPaidInvoice)) return null;
    return sub.trial_end;
  }
  if (
    sub.status === "active" ||
    sub.status === "past_due" ||
    sub.status === "unpaid" ||
    sub.status === "canceled" ||
    sub.status === "incomplete_expired" ||
    hasPauseCollection(sub)
  ) {
    return sub.start_date ?? sub.created ?? null;
  }
  return null;
}

export function paidTerminalEndUnix(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): number | null {
  if (!paidSubscriptionFullyEnded(sub, hadPaidInvoice)) return null;
  return endedAtUnix(sub);
}

export function wasStripePaidActiveAt(
  sub: GrowthStripeSubscription,
  atUnix: number,
  hadPaidInvoice = false
): boolean {
  const start = paidStartUnix(sub, hadPaidInvoice);
  if (start == null || start >= atUnix) return false;
  const end = paidTerminalEndUnix(sub, hadPaidInvoice);
  if (end != null && end <= atUnix) return false;
  if (cancelledDuringFreeTrial(sub)) return false;
  return true;
}

export function paidConversionUnix(
  sub: GrowthStripeSubscription,
  hadPaidInvoice = false
): number | null {
  if (sub.trial_end != null) {
    return becamePaidAfterTrial(sub, hadPaidInvoice) ? sub.trial_end : null;
  }
  if (
    sub.status === "active" ||
    sub.status === "past_due" ||
    sub.status === "unpaid" ||
    paidSubscriptionFullyEnded(sub, hadPaidInvoice) ||
    hasPauseCollection(sub)
  ) {
    return sub.start_date ?? sub.created ?? null;
  }
  return null;
}

export function clerkUserIdFromStripeSub(
  sub: GrowthStripeSubscription
): string | null {
  const uid = sub.metadata?.userId?.trim();
  return uid || null;
}

export function stripeChurnRate(args: {
  subs: GrowthStripeSubscription[];
  periodStartUnix: number | null;
  periodEndUnix: number;
  paidInvoiceSubIds: ReadonlySet<string>;
}): MetricNumber {
  if (args.periodStartUnix == null) return null;
  const opening = new Set<string>();
  const ended = new Set<string>();
  for (const sub of args.subs) {
    const paidInvoice = args.paidInvoiceSubIds.has(sub.id);
    const identity = stripeSubscriberIdentity(sub);
    if (wasStripePaidActiveAt(sub, args.periodStartUnix, paidInvoice)) {
      opening.add(identity);
    }
    const end = paidTerminalEndUnix(sub, paidInvoice);
    if (end != null && end >= args.periodStartUnix && end < args.periodEndUnix) {
      ended.add(identity);
    }
  }
  if (opening.size === 0) return null;
  return ended.size / opening.size;
}

export function reactivatedIdentityCount(args: {
  subs: GrowthStripeSubscription[];
  startMs: number | null;
  endMs: number;
  paidInvoiceSubIds: ReadonlySet<string>;
}): number {
  const byIdentity = new Map<string, GrowthStripeSubscription[]>();
  for (const sub of args.subs) {
    const list = byIdentity.get(stripeSubscriberIdentity(sub)) ?? [];
    list.push(sub);
    byIdentity.set(stripeSubscriberIdentity(sub), list);
  }
  let count = 0;
  for (const subs of byIdentity.values()) {
    const terminals: number[] = [];
    const conversions: number[] = [];
    for (const sub of subs) {
      const paidInvoice = args.paidInvoiceSubIds.has(sub.id);
      const end = paidTerminalEndUnix(sub, paidInvoice);
      if (end != null) terminals.push(end);
      const conv = paidConversionUnix(sub, paidInvoice);
      if (conv != null) conversions.push(conv);
    }
    if (terminals.length === 0 || conversions.length === 0) continue;
    const firstTerminal = Math.min(...terminals);
    const laterPaid = conversions.some((c) => c > firstTerminal);
    if (!laterPaid) continue;
    const reactivationAt = Math.min(...conversions.filter((c) => c > firstTerminal));
    if (unixSecondsInPeriod(reactivationAt, args.startMs, args.endMs)) {
      count += 1;
    }
  }
  return count;
}

export type TrafficSourceRow = {
  sourceNormalized: string;
  utmCampaign: string;
  utmContent: string;
  visitors: MetricNumber;
  trialsStarted: MetricNumber;
  activated: MetricNumber;
  paidConversions: MetricNumber;
  advertisingSpendCents: MetricNumber;
  costPerPaidCents: MetricNumber;
};

export type MarketingAttributionRow = {
  clerk_user_id: string;
  visitor_id: string;
  source_normalized: string;
  is_paid_acquisition: boolean;
  source_detail: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
};

export type MarketingEventRow = {
  event_type: string;
  visitor_id: string;
  occurred_at: string;
  source_normalized: string | null;
  is_paid_acquisition: boolean;
  utm_campaign: string | null;
  utm_content: string | null;
  clerk_user_id: string | null;
};

export type AdSpendAggregateRow = {
  source_normalized: string;
  utm_campaign: string;
  amount_cents: number;
};

function grainKey(source: string, campaign: string, content: string): string {
  return `${source}\u0000${campaign}\u0000${content}`;
}

export function aggregateTrafficSourceRows(args: {
  events: MarketingEventRow[];
  attributions: MarketingAttributionRow[];
  trialClerkIds: string[];
  activatedClerkIds: Iterable<string>;
  paidConversionClerkIds: string[];
  adSpend: AdSpendAggregateRow[];
  sourceFilter: GrowthTrafficSource;
}): TrafficSourceRow[] {
  const attrByClerk = new Map(
    args.attributions.map((a) => [a.clerk_user_id, a] as const)
  );
  const matches = (source: string | null | undefined) => {
    if (args.sourceFilter === "all") return true;
    if (args.sourceFilter === "meta_ads") return source === "meta";
    return source === args.sourceFilter;
  };

  const visitors = new Map<string, Set<string>>();
  for (const ev of args.events) {
    if (ev.event_type !== "page_viewed") continue;
    const source = ev.source_normalized ?? "direct";
    if (!matches(source)) continue;
    const campaign = ev.utm_campaign ?? "";
    const content = ev.utm_content ?? "";
    const key = grainKey(source, campaign, content);
    const set = visitors.get(key) ?? new Set();
    set.add(ev.visitor_id);
    visitors.set(key, set);
  }

  const countByGrain = (
    clerkIds: string[],
    into: Map<string, Set<string>>
  ) => {
    for (const clerkId of clerkIds) {
      const attr = attrByClerk.get(clerkId);
      if (!attr) continue;
      if (!matches(attr.source_normalized)) continue;
      const key = grainKey(
        attr.source_normalized,
        attr.utm_campaign ?? "",
        attr.utm_content ?? ""
      );
      const set = into.get(key) ?? new Set();
      set.add(clerkId);
      into.set(key, set);
    }
  };

  const trials = new Map<string, Set<string>>();
  const activated = new Map<string, Set<string>>();
  const paid = new Map<string, Set<string>>();
  countByGrain(args.trialClerkIds, trials);
  countByGrain([...args.activatedClerkIds], activated);
  countByGrain(args.paidConversionClerkIds, paid);

  const spendByGrain = new Map<string, number>();
  for (const row of args.adSpend) {
    if (row.source_normalized !== "meta" && row.source_normalized !== "google") {
      continue;
    }
    if (!matches(row.source_normalized)) continue;
    const key = grainKey(row.source_normalized, row.utm_campaign, "");
    spendByGrain.set(key, (spendByGrain.get(key) ?? 0) + row.amount_cents);
  }

  const keys = new Set([
    ...visitors.keys(),
    ...trials.keys(),
    ...activated.keys(),
    ...paid.keys(),
    ...spendByGrain.keys(),
  ]);

  const rows: TrafficSourceRow[] = [];
  for (const key of keys) {
    const [sourceNormalized, utmCampaign, utmContent] = key.split("\u0000");
    const contentSpecific = utmContent.length > 0;
    const spend = contentSpecific ? null : (spendByGrain.get(key) ?? 0);
    const paidCount = paid.get(key)?.size ?? 0;
    const paidForCps = contentSpecific
      ? null
      : paidCount;
    rows.push({
      sourceNormalized,
      utmCampaign,
      utmContent,
      visitors: visitors.get(key)?.size ?? 0,
      trialsStarted: trials.get(key)?.size ?? 0,
      activated: activated.get(key)?.size ?? 0,
      paidConversions: paidCount,
      advertisingSpendCents: spend,
      costPerPaidCents:
        spend == null || paidForCps == null || paidForCps === 0
          ? null
          : Math.round(spend / paidForCps),
    });
  }

  rows.sort((a, b) => {
    if (a.sourceNormalized !== b.sourceNormalized) {
      return a.sourceNormalized.localeCompare(b.sourceNormalized);
    }
    if (a.utmCampaign !== b.utmCampaign) {
      return a.utmCampaign.localeCompare(b.utmCampaign);
    }
    return a.utmContent.localeCompare(b.utmContent);
  });
  return rows;
}

export function blendedCostPerPaidCents(
  spendCents: MetricNumber,
  newPaidAttributed: MetricNumber
): MetricNumber {
  if (spendCents == null || newPaidAttributed == null) return null;
  if (newPaidAttributed === 0) return null;
  return Math.round(spendCents / newPaidAttributed);
}

export type GrowthDashboardSnapshot = {
  asOfNow: {
    activePaid: MetricNumber;
    activeMonthly: MetricNumber;
    activeAnnual: MetricNumber;
    monthlyShare: MetricNumber;
    annualShare: MetricNumber;
    appleCancelRequestedStillActive: MetricNumber;
    paymentFailed: MetricNumber;
    stripeMrrCents: MetricNumber;
    appleGrantingIncluded: boolean;
  };
  period: {
    trialToPaidRate: MetricNumber;
    paidChurnRate: MetricNumber;
    costPerPaid: MetricNumber;
    accountsCreated: MetricNumber;
    uniqueVisitors: MetricNumber;
    freeTrialButtonClicks: MetricNumber;
    freeTrialsStarted: MetricNumber;
    activatedWithin24h: MetricNumber;
    trialsConvertedToPaid: MetricNumber;
    cancelledDuringTrial: MetricNumber;
    finishedTrialWithoutPaid: MetricNumber;
    paidFullyEnded: MetricNumber;
    reactivated: MetricNumber;
    stripeRevenueCents: MetricNumber;
    advertisingSpend: MetricNumber;
    newPaidAttributedToAds: MetricNumber;
    paymentFailed: MetricNumber;
    funnelConversions: [
      MetricNumber,
      MetricNumber,
      MetricNumber,
      MetricNumber,
      MetricNumber,
    ];
  };
  trafficRows: TrafficSourceRow[];
  notes: {
    appleRevenueUnavailable: true;
    appleMrrUnavailable: true;
    appleCancelRequestedNote: string;
    stripeRevenueOnly: true;
    sourceTrackingUnavailable: boolean;
    instrumentationStartLabel: string | null;
    trackingFromNote: string | null;
    stripeChurnOnly: true;
    stripeReactivatedOnly: true;
    revenueGrossOfRefunds: true;
    paymentFailedScope: string;
    paidEndedScope: string;
  };
};

export type SubscriberGrowthDashboardData = {
  range: GrowthDateRange;
  source: GrowthTrafficSource;
  timezone: typeof SUBSCRIBER_GROWTH_TZ;
  asOfNowLabel: string;
  snapshot: GrowthDashboardSnapshot;
  warnings: string[];
  adSpendEntries: Array<{
    id: string;
    spend_date: string;
    source_normalized: string;
    utm_campaign: string;
    amount_cents: number;
  }>;
};

export function emptyUnknownPeriod(): GrowthDashboardSnapshot["period"] {
  return {
    trialToPaidRate: null,
    paidChurnRate: null,
    costPerPaid: null,
    accountsCreated: null,
    uniqueVisitors: null,
    freeTrialButtonClicks: null,
    freeTrialsStarted: null,
    activatedWithin24h: null,
    trialsConvertedToPaid: null,
    cancelledDuringTrial: null,
    finishedTrialWithoutPaid: null,
    paidFullyEnded: null,
    reactivated: null,
    stripeRevenueCents: null,
    advertisingSpend: null,
    newPaidAttributedToAds: null,
    paymentFailed: null,
    funnelConversions: [null, null, null, null, null],
  };
}

export function emptyUnknownSnapshot(): GrowthDashboardSnapshot {
  return {
    asOfNow: {
      activePaid: null,
      activeMonthly: null,
      activeAnnual: null,
      monthlyShare: null,
      annualShare: null,
      appleCancelRequestedStillActive: null,
      paymentFailed: null,
      stripeMrrCents: null,
      appleGrantingIncluded: true,
    },
    period: emptyUnknownPeriod(),
    trafficRows: [],
    notes: {
      appleRevenueUnavailable: true,
      appleMrrUnavailable: true,
      appleCancelRequestedNote:
        "Apple only: auto-renew off while membership still grants. Stripe cancellations are immediate, so Stripe cannot populate this row.",
      stripeRevenueOnly: true,
      sourceTrackingUnavailable: true,
      instrumentationStartLabel: null,
      trackingFromNote: null,
      stripeChurnOnly: true,
      stripeReactivatedOnly: true,
      revenueGrossOfRefunds: true,
      paymentFailedScope: "Stripe invoices in selected period",
      paidEndedScope: "Stripe",
    },
  };
}

export function computePlanMixPercents(
  monthly: number,
  annual: number
): { monthlyShare: MetricNumber; annualShare: MetricNumber } {
  const total = monthly + annual;
  if (total === 0) {
    return { monthlyShare: null, annualShare: null };
  }
  return {
    monthlyShare: monthly / total,
    annualShare: annual / total,
  };
}

export function computeGrowthSnapshot(input: {
  stripeSubs: GrowthStripeSubscription[];
  appleGranting: GrowthAppleRow[];
  appleCancelRequestedStillActive: GrowthAppleRow[];
  recognizedPriceIds: ReadonlySet<string>;
  nowUnix: number;
  startMs: number | null;
  endMs: number;
  accountsCreated: MetricNumber;
  stripeRevenueCents: MetricNumber;
  stripeListComplete: boolean;
  appleQueryComplete: boolean;
  paidInvoiceSubIds?: ReadonlySet<string>;
  uniqueVisitors?: MetricNumber;
  freeTrialButtonClicks?: MetricNumber;
  activatedWithin24h?: MetricNumber;
  advertisingSpend?: MetricNumber;
  newPaidAttributedToAds?: MetricNumber;
  paymentFailedPeriod?: MetricNumber;
  paidFullyEnded?: MetricNumber;
  trafficRows?: TrafficSourceRow[];
  instrumentationStartMs?: number | null;
  instrumentationStartLabel?: string | null;
  sourceTrackingUnavailable?: boolean;
  paymentFailedScope?: string;
  paidEndedScope?: string;
}): GrowthDashboardSnapshot {
  const trackingFromNote =
    input.instrumentationStartLabel &&
    input.startMs != null &&
    input.instrumentationStartMs != null &&
    input.startMs < input.instrumentationStartMs
      ? `Tracking from ${input.instrumentationStartLabel}`
      : input.instrumentationStartLabel
        ? `Traffic & attribution data available from ${input.instrumentationStartLabel}.`
        : null;

  const notes = {
    appleRevenueUnavailable: true as const,
    appleMrrUnavailable: true as const,
    appleCancelRequestedNote:
      "Apple only: auto-renew off while membership still grants. Stripe cancellations are immediate, so Stripe cannot populate this row.",
    stripeRevenueOnly: true as const,
    sourceTrackingUnavailable: input.sourceTrackingUnavailable !== false,
    instrumentationStartLabel: input.instrumentationStartLabel ?? null,
    trackingFromNote,
    stripeChurnOnly: true as const,
    stripeReactivatedOnly: true as const,
    revenueGrossOfRefunds: true as const,
    paymentFailedScope:
      input.paymentFailedScope ?? "Stripe invoices in selected period",
    paidEndedScope: input.paidEndedScope ?? "Stripe",
  };

  const unknownIfIncomplete = <T>(value: T, complete: boolean): T | null =>
    complete ? value : null;

  const paidInvoiceSubIds = input.paidInvoiceSubIds ?? new Set<string>();

  const summitSubs = input.stripeSubs.filter((sub) =>
    isLikelySummittStripeSubscription(sub, input.recognizedPriceIds)
  );

  const paidStripeByIdentity = new Map<string, GrowthStripeSubscription>();
  for (const sub of summitSubs) {
    if (!isStripePaidActive(sub)) continue;
    paidStripeByIdentity.set(stripeSubscriberIdentity(sub), sub);
  }

  const appleGrantingByIdentity = new Map<string, GrowthAppleRow>();
  for (const row of input.appleGranting) {
    appleGrantingByIdentity.set(appleSubscriberIdentity(row), row);
  }

  const activeIdentities = new Set([
    ...paidStripeByIdentity.keys(),
    ...appleGrantingByIdentity.keys(),
  ]);

  let activeMonthly = 0;
  let activeAnnual = 0;
  let stripeMrrTotal = 0;
  let stripeMrrKnown = true;

  for (const identity of activeIdentities) {
    const stripeSub = paidStripeByIdentity.get(identity);
    if (stripeSub) {
      const interval = stripeInterval(stripeSub);
      if (interval === "year") activeAnnual += 1;
      else if (interval === "month") activeMonthly += 1;
      const mrr = mrrCentsFromStripePriceAmount(stripeSub);
      if (mrr == null) stripeMrrKnown = false;
      else stripeMrrTotal += mrr;
      continue;
    }
    activeMonthly += 1;
  }

  const mix = computePlanMixPercents(activeMonthly, activeAnnual);

  const pastDueIdentities = new Set<string>();
  for (const sub of summitSubs) {
    if (sub.status !== "past_due") continue;
    pastDueIdentities.add(stripeSubscriberIdentity(sub));
  }

  const matureTrials = summitSubs.filter((sub) => {
    if (sub.trial_end == null) return false;
    if (sub.trial_end > input.nowUnix) return false;
    return unixSecondsInPeriod(sub.trial_end, input.startMs, input.endMs);
  });
  const converted = matureTrials.filter((sub) =>
    becamePaidAfterTrial(sub, paidInvoiceSubIds.has(sub.id))
  );

  const trialsStarted = summitSubs.filter((sub) =>
    unixSecondsInPeriod(sub.trial_start, input.startMs, input.endMs)
  );

  const cancelledDuringTrial = summitSubs.filter(
    (sub) =>
      cancelledDuringFreeTrial(sub) &&
      unixSecondsInPeriod(sub.canceled_at, input.startMs, input.endMs)
  );

  const finishedUnpaid = matureTrials.filter((sub) =>
    finishedTrialWithoutPaid(sub, paidInvoiceSubIds.has(sub.id))
  );

  const paidEndedFromStripe = summitSubs.filter((sub) =>
    paidSubscriptionFullyEnded(sub, paidInvoiceSubIds.has(sub.id)) &&
    unixSecondsInPeriod(endedAtUnix(sub), input.startMs, input.endMs)
  );

  const stripeOk = input.stripeListComplete;
  const appleOk = input.appleQueryComplete;
  const snapshotOk = stripeOk && appleOk;
  const periodStartUnix =
    input.startMs == null ? null : Math.floor(input.startMs / 1000);
  const periodEndUnix = Math.floor(input.endMs / 1000);

  const churn = stripeOk
    ? stripeChurnRate({
        subs: summitSubs,
        periodStartUnix,
        periodEndUnix,
        paidInvoiceSubIds,
      })
    : null;

  const reactivated = stripeOk
    ? reactivatedIdentityCount({
        subs: summitSubs,
        startMs: input.startMs,
        endMs: input.endMs,
        paidInvoiceSubIds,
      })
    : null;

  const paidEndedCount =
    input.paidFullyEnded != null
      ? input.paidFullyEnded
      : unknownIfIncomplete(paidEndedFromStripe.length, stripeOk);

  const eventsPartial =
    input.instrumentationStartMs != null &&
    input.startMs != null &&
    input.startMs < input.instrumentationStartMs;

  const trialsStartedCount = unknownIfIncomplete(trialsStarted.length, stripeOk);
  const visitorsToClicks = conversionRate(
    input.freeTrialButtonClicks ?? null,
    input.uniqueVisitors ?? null
  );
  const clicksToAccounts = eventsPartial
    ? null
    : conversionRate(
        input.accountsCreated,
        input.freeTrialButtonClicks ?? null
      );
  const accountsToTrials = conversionRate(
    trialsStartedCount,
    input.accountsCreated
  );
  const trialsToActivated = conversionRate(
    input.activatedWithin24h ?? null,
    trialsStartedCount
  );
  // Activated is the trial_start cohort; paid conversion is the mature trial_end cohort.
  const activatedToPaid = null;

  const period: GrowthDashboardSnapshot["period"] = {
    trialToPaidRate: unknownIfIncomplete(
      conversionRate(converted.length, matureTrials.length),
      stripeOk
    ),
    paidChurnRate: unknownIfIncomplete(churn, stripeOk),
    costPerPaid: blendedCostPerPaidCents(
      input.advertisingSpend ?? null,
      input.newPaidAttributedToAds ?? null
    ),
    accountsCreated: input.accountsCreated,
    uniqueVisitors: input.uniqueVisitors ?? null,
    freeTrialButtonClicks: input.freeTrialButtonClicks ?? null,
    freeTrialsStarted: trialsStartedCount,
    activatedWithin24h: input.activatedWithin24h ?? null,
    trialsConvertedToPaid: unknownIfIncomplete(converted.length, stripeOk),
    cancelledDuringTrial: unknownIfIncomplete(
      cancelledDuringTrial.length,
      stripeOk
    ),
    finishedTrialWithoutPaid: unknownIfIncomplete(
      finishedUnpaid.length,
      stripeOk
    ),
    paidFullyEnded: paidEndedCount,
    reactivated: unknownIfIncomplete(reactivated, stripeOk),
    stripeRevenueCents: input.stripeRevenueCents,
    advertisingSpend: input.advertisingSpend ?? null,
    newPaidAttributedToAds: input.newPaidAttributedToAds ?? null,
    paymentFailed: input.paymentFailedPeriod ?? null,
    funnelConversions: [
      visitorsToClicks,
      clicksToAccounts,
      accountsToTrials,
      trialsToActivated,
      activatedToPaid,
    ],
  };

  return {
    asOfNow: {
      activePaid: unknownIfIncomplete(activeIdentities.size, snapshotOk),
      activeMonthly: unknownIfIncomplete(activeMonthly, snapshotOk),
      activeAnnual: unknownIfIncomplete(activeAnnual, snapshotOk),
      monthlyShare: unknownIfIncomplete(mix.monthlyShare, snapshotOk),
      annualShare: unknownIfIncomplete(mix.annualShare, snapshotOk),
      appleCancelRequestedStillActive: unknownIfIncomplete(
        input.appleCancelRequestedStillActive.length,
        appleOk
      ),
      paymentFailed: unknownIfIncomplete(pastDueIdentities.size, stripeOk),
      stripeMrrCents: unknownIfIncomplete(
        stripeMrrKnown ? stripeMrrTotal : null,
        stripeOk
      ),
      appleGrantingIncluded: true,
    },
    period,
    trafficRows: input.trafficRows ?? [],
    notes,
  };
}
