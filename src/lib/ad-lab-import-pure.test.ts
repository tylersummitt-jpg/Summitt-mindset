import { describe, expect, it } from "vitest";

import {
  identitiesFromImport,
  importWindowAllowed,
  mondayOnOrBefore,
  spendDollarsToCents,
  summarizeAdLab,
  type AdLabIdentity,
  type AdLabStoredDay,
} from "@/lib/ad-lab-import-pure";
import type { MetaAdInsightRow } from "@/lib/meta-ad-lab-insights-pure";

function insight(partial: Partial<MetaAdInsightRow> & Pick<MetaAdInsightRow, "adId" | "date">): MetaAdInsightRow {
  return {
    adName: "Hook",
    spend: "1.00",
    impressions: 100,
    outboundClicks: 4,
    landingPageViews: 3,
    campaignId: "3333333333",
    campaignName: "Prospecting",
    adsetId: "4444444444",
    adsetName: "Broad",
    ...partial,
  };
}

function day(partial: Partial<AdLabStoredDay> & Pick<AdLabStoredDay, "metaAdId" | "spendDate">): AdLabStoredDay {
  return {
    adName: "Hook",
    spendCents: 100,
    impressions: 100,
    outboundClicks: 4,
    landingPageViews: 3,
    currency: "USD",
    accountTimezone: "America/New_York",
    importedAt: "2026-11-11T15:00:00.000Z",
    ...partial,
  };
}

describe("ad lab import rules", () => {
  it("keeps a 7-day window and rejects a longer one", () => {
    expect(importWindowAllowed("2026-11-04", "2026-11-10")).toBe(true);
    expect(importWindowAllowed("2026-11-04", "2026-11-11")).toBe(false);
    expect(importWindowAllowed("2026-11-10", "2026-11-04")).toBe(false);
  });

  it("starts the week on Monday", () => {
    expect(mondayOnOrBefore("2026-11-11")).toBe("2026-11-09");
    expect(mondayOnOrBefore("2026-11-09")).toBe("2026-11-09");
  });

  it("preserves missing spend and stores zero as zero cents", () => {
    expect(spendDollarsToCents(null)).toBeNull();
    expect(spendDollarsToCents("0.00")).toBe(0);
    expect(spendDollarsToCents("12.50")).toBe(1250);
    expect(spendDollarsToCents("12.5")).toBe(1250);
  });

  it("keeps the earliest seen date and the newest status", () => {
    const existing: AdLabIdentity = {
      metaAdId: "1111111111",
      adName: "Old name",
      campaignId: null,
      campaignName: null,
      adsetId: null,
      adsetName: null,
      effectiveStatus: "PAUSED",
      creativeId: null,
      firstSeenOn: "2026-10-01",
      lastSeenOn: "2026-10-02",
      statusCheckedAt: "2026-10-02T00:00:00.000Z",
    };
    const [merged] = identitiesFromImport({
      existing: [existing],
      seenOnFallback: "2026-11-11",
      statusCheckedAt: "2026-11-11T16:00:00.000Z",
      statuses: [
        {
          adId: "1111111111",
          adName: "New name",
          effectiveStatus: "ACTIVE",
          campaignId: "3333333333",
          campaignName: "Prospecting",
          adsetId: "4444444444",
          adsetName: "Broad",
          creativeId: "5555555555",
        },
      ],
      insights: [insight({ adId: "1111111111", date: "2026-11-10", spend: null, impressions: 0 })],
    });
    expect(merged?.firstSeenOn).toBe("2026-10-01");
    expect(merged?.lastSeenOn).toBe("2026-11-10");
    expect(merged?.effectiveStatus).toBe("ACTIVE");
    expect(merged?.adName).toBe("New name");
    expect(merged?.creativeId).toBe("5555555555");
    expect(merged?.statusCheckedAt).toBe("2026-11-11T16:00:00.000Z");
  });

  it("summarizes any number of ads and withholds an active count without status", () => {
    const identities: AdLabIdentity[] = ["1111111111", "2222222222", "3333333333", "4444444444"].map(
      (metaAdId, index) => ({
        metaAdId,
        adName: `Ad ${index + 1}`,
        campaignId: null,
        campaignName: null,
        adsetId: null,
        adsetName: null,
        effectiveStatus: index === 3 ? null : "ACTIVE",
        creativeId: null,
        firstSeenOn: "2026-11-10",
        lastSeenOn: "2026-11-11",
        statusCheckedAt: null,
      })
    );
    const summary = summarizeAdLab({
      identities,
      timezone: "America/New_York",
      currency: "USD",
      todayKey: "2026-11-11",
      rangeSince: "2026-11-05",
      rangeUntil: "2026-11-11",
      now: new Date("2026-11-11T16:00:00.000Z"),
      days: [
        day({ metaAdId: "1111111111", spendDate: "2026-11-11", spendCents: 0, impressions: 10, outboundClicks: 0 }),
        day({
          metaAdId: "2222222222",
          spendDate: "2026-11-11",
          spendCents: null,
          impressions: null,
          outboundClicks: null,
        }),
        day({ metaAdId: "3333333333", spendDate: "2026-11-10", spendCents: 500 }),
        day({ metaAdId: "4444444444", spendDate: "2026-11-10", spendCents: 100 }),
      ],
    });
    expect(summary.ads).toHaveLength(4);
    expect(summary.activeCount).toBeNull();
    expect(summary.todaySpendCents).toBeNull();
    expect(summary.weekStart).toBe("2026-11-09");
    expect(summary.ads[0]?.spendCents).toBe(500);
    const zeroClicks = summary.ads.find((ad) => ad.metaAdId === "1111111111");
    expect(zeroClicks?.outboundCtr).toBe(0);
    expect(summary.ads.find((ad) => ad.metaAdId === "2222222222")?.outboundCtr).toBeNull();
  });

  it("counts active ads only when every stored ad has a status, and labels stale imports", () => {
    const identity: AdLabIdentity = {
      metaAdId: "1111111111",
      adName: "Hook",
      campaignId: null,
      campaignName: "Prospecting",
      adsetId: null,
      adsetName: null,
      effectiveStatus: "ACTIVE",
      creativeId: null,
      firstSeenOn: "2026-11-01",
      lastSeenOn: "2026-11-09",
      statusCheckedAt: "2026-11-11T15:00:00.000Z",
    };
    const summary = summarizeAdLab({
      identities: [identity],
      timezone: "America/New_York",
      currency: "USD",
      todayKey: "2026-11-11",
      rangeSince: "2026-11-11",
      rangeUntil: "2026-11-11",
      now: new Date("2026-11-11T16:00:00.000Z"),
      days: [
        day({
          metaAdId: "1111111111",
          spendDate: "2026-11-09",
          importedAt: "2026-11-09T12:00:00.000Z",
        }),
      ],
    });
    expect(summary.activeCount).toBe(1);
    expect(summary.todaySpendCents).toBeNull();
    expect(summary.stale).toBe(true);
    expect(summary.ads).toHaveLength(0);
  });

  it("drops Active for an insights ad omitted by a complete status scan", () => {
    const existing: AdLabIdentity = {
      metaAdId: "1111111111",
      adName: "Hook",
      campaignId: null,
      campaignName: null,
      adsetId: null,
      adsetName: null,
      effectiveStatus: "ACTIVE",
      creativeId: null,
      firstSeenOn: "2026-11-01",
      lastSeenOn: "2026-11-09",
      statusCheckedAt: "2026-11-09T12:00:00.000Z",
    };
    const [cleared] = identitiesFromImport({
      existing: [existing],
      statuses: [],
      statusCheckedAt: "2026-11-11T16:00:00.000Z",
      seenOnFallback: "2026-11-11",
      insights: [insight({ adId: "1111111111", date: "2026-11-10" })],
    });
    expect(cleared?.effectiveStatus).toBeNull();
    expect(cleared?.statusCheckedAt).toBe("2026-11-11T16:00:00.000Z");

    const [kept] = identitiesFromImport({
      existing: [existing],
      statuses: null,
      statusCheckedAt: null,
      seenOnFallback: "2026-11-11",
      insights: [insight({ adId: "1111111111", date: "2026-11-10" })],
    });
    expect(kept?.effectiveStatus).toBe("ACTIVE");
    expect(kept?.statusCheckedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("does not count a cleared ad as active and does not refresh a failed import", () => {
    const summary = summarizeAdLab({
      identities: [
        {
          metaAdId: "1111111111",
          adName: "Hook",
          campaignId: null,
          campaignName: null,
          adsetId: null,
          adsetName: null,
          effectiveStatus: null,
          creativeId: null,
          firstSeenOn: "2026-11-01",
          lastSeenOn: "2026-11-10",
          statusCheckedAt: "2026-11-11T16:00:00.000Z",
        },
      ],
      timezone: "America/New_York",
      currency: "USD",
      todayKey: "2026-11-11",
      rangeSince: "2026-11-10",
      rangeUntil: "2026-11-11",
      now: new Date("2026-11-11T16:00:00.000Z"),
      days: [day({ metaAdId: "1111111111", spendDate: "2026-11-10", importedAt: "2026-11-09T12:00:00.000Z" })],
    });
    expect(summary.activeCount).toBe(0);
    expect(summary.lastImportedAt).toBe("2026-11-09T12:00:00.000Z");
    expect(summary.stale).toBe(true);
  });

  it("gives a new ad its earliest and latest insight dates", () => {
    const [created] = identitiesFromImport({
      existing: [],
      statuses: null,
      statusCheckedAt: null,
      seenOnFallback: "2026-11-11",
      insights: [
        insight({ adId: "1111111111", date: "2026-11-11", adName: "Later" }),
        insight({ adId: "1111111111", date: "2026-11-09", adName: "Earlier" }),
      ],
    });
    expect(created?.firstSeenOn).toBe("2026-11-09");
    expect(created?.lastSeenOn).toBe("2026-11-11");
    expect(created?.adName).toBe("Later");
  });

  it("keeps current metadata when an older window arrives before the newer one is reapplied", () => {
    const current: AdLabIdentity = {
      metaAdId: "1111111111",
      adName: "Current name",
      campaignId: "3333333333",
      campaignName: "Current campaign",
      adsetId: "4444444444",
      adsetName: "Current ad set",
      effectiveStatus: "ACTIVE",
      creativeId: "5555555555",
      firstSeenOn: "2026-11-10",
      lastSeenOn: "2026-11-11",
      statusCheckedAt: "2026-11-11T16:00:00.000Z",
      metadataImportedAt: "2026-11-11T16:00:00.000Z",
    };
    const [olderFirst] = identitiesFromImport({
      existing: [current],
      statuses: null,
      statusCheckedAt: null,
      seenOnFallback: "2026-10-07",
      insights: [
        insight({
          adId: "1111111111",
          date: "2026-10-01",
          adName: "Historical name",
          campaignId: "6666666666",
          campaignName: "Old campaign",
          adsetId: "7777777777",
          adsetName: "Old ad set",
        }),
        insight({ adId: "1111111111", date: "2026-10-03", adName: "Historical name" }),
      ],
    });
    expect(olderFirst?.firstSeenOn).toBe("2026-10-01");
    expect(olderFirst?.lastSeenOn).toBe("2026-11-11");
    expect(olderFirst?.adName).toBe("Current name");
    expect(olderFirst?.campaignName).toBe("Current campaign");
    expect(olderFirst?.adsetName).toBe("Current ad set");
    expect(olderFirst?.creativeId).toBe("5555555555");
    expect(olderFirst?.effectiveStatus).toBe("ACTIVE");
    expect(olderFirst?.statusCheckedAt).toBe("2026-11-11T16:00:00.000Z");
    expect(olderFirst?.metadataImportedAt).toBe("2026-11-11T16:00:00.000Z");

    const [liveScan] = identitiesFromImport({
      existing: [current],
      statuses: [
        {
          adId: "1111111111",
          adName: "Renamed",
          effectiveStatus: "PAUSED",
          campaignId: "3333333333",
          campaignName: "Current campaign",
          adsetId: "4444444444",
          adsetName: "Current ad set",
          creativeId: "5555555555",
        },
      ],
      statusCheckedAt: "2026-11-12T16:00:00.000Z",
      seenOnFallback: "2026-10-07",
      insights: [insight({ adId: "1111111111", date: "2026-10-02", adName: "Historical name" })],
    });
    expect(liveScan?.firstSeenOn).toBe("2026-10-02");
    expect(liveScan?.lastSeenOn).toBe("2026-11-11");
    expect(liveScan?.adName).toBe("Renamed");
    expect(liveScan?.effectiveStatus).toBe("PAUSED");
    expect(liveScan?.statusCheckedAt).toBe("2026-11-12T16:00:00.000Z");
    expect(liveScan?.metadataImportedAt).toBeNull();
  });
});
