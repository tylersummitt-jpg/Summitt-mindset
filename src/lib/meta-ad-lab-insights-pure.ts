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
export const META_AD_LAB_EXPECTED_ACCOUNT_ID = "2269585583831138";
export const META_AD_LAB_ROW_LIMIT = 100;
export const META_AD_LAB_MAX_PAGES = 5;
export const META_AD_LAB_ALL_TIME_CAP_DAYS = 30;
export const META_AD_LAB_TIMEOUT_MS = 8000;
export const META_AD_LAB_FULL_FIELDS =
  "ad_id,ad_name,spend,impressions,outbound_clicks,actions" as const;
export const META_AD_LAB_CORE_FIELDS = "ad_id,ad_name,spend,impressions" as const;
export const META_AD_LAB_IMPORT_FIELDS =
  "ad_id,ad_name,spend,impressions,outbound_clicks,actions,campaign_id,campaign_name,adset_id,adset_name" as const;
export const META_AD_STATUS_FIELDS =
  "id,name,effective_status,campaign_id,adset_id,creative{id},campaign{name},adset{name}" as const;

export type MetaAdInsightRow = {
  adId: string;
  adName: string;
  date: string;
  spend: string | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
};

export type MetaAdLabAccessCheck = {
  accountId: string | null;
  accountMatchesExpected: boolean;
  tokenPresent: boolean;
  graphVersion: typeof META_AD_LAB_GRAPH_VERSION;
  endpoint: "insights";
  authorization: "bearer";
  systemUserId: string | null;
  systemUserName: string | null;
  grantedScopes: string[] | null;
  visibleAdAccountIds: string[] | null;
  targetAccountListed: boolean | null;
  note: string | null;
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
      subcode: number | null;
      errorType: string | null;
      fbtraceId: string | null;
      accountId: string | null;
      message: string;
      access: MetaAdLabAccessCheck;
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
  after?: string | null;
}): string {
  const url = new URL(
    `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_${args.accountId}/insights`
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: args.since, until: args.until }));
  url.searchParams.set("fields", args.fields);
  url.searchParams.set("limit", String(args.limit ?? META_AD_LAB_ROW_LIMIT));
  const after = safeMetaCursor(args.after);
  if (after) url.searchParams.set("after", after);
  return url.toString();
}

export function buildMetaAdAccountUrl(accountId: string): string {
  const url = new URL(
    `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_${accountId}`
  );
  url.searchParams.set("fields", "timezone_name,currency");
  return url.toString();
}

export function buildMetaAdsUrl(accountId: string, after?: string | null): string {
  const url = new URL(
    `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_${accountId}/ads`
  );
  url.searchParams.set("fields", META_AD_STATUS_FIELDS);
  url.searchParams.set("limit", String(META_AD_LAB_ROW_LIMIT));
  const cursor = safeMetaCursor(after);
  if (cursor) url.searchParams.set("after", cursor);
  return url.toString();
}

export function safeMetaCursor(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 1024) return null;
  if (/[\s?#&]/.test(trimmed) || trimmed.includes("://") || /access_token/i.test(trimmed)) {
    return null;
  }
  if (!/^[A-Za-z0-9+/_=-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function parseMetaIdentity(
  payload: unknown
): { id: string | null; name: string | null } {
  if (!payload || typeof payload !== "object") return { id: null, name: null };
  const record = payload as { id?: unknown; name?: unknown };
  const id = typeof record.id === "string" && /^\d{1,32}$/.test(record.id) ? record.id : null;
  const name =
    typeof record.name === "string"
      ? record.name.replace(/\s+/g, " ").trim().slice(0, 80)
      : null;
  return { id, name: name && name.length > 0 ? name : null };
}

export function parseGrantedScopes(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const scopes: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as { permission?: unknown; status?: unknown };
    if (row.status !== "granted" || typeof row.permission !== "string") continue;
    if (!/^[a-z0-9_]{1,64}$/.test(row.permission)) continue;
    if (!scopes.includes(row.permission)) scopes.push(row.permission);
    if (scopes.length >= 30) break;
  }
  return scopes;
}

export function parseVisibleAdAccountIds(payload: unknown): {
  ids: string[] | null;
  complete: boolean;
} {
  if (!payload || typeof payload !== "object") return { ids: null, complete: true };
  const record = payload as { data?: unknown; paging?: { next?: unknown } };
  if (!Array.isArray(record.data)) return { ids: null, complete: true };
  const ids: string[] = [];
  for (const item of record.data) {
    if (!item || typeof item !== "object") continue;
    const accountId = (item as { account_id?: unknown; id?: unknown }).account_id;
    const raw = typeof accountId === "string" ? accountId : null;
    if (!raw || !/^\d{5,20}$/.test(raw) || ids.includes(raw)) continue;
    ids.push(raw);
    if (ids.length >= 50) break;
  }
  if (ids.length === 0 && record.data.length > 0) return { ids: null, complete: false };
  return { ids, complete: !record.paging?.next };
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
      campaignId: digitId(row.campaign_id),
      campaignName: shortText(row.campaign_name),
      adsetId: digitId(row.adset_id),
      adsetName: shortText(row.adset_name),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.adName.localeCompare(b.adName));
  return { rows, truncated: typeof paging?.next === "string" && paging.next.length > 0 };
}

export function readMetaPagingCursor(payload: unknown): {
  after: string | null;
  hasNextUrl: boolean;
} {
  const record =
    payload && typeof payload === "object" ? (payload as { paging?: unknown }).paging : null;
  const paging = record && typeof record === "object" ? (record as { cursors?: unknown; next?: unknown }) : null;
  const cursors =
    paging?.cursors && typeof paging.cursors === "object"
      ? (paging.cursors as { after?: unknown })
      : null;
  return {
    after: safeMetaCursor(typeof cursors?.after === "string" ? cursors.after : null),
    hasNextUrl: typeof paging?.next === "string" && paging.next.length > 0,
  };
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

export function parseMetaAdAccount(payload: unknown): { timezone: string; currency: string } | null {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (!record) return null;
  const timezone = typeof record.timezone_name === "string" ? record.timezone_name.trim() : "";
  const currency = typeof record.currency === "string" ? record.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency) || ZERO_DECIMAL_CURRENCIES.has(currency)) return null;
  if (!isIanaTimezone(timezone)) return null;
  return { timezone, currency };
}

export type MetaAdStatusRow = {
  adId: string;
  adName: string;
  effectiveStatus: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  creativeId: string | null;
};

export function parseMetaAdsPage(payload: unknown): {
  ads: MetaAdStatusRow[];
  after: string | null;
  hasNextUrl: boolean;
} {
  const record =
    payload && typeof payload === "object" ? (payload as { data?: unknown }) : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const paging = readMetaPagingCursor(payload);
  const ads: MetaAdStatusRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const adId = digitId(row.id);
    if (!adId) continue;
    const creative =
      row.creative && typeof row.creative === "object"
        ? (row.creative as { id?: unknown })
        : null;
    const campaign =
      row.campaign && typeof row.campaign === "object"
        ? (row.campaign as { name?: unknown })
        : null;
    const adset =
      row.adset && typeof row.adset === "object" ? (row.adset as { name?: unknown }) : null;
    const status = typeof row.effective_status === "string" ? row.effective_status.trim() : "";
    ads.push({
      adId,
      adName: shortText(row.name) || "Untitled ad",
      effectiveStatus: /^[A-Z0-9_]{1,40}$/.test(status) ? status : null,
      campaignId: digitId(row.campaign_id),
      campaignName: shortText(campaign?.name),
      adsetId: digitId(row.adset_id),
      adsetName: shortText(adset?.name),
      creativeId: digitId(creative?.id),
    });
  }
  return { ads, after: paging.after, hasNextUrl: paging.hasNextUrl };
}

function digitId(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{5,20}$/.test(raw) ? raw : null;
}

function shortText(raw: unknown, max = 200): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isIanaTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function readMetaGraphError(payload: unknown): {
  code: number | null;
  subcode: number | null;
  type: string | null;
  fbtraceId: string | null;
  message: string;
} {
  const error =
    payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") {
    return {
      code: null,
      subcode: null,
      type: null,
      fbtraceId: null,
      message: "Meta returned an unexpected response.",
    };
  }
  const record = error as {
    code?: unknown;
    error_subcode?: unknown;
    type?: unknown;
    fbtrace_id?: unknown;
    message?: unknown;
  };
  const code = finiteInt(record.code);
  const subcode = finiteInt(record.error_subcode);
  const type = shortToken(record.type, 40);
  const fbtraceId = shortToken(record.fbtrace_id, 64);
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : "Meta rejected the insights request.";
  return { code, subcode, type, fbtraceId, message };
}

function finiteInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function shortToken(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function metaAdLabRangeFromQuery(raw: string | undefined | null): GrowthDateRange {
  return parseGrowthDateRange(raw);
}

export { SUBSCRIBER_GROWTH_TZ };
