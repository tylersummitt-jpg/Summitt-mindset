import {
  HOMEPAGE_LANDING_DESTINATION,
  LANDING_MEASUREMENT_DESTINATIONS,
} from "@/lib/audience-landing-pages";
import {
  isLikelySummittStripeSubscription,
  type GrowthStripeSubscription,
} from "@/lib/admin-subscriber-growth-pure";

/** New landing pages have no history before this instrumentation. Homepage views are older. */
export const LANDING_PAGE_MEASUREMENT_CUTOVER_MS = Date.UTC(2026, 9, 10);

/** A paid invoice after this window is a renewal, not the first conversion. */
export const LANDING_FIRST_PAYMENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const LANDING_PAGE_NOT_AN_EXPERIMENT =
  "These rows show what happened on each page. They are not a controlled experiment, and a higher rate is not a winner.";

export const LANDING_PAGE_ATTRIBUTION_MODEL =
  "Trial credit is the first landing page on or after October 10, 2026, seen before the trial started. That page stays fixed. It does not replace the first-touch source.";

export type LandingObservationKind = "page_view" | "cta_click" | "checkout" | "account";

export type LandingObservation = {
  kind: LandingObservationKind;
  visitorId: string;
  path: string | null;
  occurredAtMs: number;
};

export type LandingIdentityLink = {
  clerkUserId: string;
  visitorId: string;
  acquisitionSource: string | null;
};

export type LandingTrialSeed = {
  clerkUserId: string | null;
  trialStartMs: number;
  trialEndMs: number | null;
  status: string;
};

export type LandingPaymentSeed = {
  clerkUserId: string;
  paidAtMs: number;
};

export type LandingBillingInput = {
  subscriptionsReadable: boolean;
  paymentsReadable: boolean;
  trials: LandingTrialSeed[];
  payments: LandingPaymentSeed[];
};

export type LandingCount = number | "Not available";

export type LandingPageRow = {
  id: string;
  label: string;
  path: string;
  visitors: number;
  ctaClicks: number;
  ctaRate: string;
  trials: LandingCount;
  visitorToTrial: string;
  paid: LandingCount;
  trialToPaid: string;
  checkoutStarts: number | null;
  accounts: number | null;
  gap: string;
};

export type LandingPagePerformance = {
  available: boolean;
  incomplete: boolean;
  billingConnected: boolean;
  journeyUnreadable: boolean;
  billingUnreadable: boolean;
  paymentsUnreadable: boolean;
  rows: LandingPageRow[];
  note: string;
};

function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "Not available";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function destinationForPath(path: string | null) {
  if (!path) return null;
  return LANDING_MEASUREMENT_DESTINATIONS.find((item) => item.path === path) ?? null;
}

function countsHomepage(path: string) {
  return path === HOMEPAGE_LANDING_DESTINATION.path;
}

function inPeriod(ms: number, startMs: number | null, endMs: number): boolean {
  if (startMs != null && ms < startMs) return false;
  return ms < endMs;
}

type PageHit = { path: string; at: number };

function firstLandingPage(
  views: readonly LandingObservation[],
  visitorId: string,
  beforeMs: number
): PageHit | null {
  let best: PageHit | null = null;
  for (const view of views) {
    if (view.kind !== "page_view" || view.visitorId !== visitorId) continue;
    if (view.occurredAtMs > beforeMs) continue;
    if (view.occurredAtMs < LANDING_PAGE_MEASUREMENT_CUTOVER_MS) continue;
    if (!destinationForPath(view.path) || !view.path) continue;
    if (!best || view.occurredAtMs < best.at) {
      best = { path: view.path, at: view.occurredAtMs };
    }
  }
  return best;
}

type Identity = { visitorId: string; source: string | null } | "conflict";

function identitiesByClerk(
  links: readonly LandingIdentityLink[]
): Map<string, Identity> {
  const map = new Map<string, Identity>();
  for (const link of links) {
    const clerkUserId = link.clerkUserId.trim();
    const visitorId = link.visitorId.trim();
    if (!clerkUserId || !visitorId) continue;
    const prev = map.get(clerkUserId);
    if (!prev) {
      map.set(clerkUserId, {
        visitorId,
        source: link.acquisitionSource,
      });
      continue;
    }
    if (prev === "conflict" || prev.visitorId !== visitorId) {
      map.set(clerkUserId, "conflict");
      continue;
    }
    if (prev.source == null && link.acquisitionSource) {
      prev.source = link.acquisitionSource;
    }
  }
  return map;
}

type PersonTrial = LandingTrialSeed & { key: string };

function personTrials(trials: readonly LandingTrialSeed[]): PersonTrial[] {
  const byClerk = new Map<string, PersonTrial>();
  const untied: PersonTrial[] = [];
  for (const trial of trials) {
    if (!Number.isFinite(trial.trialStartMs)) continue;
    const clerkUserId = trial.clerkUserId?.trim() || null;
    if (!clerkUserId) {
      untied.push({ ...trial, clerkUserId: null, key: `untied:${untied.length}` });
      continue;
    }
    const prev = byClerk.get(clerkUserId);
    if (!prev || trial.trialStartMs < prev.trialStartMs) {
      byClerk.set(clerkUserId, { ...trial, clerkUserId, key: clerkUserId });
    }
  }
  return [...byClerk.values(), ...untied];
}

function paymentConfirmsTrial(trial: LandingTrialSeed, paidAtMs: number): boolean {
  if (!Number.isFinite(paidAtMs) || paidAtMs < trial.trialStartMs) return false;
  const anchor = trial.trialEndMs ?? trial.trialStartMs;
  return paidAtMs <= anchor + LANDING_FIRST_PAYMENT_WINDOW_MS;
}

type PaidOutcome = "confirmed" | "running" | "ended_unpaid" | "unknown";

function paidOutcome(
  trial: LandingTrialSeed,
  payments: readonly LandingPaymentSeed[],
  nowMs: number
): PaidOutcome {
  if (payments.some((payment) => paymentConfirmsTrial(trial, payment.paidAtMs))) {
    return "confirmed";
  }
  const ended = trial.trialEndMs != null && trial.trialEndMs <= nowMs;
  if (trial.status === "trialing" && trial.trialEndMs != null && trial.trialEndMs > nowMs) {
    return "running";
  }
  if (!ended) return "unknown";
  if (
    trial.status === "past_due" ||
    trial.status === "canceled" ||
    trial.status === "unpaid" ||
    trial.status === "incomplete_expired"
  ) {
    return "ended_unpaid";
  }
  return "unknown";
}

function sourcePhrase(counts: Map<string, number>): string {
  if (counts.size === 0) return "";
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, count]) => `${source} ${count}`);
  return `First-touch sources on attributed trials: ${parts.join(", ")}.`;
}

export function summarizeLandingPagePerformance(args: {
  observations: LandingObservation[];
  pagesReadable: boolean;
  outcomesReadable: boolean;
  attributionViews?: readonly LandingObservation[];
  identities?: readonly LandingIdentityLink[];
  billing?: LandingBillingInput | null;
  journeyReadable?: boolean;
  periodStartMs?: number | null;
  periodEndMs?: number;
  nowMs?: number;
}): LandingPagePerformance {
  if (!args.pagesReadable) {
    return {
      available: false,
      incomplete: false,
      billingConnected: false,
      journeyUnreadable: false,
      billingUnreadable: false,
      paymentsUnreadable: false,
      rows: [],
      note: "Landing-page analytics could not be read. Do not treat that as zero visitors.",
    };
  }

  const visitors = new Map<string, Set<string>>();
  const measuredVisitors = new Map<string, Set<string>>();
  const clicks = new Map<string, Set<string>>();
  for (const destination of LANDING_MEASUREMENT_DESTINATIONS) {
    visitors.set(destination.path, new Set());
    measuredVisitors.set(destination.path, new Set());
    clicks.set(destination.path, new Set());
  }

  for (const observation of args.observations) {
    if (observation.kind !== "page_view" && observation.kind !== "cta_click") continue;
    const destination = destinationForPath(observation.path);
    if (!destination) continue;
    if (
      !countsHomepage(destination.path) &&
      observation.occurredAtMs < LANDING_PAGE_MEASUREMENT_CUTOVER_MS
    ) {
      continue;
    }
    if (observation.kind === "page_view") {
      visitors.get(destination.path)?.add(observation.visitorId);
      if (observation.occurredAtMs >= LANDING_PAGE_MEASUREMENT_CUTOVER_MS) {
        measuredVisitors.get(destination.path)?.add(observation.visitorId);
      }
      continue;
    }
    clicks.get(destination.path)?.add(observation.visitorId);
  }

  const checkoutByPath = new Map<string, Set<string>>();
  const accountsByPath = new Map<string, Set<string>>();
  for (const destination of LANDING_MEASUREMENT_DESTINATIONS) {
    checkoutByPath.set(destination.path, new Set());
    accountsByPath.set(destination.path, new Set());
  }
  const history = args.attributionViews ?? args.observations;
  if (args.outcomesReadable) {
    for (const observation of args.observations) {
      if (observation.kind !== "checkout" && observation.kind !== "account") continue;
      const first = firstLandingPage(history, observation.visitorId, observation.occurredAtMs);
      if (!first) continue;
      const bucket = observation.kind === "checkout" ? checkoutByPath : accountsByPath;
      bucket.get(first.path)?.add(observation.visitorId);
    }
  }

  const billing = args.billing ?? null;
  const billingConnected = billing?.subscriptionsReadable === true;
  const journeyReadable = args.journeyReadable !== false;
  const paymentsReadable = billingConnected && billing?.paymentsReadable === true;
  const assignTrials = billingConnected && journeyReadable;
  const periodEndMs = args.periodEndMs;
  const periodStartMs = args.periodStartMs ?? null;
  const nowMs = args.nowMs ?? periodEndMs ?? LANDING_PAGE_MEASUREMENT_CUTOVER_MS;
  const links = identitiesByClerk(args.identities ?? []);
  const paymentsByClerk = new Map<string, LandingPaymentSeed[]>();
  if (paymentsReadable) {
    for (const payment of billing?.payments ?? []) {
      const list = paymentsByClerk.get(payment.clerkUserId) ?? [];
      list.push(payment);
      paymentsByClerk.set(payment.clerkUserId, list);
    }
  }

  const trialsByPath = new Map<string, Set<string>>();
  const comparableByPath = new Map<string, Set<string>>();
  const paidByPath = new Map<string, Set<string>>();
  const confirmedByPath = new Map<string, Set<string>>();
  const matureByPath = new Map<string, Set<string>>();
  const runningByPath = new Map<string, number>();
  const endedByPath = new Map<string, number>();
  const unknownPaidByPath = new Map<string, number>();
  const earlierByPath = new Map<string, number>();
  const sourcesByPath = new Map<string, Map<string, number>>();
  let unattributedTrials = 0;
  for (const destination of LANDING_MEASUREMENT_DESTINATIONS) {
    trialsByPath.set(destination.path, new Set());
    comparableByPath.set(destination.path, new Set());
    paidByPath.set(destination.path, new Set());
    confirmedByPath.set(destination.path, new Set());
    matureByPath.set(destination.path, new Set());
    runningByPath.set(destination.path, 0);
    endedByPath.set(destination.path, 0);
    unknownPaidByPath.set(destination.path, 0);
    earlierByPath.set(destination.path, 0);
    sourcesByPath.set(destination.path, new Map());
  }

  if (assignTrials && billing) {
    for (const trial of personTrials(billing.trials)) {
      const trialInPeriod =
        periodEndMs == null || inPeriod(trial.trialStartMs, periodStartMs, periodEndMs);
      const identity = trial.clerkUserId ? links.get(trial.clerkUserId) : undefined;
      const visitorId =
        identity && identity !== "conflict" ? identity.visitorId : null;
      const first = visitorId
        ? firstLandingPage(history, visitorId, trial.trialStartMs)
        : null;
      if (!first || !trial.clerkUserId || identity === "conflict" || !visitorId) {
        if (trialInPeriod) unattributedTrials += 1;
        continue;
      }
      if (trialInPeriod) {
        trialsByPath.get(first.path)?.add(trial.key);
        const comparable =
          periodEndMs == null || inPeriod(first.at, periodStartMs, periodEndMs);
        if (comparable) comparableByPath.get(first.path)?.add(trial.key);
        else earlierByPath.set(first.path, (earlierByPath.get(first.path) ?? 0) + 1);
        const source = identity?.source ?? "unknown";
        const sources = sourcesByPath.get(first.path);
        if (sources) sources.set(source, (sources.get(source) ?? 0) + 1);
        if (paymentsReadable) {
          const outcome = paidOutcome(
            trial,
            paymentsByClerk.get(trial.clerkUserId) ?? [],
            nowMs
          );
          if (outcome === "confirmed") {
            confirmedByPath.get(first.path)?.add(trial.key);
            matureByPath.get(first.path)?.add(trial.key);
          } else if (outcome === "ended_unpaid") {
            matureByPath.get(first.path)?.add(trial.key);
            endedByPath.set(first.path, (endedByPath.get(first.path) ?? 0) + 1);
          } else if (outcome === "running") {
            runningByPath.set(first.path, (runningByPath.get(first.path) ?? 0) + 1);
          } else {
            unknownPaidByPath.set(first.path, (unknownPaidByPath.get(first.path) ?? 0) + 1);
          }
        }
      }
      if (paymentsReadable && trial.clerkUserId) {
        const confirming = (paymentsByClerk.get(trial.clerkUserId) ?? []).filter(
          (payment) =>
            paymentConfirmsTrial(trial, payment.paidAtMs) &&
            (periodEndMs == null || inPeriod(payment.paidAtMs, periodStartMs, periodEndMs))
        );
        if (confirming.length > 0) paidByPath.get(first.path)?.add(trial.key);
      }
    }
  }

  const rows: LandingPageRow[] = LANDING_MEASUREMENT_DESTINATIONS.map((destination) => {
    const pageVisitors = visitors.get(destination.path) ?? new Set();
    const pageMeasured = measuredVisitors.get(destination.path) ?? new Set();
    const pageClicks = new Set(
      [...(clicks.get(destination.path) ?? new Set())].filter((visitorId) =>
        pageVisitors.has(visitorId)
      )
    );
    const unmatchedClicks = (clicks.get(destination.path)?.size ?? 0) - pageClicks.size;
    const checkoutStarts = args.outcomesReadable
      ? (checkoutByPath.get(destination.path)?.size ?? 0)
      : null;
    const accounts = args.outcomesReadable
      ? (accountsByPath.get(destination.path)?.size ?? 0)
      : null;
    const attributed = trialsByPath.get(destination.path)?.size ?? 0;
    const comparable = comparableByPath.get(destination.path)?.size ?? 0;
    const paid = paidByPath.get(destination.path)?.size ?? 0;
    const confirmed = confirmedByPath.get(destination.path)?.size ?? 0;
    const mature = matureByPath.get(destination.path)?.size ?? 0;
    const showTrials = assignTrials;
    const showPaid = assignTrials && paymentsReadable;
    const gapParts = [
      LANDING_PAGE_ATTRIBUTION_MODEL,
      "A checkout start is not a trial. A Stripe customer is not a paying member.",
      "Apple memberships are not included. Apple rows do not store a trial start or a payment time.",
      "past_due is not paid. A trial that is still running is pending, not paid.",
    ];
    if (!showTrials) {
      gapParts.push(
        !journeyReadable
          ? "Attributed trials: Not available. The visitor-to-account history could not be read completely."
          : billing != null && !billing.subscriptionsReadable
            ? "Attributed trials: Not available. Billing records could not be read. Do not treat that as zero trials."
            : "Attributed trials are not connected for this view."
      );
    } else {
      gapParts.push(
        `Trials still running: ${runningByPath.get(destination.path) ?? 0}.`,
        `Trials that ended without a confirmed payment: ${endedByPath.get(destination.path) ?? 0}.`,
        `Paid outcome unknown: ${unknownPaidByPath.get(destination.path) ?? 0}.`,
        `Visitor-to-trial uses ${pageMeasured.size} visitors who saw this page on or after October 10, 2026, inside this range.`
      );
      const earlier = earlierByPath.get(destination.path) ?? 0;
      if (earlier > 0) {
        gapParts.push(
          `${earlier} attributed trials started in this range from an earlier page view and are not in the visitor-to-trial rate.`
        );
      }
      const sources = sourcePhrase(sourcesByPath.get(destination.path) ?? new Map());
      if (sources) gapParts.push(sources);
    }
    if (!showPaid && showTrials) {
      gapParts.push("Confirmed paid conversions: Not available. Invoices could not be read.");
    }
    if (showPaid && mature === 0) {
      gapParts.push(
        "Trial-to-paid is not available. This range has no mature trials on this page."
      );
    }
    if (unmatchedClicks > 0) {
      gapParts.push(
        `${unmatchedClicks} trial-button clicks had no matching page view and are not in the click rate.`
      );
    }
    if (checkoutStarts != null) {
      gapParts.push(`Checkout starts tied to this page: ${checkoutStarts}.`);
    }
    if (accounts != null) {
      gapParts.push(`Accounts created after this page, when it was the first measured page: ${accounts}.`);
    }
    if (!countsHomepage(destination.path)) {
      gapParts.push("This page has no measurements before October 10, 2026.");
    }
    return {
      id: destination.id,
      label: destination.path === "/" ? "Homepage" : destination.label,
      path: destination.path,
      visitors: pageVisitors.size,
      ctaClicks: pageClicks.size,
      ctaRate: rate(pageClicks.size, pageVisitors.size),
      trials: showTrials ? attributed : "Not available",
      visitorToTrial: showTrials ? rate(comparable, pageMeasured.size) : "Not available",
      paid: showPaid ? paid : "Not available",
      trialToPaid: showPaid ? rate(confirmed, mature) : "Not available",
      checkoutStarts,
      accounts,
      gap: gapParts.join(" "),
    };
  });

  const noteParts = [
    LANDING_PAGE_NOT_AN_EXPERIMENT,
    "The homepage includes its existing page views for the selected range. Trial credit for every page starts October 10, 2026.",
  ];
  if (assignTrials) {
    noteParts.push(
      `Trials in this range with no reliable landing page: ${unattributedTrials}.`
    );
  }

  return {
    available: true,
    incomplete: false,
    billingConnected,
    journeyUnreadable: !journeyReadable,
    billingUnreadable: billing != null && !billing.subscriptionsReadable,
    paymentsUnreadable: billingConnected && !paymentsReadable,
    rows,
    note: noteParts.join(" "),
  };
}

export const EMPTY_LANDING_PERFORMANCE: LandingPagePerformance = summarizeLandingPagePerformance({
  observations: [],
  pagesReadable: true,
  outcomesReadable: true,
});

export function formatLandingPageReport(performance: LandingPagePerformance): string[] {
  if (!performance.available) {
    return [
      "LANDING PAGE PERFORMANCE",
      performance.note,
      "Do not compare the pages as an experiment.",
    ];
  }
  const lines = ["LANDING PAGE PERFORMANCE", performance.note];
  if (performance.incomplete) {
    lines.push("The landing-page event list stopped early. Counts may be low.");
  }
  if (performance.journeyUnreadable) {
    lines.push("Landing-page identity history could not be read completely. Trials were not assigned.");
  }
  if (performance.billingUnreadable) {
    lines.push("Landing-page billing could not be read. Do not treat that as zero trials.");
  }
  if (performance.paymentsUnreadable) {
    lines.push("Landing-page invoices could not be read. Paid conversions were not assigned.");
  }
  if (performance.rows.length === 0) {
    lines.push("No landing-page rows were loaded for this view.");
    return lines;
  }
  for (const row of performance.rows) {
    lines.push(
      `- ${row.label} (${row.path})`,
      `  Unique visitors: ${row.visitors}`,
      `  Trial-button clicks: ${row.ctaClicks}`,
      `  Click rate: ${row.ctaRate}`,
      `  Attributed trials: ${row.trials}`,
      `  Visitor-to-trial: ${row.visitorToTrial}`,
      `  Confirmed paid conversions: ${row.paid}`,
      `  Trial-to-paid, mature trials: ${row.trialToPaid}`,
      `  Gap: ${row.gap}`
    );
  }
  return lines;
}

export function toLandingBilling(args: {
  subscriptionsReadable: boolean;
  paymentsReadable: boolean;
  subs: readonly GrowthStripeSubscription[];
  recognizedPriceIds: ReadonlySet<string>;
  paidInvoices: readonly { subscriptionId: string; paidAtUnix: number }[];
}): LandingBillingInput {
  if (!args.subscriptionsReadable) {
    return {
      subscriptionsReadable: false,
      paymentsReadable: false,
      trials: [],
      payments: [],
    };
  }
  const clerkBySub = new Map<string, string>();
  const trials: LandingTrialSeed[] = [];
  for (const sub of args.subs) {
    if (!isLikelySummittStripeSubscription(sub, args.recognizedPriceIds)) continue;
    const clerkUserId = sub.metadata?.userId?.trim() || null;
    if (clerkUserId) clerkBySub.set(sub.id, clerkUserId);
    if (sub.trial_start == null || !Number.isFinite(sub.trial_start)) continue;
    trials.push({
      clerkUserId,
      trialStartMs: sub.trial_start * 1000,
      trialEndMs:
        sub.trial_end != null && Number.isFinite(sub.trial_end) ? sub.trial_end * 1000 : null,
      status: sub.status,
    });
  }
  const payments: LandingPaymentSeed[] = [];
  if (args.paymentsReadable) {
    for (const invoice of args.paidInvoices) {
      const clerkUserId = clerkBySub.get(invoice.subscriptionId);
      if (!clerkUserId || !Number.isFinite(invoice.paidAtUnix)) continue;
      payments.push({ clerkUserId, paidAtMs: invoice.paidAtUnix * 1000 });
    }
  }
  return {
    subscriptionsReadable: true,
    paymentsReadable: args.paymentsReadable,
    trials,
    payments,
  };
}
