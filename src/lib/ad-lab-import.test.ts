import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

import { runAdLabImport, type AdLabIdentity, type AdLabStore } from "@/lib/ad-lab-import";
import { readMetaPagingCursor } from "@/lib/meta-ad-lab-insights-pure";

const TOKEN = "meta-ad-lab-test-token-value";

function jsonResponse(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body) };
}

function store(existing: AdLabIdentity[] = []): AdLabStore & {
  commits: Array<{ ads: AdLabIdentity[]; days: unknown[] }>;
} {
  const commits: Array<{ ads: AdLabIdentity[]; days: unknown[] }> = [];
  return {
    commits,
    async readAds() {
      return { ok: true, ads: existing };
    },
    async commitImport(commit) {
      commits.push({ ads: [...commit.ads], days: [...commit.days] });
      return { ok: true };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_AD_LAB_ACCESS_TOKEN;
  delete process.env.META_AD_LAB_ACCOUNT_ID;
});

describe("runAdLabImport", () => {
  it("does not call Meta when the window is too long", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runAdLabImport({
      since: "2026-10-01",
      until: "2026-11-01",
      store: store(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("window");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a safe cursor, stores cents, and never requests paging.next", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              ad_id: "1111111111",
              ad_name: "Hook A",
              date_start: "2026-11-10",
              spend: "0",
              impressions: "10",
              outbound_clicks: [],
              actions: [{ action_type: "landing_page_view", value: "2" }],
              campaign_id: "3333333333",
              campaign_name: "Prospecting",
            },
          ],
          paging: {
            cursors: { after: "cursor_1" },
            next: "https://graph.facebook.com/v27.0/next?access_token=secret-token",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              ad_id: "2222222222",
              ad_name: "Hook B",
              date_start: "2026-11-10",
              spend: "1.25",
              impressions: "8",
            },
          ],
          paging: { cursors: {} },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: "1111111111",
              name: "Hook A",
              effective_status: "ACTIVE",
              campaign_id: "3333333333",
              campaign: { name: "Prospecting" },
              adset_id: "4444444444",
              adset: { name: "Broad" },
              creative: { id: "5555555555" },
            },
            {
              id: "2222222222",
              name: "Hook B",
              effective_status: "PAUSED",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-11",
      now: new Date("2026-11-11T16:00:00.000Z"),
      store: saved,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timezone).toBe("America/New_York");
      expect(result.currency).toBe("USD");
      expect(result.days).toBe(2);
      expect(result.statusUpdated).toBe(true);
    }
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("after=cursor_1"))).toBe(true);
    expect(urls.some((url) => url.includes("graph.facebook.com/v27.0/next"))).toBe(false);
    expect(urls.every((url) => !url.includes("access_token") && !url.includes(TOKEN))).toBe(true);
    const committed = JSON.stringify(saved.commits);
    expect(saved.commits).toHaveLength(1);
    expect(committed).toContain('"spendCents":0');
    expect(committed).toContain('"spendCents":125');
    expect(committed).toContain('"landingPageViews":null');
    expect(committed).toContain("statusCheckedAt");
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
  });

  it("saves nothing when another page has no safe cursor", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                ad_id: "1111111111",
                ad_name: "Hook A",
                date_start: "2026-11-10",
                spend: "2.00",
                impressions: "10",
              },
            ],
            paging: { next: "https://graph.facebook.com/next?access_token=secret-token" },
          })
        )
    );
    const cursor = readMetaPagingCursor({
      paging: { next: "https://graph.facebook.com/next?access_token=secret-token" },
    });
    expect(cursor.after).toBeNull();
    expect(cursor.hasNextUrl).toBe(true);
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      store: saved,
    });
    expect(result).toMatchObject({ ok: false, reason: "truncated" });
    expect(saved.commits).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("retries a transient failure once and still stores the delivery if status fails", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: "temporary", code: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              ad_id: "1111111111",
              ad_name: "Hook A",
              date_start: "2026-11-10",
              spend: null,
              impressions: "4",
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: `bad ${TOKEN}`, code: 190 } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      retryDelayMs: 0,
      store: saved,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.statusUpdated).toBe(false);
    expect(saved.commits[0]?.days).toEqual([
      expect.objectContaining({ metaAdId: "1111111111", spendCents: null, impressions: 4 }),
    ]);
    expect(saved.commits[0]?.ads[0]?.effectiveStatus).toBeNull();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("leaves previous rows untouched when storage fails", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const previous = storedAd();
    const failing: AdLabStore = {
      async readAds() {
        return { ok: true, ads: [previous] };
      },
      async commitImport() {
        return { ok: false };
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                ad_id: "1111111111",
                ad_name: "Hook A",
                date_start: "2026-11-10",
                spend: "1.00",
                impressions: "4",
              },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
    );
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      store: failing,
    });
    expect(result).toMatchObject({ ok: false, reason: "storage" });
    expect(previous.effectiveStatus).toBe("ACTIVE");
    expect(previous.statusCheckedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("clears Active when Insights still has an ad the complete status scan omitted", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store([storedAd()]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                ad_id: "1111111111",
                ad_name: "Hook A",
                date_start: "2026-11-10",
                spend: "1.00",
                impressions: "4",
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                id: "2222222222",
                name: "Other",
                effective_status: "ACTIVE",
              },
            ],
          })
        )
    );
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      now: new Date("2026-11-11T16:00:00.000Z"),
      store: saved,
    });
    expect(result).toMatchObject({ ok: true, statusUpdated: true });
    const cleared = saved.commits[0]?.ads.find((ad) => ad.metaAdId === "1111111111");
    expect(cleared?.effectiveStatus).toBeNull();
    expect(cleared?.statusCheckedAt).toBe("2026-11-11T16:00:00.000Z");
  });

  it("keeps the previous status when the status scan is incomplete", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store([storedAd()]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                ad_id: "1111111111",
                ad_name: "Hook A",
                date_start: "2026-11-10",
                spend: "1.00",
                impressions: "4",
              },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse(500, { error: { message: "unavailable", code: 1 } }))
        .mockResolvedValueOnce(jsonResponse(500, { error: { message: "unavailable", code: 1 } }))
    );
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      retryDelayMs: 0,
      store: saved,
    });
    expect(result).toMatchObject({ ok: true, statusUpdated: false });
    expect(saved.commits[0]?.ads[0]?.effectiveStatus).toBe("ACTIVE");
    expect(saved.commits[0]?.ads[0]?.statusCheckedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("commits ads and days once, and a retry overwrites the same keys", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const saved = store();
    const page = jsonResponse(200, {
      data: [
        {
          ad_id: "1111111111",
          ad_name: "Hook A",
          date_start: "2026-11-10",
          spend: "1.00",
          impressions: "4",
        },
      ],
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/ads?")) return Promise.resolve(jsonResponse(200, { data: [] }));
      if (String(url).includes("/insights?")) return Promise.resolve(page);
      return Promise.resolve(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      store: saved,
    });
    const second = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      store: saved,
    });
    expect(first.ok && second.ok).toBe(true);
    expect(saved.commits).toHaveLength(2);
    expect(saved.commits[0]?.days).toHaveLength(1);
    expect(saved.commits[1]?.days).toEqual(saved.commits[0]?.days);
    expect(saved.commits[0]?.ads.map((ad) => ad.metaAdId)).toEqual(["1111111111"]);
  });

  it("follows a base64 cursor that contains equals and never the next URL", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              ad_id: "1111111111",
              ad_name: "Hook A",
              date_start: "2026-11-10",
              spend: "1.00",
              impressions: "4",
            },
          ],
          paging: {
            cursors: { after: "YQ==" },
            next: "https://graph.facebook.com/v27.0/next?access_token=secret-token&after=YQ==",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runAdLabImport({
      since: "2026-11-10",
      until: "2026-11-10",
      store: store(),
    });
    expect(result.ok).toBe(true);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("after=YQ%3D%3D"))).toBe(true);
    expect(urls.some((url) => url.includes("graph.facebook.com/v27.0/next"))).toBe(false);
    expect(urls.every((url) => !url.includes("access_token"))).toBe(true);
  });

  it("does not let an older delivery window replace current metadata when status is unavailable", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const current = storedAd();
    current.adName = "Current name";
    current.firstSeenOn = "2026-11-10";
    current.lastSeenOn = "2026-11-11";
    current.metadataImportedAt = "2026-11-11T16:00:00.000Z";
    const saved = store([current]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { timezone_name: "America/New_York", currency: "USD" }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: [
              {
                ad_id: "1111111111",
                ad_name: "Historical name",
                campaign_id: "6666666666",
                campaign_name: "Old campaign",
                date_start: "2026-10-01",
                spend: "2.00",
                impressions: "8",
              },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse(500, { error: { message: "unavailable", code: 1 } }))
        .mockResolvedValueOnce(jsonResponse(500, { error: { message: "unavailable", code: 1 } }))
    );
    const result = await runAdLabImport({
      since: "2026-10-01",
      until: "2026-10-07",
      retryDelayMs: 0,
      store: saved,
    });
    expect(result).toMatchObject({ ok: true, statusUpdated: false });
    const ad = saved.commits[0]?.ads.find((row) => row.metaAdId === "1111111111");
    expect(ad?.firstSeenOn).toBe("2026-10-01");
    expect(ad?.lastSeenOn).toBe("2026-11-11");
    expect(ad?.adName).toBe("Current name");
    expect(ad?.campaignName).toBeNull();
    expect(ad?.effectiveStatus).toBe("ACTIVE");
    expect(ad?.statusCheckedAt).toBe("2026-11-09T12:00:00.000Z");
    expect(ad?.metadataImportedAt).toBe("2026-11-11T16:00:00.000Z");
    expect(saved.commits[0]?.days).toEqual([
      expect.objectContaining({ spendDate: "2026-10-01", spendCents: 200, adName: "Historical name" }),
    ]);
  });
});

function storedAd(): AdLabIdentity {
  return {
    metaAdId: "1111111111",
    adName: "Hook A",
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
}

describe("ad lab import sql", () => {
  it("writes both tables in one function and does not grant direct writes", () => {
    const sql = readFileSync("supabase/migrations/20261111153000_ad_lab_delivery.sql", "utf8");
    const storeSource = readFileSync("src/lib/ad-lab-store.ts", "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.ad_lab_import_batch");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog");
    expect(sql).not.toContain("SET search_path = public");
    expect(sql).toContain("pg_catalog.jsonb_to_recordset");
    expect(sql).toContain("LEAST(public.ad_lab_ads.first_seen_on, EXCLUDED.first_seen_on)");
    expect(sql).toContain("GREATEST(public.ad_lab_ads.last_seen_on, EXCLUDED.last_seen_on)");
    expect(sql).toContain("GREATEST(\n      public.ad_lab_ads.metadata_imported_at,");
    expect(sql).toContain("updated_at = GREATEST(public.ad_lab_ads.updated_at, EXCLUDED.updated_at)");
    expect(sql).not.toContain("pg_catalog.least");
    expect(sql).not.toContain("pg_catalog.greatest");
    expect(sql).toContain("EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at");
    expect(sql).not.toMatch(/EXECUTE\s+format/i);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) TO service_role");
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE");
    expect(sql).toContain("GRANT SELECT ON TABLE public.ad_lab_ads TO service_role");
    expect(storeSource).toContain("metadata_imported_at: ad.metadataImportedAt ?? commit.importedAt");
    expect(storeSource).toContain("ad_lab_import_batch");
    expect(storeSource).not.toContain("writeChunks");
    expect(storeSource).not.toContain(".upsert(");
  });
});
