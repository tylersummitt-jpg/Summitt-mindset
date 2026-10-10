import "server-only";

import Stripe from "stripe";

import type { AcquisitionCookiePayload } from "@/lib/marketing-attribution-pure";
import type { LandingBillingInput } from "@/lib/landing-page-performance";
import {
  experimentInvoiceWindow,
  exposureMatchesDestination,
  landingColumnPayload,
  parseLandingAssignments,
  parseStoredLanding,
  PROUD_TEST_DEFINITION,
  PROUD_TEST_EXPERIMENT_ID,
  PROUD_TEST_INSTRUMENTATION_VERSION,
  PROUD_TEST_VARIANTS,
  summarizeProudTest,
  type LandingAssignmentCookie,
  type LandingDestinations,
  type ProudTestExposure,
  type ProudTestIdentity,
  type ProudTestPayment,
  type ProudTestReport,
  type ProudTestSignal,
  type ProudTestStatus,
  type ProudTestVariant,
} from "@/lib/landing-experiment";
import { plannedWritePayload } from "@/lib/operating-experiments";
import { supabaseServer } from "@/lib/supabase-server";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const STATUS_CACHE_MS = 15_000;

type LandingExperimentRow = {
  id: string;
  name: string;
  status: ProudTestStatus;
  evidence: string | null;
  conclusion: string | null;
  nextAction: string | null;
  startOn: string | null;
  destinations: LandingDestinations;
};

let landingCache: { at: number; value: LandingExperimentRow[] | "unavailable" } | null = null;

function knownStatus(status: string | null | undefined): ProudTestStatus {
  const known: ProudTestStatus[] = ["running", "paused", "planned", "completed"];
  return known.includes(status as ProudTestStatus) ? (status as ProudTestStatus) : "missing";
}

async function readLandingExperiments(): Promise<LandingExperimentRow[] | "unavailable"> {
  const now = Date.now();
  if (landingCache && now - landingCache.at < STATUS_CACHE_MS) return landingCache.value;
  const result = await supabaseServer
    .from("operating_experiments")
    .select(
      "id, name, entry_slug, control_path, challenger_path, status, evidence, conclusion, next_action, start_on"
    )
    .not("entry_slug", "is", null)
    .limit(20);
  if (result.error) {
    console.warn("[landing-experiment] registry read failed", { reason: result.error.message });
    return "unavailable";
  }
  const rows: LandingExperimentRow[] = [];
  for (const raw of result.data ?? []) {
    try {
      const destinations = parseStoredLanding(raw);
      if (!destinations || typeof raw.id !== "string") continue;
      rows.push({
        id: raw.id,
        name: typeof raw.name === "string" ? raw.name : "Controlled landing test",
        status: knownStatus(typeof raw.status === "string" ? raw.status : null),
        evidence: typeof raw.evidence === "string" ? raw.evidence : null,
        conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
        nextAction: typeof raw.next_action === "string" ? raw.next_action : null,
        startOn: typeof raw.start_on === "string" ? raw.start_on : null,
        destinations,
      });
    } catch (err) {
      console.warn("[landing-experiment] skipped an unreadable destination pair", {
        reason: err instanceof Error ? err.message : "unreadable_destinations",
      });
    }
  }
  landingCache = { at: now, value: rows };
  return rows;
}

export async function readLandingExperimentBySlug(
  slug: string
): Promise<LandingExperimentRow | "missing" | "unavailable"> {
  const rows = await readLandingExperiments();
  if (rows === "unavailable") return "unavailable";
  return rows.find((row) => row.destinations.entrySlug === slug) ?? "missing";
}

export function clearProudTestStatusCache(): void {
  landingCache = null;
}

/**
 * Creates the planned registry row once. A repeated call does not insert again
 * and does not change a row that has already been started, paused, or completed.
 */
export async function ensureProudTestExperiment(): Promise<void> {
  try {
    const existing = await supabaseServer
      .from("operating_experiments")
      .select("id")
      .eq("id", PROUD_TEST_EXPERIMENT_ID)
      .maybeSingle();
    if (existing.error) {
      console.warn("[proud-test] registry lookup failed", { reason: existing.error.message });
      return;
    }
    if (existing.data) return;
    const { error } = await supabaseServer.from("operating_experiments").insert({
      id: PROUD_TEST_EXPERIMENT_ID,
      ...plannedWritePayload(PROUD_TEST_DEFINITION),
      ...landingColumnPayload({
        entrySlug: "proud-test",
        controlPath: PROUD_TEST_VARIANTS.control,
        challengerPath: PROUD_TEST_VARIANTS.challenger,
      }),
      next_action: PROUD_TEST_DEFINITION.nextAction,
      limitations: PROUD_TEST_DEFINITION.limitations,
      updated_by: "build-10",
    });
    if (error && (error as { code?: string }).code !== "23505") {
      console.warn("[proud-test] planned insert failed", { reason: error.message });
    }
    clearProudTestStatusCache();
  } catch (err) {
    console.warn("[proud-test] ensure failed", {
      reason: err instanceof Error ? err.message : "ensure_failed",
    });
  }
}

async function insertExposure(args: {
  visitorId: string;
  path: string;
  experimentId: string;
  variant: ProudTestVariant;
  attribution: AcquisitionCookiePayload;
}): Promise<void> {
  const existing = await supabaseServer
    .from("marketing_events")
    .select("id")
    .eq("event_type", "page_viewed")
    .eq("visitor_id", args.visitorId)
    .filter("metadata->>experiment_id", "eq", args.experimentId)
    .filter("metadata->>experiment_variant", "eq", args.variant)
    .limit(1);
  if (existing.error) {
    console.warn("[landing-experiment] exposure lookup failed", { reason: existing.error.message });
    return;
  }
  if ((existing.data ?? []).length > 0) return;
  const { error } = await supabaseServer.from("marketing_events").insert({
    event_type: "page_viewed",
    visitor_id: args.visitorId,
    path: args.path,
    utm_source: args.attribution.utm_source,
    utm_medium: args.attribution.utm_medium,
    utm_campaign: args.attribution.utm_campaign,
    utm_content: args.attribution.utm_content,
    source_normalized: args.attribution.source_normalized,
    is_paid_acquisition: args.attribution.is_paid_acquisition,
    referrer_host: args.attribution.referrer_host,
    metadata: {
      experiment_id: args.experimentId,
      experiment_variant: args.variant,
      instrumentation_version: PROUD_TEST_INSTRUMENTATION_VERSION,
    },
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[landing-experiment] exposure insert failed", { reason: error.message });
  }
}

/**
 * Records an exposure only when the viewed path is the registry destination
 * for that visitor's assigned variant. A redirect is not an exposure.
 */
export async function recordLandingExposures(args: {
  visitorId: string;
  path: string;
  assignmentCookie: string | null | undefined;
  attribution: AcquisitionCookiePayload;
}): Promise<void> {
  const matches = parseLandingAssignments(args.assignmentCookie).filter(
    (assignment) => assignment.path === args.path
  );
  if (matches.length === 0) return;
  const rows = await readLandingExperiments();
  if (rows === "unavailable") return;
  for (const assignment of matches) {
    const experiment = rows.find((row) => row.id === assignment.experimentId);
    if (!experiment) continue;
    const official =
      assignment.variant === "control"
        ? experiment.destinations.controlPath
        : experiment.destinations.challengerPath;
    if (!exposureMatchesDestination({ viewedPath: args.path, officialPath: official })) continue;
    await insertExposure({
      visitorId: args.visitorId,
      path: args.path,
      experimentId: experiment.id,
      variant: assignment.variant,
      attribution: args.attribution,
    });
  }
}

export async function recordProudTestExposure(args: {
  visitorId: string;
  path: string;
  variant: ProudTestVariant;
  attribution: AcquisitionCookiePayload;
}): Promise<void> {
  const assignment: LandingAssignmentCookie = {
    experimentId: PROUD_TEST_EXPERIMENT_ID,
    variant: args.variant,
    path: PROUD_TEST_VARIANTS[args.variant],
  };
  if (assignment.path !== args.path) return;
  await recordLandingExposures({
    visitorId: args.visitorId,
    path: args.path,
    assignmentCookie: `${assignment.experimentId}.${assignment.variant}.${assignment.path}`,
    attribution: args.attribution,
  });
}

async function readExposures(
  experimentId: string
): Promise<{ rows: ProudTestExposure[]; complete: boolean }> {
  const rows: ProudTestExposure[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_events")
      .select("visitor_id, occurred_at, metadata")
      .eq("event_type", "page_viewed")
      .filter("metadata->>experiment_id", "eq", experimentId)
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.warn("[proud-test] exposure read failed", { reason: error.message });
      return { rows: [], complete: false };
    }
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.visitor_id !== "string" || typeof raw.occurred_at !== "string") continue;
      const metadata = raw.metadata as { experiment_variant?: string } | null;
      const variant = metadata?.experiment_variant;
      if (variant !== "control" && variant !== "challenger") continue;
      const occurredAtMs = Date.parse(raw.occurred_at);
      if (!Number.isFinite(occurredAtMs)) continue;
      rows.push({ visitorId: raw.visitor_id, variant, occurredAtMs });
    }
    if (batch.length < PAGE_SIZE) return { rows, complete: true };
    from += PAGE_SIZE;
  }
  return { rows, complete: false };
}

async function readIdentities(): Promise<{ links: ProudTestIdentity[]; complete: boolean }> {
  const links: ProudTestIdentity[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_attribution")
      .select("clerk_user_id, visitor_id")
      .order("clerk_user_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { links: [], complete: false };
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.clerk_user_id !== "string" || typeof raw.visitor_id !== "string") continue;
      links.push({ clerkUserId: raw.clerk_user_id, visitorId: raw.visitor_id });
    }
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (page === MAX_PAGES - 1) return { links: [], complete: false };
  }
  from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_events")
      .select("visitor_id, clerk_user_id")
      .in("event_type", ["account_created", "checkout_opened"])
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { links: [], complete: false };
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.clerk_user_id !== "string" || typeof raw.visitor_id !== "string") continue;
      links.push({ clerkUserId: raw.clerk_user_id, visitorId: raw.visitor_id });
    }
    if (batch.length < PAGE_SIZE) return { links, complete: true };
    from += PAGE_SIZE;
  }
  return { links: [], complete: false };
}

async function readSignals(): Promise<{ rows: ProudTestSignal[]; complete: boolean }> {
  const rows: ProudTestSignal[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_events")
      .select("event_type, visitor_id, occurred_at")
      .in("event_type", ["trial_cta_clicked", "checkout_opened", "checkout_creation_failed"])
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: [], complete: false };
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.visitor_id !== "string" || typeof raw.occurred_at !== "string") continue;
      const occurredAtMs = Date.parse(raw.occurred_at);
      if (!Number.isFinite(occurredAtMs)) continue;
      const kind =
        raw.event_type === "trial_cta_clicked"
          ? "click"
          : raw.event_type === "checkout_opened"
            ? "checkout"
            : raw.event_type === "checkout_creation_failed"
              ? "checkout_failed"
              : null;
      if (!kind) continue;
      rows.push({ visitorId: raw.visitor_id, kind, occurredAtMs });
    }
    if (batch.length < PAGE_SIZE) return { rows, complete: true };
    from += PAGE_SIZE;
  }
  return { rows, complete: false };
}

const UNREADABLE_REPORT: ProudTestReport = {
  ...{
    loaded: true,
    exposuresUnreadable: true,
    name: "Controlled landing test",
    entrySlug: null,
    status: "unavailable",
    evidence: null,
    conclusion: null,
    nextAction: null,
    startOn: null,
    rows: [],
    difference: "Not available",
    unknownTrials: "Not available",
    coverage: "Exposures could not be read. Do not treat that as zero visitors.",
    note: "The controlled landing test could not be read. Do not treat that as zero visitors.",
  },
};

function clerkFromPaidInvoice(invoice: Stripe.Invoice): ProudTestPayment | "unexpanded" | null {
  if (invoice.status !== "paid" || !invoice.amount_paid || invoice.amount_paid <= 0) return null;
  const subscription = (invoice as { subscription?: string | { metadata?: { userId?: string } } | null })
    .subscription;
  if (typeof subscription === "string") return "unexpanded";
  const clerkUserId = subscription?.metadata?.userId?.trim() || "";
  if (!clerkUserId) return null;
  const paidAt = (invoice as { status_transitions?: { paid_at?: number | null } }).status_transitions
    ?.paid_at;
  const paidAtUnix = typeof paidAt === "number" ? paidAt : invoice.created;
  if (typeof paidAtUnix !== "number" || !Number.isFinite(paidAtUnix)) return null;
  return { clerkUserId, paidAtMs: paidAtUnix * 1000 };
}

/**
 * Paid invoices for the exposure cohort, from just before the first exposure through now.
 * The dashboard date range is not an input.
 */
async function loadCohortPayments(args: {
  earliestExposureMs: number | null;
  nowMs: number;
}): Promise<{ payments: ProudTestPayment[]; complete: boolean }> {
  if (args.earliestExposureMs == null) return { payments: [], complete: true };
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { payments: [], complete: false };
  const window = experimentInvoiceWindow({
    earliestExposureMs: args.earliestExposureMs,
    nowMs: args.nowMs,
  });
  const stripe = new Stripe(key);
  const payments: ProudTestPayment[] = [];
  let startingAfter: string | undefined;
  let sawUnexpanded = false;
  for (let page = 0; page < 20; page += 1) {
    const res = await stripe.invoices.list({
      status: "paid",
      limit: 100,
      starting_after: startingAfter,
      created: {
        gte: Math.floor(window.startMs / 1000),
        lt: Math.floor(window.endMs / 1000) + 1,
      },
      expand: ["data.subscription"],
    });
    for (const invoice of res.data) {
      const parsed = clerkFromPaidInvoice(invoice);
      if (parsed === "unexpanded") {
        sawUnexpanded = true;
        continue;
      }
      if (parsed) payments.push(parsed);
    }
    if (!res.has_more) return { payments, complete: !sawUnexpanded };
    startingAfter = res.data[res.data.length - 1]?.id;
    if (!startingAfter) return { payments, complete: false };
  }
  return { payments, complete: false };
}

export async function loadLandingExperimentReports(args: {
  billing: LandingBillingInput;
  now?: Date;
}): Promise<ProudTestReport[]> {
  const nowMs = (args.now ?? new Date()).getTime();
  const experiments = await readLandingExperiments();
  if (experiments === "unavailable") return [UNREADABLE_REPORT];
  if (experiments.length === 0) {
    return [
      {
        ...UNREADABLE_REPORT,
        loaded: false,
        exposuresUnreadable: false,
        status: "missing",
        note: "Controlled landing-test results were not loaded for this view.",
        coverage: "Not loaded.",
      },
    ];
  }
  const [identities, signals, exposureGroups] = await Promise.all([
    readIdentities(),
    readSignals(),
    Promise.all(experiments.map((experiment) => readExposures(experiment.id))),
  ]);
  let earliest: number | null = null;
  for (const group of exposureGroups) {
    for (const exposure of group.rows) {
      if (earliest == null || exposure.occurredAtMs < earliest) earliest = exposure.occurredAtMs;
    }
  }
  let payments: ProudTestPayment[] = [];
  let paymentsReadable = false;
  if (args.billing.subscriptionsReadable && identities.complete) {
    try {
      const cohort = await loadCohortPayments({ earliestExposureMs: earliest, nowMs });
      payments = cohort.payments;
      paymentsReadable = cohort.complete;
    } catch (err) {
      console.warn("[landing-experiment] cohort invoice read failed", {
        reason: err instanceof Error ? err.message : "cohort_invoices_failed",
      });
      paymentsReadable = false;
    }
  }
  return experiments.map((experiment, index) => {
    const exposures = exposureGroups[index] ?? { rows: [], complete: false };
    return summarizeProudTest({
      loaded: true,
      exposuresReadable: exposures.complete,
      trialsReadable: args.billing.subscriptionsReadable && identities.complete,
      paymentsReadable: paymentsReadable && exposures.complete,
      signalsReadable: signals.complete,
      status: experiment.status,
      name: experiment.name,
      entrySlug: experiment.destinations.entrySlug,
      destinations: {
        control: experiment.destinations.controlPath,
        challenger: experiment.destinations.challengerPath,
      },
      evidence: experiment.evidence,
      conclusion: experiment.conclusion,
      nextAction: experiment.nextAction,
      startOn: experiment.startOn,
      exposures: exposures.rows,
      identities: identities.links,
      trials: args.billing.trials,
      payments,
      signals: signals.rows,
      nowMs,
    });
  });
}

export async function loadProudTestReport(args: {
  billing: LandingBillingInput;
  now?: Date;
}): Promise<ProudTestReport> {
  const reports = await loadLandingExperimentReports(args);
  return (
    reports.find((report) => report.entrySlug === "proud-test") ??
    reports[0] ??
    UNREADABLE_REPORT
  );
}
