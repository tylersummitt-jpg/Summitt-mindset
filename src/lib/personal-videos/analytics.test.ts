import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import {
  buildPersonalVideoDistribution,
  formatStageRate,
  isPersonalVideoWatchPath,
  PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS,
  selectLatestPersonalVideoVisit,
} from "@/lib/personal-videos/analytics";
import type { GrowthStripeSubscription } from "@/lib/admin-subscriber-growth-pure";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sub(id: string, videoId: string, status: string, trialStart: number | null): GrowthStripeSubscription {
  return {
    id,
    status,
    trial_start: trialStart,
    trial_end: trialStart == null ? null : trialStart + 7 * DAY / 1000,
    metadata: { personalVideoId: videoId },
  };
}

describe("personal video analytics", () => {
  it("credits the latest ready visit inside 30 days and ignores older or unknown videos", () => {
    const ready = new Set([A, B]);
    expect(
      selectLatestPersonalVideoVisit(
        [
          { personalVideoId: A, occurredAtMs: NOW - 10 * DAY, eventId: "1" },
          { personalVideoId: B, occurredAtMs: NOW - 2 * DAY, eventId: "2" },
          { personalVideoId: A, occurredAtMs: NOW - 40 * DAY, eventId: "0" },
        ],
        NOW,
        ready
      )
    ).toBe(B);
    expect(
      selectLatestPersonalVideoVisit(
        [{ personalVideoId: A, occurredAtMs: NOW - PERSONAL_VIDEO_ATTRIBUTION_WINDOW_MS - 1, eventId: "1" }],
        NOW,
        ready
      )
    ).toBeNull();
    expect(
      selectLatestPersonalVideoVisit(
        [
          { personalVideoId: B, occurredAtMs: NOW - DAY, eventId: "2" },
          { personalVideoId: A, occurredAtMs: NOW - 2 * DAY, eventId: "1" },
        ],
        NOW,
        new Set([A])
      )
    ).toBe(A);
    expect(
      selectLatestPersonalVideoVisit(
        [
          { personalVideoId: A, occurredAtMs: NOW - DAY, eventId: "a" },
          { personalVideoId: A, occurredAtMs: NOW - DAY, eventId: "b" },
        ],
        NOW,
        ready
      )
    ).toBe(A);
  });

  it("measures link visit rate from sent links with a visit, not from unique visitors", () => {
    const report = buildPersonalVideoDistribution({
      videos: [
        { id: A, createdAt: "2026-10-01T00:00:00.000Z", linkSentAt: "2026-10-02T00:00:00.000Z" },
        { id: B, createdAt: "2026-10-03T00:00:00.000Z", linkSentAt: "2026-10-04T00:00:00.000Z" },
      ],
      events: [
        { personalVideoId: A, visitorId: "v1", eventType: "personal_video_visited" },
        { personalVideoId: A, visitorId: "v1", eventType: "personal_video_played" },
        { personalVideoId: A, visitorId: "v2", eventType: "personal_video_visited" },
        { personalVideoId: A, visitorId: "v1", eventType: "personal_video_cta_clicked" },
      ],
      subscriptions: [sub("sub_1", A, "trialing", Math.floor(NOW / 1000))],
      subscriptionsComplete: true,
    });
    expect(report.linksSent).toBe(2);
    expect(report.linksVisited).toBe(1);
    expect(report.linkVisitRate).toBe(formatStageRate(1, 2, "links marked sent"));
    expect(report.uniqueVisitors).toBe("2");
    expect(report.linkVisitRate).not.toContain("2 / 2");
    expect(report.trials).toBe("1");
    expect(report.paid).toBe("Not available");
    expect(report.paidRate).toBe("Not available");
    expect(report.rows.find((row) => row.id === A)?.paid).toBeNull();
    expect(report.rows[0]?.id).toBe(B);
    expect(report.rows[1]?.visitors).toBe(2);
    expect(isPersonalVideoWatchPath("/for/abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
    expect(isPersonalVideoWatchPath("/")).toBe(false);
  });

  it("counts a personal-video payment only from a positive invoice and leaves missing invoices unavailable", () => {
    const trialEnd = Math.floor(NOW / 1000) - 86_400;
    const trialStart = trialEnd - 7 * 86_400;
    const paidThenCanceled = sub("sub_paid", A, "canceled", trialStart);
    paidThenCanceled.trial_end = trialEnd;
    paidThenCanceled.canceled_at = trialEnd + 86_400;
    paidThenCanceled.ended_at = trialEnd + 86_400;
    const pastDue = sub("sub_due", A, "past_due", trialStart);
    pastDue.trial_end = trialEnd;
    const videos = [{ id: A, createdAt: "2026-10-01T00:00:00.000Z", linkSentAt: null }];

    const missing = buildPersonalVideoDistribution({
      videos,
      events: [],
      subscriptions: [paidThenCanceled, pastDue],
      subscriptionsComplete: true,
    });
    expect(missing.trials).toBe("2");
    expect(missing.paid).toBe("Not available");
    expect(missing.rows[0]?.paid).toBeNull();

    const confirmed = buildPersonalVideoDistribution({
      videos,
      events: [],
      subscriptions: [paidThenCanceled, pastDue],
      subscriptionsComplete: true,
      paymentsReadable: true,
      paidInvoiceSubIds: new Set(["sub_paid"]),
    });
    expect(confirmed.paid).toBe("1");
    expect(confirmed.rows[0]?.paid).toBe(1);

    const nonePaid = buildPersonalVideoDistribution({
      videos,
      events: [],
      subscriptions: [pastDue],
      subscriptionsComplete: true,
      paymentsReadable: true,
      paidInvoiceSubIds: new Set(),
    });
    expect(nonePaid.paid).toBe("0");
    expect(nonePaid.paid).not.toBe("Not available");
  });

  it("keeps checkout, acquisition cookies, and admin exclusion in place", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const start = readFileSync("src/app/api/checkout/stripe-first/start/route.ts", "utf8");
    const cookies = readFileSync("src/lib/marketing-middleware-cookies.ts", "utf8");
    const collect = readFileSync("src/app/api/marketing/collect/route.ts", "utf8");
    const growth = readFileSync("src/lib/admin-subscriber-growth.ts", "utf8");
    const visitorCookie = cookies.slice(cookies.indexOf("function attachPersonalVideoVisitorCookie"));
    expect(activate).toContain("trial_period_days: 7");
    expect(activate).toContain("utm_source: args.attribution.utmSource");
    expect(activate).toContain("parsePersonalVideoId");
    expect(start).toContain("latestReadyPersonalVideoId");
    expect(start).toContain("publicCheckout: true");
    expect(visitorCookie).not.toContain("SM_ACQ_COOKIE");
    expect(cookies).toContain("SM_ACQ_COOKIE");
    expect(collect).toContain("isTylerAdminSession");
    expect(collect.indexOf("isTylerAdminSession")).toBeLessThan(collect.indexOf("insertPersonalVideoEvent"));
    expect(growth).toContain("PERSONAL_VIDEO_EVENT_TYPES");
    expect(readFileSync("src/app/admin/personal-videos/personal-videos-client.tsx", "utf8")).toContain(
      "Mark as sent"
    );
    expect(readFileSync("src/app/admin/operating-screen.tsx", "utf8")).toContain("Personal Videos");
    expect(readFileSync("src/app/for/[token]/page.tsx", "utf8")).toContain('"/checkout/start"');
    expect(readFileSync("src/app/for/[token]/page.tsx", "utf8")).toContain("buildVimeoPlayerEmbedUrl");
  });
});
