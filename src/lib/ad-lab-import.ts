/**
 * Read-only Meta import into ad_lab_ads and ad_lab_daily_delivery.
 * Does not write ad_spend and does not call the Conversions API.
 */

import "server-only";

import {
  adLabImportClientMessage,
  defaultImportWindow,
  deliveryFromInsight,
  identitiesFromImport,
  importWindowAllowed,
  type AdLabDay,
  type AdLabIdentity,
  type AdLabImportFailureReason,
} from "@/lib/ad-lab-import-pure";
import {
  META_AD_LAB_FULL_FIELDS,
  META_AD_LAB_IMPORT_FIELDS,
  META_AD_LAB_MAX_PAGES,
  buildMetaAdAccountUrl,
  buildMetaAdsUrl,
  buildMetaInsightsUrl,
  normalizeMetaAdAccountId,
  parseMetaAdAccount,
  parseMetaAdsPage,
  parseMetaInsightRows,
  readMetaGraphError,
  readMetaPagingCursor,
  redactMetaSecrets,
} from "@/lib/meta-ad-lab-insights-pure";
import { fetchMetaGraph } from "@/lib/meta-ad-lab-insights";

export type { AdLabIdentity };

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 613]);

export type AdLabCommit = {
  accountId: string;
  ads: readonly AdLabIdentity[];
  days: readonly AdLabDay[];
  currency: string;
  timezone: string;
  importedAt: string;
};

export type AdLabImportClaim =
  | { ok: true; token: string }
  | { ok: false; reason: "busy" | "cooldown" | "storage" };

export type AdLabStore = {
  readAds(accountId: string): Promise<{ ok: true; ads: AdLabIdentity[] } | { ok: false }>;
  commitImport(commit: AdLabCommit): Promise<{ ok: true } | { ok: false }>;
  /** Present on the production store. Holds the shared lock before Meta is called. */
  claimImport?(accountId: string): Promise<AdLabImportClaim>;
  finishImport?(accountId: string, token: string, succeeded: boolean): Promise<void>;
};

export type AdLabImportResult =
  | {
      ok: true;
      since: string;
      until: string;
      timezone: string;
      currency: string;
      ads: number;
      days: number;
      statusUpdated: boolean;
    }
  | {
      ok: false;
      reason: AdLabImportFailureReason;
      message: string;
    };

export async function runAdLabImport(args?: {
  since?: string;
  until?: string;
  now?: Date;
  retryDelayMs?: number;
  store?: AdLabStore;
}): Promise<AdLabImportResult> {
  const now = args?.now ?? new Date();
  const retryDelayMs = args?.retryDelayMs ?? 400;
  const token = process.env.META_AD_LAB_ACCESS_TOKEN?.trim() || "";
  const accountId = normalizeMetaAdAccountId(process.env.META_AD_LAB_ACCOUNT_ID);
  if (!token || !accountId) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "Meta ad import is not configured on this server.",
    };
  }
  if ((args?.since == null) !== (args?.until == null)) {
    return { ok: false, reason: "window", message: "Provide both since and until, or neither." };
  }
  if (args?.since && args.until && !importWindowAllowed(args.since, args.until)) {
    return { ok: false, reason: "window", message: "An import window can cover at most 7 days." };
  }

  const store = args?.store ?? (await defaultStore());
  let lockToken = "";
  if (store.claimImport) {
    const claim = await store.claimImport(accountId);
    if (!claim.ok) {
      const reason = claim.reason === "busy" || claim.reason === "cooldown" ? claim.reason : "storage";
      return { ok: false, reason, message: adLabImportClientMessage(reason) };
    }
    if (!claim.token) {
      return { ok: false, reason: "storage", message: adLabImportClientMessage("storage") };
    }
    lockToken = claim.token;
  }
  let succeeded = false;
  try {
    const result = await importClaimedWindow({
      accountId,
      token,
      now,
      retryDelayMs,
      since: args?.since,
      until: args?.until,
      store,
    });
    succeeded = result.ok;
    return result;
  } finally {
    if (lockToken) {
      try {
        if (store.finishImport) await store.finishImport(accountId, lockToken, succeeded);
        else console.warn("[meta-ad-lab] import finish missing");
      } catch {
        console.warn("[meta-ad-lab] import finish failed");
      }
    }
  }
}

async function importClaimedWindow(args: {
  accountId: string;
  token: string;
  now: Date;
  retryDelayMs: number;
  since?: string;
  until?: string;
  store: AdLabStore;
}): Promise<AdLabImportResult> {
  const secrets = [args.token];
  const account = await getWithRetry(
    buildMetaAdAccountUrl(args.accountId),
    args.token,
    args.retryDelayMs
  );
  const accountFailure = graphFailure(account, secrets);
  if (accountFailure) return accountFailure;
  const accountMeta =
    "payload" in account ? parseMetaAdAccount(account.payload) : null;
  if (!accountMeta) {
    return {
      ok: false,
      reason: "meta",
      message: "Meta did not return a usable account timezone and currency.",
    };
  }
  const window =
    args.since && args.until
      ? { since: args.since, until: args.until }
      : defaultImportWindow(args.now, accountMeta.timezone);

  const insights = await readInsightPages({
    accountId: args.accountId,
    since: window.since,
    until: window.until,
    token: args.token,
    retryDelayMs: args.retryDelayMs,
  });
  if (!insights.ok) return insights.result;

  const statuses = await readStatusPages({
    accountId: args.accountId,
    token: args.token,
    retryDelayMs: args.retryDelayMs,
  });
  const store = args.store;
  const ids = [
    ...new Set([
      ...insights.rows.map((row) => row.adId),
      ...(statuses.ads ?? []).map((row) => row.adId),
    ]),
  ];
  if (ids.length === 0 && !statuses.complete) {
    return {
      ok: true,
      ...window,
      timezone: accountMeta.timezone,
      currency: accountMeta.currency,
      ads: 0,
      days: 0,
      statusUpdated: false,
    };
  }
  const existing = await store.readAds(args.accountId);
  if (!existing.ok) {
    return { ok: false, reason: "storage", message: "Stored Meta ads could not be read." };
  }
  const importedAt = args.now.toISOString();
  const ads = identitiesFromImport({
    insights: insights.rows,
    statuses: statuses.complete ? statuses.ads : null,
    existing: existing.ads,
    seenOnFallback: window.until,
    statusCheckedAt: statuses.complete ? importedAt : null,
  });
  if (statuses.complete) {
    const seen = new Set(ads.map((ad) => ad.metaAdId));
    for (const ad of existing.ads) {
      if (seen.has(ad.metaAdId)) continue;
      ads.push({
        ...ad,
        effectiveStatus: null,
        statusCheckedAt: importedAt,
        metadataImportedAt: null,
      });
    }
  }
  const days = dedupeDays(insights.rows.map(deliveryFromInsight));
  if (ads.length > 0 || days.length > 0) {
    const saved = await store.commitImport({
      accountId: args.accountId,
      ads,
      days,
      currency: accountMeta.currency,
      timezone: accountMeta.timezone,
      importedAt,
    });
    if (!saved.ok) {
      return { ok: false, reason: "storage", message: "Stored Meta delivery could not be saved." };
    }
  }
  return {
    ok: true,
    ...window,
    timezone: accountMeta.timezone,
    currency: accountMeta.currency,
    ads: ads.length,
    days: days.length,
    statusUpdated: statuses.complete,
  };
}

function dedupeDays(days: AdLabDay[]): AdLabDay[] {
  const byKey = new Map<string, AdLabDay>();
  for (const day of days) byKey.set(`${day.metaAdId}\u0000${day.spendDate}`, day);
  return [...byKey.values()];
}

async function defaultStore(): Promise<AdLabStore> {
  const { createSupabaseAdLabStore } = await import("@/lib/ad-lab-store");
  return createSupabaseAdLabStore();
}

async function readInsightPages(args: {
  accountId: string;
  since: string;
  until: string;
  token: string;
  retryDelayMs: number;
}): Promise<{ ok: true; rows: ReturnType<typeof parseMetaInsightRows>["rows"] } | { ok: false; result: AdLabImportResult }> {
  let fields: string = META_AD_LAB_IMPORT_FIELDS;
  let after: string | null = null;
  const rows: ReturnType<typeof parseMetaInsightRows>["rows"] = [];
  for (let page = 0; page < META_AD_LAB_MAX_PAGES; page += 1) {
    const loaded = await getWithRetry(
      buildMetaInsightsUrl({
        accountId: args.accountId,
        since: args.since,
        until: args.until,
        fields,
        after,
      }),
      args.token,
      args.retryDelayMs
    );
    const code = "payload" in loaded ? readMetaGraphError(loaded.payload).code : null;
    if (
      page === 0 &&
      after == null &&
      fields === META_AD_LAB_IMPORT_FIELDS &&
      "httpStatus" in loaded &&
      loaded.httpStatus >= 400 &&
      code === 100
    ) {
      fields = META_AD_LAB_FULL_FIELDS;
      page -= 1;
      continue;
    }
    const failure = graphFailure(loaded, [args.token]);
    if (failure) return { ok: false, result: failure };
    if (!("payload" in loaded)) {
      return { ok: false, result: { ok: false, reason: "meta", message: "Meta insights could not be read." } };
    }
    const parsed = parseMetaInsightRows(loaded.payload);
    rows.push(...parsed.rows);
    const cursor = readMetaPagingCursor(loaded.payload);
    if (!cursor.after) {
      if (cursor.hasNextUrl) {
        return {
          ok: false,
          result: {
            ok: false,
            reason: "truncated",
            message: "Meta returned another page without a safe cursor. Nothing was saved.",
          },
        };
      }
      return { ok: true, rows };
    }
    if (page === META_AD_LAB_MAX_PAGES - 1) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "truncated",
          message: "Meta returned more ad-days than this import will follow. Nothing was saved.",
        },
      };
    }
    after = cursor.after;
  }
  return { ok: true, rows };
}

async function readStatusPages(args: {
  accountId: string;
  token: string;
  retryDelayMs: number;
}): Promise<{ complete: boolean; ads: ReturnType<typeof parseMetaAdsPage>["ads"] | null }> {
  let after: string | null = null;
  const ads: ReturnType<typeof parseMetaAdsPage>["ads"] = [];
  for (let page = 0; page < META_AD_LAB_MAX_PAGES; page += 1) {
    const loaded = await getWithRetry(
      buildMetaAdsUrl(args.accountId, after),
      args.token,
      args.retryDelayMs
    );
    if (!("payload" in loaded) || loaded.httpStatus < 200 || loaded.httpStatus >= 300) {
      console.warn("[meta-ad-lab] status read failed", {
        httpStatus: "httpStatus" in loaded ? loaded.httpStatus : null,
        code: "payload" in loaded ? readMetaGraphError(loaded.payload).code : null,
      });
      return { complete: false, ads: null };
    }
    const parsed = parseMetaAdsPage(loaded.payload);
    ads.push(...parsed.ads);
    if (!parsed.after) {
      if (parsed.hasNextUrl) return { complete: false, ads: null };
      return { complete: true, ads };
    }
    if (page === META_AD_LAB_MAX_PAGES - 1) return { complete: false, ads: null };
    after = parsed.after;
  }
  return { complete: false, ads: null };
}

function graphFailure(
  result: Awaited<ReturnType<typeof fetchMetaGraph>>,
  secrets: readonly string[]
): AdLabImportResult | null {
  if ("failed" in result) {
    return { ok: false, reason: "meta", message: redactMetaSecrets(result.failed, secrets) };
  }
  const graphError = readMetaGraphError(result.payload);
  const record =
    result.payload && typeof result.payload === "object"
      ? (result.payload as { error?: unknown; data?: unknown; timezone_name?: unknown })
      : null;
  const failed =
    result.httpStatus < 200 ||
    result.httpStatus >= 300 ||
    (record?.error != null && record.data == null && record.timezone_name == null);
  if (!failed) return null;
  console.warn("[meta-ad-lab] import read failed", {
    httpStatus: result.httpStatus,
    code: graphError.code,
  });
  return {
    ok: false,
    reason: "meta",
    message: redactMetaSecrets(graphError.message, secrets),
  };
}

function isTransient(result: Awaited<ReturnType<typeof fetchMetaGraph>>): boolean {
  if ("failed" in result) return true;
  if (result.httpStatus === 429 || result.httpStatus >= 500) return true;
  const code = readMetaGraphError(result.payload).code;
  return code != null && TRANSIENT_CODES.has(code);
}

async function getWithRetry(url: string, token: string, retryDelayMs: number) {
  const first = await fetchMetaGraph(url, token);
  if (!isTransient(first)) return first;
  if (retryDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return fetchMetaGraph(url, token);
}
