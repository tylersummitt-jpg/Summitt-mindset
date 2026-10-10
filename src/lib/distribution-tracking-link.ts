/**
 * Distribution tracking links use the same UTM shape as Brooke's builder.
 * Production class is an extra query param. It does not change first-touch rules.
 */

import { isApprovedLandingDestination } from "@/lib/landing-experiment-shared";
import { contentProductionLabel, parseContentProduction } from "@/lib/content-production";
import {
  TRACKING_CONTENT_TYPES,
  TRACKING_LINK_BASE,
  TRACKING_PLATFORMS,
  TRACKING_TOKEN_MAX,
  TRACKING_TRAFFIC_TYPES,
  buildTrackingLink,
  normalizeTrackingToken,
  type TrackingLinkResult,
} from "@/lib/tracking-link-builder-pure";

export const DISTRIBUTION_TRACKING_PARAM = "sm_prod";

export const DISTRIBUTION_PLATFORMS = [
  ...TRACKING_PLATFORMS,
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "pinterest", label: "Pinterest" },
  { id: "email", label: "Cold email" },
  { id: "newsletter", label: "Newsletter" },
] as const;

export type DistributionTrackingInput = {
  destination: string;
  platform: string;
  trafficType: string;
  campaign: string;
  contentType: string;
  contentId: string;
  production: string;
};

export function buildDistributionTrackingLink(input: DistributionTrackingInput): TrackingLinkResult {
  if (!isApprovedLandingDestination(input.destination)) {
    return { ok: false, error: "Choose the homepage or one of the four landing pages." };
  }
  const platform = DISTRIBUTION_PLATFORMS.find((row) => row.id === input.platform);
  if (!platform) return { ok: false, error: "Choose a platform." };

  const known = TRACKING_PLATFORMS.some((row) => row.id === platform.id);
  const built = known
    ? buildTrackingLink(input)
    : buildSameUtmShape({ ...input, platform: platform.id });
  if (!built.ok) return built;

  const url = new URL(built.url);
  url.pathname = input.destination;
  const production = parseContentProduction(input.production);
  if (production) url.searchParams.set(DISTRIBUTION_TRACKING_PARAM, production);
  else url.searchParams.delete(DISTRIBUTION_TRACKING_PARAM);

  return {
    ...built,
    url: url.toString(),
    summary: `${platform.label} · ${contentProductionLabel(production)} · ${built.utm_content}`,
  };
}

function buildSameUtmShape(input: DistributionTrackingInput): TrackingLinkResult {
  const traffic = TRACKING_TRAFFIC_TYPES.find((row) => row.id === input.trafficType);
  const contentType = TRACKING_CONTENT_TYPES.find((row) => row.id === input.contentType);
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
      : contentId === contentType.prefix || contentId.startsWith(`${contentType.prefix}_`)
        ? contentId
        : `${contentType.prefix}_${contentId}`.slice(0, TRACKING_TOKEN_MAX);
  const url = new URL(TRACKING_LINK_BASE);
  url.searchParams.set("utm_source", input.platform);
  url.searchParams.set("utm_medium", traffic.utmMedium);
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", utm_content);
  return {
    ok: true,
    url: url.toString(),
    summary: utm_content,
    utm_source: input.platform,
    utm_medium: traffic.utmMedium,
    utm_campaign: campaign,
    utm_content,
  };
}
