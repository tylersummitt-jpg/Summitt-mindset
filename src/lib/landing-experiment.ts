import { LANDING_FIRST_PAYMENT_WINDOW_MS } from "@/lib/landing-page-performance";
import {
  CTA_LABELS,
  EXPERIMENT_SECTIONS,
  campaignMixNote,
  deviceLine,
  experimentEvidenceState,
  type ExperimentCtaSurface,
} from "@/lib/landing-experiment-telemetry";

export {
  APPROVED_LANDING_DESTINATIONS,
  assignProudTestVariant,
  decideHomepageSplit,
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
  surface?: string | null;
};

export type ProudTestAssignment = {
  visitorId: string;
  variant: ProudTestVariant;
  occurredAtMs: number;
  campaign: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  inApp: string | null;
  synthetic: boolean;
};

export type ProudTestAccount = {
  visitorId: string;
  occurredAtMs: number;
};

export type ProudTestBehavior = {
  visitorId: string;
  viewedPath: string;
  sections: string[];
  scroll: number;
  engaged: number;
  device: string | null;
  os: string | null;
  browser: string | null;
  inApp: string | null;
};

export type ProudTestCount = number | "Not available";

export type ProudTestVariantRow = {
  variant: ProudTestVariant;
  label: string;
  path: string;
  assigned: ProudTestCount;
  exposed: ProudTestCount;
  clicks: ProudTestCount;
  rawClicks: ProudTestCount;
  checkouts: ProudTestCount;
  checkoutFailures: ProudTestCount;
  accounts: ProudTestCount;
  priorAccounts: ProudTestCount;
  trials: ProudTestCount;
  trialRate: string;
  exposedTrialRate: string;
  paid: ProudTestCount;
  matureRate: string;
};

export type ProudTestCtaRow = {
  surface: string;
  label: string;
  clickers: number;
  rawClicks: number;
  rate: string;
};

export type ProudTestSectionLine = {
  id: string;
  label: string;
  path: string;
  reached: number;
  rate: string;
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
  evidenceState: string;
  evidenceNote: string;
  ctaRows: ProudTestCtaRow[];
  sectionLines: ProudTestSectionLine[];
  behaviorNote: string;
  scrollNote: string;
  engagedNote: string;
  deviceNote: string;
  campaignNote: string;
  videoNote: string;
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
  evidenceState: "Collecting Data",
  evidenceNote: "Controlled landing-test results were not loaded for this view.",
  ctaRows: [],
  sectionLines: [],
  behaviorNote: "Not loaded.",
  scrollNote: "Not loaded.",
  engagedNote: "Not loaded.",
  deviceNote: "Not available",
  campaignNote: "Not loaded.",
  videoNote:
    "Neither sales page currently includes a playable video. Become Proud shows Film Room still images. Homepage video milestones that exist elsewhere are not part of this comparison.",
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
  assignments?: readonly ProudTestAssignment[];
  assignmentsReadable?: boolean;
  accounts?: readonly ProudTestAccount[];
  accountsReadable?: boolean;
  behaviors?: readonly ProudTestBehavior[];
  behaviorsReadable?: boolean;
  nowMs?: number;
}): ProudTestReport {
  if (!args.loaded) return NOT_LOADED;
  const nowMs = args.nowMs ?? Date.now();
  const destinations = args.destinations ?? {
    control: "/" as const,
    challenger: "/become-proud" as const,
  };
  const entrySlug = args.entrySlug ?? "proud-test";
  const homepageEntry = entrySlug === "proud-test";
  const noteParts = homepageEntry
    ? [
        "Eligible anonymous visitors to / are assigned about half to the homepage and half to /become-proud. Direct visits to /become-proud are not assignments. Signed-in members are not enrolled.",
        "A higher rate is not a winner. The registry holds the human decision.",
        args.status === "running"
          ? "New eligible visitors to the homepage are being assigned."
          : "The homepage is not assigning new visitors. Returning assigned visitors keep their version.",
      ]
    : [
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
      evidenceState: "Measurement Problem",
      evidenceNote: "Exposures could not be read. Do not treat that as zero visitors.",
      ctaRows: [],
      sectionLines: [],
      behaviorNote: "Not available",
      scrollNote: "Not available",
      engagedNote: "Not available",
      deviceNote: "Not available",
      campaignNote: "Not available",
      videoNote: NOT_LOADED.videoNote,
    };
  }

  const useAssigned = args.assignmentsReadable === true;
  const syntheticVisitors = new Set(
    (args.assignments ?? []).filter((row) => row.synthetic).map((row) => row.visitorId)
  );
  const assigned = exposureByVisitor(
    (args.assignments ?? [])
      .filter((row) => !row.synthetic)
      .map((row) => ({
        visitorId: row.visitorId,
        variant: row.variant,
        occurredAtMs: row.occurredAtMs,
      }))
  );
  const exposed = exposureByVisitor(
    (args.exposures ?? []).filter((row) => !syntheticVisitors.has(row.visitorId))
  );
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
  const assignedIds = {
    control: new Set<string>(),
    challenger: new Set<string>(),
  };
  const ctaClickers = new Map<string, Set<string>>();
  const ctaRaw = new Map<string, number>();
  let splitVisitors = 0;
  let splitAssignments = 0;
  for (const [visitorId, state] of assigned) {
    if (state.variant === "split") {
      splitAssignments += 1;
      continue;
    }
    assignedIds[state.variant].add(visitorId);
  }
  for (const [visitorId, state] of exposed) {
    if (state.variant === "split") {
      splitVisitors += 1;
      continue;
    }
    exposedIds[state.variant].add(visitorId);
  }

  if (args.signalsReadable) {
    for (const signal of args.signals ?? []) {
      if (syntheticVisitors.has(signal.visitorId)) continue;
      const state = exposed.get(signal.visitorId);
      if (!state || state.variant === "split" || signal.occurredAtMs < state.firstAtMs) continue;
      const bucket = buckets[state.variant];
      if (signal.kind === "click") {
        bucket.clicks.add(signal.visitorId);
        bucket.rawClicks += 1;
        const surface = signal.surface?.trim();
        if (surface) {
          const people = ctaClickers.get(surface) ?? new Set<string>();
          people.add(signal.visitorId);
          ctaClickers.set(surface, people);
          ctaRaw.set(surface, (ctaRaw.get(surface) ?? 0) + 1);
        }
      }
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
      const population = useAssigned ? assigned : exposed;
      const states = [...link.visitorIds]
        .map((visitorId) => ({ visitorId, state: population.get(visitorId) }))
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
      if (useAssigned) {
        const seen = exposed.get(match.visitorId);
        if (seen && (seen.variant === "split" || seen.variant !== variant)) {
          unknownTrials = Number(unknownTrials) + 1;
          continue;
        }
      }
      const bucket = buckets[variant];
      bucket.trials.add(match.visitorId);
      const seen = exposed.get(match.visitorId);
      if (
        seen &&
        seen.variant === variant &&
        trial.trialStartMs >= seen.firstAtMs &&
        trial.trialStartMs <= seen.firstAtMs + PROUD_TEST_TRIAL_WINDOW_MS
      ) {
        bucket.exposedTrials.add(match.visitorId);
      }
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

  if (useAssigned && args.accountsReadable) {
    for (const account of args.accounts ?? []) {
      if (syntheticVisitors.has(account.visitorId)) continue;
      const state = assigned.get(account.visitorId);
      if (!state || state.variant === "split") continue;
      const bucket = buckets[state.variant];
      if (account.occurredAtMs < state.firstAtMs) bucket.priorAccounts.add(account.visitorId);
      else bucket.accounts.add(account.visitorId);
    }
  }

  const rows: ProudTestVariantRow[] = (["control", "challenger"] as const).map((variant) => {
    const bucket = buckets[variant];
    const exposedCount = exposedIds[variant].size;
    const assignedCount = assignedIds[variant].size;
    const primaryTrials = bucket.trials.size;
    const primaryDenominator = useAssigned ? assignedCount : exposedCount;
    return {
      variant,
      label: variant === "control" ? "Homepage" : "Become Proud",
      path: destinations[variant],
      assigned: useAssigned ? assignedCount : "Not available",
      exposed: exposedCount,
      clicks: shown(args.signalsReadable, bucket.clicks.size),
      rawClicks: shown(args.signalsReadable, bucket.rawClicks),
      checkouts: shown(args.signalsReadable, bucket.checkouts.size),
      checkoutFailures: shown(args.signalsReadable, bucket.checkoutFailures.size),
      accounts: useAssigned && args.accountsReadable ? bucket.accounts.size : "Not available",
      priorAccounts:
        useAssigned && args.accountsReadable ? bucket.priorAccounts.size : "Not available",
      trials: shown(args.trialsReadable, primaryTrials),
      trialRate: args.trialsReadable ? rate(primaryTrials, primaryDenominator) : "Not available",
      exposedTrialRate: args.trialsReadable
        ? rate(useAssigned ? bucket.exposedTrials.size : primaryTrials, exposedCount)
        : "Not available",
      paid: shown(args.paymentsReadable, bucket.paid.size),
      matureRate: args.paymentsReadable
        ? rate(bucket.paid.size, bucket.mature.size)
        : "Not available",
    };
  });

  const controlRate = rows[0]?.trialRate ?? "Not available";
  const challengerRate = rows[1]?.trialRate ?? "Not available";
  let difference = "Not available";
  const comparedControl = useAssigned ? assignedIds.control.size : exposedIds.control.size;
  const comparedChallenger = useAssigned ? assignedIds.challenger.size : exposedIds.challenger.size;
  if (
    comparedControl > 0 &&
    comparedChallenger > 0 &&
    controlRate !== "Not available" &&
    challengerRate !== "Not available"
  ) {
    const gap = Number(challengerRate.replace("%", "")) - Number(controlRate.replace("%", ""));
    difference = `${gap.toFixed(1)} percentage points, challenger minus control. This is not a winner.`;
  }
  const elapsed = daysSince(args.startOn ?? null, nowMs);
  const evidence = experimentEvidenceState({
    readable: useAssigned && args.trialsReadable && args.exposuresReadable,
    days: elapsed,
    assignedA: assignedIds.control.size,
    assignedB: assignedIds.challenger.size,
    trialsA: buckets.control.trials.size,
    trialsB: buckets.challenger.trials.size,
  });
  const ctaRows = [...ctaClickers.entries()].map(([surface, people]) => {
    const proud = surface.startsWith("proud_");
    const denominator = proud ? exposedIds.challenger.size : exposedIds.control.size;
    return {
      surface,
      label: CTA_LABELS[surface as ExperimentCtaSurface] ?? surface,
      clickers: people.size,
      rawClicks: ctaRaw.get(surface) ?? people.size,
      rate: rate(people.size, denominator),
    };
  });
  const behaviorVisitors = new Map<string, Set<string>>();
  const sectionVisitors = new Map<string, Set<string>>();
  const scrollVisitors = new Map<string, Map<number, Set<string>>>();
  const engagedVisitors = new Map<string, Map<number, Set<string>>>();
  if (args.behaviorsReadable) {
    for (const behavior of args.behaviors ?? []) {
      if (syntheticVisitors.has(behavior.visitorId)) continue;
      const onPath = behaviorVisitors.get(behavior.viewedPath) ?? new Set<string>();
      onPath.add(behavior.visitorId);
      behaviorVisitors.set(behavior.viewedPath, onPath);
      for (const section of behavior.sections) {
        const seen = sectionVisitors.get(section) ?? new Set<string>();
        seen.add(behavior.visitorId);
        sectionVisitors.set(section, seen);
      }
      for (const milestone of [25, 50, 75, 90]) {
        if (behavior.scroll < milestone) continue;
        const byPath = scrollVisitors.get(behavior.viewedPath) ?? new Map<number, Set<string>>();
        const seen = byPath.get(milestone) ?? new Set<string>();
        seen.add(behavior.visitorId);
        byPath.set(milestone, seen);
        scrollVisitors.set(behavior.viewedPath, byPath);
      }
      for (const bucket of [15, 30, 60, 120]) {
        if (behavior.engaged < bucket) continue;
        const byPath = engagedVisitors.get(behavior.viewedPath) ?? new Map<number, Set<string>>();
        const seen = byPath.get(bucket) ?? new Set<string>();
        seen.add(behavior.visitorId);
        byPath.set(bucket, seen);
        engagedVisitors.set(behavior.viewedPath, byPath);
      }
    }
  }
  const sectionLines = EXPERIMENT_SECTIONS.map((section) => {
    const observed = behaviorVisitors.get(section.path)?.size ?? 0;
    const reached = sectionVisitors.get(section.id)?.size ?? 0;
    return {
      id: section.id,
      label: section.label,
      path: section.path,
      reached,
      rate: args.behaviorsReadable ? rate(reached, observed) : "Not available",
    };
  });
  const scrollParts = ["/", "/become-proud"].map((path) => {
    const observed = behaviorVisitors.get(path)?.size ?? 0;
    const marks = [25, 50, 75, 90].map((milestone) => {
      const count = scrollVisitors.get(path)?.get(milestone)?.size ?? 0;
      return `${milestone}% ${args.behaviorsReadable ? rate(count, observed) : "Not available"}`;
    });
    return `${path}: ${marks.join(", ")}`;
  });
  const engagedParts = ["/", "/become-proud"].map((path) => {
    const observed = behaviorVisitors.get(path)?.size ?? 0;
    const marks = [15, 30, 60, 120].map((bucket) => {
      const count = engagedVisitors.get(path)?.get(bucket)?.size ?? 0;
      return `${bucket}s ${args.behaviorsReadable ? rate(count, observed) : "Not available"}`;
    });
    return `${path}: ${marks.join(", ")}`;
  });
  const devices = { mobile: 0, desktop: 0 };
  const systems = { ios: 0, android: 0, other: 0 };
  const browsers = { safari: 0, chrome: 0, other: 0 };
  const apps = { instagram: 0, facebook: 0, tiktok: 0 };
  if (useAssigned) {
    const seen = new Set<string>();
    for (const row of args.assignments ?? []) {
      if (row.synthetic || seen.has(row.visitorId)) continue;
      seen.add(row.visitorId);
      if (row.device === "mobile" || row.device === "desktop") devices[row.device] += 1;
      if (row.os === "ios" || row.os === "android" || row.os === "other") systems[row.os] += 1;
      if (row.browser === "safari" || row.browser === "chrome" || row.browser === "other") {
        browsers[row.browser] += 1;
      }
      if (row.inApp === "instagram" || row.inApp === "facebook" || row.inApp === "tiktok") {
        apps[row.inApp] += 1;
      }
    }
  }
  const observedBehavior = [...behaviorVisitors.values()].reduce((sum, set) => sum + set.size, 0);
  const coverage = [
    `Instrumentation version ${PROUD_TEST_INSTRUMENTATION_VERSION}.`,
    useAssigned
      ? "Primary trial rate uses eligible assigned visitors. People who were assigned and never produced an exposure stay in that denominator."
      : "Assignment records were not included, so this trial rate uses exposed visitors.",
    args.paymentsReadable
      ? "Confirmed payments follow the counted trials through the first-payment window. Changing the dashboard date range does not change them."
      : "Confirmed payments are not available. Invoices could not be read.",
    splitVisitors > 0
      ? `${splitVisitors} visitors were seen on both variants and are not counted for either.`
      : "No visitor was counted on both variants.",
    splitAssignments > 0 ? `${splitAssignments} visitors had two assignment records.` : "",
    `Trials that could not be tied to one visitor: ${unknownTrials}.`,
    evidence.note,
  ]
    .filter(Boolean)
    .join(" ");

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
    evidenceState: useAssigned && args.trialsReadable ? evidence.state : "Measurement Problem",
    evidenceNote: useAssigned && args.trialsReadable
      ? evidence.note
      : "Assignment records or trial results were not available for the decision rule.",
    ctaRows,
    sectionLines: args.behaviorsReadable ? sectionLines : [],
    behaviorNote: args.behaviorsReadable
      ? `Section rates use ${observedBehavior} experiment visitors who sent behavior telemetry. That is not every exposed visitor.`
      : "Behavior telemetry could not be read.",
    scrollNote: args.behaviorsReadable
      ? `${scrollParts.join(" | ")} Scroll percentage is a weak comparison because the pages have different lengths.`
      : "Scroll depth could not be read.",
    engagedNote: args.behaviorsReadable
      ? `${engagedParts.join(" | ")} Engaged time counts a visible tab and pauses after about 30 seconds without activity. It is not a measure of reading.`
      : "Engaged time could not be read.",
    deviceNote: useAssigned
      ? `Device ${deviceLine(devices)}. System ${deviceLine(systems)}. Browser ${deviceLine(browsers)}. In-app ${deviceLine(apps)}.`
      : "Not available",
    campaignNote: useAssigned
      ? campaignMixNote(
          (args.assignments ?? [])
            .filter((row) => !row.synthetic)
            .map((row) => ({ campaign: row.campaign ?? "", variant: row.variant }))
        )
      : "Not available",
    videoNote: NOT_LOADED.videoNote,
  };
}

function emptyBucket() {
  return {
    clicks: new Set<string>(),
    rawClicks: 0,
    accounts: new Set<string>(),
    priorAccounts: new Set<string>(),
    exposedTrials: new Set<string>(),
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
  if (report.entrySlug === "proud-test") {
    lines.push("Entry: Automatic homepage traffic — /");
  } else if (report.entrySlug) {
    lines.push(`Entry: /go/${report.entrySlug}`);
  }
  lines.push(
    `Status: ${report.status}.`,
    `Evidence: ${report.evidence ?? "Not recorded."}`,
    `Measured decision: ${report.conclusion ?? "No measured result is stored. This does not calculate a winner."}`,
    `Next: ${report.nextAction ?? "No next action recorded."}`,
    `Started: ${report.startOn ?? "Not started."}`,
    `Evidence state: ${report.evidenceState}. ${report.evidenceNote}`,
    `Trial-start rate difference: ${report.difference}`,
    `Unknown trials: ${report.unknownTrials}`,
    report.coverage,
    report.behaviorNote,
    report.scrollNote,
    report.engagedNote,
    report.deviceNote,
    report.campaignNote,
    report.videoNote
  );
  if (report.exposuresUnreadable) {
    lines.push("Exposures could not be read. Do not treat that as zero visitors.");
  }
  for (const row of report.rows) {
    lines.push(
      `- ${row.label} (${row.path})`,
      `  Assigned visitors: ${row.assigned}`,
      `  Exposed visitors: ${row.exposed}`,
      `  CTA clickers: ${row.clicks}`,
      `  Raw CTA clicks: ${row.rawClicks}`,
      `  Completed accounts: ${row.accounts}`,
      `  Accounts that already existed: ${row.priorAccounts}`,
      `  Checkout sessions created: ${row.checkouts}`,
      `  Checkout creation failures: ${row.checkoutFailures}`,
      `  Genuine free-trial starts: ${row.trials}`,
      `  Trial rate per assigned visitor: ${row.trialRate}`,
      `  Trial rate per exposed visitor: ${row.exposedTrialRate}`,
      `  First paying subscribers: ${row.paid}`,
      `  Mature trial-to-paid: ${row.matureRate}`
    );
  }
  return lines;
}
