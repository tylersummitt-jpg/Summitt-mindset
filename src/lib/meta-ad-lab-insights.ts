/**
 * Read-only Meta Ads Insights for the admin diagnostic.
 * Uses META_AD_LAB_ACCESS_TOKEN. Never the Conversions API token.
 */

import "server-only";

import { getDateKeyInTimezone } from "@/lib/timezone";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";
import {
  META_AD_LAB_CORE_FIELDS,
  META_AD_LAB_EXPECTED_ACCOUNT_ID,
  META_AD_LAB_FULL_FIELDS,
  META_AD_LAB_GRAPH_VERSION,
  META_AD_LAB_TIMEOUT_MS,
  SUBSCRIBER_GROWTH_TZ,
  buildMetaInsightsUrl,
  metaAdLabWindow,
  normalizeMetaAdAccountId,
  parseGrantedScopes,
  parseMetaIdentity,
  parseMetaInsightRows,
  parseVisibleAdAccountIds,
  readMetaGraphError,
  redactMetaSecrets,
  type MetaAdLabAccessCheck,
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
  subcode: number | null;
  errorType: string | null;
  fbtraceId: string | null;
  accountId: string | null;
  message: string;
  access: MetaAdLabAccessCheck;
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
    subcode: args.subcode,
    errorType: args.errorType,
    fbtraceId: args.fbtraceId,
    accountId: args.accountId,
    message: redactMetaSecrets(args.message, args.secrets),
    access: {
      ...args.access,
      systemUserName: args.access.systemUserName
        ? redactMetaSecrets(args.access.systemUserName, args.secrets)
        : null,
      note: args.access.note ? redactMetaSecrets(args.access.note, args.secrets) : null,
    },
  };
}

function localAccess(token: string | null, accountId: string | null): MetaAdLabAccessCheck {
  return {
    accountId,
    accountMatchesExpected: accountId === META_AD_LAB_EXPECTED_ACCOUNT_ID,
    tokenPresent: Boolean(token),
    graphVersion: META_AD_LAB_GRAPH_VERSION,
    endpoint: "insights",
    authorization: "bearer",
    systemUserId: null,
    systemUserName: null,
    grantedScopes: null,
    visibleAdAccountIds: null,
    targetAccountListed: null,
    note: null,
  };
}

function graphNode(path: string): string {
  return `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}${path}`;
}

async function readTokenAccess(
  token: string | null,
  accountId: string | null
): Promise<MetaAdLabAccessCheck> {
  const access: MetaAdLabAccessCheck = {
    accountId,
    accountMatchesExpected: accountId === META_AD_LAB_EXPECTED_ACCOUNT_ID,
    tokenPresent: Boolean(token),
    graphVersion: META_AD_LAB_GRAPH_VERSION,
    endpoint: "insights",
    authorization: "bearer",
    systemUserId: null,
    systemUserName: null,
    grantedScopes: null,
    visibleAdAccountIds: null,
    targetAccountListed: null,
    note: null,
  };
  if (!token) return access;
  try {
    return await inspectTokenAccess(token, accountId, access);
  } catch {
    return { ...access, note: "The token check could not be completed." };
  }
}

async function inspectTokenAccess(
  token: string,
  accountId: string | null,
  access: MetaAdLabAccessCheck
): Promise<MetaAdLabAccessCheck> {
  const notes: string[] = [];
  const me = await fetchMetaGraph(graphNode("/me?fields=id,name"), token);
  if ("failed" in me) {
    notes.push(me.failed);
  } else if (me.httpStatus < 200 || me.httpStatus >= 300) {
    const error = readMetaGraphError(me.payload);
    notes.push(`Identity read failed (${error.code ?? me.httpStatus}). ${error.message}`);
  } else {
    const identity = parseMetaIdentity(me.payload);
    access.systemUserId = identity.id;
    access.systemUserName = identity.name;
  }
  const permissions = await fetchMetaGraph(graphNode("/me/permissions"), token);
  if ("failed" in permissions) {
    notes.push(permissions.failed);
  } else if (permissions.httpStatus < 200 || permissions.httpStatus >= 300) {
    const error = readMetaGraphError(permissions.payload);
    notes.push(`Scope read failed (${error.code ?? permissions.httpStatus}). ${error.message}`);
  } else {
    access.grantedScopes = parseGrantedScopes(permissions.payload);
  }
  const accounts = await fetchMetaGraph(
    graphNode("/me/adaccounts?fields=account_id&limit=50"),
    token
  );
  if ("failed" in accounts) {
    notes.push(accounts.failed);
  } else if (accounts.httpStatus < 200 || accounts.httpStatus >= 300) {
    const error = readMetaGraphError(accounts.payload);
    notes.push(`Ad account list failed (${error.code ?? accounts.httpStatus}). ${error.message}`);
  } else {
    const listed = parseVisibleAdAccountIds(accounts.payload);
    access.visibleAdAccountIds = listed.ids;
    if (!accountId || listed.ids == null) {
      access.targetAccountListed = null;
      if (listed.ids == null) notes.push("Ad account list could not be read.");
    } else if (listed.ids.includes(accountId)) {
      access.targetAccountListed = true;
    } else {
      access.targetAccountListed = listed.complete ? false : null;
      if (!listed.complete) notes.push("Meta has more ad accounts than this check listed.");
    }
  }
  access.note = notes.length > 0 ? notes.join(" ") : null;
  return access;
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
      return errorResult({
        ...window,
        fetchedAt,
        httpStatus: null,
        code: null,
        subcode: null,
        errorType: null,
        fbtraceId: null,
        accountId,
        message: result.failed,
        access: localAccess(token, accountId),
        secrets,
      });
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
          subcode: null,
          errorType: null,
          fbtraceId: null,
          accountId,
          message: retry.failed,
          access: localAccess(token, accountId),
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
      const message = redactMetaSecrets(graphError.message, secrets);
      let access = localAccess(token, accountId);
      try {
        access = await readTokenAccess(token, accountId);
      } catch {
        access = { ...localAccess(token, accountId), note: "The token check could not be completed." };
      }
      console.warn("[meta-ad-lab] insights read failed", {
        step: "insights",
        httpStatus: result.httpStatus,
        code: graphError.code,
        subcode: graphError.subcode,
        type: graphError.type,
        fbtraceId: graphError.fbtraceId,
        accountId,
        message,
        accountMatchesExpected: access.accountMatchesExpected,
        systemUserId: access.systemUserId,
        grantedScopes: access.grantedScopes,
        targetAccountListed: access.targetAccountListed,
        visibleAdAccountIds: access.visibleAdAccountIds,
        probeNote: access.note ? redactMetaSecrets(access.note, secrets) : null,
      });
      return errorResult({
        ...window,
        fetchedAt,
        httpStatus: result.httpStatus,
        code: graphError.code,
        subcode: graphError.subcode,
        errorType: graphError.type,
        fbtraceId: graphError.fbtraceId,
        accountId,
        message,
        access,
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
      subcode: null,
      errorType: null,
      fbtraceId: null,
      accountId,
      message: "Meta insights could not be read.",
      access: localAccess(token, accountId),
      secrets,
    });
  }
}
