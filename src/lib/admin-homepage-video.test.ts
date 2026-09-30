import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeHomepageVideoReport,
  loadHomepageVideoCohortEvents,
  type HomepageVideoScopedQuery,
} from "@/lib/admin-homepage-video";
import { HOMEPAGE_VIDEO_EVENT_TYPES } from "@/lib/homepage-video";
import {
  computeVisitorCohortTable,
  type GrowthStripeSubscription,
  type MarketingAttributionRow,
  type MarketingEventRow,
} from "@/lib/admin-subscriber-growth-pure";
import type { HomepageVideoEventInput } from "@/lib/admin-homepage-video";

const VIDEO = "123456";
const OTHER = "999999";
const WINDOW_START = 1_700_000_000_000;
const WINDOW_END = WINDOW_START + 86_400_000;
const T50 = WINDOW_END + 86_400_000;
const T50_SEC = Math.floor(T50 / 1000);

function event(
  partial: Partial<HomepageVideoEventInput> & Pick<HomepageVideoEventInput, "event_type" | "visitor_id" | "occurred_at">
): HomepageVideoEventInput {
  return {
    source_normalized: "meta",
    path: "/",
    metadata: { vimeo_video_id: VIDEO },
    ...partial,
  };
}

function sub(partial: Partial<GrowthStripeSubscription> & Pick<GrowthStripeSubscription, "id">): GrowthStripeSubscription {
  return {
    status: "active",
    metadata: { userId: "user_1" },
    ...partial,
  };
}

const base = {
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  source: "meta_ads" as const,
  attributions: [{ clerk_user_id: "user_1", visitor_id: "v1" } as MarketingAttributionRow],
  attributionComplete: true,
  stripeSubs: [] as GrowthStripeSubscription[],
  stripeListComplete: true,
  recognizedPriceIds: new Set<string>(),
  paidInvoiceSubIds: new Set<string>(),
};

describe("homepage video cohort", () => {
  it("counts distinct visitors on the same Vimeo id and keeps later outcomes", () => {
    const report = computeHomepageVideoReport({
      ...base,
      events: [
        event({ event_type: "homepage_video_reached", visitor_id: "v1", occurred_at: new Date(WINDOW_START + 1000).toISOString() }),
        event({ event_type: "homepage_video_reached", visitor_id: "v1", occurred_at: new Date(WINDOW_START + 2000).toISOString() }),
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v2",
          occurred_at: new Date(WINDOW_START + 1000).toISOString(),
          source_normalized: "google",
        }),
        event({
          event_type: "homepage_video_started",
          visitor_id: "v1",
          occurred_at: new Date(WINDOW_END + 1000).toISOString(),
          source_normalized: "direct",
        }),
        event({
          event_type: "homepage_video_started",
          visitor_id: "v1",
          occurred_at: new Date(WINDOW_END + 2000).toISOString(),
          metadata: { vimeo_video_id: OTHER },
        }),
        event({ event_type: "homepage_video_50", visitor_id: "v1", occurred_at: new Date(T50).toISOString() }),
        event({
          event_type: "homepage_video_completed",
          visitor_id: "v1",
          occurred_at: new Date(T50 + 1000).toISOString(),
        }),
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v3",
          occurred_at: new Date(WINDOW_END + 1000).toISOString(),
        }),
      ],
    });

    expect(report.reached).toBe(1);
    expect(report.started).toBe(1);
    expect(report.watched50).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.startRate).toBe(1);
    expect(report.watched50Rate).toBe(1);
    expect(report.completionRate).toBe(1);
  });

  it("splits the under-video CTA from any later CTA and ignores clicks before halfway", () => {
    const report = computeHomepageVideoReport({
      ...base,
      events: [
        event({ event_type: "homepage_video_reached", visitor_id: "v1", occurred_at: new Date(WINDOW_START + 1000).toISOString() }),
        event({ event_type: "homepage_video_50", visitor_id: "v1", occurred_at: new Date(T50).toISOString() }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v1",
          occurred_at: new Date(T50 - 1).toISOString(),
          metadata: { cta_surface: "hero" },
        }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v1",
          occurred_at: new Date(T50).toISOString(),
          metadata: { cta_surface: "homepage_video" },
        }),
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v4",
          occurred_at: new Date(WINDOW_START + 1000).toISOString(),
        }),
        event({ event_type: "homepage_video_50", visitor_id: "v4", occurred_at: new Date(T50).toISOString() }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v4",
          occurred_at: new Date(T50 + 5).toISOString(),
          metadata: { cta_surface: "hero" },
        }),
      ],
    });

    expect(report.watched50).toBe(2);
    expect(report.videoCtaAfter50).toBe(1);
    expect(report.anyCtaAfter50).toBe(2);
    expect(report.videoCtaRate).toBe(0.5);
    expect(report.anyCtaRate).toBe(1);
  });

  it("counts a later Stripe trial or paid start once per clerk and skips earlier or unlinked people", () => {
    const report = computeHomepageVideoReport({
      ...base,
      attributions: [
        { clerk_user_id: "user_1", visitor_id: "v1" } as MarketingAttributionRow,
      ],
      stripeSubs: [
        sub({ id: "sub_a", trial_start: T50_SEC, metadata: { userId: "user_1" } }),
        sub({ id: "sub_b", trial_start: T50_SEC + 10, metadata: { userId: "user_1" } }),
        sub({ id: "sub_early", trial_start: T50_SEC - 1, metadata: { userId: "user_1" } }),
        sub({
          id: "sub_paid_late",
          status: "active",
          trial_end: null,
          start_date: T50_SEC,
          metadata: { userId: "user_2" },
        }),
        sub({
          id: "sub_paid_early",
          status: "active",
          trial_end: null,
          start_date: T50_SEC - 5,
          metadata: { userId: "user_1" },
        }),
      ],
      events: [
        event({ event_type: "homepage_video_reached", visitor_id: "v1", occurred_at: new Date(WINDOW_START + 1000).toISOString() }),
        event({ event_type: "homepage_video_50", visitor_id: "v1", occurred_at: new Date(T50).toISOString() }),
        event({ event_type: "homepage_video_reached", visitor_id: "v9", occurred_at: new Date(WINDOW_START + 1000).toISOString() }),
        event({ event_type: "homepage_video_50", visitor_id: "v9", occurred_at: new Date(T50).toISOString() }),
      ],
    });

    expect(report.stripeTrialsAfter50).toBe(1);
    expect(report.stripePaidAfter50).toBe(0);
  });

  it("counts paid after halfway for the linked clerk and leaves Stripe blank when the list is incomplete", () => {
    const events = [
      event({ event_type: "homepage_video_reached", visitor_id: "v1", occurred_at: new Date(WINDOW_START + 1000).toISOString() }),
      event({ event_type: "homepage_video_50", visitor_id: "v1", occurred_at: new Date(T50).toISOString() }),
    ];
    const paid = computeHomepageVideoReport({
      ...base,
      events,
      stripeSubs: [
        sub({
          id: "sub_paid",
          status: "active",
          trial_start: null,
          trial_end: null,
          start_date: T50_SEC,
          metadata: { userId: "user_1" },
        }),
      ],
    });
    expect(paid.stripePaidAfter50).toBe(1);
    expect(paid.paidRate).toBe(1);

    const incomplete = computeHomepageVideoReport({
      ...base,
      events,
      stripeListComplete: false,
      stripeSubs: paid.stripePaidAfter50 === 1 ? [
        sub({
          id: "sub_paid",
          status: "active",
          trial_end: null,
          start_date: T50_SEC,
          metadata: { userId: "user_1" },
        }),
      ] : [],
    });
    expect(incomplete.reached).toBe(1);
    expect(incomplete.stripeTrialsAfter50).toBeNull();
    expect(incomplete.stripePaidAfter50).toBeNull();
    expect(incomplete.trialRate).toBeNull();
    expect(incomplete.paidRate).toBeNull();
  });

  it("counts started, halfway, and completed even when those timestamps are before reached", () => {
    const reachedAt = WINDOW_START + 10_000;
    const report = computeHomepageVideoReport({
      ...base,
      events: [
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt).toISOString(),
        }),
        event({
          event_type: "homepage_video_started",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 3_000).toISOString(),
        }),
        event({
          event_type: "homepage_video_50",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 2_000).toISOString(),
        }),
        event({
          event_type: "homepage_video_completed",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 1_000).toISOString(),
        }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 2_500).toISOString(),
          metadata: { cta_surface: "homepage_video" },
        }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 2_000).toISOString(),
          metadata: { cta_surface: "hero" },
        }),
      ],
      stripeSubs: [
        sub({
          id: "sub_before_50",
          trial_start: Math.floor((reachedAt - 2_500) / 1000),
          metadata: { userId: "user_1" },
        }),
        sub({
          id: "sub_at_50",
          trial_start: Math.floor((reachedAt - 2_000) / 1000),
          metadata: { userId: "user_1" },
        }),
      ],
    });

    expect(report.reached).toBe(1);
    expect(report.started).toBe(1);
    expect(report.watched50).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.videoCtaAfter50).toBe(0);
    expect(report.anyCtaAfter50).toBe(1);
    expect(report.stripeTrialsAfter50).toBe(1);
  });

  it("does not let one Vimeo id qualify milestones or outcomes for another id", () => {
    const reachedAt = WINDOW_START + 10_000;
    const otherFiftyAt = reachedAt - 4_000;
    const report = computeHomepageVideoReport({
      ...base,
      source: "all",
      attributions: [
        { clerk_user_id: "user_a", visitor_id: "v1" } as MarketingAttributionRow,
        { clerk_user_id: "user_b", visitor_id: "v2" } as MarketingAttributionRow,
      ],
      stripeSubs: [
        sub({
          id: "sub_other_only",
          trial_start: Math.floor(otherFiftyAt / 1000) + 1,
          metadata: { userId: "user_b" },
        }),
        sub({
          id: "sub_video_a",
          trial_start: Math.floor((reachedAt - 1_000) / 1000),
          metadata: { userId: "user_a" },
        }),
      ],
      events: [
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt).toISOString(),
        }),
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt + 1_000).toISOString(),
          metadata: { vimeo_video_id: OTHER },
        }),
        event({
          event_type: "homepage_video_started",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 3_000).toISOString(),
        }),
        event({
          event_type: "homepage_video_50",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 2_000).toISOString(),
        }),
        event({
          event_type: "homepage_video_completed",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 1_000).toISOString(),
        }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v1",
          occurred_at: new Date(reachedAt - 1_500).toISOString(),
          metadata: { cta_surface: "homepage_video" },
        }),
        event({
          event_type: "homepage_video_reached",
          visitor_id: "v2",
          occurred_at: new Date(reachedAt).toISOString(),
          metadata: { vimeo_video_id: OTHER },
        }),
        event({
          event_type: "homepage_video_started",
          visitor_id: "v2",
          occurred_at: new Date(otherFiftyAt).toISOString(),
          metadata: { vimeo_video_id: VIDEO },
        }),
        event({
          event_type: "homepage_video_50",
          visitor_id: "v2",
          occurred_at: new Date(otherFiftyAt).toISOString(),
          metadata: { vimeo_video_id: VIDEO },
        }),
        event({
          event_type: "homepage_video_completed",
          visitor_id: "v2",
          occurred_at: new Date(otherFiftyAt).toISOString(),
          metadata: { vimeo_video_id: VIDEO },
        }),
        event({
          event_type: "trial_cta_clicked",
          visitor_id: "v2",
          occurred_at: new Date(otherFiftyAt + 1_000).toISOString(),
          metadata: { cta_surface: "homepage_video" },
        }),
      ],
    });

    expect(report.reached).toBe(2);
    expect(report.started).toBe(1);
    expect(report.watched50).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.videoCtaAfter50).toBe(1);
    expect(report.stripeTrialsAfter50).toBe(1);
  });

  it("does not show a zero rate when nobody reached the video", () => {
    const report = computeHomepageVideoReport({ ...base, events: [] });
    expect(report.reached).toBe(0);
    expect(report.startRate).toBeNull();
    expect(report.watched50Rate).toBeNull();
    expect(report.completionRate).toBeNull();
  });

  it("leaves the report unavailable when the event read is incomplete", () => {
    const report = computeHomepageVideoReport({ ...base, events: null });
    expect(report.available).toBe(false);
    expect(report.reached).toBeNull();
    expect(report.started).toBeNull();
  });

  it("does not let a homepage video row change the existing visitor cohort", () => {
    const page: MarketingEventRow = {
      event_type: "page_viewed",
      visitor_id: "v1",
      occurred_at: "2026-09-30T15:00:00.000Z",
      source_normalized: "direct",
      is_paid_acquisition: false,
      referrer_host: null,
      utm_source: null,
      utm_campaign: null,
      utm_content: null,
      clerk_user_id: null,
    };
    const video: MarketingEventRow = { ...page, event_type: "homepage_video_reached" };
    const args = {
      attributions: [],
      stripeSubs: [],
      onboardingCompletedAtByClerkId: new Map<string, string | null>(),
      sourceFilter: "all" as const,
      todayDateKey: "2026-09-30",
      marketingEventsComplete: true,
      stripeListComplete: true,
      attributionComplete: true,
      onboardingComplete: true,
    };
    const withoutVideo = computeVisitorCohortTable({ ...args, events: [page] });
    const withVideo = computeVisitorCohortTable({ ...args, events: [page, video] });
    expect(withVideo).toEqual(withoutVideo);
  });

  it("keeps homepage video rows out of the legacy event loader without changing older counts", () => {
    const loader = readFileSync(
      path.join(process.cwd(), "src/lib/admin-subscriber-growth.ts"),
      "utf8"
    );
    const legacyStart = loader.indexOf("async function loadMarketingEvents");
    const legacyEnd = loader.indexOf("async function loadScopedMarketingEvents");
    const legacy = loader.slice(legacyStart, legacyEnd);
    expect(legacy).toContain(
      '.not("event_type", "in", `(${HOMEPAGE_VIDEO_EVENT_TYPES.join(",")})`)'
    );
    expect(legacy).toContain(
      '"event_type, visitor_id, occurred_at, source_normalized, is_paid_acquisition, referrer_host, utm_source, utm_campaign, utm_content, clerk_user_id"'
    );
    expect(loader.slice(legacyEnd)).not.toContain(
      '.not("event_type", "in", `(${HOMEPAGE_VIDEO_EVENT_TYPES.join(",")})`)'
    );
    expect(loader).toContain("events: cohortMarketing.rows");
    expect(loader).toContain("loadHomepageVideoCohortEvents");
    expect(loader).not.toContain(
      '[...HOMEPAGE_VIDEO_EVENT_TYPES, "trial_cta_clicked"]'
    );

    const excluded = new Set<string>(HOMEPAGE_VIDEO_EVENT_TYPES);
    const rows: MarketingEventRow[] = [
      {
        event_type: "page_viewed",
        visitor_id: "v1",
        occurred_at: "2026-09-30T15:00:00.000Z",
        source_normalized: "direct",
        is_paid_acquisition: false,
        referrer_host: null,
        utm_source: null,
        utm_campaign: null,
        utm_content: null,
        clerk_user_id: null,
      },
      {
        event_type: "trial_cta_clicked",
        visitor_id: "v1",
        occurred_at: "2026-09-30T15:01:00.000Z",
        source_normalized: "direct",
        is_paid_acquisition: false,
        referrer_host: null,
        utm_source: null,
        utm_campaign: null,
        utm_content: null,
        clerk_user_id: null,
      },
      {
        event_type: "account_created",
        visitor_id: "v1",
        occurred_at: "2026-09-30T15:02:00.000Z",
        source_normalized: "direct",
        is_paid_acquisition: false,
        referrer_host: null,
        utm_source: null,
        utm_campaign: null,
        utm_content: null,
        clerk_user_id: "user_1",
      },
      ...HOMEPAGE_VIDEO_EVENT_TYPES.map((eventType) => ({
        event_type: eventType,
        visitor_id: "v1",
        occurred_at: "2026-09-30T15:03:00.000Z",
        source_normalized: "direct",
        is_paid_acquisition: false,
        referrer_host: null,
        utm_source: null,
        utm_campaign: null,
        utm_content: null,
        clerk_user_id: null,
      })),
    ];
    const kept = rows.filter((row) => !excluded.has(row.event_type));
    const count = (list: MarketingEventRow[], eventType: string) =>
      list.filter((row) => row.event_type === eventType).length;
    expect(count(kept, "page_viewed")).toBe(1);
    expect(count(kept, "page_viewed")).toBe(count(rows, "page_viewed"));
    expect(count(kept, "trial_cta_clicked")).toBe(count(rows, "trial_cta_clicked"));
    expect(count(kept, "account_created")).toBe(count(rows, "account_created"));
    expect(kept.some((row) => excluded.has(row.event_type))).toBe(false);

    const cohortArgs = {
      attributions: [],
      stripeSubs: [],
      onboardingCompletedAtByClerkId: new Map<string, string | null>(),
      sourceFilter: "all" as const,
      todayDateKey: "2026-09-30",
      marketingEventsComplete: true,
      stripeListComplete: true,
      attributionComplete: true,
      onboardingComplete: true,
    };
    expect(computeVisitorCohortTable({ ...cohortArgs, events: kept })).toEqual(
      computeVisitorCohortTable({ ...cohortArgs, events: rows })
    );
  });

  it("loads pre-window milestones for the in-window reached cohort only", async () => {
    const outcomeEndMs = WINDOW_END + 86_400_000 * 30;
    const reachedAt = WINDOW_START + 3_000;
    const t50 = WINDOW_START - 5_000;
    const calls: HomepageVideoScopedQuery[] = [];
    const stored = [
      event({
        event_type: "homepage_video_reached",
        visitor_id: "v_before",
        occurred_at: new Date(WINDOW_START - 1).toISOString(),
      }),
      event({
        event_type: "homepage_video_reached",
        visitor_id: "v1",
        occurred_at: new Date(reachedAt).toISOString(),
      }),
      event({
        event_type: "homepage_video_reached",
        visitor_id: "v_google",
        occurred_at: new Date(reachedAt).toISOString(),
        source_normalized: "google",
      }),
      event({
        event_type: "homepage_video_reached",
        visitor_id: "v2",
        occurred_at: new Date(reachedAt).toISOString(),
        metadata: { vimeo_video_id: OTHER },
      }),
      event({
        event_type: "homepage_video_reached",
        visitor_id: "v_after",
        occurred_at: new Date(WINDOW_END + 1_000).toISOString(),
      }),
      event({
        event_type: "homepage_video_started",
        visitor_id: "v1",
        occurred_at: new Date(WINDOW_START - 10_000).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "homepage_video_50",
        visitor_id: "v1",
        occurred_at: new Date(t50).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "homepage_video_completed",
        visitor_id: "v1",
        occurred_at: new Date(WINDOW_START - 4_000).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "trial_cta_clicked",
        visitor_id: "v1",
        occurred_at: new Date(t50 - 1).toISOString(),
        source_normalized: "direct",
        metadata: { cta_surface: "hero" },
      }),
      event({
        event_type: "trial_cta_clicked",
        visitor_id: "v1",
        occurred_at: new Date(WINDOW_START - 1_000).toISOString(),
        source_normalized: "direct",
        metadata: { cta_surface: "homepage_video" },
      }),
      event({
        event_type: "homepage_video_started",
        visitor_id: "v2",
        occurred_at: new Date(WINDOW_START - 20_000).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "homepage_video_50",
        visitor_id: "v2",
        occurred_at: new Date(WINDOW_START - 19_000).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "homepage_video_completed",
        visitor_id: "v2",
        occurred_at: new Date(WINDOW_START - 18_000).toISOString(),
        source_normalized: "direct",
      }),
      event({
        event_type: "trial_cta_clicked",
        visitor_id: "v2",
        occurred_at: new Date(WINDOW_START - 17_000).toISOString(),
        source_normalized: "direct",
        metadata: { cta_surface: "homepage_video" },
      }),
      event({
        event_type: "homepage_video_started",
        visitor_id: "v_google",
        occurred_at: new Date(WINDOW_START - 10_000).toISOString(),
        source_normalized: "direct",
      }),
    ];

    const events = await loadHomepageVideoCohortEvents({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      outcomeEndMs,
      source: "meta_ads",
      query: async (scoped) => {
        calls.push(scoped);
        return {
          rows: stored.filter((row) => rowMatchesScopedQuery(row, scoped)),
          complete: true,
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      eventTypes: ["homepage_video_reached"],
      startMs: WINDOW_START,
      endMs: WINDOW_END,
      visitorIds: null,
    });
    expect(calls[1]).toEqual({
      eventTypes: [
        "homepage_video_started",
        "homepage_video_50",
        "homepage_video_completed",
        "trial_cta_clicked",
      ],
      startMs: null,
      endMs: outcomeEndMs,
      visitorIds: ["v1", "v2"],
    });

    const report = computeHomepageVideoReport({ ...base, events });
    expect(report.reached).toBe(2);
    expect(report.started).toBe(1);
    expect(report.watched50).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.videoCtaAfter50).toBe(1);
    expect(report.anyCtaAfter50).toBe(1);

    const loader = readFileSync(
      path.join(process.cwd(), "src/lib/admin-subscriber-growth.ts"),
      "utf8"
    );
    const pageFn = loader.slice(
      loader.indexOf("async function pageHomepageVideoEvents"),
      loader.indexOf("async function loadScopedMarketingEvents")
    );
    const followFn = loader.slice(
      loader.indexOf("async function loadScopedMarketingEvents"),
      loader.indexOf("async function loadInstrumentationStartMs")
    );
    expect(pageFn).toContain("if (args.startMs != null)");
    expect(pageFn).toContain('.in("visitor_id", [...args.visitorIds])');
    expect(followFn).toContain("chunkClerkIds(args.visitorIds)");
    expect(followFn).toContain("if (!page.complete) return { rows: [], complete: false }");
    expect(loader).toContain("events: videoEvents,");
  });

  it("does not query outcomes when nobody reached the video inside the window", async () => {
    const calls: HomepageVideoScopedQuery[] = [];
    const events = await loadHomepageVideoCohortEvents({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      outcomeEndMs: WINDOW_END + 1_000,
      source: "meta_ads",
      query: async (scoped) => {
        calls.push(scoped);
        return {
          rows: [
            event({
              event_type: "homepage_video_reached",
              visitor_id: "v_before",
              occurred_at: new Date(WINDOW_START - 1).toISOString(),
            }),
          ].filter((row) => rowMatchesScopedQuery(row, scoped)),
          complete: true,
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].eventTypes).toEqual(["homepage_video_reached"]);
    expect(events).toEqual([]);
    const report = computeHomepageVideoReport({ ...base, events });
    expect(report.available).toBe(true);
    expect(report.reached).toBe(0);
    expect(report.started).toBe(0);
    expect(report.startRate).toBeNull();
    expect(report.videoCtaRate).toBeNull();
  });

  it("leaves the report unavailable when a follow-up read is truncated", async () => {
    const calls: HomepageVideoScopedQuery[] = [];
    const events = await loadHomepageVideoCohortEvents({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      outcomeEndMs: WINDOW_END + 1_000,
      source: "meta_ads",
      query: async (scoped) => {
        calls.push(scoped);
        if (scoped.visitorIds != null) {
          return {
            rows: [
              event({
                event_type: "homepage_video_started",
                visitor_id: "v1",
                occurred_at: new Date(WINDOW_START - 10_000).toISOString(),
              }),
            ],
            complete: false,
          };
        }
        return {
          rows: [
            event({
              event_type: "homepage_video_reached",
              visitor_id: "v1",
              occurred_at: new Date(WINDOW_START + 3_000).toISOString(),
            }),
          ],
          complete: true,
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(events).toBeNull();
    const report = computeHomepageVideoReport({ ...base, events });
    expect(report.available).toBe(false);
    expect(report.reached).toBeNull();
    expect(report.started).toBeNull();
    expect(report.watched50).toBeNull();
    expect(report.videoCtaAfter50).toBeNull();
  });

  it("does not follow up when the reached read itself is truncated", async () => {
    const calls: HomepageVideoScopedQuery[] = [];
    const events = await loadHomepageVideoCohortEvents({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      outcomeEndMs: WINDOW_END + 1_000,
      source: "all",
      query: async (scoped) => {
        calls.push(scoped);
        return {
          rows: [
            event({
              event_type: "homepage_video_reached",
              visitor_id: "v1",
              occurred_at: new Date(WINDOW_START + 3_000).toISOString(),
            }),
          ],
          complete: false,
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(events).toBeNull();
    const report = computeHomepageVideoReport({ ...base, events });
    expect(report.available).toBe(false);
    expect(report.reached).toBeNull();
  });
});

function rowMatchesScopedQuery(
  row: HomepageVideoEventInput,
  scoped: HomepageVideoScopedQuery
): boolean {
  if (!scoped.eventTypes.includes(row.event_type)) return false;
  const at = Date.parse(row.occurred_at);
  if (!Number.isFinite(at)) return false;
  if (scoped.startMs != null && at < scoped.startMs) return false;
  if (at >= scoped.endMs) return false;
  if (scoped.visitorIds != null && !scoped.visitorIds.includes(row.visitor_id)) return false;
  return true;
}
