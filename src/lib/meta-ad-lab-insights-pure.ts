/**
 * Pure Meta Ads Insights parsing. No network and no access token.
 * This is not the Conversions API client.
 */

import {
  addDaysToDateKey,
  parseGrowthDateRange,
  SUBSCRIBER_GROWTH_TZ,
  type GrowthDateRange,
} from "@/lib/admin-subscriber-growth-pure";

export const META_AD_LAB_GRAPH_VERSION = "v27.0" as const;
export const META_AD_LAB_ROW_LIMIT = 100;
export const META_AD_LAB_ALL_TIME_CAP_DAYS = 30;
export const META_AD_LAB_TIMEOUT_MS = 8000;
export const META_AD_LAB_FULL_FIELDS =
  "ad_id,ad_name,spend,impressions,outbound_clicks,actions" as const;
export const META_AD_LAB_CORE_FIELDS = "ad_id,ad_name,spend,impressions" as const;

export type MetaAdInsightRow = {
  adId: string;
  adName: string;
  date: string;
  spend: string | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
};

export type MetaAdLabInsightsResult =
  | {
      status: "ok";
      since: string;
      until: string;
      rangeNote: string | null;
      fetchedAt: string;
      rows: MetaAdInsightRow[];
      truncated: boolean;
      fields: "full" | "core";
    }
  | {
      status: "unconfigured";
      missing: Array<"token" | "account">;
      since: string;
      until: string;
      rangeNote: string | null;
    }
  | {
      status: "error";
      since: string;
      until: string;
      rangeNote: string | null;
      fetchedAt: string;
      httpStatus: number | null;
      code: number | null;
      message: string;
    };

export function metaAdLabWindow(
  range: GrowthDateRange,
  todayKey: string
): { since: string; until: string; rangeNote: string | null } {
  if (range === "all_time") {
    return {
      since: addDaysToDateKey(todayKey, -(META_AD_LAB_ALL_TIME_CAP_DAYS - 1)),
      until: todayKey,
      rangeNote: `All time is not requested from Meta. This read covers the last ${META_AD_LAB_ALL_TIME_CAP_DAYS} days.`,
    };
  }
  const offset = range === "today" ? 0 : range === "last_7" ? -6 : -29;
  return {
    since: addDaysToDateKey(todayKey, offset),
    until: todayKey,
    rangeNote: null,
  };
}

export function normalizeMetaAdAccountId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^act_/i, "");
  if (!/^\d{5,20}$/.test(trimmed)) return null;
  return trimmed;
}

export function buildMetaInsightsUrl(args: {
  accountId: string;
  since: string;
  until: string;
  fields: string;
  limit?: number;
}): string {
  const url = new URL(
    `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_${args.accountId}/insights`
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: args.since, until: args.until }));
  url.searchParams.set("fields", args.fields);
  url.searchParams.set("limit", String(args.limit ?? META_AD_LAB_ROW_LIMIT));
  return url.toString();
}

export function redactMetaSecrets(text: string, secrets: readonly string[]): string {
  let out = text.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
  out = out.replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 8) continue;
    out = out.split(trimmed).join("[redacted]");
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 300);
}

function parseCount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function parseSpend(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw.toFixed(2);
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Number(trimmed).toFixed(2);
}

function sumActionValues(raw: unknown, actionType: string): number | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  let sum = 0;
  let matched = false;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { action_type?: unknown; value?: unknown };
    if (record.action_type !== actionType) continue;
    const count = parseCount(record.value);
    if (count == null) continue;
    matched = true;
    sum += count;
  }
  return matched ? sum : 0;
}

export function parseMetaInsightRows(payload: unknown): {
  rows: MetaAdInsightRow[];
  truncated: boolean;
} {
  const record =
    payload && typeof payload === "object" ? (payload as { data?: unknown; paging?: unknown }) : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const paging =
    record.paging && typeof record.paging === "object"
      ? (record.paging as { next?: unknown })
      : null;
  const rows: MetaAdInsightRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const adId = typeof row.ad_id === "string" && /^\d{5,20}$/.test(row.ad_id) ? row.ad_id : null;
    const date =
      typeof row.date_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date_start)
        ? row.date_start
        : null;
    if (!adId || !date) continue;
    const adName = typeof row.ad_name === "string" ? row.ad_name.trim().slice(0, 200) : "";
    rows.push({
      adId,
      adName: adName || "Untitled ad",
      date,
      spend: Object.prototype.hasOwnProperty.call(row, "spend") ? parseSpend(row.spend) : null,
      impressions: Object.prototype.hasOwnProperty.call(row, "impressions")
        ? parseCount(row.impressions)
        : null,
      outboundClicks: Object.prototype.hasOwnProperty.call(row, "outbound_clicks")
        ? sumActionValues(row.outbound_clicks, "outbound_click")
        : null,
      landingPageViews: Object.prototype.hasOwnProperty.call(row, "actions")
        ? sumActionValues(row.actions, "landing_page_view")
        : null,
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.adName.localeCompare(b.adName));
  return { rows, truncated: typeof paging?.next === "string" && paging.next.length > 0 };
}

export function readMetaGraphError(payload: unknown): { code: number | null; message: string } {
  const error =
    payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") {
    return { code: null, message: "Meta returned an unexpected response." };
  }
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "number" && Number.isFinite(record.code) ? record.code : null;
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : "Meta rejected the insights request.";
  return { code, message };
}

export function metaAdLabRangeFromQuery(raw: string | undefined | null): GrowthDateRange {
  return parseGrowthDateRange(raw);
}

export { SUBSCRIBER_GROWTH_TZ };
