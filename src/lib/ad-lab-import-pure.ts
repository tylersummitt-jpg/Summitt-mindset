/**
 * Pure Ad Lab import and summary rules. No network and no database.
 */

import { addDaysToDateKey } from "@/lib/admin-subscriber-growth-pure";
import type { MetaAdInsightRow, MetaAdStatusRow } from "@/lib/meta-ad-lab-insights-pure";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const AD_LAB_IMPORT_MAX_DAYS = 7;
export const AD_LAB_STALE_MS = 36 * 60 * 60 * 1000;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type AdLabIdentity = {
  metaAdId: string;
  adName: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  effectiveStatus: string | null;
  creativeId: string | null;
  firstSeenOn: string;
  lastSeenOn: string;
  statusCheckedAt: string | null;
  /** Null means this import refreshed metadata and the store stamps the commit time. */
  metadataImportedAt?: string | null;
};

export type AdLabDay = {
  metaAdId: string;
  adName: string;
  spendDate: string;
  spendCents: number | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
};

export type AdLabStoredDay = AdLabDay & {
  currency: string;
  accountTimezone: string;
  importedAt: string;
};

export type AdLabAdLine = {
  metaAdId: string;
  adName: string;
  status: string | null;
  campaignName: string | null;
  adsetName: string | null;
  spendCents: number | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  outboundCtr: number | null;
};

export type AdLabPanel =
  | { status: "unavailable"; message: string }
  | { status: "empty"; message: string }
  | { status: "ready"; summary: AdLabSummary };

export type AdLabSummary = {
  timezone: string;
  currency: string;
  todayKey: string;
  weekStart: string;
  rangeSince: string;
  rangeUntil: string;
  todaySpendCents: number | null;
  weekSpendCents: number | null;
  activeCount: number | null;
  lastImportedAt: string | null;
  stale: boolean;
  ads: AdLabAdLine[];
};

export function importWindowAllowed(since: string, until: string): boolean {
  if (!DATE_KEY.test(since) || !DATE_KEY.test(until) || until < since) return false;
  return until <= addDaysToDateKey(since, AD_LAB_IMPORT_MAX_DAYS - 1);
}

export function defaultImportWindow(now: Date, timezone: string): { since: string; until: string } {
  const until = getDateKeyInTimezone(now, timezone);
  return { since: addDaysToDateKey(until, -1), until };
}

export function mondayOnOrBefore(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  return addDaysToDateKey(dateKey, -delta);
}

export function spendDollarsToCents(spend: string | null): number | null {
  if (spend == null) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(spend);
  if (!match) return null;
  const dollars = Number(match[1]);
  const fraction = match[2] ?? "";
  const cents =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function mergeAdIdentity(args: {
  existing: AdLabIdentity | null;
  metaAdId: string;
  incomingName: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  effectiveStatus: string | null | undefined;
  creativeId: string | null;
  seenOn: string;
  statusCheckedAt: string | null;
}): AdLabIdentity {
  const previous = args.existing;
  const seen = [previous?.firstSeenOn, previous?.lastSeenOn, args.seenOn].filter(
    (value): value is string => typeof value === "string" && DATE_KEY.test(value)
  );
  const firstSeenOn = seen.reduce((min, value) => (value < min ? value : min));
  const lastSeenOn = seen.reduce((max, value) => (value > max ? value : max));
  return {
    metaAdId: args.metaAdId,
    adName: args.incomingName.trim() || previous?.adName || "Untitled ad",
    campaignId: args.campaignId ?? previous?.campaignId ?? null,
    campaignName: args.campaignName ?? previous?.campaignName ?? null,
    adsetId: args.adsetId ?? previous?.adsetId ?? null,
    adsetName: args.adsetName ?? previous?.adsetName ?? null,
    effectiveStatus:
      args.effectiveStatus === undefined
        ? (previous?.effectiveStatus ?? null)
        : args.effectiveStatus,
    creativeId: args.creativeId ?? previous?.creativeId ?? null,
    firstSeenOn,
    lastSeenOn,
    statusCheckedAt: args.statusCheckedAt ?? previous?.statusCheckedAt ?? null,
    metadataImportedAt: null,
  };
}

export function deliveryFromInsight(row: MetaAdInsightRow): AdLabDay {
  return {
    metaAdId: row.adId,
    adName: row.adName,
    spendDate: row.date,
    spendCents: spendDollarsToCents(row.spend),
    impressions: row.impressions,
    outboundClicks: row.outboundClicks,
    landingPageViews: row.landingPageViews,
  };
}

export function identitiesFromImport(args: {
  insights: readonly MetaAdInsightRow[];
  statuses: readonly MetaAdStatusRow[] | null;
  existing: readonly AdLabIdentity[];
  seenOnFallback: string;
  statusCheckedAt: string | null;
}): AdLabIdentity[] {
  const existingById = new Map(args.existing.map((row) => [row.metaAdId, row]));
  const statusById = new Map((args.statuses ?? []).map((row) => [row.adId, row]));
  const ids = new Set<string>([
    ...args.insights.map((row) => row.adId),
    ...(args.statuses ?? []).map((row) => row.adId),
  ]);
  const latestInsight = new Map<string, MetaAdInsightRow>();
  const earliestInsight = new Map<string, string>();
  for (const row of args.insights) {
    const current = latestInsight.get(row.adId);
    if (!current || row.date >= current.date) latestInsight.set(row.adId, row);
    const earliest = earliestInsight.get(row.adId);
    if (!earliest || row.date < earliest) earliestInsight.set(row.adId, row.date);
  }
  const merged: AdLabIdentity[] = [];
  for (const metaAdId of ids) {
    const insight = latestInsight.get(metaAdId);
    const status = statusById.get(metaAdId);
    const firstInsight = earliestInsight.get(metaAdId);
    const identity = mergeAdIdentity({
      existing: existingById.get(metaAdId) ?? null,
      metaAdId,
      incomingName: status?.adName || insight?.adName || "",
      campaignId: status?.campaignId ?? insight?.campaignId ?? null,
      campaignName: status?.campaignName ?? insight?.campaignName ?? null,
      adsetId: status?.adsetId ?? insight?.adsetId ?? null,
      adsetName: status?.adsetName ?? insight?.adsetName ?? null,
      effectiveStatus: args.statuses == null ? undefined : (status?.effectiveStatus ?? null),
      creativeId: status?.creativeId ?? null,
      seenOn: firstInsight ?? args.seenOnFallback,
      statusCheckedAt: args.statusCheckedAt,
    });
    if (insight && DATE_KEY.test(insight.date)) {
      identity.lastSeenOn = identity.lastSeenOn > insight.date ? identity.lastSeenOn : insight.date;
    }
    const previous = existingById.get(metaAdId) ?? null;
    const olderDeliveryOnly =
      previous != null &&
      args.statuses == null &&
      insight != null &&
      DATE_KEY.test(insight.date) &&
      DATE_KEY.test(previous.lastSeenOn) &&
      insight.date < previous.lastSeenOn;
    if (olderDeliveryOnly) {
      identity.adName = previous.adName;
      identity.campaignId = previous.campaignId;
      identity.campaignName = previous.campaignName;
      identity.adsetId = previous.adsetId;
      identity.adsetName = previous.adsetName;
      identity.creativeId = previous.creativeId;
      identity.effectiveStatus = previous.effectiveStatus;
      identity.statusCheckedAt = previous.statusCheckedAt;
      identity.metadataImportedAt = previous.metadataImportedAt ?? null;
    }
    merged.push(identity);
  }
  return merged;
}

function sumMetric(rows: readonly AdLabDay[], pick: (row: AdLabDay) => number | null): number | null {
  let sum = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

export function summarizeAdLab(args: {
  identities: readonly AdLabIdentity[];
  days: readonly AdLabStoredDay[];
  timezone: string;
  currency: string;
  todayKey: string;
  rangeSince: string;
  rangeUntil: string;
  now: Date;
}): AdLabSummary {
  const weekStart = mondayOnOrBefore(args.todayKey);
  const inRange = args.days.filter(
    (row) => row.spendDate >= args.rangeSince && row.spendDate <= args.rangeUntil
  );
  const todayRows = args.days.filter((row) => row.spendDate === args.todayKey);
  const weekRows = args.days.filter(
    (row) => row.spendDate >= weekStart && row.spendDate <= args.todayKey
  );
  const lastImportedAt = args.days.reduce<string | null>((latest, row) => {
    if (!latest || row.importedAt > latest) return row.importedAt;
    return latest;
  }, null);
  const stale =
    lastImportedAt != null && args.now.getTime() - new Date(lastImportedAt).getTime() > AD_LAB_STALE_MS;
  const statusKnownAt = latestStatusCheck(args.identities);
  const statusFresh =
    statusKnownAt != null &&
    args.now.getTime() - new Date(statusKnownAt).getTime() <= AD_LAB_STALE_MS;
  const activeCount = statusFresh
    ? args.identities.filter(
        (row) => row.statusCheckedAt === statusKnownAt && row.effectiveStatus === "ACTIVE"
      ).length
    : null;
  const byAd = new Map<string, AdLabStoredDay[]>();
  for (const row of inRange) {
    const list = byAd.get(row.metaAdId) ?? [];
    list.push(row);
    byAd.set(row.metaAdId, list);
  }
  const names = new Map(args.identities.map((row) => [row.metaAdId, row]));
  const ads: AdLabAdLine[] = [];
  for (const [metaAdId, rows] of byAd) {
    const identity = names.get(metaAdId);
    const impressions = sumMetric(rows, (row) => row.impressions);
    const outboundClicks = sumMetric(rows, (row) => row.outboundClicks);
    const latest = rows.reduce((best, row) => (row.spendDate >= best.spendDate ? row : best));
    ads.push({
      metaAdId,
      adName: latest.adName || identity?.adName || "Untitled ad",
      status: identity?.effectiveStatus ?? null,
      campaignName: identity?.campaignName ?? null,
      adsetName: identity?.adsetName ?? null,
      spendCents: sumMetric(rows, (row) => row.spendCents),
      impressions,
      outboundClicks,
      landingPageViews: sumMetric(rows, (row) => row.landingPageViews),
      outboundCtr:
        impressions == null || outboundClicks == null || impressions <= 0
          ? null
          : outboundClicks / impressions,
    });
  }
  ads.sort((a, b) => (b.spendCents ?? -1) - (a.spendCents ?? -1) || a.adName.localeCompare(b.adName));
  return {
    timezone: args.timezone,
    currency: args.currency,
    todayKey: args.todayKey,
    weekStart,
    rangeSince: args.rangeSince,
    rangeUntil: args.rangeUntil,
    todaySpendCents: todayRows.length === 0 ? null : sumMetric(todayRows, (row) => row.spendCents),
    weekSpendCents: weekRows.length === 0 ? null : sumMetric(weekRows, (row) => row.spendCents),
    activeCount,
    lastImportedAt,
    stale,
    ads,
  };
}

function latestStatusCheck(identities: readonly AdLabIdentity[]): string | null {
  return identities.reduce<string | null>((latest, row) => {
    if (!row.statusCheckedAt) return latest;
    if (!latest || row.statusCheckedAt > latest) return row.statusCheckedAt;
    return latest;
  }, null);
}
