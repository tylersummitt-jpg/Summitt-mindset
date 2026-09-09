/**
 * Display-only tracking URL generator for Brooke.
 * Does not change capture, cookies, or first-touch attribution.
 */

export const TRACKING_LINK_BASE = "https://summittmindset.com/";
export const TRACKING_TOKEN_MAX = 80;

export const TRACKING_PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X" },
] as const;

export type TrackingPlatformId = (typeof TRACKING_PLATFORMS)[number]["id"];

export const TRACKING_TRAFFIC_TYPES = [
  { id: "organic", label: "Organic", utmMedium: "organic_social" },
  { id: "paid", label: "Paid Ad", utmMedium: "paid_social" },
] as const;

export type TrackingTrafficTypeId = (typeof TRACKING_TRAFFIC_TYPES)[number]["id"];

export const TRACKING_CONTENT_TYPES = [
  { id: "bio", label: "Bio", prefix: "bio" },
  { id: "story", label: "Story", prefix: "story" },
  { id: "reel", label: "Reel", prefix: "reel" },
  { id: "post", label: "Post", prefix: "post" },
  { id: "video", label: "Video", prefix: "video" },
  { id: "static_ad", label: "Static Ad", prefix: "static" },
  { id: "testimonial_ad", label: "Testimonial Ad", prefix: "testimonial" },
  { id: "other", label: "Other", prefix: null },
] as const;

export type TrackingContentTypeId = (typeof TRACKING_CONTENT_TYPES)[number]["id"];

export type TrackingLinkInput = {
  platform: string;
  trafficType: string;
  campaign: string;
  contentType: string;
  contentId: string;
};

export type TrackingLinkResult =
  | {
      ok: true;
      url: string;
      summary: string;
      utm_source: string;
      utm_medium: string;
      utm_campaign: string;
      utm_content: string;
    }
  | { ok: false; error: string };

export function normalizeTrackingToken(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, TRACKING_TOKEN_MAX);
}

function applyContentPrefix(prefix: string, id: string): string {
  if (!id) return prefix;
  if (id === prefix || id.startsWith(`${prefix}_`)) return id.slice(0, TRACKING_TOKEN_MAX);
  const combined = `${prefix}_${id}`;
  return combined.slice(0, TRACKING_TOKEN_MAX);
}

export function defaultCampaignForTrafficType(trafficType: string): string {
  return trafficType === "organic" ? "organic" : "";
}

export function buildTrackingLink(input: TrackingLinkInput): TrackingLinkResult {
  const platform = TRACKING_PLATFORMS.find((p) => p.id === input.platform);
  const traffic = TRACKING_TRAFFIC_TYPES.find((t) => t.id === input.trafficType);
  const contentType = TRACKING_CONTENT_TYPES.find((c) => c.id === input.contentType);
  if (!platform) return { ok: false, error: "Choose a platform." };
  if (!traffic) return { ok: false, error: "Choose Organic or Paid Ad." };
  if (!contentType) return { ok: false, error: "Choose a content type." };

  const campaign = normalizeTrackingToken(input.campaign);
  if (!campaign) return { ok: false, error: "Enter a campaign name." };

  const contentId = normalizeTrackingToken(input.contentId);
  if (contentType.id !== "bio" && !contentId) {
    return { ok: false, error: "Add a name or ID for this post." };
  }

  const utm_content =
    contentType.prefix == null
      ? contentId
      : applyContentPrefix(contentType.prefix, contentId);

  const url = new URL(TRACKING_LINK_BASE);
  url.searchParams.set("utm_source", platform.id);
  url.searchParams.set("utm_medium", traffic.utmMedium);
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", utm_content);

  const summary =
    traffic.id === "organic"
      ? `${platform.label} · ${traffic.label} · ${utm_content}`
      : `${platform.label} · ${traffic.label} · ${campaign} · ${utm_content}`;

  return {
    ok: true,
    url: url.toString(),
    summary,
    utm_source: platform.id,
    utm_medium: traffic.utmMedium,
    utm_campaign: campaign,
    utm_content,
  };
}
