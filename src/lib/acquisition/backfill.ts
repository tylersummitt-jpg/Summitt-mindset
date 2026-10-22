import {
  backfillMayApply,
  normalizeAcquisitionEmail,
  parseAcquisitionAsset,
  type AcquisitionAsset,
  type AcquisitionLifecycle,
} from "@/lib/acquisition/model";
import { instantlyInterestLabel, instantlyLeadStatusLabel } from "@/lib/acquisition/instantly";

export type InstantlyLeadSnapshot = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  campaignId: string | null;
  status: number | null;
  interest: number | null;
  sport: string | null;
  geography: string | null;
  asset: AcquisitionAsset | null;
};

export type BackfillProposal = {
  email: string;
  lifecycle: AcquisitionLifecycle;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  sport: string | null;
  geography: string | null;
  asset: AcquisitionAsset | null;
  campaignId: string | null;
  providerEventId: string;
  interest: string | null;
  leadStatus: string | null;
};

export type BackfillPlan = {
  readable: boolean;
  proposals: BackfillProposal[];
  skippedNoEmail: number;
  skippedUnrecognized: number;
  wouldCreate: number;
  wouldApply: number;
  wouldSkipStronger: number;
  wouldSkipSame: number;
  interested: number;
  note: string;
};

function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function parseInstantlyLead(row: unknown): InstantlyLeadSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = text(record.id, 80);
  if (!id) return null;
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, unknown>
    : {};
  return {
    id,
    email: text(record.email, 254),
    firstName: text(record.first_name, 80) ?? text(payload.firstName, 80),
    lastName: text(record.last_name, 80) ?? text(payload.lastName, 80),
    jobTitle: text(record.job_title, 80) ?? text(payload.jobTitle, 80),
    campaignId: text(record.campaign, 80),
    status: typeof record.status === "number" ? record.status : null,
    interest: typeof record.lt_interest_status === "number" ? record.lt_interest_status : null,
    sport: text(payload.sport, 80),
    geography: text(payload.state, 80) ?? text(payload.geography, 80),
    asset: parseAcquisitionAsset(payload.asset),
  };
}

export function proposalFromLead(lead: InstantlyLeadSnapshot): BackfillProposal | null {
  const email = normalizeAcquisitionEmail(lead.email);
  if (!email) return null;
  const interest = instantlyInterestLabel(lead.interest);
  const leadStatus = instantlyLeadStatusLabel(lead.status);
  if (!interest && !leadStatus) return null;
  let lifecycle: AcquisitionLifecycle | null = null;
  if (leadStatus === "bounced") lifecycle = "suppressed";
  else if (leadStatus === "unsubscribed") lifecycle = "unsubscribed";
  else if (interest === "interested") lifecycle = "asset_requested";
  else if (interest === "not_interested") lifecycle = "not_interested";
  else if (leadStatus === "completed") lifecycle = "cold_no_response";
  else if (leadStatus === "active" || leadStatus === "paused") lifecycle = "cold_active";
  if (!lifecycle) return null;
  return {
    email,
    lifecycle,
    firstName: lead.firstName,
    lastName: lead.lastName,
    role: lead.jobTitle,
    sport: lead.sport,
    geography: lead.geography,
    asset: lead.asset,
    campaignId: lead.campaignId,
    providerEventId: `lead:${lead.id}:${lead.status ?? "none"}:${lead.interest ?? "none"}`.slice(0, 180),
    interest,
    leadStatus,
  };
}

function backfillRank(state: AcquisitionLifecycle): number {
  if (state === "suppressed") return 50;
  if (state === "unsubscribed") return 40;
  if (state === "not_interested") return 30;
  if (state === "asset_requested") return 20;
  if (state === "cold_no_response") return 10;
  return 0;
}

export function planInstantlyBackfill(args: {
  leads: readonly unknown[];
  currentByEmail: ReadonlyMap<string, AcquisitionLifecycle>;
}): BackfillPlan {
  const proposals: BackfillProposal[] = [];
  const chosen = new Map<string, BackfillProposal>();
  let skippedNoEmail = 0;
  let skippedUnrecognized = 0;
  let wouldCreate = 0;
  let wouldApply = 0;
  let wouldSkipStronger = 0;
  let wouldSkipSame = 0;
  let interested = 0;
  for (const row of args.leads) {
    const lead = parseInstantlyLead(row);
    if (!lead) {
      skippedUnrecognized += 1;
      continue;
    }
    const proposal = proposalFromLead(lead);
    if (!proposal) {
      if (!normalizeAcquisitionEmail(lead.email)) skippedNoEmail += 1;
      else skippedUnrecognized += 1;
      continue;
    }
    const previous = chosen.get(proposal.email);
    if (!previous || backfillRank(proposal.lifecycle) > backfillRank(previous.lifecycle)) {
      chosen.set(proposal.email, proposal);
    }
  }
  for (const proposal of chosen.values()) {
    if (proposal.lifecycle === "asset_requested") interested += 1;
    const decision = backfillMayApply(args.currentByEmail.get(proposal.email) ?? null, proposal.lifecycle);
    if (decision === "create") wouldCreate += 1;
    else if (decision === "apply") wouldApply += 1;
    else if (decision === "skip_same") wouldSkipSame += 1;
    else wouldSkipStronger += 1;
    if (decision === "create" || decision === "apply") proposals.push(proposal);
  }
  return {
    readable: true,
    proposals,
    skippedNoEmail,
    skippedUnrecognized,
    wouldCreate,
    wouldApply,
    wouldSkipStronger,
    wouldSkipSame,
    interested,
    note: "Dry run. No email is sent. Stronger acquisition states are left in place. Missing Instantly history is not invented.",
  };
}
