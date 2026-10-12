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
      "Set a goal, follow through, and keep a record of progress with Summitt Mindset. Start a 7-day free trial of the same membership.",
    headline: "Build a life you're proud of. One day at a time.",
    support:
      "Summitt Mindset is a membership for people who want to do what they said they would do. It is daily accountability for one personal goal, not a folder of generic motivation.",
    helpTitle: "How this helps",
    help: [
      "You name a goal that matters to you.",
      "You get encouragement and a direct question when the day is asking you to follow through.",
      "You can look back and see the days you kept your word.",
      "Pride comes from the actions you repeated, not from a slogan.",
    ],
    experienceTitle: "What you actually do",
    experienceNote:
      "Example. This shows the membership, not a real member's goal or result.",
    lines: [
      { speaker: "You", text: "My goal is to walk after dinner on weeknights." },
      { speaker: "Coach Pat", text: "Then tonight has a job. Did you walk?" },
      { speaker: "You", text: "Yes. Twenty minutes." },
    ],
    imageSrc: "/brand/pat_statue_grandkids_candidate_sharp.jpg",
    imageAlt: "Pat Summitt statue with her grandkids",
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
