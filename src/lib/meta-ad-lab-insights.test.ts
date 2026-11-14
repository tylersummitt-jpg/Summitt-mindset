import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  META_AD_LAB_GRAPH_VERSION,
  buildMetaInsightsUrl,
  metaAdLabWindow,
  normalizeMetaAdAccountId,
  parseMetaInsightRows,
  parseVisibleAdAccountIds,
  readMetaGraphError,
  redactMetaSecrets,
} from "@/lib/meta-ad-lab-insights-pure";
import { loadMetaAdLabInsights } from "@/lib/meta-ad-lab-insights";

const TOKEN = "meta-ad-lab-test-token-value";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_AD_LAB_ACCESS_TOKEN;
  delete process.env.META_AD_LAB_ACCOUNT_ID;
});

describe("meta ad lab insights parsing", () => {
  it("keeps the conversions client on its own token and version", () => {
    const capi = readFileSync("src/lib/meta-capi.ts", "utf8");
    const insights = readFileSync("src/lib/meta-ad-lab-insights.ts", "utf8");
    expect(capi).toContain('META_CAPI_GRAPH_VERSION = "v21.0"');
    expect(capi).not.toContain("META_AD_LAB");
    expect(insights).toContain("META_AD_LAB_ACCESS_TOKEN");
    expect(insights).not.toContain("META_CAPI_ACCESS_TOKEN");
    expect(insights).toContain("Authorization");
    expect(insights).not.toContain("access_token");
  });

  it("parses ad-day spend, impressions, outbound clicks, and landing-page views", () => {
    const parsed = parseMetaInsightRows({
      data: [
        {
          ad_id: "1111111111",
          ad_name: "Hook A",
          date_start: "2026-11-10",
          spend: "12.50",
          impressions: "400",
          outbound_clicks: [{ action_type: "outbound_click", value: "9" }],
          actions: [
            { action_type: "link_click", value: "11" },
            { action_type: "landing_page_view", value: "7" },
          ],
        },
      ],
      paging: { next: "https://graph.facebook.com/next?access_token=secret-token" },
    });
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows).toEqual([
      {
        adId: "1111111111",
        adName: "Hook A",
        date: "2026-11-10",
        spend: "12.50",
        impressions: 400,
        outboundClicks: 9,
        landingPageViews: 7,
        campaignId: null,
        campaignName: null,
        adsetId: null,
        adsetName: null,
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("access_token");
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
  });

  it("leaves a missing metric blank and treats a present empty action list as zero", () => {
    const parsed = parseMetaInsightRows({
      data: [
        {
          ad_id: "2222222222",
          ad_name: "Hook B",
          date_start: "2026-11-09",
          spend: "0",
          impressions: "10",
          outbound_clicks: [],
        },
      ],
    });
    expect(parsed.rows[0]).toMatchObject({
      spend: "0.00",
      impressions: 10,
      outboundClicks: 0,
      landingPageViews: null,
    });
  });

  it("builds a read URL without the access token", () => {
    const url = buildMetaInsightsUrl({
      accountId: "1234567890",
      since: "2026-11-04",
      until: "2026-11-10",
      fields: "ad_id,ad_name,spend,impressions",
    });
    expect(url).toContain(`graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_1234567890/insights`);
    expect(url).toContain("level=ad");
    expect(url).toContain("time_increment=1");
    expect(url).not.toContain("access_token");
    expect(url).not.toContain(TOKEN);
  });

  it("uses the selected growth range and caps all time", () => {
    expect(metaAdLabWindow("last_7", "2026-11-10")).toEqual({
      since: "2026-11-04",
      until: "2026-11-10",
      rangeNote: null,
    });
    expect(metaAdLabWindow("all_time", "2026-11-10").since).toBe("2026-10-12");
    expect(metaAdLabWindow("all_time", "2026-11-10").rangeNote).toContain("last 30 days");
  });

  it("accepts only a numeric ad account id", () => {
    expect(normalizeMetaAdAccountId(" act_2269585583831138 ")).toBe("2269585583831138");
    expect(normalizeMetaAdAccountId("not-an-account")).toBeNull();
  });

  it("keeps the permission subcode and drops an unsafe trace id", () => {
    expect(
      readMetaGraphError({
        error: {
          message: "Ad account owner has NOT grant ads_read permission",
          type: "OAuthException",
          code: 200,
          error_subcode: 1815066,
          fbtrace_id: "safe_trace",
        },
      })
    ).toEqual({
      code: 200,
      subcode: 1815066,
      type: "OAuthException",
      fbtraceId: "safe_trace",
      message: "Ad account owner has NOT grant ads_read permission",
    });
    expect(
      readMetaGraphError({
        error: { code: 200, fbtrace_id: `bad ${TOKEN}`, type: "not a token" },
      }).fbtraceId
    ).toBeNull();
  });

  it("does not treat an unreadable account list as proof the account is missing", () => {
    expect(parseVisibleAdAccountIds({ data: [{ id: "act_2269585583831138" }] })).toEqual({
      ids: null,
      complete: false,
    });
    expect(parseVisibleAdAccountIds({ data: [], paging: { next: "https://graph.facebook.com/next" } })).toEqual({
      ids: [],
      complete: false,
    });
  });

  it("strips the token from an error message", () => {
    const message = redactMetaSecrets(
      `OAuth failed for ${TOKEN} at https://graph.facebook.com/path?access_token=${TOKEN}`,
      [TOKEN]
    );
    expect(message).not.toContain(TOKEN);
    expect(message).toContain("[redacted]");
  });
});

describe("loadMetaAdLabInsights", () => {
  it("reports missing configuration without calling Meta", async () => {
    delete process.env.META_AD_LAB_ACCESS_TOKEN;
    delete process.env.META_AD_LAB_ACCOUNT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadMetaAdLabInsights({
      range: "today",
      now: new Date("2026-11-10T16:00:00.000Z"),
    });
    expect(result.status).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token only in the Authorization header", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "act_1234567890";
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              ad_id: "1234567890",
              ad_name: "Sample",
              date_start: "2026-11-10",
              spend: "3.00",
              impressions: "20",
              outbound_clicks: [{ action_type: "outbound_click", value: "1" }],
              actions: [{ action_type: "landing_page_view", value: "1" }],
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadMetaAdLabInsights({
      range: "today",
      now: new Date("2026-11-10T16:00:00.000Z"),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.spend).toBe("3.00");
    }
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain("access_token");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("returns a sanitized permission error and leaves the caller with a result", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: `Invalid token ${TOKEN}`,
              code: 190,
            },
          }),
      })
    );
    const result = await loadMetaAdLabInsights({
      range: "last_7",
      now: new Date("2026-11-10T16:00:00.000Z"),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe(190);
      expect(result.httpStatus).toBe(400);
      expect(result.message).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it("records the insights error and a read-only token check without the token", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "act_2269585583831138";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/insights")) {
        return {
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                message: `(#200) Ad account owner has NOT granted ads_management or ads_read permission for ${TOKEN}`,
                type: "OAuthException",
                code: 200,
                error_subcode: 1815066,
                fbtrace_id: "AbCdEf",
              },
            }),
        };
      }
      if (url.endsWith("/me?fields=id,name")) {
        return { status: 200, text: async () => JSON.stringify({ id: "9001", name: "Summitt Ad Lab" }) };
      }
      if (url.endsWith("/me/permissions")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [
                { permission: "ads_read", status: "granted" },
                { permission: "public_profile", status: "declined" },
              ],
            }),
        };
      }
      if (url.includes("/me/adaccounts")) {
        return {
          status: 200,
          text: async () => JSON.stringify({ data: [{ account_id: "1111111111", name: "Other" }] }),
        };
      }
      throw new Error("unexpected url");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadMetaAdLabInsights({
      range: "today",
      now: new Date("2026-11-14T12:17:00.000Z"),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.httpStatus).toBe(400);
      expect(result.code).toBe(200);
      expect(result.subcode).toBe(1815066);
      expect(result.errorType).toBe("OAuthException");
      expect(result.fbtraceId).toBe("AbCdEf");
      expect(result.accountId).toBe("2269585583831138");
      expect(result.message).toContain("NOT granted");
      expect(result.access.accountMatchesExpected).toBe(true);
      expect(result.access.authorization).toBe("bearer");
      expect(result.access.graphVersion).toBe("v27.0");
      expect(result.access.systemUserId).toBe("9001");
      expect(result.access.grantedScopes).toEqual(["ads_read"]);
      expect(result.access.targetAccountListed).toBe(false);
    }
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/insights"))).toBe(true);
    expect(urls.some((url) => url.includes("access_token"))).toBe(false);
    expect(urls.join(" ")).not.toContain(TOKEN);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('"step":"insights"');
    expect(logged).toContain("1815066");
    expect(logged).toContain("2269585583831138");
    expect(logged).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    warn.mockRestore();
  });

  it("keeps Meta's insights error when the account list and token check fail", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "2269585583831138";
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/insights")) {
        return {
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                message: "(#200) Ad account owner has NOT granted ads_read permission",
                type: "OAuthException",
                code: 200,
                error_subcode: 1815066,
                fbtrace_id: "TraceOnly",
              },
            }),
        };
      }
      if (String(url).includes("/me/adaccounts")) {
        return {
          status: 400,
          text: async () =>
            JSON.stringify({
              error: { message: `account list failed ${TOKEN}`, code: 200 },
            }),
        };
      }
      throw new Error(`token check failed ${TOKEN}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadMetaAdLabInsights({
      range: "today",
      now: new Date("2026-11-14T12:17:00.000Z"),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.httpStatus).toBe(400);
      expect(result.code).toBe(200);
      expect(result.subcode).toBe(1815066);
      expect(result.message).toBe("(#200) Ad account owner has NOT granted ads_read permission");
      expect(result.access.targetAccountListed).toBeNull();
      expect(result.access.note).not.toContain(TOKEN);
    }
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("retries once with the core fields when Meta rejects an extra field", async () => {
    process.env.META_AD_LAB_ACCESS_TOKEN = TOKEN;
    process.env.META_AD_LAB_ACCOUNT_ID = "1234567890";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { message: "Tried accessing nonexisting field (outbound_clicks)", code: 100 },
          }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                ad_id: "1234567890",
                ad_name: "Core only",
                date_start: "2026-11-10",
                spend: "1.00",
                impressions: "5",
              },
            ],
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadMetaAdLabInsights({
      range: "today",
      now: new Date("2026-11-10T16:00:00.000Z"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.fields).toBe("core");
      expect(result.rows[0]?.outboundClicks).toBeNull();
      expect(result.rows[0]?.landingPageViews).toBeNull();
    }
    const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain("ad_id%2Cad_name%2Cspend%2Cimpressions");
    expect(secondUrl).not.toContain("outbound_clicks");
  });
});
