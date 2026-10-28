/**
 * Per-campaign permission for post-reply automation.
 * A saved playbook does not grant this. A listed campaign stays governed
 * while inactive, paused, or finished so legacy interest fulfillment does not start again.
 * Only state "active" opens the timestamp gate. lastActivatedAt is a record, not a gate.
 */

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const CAMPAIGN_ACTIVATION_STATES = ["inactive", "active", "paused", "finished"] as const;
export type CampaignActivationState = (typeof CAMPAIGN_ACTIVATION_STATES)[number];

export type CampaignActivation = {
  id: string;
  /**
   * Live gate. Set only while state is active.
   * Null keeps the campaign governed and stops future automated sends.
   */
  activatedAt: string | null;
  /** Absent on older in-memory rows. A present non-active state closes the gate. */
  state?: CampaignActivationState;
  /** Most recent open window. Never authorizes a send by itself. */
  lastActivatedAt?: string | null;
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

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function rowFromLegacy(item: unknown): CampaignActivation | null {
  if (typeof item === "string") {
    const id = item.trim();
    if (!CAMPAIGN_ID.test(id)) return null;
    return { id, state: "inactive", activatedAt: null, lastActivatedAt: null };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!CAMPAIGN_ID.test(id)) return null;
  const activatedAt = timestamp(record.activatedAt);
  if (activatedAt) return { id, state: "active", activatedAt, lastActivatedAt: activatedAt };
  return { id, state: "paused", activatedAt: null, lastActivatedAt: null };
}

export function parseCampaignActivations(value: unknown): CampaignActivation[] {
  if (!Array.isArray(value)) return [];
  const rows: CampaignActivation[] = [];
  for (const item of value) {
    const row = rowFromLegacy(item);
    if (!row || rows.some((existing) => existing.id === row.id)) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * Maps the old JSON registry onto one row per campaign.
 * A bare id stays inactive. A timestamp stays the live gate.
 * A null object is paused unless that campaign's latest playbook is retired.
 */
export function activationsFromLegacyList(
  value: unknown,
  retiredCampaignIds: ReadonlySet<string> = new Set(),
): CampaignActivation[] {
  return parseCampaignActivations(value).map((row) => {
    if (row.state !== "paused" || !retiredCampaignIds.has(row.id)) return row;
    return { ...row, state: "finished" };
  });
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
  const previous = index === -1 ? undefined : activations[index];
  const state: CampaignActivationState = args.action === "activate" ? "active" : args.action === "finish" ? "finished" : "paused";
  const lastActivatedAt = activatedAt ?? previous?.activatedAt ?? previous?.lastActivatedAt ?? null;
  const next: CampaignActivation = { id, state, activatedAt, lastActivatedAt };
  if (index === -1) activations.push(next);
  else activations[index] = next;
  return { ok: true, activations, activatedAt };
}

function activationFor(
  activations: readonly (string | CampaignActivation)[],
  campaignId: string | null,
): CampaignActivation | null {
  if (!campaignId) return null;
  for (const item of activations) {
    if (typeof item === "string") {
      if (item.trim() === campaignId) return { id: campaignId, state: "inactive", activatedAt: null, lastActivatedAt: null };
      continue;
    }
    if (item.id === campaignId) return item;
  }
  return null;
}

/** The only timestamp that can authorize work. History and non-active states stay closed. */
export function activationGate(row: CampaignActivation | null): string | null {
  if (!row) return null;
  if (row.state != null && row.state !== "active") return null;
  return row.activatedAt ?? null;
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
  const gate = activationGate(activationFor(activations, campaignId));
  return Boolean(gate && Number.isFinite(Date.parse(gate)));
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
  return atOrAfterActivation(args.receivedAt, activationGate(activationFor(args.activations, args.campaignId)));
}

export function fulfillmentEligible(args: {
  activations: readonly (string | CampaignActivation)[];
  campaignId: string | null;
  scheduledAt: string | null;
}): boolean {
  return atOrAfterActivation(args.scheduledAt, activationGate(activationFor(args.activations, args.campaignId)));
}
