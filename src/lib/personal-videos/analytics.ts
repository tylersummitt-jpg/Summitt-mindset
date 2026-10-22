import { becamePaidAfterTrial, paidConversionUnix, type GrowthStripeSubscription } from "@/lib/admin-subscriber-growth-pure";

export const PERSONAL_VIDEO_EVENT_TYPES = [
  "personal_video_visited",
  "personal_video_played",
  "personal_video_cta_clicked",
] as const;

export type PersonalVideoEventType = (typeof PERSONAL_VIDEO_EVENT_TYPES)[number];

export const PERSONAL_VIDEO_METADATA_KEY = "personalVideoId";
export const PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const VIDEO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersonalVideoEventType(value: unknown): value is PersonalVideoEventType {
  return typeof value === "string" && (PERSONAL_VIDEO_EVENT_TYPES as readonly string[]).includes(value);
}

export function parsePersonalVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return VIDEO_ID_RE.test(id) ? id : null;
}

export function isPersonalVideoWatchPath(pathname: string): boolean {
  return /^\/for\/[A-Za-z0-9_-]{32,80}$/.test(pathname);
}

export type PersonalVideoVisitCandidate = {
  personalVideoId: string;
  occurredAtMs: number;
  eventId: string;
};

/** Latest ready-video visit in the 30 days before checkout. Ties use the later event id. */
export function selectLatestPersonalVideoVisit(
  visits: readonly PersonalVideoVisitCandidate[],
  nowMs: number,
  readyIds: ReadonlySet<string>
): string | null {
  const cutoff = nowMs - PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS;
  const eligible = visits.filter(
    (visit) =>
      readyIds.has(visit.personalVideoId) &&
      visit.occurredAtMs >= cutoff &&
      visit.occurredAtMs <= nowMs
  );
  eligible.sort((a, b) => {
    if (a.occurredAtMs !== b.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
    return b.eventId.localeCompare(a.eventId);
  });
  return eligible[0]?.personalVideoId ?? null;
}

export type PersonalVideoEngagement = {
  personalVideoId: string;
  visitorId: string;
  eventType: PersonalVideoEventType;
};

export type PersonalVideoReportVideo = {
  id: string;
  createdAt: string;
  linkSentAt: string | null;
};

export type PersonalVideoReportRow = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  visitors: number | null;
  plays: number | null;
  ctaClicks: number | null;
  trials: number | null;
  paid: number | null;
};

export type PersonalVideoDistribution = {
  readable: boolean;
  eventsReadable: boolean;
  billingReadable: boolean;
  linksSent: number | null;
  linksVisited: number | null;
  linkVisitRate: string;
  uniqueVisitors: string;
  plays: string;
  ctaClicks: string;
  trials: string;
  paid: string;
  playRate: string;
  ctaRate: string;
  trialRate: string;
  paidRate: string;
  rows: PersonalVideoReportRow[];
  note: string;
};

export function unreadablePersonalVideoDistribution(note: string): PersonalVideoDistribution {
  return {
    readable: false,
    eventsReadable: false,
    billingReadable: false,
    linksSent: null,
    linksVisited: null,
    linkVisitRate: "Not available",
    uniqueVisitors: "Not available",
    plays: "Not available",
    ctaClicks: "Not available",
    trials: "Not available",
    paid: "Not available",
    playRate: "Not available",
    ctaRate: "Not available",
    trialRate: "Not available",
    paidRate: "Not available",
    rows: [],
    note,
  };
}

function personalVideoHasConfirmedPayment(
  sub: GrowthStripeSubscription,
  hadPaidInvoice: boolean
): boolean {
  if (!hadPaidInvoice) return false;
  if (sub.trial_end != null) return becamePaidAfterTrial(sub, true);
  return paidConversionUnix(sub, true) != null;
}

function countText(value: number | null): string {
  return value == null ? "Not available" : String(value);
}

export function formatStageRate(numerator: number | null, denominator: number | null, denominatorLabel: string): string {
  if (numerator == null || denominator == null) return "Not available";
  if (denominator === 0) return `— (no ${denominatorLabel})`;
  const pct = Math.round((numerator / denominator) * 1000) / 10;
  return `${pct}% (${numerator} / ${denominator} ${denominatorLabel})`;
}

function uniqueVisitors(events: readonly PersonalVideoEngagement[], videoId: string, eventType: PersonalVideoEventType): number {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.personalVideoId === videoId && event.eventType === eventType && event.visitorId) {
      ids.add(event.visitorId);
    }
  }
  return ids.size;
}

export function buildPersonalVideoDistribution(args: {
  videos: readonly PersonalVideoReportVideo[];
  events: readonly PersonalVideoEngagement[] | null;
  subscriptions: readonly GrowthStripeSubscription[] | null;
  subscriptionsComplete: boolean;
  /**
   * True only when paidInvoiceSubIds is a complete read for these subscriptions.
   * Missing invoice evidence stays unavailable. It is not zero paid.
   */
  paymentsReadable?: boolean;
  paidInvoiceSubIds?: ReadonlySet<string>;
}): PersonalVideoDistribution {
  const known = new Set(args.videos.map((video) => video.id));
  const events = args.events?.filter((event) => known.has(event.personalVideoId)) ?? null;
  const billingReady = args.subscriptionsComplete && args.subscriptions != null;
  const paymentsReadable = billingReady && args.paymentsReadable === true;
  const paidInvoiceSubIds = args.paidInvoiceSubIds ?? new Set<string>();
  const subs = billingReady
    ? args.subscriptions!.filter((sub) => {
        const id = parsePersonalVideoId(sub.metadata?.[PERSONAL_VIDEO_METADATA_KEY]);
        return id != null && known.has(id);
      })
    : [];

  const rows = [...args.videos]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((video) => {
      const mine = subs.filter(
        (sub) => parsePersonalVideoId(sub.metadata?.[PERSONAL_VIDEO_METADATA_KEY]) === video.id
      );
      const trials = mine.filter((sub) => sub.trial_start != null).length;
      const paid = paymentsReadable
        ? mine.filter((sub) => personalVideoHasConfirmedPayment(sub, paidInvoiceSubIds.has(sub.id))).length
        : null;
      return {
        id: video.id,
        createdAt: video.createdAt,
        sentAt: video.linkSentAt,
        visitors: events ? uniqueVisitors(events, video.id, "personal_video_visited") : null,
        plays: events ? uniqueVisitors(events, video.id, "personal_video_played") : null,
        ctaClicks: events ? uniqueVisitors(events, video.id, "personal_video_cta_clicked") : null,
        trials: billingReady ? trials : null,
        paid,
      };
    });

  const linksSent = args.videos.filter((video) => video.linkSentAt != null).length;
  const linksVisited = events
    ? rows.filter((row) => row.sentAt != null && (row.visitors ?? 0) > 0).length
    : null;
  const visitorIds = new Set<string>();
  if (events) {
    for (const event of events) {
      if (event.eventType === "personal_video_visited") visitorIds.add(event.visitorId);
    }
  }
  const uniqueVisitorCount = events ? visitorIds.size : null;
  const playCount = events ? rows.reduce((sum, row) => sum + (row.plays ?? 0), 0) : null;
  const ctaCount = events ? rows.reduce((sum, row) => sum + (row.ctaClicks ?? 0), 0) : null;
  const trials = billingReady ? rows.reduce((sum, row) => sum + (row.trials ?? 0), 0) : null;
  const paid = paymentsReadable ? rows.reduce((sum, row) => sum + (row.paid ?? 0), 0) : null;

  return {
    readable: true,
    eventsReadable: events != null,
    billingReadable: billingReady,
    linksSent,
    linksVisited,
    linkVisitRate: formatStageRate(linksVisited, linksSent, "links marked sent"),
    uniqueVisitors: countText(uniqueVisitorCount),
    plays: countText(playCount),
    ctaClicks: countText(ctaCount),
    trials: countText(trials),
    paid: countText(paid),
    playRate: formatStageRate(playCount, uniqueVisitorCount, "unique visitors"),
    ctaRate: formatStageRate(ctaCount, uniqueVisitorCount, "unique visitors"),
    trialRate: formatStageRate(trials, ctaCount, "CTA clicks"),
    paidRate: formatStageRate(paid, trials, "free trials started"),
    rows,
    note: events
      ? "Link visit rate is sent links with at least one visit, divided by links marked sent. Unique visitors are browsers and are not that rate. A click is not a trial. A trial is not a paying subscriber. A trial is credited to the latest ready-video visit in the 30 days before that checkout was created. Earlier subscriptions are not reassigned. Visits from before this tracking existed are not included."
      : "Personal video visits could not be read. Do not treat that as zero visits. Sent status still comes from the manual mark.",
  };
}
