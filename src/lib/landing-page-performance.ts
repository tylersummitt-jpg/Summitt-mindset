import {
  HOMEPAGE_LANDING_DESTINATION,
  LANDING_MEASUREMENT_DESTINATIONS,
} from "@/lib/audience-landing-pages";

/** New landing pages have no history before this instrumentation. Homepage views are older. */
export const LANDING_PAGE_MEASUREMENT_CUTOVER_MS = Date.UTC(2026, 9, 10);

export const LANDING_PAGE_NOT_AN_EXPERIMENT =
  "These rows show what happened on each page. They are not a controlled experiment, and a higher rate is not a winner.";

export type LandingObservationKind = "page_view" | "cta_click" | "checkout" | "account";

export type LandingObservation = {
  kind: LandingObservationKind;
  visitorId: string;
  path: string | null;
  occurredAtMs: number;
};

export type LandingPageRow = {
  id: string;
  label: string;
  path: string;
  visitors: number;
  ctaClicks: number;
  ctaRate: string;
  trials: "Not available";
  visitorToTrial: "Not available";
  paid: "Not available";
  checkoutStarts: number | null;
  accounts: number | null;
  gap: string;
};

export type LandingPagePerformance = {
  available: boolean;
  incomplete: boolean;
  rows: LandingPageRow[];
  note: string;
};

function rate(clicks: number, visitors: number): string {
  if (visitors <= 0) return "Not available";
  return `${((clicks / visitors) * 100).toFixed(1)}%`;
}

function destinationForPath(path: string | null) {
  if (!path) return null;
  return LANDING_MEASUREMENT_DESTINATIONS.find((item) => item.path === path) ?? null;
}

function countsForPath(path: string) {
  return path === HOMEPAGE_LANDING_DESTINATION.path;
}

export function summarizeLandingPagePerformance(args: {
  observations: LandingObservation[];
  pagesReadable: boolean;
  outcomesReadable: boolean;
}): LandingPagePerformance {
  if (!args.pagesReadable) {
    return {
      available: false,
      incomplete: false,
      rows: [],
      note: "Landing-page analytics could not be read. Do not treat that as zero visitors.",
    };
  }

  const visitors = new Map<string, Set<string>>();
  const clicks = new Map<string, Set<string>>();
  for (const destination of LANDING_MEASUREMENT_DESTINATIONS) {
    visitors.set(destination.path, new Set());
    clicks.set(destination.path, new Set());
  }

  for (const observation of args.observations) {
    if (observation.kind !== "page_view" && observation.kind !== "cta_click") continue;
    const destination = destinationForPath(observation.path);
    if (!destination) continue;
    if (
      !countsForPath(destination.path) &&
      observation.occurredAtMs < LANDING_PAGE_MEASUREMENT_CUTOVER_MS
    ) {
      continue;
    }
    if (observation.kind === "page_view") {
      visitors.get(destination.path)?.add(observation.visitorId);
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

  if (args.outcomesReadable) {
    for (const observation of args.observations) {
      if (observation.kind !== "checkout" && observation.kind !== "account") continue;
      const views = args.observations
        .filter(
          (item) =>
            item.kind === "page_view" &&
            item.visitorId === observation.visitorId &&
            item.occurredAtMs <= observation.occurredAtMs &&
            destinationForPath(item.path) &&
            (countsForPath(item.path ?? "") ||
              item.occurredAtMs >= LANDING_PAGE_MEASUREMENT_CUTOVER_MS)
        )
        .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
      const first = views[0];
      if (!first?.path) continue;
      const bucket = observation.kind === "checkout" ? checkoutByPath : accountsByPath;
      bucket.get(first.path)?.add(observation.visitorId);
    }
  }

  const rows: LandingPageRow[] = LANDING_MEASUREMENT_DESTINATIONS.map((destination) => {
    const pageVisitors = visitors.get(destination.path) ?? new Set();
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
    const gapParts = [
      "New free trials are not attributed to this page. The subscription trial count is a different population.",
      "Paying members are not attributed to this page.",
      checkoutStarts == null
        ? "Checkout starts tied to this page: Not available."
        : `Checkout starts tied to a visitor who saw this page first: ${checkoutStarts}. A checkout start is not a free trial.`,
      accounts == null
        ? "Accounts created after this page: Not available."
        : `Accounts created after this page, when it was the visitor's first measured page: ${accounts}. An account is not a paying member.`,
    ];
    if (unmatchedClicks > 0) {
      gapParts.push(
        `${unmatchedClicks} trial-button clicks had no matching page view and are not in the click rate.`
      );
    }
    if (!countsForPath(destination.path)) {
      gapParts.push("This page has no measurements before October 10, 2026.");
    }
    return {
      id: destination.id,
      label: destination.path === "/" ? "Homepage" : destination.label,
      path: destination.path,
      visitors: pageVisitors.size,
      ctaClicks: pageClicks.size,
      ctaRate: rate(pageClicks.size, pageVisitors.size),
      trials: "Not available",
      visitorToTrial: "Not available",
      paid: "Not available",
      checkoutStarts,
      accounts,
      gap: gapParts.join(" "),
    };
  });

  return {
    available: true,
    incomplete: false,
    rows,
    note: `${LANDING_PAGE_NOT_AN_EXPERIMENT} The homepage includes its existing page views for the selected range. The four new pages start October 10, 2026.`,
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
      `  New free trials: ${row.trials}`,
      `  Visitor-to-trial: ${row.visitorToTrial}`,
      `  New paying members: ${row.paid}`,
      `  Gap: ${row.gap}`
    );
  }
  return lines;
}
