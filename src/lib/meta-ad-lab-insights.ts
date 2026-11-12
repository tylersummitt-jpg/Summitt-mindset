/**
 * Read-only Meta Ads Insights for the admin diagnostic.
 * Uses META_AD_LAB_ACCESS_TOKEN. Never the Conversions API token.
 */

import "server-only";

import { getDateKeyInTimezone } from "@/lib/timezone";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";
import {
  META_AD_LAB_CORE_FIELDS,
  META_AD_LAB_FULL_FIELDS,
  META_AD_LAB_TIMEOUT_MS,
  SUBSCRIBER_GROWTH_TZ,
  buildMetaInsightsUrl,
  metaAdLabWindow,
  normalizeMetaAdAccountId,
  parseMetaInsightRows,
  readMetaGraphError,
  redactMetaSecrets,
  type MetaAdLabInsightsResult,
} from "@/lib/meta-ad-lab-insights-pure";

export type { MetaAdLabInsightsResult };

function readConfig(): { token: string | null; accountId: string | null } {
  const token = process.env.META_AD_LAB_ACCESS_TOKEN?.trim() || null;
  const accountId = normalizeMetaAdAccountId(process.env.META_AD_LAB_ACCOUNT_ID);
  return { token, accountId };
}

function errorResult(args: {
  since: string;
  until: string;
  rangeNote: string | null;
  fetchedAt: string;
  httpStatus: number | null;
  code: number | null;
  message: string;
  secrets: readonly string[];
}): MetaAdLabInsightsResult {
  return {
    status: "error",
    since: args.since,
    until: args.until,
    rangeNote: args.rangeNote,
    fetchedAt: args.fetchedAt,
    httpStatus: args.httpStatus,
    code: args.code,
    message: redactMetaSecrets(args.message, args.secrets),
  };
}

export async function fetchMetaGraph(
  url: string,
  token: string
): Promise<{ httpStatus: number; payload: unknown } | { failed: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_AD_LAB_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (text.length > 1_000_000) {
      return { failed: "Meta response was too large to read." };
    }
    try {
      return { httpStatus: response.status, payload: JSON.parse(text) as unknown };
    } catch {
      return { failed: "Meta returned a response that was not JSON." };
    }
  } catch (err) {
    const aborted =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    return { failed: aborted ? "Meta did not answer before the timeout." : "Meta could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadMetaAdLabInsights(args: {
  range: GrowthDateRange;
  now?: Date;
}): Promise<MetaAdLabInsightsResult> {
  const now = args.now ?? new Date();
  const todayKey = getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ);
  const window = metaAdLabWindow(args.range, todayKey);
  const fetchedAt = now.toISOString();
  const { token, accountId } = readConfig();
  const missing: Array<"token" | "account"> = [];
  if (!token) missing.push("token");
  if (!accountId) missing.push("account");
  if (!token || !accountId) {
    return { status: "unconfigured", missing, ...window };
  }

  const secrets = [token];
  const request = (fields: string) =>
    fetchMetaGraph(
      buildMetaInsightsUrl({
        accountId,
        since: window.since,
        until: window.until,
        fields,
      }),
      token
    );

  try {
    let fieldSet: "full" | "core" = "full";
    let result = await request(META_AD_LAB_FULL_FIELDS);
    if ("failed" in result) {
      return errorResult({ ...window, fetchedAt, httpStatus: null, code: null, message: result.failed, secrets });
    }
    if (result.httpStatus >= 400 && readMetaGraphError(result.payload).code === 100) {
      fieldSet = "core";
      const retry = await request(META_AD_LAB_CORE_FIELDS);
      if ("failed" in retry) {
        return errorResult({
          ...window,
          fetchedAt,
          httpStatus: null,
          code: null,
          message: retry.failed,
          secrets,
        });
      }
      result = retry;
    }
    const graphError = readMetaGraphError(result.payload);
    const payloadRecord =
      result.payload && typeof result.payload === "object"
        ? (result.payload as { error?: unknown; data?: unknown })
        : null;
    if (
      result.httpStatus < 200 ||
      result.httpStatus >= 300 ||
      (payloadRecord?.error && !Array.isArray(payloadRecord.data))
    ) {
      console.warn("[meta-ad-lab] insights read failed", {
        httpStatus: result.httpStatus,
        code: graphError.code,
      });
      return errorResult({
        ...window,
        fetchedAt,
        httpStatus: result.httpStatus,
        code: graphError.code,
        message: graphError.message,
        secrets,
      });
    }
    const parsed = parseMetaInsightRows(result.payload);
    return {
      status: "ok",
      ...window,
      fetchedAt,
      rows: parsed.rows,
      truncated: parsed.truncated,
      fields: fieldSet,
    };
  } catch {
    return errorResult({
      ...window,
      fetchedAt,
      httpStatus: null,
      code: null,
      message: "Meta insights could not be read.",
      secrets,
    });
  }
}
