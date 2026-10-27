/**
 * Per-campaign permission for post-reply automation.
 * A saved playbook does not grant this. A listed campaign stays governed
 * while paused so legacy interest fulfillment does not start again.
 */

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type CampaignActivation = {
  id: string;
  /** Null keeps the campaign governed and stops future automated sends. */
  activatedAt: string | null;
};

export type CampaignAutomationAction = "activate" | "pause" | "finish";

export type PendingFulfillmentView = {
  id: string;
  campaignId: string | null;
  actionType: string;
  status: "scheduled" | "claimed";
  scheduledAt: string | null;
  willSend: boolean;
};

export function campaignListReadable(value: unknown): boolean {
  return Array.isArray(value);
}

export function parseCampaignActivations(value: unknown): CampaignActivation[] {
  if (!Array.isArray(value)) return [];
  const rows: CampaignActivation[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const id = item.trim();
      if (!CAMPAIGN_ID.test(id) || rows.some((row) => row.id === id)) continue;
      rows.push({ id, activatedAt: null });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!CAMPAIGN_ID.test(id) || rows.some((row) => row.id === id)) continue;
    const raw = record.activatedAt;
    const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    rows.push({ id, activatedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null });
  }
  return rows;
}

export function applyCampaignActivation(args: {
  current: readonly CampaignActivation[];
  campaignId: string;
  action: CampaignAutomationAction;
  now: Date;
}): { ok: true; activations: CampaignActivation[]; activatedAt: string | null } | { ok: false; error: string } {
  const id = args.campaignId.trim();
  if (!CAMPAIGN_ID.test(id)) return { ok: false, error: "Enter the Instantly campaign ID." };
  const activations = args.current.map((row) => ({ ...row }));
  const activatedAt = args.action === "activate" && Number.isFinite(args.now.getTime()) ? args.now.toISOString() : null;
  if (args.action === "activate" && !activatedAt) return { ok: false, error: "The activation time could not be recorded." };
  const index = activations.findIndex((row) => row.id === id);
  if (index === -1) activations.push({ id, activatedAt });
  else activations[index] = { id, activatedAt };
  return { ok: true, activations, activatedAt };
}

function activationFor(
  activations: readonly (string | CampaignActivation)[],
  campaignId: string | null,
): CampaignActivation | null {
  if (!campaignId) return null;
  for (const item of activations) {
    if (typeof item === "string") {
      if (item.trim() === campaignId) return { id: campaignId, activatedAt: null };
      continue;
    }
    if (item.id === campaignId) return item;
  }
  return null;
}

export function campaignIsGoverned(
  activations: readonly (string | CampaignActivation)[],
  campaignId: string | null,
): boolean {
  return activationFor(activations, campaignId) !== null;
}

export function campaignAutomationOpen(
  activations: readonly (string | CampaignActivation)[],
  campaignId: string | null,
): boolean {
  const row = activationFor(activations, campaignId);
  return Boolean(row?.activatedAt && Number.isFinite(Date.parse(row.activatedAt)));
}

function atOrAfterActivation(when: string | null, activatedAt: string | null): boolean {
  if (!when || !activatedAt) return false;
  const scheduled = Date.parse(when);
  const activated = Date.parse(activatedAt);
  return Number.isFinite(scheduled) && Number.isFinite(activated) && scheduled >= activated;
}

export function replyEligible(args: {
  activations: readonly (string | CampaignActivation)[];
  campaignId: string | null;
  receivedAt: string | null;
}): boolean {
  const row = activationFor(args.activations, args.campaignId);
  return atOrAfterActivation(args.receivedAt, row?.activatedAt ?? null);
}

export function fulfillmentEligible(args: {
  activations: readonly (string | CampaignActivation)[];
  campaignId: string | null;
  scheduledAt: string | null;
}): boolean {
  const row = activationFor(args.activations, args.campaignId);
  return atOrAfterActivation(args.scheduledAt, row?.activatedAt ?? null);
}
