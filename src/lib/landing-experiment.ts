import { LANDING_FIRST_PAYMENT_WINDOW_MS } from "@/lib/landing-page-performance";

export {
  APPROVED_LANDING_DESTINATIONS,
  assignProudTestVariant,
  decideLandingEntry,
  decideProudTestEntry,
  exposureMatchesDestination,
  isApprovedLandingDestination,
  isLandingExperimentEntryPath,
  isLikelyBotUserAgent,
  isPrefetchRequest,
  landingAssignmentFromInput,
  landingColumnPayload,
  parseEntrySlug,
  parseLandingAssignments,
  parseProudTestAssignment,
  parseStoredLanding,
  PROUD_TEST_COOKIE,
  PROUD_TEST_DEFINITION,
  PROUD_TEST_ENTRY_PATH,
  PROUD_TEST_EXPERIMENT_ID,
  PROUD_TEST_INSTRUMENTATION_VERSION,
  PROUD_TEST_MIN_DAYS,
  PROUD_TEST_MIN_EXPOSED_PER_VARIANT,
  PROUD_TEST_TRIAL_WINDOW_MS,
  PROUD_TEST_VARIANTS,
  serializeLandingAssignment,
  serializeProudTestAssignment,
  upsertLandingAssignment,
} from "@/lib/landing-experiment-shared";
export type {
  ApprovedLandingDestination,
  LandingAssignmentCookie,
  LandingDestinations,
  LandingVariant,
  ProudTestStatus,
  ProudTestVariant,
} from "@/lib/landing-experiment-shared";

import {
  PROUD_TEST_INSTRUMENTATION_VERSION,
  PROUD_TEST_MIN_DAYS,
  PROUD_TEST_MIN_EXPOSED_PER_VARIANT,
  PROUD_TEST_TRIAL_WINDOW_MS,
  type ApprovedLandingDestination,
  type ProudTestStatus,
  type ProudTestVariant,
} from "@/lib/landing-experiment-shared";

export type ProudTestExposure = {
  visitorId: string;
  variant: ProudTestVariant;
  occurredAtMs: number;
};

export type ProudTestIdentity = {
  clerkUserId: string;
  visitorId: string;
};

export type ProudTestTrial = {
  clerkUserId: string | null;
  trialStartMs: number;
  trialEndMs: number | null;
  status: string;
};

export type ProudTestPayment = {
  clerkUserId: string;
  paidAtMs: number;
};

export type ProudTestSignal = {
  visitorId: string;
  kind: "click" | "checkout" | "checkout_failed";
  occurredAtMs: number;
};

export type ProudTestCount = number | "Not available";

export type ProudTestVariantRow = {
  variant: ProudTestVariant;
  label: string;
  path: string;
  exposed: ProudTestCount;
  clicks: ProudTestCount;
  checkouts: ProudTestCount;
  checkoutFailures: ProudTestCount;
  trials: ProudTestCount;
  trialRate: string;
  paid: ProudTestCount;
  matureRate: string;
};

export type ProudTestReport = {
  loaded: boolean;
  exposuresUnreadable: boolean;
  name: string;
  entrySlug: string | null;
  status: ProudTestStatus;
  evidence: string | null;
  conclusion: string | null;
  nextAction: string | null;
  startOn: string | null;
  rows: ProudTestVariantRow[];
  difference: string;
  unknownTrials: ProudTestCount;
  coverage: string;
  note: string;
};

const NOT_LOADED: ProudTestReport = {
  loaded: false,
  exposuresUnreadable: false,
  name: "Controlled landing test",
  entrySlug: null,
  status: "missing",
  evidence: null,
  conclusion: null,
  nextAction: null,
  startOn: null,
  rows: [],
  difference: "Not available",
  unknownTrials: "Not available",
  coverage: "Not loaded.",
  note: "Controlled landing-test results were not loaded for this view.",
};

export const EMPTY_PROUD_TEST_REPORT = NOT_LOADED;

function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "Not available";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function shown(readable: boolean, value: number): ProudTestCount {
  return readable ? value : "Not available";
}

/** Invoice window for one exposure cohort. It does not take a dashboard date range. */
export function experimentInvoiceWindow(args: {
  earliestExposureMs: number;
  nowMs: number;
}): { startMs: number; endMs: number } {
  const day = 24 * 60 * 60 * 1000;
  return {
    startMs: Math.max(0, args.earliestExposureMs - day),
    endMs: args.nowMs,
  };
}

function paymentConfirms(trial: ProudTestTrial, paidAtMs: number): boolean {
  if (!Number.isFinite(paidAtMs) || paidAtMs < trial.trialStartMs) return false;
  const anchor = trial.trialEndMs ?? trial.trialStartMs;
  return paidAtMs <= anchor + LANDING_FIRST_PAYMENT_WINDOW_MS;
}

function paidOutcome(
  trial: ProudTestTrial,
  payments: readonly ProudTestPayment[],
  nowMs: number
): "confirmed" | "running" | "ended_unpaid" | "unknown" {
  if (payments.some((payment) => paymentConfirms(trial, payment.paidAtMs))) {
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

type ExposureState = {
  variant: ProudTestVariant | "split";
  firstAtMs: number;
};

function exposureByVisitor(exposures: readonly ProudTestExposure[]): Map<string, ExposureState> {
  const map = new Map<string, ExposureState>();
  for (const exposure of exposures) {
    const prev = map.get(exposure.visitorId);
    if (!prev) {
      map.set(exposure.visitorId, { variant: exposure.variant, firstAtMs: exposure.occurredAtMs });
      continue;
    }
    if (prev.variant !== exposure.variant) {
      prev.variant = "split";
    }
    if (exposure.occurredAtMs < prev.firstAtMs) prev.firstAtMs = exposure.occurredAtMs;
  }
  return map;
}

function identityByClerk(
  links: readonly ProudTestIdentity[]
): Map<string, { visitorIds: Set<string>; conflict: boolean }> {
  const map = new Map<string, { visitorIds: Set<string>; conflict: boolean }>();
  for (const link of links) {
    const clerkUserId = link.clerkUserId.trim();
    const visitorId = link.visitorId.trim();
    if (!clerkUserId || !visitorId) continue;
    const prev = map.get(clerkUserId) ?? { visitorIds: new Set<string>(), conflict: false };
    prev.visitorIds.add(visitorId);
    if (prev.visitorIds.size > 1) prev.conflict = true;
    map.set(clerkUserId, prev);
  }
  return map;
}

function earliestTrials(trials: readonly ProudTestTrial[]): ProudTestTrial[] {
  const byClerk = new Map<string, ProudTestTrial>();
  for (const trial of trials) {
    const clerkUserId = trial.clerkUserId?.trim() || "";
    if (!clerkUserId || !Number.isFinite(trial.trialStartMs)) continue;
    const prev = byClerk.get(clerkUserId);
    if (!prev || trial.trialStartMs < prev.trialStartMs) {
      byClerk.set(clerkUserId, { ...trial, clerkUserId });
    }
  }
  return [...byClerk.values()];
}

function daysSince(startOn: string | null, nowMs: number): number | null {
  if (!startOn || !/^\d{4}-\d{2}-\d{2}$/.test(startOn)) return null;
  const start = Date.parse(`${startOn}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return null;
  return Math.floor((nowMs - start) / (24 * 60 * 60 * 1000));
}

export function summarizeProudTest(args: {
  loaded: boolean;
  exposuresReadable: boolean;
  paymentsReadable: boolean;
  trialsReadable: boolean;
  signalsReadable: boolean;
  status: ProudTestStatus;
  name?: string;
  entrySlug?: string | null;
  destinations?: {
    control: ApprovedLandingDestination;
    challenger: ApprovedLandingDestination;
  };
  evidence?: string | null;
  conclusion?: string | null;
  nextAction?: string | null;
  startOn?: string | null;
  exposures?: readonly ProudTestExposure[];
  identities?: readonly ProudTestIdentity[];
  trials?: readonly ProudTestTrial[];
  payments?: readonly ProudTestPayment[];
  signals?: readonly ProudTestSignal[];
  nowMs?: number;
}): ProudTestReport {
  if (!args.loaded) return NOT_LOADED;
  const nowMs = args.nowMs ?? Date.now();
  const destinations = args.destinations ?? {
    control: "/" as const,
    challenger: "/become-proud" as const,
  };
  const entrySlug = args.entrySlug ?? "proud-test";
  const noteParts = [
    `This is the controlled comparison for /go/${entrySlug}. Direct visits to ${destinations.control} and ${destinations.challenger} are not included.`,
    "A higher rate is not a winner. The registry holds the human decision.",
    args.status === "running"
      ? "New visitors at the entry URL are being assigned."
      : "The entry URL is not assigning new visitors. Returning assigned visitors keep their version.",
  ];
  if (!args.exposuresReadable) {
    return {
      loaded: true,
      exposuresUnreadable: true,
      name: args.name ?? "Controlled landing test",
      entrySlug: args.entrySlug ?? null,
      status: args.status,
      evidence: args.evidence ?? null,
      conclusion: args.conclusion ?? null,
      nextAction: args.nextAction ?? null,
      startOn: args.startOn ?? null,
      rows: [],
      difference: "Not available",
      unknownTrials: "Not available",
      coverage: "Exposures could not be read. Do not treat that as zero visitors.",
      note: noteParts.join(" "),
    };
  }

  const exposed = exposureByVisitor(args.exposures ?? []);
  const links = identityByClerk(args.identities ?? []);
  const paymentsByClerk = new Map<string, ProudTestPayment[]>();
  if (args.paymentsReadable) {
    for (const payment of args.payments ?? []) {
      const list = paymentsByClerk.get(payment.clerkUserId) ?? [];
      list.push(payment);
      paymentsByClerk.set(payment.clerkUserId, list);
    }
  }

  const buckets = {
    control: emptyBucket(),
    challenger: emptyBucket(),
  };
  const exposedIds = {
    control: new Set<string>(),
    challenger: new Set<string>(),
  };
  let splitVisitors = 0;
  for (const [visitorId, state] of exposed) {
    if (state.variant === "split") {
      splitVisitors += 1;
      continue;
    }
    exposedIds[state.variant].add(visitorId);
  }

  if (args.signalsReadable) {
    for (const signal of args.signals ?? []) {
      const state = exposed.get(signal.visitorId);
      if (!state || state.variant === "split" || signal.occurredAtMs < state.firstAtMs) continue;
      const bucket = buckets[state.variant];
      if (signal.kind === "click") bucket.clicks.add(signal.visitorId);
      if (signal.kind === "checkout") bucket.checkouts.add(signal.visitorId);
      if (signal.kind === "checkout_failed") bucket.checkoutFailures.add(signal.visitorId);
    }
  }

  let unknownTrials: ProudTestCount = args.trialsReadable ? 0 : "Not available";
  if (args.trialsReadable) {
    for (const trial of earliestTrials(args.trials ?? [])) {
      const clerkUserId = trial.clerkUserId ?? "";
      const link = links.get(clerkUserId);
      if (!link) continue;
      const states = [...link.visitorIds]
        .map((visitorId) => ({ visitorId, state: exposed.get(visitorId) }))
        .filter((item): item is { visitorId: string; state: ExposureState } => item.state != null);
      if (states.length === 0) continue;
      const variants = new Set(states.map((item) => item.state.variant));
      if (link.conflict || variants.has("split") || variants.size !== 1) {
        unknownTrials = Number(unknownTrials) + 1;
        continue;
      }
      const match = states[0];
      const variant = match?.state.variant;
      if (!match || !variant || variant === "split") continue;
      if (trial.trialStartMs < match.state.firstAtMs) continue;
      if (trial.trialStartMs > match.state.firstAtMs + PROUD_TEST_TRIAL_WINDOW_MS) continue;
      const bucket = buckets[variant];
      bucket.trials.add(match.visitorId);
      if (!args.paymentsReadable) continue;
      const outcome = paidOutcome(trial, paymentsByClerk.get(clerkUserId) ?? [], nowMs);
      if (outcome === "confirmed") {
        bucket.paid.add(match.visitorId);
        bucket.mature.add(match.visitorId);
      } else if (outcome === "ended_unpaid") {
        bucket.mature.add(match.visitorId);
      }
    }
  }

  const rows = (["control", "challenger"] as const).map((variant) => {
    const bucket = buckets[variant];
    const exposedCount = exposedIds[variant].size;
    return {
      variant,
      label: variant === "control" ? "Control A" : "Challenger B",
      path: destinations[variant],
      exposed: exposedCount,
      clicks: shown(args.signalsReadable, bucket.clicks.size),
      checkouts: shown(args.signalsReadable, bucket.checkouts.size),
      checkoutFailures: shown(args.signalsReadable, bucket.checkoutFailures.size),
      trials: shown(args.trialsReadable, bucket.trials.size),
      trialRate: args.trialsReadable ? rate(bucket.trials.size, exposedCount) : "Not available",
      paid: shown(args.paymentsReadable, bucket.paid.size),
      matureRate: args.paymentsReadable
        ? rate(bucket.paid.size, bucket.mature.size)
        : "Not available",
    };
  });

  const controlRate = rows[0]?.trialRate ?? "Not available";
  const challengerRate = rows[1]?.trialRate ?? "Not available";
  let difference = "Not available";
  if (
    exposedIds.control.size > 0 &&
    exposedIds.challenger.size > 0 &&
    controlRate !== "Not available" &&
    challengerRate !== "Not available"
  ) {
    const gap = Number(challengerRate.replace("%", "")) - Number(controlRate.replace("%", ""));
    difference = `${gap.toFixed(1)} percentage points, challenger minus control. This is not a winner.`;
  }
  const elapsed = daysSince(args.startOn ?? null, nowMs);
  const minMet =
    exposedIds.control.size >= PROUD_TEST_MIN_EXPOSED_PER_VARIANT &&
    exposedIds.challenger.size >= PROUD_TEST_MIN_EXPOSED_PER_VARIANT &&
    elapsed != null &&
    elapsed >= PROUD_TEST_MIN_DAYS;
  const coverage = [
    `Instrumentation version ${PROUD_TEST_INSTRUMENTATION_VERSION}.`,
    minMet
      ? "The minimum observation size has been met. A person still has to record the decision."
      : `Inconclusive until each variant has ${PROUD_TEST_MIN_EXPOSED_PER_VARIANT} exposed visitors and ${PROUD_TEST_MIN_DAYS} days have passed since the start date.`,
    args.paymentsReadable
      ? "Confirmed payments follow this exposure cohort through the first-payment window. Changing the dashboard date range does not change them."
      : "Confirmed payments are not available. Invoices could not be read.",
    splitVisitors > 0
      ? `${splitVisitors} visitors were seen on both variants and are not counted for either.`
      : "No visitor was counted on both variants.",
    `Trials that could not be tied to one exposed visitor: ${unknownTrials}.`,
  ].join(" ");

  return {
    loaded: true,
    exposuresUnreadable: false,
    name: args.name ?? "Controlled landing test",
    entrySlug,
    status: args.status,
    evidence: args.evidence ?? null,
    conclusion: args.conclusion ?? null,
    nextAction: args.nextAction ?? null,
    startOn: args.startOn ?? null,
    rows,
    difference,
    unknownTrials,
    coverage,
    note: noteParts.join(" "),
  };
}

function emptyBucket() {
  return {
    clicks: new Set<string>(),
    checkouts: new Set<string>(),
    checkoutFailures: new Set<string>(),
    trials: new Set<string>(),
    paid: new Set<string>(),
    mature: new Set<string>(),
  };
}

export function formatProudTestReport(report: ProudTestReport): string[] {
  const lines = [
    report.name ? `CONTROLLED LANDING TEST: ${report.name}` : "CONTROLLED LANDING TEST",
    report.note,
  ];
  if (!report.loaded) return lines;
  if (report.entrySlug) lines.push(`Entry: /go/${report.entrySlug}`);
  lines.push(
    `Status: ${report.status}.`,
    `Evidence: ${report.evidence ?? "Not recorded."}`,
    `Measured decision: ${report.conclusion ?? "No measured result is stored. This does not calculate a winner."}`,
    `Next: ${report.nextAction ?? "No next action recorded."}`,
    `Started: ${report.startOn ?? "Not started."}`,
    `Trial-start rate difference: ${report.difference}`,
    `Unknown trials: ${report.unknownTrials}`,
    report.coverage
  );
  if (report.exposuresUnreadable) {
    lines.push("Exposures could not be read. Do not treat that as zero visitors.");
  }
  for (const row of report.rows) {
    lines.push(
      `- ${row.label} (${row.path})`,
      `  Exposed visitors: ${row.exposed}`,
      `  Join clicks: ${row.clicks}`,
      `  Checkout starts: ${row.checkouts}`,
      `  Checkout creation failures: ${row.checkoutFailures}`,
      `  Attributed trials: ${row.trials}`,
      `  Trial-start rate: ${row.trialRate}`,
      `  Confirmed paid conversions: ${row.paid}`,
      `  Mature paid-conversion rate: ${row.matureRate}`
    );
  }
  return lines;
}
