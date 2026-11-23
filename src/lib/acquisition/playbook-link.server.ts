import "server-only";

import { parseAcquisitionCampaignId } from "@/lib/acquisition/campaign-token-shape";
import { acquisitionCampaignLeadershipKitUrl, signedCampaignGuideUrl } from "@/lib/acquisition/email-acquired-member-notice";
import { supabaseServer } from "@/lib/supabase-server";
import { currentQuietPlaybook } from "@/lib/acquisition/video-first-leads.server";

async function guideVersions(campaignId: string): Promise<{ resources: string[] }[] | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("resources, version")
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(20);
  if (error || !Array.isArray(data)) return null;
  return data.map((row) => ({
    resources: Array.isArray(row.resources)
      ? row.resources.filter((item): item is string => typeof item === "string")
      : [],
  }));
}

export async function signedPlaybookLink(
  campaignId: string,
): Promise<{ ok: true; url: string; campaignName: string } | { ok: false; error: string }> {
  const id = parseAcquisitionCampaignId(campaignId);
  if (!id) return { ok: false, error: "Choose a campaign from the list. No link was created." };
  const playbook = await currentQuietPlaybook(id);
  if ("error" in playbook) return { ok: false, error: playbook.error };
  const versions = await guideVersions(id);
  if (!versions) return { ok: false, error: "The saved guide could not be read. No link was created." };
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const signed = signedCampaignGuideUrl(id, secret, versions);
  if (!signed.ok && signed.reason === "ambiguous") {
    return { ok: false, error: "This campaign has two saved guides. No link was created." };
  }
  if (!signed.ok) return { ok: false, error: "Signed links cannot be created right now. No link was created." };
  return { ok: true, url: signed.url, campaignName: playbook.name };
}

/** A separate membership-offer link. It does not replace the free-resource link. */
export async function signedLeadershipKitLink(
  campaignId: string,
): Promise<{ ok: true; url: string; campaignName: string } | { ok: false; error: string }> {
  const id = parseAcquisitionCampaignId(campaignId);
  if (!id) return { ok: false, error: "Choose a campaign from the list. No link was created." };
  const playbook = await currentQuietPlaybook(id);
  if ("error" in playbook) return { ok: false, error: playbook.error };
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const url = acquisitionCampaignLeadershipKitUrl(id, secret);
  if (!url) return { ok: false, error: "Signed links cannot be created right now. No link was created." };
  return { ok: true, url, campaignName: playbook.name };
}
