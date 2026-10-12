/**
 * Audience landing pages for the same Summitt Mindset membership.
 * Paths are exact. Query strings are not separate pages.
 */

export const AUDIENCE_LANDING_SITE = "https://summittmindset.com";

export const AUDIENCE_LANDING_PAGES = [
  {
    id: "become_proud",
    path: "/become-proud",
    ctaSurface: "landing_become_proud",
    title: "Build a Life You're Proud Of | Summitt Mindset",
    description:
      "Get personal daily texts from Coach Pat to help you reach your goals and remember the moments that matter. 7 days free, then $29/month. Cancel anytime.",
  },
] as const;

export type AudienceLandingPageConfig = (typeof AUDIENCE_LANDING_PAGES)[number];
export type AudienceLandingId = AudienceLandingPageConfig["id"];

export const AUDIENCE_LANDING_PATHS = ["/become-proud"] as const;

export const AUDIENCE_LANDING_CTA_SURFACES = ["landing_become_proud"] as const;

export function audienceLandingPage(id: AudienceLandingId): AudienceLandingPageConfig {
  const page = AUDIENCE_LANDING_PAGES.find((item) => item.id === id);
  if (!page) throw new Error("Unknown audience landing page.");
  return page;
}

export function audienceLandingCtaSurface(pathname: string): string | null {
  const page = AUDIENCE_LANDING_PAGES.find((item) => item.path === pathname);
  return page?.ctaSurface ?? null;
}

export const HOMEPAGE_LANDING_DESTINATION = {
  id: "homepage",
  path: "/",
  label: "Homepage",
} as const;

const LANDING_SHORT_LABEL: Record<AudienceLandingId, string> = {
  become_proud: "Become proud",
};

/** Retired routes still count when reading stored visits. They are not selectable pages. */
const RETIRED_LANDING_MEASUREMENTS = [
  { id: "leadership", path: "/leadership", label: "Leadership" },
  { id: "daily_coaching", path: "/daily-coaching", label: "Daily coaching" },
  { id: "life_worth_remembering", path: "/life-worth-remembering", label: "Life worth remembering" },
] as const;

export const LANDING_MEASUREMENT_DESTINATIONS = [
  HOMEPAGE_LANDING_DESTINATION,
  ...AUDIENCE_LANDING_PAGES.map((page) => ({
    id: page.id,
    path: page.path,
    label: LANDING_SHORT_LABEL[page.id],
  })),
  ...RETIRED_LANDING_MEASUREMENTS,
] as const;
