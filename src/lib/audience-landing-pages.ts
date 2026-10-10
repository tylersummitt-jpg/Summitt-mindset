/**
 * Audience landing pages for the same Summitt Mindset membership.
 * Paths are exact. Query strings are not separate pages.
 */

export const AUDIENCE_LANDING_SITE = "https://summittmindset.com";

export const AUDIENCE_LANDING_PAGES = [
  {
    id: "leadership",
    path: "/leadership",
    ctaSurface: "landing_leadership",
    title: "Pat Summitt's Lessons, In Your Corner Every Day | Summitt Mindset",
    description:
      "Bring Pat Summitt's leadership standards into your day with coaching, accountability, and a 7-day free trial. Pat is not personally sending the messages.",
    headline: "Pat Summitt's lessons. In your corner every day.",
    support:
      "Summitt Mindset helps you use Pat Summitt's leadership standards in ordinary life. You get daily coaching, a clear personal standard, and a record of the work you actually did.",
    helpTitle: "How this helps",
    help: [
      "You choose a personal goal and a standard you are willing to keep.",
      "Morning and evening texts help you follow through, the way a coach checks the standard for the day.",
      "The Definite Dozen is part of the membership: Pat Summitt's leadership lessons, used on your own goals.",
      "You can see practical progress, not a pile of inspiration you never use.",
    ],
    experienceTitle: "What the coaching feels like",
    experienceNote:
      "Example conversation. This is an illustration of the product, not a message from Pat Summitt and not a real member.",
    lines: [
      { speaker: "Coach Pat", text: "What standard are you keeping today?" },
      { speaker: "You", text: "I will prepare tomorrow's practice plan before dinner." },
      {
        speaker: "Coach Pat",
        text: "Good. Tell me when it is done. If it slips, tell me that too.",
      },
    ],
    imageSrc: "/brand/pat-hero.jpeg",
    imageAlt: "Coach Pat Summitt",
  },
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
  {
    id: "daily_coaching",
    path: "/daily-coaching",
    ctaSurface: "landing_daily_coaching",
    title: "A Coach by Text | Summitt Mindset",
    description:
      "Get morning and evening accountability by text, plus Ask Pat when you want to talk something through. Start a 7-day free trial.",
    headline: "Real accountability. One text at a time.",
    support:
      "Summitt Mindset is a coach you can reach by text. You do not need to learn a new system. You set a goal, get a morning and evening check-in, and answer in your own words.",
    helpTitle: "How this helps",
    help: [
      "Morning texts help you start the day with one clear commitment.",
      "Evening texts ask what you did, so the day does not disappear.",
      "Ask Pat is there when you want to talk a decision through.",
      "Your goal stays in front of you. The texts are about follow-through.",
    ],
    experienceTitle: "What a day can look like",
    experienceNote:
      "Example conversation. This is an illustration, not a copy of a real member's texts.",
    lines: [
      { speaker: "Coach Pat", text: "Good morning. What is the one thing you will finish today?" },
      { speaker: "You", text: "Call my sister and put the walk on the calendar." },
      { speaker: "Coach Pat", text: "This evening I'll ask if those two things happened." },
    ],
    imageSrc: "/brand/summitt-mindset-phone.png",
    imageAlt: "Phone showing the Summitt Mindset coaching experience",
  },
  {
    id: "life_worth_remembering",
    path: "/life-worth-remembering",
    ctaSurface: "landing_life_worth_remembering",
    title: "Be Proud of Your Life | Summitt Mindset",
    description:
      "Keep goal wins and proud moments in the Victory Room while you do the daily work. Summitt Mindset is a membership, not a photo-storage service.",
    headline: "Be proud of your life. Remember how you got there.",
    support:
      "Summitt Mindset helps you live a day you can respect, then keep the moments that show how you got there. The Victory Room holds goal wins and proud moments. It does not replace a photo library or a full journal.",
    helpTitle: "How this helps",
    help: [
      "Goal Wins mark the commitments you kept.",
      "Proud Moments give you a place for what mattered.",
      "The Victory Room lets you look back without hunting through old texts.",
      "Reflection stays tied to the life you are building, not to a promise of perfect memory storage.",
    ],
    experienceTitle: "What you can look back on",
    experienceNote:
      "Example. This is a sample Victory Room note, not a real member's memory.",
    lines: [
      { speaker: "You", text: "Proud moment: I kept the bedtime I promised the kids." },
      {
        speaker: "Coach Pat",
        text: "That counts. Save it. Tomorrow we start from the same standard.",
      },
    ],
    imageSrc: "/brand/candace_pat_game_desktop.PNG",
    imageAlt: "Pat Summitt with her daughter Candace at a game",
  },
] as const;

export type AudienceLandingPageConfig = (typeof AUDIENCE_LANDING_PAGES)[number];
export type AudienceLandingId = AudienceLandingPageConfig["id"];

export const AUDIENCE_LANDING_PATHS = [
  "/leadership",
  "/become-proud",
  "/daily-coaching",
  "/life-worth-remembering",
] as const;

export const AUDIENCE_LANDING_CTA_SURFACES = [
  "landing_leadership",
  "landing_become_proud",
  "landing_daily_coaching",
  "landing_life_worth_remembering",
] as const;

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
  leadership: "Leadership",
  become_proud: "Become proud",
  daily_coaching: "Daily coaching",
  life_worth_remembering: "Life worth remembering",
};

export const LANDING_MEASUREMENT_DESTINATIONS = [
  HOMEPAGE_LANDING_DESTINATION,
  ...AUDIENCE_LANDING_PAGES.map((page) => ({
    id: page.id,
    path: page.path,
    label: LANDING_SHORT_LABEL[page.id],
  })),
] as const;
