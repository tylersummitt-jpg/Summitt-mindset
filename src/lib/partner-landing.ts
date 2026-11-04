/**
 * Public partner landing pages and the allowlists shared with checkout.
 */

import { PARTNER_ANNUAL_PLAN } from "@/lib/checkout-plan";

export const PARTNER_LANDING_PATHS = [
  "/orange-mountain-designs",
  "/lady-vol-boost-her-club",
] as const;

export type PartnerLandingPath = (typeof PARTNER_LANDING_PATHS)[number];

export const PARTNER_KEYS = [
  "orange-mountain-designs",
  "lady-vol-boost-her-club",
] as const;

export type PartnerKey = (typeof PARTNER_KEYS)[number];

export type PartnerChannel = "email" | "social" | "unknown";

export type PartnerLanding = {
  path: PartnerLandingPath;
  key: PartnerKey;
  name: string;
  headlineAccent: string;
  logoSrc: string;
  videoHeading: string;
  /** Numeric Vimeo id. The page embeds only through buildVimeoPlayerEmbedUrl. */
  vimeoVideoId: string;
};

export const PARTNER_LANDINGS: readonly PartnerLanding[] = [
  {
    path: "/orange-mountain-designs",
    key: "orange-mountain-designs",
    name: "Orange Mountain Designs",
    headlineAccent: "Orange Mountain Designs Family",
    logoSrc: "/brand/OMD.jpg",
    videoHeading:
      "Personal Video from Tyler Summitt to the Orange Mountain Designs Family",
    vimeoVideoId: "1243381661",
  },
  {
    path: "/lady-vol-boost-her-club",
    key: "lady-vol-boost-her-club",
    name: "Lady Vol Boost Her Club",
    headlineAccent: "Lady Vol Boost Her Club Family",
    logoSrc: "/brand/LVBHC.jpg",
    videoHeading:
      "Personal Video from Tyler Summitt to the Lady Vol Boost Her Club Family",
    vimeoVideoId: "1243381662",
  },
];

export function partnerLandingByPath(path: PartnerLandingPath): PartnerLanding {
  const found = PARTNER_LANDINGS.find((partner) => partner.path === path);
  if (!found) {
    throw new Error("Unknown partner landing");
  }
  return found;
}

export function parsePartnerKey(raw: unknown): PartnerKey | null {
  return typeof raw === "string" && (PARTNER_KEYS as readonly string[]).includes(raw)
    ? (raw as PartnerKey)
    : null;
}

export function parsePartnerChannel(raw: unknown): PartnerChannel {
  return raw === "email" || raw === "social" ? raw : "unknown";
}

export function partnerCheckoutHref(partner: PartnerKey, channel: PartnerChannel): string {
  const params = new URLSearchParams({
    plan: PARTNER_ANNUAL_PLAN,
    partner,
    channel,
  });
  return `/checkout/start?${params.toString()}`;
}

export function isPartnerLandingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const withoutQuery = pathname.split("?")[0] ?? "";
  const path =
    withoutQuery.length > 1 && withoutQuery.endsWith("/")
      ? withoutQuery.slice(0, -1)
      : withoutQuery;
  return (PARTNER_LANDING_PATHS as readonly string[]).includes(path);
}
