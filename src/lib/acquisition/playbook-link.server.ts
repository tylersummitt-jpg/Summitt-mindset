import "server-only";

import { acquisitionCampaignPlaybookUrl } from "@/lib/acquisition/email-acquired-member-notice";
import { parseAcquisitionCampaignId } from "@/lib/acquisition/campaign-token-shape";
import { currentQuietPlaybook } from "@/lib/acquisition/video-first-leads.server";

export async function signedPlaybookLink(
  campaignId: string,
): Promise<{ ok: true; url: string; campaignName: string } | { ok: false; error: string }> {
  const id = parseAcquisitionCampaignId(campaignId);
  if (!id) return { ok: false, error: "Choose a campaign from the list. No link was created." };
  const playbook = await currentQuietPlaybook(id);
  if ("error" in playbook) return { ok: false, error: playbook.error };
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const url = acquisitionCampaignPlaybookUrl(id, secret);
  if (!url) return { ok: false, error: "Signed links cannot be created right now. No link was created." };
  return { ok: true, url, campaignName: playbook.name };
}
