import type { CampaignActivation, CampaignActivationState } from "@/lib/acquisition/campaign-activation";

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type CatalogInstant = {
  id: string;
  name: string | null;
  statusLabel: string;
  statusFilter: string;
};

export type CatalogCampaign = {
  id: string;
  name: string | null;
  instantlyStatus: string;
  instantlyFilter: string;
  playbookStatus: string;
  playbookVersion: number | null;
  audience: string | null;
  offerLabel: string | null;
  resources: string[];
  legacyResource: string | null;
  automation: "not_activated" | "unavailable" | CampaignActivationState;
  activatedAt: string | null;
  lastActivatedAt: string | null;
  outstanding: number;
  lastActivity: string | null;
  activity: "recorded" | "not_in_window" | "unavailable";
};

export type CampaignFilters = {
  query: string;
  instantly: string;
  playbook: string;
  automation: string;
  page: number;
  pageSize: number;
};

export type CatalogPlaybook = {
  campaignId: string;
  version: number;
  status: string;
  audience: string;
  offerLabel: string | null;
  resources: string[];
};

export function legacyResourceLabel(value: unknown, labels: Readonly<Record<string, string>>): string | null {
  if (typeof value !== "string") return null;
  return labels[value] ?? null;
}

export function copiedPlaybookTarget(
  sourceId: string,
  targetId: string,
): { ok: true; campaignId: string } | { ok: false; error: string } {
  const source = sourceId.trim();
  const target = targetId.trim();
  if (!CAMPAIGN_ID.test(target)) return { ok: false, error: "Choose the campaign that should receive this configuration." };
  if (target === source) return { ok: false, error: "Choose a different campaign. The original history stays in place." };
  return { ok: true, campaignId: target };
}

function resourceLabels(keys: readonly string[], labels: Readonly<Record<string, string>>): string[] {
  return keys.flatMap((key) => labels[key] ? [labels[key]] : []);
}

export function organizeCampaigns(args: {
  instantly: readonly CatalogInstant[] | null;
  playbooks: readonly CatalogPlaybook[];
  activations: readonly CampaignActivation[] | null;
  legacyAssets: Record<string, unknown>;
  resourceLabelsByKey: Readonly<Record<string, string>>;
  fulfillmentCounts: Record<string, number>;
  activity: ReadonlyMap<string, string> | null;
}): { campaigns: CatalogCampaign[]; instantly: "ready" | "unavailable" } {
  const instantlyReady = args.instantly != null;
  const byId = new Map<string, CatalogCampaign>();
  const ensure = (id: string): CatalogCampaign | null => {
    const trimmed = id.trim();
    if (!CAMPAIGN_ID.test(trimmed)) return null;
    const existing = byId.get(trimmed);
    if (existing) return existing;
    const created: CatalogCampaign = {
      id: trimmed,
      name: null,
      instantlyStatus: instantlyReady ? "Not returned by Instantly" : "Unavailable",
      instantlyFilter: instantlyReady ? "unknown" : "unavailable",
      playbookStatus: "none",
      playbookVersion: null,
      audience: null,
      offerLabel: null,
      resources: [],
      legacyResource: legacyResourceLabel(args.legacyAssets[trimmed], args.resourceLabelsByKey),
      automation: args.activations == null ? "unavailable" : "not_activated",
      activatedAt: null,
      lastActivatedAt: null,
      outstanding: args.fulfillmentCounts[trimmed] ?? 0,
      lastActivity: args.activity?.get(trimmed) ?? null,
      activity: args.activity == null ? "unavailable" : args.activity.has(trimmed) ? "recorded" : "not_in_window",
    };
    byId.set(trimmed, created);
    return created;
  };

  for (const profile of args.instantly ?? []) {
    const row = ensure(profile.id);
    if (!row) continue;
    row.name = profile.name;
    row.instantlyStatus = profile.statusLabel;
    row.instantlyFilter = profile.statusFilter;
  }
  for (const id of Object.keys(args.legacyAssets)) ensure(id);
  for (const id of Object.keys(args.fulfillmentCounts)) ensure(id);
  for (const playbook of args.playbooks) {
    const row = ensure(playbook.campaignId);
    if (!row) continue;
    row.playbookStatus = playbook.status;
    row.playbookVersion = playbook.version;
    row.audience = playbook.audience;
    row.offerLabel = playbook.offerLabel;
    row.resources = resourceLabels(playbook.resources, args.resourceLabelsByKey);
  }
  for (const activation of args.activations ?? []) {
    const row = ensure(activation.id);
    if (!row) continue;
    row.automation = activation.state ?? (activation.activatedAt ? "active" : "inactive");
    row.activatedAt = activation.state === "active" || activation.state == null ? activation.activatedAt : null;
    row.lastActivatedAt = activation.lastActivatedAt ?? null;
  }
  if (args.activity) {
    for (const id of args.activity.keys()) ensure(id);
  }

  const campaigns = [...byId.values()].sort((left, right) => {
    const leftName = left.name ?? `\uffff${left.id}`;
    const rightName = right.name ?? `\uffff${right.id}`;
    return leftName.localeCompare(rightName) || left.id.localeCompare(right.id);
  });
  return { campaigns, instantly: instantlyReady ? "ready" : "unavailable" };
}

export function filterCampaigns(campaigns: readonly CatalogCampaign[], filters: CampaignFilters): {
  rows: CatalogCampaign[];
  total: number;
  page: number;
  pages: number;
} {
  const query = filters.query.trim().toLowerCase();
  const matched = campaigns.filter((campaign) => {
    if (query && !`${campaign.name ?? ""} ${campaign.id}`.toLowerCase().includes(query)) return false;
    if (filters.instantly !== "all" && campaign.instantlyFilter !== filters.instantly) return false;
    if (filters.playbook !== "all" && campaign.playbookStatus !== filters.playbook) return false;
    if (filters.automation !== "all" && campaign.automation !== filters.automation) return false;
    return true;
  });
  const pageSize = Math.min(100, Math.max(1, filters.pageSize));
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, filters.page), pages);
  const start = (page - 1) * pageSize;
  return { rows: matched.slice(start, start + pageSize), total: matched.length, page, pages };
}

export type AccountGates = {
  automation: string;
  interpretation: string;
  sending: string;
  blocklist: string;
};

export function fulfillmentSwitchOpen(automation: string | null | undefined): boolean {
  return automation === "pilot" || automation === "active";
}

export function postReplyLabel(args: {
  automation: CatalogCampaign["automation"];
  gates: Pick<AccountGates, "automation" | "sending"> | null;
}): string {
  if (args.automation === "not_activated") return "Not turned on";
  if (args.automation === "unavailable") return "Could not be read";
  if (args.automation === "inactive") return "Listed, not turned on";
  if (args.automation === "paused") return "Paused for this campaign";
  if (args.automation === "finished") return "Finished";
  if (!args.gates) return "On for this campaign. Account-wide switches could not be read.";
  if (!fulfillmentSwitchOpen(args.gates.automation) || args.gates.sending !== "on") {
    return "On for this campaign. Account-wide switches are holding mail.";
  }
  return "On for this campaign. Mail can send after this campaign's activation time.";
}

export function accountSwitchLines(gates: AccountGates | null): string[] {
  if (!gates) return ["Account-wide switches could not be read. Nothing was changed."];
  return [
    fulfillmentSwitchOpen(gates.automation)
      ? "Account-wide fulfillment is on. A campaign still needs its own activation time."
      : "Account-wide fulfillment is off. Scheduled resources will not send.",
    gates.sending === "on"
      ? "Automated replies are on for the account. A campaign still needs its own activation time."
      : "Automated replies are off for the account. They will not send.",
    gates.interpretation === "pilot"
      ? "Reply reading is in pilot. Reading a reply does not send one."
      : "Reply reading is off.",
    gates.blocklist === "on" ? "The Instantly blocklist is on." : "The Instantly blocklist is off.",
  ];
}

export type LaunchMark = "done" | "needs_you" | "held" | "unverified";

export type LaunchStep = {
  step: number;
  title: string;
  mark: LaunchMark;
  detail: string;
};

export type LaunchDraft = {
  audience: string;
  offerLabel: string;
  resources: readonly string[];
  personalVideoId: string;
  manualResource: string;
  replyGuidance: string;
  fulfillment: string;
  permittedActions: readonly string[];
};

export function launchChecklist(args: {
  campaign: Pick<CatalogCampaign, "id" | "name" | "playbookStatus" | "automation" | "instantlyStatus"> | null;
  instantly: "ready" | "unavailable";
  copySource: string | null;
  draft: LaunchDraft;
  gates: AccountGates | null;
}): { steps: LaunchStep[]; next: string } {
  const campaign = args.campaign;
  const find = !campaign
    ? {
        mark: "needs_you" as const,
        detail: args.instantly === "ready"
          ? "Search the Instantly campaign name and choose that row. You do not type the campaign id."
          : "Instantly names are unavailable, so this list cannot be searched by name. Choose a row already stored here, or paste the id only if the campaign is missing from the list.",
      }
    : campaign.name
      ? { mark: "done" as const, detail: `Chosen: ${campaign.name}. Instantly cold email is ${campaign.instantlyStatus}. This page does not start or stop that sequence.` }
      : { mark: "unverified" as const, detail: "This campaign is selected. Instantly did not return its name, so no name is shown." };

  const playbook = args.copySource
    ? {
        mark: "needs_you" as const,
        detail: args.campaign && args.campaign.id !== args.copySource
          ? "Save this copy on the selected campaign. The original campaign keeps its history."
          : "Choose a different campaign in the list, then save. The original campaign keeps its history.",
      }
    : !campaign
      ? { mark: "needs_you" as const, detail: "After you choose a campaign, save a playbook or copy one from another campaign." }
      : campaign.playbookStatus === "current"
        ? { mark: "done" as const, detail: "A playbook is saved. If you change the fields below, save again. Saving does not turn on replies or fulfillment." }
        : campaign.playbookStatus === "paused"
          ? { mark: "needs_you" as const, detail: "This playbook is paused for new conversations. Resume the playbook when it should be used again. That does not change post-reply automation." }
          : campaign.playbookStatus === "retired"
            ? { mark: "needs_you" as const, detail: "This playbook is retired. Resume it before new conversations use it." }
            : { mark: "needs_you" as const, detail: "Save a playbook for this campaign, or copy one from another campaign onto it." };

  const audience = args.draft.audience.trim();
  const offer = args.draft.offerLabel.trim();
  const guidance = args.draft.replyGuidance.trim();
  const needsResource = args.draft.fulfillment === "catalog" || args.draft.fulfillment === "catalog_and_video";
  const needsVideo = args.draft.fulfillment === "video" || args.draft.fulfillment === "catalog_and_video";
  const resourceReady = !needsResource || args.draft.resources.length > 0;
  const videoReady = !needsVideo || Boolean(args.draft.personalVideoId.trim());
  const manualReady = args.draft.fulfillment !== "manual" || Boolean(args.draft.manualResource.trim());
  const sendReady = (!needsResource || args.draft.permittedActions.includes("send_asset"))
    && (!needsVideo || args.draft.permittedActions.includes("send_video"));
  const confirm = !args.campaign
    ? { mark: "needs_you" as const, detail: "This confirmation opens after you choose a campaign." }
    : !audience
    ? { mark: "needs_you" as const, detail: "Enter the audience. Coaches, athletic directors, corporate leaders, HR teams, and any later audience use this same field." }
    : !offer
      ? { mark: "needs_you" as const, detail: "Enter the offer in plain language. Leave the offer key blank unless that offer already has one." }
      : !resourceReady
        ? { mark: "needs_you" as const, detail: "Choose the resource. The same files are available for every audience." }
        : !videoReady
          ? { mark: "needs_you" as const, detail: "Choose the video. A resource-only playbook can leave the video blank." }
          : !manualReady
            ? { mark: "needs_you" as const, detail: "Describe the resource that has to be fulfilled separately." }
            : !sendReady
              ? { mark: "needs_you" as const, detail: "Check the permitted action for the resource or video. Without that check, an accepted reply does not send it." }
            : !guidance
              ? { mark: "needs_you" as const, detail: "Guidance is blank. Add what the reply should follow. A blank box is not a completed check." }
              : {
                  mark: "done" as const,
                  detail: args.draft.fulfillment === "none"
                    ? "Audience, offer, and guidance are filled in. This playbook will not send a resource."
                    : needsVideo
                      ? "Audience, offer, resource, video, and guidance are filled in on this screen."
                      : "Audience, offer, resource, and guidance are filled in on this screen. No video is selected.",
                };

  const mailHeld = !args.gates || !fulfillmentSwitchOpen(args.gates.automation) || args.gates.sending !== "on";
  const activate = !campaign
    ? { mark: "needs_you" as const, detail: "Choose a campaign before turning on post-reply automation." }
    : args.gates == null
      ? { mark: "unverified" as const, detail: "Account-wide switches could not be read. Do not treat this campaign as ready to send." }
      : campaign.automation === "active" && mailHeld
        ? { mark: "held" as const, detail: "Post-reply automation is on for this campaign. Mail stays held because account-wide fulfillment or automated replies are off. This page does not turn those switches on." }
        : campaign.automation === "active"
          ? { mark: "done" as const, detail: "Post-reply automation is on for this campaign. Mail from before the activation time stays held until that one action is released." }
          : {
              mark: "needs_you" as const,
              detail: mailHeld
                ? "Activate post-reply automation when the saved playbook looks right. Mail will stay held because account-wide fulfillment or automated replies are off. Earlier replies and scheduled work stay held."
                : "Activate post-reply automation when the saved playbook looks right. Earlier replies and scheduled work stay held.",
            };

  const steps: LaunchStep[] = [
    { step: 1, title: "Find the campaign", ...find },
    { step: 2, title: "Choose or copy a playbook", ...playbook },
    { step: 3, title: "Confirm audience, offer, resource, and guidance", ...confirm },
    {
      step: 4,
      title: "Instantly sequence after a reply",
      mark: "unverified",
      detail: "Not verified. This page cannot see whether Instantly stops its cold sequence after a reply.",
    },
    { step: 5, title: "Turn on post-reply automation", ...activate },
  ];
  const actionable = steps.find((step) => step.mark === "needs_you" || step.mark === "held");
  const unverified = steps.find((step) => step.mark === "unverified");
  return {
    steps,
    next: actionable?.detail ?? unverified?.detail ?? "The checked items are filled in. The sequence-stop item stays unverified.",
  };
}
