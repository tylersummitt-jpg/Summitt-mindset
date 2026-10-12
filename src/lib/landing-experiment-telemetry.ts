/**
 * Pure helpers for the homepage vs Become Proud experiment.
 * No I/O. Safe for the browser beacon and the admin report.
 */

type Count = number | "Not available";
type Variant = "control" | "challenger";

export const EXPERIMENT_CTA_SURFACES = [
  "home_nav_cta",
  "home_hero_cta",
  "home_lower_cta",
  "proud_nav_cta",
  "proud_hero_cta",
  "proud_middle_cta",
  "proud_final_cta",
] as const;

export type ExperimentCtaSurface = (typeof EXPERIMENT_CTA_SURFACES)[number];

export const SCROLL_MILESTONES = [25, 50, 75, 90] as const;
export type ScrollMilestone = (typeof SCROLL_MILESTONES)[number];

export const ENGAGED_BUCKETS = [15, 30, 60, 120] as const;
export type EngagedBucket = (typeof ENGAGED_BUCKETS)[number];

export const EXPERIMENT_SECTIONS = [
  { id: "home_hero", path: "/", label: "Hero" },
  { id: "home_demo", path: "/", label: "Text conversation" },
  { id: "home_coaching", path: "/", label: "How the daily texts work" },
  { id: "home_victory", path: "/", label: "Victory Room" },
  { id: "home_proof", path: "/", label: "Testimonials" },
  { id: "home_offer", path: "/", label: "Pricing and final offer" },
  { id: "proud_hero", path: "/become-proud", label: "Hero" },
  { id: "proud_coaching", path: "/become-proud", label: "Someone in your corner" },
  { id: "proud_demo", path: "/become-proud", label: "Example conversation" },
  { id: "proud_benefits", path: "/become-proud", label: "Goals and memories" },
  { id: "proud_victory", path: "/become-proud", label: "Victory Room" },
  { id: "proud_film", path: "/become-proud", label: "Film Room and programs" },
  { id: "proud_proof", path: "/become-proud", label: "Testimonials" },
  { id: "proud_legacy", path: "/become-proud", label: "Pat's legacy" },
  { id: "proud_offer", path: "/become-proud", label: "Pricing and final offer" },
] as const;

export type ExperimentSectionId = (typeof EXPERIMENT_SECTIONS)[number]["id"];

const SECTION_IDS = new Set<string>(EXPERIMENT_SECTIONS.map((section) => section.id));

export const CTA_LABELS: Record<ExperimentCtaSurface, string> = {
  home_nav_cta: "Homepage navigation",
  home_hero_cta: "Homepage hero",
  home_lower_cta: "Homepage closing offer",
  proud_nav_cta: "Become Proud navigation",
  proud_hero_cta: "Become Proud hero",
  proud_middle_cta: "Become Proud included-benefits",
  proud_final_cta: "Become Proud closing offer",
};

export type ClientEnvironment = {
  device: "mobile" | "desktop";
  os: "ios" | "android" | "other";
  browser: "safari" | "chrome" | "other";
  inApp: "instagram" | "facebook" | "tiktok" | "none";
};

export function parseClientEnvironment(userAgent: string | null | undefined): ClientEnvironment {
  const ua = userAgent ?? "";
  const inApp = /Instagram/i.test(ua)
    ? "instagram"
    : /FBAN|FBAV|FB_IAB/i.test(ua)
      ? "facebook"
      : /TikTok/i.test(ua)
        ? "tiktok"
        : "none";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";
  const browser =
    /CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua)
      ? "chrome"
      : /Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)
        ? "safari"
        : "other";
  const device = /Mobi|iPhone|iPad|Android/i.test(ua) ? "mobile" : "desktop";
  return { device, os, browser, inApp };
}

export function parseScrollMilestone(raw: unknown): ScrollMilestone | 0 {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (value >= 90) return 90;
  if (value >= 75) return 75;
  if (value >= 50) return 50;
  if (value >= 25) return 25;
  return 0;
}

export function parseEngagedBucket(raw: unknown): EngagedBucket | 0 {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (value >= 120) return 120;
  if (value >= 60) return 60;
  if (value >= 30) return 30;
  if (value >= 15) return 15;
  return 0;
}

export function parseSectionList(raw: unknown, path: string): ExperimentSectionId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(
    EXPERIMENT_SECTIONS.filter((section) => section.path === path).map((section) => section.id)
  );
  const seen = new Set<ExperimentSectionId>();
  for (const item of raw) {
    if (typeof item !== "string" || !SECTION_IDS.has(item) || !allowed.has(item as ExperimentSectionId)) {
      continue;
    }
    seen.add(item as ExperimentSectionId);
  }
  return [...seen];
}

export function mergeBehavior(args: {
  previous: {
    sections: readonly string[];
    scroll: number;
    engaged: number;
  } | null;
  sections: readonly string[];
  scroll: number;
  engaged: number;
}): { sections: string[]; scroll: ScrollMilestone | 0; engaged: EngagedBucket | 0 } {
  const sections = new Set<string>(args.previous?.sections ?? []);
  for (const section of args.sections) sections.add(section);
  return {
    sections: [...sections],
    scroll: parseScrollMilestone(Math.max(args.previous?.scroll ?? 0, args.scroll)),
    engaged: parseEngagedBucket(Math.max(args.previous?.engaged ?? 0, args.engaged)),
  };
}

export type EvidenceState =
  | "Collecting Data"
  | "Promising Direction"
  | "Actionable Winner"
  | "Inconclusive"
  | "Measurement Problem";

function proportionSe(successes: number, total: number): number {
  if (total <= 0) return Number.POSITIVE_INFINITY;
  const p = successes / total;
  return Math.sqrt((p * (1 - p)) / total);
}

/**
 * Two-proportion comparison for trial starts.
 * The 99% bar is intentional: this screen is opened repeatedly, so a 95% bar
 * would call noise a winner too often. A person still makes the decision.
 */
export function experimentEvidenceState(args: {
  readable: boolean;
  days: number | null;
  assignedA: number;
  assignedB: number;
  trialsA: number;
  trialsB: number;
  attributionGap?: boolean;
}): { state: EvidenceState; note: string } {
  if (!args.readable) {
    return {
      state: "Measurement Problem",
      note: "Assignment or trial results could not be read. Do not treat a blank as zero, and do not pick a page.",
    };
  }
  const days = args.days;
  const enoughToLook = days != null && days >= 14 && args.assignedA >= 100 && args.assignedB >= 100;
  const enoughToConclude = days != null && days >= 28 && args.assignedA >= 100 && args.assignedB >= 100;
  const se = Math.sqrt(
    proportionSe(args.trialsA, args.assignedA) ** 2 + proportionSe(args.trialsB, args.assignedB) ** 2
  );
  const diff = args.assignedB > 0 || args.assignedA > 0
    ? args.trialsB / Math.max(args.assignedB, 1) - args.trialsA / Math.max(args.assignedA, 1)
    : 0;
  const comparable = args.assignedA > 0 && args.assignedB > 0 && Number.isFinite(se) && se > 0;
  const z = comparable ? diff / se : 0;
  const ahead = diff > 0 ? "Become Proud" : "Homepage";
  if (args.attributionGap && (enoughToLook || enoughToConclude)) {
    return {
      state: "Measurement Problem",
      note: "The two pages are not confirming page views at a similar rate. Do not call a winner from the trial gap until that difference is explained. Recent assignees are not treated as failures.",
    };
  }
  if (comparable && enoughToConclude && Math.abs(z) >= 2.58 && args.trialsA + args.trialsB >= 15) {
    return {
      state: "Actionable Winner",
      note: `${ahead} is ahead on trial starts per visitor whose 7-day trial window has closed. The gap clears a 99% interval, which is the bar used because these results are checked more than once. A person still has to record the decision. This screen will not switch the traffic.`,
    };
  }
  if (comparable && enoughToLook && Math.abs(z) >= 1.96) {
    return {
      state: "Promising Direction",
      note: `${ahead} is ahead, and a 95% interval for the difference does not include a tie. That is not strong enough to move the budget while the test is still being watched.`,
    };
  }
  if (enoughToConclude) {
    return {
      state: "Inconclusive",
      note: "Both pages have been watched for 28 days with at least 100 visitors each whose 7-day trial window has closed. The trial-rate gap does not clear the review bar.",
    };
  }
  return {
    state: "Collecting Data",
    note: "Keep the test running. The review uses only visitors whose 7-day trial window has already closed. It needs 14 days and 100 of those visitors on each page. A stronger review needs 28 days. People assigned more recently stay in the live counts and are not treated as failures.",
  };
}

export function rateText(numerator: Count, denominator: Count): string {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator <= 0) {
    return "Not available";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function deviceLine(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "Not available";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
}

export type CampaignMix = { campaign: string; variant: Variant };

export function campaignMixNote(rows: readonly CampaignMix[]): string {
  const totals = new Map<string, { control: number; challenger: number }>();
  for (const row of rows) {
    const campaign = row.campaign.trim() || "Unknown";
    const prev = totals.get(campaign) ?? { control: 0, challenger: 0 };
    prev[row.variant] += 1;
    totals.set(campaign, prev);
  }
  const warnings: string[] = [];
  for (const [campaign, counts] of totals) {
    const total = counts.control + counts.challenger;
    if (total < 30 || campaign === "Unknown") continue;
    const controlShare = counts.control / total;
    if (Math.abs(controlShare - 0.5) >= 0.25) {
      warnings.push(
        `${campaign}: ${counts.control} on the homepage and ${counts.challenger} on Become Proud.`
      );
    }
  }
  const unknown =
    "Visitors with no campaign name are labeled Unknown and stay in the trial rate.";
  if (warnings.length === 0) {
    return `No large campaign imbalance is visible. Randomization is inside the shared entry, so a modest difference is expected. ${unknown}`;
  }
  return `Campaign mix differs enough to inspect: ${warnings.slice(0, 3).join(" ")} ${unknown}`;
}
