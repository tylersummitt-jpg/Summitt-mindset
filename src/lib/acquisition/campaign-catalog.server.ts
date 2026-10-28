import "server-only";

import { ACQUISITION_ASSET_FILES } from "@/lib/acquisition/assets";
import { organizeCampaigns, type CatalogCampaign } from "@/lib/acquisition/campaign-catalog";
import type { PendingFulfillmentView } from "@/lib/acquisition/campaign-activation";
import { readCampaignActivationBoard } from "@/lib/acquisition/campaign-activation.server";
import { listInstantlyCampaignProfiles } from "@/lib/acquisition/instantly-analytics.server";
import { listPlaybookHeads } from "@/lib/acquisition/playbook.server";
import type { PlaybookVersion } from "@/lib/acquisition/playbook";
import { supabaseServer } from "@/lib/supabase-server";

export type CampaignCatalog = {
  ok: true;
  campaigns: CatalogCampaign[];
  playbooks: PlaybookVersion[];
  instantly: "ready" | "unavailable";
  instantlyError: string | null;
  truncated: boolean;
  gates: {
    automation: string;
    interpretation: string;
    sending: string;
    blocklist: string;
  } | null;
  activationError: string | null;
  pending: PendingFulfillmentView[];
  pendingTruncated: boolean;
};

async function legacyAssets(): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select("campaign_assets")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data || !data.campaign_assets || typeof data.campaign_assets !== "object" || Array.isArray(data.campaign_assets)) {
    return {};
  }
  return data.campaign_assets as Record<string, unknown>;
}

async function recentActivity(): Promise<Map<string, string> | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_events")
    .select("campaign_id, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (error || !Array.isArray(data)) return null;
  const latest = new Map<string, string>();
  for (const row of data) {
    if (typeof row.campaign_id !== "string" || typeof row.occurred_at !== "string") continue;
    if (!latest.has(row.campaign_id)) latest.set(row.campaign_id, row.occurred_at);
  }
  return latest;
}

export async function readCampaignCatalog(): Promise<CampaignCatalog | { ok: false; error: string }> {
  const [heads, board, instantly, assets, activity] = await Promise.all([
    listPlaybookHeads(),
    readCampaignActivationBoard(),
    listInstantlyCampaignProfiles(),
    legacyAssets(),
    recentActivity(),
  ]);
  if (!heads.ok) return heads;
  const resourceLabelsByKey = Object.fromEntries(
    Object.entries(ACQUISITION_ASSET_FILES).map(([key, file]) => [key, file.label]),
  );
  const organized = organizeCampaigns({
    instantly: instantly.profiles?.map((profile) => ({
      id: profile.id,
      name: profile.name,
      statusLabel: profile.statusLabel,
      statusFilter: profile.statusFilter,
    })) ?? null,
    playbooks: heads.playbooks.map((playbook) => ({
      campaignId: playbook.campaignId,
      version: playbook.version,
      status: playbook.status,
      audience: playbook.audience,
      offerLabel: playbook.offerLabel,
      resources: playbook.resources,
    })),
    activations: board.ok ? board.activations : null,
    legacyAssets: assets,
    resourceLabelsByKey,
    fulfillmentCounts: board.ok ? board.fulfillmentCounts : {},
    activity,
  });
  return {
    ok: true,
    campaigns: organized.campaigns,
    playbooks: heads.playbooks,
    instantly: instantly.profiles ? "ready" : "unavailable",
    instantlyError: instantly.error,
    truncated: heads.truncated || instantly.truncated || (board.ok && board.pendingTruncated),
    gates: board.ok ? board.gates : null,
    activationError: board.ok ? null : board.error,
    pending: board.ok ? board.pending : [],
    pendingTruncated: board.ok ? board.pendingTruncated : false,
  };
}
