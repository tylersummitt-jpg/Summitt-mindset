/**
 * Service-role access for Ad Lab tables. Server-only.
 */

import "server-only";

import type { AdLabIdentity, AdLabStore } from "@/lib/ad-lab-import";
import { supabaseServer } from "@/lib/supabase-server";

const LOCK_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AD_COLUMNS =
  "meta_ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name, effective_status, creative_id, first_seen_on, last_seen_on, status_checked_at, metadata_imported_at";

export function createSupabaseAdLabStore(): AdLabStore {
  return {
    async readAds(accountId) {
      const { data, error } = await supabaseServer
        .from("ad_lab_ads")
        .select(AD_COLUMNS)
        .eq("account_id", accountId)
        .limit(2000);
      if (error) {
        console.warn("[meta-ad-lab] ad read failed", { code: error.code ?? null });
        return { ok: false };
      }
      if ((data ?? []).length >= 2000) return { ok: false };
      return {
        ok: true,
        ads: (data ?? [])
          .map((row) => identityFromRow(row as Record<string, unknown>))
          .filter((row) => row.metaAdId && row.firstSeenOn && row.lastSeenOn),
      };
    },
    async claimImport(accountId) {
      const { data, error } = await supabaseServer.rpc("ad_lab_claim_import", {
        p_account_id: accountId,
      });
      if (error) {
        console.warn("[meta-ad-lab] import claim failed", { code: error.code ?? null });
        return { ok: false, reason: "storage" };
      }
      if (data === "busy" || data === "cooldown") return { ok: false, reason: data };
      if (typeof data === "string" && LOCK_TOKEN.test(data)) return { ok: true, token: data };
      console.warn("[meta-ad-lab] import claim failed", { code: "unexpected" });
      return { ok: false, reason: "storage" };
    },
    async finishImport(accountId, token, succeeded) {
      const { error } = await supabaseServer.rpc("ad_lab_finish_import", {
        p_account_id: accountId,
        p_token: token,
        p_succeeded: succeeded,
      });
      if (error) {
        console.warn("[meta-ad-lab] import finish failed", { code: error.code ?? null });
      }
    },
    async commitImport(commit) {
      if (commit.ads.length === 0 && commit.days.length === 0) return { ok: true };
      const { error } = await supabaseServer.rpc("ad_lab_import_batch", {
        p_account_id: commit.accountId,
        p_ads: commit.ads.map((ad) => ({
          meta_ad_id: ad.metaAdId,
          ad_name: ad.adName,
          campaign_id: ad.campaignId,
          campaign_name: ad.campaignName,
          adset_id: ad.adsetId,
          adset_name: ad.adsetName,
          effective_status: ad.effectiveStatus,
          creative_id: ad.creativeId,
          first_seen_on: ad.firstSeenOn,
          last_seen_on: ad.lastSeenOn,
          status_checked_at: ad.statusCheckedAt,
          metadata_imported_at: ad.metadataImportedAt ?? commit.importedAt,
          updated_at: commit.importedAt,
        })),
        p_days: commit.days.map((day) => ({
          meta_ad_id: day.metaAdId,
          spend_date: day.spendDate,
          spend_cents: day.spendCents,
          currency: commit.currency,
          account_timezone: commit.timezone,
          impressions: day.impressions,
          outbound_clicks: day.outboundClicks,
          landing_page_views: day.landingPageViews,
          ad_name: day.adName,
          imported_at: commit.importedAt,
        })),
      });
      if (error) {
        console.warn("[meta-ad-lab] import write failed", { code: error.code ?? null });
        return { ok: false };
      }
      return { ok: true };
    },
  };
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
    metadataImportedAt: text(row.metadata_imported_at),
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
