import "server-only";

import type { AcquisitionOffer } from "@/lib/acquisition/assets";
import {
  playbookReadiness,
  resolvePinnedOrLegacy,
  reviewPlaybookDraft,
  unavailableCampaign,
  unpinnedCampaignSource,
  type PlaybookDraft,
  type PlaybookReadiness,
  type PlaybookStatus,
  type PlaybookVersion,
  type ResolvedCampaign,
} from "@/lib/acquisition/playbook";
import { supabaseServer } from "@/lib/supabase-server";

const COLUMNS = "id, campaign_id, version, name, audience, offer_label, offer_key, resources, manual_resource, personal_video_id, permitted_actions, reply_guidance, fulfillment, status, scheduling_open, created_at";

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return /acquisition_campaign_playbooks|acquisition_journey_playbook_pins/i.test(message)
    && /schema cache|does not exist|could not find/i.test(message);
}

function asVersion(row: Record<string, unknown>): PlaybookVersion | null {
  if (typeof row.id !== "string" || typeof row.campaign_id !== "string" || typeof row.name !== "string") return null;
  if (typeof row.version !== "number" || typeof row.audience !== "string" || typeof row.fulfillment !== "string" || typeof row.status !== "string") return null;
  const resources = Array.isArray(row.resources) ? row.resources.filter((item): item is PlaybookVersion["resources"][number] => item === "definite_dozen" || item === "playbook" || item === "definite_dozen_ad") : [];
  const permitted = Array.isArray(row.permitted_actions)
    ? row.permitted_actions.filter((item): item is PlaybookVersion["permittedActions"][number] => item === "send_asset" || item === "send_video")
    : [];
  return {
    id: row.id,
    campaignId: row.campaign_id,
    version: row.version,
    name: row.name,
    audience: row.audience,
    offerLabel: typeof row.offer_label === "string" ? row.offer_label : null,
    offerKey: typeof row.offer_key === "string" ? row.offer_key : null,
    resources,
    manualResource: typeof row.manual_resource === "string" ? row.manual_resource : null,
    personalVideoId: typeof row.personal_video_id === "string" ? row.personal_video_id : null,
    permittedActions: permitted,
    replyGuidance: typeof row.reply_guidance === "string" ? row.reply_guidance : null,
    fulfillment: row.fulfillment as PlaybookVersion["fulfillment"],
    status: row.status as PlaybookStatus,
    schedulingOpen: row.scheduling_open === true,
  };
}

type PlaybookRead = { kind: "missing" } | { kind: "error" } | { kind: "empty" } | { kind: "row"; row: PlaybookVersion };

async function latestPlaybook(campaignId: string): Promise<PlaybookRead> {
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select(COLUMNS)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (missingTable(error)) return { kind: "missing" };
  if (error || !data) return error ? { kind: "error" } : { kind: "empty" };
  const version = asVersion(data as Record<string, unknown>);
  return version ? { kind: "row", row: version } : { kind: "error" };
}

async function videoReady(videoId: string | null): Promise<boolean> {
  if (!videoId) return false;
  const { data, error } = await supabaseServer.from("personal_videos").select("status").eq("id", videoId).maybeSingle();
  if (error || !data) return false;
  return data.status === "ready";
}

export async function campaignPlaybookPresence(campaignId: string): Promise<"present" | "absent" | "unavailable"> {
  const latest = await latestPlaybook(campaignId);
  if (latest.kind === "missing" || latest.kind === "empty") return "absent";
  if (latest.kind === "error") return "unavailable";
  return "present";
}

export async function pinJourneyPlaybook(args: { event: "inserted" | "duplicate" | "failed"; journeyId: string | null; campaignId: string | null }): Promise<void> {
  if (args.event !== "inserted" || !args.journeyId || !args.campaignId) return;
  const latest = await latestPlaybook(args.campaignId);
  if (latest.kind !== "row") return;
  const { error } = await supabaseServer.from("acquisition_journey_playbook_pins").insert({
    journey_id: args.journeyId,
    playbook_id: latest.row.id,
  });
  if (error && (error as { code?: string }).code !== "23505" && !missingTable(error)) {
    console.warn("[acquisition] playbook pin was not stored");
  }
}

export async function loadResolvedCampaign(args: {
  journeyId: string | null;
  campaignId: string | null;
  campaignValue: unknown;
  offers: ReadonlyMap<string, AcquisitionOffer>;
}): Promise<ResolvedCampaign> {
  const legacy = () => resolvePinnedOrLegacy({
    pinned: null,
    videoReady: false,
    campaignValue: args.campaignValue,
    offers: args.offers,
  });
  if (!args.journeyId) return legacy();
  const pin = await supabaseServer
    .from("acquisition_journey_playbook_pins")
    .select("playbook_id")
    .eq("journey_id", args.journeyId)
    .maybeSingle();
  if (missingTable(pin.error)) return legacy();
  if (pin.error) return unavailableCampaign();
  if (typeof pin.data?.playbook_id !== "string") {
    if (!args.campaignId) return legacy();
    const presence = await campaignPlaybookPresence(args.campaignId);
    if (presence === "unavailable") return unavailableCampaign();
    if (presence === "absent") return legacy();
    const source = unpinnedCampaignSource({
      playbooksPresent: true,
      journeyCreatedAt: await createdAt("acquisition_journeys", "id", args.journeyId),
      playbookCreatedAt: await earliestPlaybookCreatedAt(args.campaignId),
    });
    return source === "legacy" ? legacy() : unavailableCampaign();
  }
  const row = await supabaseServer.from("acquisition_campaign_playbooks").select(COLUMNS).eq("id", pin.data.playbook_id).maybeSingle();
  if (missingTable(row.error)) return legacy();
  if (row.error || !row.data) return unavailableCampaign();
  const version = asVersion(row.data as Record<string, unknown>);
  if (!version) return unavailableCampaign();
  return resolvePinnedOrLegacy({
    pinned: version,
    videoReady: await videoReady(version.personalVideoId),
    campaignValue: args.campaignValue,
    offers: args.offers,
  });
}

async function createdAt(table: "acquisition_journeys", column: "id", id: string): Promise<string | null> {
  const { data, error } = await supabaseServer.from(table).select("created_at").eq(column, id).maybeSingle();
  return !error && typeof data?.created_at === "string" ? data.created_at : null;
}

async function earliestPlaybookCreatedAt(campaignId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return !error && typeof data?.created_at === "string" ? data.created_at : null;
}

export async function journeyPlaybookFollowUp(journeyId: string): Promise<"pinned" | "legacy" | "unknown"> {
  const obligation = await journeyObligation(journeyId);
  return obligation.followUp;
}

export async function journeyObligation(journeyId: string): Promise<{
  followUp: "pinned" | "legacy" | "unknown";
  permitted: ("send_asset" | "send_video")[];
}> {
  const { data, error } = await supabaseServer
    .from("acquisition_journey_playbook_pins")
    .select("playbook_id")
    .eq("journey_id", journeyId)
    .maybeSingle();
  if (missingTable(error)) return { followUp: "legacy", permitted: [] };
  if (error) return { followUp: "unknown", permitted: [] };
  if (typeof data?.playbook_id !== "string") return { followUp: "legacy", permitted: [] };
  const row = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("permitted_actions")
    .eq("id", data.playbook_id)
    .maybeSingle();
  if (row.error || !row.data) return { followUp: "unknown", permitted: [] };
  const permitted = Array.isArray(row.data.permitted_actions)
    ? row.data.permitted_actions.flatMap((item) => (
      item === "send_asset" || item === "send_video" ? [item] : []
    ))
    : [];
  return { followUp: "pinned", permitted };
}

export async function pinnedDeliveryVideoId(journeyId: string): Promise<string | null | "unavailable"> {
  const pin = await supabaseServer
    .from("acquisition_journey_playbook_pins")
    .select("playbook_id")
    .eq("journey_id", journeyId)
    .maybeSingle();
  if (missingTable(pin.error) || typeof pin.data?.playbook_id !== "string") return pin.error && !missingTable(pin.error) ? "unavailable" : null;
  const row = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("personal_video_id, permitted_actions")
    .eq("id", pin.data.playbook_id)
    .maybeSingle();
  if (row.error || !row.data) return "unavailable";
  const permitted = Array.isArray(row.data.permitted_actions) ? row.data.permitted_actions : [];
  return permitted.includes("send_video") && typeof row.data.personal_video_id === "string"
    ? row.data.personal_video_id
    : null;
}

async function knowledgeCount(draft: PlaybookDraft): Promise<number> {
  const filters = [`and(scope.eq.campaign,campaign_id.eq.${draft.campaignId})`];
  if (draft.offerKey) filters.push(`and(scope.eq.offer,offer_key.eq.${draft.offerKey})`);
  const { count, error } = await supabaseServer
    .from("acquisition_email_knowledge")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .or(filters.join(","));
  if (error || count == null) return 0;
  return count;
}

export async function listCampaignPlaybooks(): Promise<{ ok: true; playbooks: Array<PlaybookVersion & { readiness: PlaybookReadiness }> } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select(COLUMNS)
    .order("campaign_id", { ascending: true })
    .order("version", { ascending: false })
    .limit(100);
  if (missingTable(error)) return { ok: false, error: "The playbook table is not installed yet." };
  if (error || !Array.isArray(data)) return { ok: false, error: "Campaign playbooks could not be read." };
  const playbooks = [];
  for (const row of data) {
    const version = asVersion(row as Record<string, unknown>);
    if (!version) continue;
    const status = version.personalVideoId ? await videoReady(version.personalVideoId) : null;
    playbooks.push({
      ...version,
      readiness: playbookReadiness({
        draft: version,
        status: version.status,
        videoStatus: version.personalVideoId ? (status ? "ready" : "not_ready") : null,
        knowledgeCount: await knowledgeCount(version),
        schedulingOpen: version.schedulingOpen,
      }),
    });
  }
  return { ok: true, playbooks };
}

export async function saveCampaignPlaybook(draft: PlaybookDraft): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const reviewed = reviewPlaybookDraft(draft);
  if (!reviewed.ok) return reviewed;
  const { data, error } = await supabaseServer.rpc("acquisition_save_campaign_playbook", {
    p_campaign_id: reviewed.draft.campaignId,
    p_name: reviewed.draft.name,
    p_audience: reviewed.draft.audience,
    p_offer_label: reviewed.draft.offerLabel,
    p_offer_key: reviewed.draft.offerKey,
    p_resources: reviewed.draft.resources,
    p_manual_resource: reviewed.draft.manualResource,
    p_personal_video_id: reviewed.draft.personalVideoId,
    p_permitted_actions: reviewed.draft.permittedActions,
    p_reply_guidance: reviewed.draft.replyGuidance,
    p_fulfillment: reviewed.draft.fulfillment,
  });
  if (missingTable(error) || (error && /acquisition_save_campaign_playbook/i.test(error.message ?? "") && /schema cache|does not exist|could not find/i.test(error.message ?? ""))) {
    return { ok: false, error: "The playbook table is not installed yet." };
  }
  const saved = data && typeof data === "object" && !Array.isArray(data) ? data as { id?: unknown; version?: unknown } : null;
  if (error || typeof saved?.id !== "string" || typeof saved.version !== "number") {
    return { ok: false, error: "The playbook version was not saved." };
  }
  return { ok: true, id: saved.id, version: saved.version };
}

export async function setCampaignPlaybookStatus(args: {
  campaignId: string;
  status: "paused" | "retired" | "current";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const latest = await latestPlaybook(args.campaignId);
  if (latest.kind === "missing") return { ok: false, error: "The playbook table is not installed yet." };
  if (latest.kind !== "row") return { ok: false, error: "No playbook exists for that campaign." };
  if (args.status === "current" && latest.row.status !== "paused" && latest.row.status !== "retired") {
    return { ok: false, error: "Only a paused or retired playbook can be resumed." };
  }
  if (latest.row.status === "retired" && args.status !== "current") {
    return { ok: false, error: "A retired playbook stays closed until it is resumed." };
  }
  const allowed = args.status === "paused"
    ? "current"
    : args.status === "current"
      ? latest.row.status === "retired" ? "retired" : "paused"
      : latest.row.status;
  if (args.status === "retired" && latest.row.status !== "current" && latest.row.status !== "paused") {
    return { ok: false, error: "Only the open playbook can be retired." };
  }
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .update({ status: args.status, scheduling_open: args.status === "current" })
    .eq("id", latest.row.id)
    .eq("status", args.status === "retired" ? latest.row.status : allowed)
    .select("id");
  if (error || !Array.isArray(data) || data.length !== 1) return { ok: false, error: "The playbook status was not changed." };
  return { ok: true };
}
