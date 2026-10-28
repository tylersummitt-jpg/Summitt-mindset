import "server-only";

import {
  applyCampaignActivation,
  campaignAutomationOpen,
  CAMPAIGN_ACTIVATION_STATES,
  fulfillmentEligible,
  type CampaignActivation,
  type CampaignActivationState,
  type CampaignAutomationAction,
  type PendingFulfillmentView,
} from "@/lib/acquisition/campaign-activation";
import { setCampaignPlaybookStatus } from "@/lib/acquisition/playbook.server";
import { supabaseServer } from "@/lib/supabase-server";

const GATE_COLUMNS = "automation_status, conversation_interpretation, conversation_sending, instantly_blocklist";
const ACTIVATION_COLUMNS = "campaign_id, state, activated_at, last_activated_at";
const PAGE = 1000;
const MAX_PAGES = 5;

export type AutomationGates = {
  automation: string;
  interpretation: string;
  sending: string;
  blocklist: string;
};

type GateRow = {
  automation_status: string;
  conversation_interpretation: string;
  conversation_sending: string;
  instantly_blocklist: string;
};

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return /acquisition_campaign_activations/i.test(message)
    && /schema cache|does not exist|could not find/i.test(message);
}

function asState(value: unknown): CampaignActivationState | null {
  return CAMPAIGN_ACTIVATION_STATES.includes(value as CampaignActivationState)
    ? value as CampaignActivationState
    : null;
}

function asTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function fromRow(row: Record<string, unknown>): CampaignActivation | null {
  const id = typeof row.campaign_id === "string" ? row.campaign_id.trim() : "";
  const state = asState(row.state);
  if (!id || !state) return null;
  const storedGate = asTimestamp(row.activated_at);
  const lastActivatedAt = asTimestamp(row.last_activated_at);
  if (state === "active") {
    if (!storedGate) return null;
    return { id, state, activatedAt: storedGate, lastActivatedAt: lastActivatedAt ?? storedGate };
  }
  return { id, state, activatedAt: null, lastActivatedAt };
}

export async function readStoredCampaignActivations(): Promise<
  { ok: true; activations: CampaignActivation[] } | { ok: false; error: string }
> {
  const activations: CampaignActivation[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await supabaseServer
      .from("acquisition_campaign_activations")
      .select(ACTIVATION_COLUMNS)
      .order("campaign_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (missingTable(error)) {
      return { ok: false, error: "Campaign activation is not installed yet. Nothing was changed." };
    }
    if (error || !Array.isArray(data)) {
      return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
    }
    for (const item of data) {
      const row = fromRow(item as Record<string, unknown>);
      if (!row) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
      activations.push(row);
    }
    if (data.length < PAGE) return { ok: true, activations };
  }
  return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
}

async function readGates(): Promise<GateRow | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select(GATE_COLUMNS)
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.automation_status !== "string") return null;
  if (typeof row.conversation_interpretation !== "string") return null;
  if (typeof row.conversation_sending !== "string") return null;
  if (typeof row.instantly_blocklist !== "string") return null;
  return {
    automation_status: row.automation_status,
    conversation_interpretation: row.conversation_interpretation,
    conversation_sending: row.conversation_sending,
    instantly_blocklist: row.instantly_blocklist,
  };
}

export async function readCampaignActivationBoard(): Promise<
  | {
      ok: true;
      activations: CampaignActivation[];
      pending: PendingFulfillmentView[];
      pendingTruncated: boolean;
      fulfillmentCounts: Record<string, number>;
      gates: AutomationGates;
    }
  | { ok: false; error: string }
> {
  const [stored, gates] = await Promise.all([readStoredCampaignActivations(), readGates()]);
  if (!stored.ok) return stored;
  if (!gates) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
  const activations = stored.activations;
  const pending: PendingFulfillmentView[] = [];
  const fulfillmentCounts: Record<string, number> = {};
  let pendingTruncated = false;
  const actionRows: Array<Record<string, unknown>> = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await supabaseServer
      .from("acquisition_actions")
      .select("id, action_type, status, scheduled_at, journey_id")
      .in("status", ["scheduled", "claimed"])
      .order("scheduled_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !Array.isArray(data)) return { ok: false, error: "Pending fulfillment could not be read. Nothing was changed." };
    actionRows.push(...data as Array<Record<string, unknown>>);
    if (data.length < PAGE) break;
    if (page === MAX_PAGES - 1) pendingTruncated = true;
  }
  const journeyIds = [...new Set(actionRows.flatMap((item) => typeof item.journey_id === "string" ? [item.journey_id] : []))];
  const campaignByJourney = new Map<string, string | null>();
  for (let index = 0; index < journeyIds.length; index += PAGE) {
    const slice = journeyIds.slice(index, index + PAGE);
    const journeys = await supabaseServer.from("acquisition_journeys").select("id, campaign_id").in("id", slice);
    if (journeys.error || !Array.isArray(journeys.data)) {
      return { ok: false, error: "Pending fulfillment could not be read. Nothing was changed." };
    }
    for (const journey of journeys.data) {
      if (typeof journey.id === "string") {
        campaignByJourney.set(journey.id, typeof journey.campaign_id === "string" ? journey.campaign_id : null);
      }
    }
  }
  for (const item of actionRows) {
    if (typeof item.id !== "string") continue;
    if (item.status !== "scheduled" && item.status !== "claimed") continue;
    if (item.action_type !== "send_asset" && item.action_type !== "send_video" && item.action_type !== "send_trial_followup") continue;
    const journeyId = typeof item.journey_id === "string" ? item.journey_id : null;
    const campaignId = journeyId ? campaignByJourney.get(journeyId) ?? null : null;
    const scheduledAt = typeof item.scheduled_at === "string" ? item.scheduled_at : null;
    if (campaignId) fulfillmentCounts[campaignId] = (fulfillmentCounts[campaignId] ?? 0) + 1;
    if (pending.length >= 100) continue;
    pending.push({
      id: item.id,
      campaignId,
      actionType: item.action_type,
      status: item.status,
      scheduledAt,
      willSend: item.status === "scheduled" && fulfillmentEligible({ activations, campaignId, scheduledAt }),
    });
  }
  return {
    ok: true,
    activations,
    pending,
    pendingTruncated,
    fulfillmentCounts,
    gates: {
      automation: gates.automation_status,
      interpretation: gates.conversation_interpretation,
      sending: gates.conversation_sending,
      blocklist: gates.instantly_blocklist,
    },
  };
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
  const stored = await readStoredCampaignActivations();
  if (!stored.ok) return stored;
  const next = applyCampaignActivation({
    current: stored.activations,
    campaignId: args.campaignId,
    action: args.action,
    now: new Date(),
  });
  if (!next.ok) return next;
  const row = next.activations.find((item) => item.id === args.campaignId.trim());
  if (!row?.state) return { ok: false, error: "Campaign activation could not be read. Nothing was changed." };
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_activations")
    .upsert({
      campaign_id: row.id,
      state: row.state,
      activated_at: row.activatedAt,
      last_activated_at: row.lastActivatedAt,
      updated_at: now,
    }, { onConflict: "campaign_id" })
    .select("campaign_id");
  if (missingTable(error)) return { ok: false, error: "Campaign activation is not installed yet. Nothing was changed." };
  if (error || !Array.isArray(data) || data.length !== 1) {
    return { ok: false, error: "The campaign activation was not saved." };
  }
  return { ok: true, activatedAt: next.activatedAt };
}

export async function releaseScheduledFulfillment(args: {
  actionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = args.actionId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That fulfillment action was not found." };
  const stored = await readStoredCampaignActivations();
  if (!stored.ok) return stored;
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
  if (!campaignAutomationOpen(stored.activations, campaignId)) {
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
