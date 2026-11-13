/**
 * Read stored Ad Lab rows for Subscriber Growth. Never throws.
 * Does not call Meta and does not change Subscriber Growth totals.
 */

import "server-only";

import {
  addDaysToDateKey,
  SUBSCRIBER_GROWTH_TZ,
  type GrowthDateRange,
} from "@/lib/admin-subscriber-growth-pure";
import {
  mondayOnOrBefore,
  summarizeAdLab,
  type AdLabIdentity,
  type AdLabPanel,
  type AdLabStoredDay,
} from "@/lib/ad-lab-import-pure";
import { metaAdLabWindow, normalizeMetaAdAccountId } from "@/lib/meta-ad-lab-insights-pure";
import { buildAdLabLab } from "@/lib/ad-lab-product";
import type { AdLabLab, AdLabPageView } from "@/lib/ad-lab-product-pure";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";

export type { AdLabPanel };

const UNAVAILABLE = "Stored Meta delivery could not be read. The rest of this page is unchanged.";

export async function loadAdLabSummary(args: {
  range: GrowthDateRange;
  now?: Date;
  subscriptions?: { complete: boolean; subs: import("@/lib/admin-subscriber-growth-pure").GrowthStripeSubscription[] };
}): Promise<AdLabPageView> {
  try {
    const accountId = normalizeMetaAdAccountId(process.env.META_AD_LAB_ACCOUNT_ID);
    if (!accountId) {
      return {
        status: "unavailable",
        message: "Meta account is not configured on this server. The rest of this page is unchanged.",
      };
    }
    const now = args.now ?? new Date();
    const todayNy = getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ);
    const page = metaAdLabWindow(args.range, todayNy);
    const weekStart = mondayOnOrBefore(todayNy);
    const pageSince = addDaysToDateKey(page.since < weekStart ? page.since : weekStart, -1);
    const until = addDaysToDateKey(page.until > todayNy ? page.until : todayNy, 1);
    const experimentStarts = await readExperimentStarts(accountId);
    let since = pageSince;
    for (const start of experimentStarts) {
      if (start < since) since = start;
    }
    let days = await readDays(accountId, since, until);
    let loadedSince = since;
    if (!days.ok && since !== pageSince) {
      days = await readDays(accountId, pageSince, until);
      loadedSince = pageSince;
    }
    const identities = await readIdentities(accountId);
    if (!identities.ok || !days.ok) return { status: "unavailable", message: UNAVAILABLE };
    if (identities.rows.length === 0 && days.rows.length === 0) {
      return {
        status: "empty",
        message: "No Meta delivery has been stored yet. The live check below still reads Meta directly.",
      };
    }
    const timezones = new Set(days.rows.map((row) => row.accountTimezone));
    const currencies = new Set(days.rows.map((row) => row.currency));
    if (days.rows.length > 0 && (timezones.size !== 1 || currencies.size !== 1)) {
      return {
        status: "unavailable",
        message:
          "Stored Meta delivery uses more than one timezone or currency, so totals are withheld. The rest of this page is unchanged.",
      };
    }
    const timezone = [...timezones][0] ?? SUBSCRIBER_GROWTH_TZ;
    const currency = [...currencies][0] ?? "USD";
    const todayKey = getDateKeyInTimezone(now, timezone);
    const summary = summarizeAdLab({
      identities: identities.rows,
      days: days.rows,
      timezone,
      currency,
      todayKey,
      rangeSince: page.since,
      rangeUntil: page.until,
      now,
    });
    let lab: AdLabLab | undefined;
    try {
      lab = await buildAdLabLab({
        identities: identities.rows,
        days: days.rows,
        summary,
        loadedSince,
        loadedUntil: until,
        todayKey,
        subscriptions: args.subscriptions,
      });
    } catch {
      lab = undefined;
    }
    return { status: "ready", summary, lab };
  } catch {
    return { status: "unavailable", message: UNAVAILABLE };
  }
}

async function readIdentities(
  accountId: string
): Promise<{ ok: true; rows: AdLabIdentity[] } | { ok: false }> {
  const { data, error } = await supabaseServer
    .from("ad_lab_ads")
    .select(
      "meta_ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name, effective_status, creative_id, first_seen_on, last_seen_on, status_checked_at"
    )
    .eq("account_id", accountId)
    .limit(2000);
  if (error) {
    console.warn("[meta-ad-lab] summary ad read failed", { code: error.code ?? null });
    return { ok: false };
  }
  if ((data ?? []).length >= 2000) return { ok: false };
  return {
    ok: true,
    rows: (data ?? []).map((row) => identityFromRow(row as Record<string, unknown>)),
  };
}

async function readExperimentStarts(accountId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("ad_lab_experiments")
    .select("starts_on")
    .eq("account_id", accountId)
    .limit(200);
  if (error) return [];
  return (data ?? [])
    .map((row) => (row as { starts_on?: unknown }).starts_on)
    .filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function readDays(
  accountId: string,
  since: string,
  until: string
): Promise<{ ok: true; rows: AdLabStoredDay[] } | { ok: false }> {
  const rows: AdLabStoredDay[] = [];
  for (let page = 0; page < 5; page += 1) {
    const from = page * 1000;
    const { data, error } = await supabaseServer
      .from("ad_lab_daily_delivery")
      .select(
        "meta_ad_id, ad_name, spend_date, spend_cents, impressions, outbound_clicks, landing_page_views, currency, account_timezone, imported_at"
      )
      .eq("account_id", accountId)
      .gte("spend_date", since)
      .lte("spend_date", until)
      .order("spend_date", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.warn("[meta-ad-lab] summary day read failed", { code: error.code ?? null });
      return { ok: false };
    }
    const batch = data ?? [];
    for (const row of batch) {
      const mapped = dayFromRow(row as Record<string, unknown>);
      if (mapped) rows.push(mapped);
    }
    if (batch.length < 1000) return { ok: true, rows };
  }
  return { ok: false };
}

function identityFromRow(row: Record<string, unknown>): AdLabIdentity {
  return {
    metaAdId: text(row.meta_ad_id) ?? "",
    adName: text(row.ad_name) || "Untitled ad",
    campaignId: text(row.campaign_id),
    campaignName: text(row.campaign_name),
    adsetId: text(row.adset_id),
    adsetName: text(row.adset_name),
    effectiveStatus: text(row.effective_status),
    creativeId: text(row.creative_id),
    firstSeenOn: text(row.first_seen_on) ?? "",
    lastSeenOn: text(row.last_seen_on) ?? "",
    statusCheckedAt: text(row.status_checked_at),
  };
}

function dayFromRow(row: Record<string, unknown>): AdLabStoredDay | null {
  const metaAdId = text(row.meta_ad_id);
  const spendDate = text(row.spend_date);
  const currency = text(row.currency);
  const accountTimezone = text(row.account_timezone);
  const importedAt = text(row.imported_at);
  if (!metaAdId || !spendDate || !currency || !accountTimezone || !importedAt) return null;
  return {
    metaAdId,
    adName: text(row.ad_name) || "Untitled ad",
    spendDate,
    spendCents: count(row.spend_cents),
    impressions: count(row.impressions),
    outboundClicks: count(row.outbound_clicks),
    landingPageViews: count(row.landing_page_views),
    currency,
    accountTimezone,
    importedAt,
  };
}

function count(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
