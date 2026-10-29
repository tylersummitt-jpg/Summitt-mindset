/**
 * Subscription-age activity. A period is measured from the first paid start.
 * Activity at or after the membership end is left out.
 */

const DAY_MS = 86_400_000;
const MAX_PERIODS = 24;

/** First moment Victory Room visits and Film Room plays exist. */
export const V2_EVENT_TRACKING_START_MS = Date.parse("2026-10-28T00:00:00.000Z");

export type ActivityMembership = {
  clerkUserId: string;
  startMs: number;
  endMs: number | null;
  endKnown: boolean;
  open: boolean;
};

export type ActivityHit = {
  clerkUserId: string;
  atMs: number;
  signal: string;
};

export type ActivitySignal = {
  id: string;
  label: string;
  unit: "days" | "events";
  trackedFromMs: number | null;
};

export const ACTIVITY_SIGNALS: ActivitySignal[] = [
  { id: "coaching_reply", label: "Coach Pat reply days (UTC)", unit: "days", trackedFromMs: null },
  { id: "coaching", label: "Coaching text days (UTC)", unit: "days", trackedFromMs: null },
  {
    id: "victory_room_visited",
    label: "Victory Room visit days (UTC)",
    unit: "days",
    trackedFromMs: V2_EVENT_TRACKING_START_MS,
  },
  { id: "goal_win", label: "Goal Wins", unit: "events", trackedFromMs: null },
  { id: "proud_moment", label: "Proud Moments", unit: "events", trackedFromMs: null },
  { id: "ask_pat", label: "Ask Pat questions", unit: "events", trackedFromMs: null },
  {
    id: "film_room_played",
    label: "Film Room play days (UTC)",
    unit: "days",
    trackedFromMs: V2_EVENT_TRACKING_START_MS,
  },
  { id: "program_start", label: "Program starts", unit: "events", trackedFromMs: null },
  { id: "program_complete", label: "Program completions", unit: "events", trackedFromMs: null },
];

export type ActivityCell = {
  signalId: string;
  label: string;
  status: "ready" | "unavailable";
  eligible: number;
  used: number;
  total: number;
  average: string;
  warning: string | null;
};

export type ActivityPeriod = {
  label: string;
  status: "finished" | "in_progress";
  endedDuring: number;
  cells: ActivityCell[];
};

export type MemberActivity = {
  population: "Monthly" | "Annual";
  periods: ActivityPeriod[];
  notes: string[];
};

export function emptyMemberActivity(population: "Monthly" | "Annual"): MemberActivity {
  return { population, periods: [], notes: [] };
}

export function activityPeriod(index: number): {
  label: string;
  startDay: number;
  endDayExclusive: number;
} {
  if (index === 0) return { label: "Days 0–7", startDay: 0, endDayExclusive: 8 };
  if (index === 1) return { label: "Days 8–30", startDay: 8, endDayExclusive: 31 };
  const startDay = 31 + (index - 2) * 30;
  return {
    label: `Days ${startDay}–${startDay + 29}`,
    startDay,
    endDayExclusive: startDay + 30,
  };
}

export function unavailableActivitySignals(gaps: string[], engagementReadable: boolean): string[] {
  if (gaps.some((gap) => gap.includes("too large to read"))) {
    return ACTIVITY_SIGNALS.map((signal) => signal.id);
  }
  const ids = new Set<string>();
  for (const gap of gaps) {
    if (gap.startsWith("Coaching texts could not")) ids.add("coaching");
    if (gap.startsWith("Replies to morning or evening")) ids.add("coaching_reply");
    if (gap.startsWith("Ask Pat could not")) ids.add("ask_pat");
    if (gap.startsWith("Goal Wins and Proud Moments")) {
      ids.add("goal_win");
      ids.add("proud_moment");
    }
    if (gap.startsWith("Programs could not")) {
      ids.add("program_start");
      ids.add("program_complete");
    }
    if (gap.startsWith("Victory Room and Film Room could not")) {
      ids.add("victory_room_visited");
      ids.add("film_room_played");
    }
  }
  if (!engagementReadable && ids.size === 0) {
    return ACTIVITY_SIGNALS.map((signal) => signal.id);
  }
  return [...ids];
}

export function buildMemberActivity(args: {
  population: "Monthly" | "Annual";
  nowMs: number;
  memberships: ActivityMembership[];
  hits: ActivityHit[];
  unavailableSignalIds: string[];
}): MemberActivity {
  const notes = [
    args.population === "Monthly"
      ? "Monthly members. Annual members are in the section below."
      : "Annual members. These counts are not in the monthly activity above.",
    "The clock is the first paid membership. Activity after that membership ended is left out.",
    "A finished period includes only members who were still subscribed at the end of it. A membership with no reliable end time is left out. The current period is separate because it is not finished.",
    "Victory Room visits and Film Room plays start October 28, 2026. A period that begins before that is unavailable, not zero.",
    "Reply, coaching, Victory Room, and Film Room days are UTC calendar dates. Members who ended during a period are counted separately and are not treated as completing it.",
  ];
  const unavailable = new Set(args.unavailableSignalIds);
  const hitsByMember = new Map<string, ActivityHit[]>();
  for (const hit of args.hits) {
    const list = hitsByMember.get(hit.clerkUserId) ?? [];
    list.push(hit);
    hitsByMember.set(hit.clerkUserId, list);
  }
  const lastIndex = Math.min(MAX_PERIODS - 1, lastPeriodIndex(args.memberships, args.nowMs));
  const periods: ActivityPeriod[] = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    const period = activityPeriod(index);
    const finished = buildPeriod({
      period,
      status: "finished",
      nowMs: args.nowMs,
      memberships: args.memberships,
      hitsByMember,
      unavailable,
    });
    const current = buildPeriod({
      period,
      status: "in_progress",
      nowMs: args.nowMs,
      memberships: args.memberships,
      hitsByMember,
      unavailable,
    });
    if (finished) periods.push(finished);
    if (current) periods.push(current);
  }
  return { population: args.population, periods, notes };
}

export function formatMemberActivity(activity: MemberActivity): string[] {
  if (activity.periods.length === 0) {
    return [`${activity.population} activity over time: no finished or current period in this read.`];
  }
  const lines = [`${activity.population.toUpperCase()} ACTIVITY OVER TIME`];
  for (const note of activity.notes) lines.push(note);
  for (const period of activity.periods) {
    const state = period.status === "in_progress" ? "in progress" : "finished";
    lines.push(
      `${period.label}, ${state}. Members whose subscription ended during this period: ${period.endedDuring}.`
    );
    for (const cell of period.cells) {
      if (cell.status === "unavailable" && cell.eligible === 0 && !cell.warning) continue;
      if (cell.status === "unavailable") {
        lines.push(
          `${period.label}, ${state}. ${cell.label}: Unavailable.${cell.warning ? ` ${cell.warning}` : ""}`
        );
      } else {
        lines.push(
          `${period.label}, ${state}. ${cell.label}: ${cell.used} of ${cell.eligible} members. Total ${cell.total}. Average ${cell.average}.${cell.warning ? ` ${cell.warning}` : ""}`
        );
      }
    }
  }
  return lines;
}

function lastPeriodIndex(memberships: ActivityMembership[], nowMs: number): number {
  let maxDay = -1;
  for (const membership of memberships) {
    if (!membership.endKnown) continue;
    const end = membership.open ? nowMs : membership.endMs;
    if (end == null) continue;
    maxDay = Math.max(maxDay, Math.floor((end - membership.startMs) / DAY_MS));
  }
  if (maxDay < 0) return -1;
  for (let index = 0; index < MAX_PERIODS; index += 1) {
    const period = activityPeriod(index);
    if (period.startDay > maxDay) return index - 1;
  }
  return MAX_PERIODS - 1;
}

function buildPeriod(args: {
  period: { label: string; startDay: number; endDayExclusive: number };
  status: "finished" | "in_progress";
  nowMs: number;
  memberships: ActivityMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  unavailable: Set<string>;
}): ActivityPeriod | null {
  const endedDuring = endedDuringPeriod(args.memberships, args.period, args.status, args.nowMs);
  const cells = ACTIVITY_SIGNALS.map((signal) => buildCell({ ...args, signal }));
  if (cells.every((cell) => cell.eligible === 0 && cell.untracked === 0) && endedDuring === 0) {
    return null;
  }
  return {
    label: args.period.label,
    status: args.status,
    endedDuring,
    cells: cells.map(({ untracked: _untracked, ...cell }) => cell),
  };
}

function endedDuringPeriod(
  memberships: ActivityMembership[],
  period: { startDay: number; endDayExclusive: number },
  status: "finished" | "in_progress",
  nowMs: number
): number {
  let count = 0;
  for (const membership of memberships) {
    if (!membership.endKnown || membership.open || membership.endMs == null) continue;
    const startMs = membership.startMs + period.startDay * DAY_MS;
    const periodEndMs = membership.startMs + period.endDayExclusive * DAY_MS;
    if (membership.endMs < startMs || membership.endMs >= periodEndMs) continue;
    if (membership.endMs > nowMs) continue;
    const windowClosed = nowMs >= periodEndMs;
    if (status === "finished" && windowClosed) count += 1;
    if (status === "in_progress" && !windowClosed) count += 1;
  }
  return count;
}

function buildCell(args: {
  period: { label: string; startDay: number; endDayExclusive: number };
  status: "finished" | "in_progress";
  nowMs: number;
  memberships: ActivityMembership[];
  hitsByMember: Map<string, ActivityHit[]>;
  unavailable: Set<string>;
  signal: ActivitySignal;
}): ActivityCell & { untracked: number } {
  const readMissing = args.unavailable.has(args.signal.id);
  let eligible = 0;
  let untracked = 0;
  let used = 0;
  let total = 0;
  for (const membership of args.memberships) {
    const window = memberWindow(membership, args.period, args.status, args.nowMs);
    if (!window) continue;
    const tracked =
      args.signal.trackedFromMs == null || window.startMs >= args.signal.trackedFromMs;
    if (!tracked) {
      untracked += 1;
      continue;
    }
    eligible += 1;
    const usage = usageInWindow(
      args.hitsByMember.get(membership.clerkUserId) ?? [],
      args.signal,
      window.startMs,
      window.endMs,
      membership
    );
    total += usage;
    if (usage > 0) used += 1;
  }
  if (readMissing) {
    return {
      signalId: args.signal.id,
      label: args.signal.label,
      status: "unavailable",
      eligible,
      used: 0,
      total: 0,
      average: "Unavailable",
      warning: "This read did not finish. Missing rows are not zero.",
      untracked,
    };
  }
  if (eligible === 0) {
    return {
      signalId: args.signal.id,
      label: args.signal.label,
      status: "unavailable",
      eligible: 0,
      used: 0,
      total: 0,
      average: "Unavailable",
      warning:
        untracked > 0
          ? `${untracked} members are outside the tracked history. That is not zero use.`
          : null,
      untracked,
    };
  }
  return {
    signalId: args.signal.id,
    label: args.signal.label,
    status: "ready",
    eligible,
    used,
    total,
    average: (total / eligible).toFixed(1),
    warning: cellWarning(untracked, args.status),
    untracked,
  };
}

function cellWarning(untracked: number, status: "finished" | "in_progress"): string | null {
  const parts: string[] = [];
  if (untracked > 0) {
    parts.push(
      `${untracked} members are outside the tracked history and are not in these numbers.`
    );
  }
  if (status === "in_progress") parts.push("Still open. This is only the days so far.");
  return parts.length > 0 ? parts.join(" ") : null;
}

function memberWindow(
  membership: ActivityMembership,
  period: { startDay: number; endDayExclusive: number },
  status: "finished" | "in_progress",
  nowMs: number
): { startMs: number; endMs: number } | null {
  if (!membership.endKnown) return null;
  const startMs = membership.startMs + period.startDay * DAY_MS;
  const periodEndMs = membership.startMs + period.endDayExclusive * DAY_MS;
  if (status === "finished") {
    if (nowMs < periodEndMs) return null;
    if (membership.open || (membership.endMs != null && membership.endMs >= periodEndMs)) {
      return { startMs, endMs: periodEndMs };
    }
    return null;
  }
  if (!membership.open) return null;
  if (nowMs < startMs || nowMs >= periodEndMs) return null;
  return { startMs, endMs: nowMs };
}

export function usageInWindow(
  hits: ActivityHit[],
  signal: ActivitySignal,
  startMs: number,
  endMs: number,
  membership: ActivityMembership
): number {
  const days = new Set<string>();
  let events = 0;
  for (const hit of hits) {
    if (hit.signal !== signal.id) continue;
    if (hit.atMs < startMs || hit.atMs >= endMs) continue;
    if (hit.atMs < membership.startMs) continue;
    if (!membership.open && membership.endMs != null && hit.atMs >= membership.endMs) continue;
    if (signal.unit === "days") {
      days.add(new Date(hit.atMs).toISOString().slice(0, 10));
    } else {
      events += 1;
    }
  }
  return signal.unit === "days" ? days.size : events;
}
