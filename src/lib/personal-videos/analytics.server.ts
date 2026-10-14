import "server-only";

import type { AcquisitionCookiePayload } from "@/lib/marketing-attribution-pure";
import type { GrowthStripeSubscription } from "@/lib/admin-subscriber-growth-pure";
import { supabaseServer } from "@/lib/supabase-server";
import { getPersonalVideo, listPersonalVideos } from "@/lib/personal-videos/store";
import {
  buildPersonalVideoDistribution,
  parsePersonalVideoId,
  PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS,
  selectLatestPersonalVideoVisit,
  unreadablePersonalVideoDistribution,
  type PersonalVideoDistribution,
  type PersonalVideoEngagement,
  type PersonalVideoEventType,
  type PersonalVideoVisitCandidate,
} from "@/lib/personal-videos/analytics";

const EVENT_PAGE = 500;
const MAX_EVENT_PAGES = 20;

export async function latestReadyPersonalVideoId(visitorId: string, now = new Date()): Promise<string | null> {
  const cutoff = new Date(now.getTime() - PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS).toISOString();
  const { data, error } = await supabaseServer
    .from("marketing_events")
    .select("id, occurred_at, metadata")
    .eq("event_type", "personal_video_visited")
    .eq("visitor_id", visitorId)
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) return null;
  const visits: PersonalVideoVisitCandidate[] = [];
  for (const row of data ?? []) {
    const metadata = row.metadata as { personal_video_id?: unknown } | null;
    const personalVideoId = parsePersonalVideoId(metadata?.personal_video_id);
    const occurredAtMs = Date.parse(String(row.occurred_at ?? ""));
    const eventId = typeof row.id === "string" ? row.id : "";
    if (!personalVideoId || !eventId || !Number.isFinite(occurredAtMs)) continue;
    visits.push({ personalVideoId, occurredAtMs, eventId });
  }
  const ids = [...new Set(visits.map((visit) => visit.personalVideoId))];
  const ready = new Set<string>();
  if (ids.length > 0) {
    const { data: videos, error: videoError } = await supabaseServer
      .from("personal_videos")
      .select("id, status")
      .in("id", ids);
    if (videoError) return null;
    for (const video of videos ?? []) {
      if (video.status === "ready" && typeof video.id === "string") ready.add(video.id);
    }
  }
  return selectLatestPersonalVideoVisit(visits, now.getTime(), ready);
}

export async function insertPersonalVideoEvent(args: {
  eventType: PersonalVideoEventType;
  visitorId: string;
  personalVideoId: string;
  attribution: AcquisitionCookiePayload | null;
}): Promise<void> {
  const video = await getPersonalVideo(args.personalVideoId);
  if (!video || video.status !== "ready") return;
  const { error } = await supabaseServer.from("marketing_events").insert({
    occurred_at: new Date().toISOString(),
    event_type: args.eventType,
    visitor_id: args.visitorId,
    clerk_user_id: null,
    path: null,
    utm_source: args.attribution?.utm_source ?? null,
    utm_medium: args.attribution?.utm_medium ?? null,
    utm_campaign: args.attribution?.utm_campaign ?? null,
    utm_content: args.attribution?.utm_content ?? null,
    source_normalized: args.attribution?.source_normalized ?? null,
    is_paid_acquisition: args.attribution?.is_paid_acquisition ?? false,
    referrer_host: args.attribution?.referrer_host ?? null,
    metadata: { personal_video_id: args.personalVideoId },
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[personal-video] event was not stored");
  }
}

export async function loadPersonalVideoDistribution(args: {
  subscriptions: readonly GrowthStripeSubscription[] | null;
  subscriptionsComplete: boolean;
}): Promise<PersonalVideoDistribution> {
  let videos;
  try {
    videos = await listPersonalVideos();
  } catch {
    return unreadablePersonalVideoDistribution(
      "Personal videos could not be read. Do not treat that as zero links sent."
    );
  }
  const events = await loadPersonalVideoEvents();
  return buildPersonalVideoDistribution({
    videos: videos.map((video) => ({
      id: video.id,
      createdAt: video.createdAt,
      linkSentAt: video.linkSentAt,
    })),
    events,
    subscriptions: args.subscriptions,
    subscriptionsComplete: args.subscriptionsComplete,
  });
}

async function loadPersonalVideoEvents(): Promise<PersonalVideoEngagement[] | null> {
  const events: PersonalVideoEngagement[] = [];
  try {
    for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
      const from = page * EVENT_PAGE;
      const { data, error } = await supabaseServer
        .from("marketing_events")
        .select("event_type, visitor_id, metadata")
        .in("event_type", ["personal_video_visited", "personal_video_played", "personal_video_cta_clicked"])
        .order("occurred_at", { ascending: true })
        .range(from, from + EVENT_PAGE - 1);
      if (error) return null;
      const batch = data ?? [];
      for (const row of batch) {
        const metadata = row.metadata as { personal_video_id?: unknown } | null;
        const personalVideoId = parsePersonalVideoId(metadata?.personal_video_id);
        const visitorId = typeof row.visitor_id === "string" ? row.visitor_id : "";
        const eventType = row.event_type;
        if (
          !personalVideoId ||
          !visitorId ||
          (eventType !== "personal_video_visited" &&
            eventType !== "personal_video_played" &&
            eventType !== "personal_video_cta_clicked")
        ) {
          continue;
        }
        events.push({ personalVideoId, visitorId, eventType });
      }
      if (batch.length < EVENT_PAGE) return events;
    }
  } catch {
    return null;
  }
  return null;
}
