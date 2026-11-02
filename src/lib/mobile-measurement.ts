/**
 * Aggregate mobile facts for the retention report.
 * Durations are measured on the device. This module does not invent them.
 */

export const ENGAGEMENT_EVENT_TYPES = [
  "victory_room_visited",
  "film_room_played",
  "member_surface_visited",
] as const;

export const TIMING_EVENT_TYPES = ["native_launch_measured", "screen_load_measured"] as const;

/** Victory Room visits and Film Room plays exist from this instant. */
export const EXPERIENCE_TRACKING_START_MS = Date.parse("2026-10-28T00:00:00.000Z");
/** Surface visits exist from this instant. */
export const SURFACE_TRACKING_START_MS = Date.parse("2026-10-31T00:00:00.000Z");

/** A visible wait this long without a usable screen is a recorded stall. */
export const SCREEN_READY_TIMEOUT_MS = 20_000;
/** Longer than this is not a clean measured duration. */
export const MAX_MEASURED_MS = 120_000;

export const MEASURED_PLATFORMS = ["ios", "android", "web", "unknown"] as const;
export type MeasuredPlatform = (typeof MEASURED_PLATFORMS)[number];

export const NAVIGATION_SURFACES = ["victory_room", "ask_pat", "film_room", "programs"] as const;
export type NavigationSurface = (typeof NAVIGATION_SURFACES)[number];

export const VISIT_SURFACES = ["dashboard", "ask_pat", "film_room", "programs"] as const;
export type VisitSurface = (typeof VISIT_SURFACES)[number];

const MEASUREMENT_ID = /^[A-Za-z0-9_-]{8,80}$/;

export type StartupDecision =
  | { action: "record"; elapsedMs: number }
  | { action: "drop" }
  | { action: "ignore" };

export function classifyMeasuredPlatform(value: unknown): MeasuredPlatform {
  if (value === "ios" || value === "android" || value === "web") return value;
  return "unknown";
}

export function isNavigationSurface(value: unknown): value is NavigationSurface {
  return typeof value === "string" && (NAVIGATION_SURFACES as readonly string[]).includes(value);
}

export function isVisitSurface(value: unknown): value is VisitSurface {
  return typeof value === "string" && (VISIT_SURFACES as readonly string[]).includes(value);
}

export function navigationSurfaceFromPath(path: string): NavigationSurface | null {
  const clean = path.split("?")[0]?.split("#")[0] ?? "";
  if (clean === "/dashboard/victory-room" || clean.startsWith("/dashboard/victory-room/")) {
    return "victory_room";
  }
  if (clean === "/ask-pat" || clean.startsWith("/ask-pat/")) return "ask_pat";
  if (clean === "/film-room" || clean.startsWith("/film-room/")) return "film_room";
  if (clean === "/programs" || clean.startsWith("/programs/")) return "programs";
  return null;
}

/**
 * Cold and warm startup are recorded only for a fresh native duration that
 * ends on a usable Victory Room. Interactive sign-in, a hidden page, a missing
 * native clock, and an implausibly long duration are not successes and not failures.
 */
export function classifyStartup(args: {
  interactiveAuth: boolean;
  hidden: boolean;
  kind: unknown;
  elapsedMs: unknown;
}): StartupDecision {
  if (args.hidden) return { action: "ignore" };
  if (args.kind !== "cold" && args.kind !== "warm") return { action: "ignore" };
  if (args.interactiveAuth) return { action: "drop" };
  if (typeof args.elapsedMs !== "number" || !Number.isInteger(args.elapsedMs)) return { action: "drop" };
  if (args.elapsedMs < 0 || args.elapsedMs > MAX_MEASURED_MS) return { action: "drop" };
  return { action: "record", elapsedMs: args.elapsedMs };
}

export function classifyNavigation(args: {
  hidden: boolean;
  elapsedMs: number;
}): StartupDecision {
  if (args.hidden) return { action: "ignore" };
  if (!Number.isInteger(args.elapsedMs) || args.elapsedMs < 0 || args.elapsedMs > MAX_MEASURED_MS) {
    return { action: "drop" };
  }
  return { action: "record", elapsedMs: args.elapsedMs };
}

export function shouldRecordStall(args: { hidden: boolean; superseded: boolean }): boolean {
  return !args.hidden && !args.superseded;
}

export function validMeasurementId(value: unknown): value is string {
  return typeof value === "string" && MEASUREMENT_ID.test(value);
}

export type MeasurementRecord = "startup" | "navigation" | "startup_failed" | "navigation_failed";

export function measurementIdempotencyKey(args: {
  clerkUserId: string;
  measurementId: string;
  record: MeasurementRecord;
}): string {
  return `app_measurement:${args.record}:${encodeURIComponent(args.clerkUserId)}:${encodeURIComponent(args.measurementId)}`;
}

export function measurementEventType(record: MeasurementRecord): (typeof TIMING_EVENT_TYPES)[number] {
  return record === "startup" || record === "startup_failed"
    ? "native_launch_measured"
    : "screen_load_measured";
}

export type MobileActivityRow = {
  clerkUserId: string;
  atMs: number;
  signal: "victory_room" | "film_play" | "surface";
  platform: MeasuredPlatform;
  surface: VisitSurface | null;
};

export type MobileTimingRow = {
  clerkUserId: string;
  atMs: number;
  platform: MeasuredPlatform;
  outcome: "ready" | "failed";
  launchKind: "cold" | "warm" | "navigation";
  surface: NavigationSurface;
  elapsedMs: number | null;
};

export function activityRowFromEvent(row: {
  clerkUserId: string | null;
  atMs: number | null;
  eventType: string | null;
  payload: unknown;
}): MobileActivityRow | null {
  if (!row.clerkUserId || row.atMs == null) return null;
  const payload = payloadObject(row.payload);
  const platform = classifyMeasuredPlatform(payload?.platform);
  if (row.eventType === "victory_room_visited") {
    return { clerkUserId: row.clerkUserId, atMs: row.atMs, signal: "victory_room", platform, surface: null };
  }
  if (row.eventType === "film_room_played") {
    return { clerkUserId: row.clerkUserId, atMs: row.atMs, signal: "film_play", platform, surface: null };
  }
  if (row.eventType === "member_surface_visited" && isVisitSurface(payload?.surface)) {
    return {
      clerkUserId: row.clerkUserId,
      atMs: row.atMs,
      signal: "surface",
      platform,
      surface: payload.surface,
    };
  }
  return null;
}

export function timingRowFromEvent(row: {
  clerkUserId: string | null;
  atMs: number | null;
  eventType: string | null;
  payload: unknown;
}): MobileTimingRow | null {
  if (!row.clerkUserId || row.atMs == null) return null;
  if (row.eventType !== "native_launch_measured" && row.eventType !== "screen_load_measured") return null;
  const payload = payloadObject(row.payload);
  if (!payload) return null;
  const outcome = payload.outcome === "ready" || payload.outcome === "failed" ? payload.outcome : null;
  const launchKind =
    payload.launchKind === "cold" || payload.launchKind === "warm" || payload.launchKind === "navigation"
      ? payload.launchKind
      : null;
  if (!outcome || !launchKind || !isNavigationSurface(payload.surface)) return null;
  if (row.eventType === "native_launch_measured" && launchKind === "navigation") return null;
  if (row.eventType === "screen_load_measured" && launchKind !== "navigation") return null;
  const elapsedMs =
    typeof payload.elapsedMs === "number" && Number.isInteger(payload.elapsedMs) ? payload.elapsedMs : null;
  if (outcome === "ready" && (elapsedMs == null || elapsedMs < 0 || elapsedMs > MAX_MEASURED_MS)) return null;
  if (outcome === "failed" && elapsedMs != null) return null;
  return {
    clerkUserId: row.clerkUserId,
    atMs: row.atMs,
    platform: classifyMeasuredPlatform(payload.platform),
    outcome,
    launchKind,
    surface: payload.surface,
    elapsedMs: outcome === "ready" ? elapsedMs : null,
  };
}

export type PlatformCount = {
  platform: MeasuredPlatform;
  members: number;
  records: number;
};

export type DurationFact = {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
};

export type NavigationFact = {
  surface: NavigationSurface;
  platform: MeasuredPlatform;
  duration: DurationFact;
  failures: number;
};

export type NativeStartupFacts = {
  ios: DurationFact;
  android: DurationFact;
};

export type MobilePopulationFacts = {
  population: "Monthly" | "Annual";
  engagementStatus: "ready" | "unavailable" | "not_in_report";
  timingStatus: "ready" | "unavailable" | "not_in_report";
  victoryRoom: PlatformCount[];
  filmPlays: PlatformCount[];
  surfaces: Array<{ surface: VisitSurface; counts: PlatformCount[] }>;
  cold: NativeStartupFacts;
  warm: NativeStartupFacts;
  startupFailures: { ios: number; android: number } | null;
  navigation: NavigationFact[];
};

type CoveredSpell = {
  clerkUserId: string | null;
  paidStartMs: number;
  endedAtMs: number | null;
  endKnown: boolean;
  open: boolean;
};

export function buildMobilePopulationFacts(args: {
  population: "Monthly" | "Annual";
  nowMs: number;
  spells: CoveredSpell[];
  activity: MobileActivityRow[] | null | undefined;
  timing: MobileTimingRow[] | null | undefined;
}): MobilePopulationFacts {
  const engagementStatus = readStatus(args.activity);
  const timingStatus = readStatus(args.timing);
  const covered = coveredEvents(args.spells, args.nowMs);
  const activity = (args.activity ?? []).filter((row) => covered(row.clerkUserId, row.atMs));
  const timing = (args.timing ?? []).filter((row) => covered(row.clerkUserId, row.atMs));
  const startupFailureCount = (platform: "ios" | "android") =>
    timing.filter(
      (row) =>
        row.outcome === "failed" &&
        (row.launchKind === "cold" || row.launchKind === "warm") &&
        row.platform === platform
    ).length;
  return {
    population: args.population,
    engagementStatus,
    timingStatus,
    victoryRoom: countPlatforms(activity.filter((row) => row.signal === "victory_room")),
    filmPlays: countPlatforms(activity.filter((row) => row.signal === "film_play")),
    surfaces: VISIT_SURFACES.map((surface) => ({
      surface,
      counts: countPlatforms(activity.filter((row) => row.signal === "surface" && row.surface === surface)),
    })),
    cold: nativeStartup(timing, "cold"),
    warm: nativeStartup(timing, "warm"),
    startupFailures:
      timingStatus === "ready"
        ? { ios: startupFailureCount("ios"), android: startupFailureCount("android") }
        : null,
    navigation: NAVIGATION_SURFACES.flatMap((surface) =>
      MEASURED_PLATFORMS.map((platform) => ({
        surface,
        platform,
        duration: summarizeDurations(
          timing
            .filter(
              (row) =>
                row.outcome === "ready" &&
                row.launchKind === "navigation" &&
                row.surface === surface &&
                row.platform === platform
            )
            .map((row) => row.elapsedMs ?? 0)
        ),
        failures: timing.filter(
          (row) =>
            row.outcome === "failed" &&
            row.launchKind === "navigation" &&
            row.surface === surface &&
            row.platform === platform
        ).length,
      }))
    ),
  };
}

export function mobileFactsNotInReport(population: "Monthly" | "Annual"): MobilePopulationFacts {
  return buildMobilePopulationFacts({
    population,
    nowMs: 0,
    spells: [],
    activity: undefined,
    timing: undefined,
  });
}

export function summarizeDurations(values: number[]): DurationFact {
  if (values.length === 0) return { count: 0, medianMs: null, p95Ms: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  const rank = Math.ceil(0.95 * sorted.length);
  const p95 = sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
  return { count: sorted.length, medianMs: median ?? null, p95Ms: p95 };
}

export function formatMobilePopulation(facts: MobilePopulationFacts): string[] {
  const lines = [`${facts.population.toUpperCase()} MOBILE FACTS`];
  lines.push(
    "Recorded interactions are not native app launches, sessions, or time spent. A duration is included only when a device clock measured a usable screen. These facts do not show that a screen or a speed caused someone to stay."
  );
  if (facts.engagementStatus === "not_in_report" && facts.timingStatus === "not_in_report") {
    lines.push("Mobile facts were not part of this saved report. That is not zero.");
    return lines;
  }
  lines.push(...formatEngagement(facts));
  lines.push(...formatTiming(facts));
  return lines;
}

const PLATFORM_LABEL: Record<MeasuredPlatform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  unknown: "Unknown platform",
};

const SURFACE_LABEL: Record<VisitSurface | NavigationSurface, string> = {
  dashboard: "Dashboard",
  victory_room: "Victory Room",
  ask_pat: "Ask Pat",
  film_room: "Film Room",
  programs: "Programs",
};

function formatEngagement(facts: MobilePopulationFacts): string[] {
  if (facts.engagementStatus === "not_in_report") {
    return ["Recorded engagement by platform was not part of this saved report. That is not zero."];
  }
  if (facts.engagementStatus === "unavailable") {
    return ["Recorded engagement by platform is unavailable. The event read did not finish. That is not zero."];
  }
  const lines = [
    "Victory Room and Film Room records start October 28, 2026. Each is the first platform stored for that member that local day. A later platform the same day was not stored. Surface visits start October 31, 2026. A surface visit can store iOS, Android, and web separately on the same day. Days before those dates are not in these counts.",
  ];
  lines.push(`Victory Room records. ${formatCounts(facts.victoryRoom)}`);
  lines.push(`Film Room play records. ${formatCounts(facts.filmPlays)}`);
  for (const surface of facts.surfaces) {
    lines.push(`${SURFACE_LABEL[surface.surface]} visits. ${formatCounts(surface.counts)}`);
  }
  return lines;
}

function formatTiming(facts: MobilePopulationFacts): string[] {
  if (facts.timingStatus === "not_in_report") {
    return ["Startup and screen timing were not part of this saved report. That is not zero."];
  }
  if (facts.timingStatus === "unavailable") {
    return ["Startup and screen timing are unavailable. The timing read did not finish. That is not zero."];
  }
  const lines = [
    "Cold startup is monotonic time from the native process start until Victory Room with an active commitment has painted, minus time the app was backgrounded. The app still opens on the sign-in route, so an already signed-in redirect is included. Time spent submitting sign-in is excluded. Warm resume is monotonic time from returning to the foreground until that same room is usable. iOS uses system uptime. Android uses elapsed realtime. Both subtract background time.",
    `A stall is a visible wait past ${SCREEN_READY_TIMEOUT_MS / 1000} seconds. A hidden page, a canceled tap, and a native error screen that never loaded the site are not stalls. Missing measurements are not successes.`,
    `Cold startup to usable Victory Room. ${formatNativeStartup(facts.cold)}`,
    `Warm resume to usable Victory Room. ${formatNativeStartup(facts.warm)}`,
    `Recorded startup stalls. iOS ${facts.startupFailures?.ios ?? 0}. Android ${facts.startupFailures?.android ?? 0}. A startup row without an iOS or Android platform is left out of these medians and stall counts.`,
  ];
  for (const surface of NAVIGATION_SURFACES) {
    const rows = facts.navigation.filter((row) => row.surface === surface && (row.duration.count > 0 || row.failures > 0));
    if (rows.length === 0) {
      lines.push(
        `${SURFACE_LABEL[surface]} navigation. No measured loads in this read. That is not zero use.`
      );
      continue;
    }
    lines.push(
      `${SURFACE_LABEL[surface]} navigation. ${rows
        .map((row) => `${PLATFORM_LABEL[row.platform]} ${formatDuration(row.duration)} Stalls ${row.failures}.`)
        .join(" ")}`
    );
  }
  return lines;
}

function formatCounts(counts: PlatformCount[]): string {
  return counts
    .map((count) => `${PLATFORM_LABEL[count.platform]}: ${count.members} members, ${count.records} records`)
    .join(". ");
}

function nativeStartup(timing: MobileTimingRow[], kind: "cold" | "warm"): NativeStartupFacts {
  const durations = (platform: "ios" | "android") =>
    summarizeDurations(
      timing
        .filter(
          (row) =>
            row.outcome === "ready" &&
            row.launchKind === kind &&
            row.surface === "victory_room" &&
            row.platform === platform
        )
        .map((row) => row.elapsedMs ?? 0)
    );
  return { ios: durations("ios"), android: durations("android") };
}

function formatNativeStartup(facts: NativeStartupFacts): string {
  return `iOS ${formatDuration(facts.ios)} Android ${formatDuration(facts.android)}`;
}

function formatDuration(fact: DurationFact): string {
  if (fact.count === 0 || fact.medianMs == null || fact.p95Ms == null) {
    return "No measured durations in this read. That is not zero use.";
  }
  return `median ${fact.medianMs} ms, p95 ${fact.p95Ms} ms, ${fact.count} measured.`;
}

function countPlatforms(rows: MobileActivityRow[]): PlatformCount[] {
  return MEASURED_PLATFORMS.map((platform) => {
    const matching = rows.filter((row) => row.platform === platform);
    const members = new Set(matching.map((row) => row.clerkUserId));
    return { platform, members: members.size, records: matching.length };
  });
}

function readStatus(
  rows: unknown[] | null | undefined
): "ready" | "unavailable" | "not_in_report" {
  if (rows === undefined) return "not_in_report";
  if (rows === null) return "unavailable";
  return "ready";
}

function coveredEvents(spells: CoveredSpell[], nowMs: number) {
  return (clerkUserId: string, atMs: number) =>
    spells.some((spell) => {
      if (spell.clerkUserId !== clerkUserId || !spell.endKnown) return false;
      if (atMs < spell.paidStartMs) return false;
      if (spell.open) return atMs <= nowMs;
      return spell.endedAtMs != null && atMs < spell.endedAtMs;
    });
}

function payloadObject(value: unknown): {
  platform?: unknown;
  surface?: unknown;
  outcome?: unknown;
  launchKind?: unknown;
  elapsedMs?: unknown;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as {
    platform?: unknown;
    surface?: unknown;
    outcome?: unknown;
    launchKind?: unknown;
    elapsedMs?: unknown;
  };
}
