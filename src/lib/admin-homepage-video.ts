import {
  clerkUserIdFromStripeSub,
  conversionRate,
  isLikelySummittStripeSubscription,
  paidConversionUnix,
  type GrowthStripeSubscription,
  type GrowthTrafficSource,
  type MarketingAttributionRow,
  type MetricNumber,
} from "@/lib/admin-subscriber-growth-pure";
import { parseVimeoVideoId } from "@/lib/homepage-video";
import { attributionMatchesDashboardSource } from "@/lib/marketing-attribution-pure";

const HOMEPAGE_VIDEO_REACHED = "homepage_video_reached";
const HOMEPAGE_VIDEO_OUTCOME_EVENT_TYPES = [
  "homepage_video_started",
  "homepage_video_50",
  "homepage_video_completed",
  "trial_cta_clicked",
] as const;

export type HomepageVideoScopedQuery = {
  eventTypes: readonly string[];
  startMs: number | null;
  endMs: number;
  visitorIds: readonly string[] | null;
};

export type HomepageVideoEventInput = {
  event_type: string;
  visitor_id: string;
  occurred_at: string;
  source_normalized: string | null;
  path?: string | null;
  metadata?: { vimeo_video_id?: unknown; cta_surface?: unknown } | null;
};

export type HomepageVideoReport = {
  available: boolean;
  reached: MetricNumber;
  started: MetricNumber;
  watched50: MetricNumber;
  completed: MetricNumber;
  startRate: MetricNumber;
  watched50Rate: MetricNumber;
  completionRate: MetricNumber;
  videoCtaAfter50: MetricNumber;
  videoCtaRate: MetricNumber;
  anyCtaAfter50: MetricNumber;
  anyCtaRate: MetricNumber;
  stripeTrialsAfter50: MetricNumber;
  trialRate: MetricNumber;
  stripePaidAfter50: MetricNumber;
  paidRate: MetricNumber;
};

type CohortPair = { visitorId: string; videoId: string };

export function emptyHomepageVideoReport(): HomepageVideoReport {
  return {
    available: false,
    reached: null,
    started: null,
    watched50: null,
    completed: null,
    startRate: null,
    watched50Rate: null,
    completionRate: null,
    videoCtaAfter50: null,
    videoCtaRate: null,
    anyCtaAfter50: null,
    anyCtaRate: null,
    stripeTrialsAfter50: null,
    trialRate: null,
    stripePaidAfter50: null,
    paidRate: null,
  };
}

function occurredMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function videoIdOf(event: HomepageVideoEventInput): string | null {
  return parseVimeoVideoId(event.metadata?.vimeo_video_id);
}

function pairKey(visitorId: string, videoId: string): string {
  return `${visitorId}\n${videoId}`;
}

function clerksForVisitors(
  attributions: MarketingAttributionRow[]
): Map<string, string[]> {
  const clerksByVisitor = new Map<string, string[]>();
  for (const row of attributions) {
    const visitorId = row.visitor_id?.trim();
    const clerkId = row.clerk_user_id?.trim();
    if (!visitorId || !clerkId) continue;
    const list = clerksByVisitor.get(visitorId) ?? [];
    if (!list.includes(clerkId)) list.push(clerkId);
    clerksByVisitor.set(visitorId, list);
  }
  return clerksByVisitor;
}

function visitorsForPairs(
  keys: Iterable<string>,
  cohort: ReadonlyMap<string, CohortPair>
): Set<string> {
  const visitors = new Set<string>();
  for (const key of keys) {
    const pair = cohort.get(key);
    if (pair) visitors.add(pair.visitorId);
  }
  return visitors;
}

export function computeHomepageVideoReport(args: {
  events: HomepageVideoEventInput[] | null;
  windowStartMs: number | null;
  windowEndMs: number;
  source: GrowthTrafficSource;
  attributions: MarketingAttributionRow[];
  attributionComplete: boolean;
  stripeSubs: GrowthStripeSubscription[];
  stripeListComplete: boolean;
  recognizedPriceIds: ReadonlySet<string>;
  paidInvoiceSubIds: ReadonlySet<string>;
}): HomepageVideoReport {
  const empty = emptyHomepageVideoReport();
  if (!args.events) return empty;

  const stripeReady = args.stripeListComplete && args.attributionComplete;
  const cohort = new Map<string, CohortPair>();
  for (const event of args.events) {
    if (event.event_type !== "homepage_video_reached") continue;
    const at = occurredMs(event.occurred_at);
    const videoId = videoIdOf(event);
    if (at == null || !videoId || !event.visitor_id) continue;
    if (args.windowStartMs != null && at < args.windowStartMs) continue;
    if (at >= args.windowEndMs) continue;
    if (!attributionMatchesDashboardSource(event.source_normalized, args.source)) continue;
    cohort.set(pairKey(event.visitor_id, videoId), {
      visitorId: event.visitor_id,
      videoId,
    });
  }

  const startedPairs = new Set<string>();
  const watchedPairs = new Set<string>();
  const completedPairs = new Set<string>();
  const t50ByPair = new Map<string, number>();

  for (const event of args.events) {
    const videoId = videoIdOf(event);
    if (!videoId || !event.visitor_id) continue;
    const key = pairKey(event.visitor_id, videoId);
    if (!cohort.has(key)) continue;
    const at = occurredMs(event.occurred_at);
    if (at == null) continue;
    if (event.event_type === "homepage_video_started") startedPairs.add(key);
    if (event.event_type === "homepage_video_50") {
      watchedPairs.add(key);
      const prev = t50ByPair.get(key);
      if (prev == null || at < prev) t50ByPair.set(key, at);
    }
    if (event.event_type === "homepage_video_completed") completedPairs.add(key);
  }

  const videoCta = new Set<string>();
  const anyCta = new Set<string>();
  for (const key of watchedPairs) {
    const pair = cohort.get(key);
    const t50 = t50ByPair.get(key);
    if (!pair || t50 == null) continue;
    for (const event of args.events) {
      if (event.event_type !== "trial_cta_clicked") continue;
      if (event.visitor_id !== pair.visitorId) continue;
      const at = occurredMs(event.occurred_at);
      if (at == null || at < t50) continue;
      anyCta.add(pair.visitorId);
      if (event.metadata?.cta_surface === "homepage_video") videoCta.add(pair.visitorId);
    }
  }

  let stripeTrialsAfter50: MetricNumber = null;
  let stripePaidAfter50: MetricNumber = null;
  if (stripeReady) {
    const clerksByVisitor = clerksForVisitors(args.attributions);
    const trialClerks = new Set<string>();
    const paidClerks = new Set<string>();
    for (const key of watchedPairs) {
      const pair = cohort.get(key);
      const t50 = t50ByPair.get(key);
      if (!pair || t50 == null) continue;
      const clerks = clerksByVisitor.get(pair.visitorId);
      if (!clerks) continue;
      const floorSec = Math.floor(t50 / 1000);
      for (const clerk of clerks) {
        for (const sub of args.stripeSubs) {
          if (!isLikelySummittStripeSubscription(sub, args.recognizedPriceIds)) continue;
          if (clerkUserIdFromStripeSub(sub) !== clerk) continue;
          if (sub.trial_start != null && sub.trial_start >= floorSec) {
            trialClerks.add(clerk);
          }
          const paidAt = paidConversionUnix(sub, args.paidInvoiceSubIds.has(sub.id));
          if (paidAt != null && paidAt >= floorSec) paidClerks.add(clerk);
        }
      }
    }
    stripeTrialsAfter50 = trialClerks.size;
    stripePaidAfter50 = paidClerks.size;
  }

  const reachedVisitors = visitorsForPairs(cohort.keys(), cohort);
  const startedVisitors = visitorsForPairs(startedPairs, cohort);
  const watchedVisitors = visitorsForPairs(watchedPairs, cohort);
  const completedVisitors = visitorsForPairs(completedPairs, cohort);
  const reachedCount = reachedVisitors.size;
  const startedCount = startedVisitors.size;
  const watchedCount = watchedVisitors.size;
  const completedCount = completedVisitors.size;

  return {
    available: true,
    reached: reachedCount,
    started: startedCount,
    watched50: watchedCount,
    completed: completedCount,
    startRate: conversionRate(startedCount, reachedCount),
    watched50Rate: conversionRate(watchedCount, reachedCount),
    completionRate: conversionRate(completedCount, reachedCount),
    videoCtaAfter50: videoCta.size,
    videoCtaRate: conversionRate(videoCta.size, watchedCount),
    anyCtaAfter50: anyCta.size,
    anyCtaRate: conversionRate(anyCta.size, watchedCount),
    stripeTrialsAfter50,
    trialRate: conversionRate(stripeTrialsAfter50, watchedCount),
    stripePaidAfter50,
    paidRate: conversionRate(stripePaidAfter50, watchedCount),
  };
}

/**
 * Reached rows inside the dashboard window define the cohort.
 * Starts, halfway, finishes, and CTA clicks for those visitors have no
 * lower time bound: the only stored milestone can precede Reached.
 * An incomplete read returns null so the report stays unavailable.
 */
export async function loadHomepageVideoCohortEvents(args: {
  windowStartMs: number | null;
  windowEndMs: number;
  outcomeEndMs: number;
  source: GrowthTrafficSource;
  query: (
    scoped: HomepageVideoScopedQuery
  ) => Promise<{ rows: HomepageVideoEventInput[]; complete: boolean }>;
}): Promise<HomepageVideoEventInput[] | null> {
  const reached = await args.query({
    eventTypes: [HOMEPAGE_VIDEO_REACHED],
    startMs: args.windowStartMs,
    endMs: args.windowEndMs,
    visitorIds: null,
  });
  if (!reached.complete) return null;

  const cohortRows: HomepageVideoEventInput[] = [];
  const visitorIds: string[] = [];
  const seenVisitors = new Set<string>();
  for (const row of reached.rows) {
    if (row.event_type !== HOMEPAGE_VIDEO_REACHED || !row.visitor_id) continue;
    if (!attributionMatchesDashboardSource(row.source_normalized, args.source)) continue;
    cohortRows.push(row);
    if (seenVisitors.has(row.visitor_id)) continue;
    seenVisitors.add(row.visitor_id);
    visitorIds.push(row.visitor_id);
  }
  if (visitorIds.length === 0) return cohortRows;

  const outcomes = await args.query({
    eventTypes: HOMEPAGE_VIDEO_OUTCOME_EVENT_TYPES,
    startMs: null,
    endMs: args.outcomeEndMs,
    visitorIds,
  });
  if (!outcomes.complete) return null;
  return [...cohortRows, ...outcomes.rows];
}
