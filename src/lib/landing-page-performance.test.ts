import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildOperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
} from "@/lib/admin-subscriber-growth-pure";
import {
  LANDING_PAGE_MEASUREMENT_CUTOVER_MS,
  summarizeLandingPagePerformance,
} from "@/lib/landing-page-performance";
import {
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  trialCtaSurfaceFromHref,
  isMarketingPageViewPath,
} from "@/lib/marketing-attribution-pure";

const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AFTER = LANDING_PAGE_MEASUREMENT_CUTOVER_MS + 60_000;

function growth() {
  return {
    range: "last_7" as const,
    source: "all" as const,
    timezone: "America/New_York" as const,
    asOfNowLabel: "Oct 10, 2026, 8:00 AM",
    snapshot: emptyUnknownSnapshot(),
    latestTrials: [],
    warnings: [],
    adSpendEntries: [],
    activationQueryComplete: true,
    latestTrialsActivationComplete: true,
    adSpendQueryComplete: true,
    todayDateKey: "2026-10-10",
    stripeWeek: emptyStripeWeekMovement(),
    currentFreeTrials: emptyCurrentFreeTrials(),
    recentActivity: null,
    recentActivityPaymentFailedIncluded: false,
    trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
    visitorCohortTable: emptyVisitorCohortTable(),
    homepageVideo: emptyHomepageVideoReport(),
  };
}

describe("landing page measurement", () => {
  it("counts a refreshed visitor once and does not treat a click as a trial", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 1000 },
        { kind: "cta_click", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 2000 },
        { kind: "cta_click", visitorId: VISITOR, path: "/leadership", occurredAtMs: AFTER + 3000 },
      ],
    });
    const leadership = summary.rows.find((row) => row.id === "leadership");
    expect(leadership?.visitors).toBe(1);
    expect(leadership?.ctaClicks).toBe(1);
    expect(leadership?.ctaRate).toBe("100.0%");
    expect(leadership?.trials).toBe("Not available");
    expect(leadership?.paid).toBe("Not available");
    expect(summary.note).toContain("not a controlled experiment");
  });

  it("gives one later checkout to the first measured page only", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        { kind: "page_view", visitorId: VISITOR, path: "/", occurredAtMs: AFTER },
        { kind: "page_view", visitorId: VISITOR, path: "/daily-coaching", occurredAtMs: AFTER + 1000 },
        { kind: "checkout", visitorId: VISITOR, path: null, occurredAtMs: AFTER + 2000 },
        { kind: "checkout", visitorId: OTHER, path: null, occurredAtMs: AFTER },
      ],
    });
    expect(summary.rows.find((row) => row.id === "homepage")?.checkoutStarts).toBe(1);
    expect(summary.rows.find((row) => row.id === "daily_coaching")?.checkoutStarts).toBe(0);
    expect(summary.rows.every((row) => row.trials === "Not available")).toBe(true);
  });

  it("ignores new-page history before the instrumentation cutover", () => {
    const summary = summarizeLandingPagePerformance({
      pagesReadable: true,
      outcomesReadable: true,
      observations: [
        {
          kind: "page_view",
          visitorId: VISITOR,
          path: "/become-proud",
          occurredAtMs: LANDING_PAGE_MEASUREMENT_CUTOVER_MS - 1000,
        },
      ],
    });
    expect(summary.rows.find((row) => row.id === "become_proud")?.visitors).toBe(0);
  });

  it("does not call the analytics unreadable when the read succeeded with zero rows", () => {
    const data = growth();
    data.snapshot.notes.sourceTrackingUnavailable = false;
    const snapshot = buildOperatingSnapshot({
      growth: data,
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
    });
    expect(snapshot.actions.map((action) => action.id)).not.toContain(
      "landing-page-analytics-unreadable"
    );
    expect(snapshot.report).toContain("LANDING PAGE PERFORMANCE");
    expect(snapshot.report).toContain("New free trials: Not available");
    expect(snapshot.report).not.toMatch(/\bwon\b/i);
  });

  it("keeps the original first-touch source after a later landing page", () => {
    const first = resolveMarketingCookies({
      pathname: "/",
      search: "utm_source=google&utm_medium=cpc",
      nowIso: "2026-10-10T12:00:00.000Z",
      generatedVisitorId: VISITOR,
    });
    const later = resolveMarketingCookies({
      pathname: "/leadership",
      search: "utm_source=facebook&utm_medium=cpc",
      existingVisitor: first?.visitorId,
      existingAcqRaw: serializeAcquisitionCookie(first!.payload),
      nowIso: "2026-10-11T12:00:00.000Z",
      generatedVisitorId: OTHER,
    });
    expect(later?.visitorId).toBe(VISITOR);
    expect(later?.payload.source_normalized).toBe(first?.payload.source_normalized);
    expect(isMarketingPageViewPath("/leadership")).toBe(true);
    expect(isMarketingPageViewPath("/leadership/extra")).toBe(false);
    expect(trialCtaSurfaceFromHref("/sign-up?redirect_url=%2Fcheckout%2Fstart", "/leadership")).toBe(
      "landing_leadership"
    );
  });
});

describe("landing pages stay off the homepage and Brooke's page", () => {
  it("does not replace the homepage or subscriber growth", () => {
    const root = process.cwd();
    const home = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    const brooke = readFileSync(join(root, "src/app/admin/subscriber-growth/page.tsx"), "utf8");
    const layout = readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8");
    const screen = readFileSync(join(root, "src/app/admin/operating-screen.tsx"), "utf8");
    const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
    expect(home).not.toContain("AudienceLandingRoute");
    expect(home).not.toContain("/leadership");
    expect(brooke).not.toContain("Landing Page Performance");
    expect(layout).not.toContain("/leadership");
    expect(screen).toContain("Landing Page Performance");
    expect(screen.slice(screen.indexOf("function RetentionBody"))).not.toContain(
      "Landing Page Performance"
    );
    const copy = readFileSync(join(root, "src/lib/audience-landing-pages.ts"), "utf8");
    const view = readFileSync(join(root, "src/components/audience-landing-page.tsx"), "utf8");
    expect(copy).toContain("Pat Summitt's lessons. In your corner every day.");
    expect(copy).toContain("Build a life you're proud of. One day at a time.");
    expect(copy).toContain("Real accountability. One text at a time.");
    expect(copy).toContain("Be proud of your life. Remember how you got there.");
    expect(copy).toContain("Example conversation");
    expect(view).toContain("marketingAcquisitionHref");
    expect(view).toContain("MEMBERSHIP_PUBLIC_OFFER");
    expect(view).toContain("You do not pay the monthly price and the yearly price together.");
    expect(view).toContain("Pat Summitt is not personally sending");
    for (const path of [
      "/leadership",
      "/become-proud",
      "/daily-coaching",
      "/life-worth-remembering",
    ]) {
      expect(middleware).toContain(`"${path}"`);
      const page = readFileSync(join(root, `src/app${path}/page.tsx`), "utf8");
      expect(page).toContain("AudienceLandingRoute");
      expect(page).toContain("audienceLandingMetadata");
    }
  });
});
