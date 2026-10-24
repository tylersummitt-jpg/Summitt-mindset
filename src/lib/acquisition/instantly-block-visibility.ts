export type InstantlyBlockVisibility = {
  countsReadable: boolean;
  switchReadable: boolean;
  ageReadable: boolean;
  blocking: "on" | "off" | null;
  pending: number | null;
  confirmed: number | null;
  failed: number | null;
  uncertain: number | null;
  oldestOutstandingAt: string | null;
};

export type InstantlyBlockVisibilityView = {
  pending: string;
  confirmed: string;
  failed: string;
  uncertain: string;
  outstanding: string;
  localRequests: string;
  oldestAge: string;
  blocking: string;
  note: string;
};

const NOT_AVAILABLE = "Not available";

export function unavailableInstantlyBlockVisibility(): InstantlyBlockVisibility {
  return {
    countsReadable: false,
    switchReadable: false,
    ageReadable: false,
    blocking: null,
    pending: null,
    confirmed: null,
    failed: null,
    uncertain: null,
    oldestOutstandingAt: null,
  };
}

export function presentInstantlyBlockVisibility(
  report: InstantlyBlockVisibility,
  now: Date,
): InstantlyBlockVisibilityView {
  const countsReady = report.countsReadable
    && report.pending != null
    && report.confirmed != null
    && report.failed != null
    && report.uncertain != null;
  const outstanding = countsReady
    ? report.pending! + report.failed! + report.uncertain!
    : null;
  const localRequests = countsReady && outstanding != null
    ? outstanding + report.confirmed!
    : null;
  return {
    pending: countText(report.pending, countsReady),
    confirmed: countText(report.confirmed, countsReady),
    failed: countText(report.failed, countsReady),
    uncertain: countText(report.uncertain, countsReady),
    outstanding: countText(outstanding, countsReady),
    localRequests: countText(localRequests, countsReady),
    oldestAge: ageText(report, outstanding, countsReady, now),
    blocking: report.switchReadable ? (report.blocking === "on" ? "ON" : "OFF") : NOT_AVAILABLE,
    note: "Pending, failed, and uncertain rows are local stop requests waiting in our database. Confirmed means Instantly has a matched blocklist entry. A pending count is not a confirmed provider block. Native blocking OFF means the hourly cron stores local requests and does not call Instantly.",
  };
}

export function formatInstantlyBlockVisibility(view: InstantlyBlockVisibilityView): string[] {
  return [
    "SUBSCRIBER STOPS — ALL TIME",
    "The date range does not filter this section.",
    `Native Instantly blocking: ${view.blocking}`,
    `Local stop requests: ${view.localRequests}`,
    `Confirmed Instantly blocks: ${view.confirmed}`,
    `Pending local stop requests: ${view.pending}`,
    `Failed local stop requests: ${view.failed}`,
    `Uncertain local stop requests: ${view.uncertain}`,
    `Outstanding stops: ${view.outstanding}`,
    `Oldest outstanding stop: ${view.oldestAge}`,
    view.note,
  ];
}

function countText(value: number | null, readable: boolean): string {
  return readable && value != null ? String(value) : NOT_AVAILABLE;
}

function ageText(
  report: InstantlyBlockVisibility,
  outstanding: number | null,
  countsReady: boolean,
  now: Date,
): string {
  if (!countsReady || !report.ageReadable) return NOT_AVAILABLE;
  if (outstanding === 0) return "None";
  if (!report.oldestOutstandingAt) return NOT_AVAILABLE;
  return formatOutstandingAge(report.oldestOutstandingAt, now) ?? NOT_AVAILABLE;
}

export function formatOutstandingAge(createdAt: string, now: Date): string | null {
  const elapsed = now.getTime() - Date.parse(createdAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "under 1 minute";
  if (elapsed < hour) return plural(Math.floor(elapsed / minute), "minute");
  if (elapsed < day) return plural(Math.floor(elapsed / hour), "hour");
  return plural(Math.floor(elapsed / day), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
