import "server-only";

import { continueAfterInstantlyPage, parseInstantlyListPayload } from "@/lib/acquisition/backfill";
import {
  parseAccountDaily,
  parseAccounts,
  parseCampaignAnalytics,
  parseCampaignProfiles,
  parseDaily,
  parseOverview,
  parseSteps,
  type InstantlyAccountDaily,
  type InstantlyCampaignProfile,
  type InstantlyDailyPoint,
  type InstantlyStepPoint,
} from "@/lib/acquisition/instantly-analytics";
import { emptyInstantlyRead, type InstantlyRead } from "@/lib/acquisition/distribution-command";

const ANALYTICS = "https://api.instantly.ai/api/v2/campaigns/analytics";
const OVERVIEW = "https://api.instantly.ai/api/v2/campaigns/analytics/overview";
const DAILY = "https://api.instantly.ai/api/v2/campaigns/analytics/daily";
const STEPS = "https://api.instantly.ai/api/v2/campaigns/analytics/steps";
const CAMPAIGNS = "https://api.instantly.ai/api/v2/campaigns";
const ACCOUNTS = "https://api.instantly.ai/api/v2/accounts";
const ACCOUNT_DAILY = "https://api.instantly.ai/api/v2/accounts/analytics/daily";
const PAGE_CAP = 5;
const ACCOUNT_CAP = 2;
const CACHE_MS = 5 * 60 * 1000;
const memory = new Map<string, { expires: number; value: InstantlyRead }>();
const pending = new Map<string, Promise<InstantlyRead>>();

export type InstantlyFetch = (url: string, init: { headers: { Authorization: string }; signal: AbortSignal }) => Promise<Response>;

function query(path: string, params: Record<string, string | null>): string {
  const url = new URL(path);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function getJson(url: string, apiKey: string, fetchImpl: InstantlyFetch): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

async function listPages(args: {
  url: string;
  apiKey: string;
  fetchImpl: InstantlyFetch;
  pageCap: number;
}): Promise<{ items: unknown[]; truncated: boolean; error: string | null }> {
  const items: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= args.pageCap; page += 1) {
    const url = query(args.url, { limit: "100", starting_after: cursor });
    const response = await getJson(url, args.apiKey, args.fetchImpl);
    if (!response.ok) return { items, truncated: true, error: response.reason };
    const parsed = parseInstantlyListPayload(response.body);
    if (!parsed.ok) return { items, truncated: true, error: "invalid_shape" };
    items.push(...parsed.items);
    const decision = continueAfterInstantlyPage({
      pageNumber: page,
      pageCap: args.pageCap,
      itemCount: parsed.items.length,
      nextCursor: parsed.nextCursor,
      requestCursor: cursor,
    });
    if (!decision.continue) return { items, truncated: !decision.complete, error: decision.error };
    cursor = parsed.nextCursor;
  }
  return { items, truncated: true, error: "page_cap" };
}

export async function readInstantlyAnalytics(args: {
  apiKey: string | null;
  startDate: string | null;
  endDate: string | null;
  daySpan: number | null;
  selectedCampaignId: string | null;
  fetchImpl?: InstantlyFetch;
  now?: number;
  cache?: Map<string, { expires: number; value: InstantlyRead }>;
}): Promise<InstantlyRead> {
  if (!args.apiKey) return emptyInstantlyRead("missing", "missing_api_key");
  const fetchImpl = args.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
  const cache = args.cache ?? memory;
  const cacheKey = JSON.stringify({
    startDate: args.startDate,
    endDate: args.endDate,
    selected: args.selectedCampaignId,
  });
  const now = args.now ?? Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) return cached.value;
  if (cache === memory) {
    const inFlight = pending.get(cacheKey);
    if (inFlight) return inFlight;
  }
  const apiKey = args.apiKey;
  const work = readInstantlyAnalyticsUncached({ ...args, apiKey }, fetchImpl);
  if (cache === memory) pending.set(cacheKey, work);
  try {
    const value = await work;
    const failed = value.analyticsError != null || value.overviewError != null;
    const ttl = failed ? 30_000 : CACHE_MS;
    cache.set(cacheKey, { expires: now + ttl, value });
    return value;
  } finally {
    if (cache === memory) pending.delete(cacheKey);
  }
}

async function readInstantlyAnalyticsUncached(args: {
  apiKey: string;
  startDate: string | null;
  endDate: string | null;
  daySpan: number | null;
  selectedCampaignId: string | null;
}, fetchImpl: InstantlyFetch): Promise<InstantlyRead> {
  const dates = { start_date: args.startDate, end_date: args.endDate };
  const [analyticsResponse, overviewResponse, dailyResponse, stepsResponse, campaignList, accountList] = await Promise.all([
    getJson(query(ANALYTICS, dates), args.apiKey, fetchImpl),
    getJson(query(OVERVIEW, dates), args.apiKey, fetchImpl),
    getJson(query(DAILY, dates), args.apiKey, fetchImpl),
    getJson(query(STEPS, { ...dates, include_opportunities_count: "true" }), args.apiKey, fetchImpl),
    listPages({ url: CAMPAIGNS, apiKey: args.apiKey, fetchImpl, pageCap: PAGE_CAP }),
    listPages({ url: ACCOUNTS, apiKey: args.apiKey, fetchImpl, pageCap: ACCOUNT_CAP }),
  ]);

  const analytics = analyticsResponse.ok ? parseCampaignAnalytics(analyticsResponse.body) : null;
  const overview = overviewResponse.ok ? parseOverview(overviewResponse.body) : null;
  const daily = dailyResponse.ok ? parseDaily(dailyResponse.body) : null;
  const steps = stepsResponse.ok ? parseSteps(stepsResponse.body) : null;
  const profiles = campaignList.error ? null : parseCampaignProfiles(campaignList.items);
  const accounts = accountList.error ? null : parseAccounts(accountList.items);

  let selectedSteps: InstantlyStepPoint[] | null = null;
  let selectedDaily: InstantlyDailyPoint[] | null = null;
  let selectedError: string | null = null;
  if (args.selectedCampaignId) {
    const [stepResponse, dayResponse] = await Promise.all([
      getJson(query(STEPS, { ...dates, campaign_id: args.selectedCampaignId, include_opportunities_count: "true" }), args.apiKey, fetchImpl),
      getJson(query(DAILY, { ...dates, campaign_id: args.selectedCampaignId }), args.apiKey, fetchImpl),
    ]);
    if (!stepResponse.ok || !dayResponse.ok) selectedError = stepResponse.ok ? dayResponse.ok ? null : dayResponse.reason : stepResponse.reason;
    const parsedSteps = stepResponse.ok ? parseSteps(stepResponse.body) : null;
    const parsedDays = dayResponse.ok ? parseDaily(dayResponse.body) : null;
    selectedSteps = parsedSteps && parsedSteps.ok ? parsedSteps.rows : null;
    selectedDaily = parsedDays && parsedDays.ok ? parsedDays.rows : null;
    if ((parsedSteps && !parsedSteps.ok) || (parsedDays && !parsedDays.ok)) selectedError = "invalid_shape";
  }

  let accountDaily: InstantlyAccountDaily[] | null = null;
  let accountDailyError: string | null = null;
  const emails = accounts?.accounts.map((row) => row.email) ?? [];
  if (accountList.error) accountDailyError = accountList.error;
  else if (accountList.truncated || emails.length > 200) accountDailyError = "account_cap";
  else if (args.daySpan == null || args.daySpan > 31) accountDailyError = "range_over_31_days";
  else if (emails.length === 0) accountDailyError = "no_accounts";
  else {
    const url = new URL(ACCOUNT_DAILY);
    if (args.startDate) url.searchParams.set("start_date", args.startDate);
    if (args.endDate) url.searchParams.set("end_date", args.endDate);
    for (const email of emails) url.searchParams.append("emails", email);
    const response = await getJson(url.toString(), args.apiKey, fetchImpl);
    if (!response.ok) accountDailyError = response.reason;
    else {
      const parsed = parseAccountDaily(response.body);
      if (!parsed.ok) accountDailyError = parsed.reason;
      else accountDaily = parsed.rows;
    }
  }

  const value: InstantlyRead = {
    credential: "present",
    analytics: analytics && analytics.ok ? analytics.campaigns : null,
    analyticsError: analyticsResponse.ok ? analytics && analytics.ok ? null : "invalid_shape" : analyticsResponse.reason,
    overview: overview && overview.ok ? overview.overview : null,
    overviewError: overviewResponse.ok ? overview && overview.ok ? null : "invalid_shape" : overviewResponse.reason,
    daily: daily && daily.ok ? daily.rows : null,
    dailyError: dailyResponse.ok ? daily && daily.ok ? null : "invalid_shape" : dailyResponse.reason,
    steps: steps && steps.ok ? steps.rows : null,
    stepsError: stepsResponse.ok ? steps && steps.ok ? null : "invalid_shape" : stepsResponse.reason,
    selectedSteps,
    selectedDaily,
    selectedError,
    profiles: profiles ? profiles.profiles : null,
    profilesTruncated: campaignList.truncated,
    profilesError: campaignList.error,
    accounts: accounts ? accounts.accounts : null,
    accountsTruncated: accountList.truncated,
    accountsError: accountList.error,
    accountDaily,
    accountDailyError,
  };
  return value;
}

const CATALOG_PAGE_CAP = 10;

/** Campaign id, name, and Instantly status only. Sequences and mailboxes stay in Instantly. */
export async function listInstantlyCampaignProfiles(args?: {
  fetchImpl?: InstantlyFetch;
}): Promise<{
  credential: "missing" | "present";
  profiles: InstantlyCampaignProfile[] | null;
  truncated: boolean;
  error: string | null;
}> {
  const apiKey = process.env.INSTANTLY_API_KEY?.trim() || null;
  if (!apiKey) return { credential: "missing", profiles: null, truncated: false, error: "missing_api_key" };
  const fetchImpl = args?.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
  const listed = await listPages({ url: CAMPAIGNS, apiKey, fetchImpl, pageCap: CATALOG_PAGE_CAP });
  if (listed.error) return { credential: "present", profiles: null, truncated: listed.truncated, error: listed.error };
  return {
    credential: "present",
    profiles: parseCampaignProfiles(listed.items).profiles,
    truncated: listed.truncated,
    error: null,
  };
}

export function loadInstantlyForDistribution(args: {
  startDate: string | null;
  endDate: string | null;
  daySpan: number | null;
  selectedCampaignId: string | null;
}): Promise<InstantlyRead> {
  return readInstantlyAnalytics({
    ...args,
    apiKey: process.env.INSTANTLY_API_KEY?.trim() || null,
  });
}

