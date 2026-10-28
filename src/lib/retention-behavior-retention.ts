/**
 * Behavior during a finished subscription-age window, then retention at a later day.
 * Same membership clock and outcome rules as the retention page. Not a cause.
 */

import {
  ACTIVITY_SIGNALS,
  activityPeriod,
  usageInWindow,
  type ActivityHit,
  type ActivitySignal,
} from "@/lib/retention-activity-periods";

const DAY_MS = 86_400_000;
/** Same small-sample label the retention page already uses. */
const SMALL_SAMPLE = 15;

export type BehaviorMembership = {
  clerkUserId: string;
  startMs: number;
  endMs: number | null;
  endKnown: boolean;
  open: boolean;
  hasLater: boolean;
};

export type BehaviorGroup = {
  label: string;
  retained: number;
  eligible: number;
  rate: string;
  small: boolean;
};

export type BehaviorSignalRow = {
  signalId: string;
  label: string;
  status: "ready" | "unavailable";
  reason: string | null;
  definition: string | null;
  warning: string | null;
  groups: BehaviorGroup[];
};

export type BehaviorWindow = {
  windowLabel: string;
  outcomeLabel: string;
  leftDuring: number;
  immature: number;
  unknownEnd: number;
  signals: BehaviorSignalRow[];
};

export type DisengagementFact = {
  priorLabel: string;
  latestLabel: string;
  outcomeLabel: string;
  signalId: string;
  signalLabel: string;
  status: "ready" | "unavailable";
  reason: string | null;
  warning: string | null;
  decreased: BehaviorGroup;
  unchanged: BehaviorGroup;
  increased: BehaviorGroup;
  sentence: string | null;
};

export type BehaviorRetention = {
  population: "Monthly" | "Annual";
  notes: string[];
  windows: BehaviorWindow[];
  disengagement: DisengagementFact[];
};

const DISENGAGEMENT_SIGNALS = ["coaching_reply", "victory_room_visited"] as const;

export function emptyBehaviorRetention(population: "Monthly" | "Annual"): BehaviorRetention {
  return { population, notes: [], windows: [], disengagement: [] };
}

/** Later retention day for one observation window. The first window is Day 30. Later windows are 30 days after the window's last day. */
export function behaviorOutcomeDay(period: { startDay: number; endDayExclusive: number }): number {
  if (period.startDay === 0) return 30;
  return period.endDayExclusive - 1 + 30;
}

export function buildBehaviorRetention(args: {
  population: "Monthly" | "Annual";
  nowMs: number;
  memberships: BehaviorMembership[];
  hits: ActivityHit[];
  unavailableSignalIds: string[];
}): BehaviorRetention {
  const notes = [
    args.population === "Monthly"
      ? "Monthly members only. Annual members are in the section below."
      : "Annual members only. These counts are not in the monthly section above.",
    "Activity is counted only inside the finished window, and only for members still subscribed at the end of that window. The later day uses the same retention rule as the headline: still subscribed, or ended and not paid again.",
    "Members who ended during the window are counted on their own. They are not called inactive. Members who have not reached the later day are left out, not counted as ended.",
    "Victory Room and Film Room windows that begin before October 28, 2026 are unavailable, not zero. A read that did not finish is unavailable, not zero. Account deletion removes stored activity for that member. Missing history after deletion is not confirmed inactivity.",
    "These are counts side by side. They do not show that an activity caused someone to stay.",
  ];
  const hitsByMember = new Map<string, ActivityHit[]>();
  for (const hit of args.hits) {
    const list = hitsByMember.get(hit.clerkUserId) ?? [];
    list.push(hit);
    hitsByMember.set(hit.clerkUserId, list);
  }
  const unavailable = new Set(args.unavailableSignalIds);
  const lastIndex = lastBehaviorIndex(args.memberships, args.nowMs);
  const windows: BehaviorWindow[] = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    const window = buildWindow({
      period: activityPeriod(index),
      nowMs: args.nowMs,
      memberships: args.memberships,
      hitsByMember,
      unavailable,
    });
    if (window) windows.push(window);
  }
  return {
    population: args.population,
    notes,
    windows,
    disengagement: buildDisengagement({
      lastIndex,
      nowMs: args.nowMs,
      memberships: args.memberships,
      hitsByMember,
      unavailable,
    }),
  };
}

export function formatBehaviorRetention(report: BehaviorRetention): string[] {
  const lines = [`${report.population.toUpperCase()} BEHAVIOR VS. FUTURE RETENTION`];
  for (const note of report.notes) lines.push(note);
  if (report.windows.length === 0) lines.push("No mature comparison in this read.");
  for (const window of report.windows) {
    lines.push(`${window.windowLabel} activity, then retained at ${window.outcomeLabel}.`);
    if (window.leftDuring > 0) {
      lines.push(
        `Members who ended during this window: ${window.leftDuring}. They are not counted as inactive.`
      );
    }
    if (window.immature > 0) {
      lines.push(`Not old enough for ${window.outcomeLabel}: ${window.immature}.`);
    }
    if (window.unknownEnd > 0) lines.push(`Unknown end time: ${window.unknownEnd}.`);
    for (const signal of window.signals) lines.push(formatSignal(signal));
  }
  lines.push(
    "Change across two finished periods of the same length. Days 0–7 and Days 8–30 are different lengths, so they are not called a decline."
  );
  if (report.disengagement.length === 0) {
    lines.push("No comparable completed periods in this read.");
  }
  for (const row of report.disengagement) {
    if (row.status === "unavailable") {
      lines.push(
        `${row.priorLabel} to ${row.latestLabel}, ${row.signalLabel}, then ${row.outcomeLabel}. Unavailable. ${row.reason ?? ""}`.trim()
      );
      continue;
    }
    if (row.sentence) lines.push(row.sentence);
    lines.push(
      `${row.priorLabel} to ${row.latestLabel}, ${row.signalLabel}. Decreased: ${countText(row.decreased)}. Unchanged: ${countText(row.unchanged)}. Increased: ${countText(row.increased)}.${row.warning ? ` ${row.warning}` : ""}`
    );
  }
  return lines;
}

function formatSignal(signal: BehaviorSignalRow): string {
  if (signal.status === "unavailable") {
    return `${signal.label}. Unavailable. ${signal.reason ?? ""}`.trim();
  }
  const groups = signal.groups
    .map(
      (group) =>
        `${group.label}: ${group.retained} of ${group.eligible} (${group.rate}).${group.small ? " Small sample." : ""}`
    )
    .join(" ");
  return `${signal.label}. ${groups}${signal.definition ? ` ${signal.definition}` : ""}${signal.warning ? ` ${signal.warning}` : ""}`;
}

function countText(group: BehaviorGroup): string {
  if (group.eligible <= 0) return "0 of 0";
  return `${group.retained} of ${group.eligible} (${group.rate})${group.small ? ", small sample" : ""}`;
}

function lastBehaviorIndex(memberships: BehaviorMembership[], nowMs: number): number {
  let maxDay = -1;
  for (const membership of memberships) {
    const elapsed = elapsedDay(membership, nowMs);
    if (elapsed != null && elapsed > maxDay) maxDay = elapsed;
  }
  if (maxDay < 0) return -1;
  for (let index = 0; index < 400; index += 1) {
    if (activityPeriod(index).startDay > maxDay) return index - 1;
  }
  return 399;
}

function elapsedDay(membership: BehaviorMembership, nowMs: number): number | null {
  const end = !membership.endKnown || membership.open ? nowMs : membership.endMs;
  if (end == null || end < membership.startMs) return null;
  return Math.floor((end - membership.startMs) / DAY_MS);
}

function buildWindow(args: {
  period: { label: string; startDay: number; endDayExclusive: number };
  nowMs: number;
  memberships: BehaviorMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  unavailable: Set<string>;
}): BehaviorWindow | null {
  const outcomeDay = behaviorOutcomeDay(args.period);
  let leftDuring = 0;
  let immature = 0;
  let unknownEnd = 0;
  const eligible: BehaviorMembership[] = [];
  for (const membership of args.memberships) {
    const place = placeMember(membership, args.period, outcomeDay, args.nowMs);
    if (place === "left") leftDuring += 1;
    else if (place === "unknown") unknownEnd += 1;
    else if (place === "immature") immature += 1;
    else if (place === "eligible") eligible.push(membership);
  }
  if (leftDuring === 0 && immature === 0 && unknownEnd === 0 && eligible.length === 0) return null;
  const signals = ACTIVITY_SIGNALS.map((signal) =>
    buildSignal({
      signal,
      period: args.period,
      outcomeDay,
      nowMs: args.nowMs,
      eligible,
      hitsByMember: args.hitsByMember,
      readMissing: args.unavailable.has(signal.id),
    })
  ).filter((signal): signal is BehaviorSignalRow => signal != null);
  return {
    windowLabel: args.period.label,
    outcomeLabel: `Day ${outcomeDay}`,
    leftDuring,
    immature,
    unknownEnd,
    signals,
  };
}

function buildSignal(args: {
  signal: ActivitySignal;
  period: { startDay: number; endDayExclusive: number };
  outcomeDay: number;
  nowMs: number;
  eligible: BehaviorMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  readMissing: boolean;
}): BehaviorSignalRow | null {
  if (args.readMissing) {
    return {
      signalId: args.signal.id,
      label: args.signal.label,
      status: "unavailable",
      reason: "This read did not finish. Missing rows are not zero.",
      definition: null,
      warning: null,
      groups: [],
    };
  }
  const tracked: Array<{ membership: BehaviorMembership; usage: number; retained: boolean }> = [];
  let untracked = 0;
  for (const membership of args.eligible) {
    if (!windowTracked(membership, args.period, args.signal)) {
      untracked += 1;
      continue;
    }
    const bounds = windowBounds(membership, args.period);
    tracked.push({
      membership,
      usage: usageInWindow(
        args.hitsByMember.get(membership.clerkUserId) ?? [],
        args.signal,
        bounds.startMs,
        bounds.endMs,
        membership
      ),
      retained: subscriptionOutcome(membership, args.nowMs, args.outcomeDay) === "retained",
    });
  }
  if (tracked.length === 0) {
    if (untracked === 0) return null;
    return {
      signalId: args.signal.id,
      label: args.signal.label,
      status: "unavailable",
      reason: trackingReason(args.signal),
      definition: null,
      warning: null,
      groups: [],
    };
  }
  const split = splitUsage(tracked.map((row) => row.usage));
  const buckets = {
    none: [] as boolean[],
    some: [] as boolean[],
    frequent: [] as boolean[],
  };
  for (const row of tracked) {
    if (row.usage <= 0) buckets.none.push(row.retained);
    else if (split.frequentMin == null || row.usage < split.frequentMin) buckets.some.push(row.retained);
    else buckets.frequent.push(row.retained);
  }
  const windowDays = args.period.endDayExclusive - args.period.startDay;
  const groups = [
    behaviorGroup(noneLabel(args.signal), buckets.none),
    behaviorGroup(someLabel(args.signal, split.frequentMin), buckets.some),
    split.frequentMin == null
      ? null
      : behaviorGroup(frequentLabel(args.signal, split.frequentMin), buckets.frequent),
  ].filter((group): group is BehaviorGroup => group != null && group.eligible > 0);
  return {
    signalId: args.signal.id,
    label: args.signal.label,
    status: "ready",
    reason: null,
    definition: definitionText(windowDays, args.signal.unit, split.median, split.frequentMin, split.positiveCount),
    warning:
      untracked > 0
        ? `${untracked} members are outside the tracked history and are not in these groups.`
        : null,
    groups,
  };
}

function buildDisengagement(args: {
  lastIndex: number;
  nowMs: number;
  memberships: BehaviorMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  unavailable: Set<string>;
}): DisengagementFact[] {
  const rows: DisengagementFact[] = [];
  for (let index = 0; index < args.lastIndex; index += 1) {
    const prior = activityPeriod(index);
    const latest = activityPeriod(index + 1);
    if (prior.endDayExclusive - prior.startDay !== latest.endDayExclusive - latest.startDay) continue;
    for (const signalId of DISENGAGEMENT_SIGNALS) {
      const signal = ACTIVITY_SIGNALS.find((item) => item.id === signalId);
      if (!signal) continue;
      const row = buildDisengagementRow({
        prior,
        latest,
        signal,
        nowMs: args.nowMs,
        memberships: args.memberships,
        hitsByMember: args.hitsByMember,
        readMissing: args.unavailable.has(signal.id),
      });
      if (row) rows.push(row);
    }
  }
  return rows;
}

function buildDisengagementRow(args: {
  prior: { label: string; startDay: number; endDayExclusive: number };
  latest: { label: string; startDay: number; endDayExclusive: number };
  signal: ActivitySignal;
  nowMs: number;
  memberships: BehaviorMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  readMissing: boolean;
}): DisengagementFact | null {
  const outcomeDay = behaviorOutcomeDay(args.latest);
  const outcomeLabel = `Day ${outcomeDay}`;
  let immature = 0;
  let untracked = 0;
  let considered = 0;
  const decreased: boolean[] = [];
  const unchanged: boolean[] = [];
  const increased: boolean[] = [];
  for (const membership of args.memberships) {
    if (!completedWindow(membership, args.prior, args.nowMs)) continue;
    if (!completedWindow(membership, args.latest, args.nowMs)) continue;
    considered += 1;
    const outcome = subscriptionOutcome(membership, args.nowMs, outcomeDay);
    if (outcome === "immature" || outcome === "unknown") {
      immature += 1;
      continue;
    }
    if (
      !windowTracked(membership, args.prior, args.signal) ||
      !windowTracked(membership, args.latest, args.signal)
    ) {
      untracked += 1;
      continue;
    }
    const priorUsage = usageInWindow(
      args.hitsByMember.get(membership.clerkUserId) ?? [],
      args.signal,
      windowBounds(membership, args.prior).startMs,
      windowBounds(membership, args.prior).endMs,
      membership
    );
    const latestUsage = usageInWindow(
      args.hitsByMember.get(membership.clerkUserId) ?? [],
      args.signal,
      windowBounds(membership, args.latest).startMs,
      windowBounds(membership, args.latest).endMs,
      membership
    );
    const retained = outcome === "retained";
    if (latestUsage < priorUsage) decreased.push(retained);
    else if (latestUsage > priorUsage) increased.push(retained);
    else unchanged.push(retained);
  }
  if (considered === 0) return null;
  const base = {
    priorLabel: args.prior.label,
    latestLabel: args.latest.label,
    outcomeLabel,
    signalId: args.signal.id,
    signalLabel: args.signal.label,
  };
  if (args.readMissing) {
    return {
      ...base,
      status: "unavailable",
      reason: "This read did not finish. Missing rows are not zero.",
      warning: null,
      decreased: emptyGroup("Decreased"),
      unchanged: emptyGroup("Unchanged"),
      increased: emptyGroup("Increased"),
      sentence: null,
    };
  }
  if (decreased.length + unchanged.length + increased.length === 0) {
    const reasons: string[] = [];
    if (untracked > 0) reasons.push(trackingReason(args.signal));
    if (immature > 0) {
      reasons.push(`No member has reached ${outcomeLabel}. They are not counted as ended.`);
    }
    return {
      ...base,
      status: "unavailable",
      reason: reasons.join(" ") || "No comparable members in this read.",
      warning: null,
      decreased: emptyGroup("Decreased"),
      unchanged: emptyGroup("Unchanged"),
      increased: emptyGroup("Increased"),
      sentence: null,
    };
  }
  const decreasedGroup = behaviorGroup("Decreased", decreased);
  const unchangedGroup = behaviorGroup("Unchanged", unchanged);
  const increasedGroup = behaviorGroup("Increased", increased);
  const steadyRetained =
    unchanged.filter(Boolean).length + increased.filter(Boolean).length;
  const steadyEligible = unchanged.length + increased.length;
  const declined =
    decreasedGroup.eligible === 0
      ? "no member declined"
      : `${decreasedGroup.retained} of ${decreasedGroup.eligible}`;
  const steady =
    steadyEligible === 0
      ? "no member stayed the same or increased"
      : `${steadyRetained} of ${steadyEligible} among those whose activity stayed the same or increased`;
  return {
    ...base,
    status: "ready",
    reason: null,
    warning: [
      untracked > 0
        ? `${untracked} members are outside the tracked history and are not in these groups.`
        : null,
      immature > 0
        ? `${immature} members have not reached ${outcomeLabel} and are not in these groups.`
        : null,
    ]
      .filter((part): part is string => part != null)
      .join(" ") || null,
    decreased: decreasedGroup,
    unchanged: unchangedGroup,
    increased: increasedGroup,
    sentence: `Among members still subscribed through ${args.latest.label}, those whose ${args.signal.label} declined had ${declined} retained at ${outcomeLabel}, compared with ${steady}.`,
  };
}

function placeMember(
  membership: BehaviorMembership,
  period: { startDay: number; endDayExclusive: number },
  outcomeDay: number,
  nowMs: number
): "ignore" | "left" | "unknown" | "immature" | "eligible" {
  const startMs = membership.startMs + period.startDay * DAY_MS;
  const periodEndMs = membership.startMs + period.endDayExclusive * DAY_MS;
  if (nowMs < startMs) return "ignore";
  if (!membership.endKnown) return nowMs >= periodEndMs ? "unknown" : "ignore";
  if (
    !membership.open &&
    membership.endMs != null &&
    membership.endMs <= nowMs &&
    membership.endMs >= startMs &&
    membership.endMs < periodEndMs
  ) {
    return "left";
  }
  if (!completedWindow(membership, period, nowMs)) return "ignore";
  const outcome = subscriptionOutcome(membership, nowMs, outcomeDay);
  if (outcome === "immature") return "immature";
  if (outcome === "unknown") return "unknown";
  return "eligible";
}

function completedWindow(
  membership: BehaviorMembership,
  period: { startDay: number; endDayExclusive: number },
  nowMs: number
): boolean {
  if (!membership.endKnown) return false;
  const periodEndMs = membership.startMs + period.endDayExclusive * DAY_MS;
  if (nowMs < periodEndMs) return false;
  return membership.open || (membership.endMs != null && membership.endMs >= periodEndMs);
}

/** Same branches as outcomeAt. Immature is checked before an earlier end, so a future milestone is not churn. */
function subscriptionOutcome(
  membership: BehaviorMembership,
  nowMs: number,
  days: number
): "immature" | "unknown" | "retained" | "ended" | "rejoined" {
  const at = membership.startMs + days * DAY_MS;
  if (nowMs < at) return "immature";
  if (!membership.endKnown) return "unknown";
  if (membership.open || (membership.endMs != null && membership.endMs >= at)) return "retained";
  return membership.hasLater ? "rejoined" : "ended";
}

function windowBounds(
  membership: BehaviorMembership,
  period: { startDay: number; endDayExclusive: number }
): { startMs: number; endMs: number } {
  return {
    startMs: membership.startMs + period.startDay * DAY_MS,
    endMs: membership.startMs + period.endDayExclusive * DAY_MS,
  };
}

function windowTracked(
  membership: BehaviorMembership,
  period: { startDay: number },
  signal: ActivitySignal
): boolean {
  if (signal.trackedFromMs == null) return true;
  return membership.startMs + period.startDay * DAY_MS >= signal.trackedFromMs;
}

function trackingReason(signal: ActivitySignal): string {
  const when =
    signal.trackedFromMs == null
      ? "tracking began"
      : new Date(signal.trackedFromMs).toISOString().slice(0, 10);
  return `This window begins before ${when}. That is not zero activity.`;
}

function splitUsage(values: number[]): {
  median: number | null;
  frequentMin: number | null;
  positiveCount: number;
} {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (positive.length < 2) return { median: positive[0] ?? null, frequentMin: null, positiveCount: positive.length };
  const median = positive[Math.floor((positive.length - 1) / 2)];
  if (!positive.some((value) => value > median)) {
    return { median, frequentMin: null, positiveCount: positive.length };
  }
  return { median, frequentMin: median + 1, positiveCount: positive.length };
}

function definitionText(
  windowDays: number,
  unit: "days" | "events",
  median: number | null,
  frequentMin: number | null,
  positiveCount: number
): string {
  const noun = unit === "days" ? "UTC days" : "events";
  if (positiveCount === 0) {
    return `No member in this ${windowDays}-day window had activity, so frequent is not separated.`;
  }
  if (frequentMin == null) {
    return `In this ${windowDays}-day window, activity did not vary enough to separate a frequent group.`;
  }
  return `In this ${windowDays}-day window, frequent means more than the median ${noun} among members with activity (median ${median}).`;
}

function noneLabel(signal: ActivitySignal): string {
  return signal.unit === "days" ? "No activity (0 UTC days)" : "No activity (0)";
}

function someLabel(signal: ActivitySignal, frequentMin: number | null): string {
  if (frequentMin == null) {
    return signal.unit === "days" ? "Some (1 or more UTC days)" : "Some (1 or more)";
  }
  const span = frequentMin - 1 === 1 ? "1" : `1–${frequentMin - 1}`;
  return signal.unit === "days" ? `Some (${span} UTC days)` : `Some (${span})`;
}

function frequentLabel(signal: ActivitySignal, frequentMin: number): string {
  return signal.unit === "days"
    ? `Frequent (${frequentMin} or more UTC days)`
    : `Frequent (${frequentMin} or more)`;
}

function behaviorGroup(label: string, retainedFlags: boolean[]): BehaviorGroup {
  const eligible = retainedFlags.length;
  const retained = retainedFlags.filter(Boolean).length;
  return {
    label,
    retained,
    eligible,
    rate: eligible > 0 ? `${Math.round((100 * retained) / eligible)}%` : "Not available",
    small: eligible > 0 && eligible < SMALL_SAMPLE,
  };
}

function emptyGroup(label: string): BehaviorGroup {
  return { label, retained: 0, eligible: 0, rate: "Not available", small: false };
}
