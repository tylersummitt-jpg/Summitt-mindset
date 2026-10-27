import "server-only";

import {
  applyCampaignActivation,
  campaignAutomationOpen,
  fulfillmentEligible,
  parseCampaignActivations,
  type CampaignActivation,
  type CampaignAutomationAction,
  type PendingFulfillmentView,
} from "@/lib/acquisition/campaign-activation";
import { setCampaignPlaybookStatus } from "@/lib/acquisition/playbook.server";
import { supabaseServer } from "@/lib/supabase-server";

const CONTROL_COLUMNS = "automation_status, conversation_interpretation, conversation_sending, instantly_blocklist, conversation_pilot_campaigns, updated_at";

type SettingsRow = {
  automation_status: string;
  conversation_interpretation: string;
  conversation_sending: string;
  instantly_blocklist: string;
  conversation_pilot_campaigns: unknown;
  updated_at: string;
};

function asSettingsRow(value: unknown): SettingsRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.automation_status !== "string") return null;
  if (typeof row.conversation_interpretation !== "string") return null;
  if (typeof row.conversation_sending !== "string") return null;
  if (typeof row.instantly_blocklist !== "string") return null;
  if (typeof row.updated_at !== "string") return null;
  if (!Array.isArray(row.conversation_pilot_campaigns)) return null;
  return {
    automation_status: row.automation_status,
    conversation_interpretation: row.conversation_interpretation,
    conversation_sending: row.conversation_sending,
    instantly_blocklist: row.instantly_blocklist,
    conversation_pilot_campaigns: row.conversation_pilot_campaigns,
    updated_at: row.updated_at,
  };
}

async function readSettingsRow(): Promise<SettingsRow | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select(CONTROL_COLUMNS)
    .eq("id", "default")
    .maybeSingle();
  if (error) return null;
  return asSettingsRow(data);
}

export async function readCampaignActivationBoard(): Promise<
  | { ok: true; activations: CampaignActivation[]; pending: PendingFulfillmentView[] }
  | { ok: false; error: string }
> {
  const row = await readSettingsRow();
  if (!row) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
  const activations = parseCampaignActivations(row.conversation_pilot_campaigns);
  const { data, error } = await supabaseServer
    .from("acquisition_actions")
    .select("id, action_type, status, scheduled_at, journey_id")
    .in("status", ["scheduled", "claimed"])
    .order("scheduled_at", { ascending: true })
    .limit(50);
  if (error || !Array.isArray(data)) return { ok: false, error: "Pending fulfillment could not be read. Nothing was changed." };
  const journeyIds = [...new Set(data.flatMap((item) => typeof item.journey_id === "string" ? [item.journey_id] : []))];
  const campaignByJourney = new Map<string, string | null>();
  if (journeyIds.length > 0) {
    const journeys = await supabaseServer.from("acquisition_journeys").select("id, campaign_id").in("id", journeyIds);
    if (journeys.error || !Array.isArray(journeys.data)) {
      return { ok: false, error: "Pending fulfillment could not be read. Nothing was changed." };
    }
    for (const journey of journeys.data) {
      if (typeof journey.id === "string") {
        campaignByJourney.set(journey.id, typeof journey.campaign_id === "string" ? journey.campaign_id : null);
      }
    }
  }
  const pending: PendingFulfillmentView[] = [];
  for (const item of data) {
    if (typeof item.id !== "string") continue;
    if (item.status !== "scheduled" && item.status !== "claimed") continue;
    if (item.action_type !== "send_asset" && item.action_type !== "send_video" && item.action_type !== "send_trial_followup") continue;
    const journeyId = typeof item.journey_id === "string" ? item.journey_id : null;
    const campaignId = journeyId ? campaignByJourney.get(journeyId) ?? null : null;
    const scheduledAt = typeof item.scheduled_at === "string" ? item.scheduled_at : null;
    pending.push({
      id: item.id,
      campaignId,
      actionType: item.action_type,
      status: item.status,
      scheduledAt,
      willSend: item.status === "scheduled" && fulfillmentEligible({ activations, campaignId, scheduledAt }),
    });
  }
  return { ok: true, activations, pending };
}

export async function setCampaignAutomation(args: {
  campaignId: string;
  action: CampaignAutomationAction;
}): Promise<{ ok: true; activatedAt: string | null } | { ok: false; error: string }> {
  if (args.action === "finish") {
    const retired = await setCampaignPlaybookStatus({ campaignId: args.campaignId, status: "retired" });
    if (!retired.ok && retired.error !== "No playbook exists for that campaign." && retired.error !== "A retired playbook stays closed until it is resumed.") {
      return retired;
    }
  }
  const row = await readSettingsRow();
  if (!row) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
  const next = applyCampaignActivation({
    current: parseCampaignActivations(row.conversation_pilot_campaigns),
    campaignId: args.campaignId,
    action: args.action,
    now: new Date(),
  });
  if (!next.ok) return next;
  const serialized = next.activations.map((item) => ({ id: item.id, activatedAt: item.activatedAt }));
  if (JSON.stringify(serialized).length > 1800) return { ok: false, error: "The campaign list is too large." };
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .update({
      conversation_pilot_campaigns: serialized,
      updated_at: now,
    })
    .eq("id", "default")
    .eq("updated_at", row.updated_at)
    .eq("automation_status", row.automation_status)
    .eq("conversation_interpretation", row.conversation_interpretation)
    .eq("conversation_sending", row.conversation_sending)
    .eq("instantly_blocklist", row.instantly_blocklist)
    .select("id");
  if (error || !Array.isArray(data) || data.length !== 1) {
    return { ok: false, error: "The campaign list changed. Reload and try again." };
  }
  return { ok: true, activatedAt: next.activatedAt };
}

export async function releaseScheduledFulfillment(args: {
  actionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = args.actionId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That fulfillment action was not found." };
  const row = await readSettingsRow();
  if (!row) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
  const activations = parseCampaignActivations(row.conversation_pilot_campaigns);
  const { data: action, error } = await supabaseServer
    .from("acquisition_actions")
    .select("id, status, journey_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !action || action.status !== "scheduled" || typeof action.journey_id !== "string") {
    return { ok: false, error: "Only a scheduled fulfillment action can be released." };
  }
  const journey = await supabaseServer
    .from("acquisition_journeys")
    .select("campaign_id")
    .eq("id", action.journey_id)
    .maybeSingle();
  const campaignId = !journey.error && typeof journey.data?.campaign_id === "string" ? journey.data.campaign_id : null;
  if (!campaignAutomationOpen(activations, campaignId)) {
    return { ok: false, error: "Activate that campaign before releasing a scheduled action." };
  }
  const now = new Date().toISOString();
  const { data, error: updateError } = await supabaseServer
    .from("acquisition_actions")
    .update({ scheduled_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id");
  if (updateError || !Array.isArray(data) || data.length !== 1) {
    return { ok: false, error: "The scheduled action was not released." };
  }
  return { ok: true };
}
