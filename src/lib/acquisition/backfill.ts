import {
  backfillMayApply,
  normalizeAcquisitionEmail,
  parseAcquisitionAsset,
  type AcquisitionAsset,
  type AcquisitionLifecycle,
} from "@/lib/acquisition/model";
import { instantlyInterestLabel, instantlyLeadStatusLabel } from "@/lib/acquisition/instantly";

/** Official lead-list maximum. https://developer.instantly.ai/api-reference/lead/list-leads */
export const INSTANTLY_PAGE_SIZE = 100;
/**
 * Safety stop so a stuck cursor cannot loop. 500 pages is 50,000 rows.
 * Hitting it with a cursor still present is reported as incomplete.
 */
export const INSTANTLY_PAGE_CAP = 500;
const REPORT_ROW_CAP = 100;
const CREATE_DETAIL_CAP = 25;

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
  sent: boolean;
  replied: boolean;
  replyCountKnown: boolean;
  noReplyProven: boolean;
  interestLabel: string | null;
  leadStatus: string | null;
  evidenceAt: string | null;
  evidenceMs: number | null;
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
  historicalFulfillment: "unknown" | null;
  schedulesWarmEmail: false;
};

export type DuplicateDiscard = {
  leadId: string;
  campaignId: string | null;
  outcome: string;
  evidenceAt: string | null;
};

export type ExistingBackfillPerson = {
  lifecycle: AcquisitionLifecycle;
  requestedAsset: AcquisitionAsset | null;
  sourceCampaign: string | null;
};

export type BackfillMutationDetail = {
  email: string;
  existingLifecycle: AcquisitionLifecycle | null;
  proposedLifecycle: AcquisitionLifecycle;
  existingRequestedAsset: AcquisitionAsset | null;
  existingRequestedAssetLoaded: boolean;
  proposedRequestedAsset: AcquisitionAsset | null;
  requestedAssetValuesDiffer: boolean;
  requestedAssetWouldChange: boolean;
  requestedAssetNote: string;
  existingSourceCampaign: string | null;
  existingSourceCampaignLoaded: boolean;
  proposedCampaignId: string | null;
  proposedCampaignName: string | null;
  sourceCampaignValuesDiffer: boolean;
  sourceCampaignWouldChange: boolean;
  sourceCampaignNote: string;
  reason: string;
  reasonCode: string;
  lifecycleChanges: boolean;
  createsEvent: true;
  createsAction: false;
  schedulesWarmEmail: false;
};

export type BackfillPlan = {
  readable: boolean;
  complete: boolean;
  schedulesWarmEmail: false;
  proposals: BackfillProposal[];
  fetched: number;
  pages: number;
  paginationComplete: boolean;
  apiError: string | null;
  campaignNamesLoaded: boolean;
  campaignError: string | null;
  uniqueEmails: number;
  skippedNoEmail: number;
  uncontacted: number;
  ambiguous: number;
  wouldCreate: number;
  wouldApply: number;
  wouldSkipStronger: number;
  wouldSkipSame: number;
  wouldApplyDetails: BackfillMutationDetail[];
  wouldCreateDetails: BackfillMutationDetail[];
  wouldCreateDetailsTruncated: boolean;
  wouldCreateDetailsLimit: number;
  interested: number;
  replies: number;
  notInterested: number;
  unsubscribed: number;
  suppressed: number;
  coldActive: number;
  coldNoResponse: number;
  sent: number;
  neverSent: number;
  multiCampaignEmails: number;
  duplicateEmails: number;
  duplicateConflicts: number;
  repeatedLeadIds: number;
  historicalFulfillmentUnknown: number;
  assetSentProven: 0;
  campaigns: Array<{
    campaignId: string;
    campaignName: string | null;
    records: number;
    uniqueEmails: number;
    sent: number;
    neverSent: number;
    interested: number;
    uncontacted: number;
    ambiguous: number;
    lifecycles: Record<string, number>;
  }>;
  regions: Record<string, { campaigns: number; records: number; interested: number; uniqueEmails: number }> | null;
  patCampaigns: Array<{ campaignId: string; campaignName: string | null; records: number; interested: number; uncontacted: number }> | null;
  tennesseeInterested: {
    reliable: boolean;
    total: number | null;
    listed: number;
    listTruncated: boolean;
    rows: Array<{ email: string; campaignId: string | null; campaignName: string | null; sent: boolean; fulfillment: "unknown" }>;
  };
  duplicates: Array<{
    email: string;
    chosenLifecycle: string | null;
    conflict: boolean;
    discarded: DuplicateDiscard[];
  }>;
  duplicatesTruncated: boolean;
  unclassifiable: { total: number; reasons: Record<string, number> };
  note: string;
};

export type CampaignName = { id: string; name: string | null; status: number | null };

export type InstantlyBackfillSource = {
  leads: unknown[];
  campaigns: CampaignName[];
  fetched: number;
  pages: number;
  paginationComplete: boolean;
  apiError: string | null;
  campaignNamesLoaded: boolean;
  campaignError: string | null;
};

export function continueAfterRangePage(args: {
  pageNumber: number;
  pageCap: number;
  rowCount: number;
  pageSize: number;
}): { continue: boolean; complete: boolean; error: string | null } {
  if (args.rowCount < args.pageSize) return { continue: false, complete: true, error: null };
  if (args.pageNumber >= args.pageCap) return { continue: false, complete: false, error: "people_page_cap" };
  return { continue: true, complete: false, error: null };
}

export function backfillExecuteAllowed(plan: Pick<BackfillPlan, "complete" | "readable" | "schedulesWarmEmail">): boolean {
  return plan.readable && plan.complete && plan.schedulesWarmEmail === false;
}

export type InstantlyPage = {
  ok: boolean;
  status: number;
  items: unknown[];
  nextCursor: string | null;
};

function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function latestIso(values: unknown[]): { at: string | null; ms: number | null } {
  let best: number | null = null;
  for (const value of values) {
    const parsed = iso(value);
    if (!parsed) continue;
    const ms = Date.parse(parsed);
    if (best === null || ms > best) best = ms;
  }
  return best === null ? { at: null, ms: null } : { at: new Date(best).toISOString(), ms: best };
}

function nestedStepTime(summary: unknown): string | null {
  if (!summary || typeof summary !== "object") return null;
  const last = (summary as { lastStep?: unknown }).lastStep;
  if (!last || typeof last !== "object") return null;
  return iso((last as { timestamp_executed?: unknown }).timestamp_executed);
}

export function parseInstantlyListPayload(body: unknown): { ok: true; items: unknown[]; nextCursor: string | null } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as { items?: unknown; next_starting_after?: unknown };
  if (!Array.isArray(record.items)) return { ok: false };
  const next = typeof record.next_starting_after === "string" && record.next_starting_after.trim()
    ? record.next_starting_after.trim()
    : null;
  return { ok: true, items: record.items, nextCursor: next };
}

export function continueAfterInstantlyPage(args: {
  pageNumber: number;
  pageCap: number;
  itemCount: number;
  nextCursor: string | null;
  requestCursor: string | null;
}): { continue: boolean; complete: boolean; error: string | null } {
  const next = args.nextCursor?.trim() || null;
  if (args.itemCount === 0 && next) {
    return { continue: false, complete: false, error: "empty_page_with_cursor" };
  }
  if (args.itemCount === 0 || !next) return { continue: false, complete: true, error: null };
  if (args.requestCursor && next === args.requestCursor) {
    return { continue: false, complete: false, error: "cursor_repeated" };
  }
  if (args.pageNumber >= args.pageCap) return { continue: false, complete: false, error: "page_cap" };
  return { continue: true, complete: false, error: null };
}

export function consumeInstantlyPages(pages: readonly InstantlyPage[], pageCap = INSTANTLY_PAGE_CAP): {
  items: unknown[];
  pages: number;
  complete: boolean;
  error: string | null;
} {
  const items: unknown[] = [];
  let requestCursor: string | null = null;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!page.ok) {
      return { items, pages: index, complete: false, error: `http_${page.status}` };
    }
    items.push(...page.items);
    const decision = continueAfterInstantlyPage({
      pageNumber: index + 1,
      pageCap,
      itemCount: page.items.length,
      nextCursor: page.nextCursor,
      requestCursor,
    });
    if (!decision.continue) {
      return { items, pages: index + 1, complete: decision.complete, error: decision.error };
    }
    requestCursor = page.nextCursor?.trim() || null;
  }
  return { items, pages: pages.length, complete: false, error: pages.length === 0 ? "no_pages" : "stopped_early" };
}

export function parseInstantlyLead(row: unknown): InstantlyLeadSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = text(record.id, 80);
  if (!id) return null;
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, unknown>
    : {};
  const contact = latestIso([
    record.timestamp_last_contact,
    record.last_step_timestamp_executed,
    nestedStepTime(record.status_summary),
  ]);
  const opens = typeof record.email_open_count === "number" && record.email_open_count > 0;
  const clicks = typeof record.email_click_count === "number" && record.email_click_count > 0;
  const replyCount = typeof record.email_reply_count === "number" ? record.email_reply_count : null;
  const replyAt = iso(record.timestamp_last_reply);
  const repliedStep = typeof record.email_replied_step === "number";
  const replied = (replyCount !== null && replyCount > 0) || Boolean(replyAt) || repliedStep;
  const evidence = latestIso([
    record.timestamp_last_interest_change,
    record.timestamp_last_reply,
    record.timestamp_last_contact,
    record.timestamp_updated,
    record.last_step_timestamp_executed,
    record.timestamp_created,
  ]);
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
    sent: Boolean(contact.at) || opens || clicks,
    replied,
    replyCountKnown: replyCount !== null,
    noReplyProven: replyCount === 0 && !replyAt && !repliedStep,
    interestLabel: instantlyInterestLabel(record.lt_interest_status),
    leadStatus: instantlyLeadStatusLabel(record.status),
    evidenceAt: evidence.at,
    evidenceMs: evidence.ms,
  };
}

type Classified = {
  lead: InstantlyLeadSnapshot;
  email: string | null;
  outcome: "lifecycle" | "uncontacted" | "ambiguous" | "no_email";
  lifecycle: AcquisitionLifecycle | null;
  reason: string;
};

function classify(lead: InstantlyLeadSnapshot): Classified {
  const email = normalizeAcquisitionEmail(lead.email);
  if (!email) return { lead, email: null, outcome: "no_email", lifecycle: null, reason: "no_email" };
  const interest = lead.interestLabel;
  const status = lead.leadStatus;
  if (status === "bounced") return { lead, email, outcome: "lifecycle", lifecycle: "suppressed", reason: "bounced" };
  if (status === "unsubscribed") return { lead, email, outcome: "lifecycle", lifecycle: "unsubscribed", reason: "unsubscribed" };
  if (interest === "interested") return { lead, email, outcome: "lifecycle", lifecycle: "asset_requested", reason: "interested" };
  if (interest === "not_interested") return { lead, email, outcome: "lifecycle", lifecycle: "not_interested", reason: "not_interested" };
  if (interest === "wrong_person") return { lead, email, outcome: "lifecycle", lifecycle: "reply_needs_review", reason: "wrong_person" };
  if (lead.replied) return { lead, email, outcome: "lifecycle", lifecycle: "reply_needs_review", reason: "reply" };
  if (interest && interest !== "interested" && interest !== "not_interested") {
    return { lead, email, outcome: "ambiguous", lifecycle: null, reason: interest };
  }
  if (status === "completed" && lead.sent && lead.noReplyProven) {
    return { lead, email, outcome: "lifecycle", lifecycle: "cold_no_response", reason: "completed_no_reply" };
  }
  if (status === "completed") {
    return {
      lead,
      email,
      outcome: "ambiguous",
      lifecycle: null,
      reason: lead.sent ? "completed_reply_unproven" : "completed_without_send",
    };
  }
  if ((status === "active" || status === "paused") && lead.sent) {
    if (!lead.replyCountKnown) {
      return { lead, email, outcome: "ambiguous", lifecycle: null, reason: "reply_unproven" };
    }
    return { lead, email, outcome: "lifecycle", lifecycle: "cold_active", reason: "sent" };
  }
  if (!lead.sent) return { lead, email, outcome: "uncontacted", lifecycle: null, reason: status === "skipped" ? "skipped" : "no_send_evidence" };
  return { lead, email, outcome: "ambiguous", lifecycle: null, reason: status ?? "unclassified" };
}

function rank(state: AcquisitionLifecycle): number {
  if (state === "suppressed") return 60;
  if (state === "unsubscribed") return 50;
  if (state === "not_interested") return 40;
  if (state === "asset_requested") return 30;
  if (state === "reply_needs_review") return 20;
  if (state === "cold_no_response") return 10;
  return 0;
}

function newer(candidate: Classified, current: Classified): boolean {
  const left = candidate.lead.evidenceMs;
  const right = current.lead.evidenceMs;
  if (left !== null && right !== null && left !== right) return left > right;
  if (left !== null && right === null) return true;
  if (left === null && right !== null) return false;
  return candidate.lead.id > current.lead.id;
}

function prefers(candidate: Classified, current: Classified): boolean {
  if (!candidate.lifecycle && current.lifecycle) return false;
  if (candidate.lifecycle && !current.lifecycle) return true;
  if (candidate.lifecycle && current.lifecycle && rank(candidate.lifecycle) !== rank(current.lifecycle)) {
    return rank(candidate.lifecycle) > rank(current.lifecycle);
  }
  return newer(candidate, current);
}

export function campaignRegion(name: string | null): "tennessee" | "mississippi" | "south_carolina" | "wisconsin" | "minnesota" | "wyoming" | null {
  if (!name) return null;
  if (/\btennessee\b|\bTN\b/i.test(name)) return "tennessee";
  if (/\bmississippi\b/i.test(name)) return "mississippi";
  if (/\bsouth carolina\b/i.test(name)) return "south_carolina";
  if (/\bwisconsin\b/i.test(name)) return "wisconsin";
  if (/\bminnesota\b/i.test(name)) return "minnesota";
  if (/\bwyoming\b/i.test(name)) return "wyoming";
  return null;
}

export function isPatCampaignName(name: string | null): boolean {
  return Boolean(name && /\bpat\b/i.test(name));
}

function proposalFrom(row: Classified): BackfillProposal | null {
  if (!row.email || !row.lifecycle) return null;
  return {
    email: row.email,
    lifecycle: row.lifecycle,
    firstName: row.lead.firstName,
    lastName: row.lead.lastName,
    role: row.lead.jobTitle,
    sport: row.lead.sport,
    geography: row.lead.geography,
    asset: row.lead.asset,
    campaignId: row.lead.campaignId,
    providerEventId: `lead:${row.lead.id}:${row.lead.status ?? "none"}:${row.lead.interest ?? "none"}:${row.lead.sent ? 1 : 0}:${row.lead.replied ? 1 : 0}`.slice(0, 180),
    interest: row.lead.interestLabel,
    leadStatus: row.lead.leadStatus,
    historicalFulfillment: row.lifecycle === "asset_requested" ? "unknown" : null,
    schedulesWarmEmail: false,
  };
}

function readExisting(value: AcquisitionLifecycle | ExistingBackfillPerson | undefined): {
  lifecycle: AcquisitionLifecycle | null;
  requestedAsset: AcquisitionAsset | null;
  sourceCampaign: string | null;
  loaded: boolean;
} {
  if (!value) return { lifecycle: null, requestedAsset: null, sourceCampaign: null, loaded: false };
  if (typeof value === "string") return { lifecycle: value, requestedAsset: null, sourceCampaign: null, loaded: false };
  return {
    lifecycle: value.lifecycle,
    requestedAsset: value.requestedAsset,
    sourceCampaign: value.sourceCampaign,
    loaded: true,
  };
}

function mutationReason(reason: string, from: AcquisitionLifecycle | null, to: AcquisitionLifecycle): string {
  const current = from ?? "no canonical person";
  if (reason === "interested") return `Instantly marked this lead interested. ${current} would become ${to}. A past PDF send is still unknown.`;
  if (reason === "reply") return `Instantly recorded a reply without an interested or not-interested label. ${current} would become ${to}.`;
  if (reason === "wrong_person") return `Instantly marked this lead the wrong person. ${current} would become ${to}.`;
  if (reason === "completed_no_reply") return `Instantly shows a completed sequence, at least one send, and a reply count of zero. ${current} would become ${to}.`;
  if (reason === "not_interested") return `Instantly marked this lead not interested. ${current} would become ${to}.`;
  if (reason === "bounced") return `Instantly marked this lead bounced. ${current} would become ${to}.`;
  if (reason === "unsubscribed") return `Instantly marked this lead unsubscribed. ${current} would become ${to}.`;
  if (reason === "sent") return `Instantly shows a send on an active or paused lead and no reply. ${current} would become ${to}.`;
  return `Instantly evidence "${reason}" would move ${current} to ${to}.`;
}

function assetDiagnostic(existing: AcquisitionAsset | null, proposed: AcquisitionAsset | null, loaded: boolean): {
  valuesDiffer: boolean;
  wouldChange: boolean;
  note: string;
} {
  if (!loaded) {
    return {
      valuesDiffer: false,
      wouldChange: false,
      note: "Existing requested_asset was not loaded, so this row does not claim an asset change.",
    };
  }
  const valuesDiffer = existing !== proposed;
  if (!proposed) {
    return {
      valuesDiffer,
      wouldChange: false,
      note: existing
        ? "The Instantly lead has no definite_dozen or playbook value. Execute does not clear the stored requested_asset."
        : "Neither side has an asset. Execute does not write requested_asset.",
    };
  }
  if (existing === proposed) {
    return {
      valuesDiffer: false,
      wouldChange: false,
      note: "Requested asset already matches. The lifecycle update may repeat that same value.",
    };
  }
  return {
    valuesDiffer: true,
    wouldChange: true,
    note: existing
      ? "Execute would replace requested_asset because the lifecycle update writes the asset carried on the Instantly lead."
      : "Execute would set requested_asset because the Instantly lead carries one and the person has none.",
  };
}

function campaignDiagnostic(existing: string | null, proposed: string | null, loaded: boolean): {
  valuesDiffer: boolean;
  wouldChange: boolean;
  note: string;
} {
  if (!loaded) {
    return {
      valuesDiffer: false,
      wouldChange: false,
      note: "Existing source_campaign was not loaded, so this row does not claim a campaign change.",
    };
  }
  const valuesDiffer = existing !== proposed;
  if (!existing && proposed) {
    return {
      valuesDiffer: true,
      wouldChange: true,
      note: "Execute would fill the empty source_campaign. It does not replace a campaign already stored.",
    };
  }
  if (existing && proposed && existing !== proposed) {
    return {
      valuesDiffer: true,
      wouldChange: false,
      note: "The Instantly campaign differs from source_campaign. Execute keeps the campaign already stored.",
    };
  }
  return {
    valuesDiffer: false,
    wouldChange: false,
    note: existing
      ? "Source campaign already matches. Execute does not rewrite it."
      : "There is no campaign id to write.",
  };
}

export function planInstantlyBackfill(args: {
  leads: readonly unknown[];
  currentByEmail: ReadonlyMap<string, AcquisitionLifecycle | ExistingBackfillPerson>;
  campaigns?: readonly CampaignName[];
  fetched?: number;
  pages?: number;
  paginationComplete?: boolean;
  apiError?: string | null;
  campaignNamesLoaded?: boolean;
  campaignError?: string | null;
}): BackfillPlan {
  const names = new Map<string, CampaignName>();
  for (const campaign of args.campaigns ?? []) names.set(campaign.id, campaign);
  const grouped = new Map<string, Classified[]>();
  const seenLeadIds = new Map<string, InstantlyLeadSnapshot>();
  let skippedNoEmail = 0;
  let unparsed = 0;
  let repeatedLeadIds = 0;
  let fetchedRows = 0;
  for (const row of args.leads) {
    fetchedRows += 1;
    const lead = parseInstantlyLead(row);
    if (!lead) {
      unparsed += 1;
      continue;
    }
    const prior = seenLeadIds.get(lead.id);
    if (!prior) {
      seenLeadIds.set(lead.id, lead);
      continue;
    }
    repeatedLeadIds += 1;
    const priorMs = prior.evidenceMs;
    const nextMs = lead.evidenceMs;
    if (nextMs !== null && (priorMs === null || nextMs >= priorMs)) seenLeadIds.set(lead.id, lead);
  }
  for (const lead of seenLeadIds.values()) {
    const classified = classify(lead);
    if (!classified.email) {
      skippedNoEmail += 1;
      continue;
    }
    const list = grouped.get(classified.email) ?? [];
    list.push(classified);
    grouped.set(classified.email, list);
  }

  const proposals: BackfillProposal[] = [];
  const duplicates: BackfillPlan["duplicates"] = [];
  const campaignStats = new Map<string, BackfillPlan["campaigns"][number]>();
  const regions = {
    tennessee: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
    mississippi: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
    south_carolina: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
    wisconsin: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
    minnesota: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
    wyoming: { campaigns: 0, records: 0, interested: 0, uniqueEmails: 0 },
  };
  const regionEmails = new Map<string, Set<string>>();
  const patCampaigns: Array<{ campaignId: string; campaignName: string | null; records: number; interested: number; uncontacted: number }> = [];
  const tennesseeRows: BackfillPlan["tennesseeInterested"]["rows"] = [];
  const reasons: Record<string, number> = {};
  let uncontacted = 0;
  let ambiguous = 0;
  let sent = 0;
  let neverSent = 0;
  let interested = 0;
  let replies = 0;
  let notInterested = 0;
  let unsubscribed = 0;
  let suppressed = 0;
  let coldActive = 0;
  let coldNoResponse = 0;
  let wouldCreate = 0;
  let wouldApply = 0;
  let wouldSkipStronger = 0;
  let wouldSkipSame = 0;
  const wouldApplyDetails: BackfillMutationDetail[] = [];
  const wouldCreateDetails: BackfillMutationDetail[] = [];
  let multiCampaign = 0;
  let duplicateEmails = 0;
  let duplicateConflicts = 0;

  const bumpCampaign = (row: Classified) => {
    const id = row.lead.campaignId ?? "none";
    const current = campaignStats.get(id) ?? {
      campaignId: id,
      campaignName: names.get(id)?.name ?? null,
      records: 0,
      uniqueEmails: 0,
      sent: 0,
      neverSent: 0,
      interested: 0,
      uncontacted: 0,
      ambiguous: 0,
      lifecycles: {},
    };
    current.records += 1;
    if (row.lead.sent) current.sent += 1;
    else current.neverSent += 1;
    if (row.reason === "interested") current.interested += 1;
    if (row.outcome === "uncontacted") current.uncontacted += 1;
    if (row.outcome === "ambiguous") current.ambiguous += 1;
    if (row.lifecycle) current.lifecycles[row.lifecycle] = (current.lifecycles[row.lifecycle] ?? 0) + 1;
    campaignStats.set(id, current);
  };

  for (const [email, rows] of grouped) {
    const campaigns = new Set(rows.map((row) => row.lead.campaignId).filter((id): id is string => Boolean(id)));
    if (campaigns.size > 1) multiCampaign += 1;
    let chosen = rows[0];
    for (const row of rows.slice(1)) {
      if (prefers(row, chosen)) chosen = row;
    }
    for (const row of rows) {
      if (row.lead.sent) sent += 1;
      else neverSent += 1;
      bumpCampaign(row);
      const region = campaignRegion(names.get(row.lead.campaignId ?? "")?.name ?? null);
      if (region) {
        regions[region].records += 1;
        if (row.reason === "interested") regions[region].interested += 1;
        const seen = regionEmails.get(region) ?? new Set<string>();
        seen.add(email);
        regionEmails.set(region, seen);
      }
    }
    if (rows.length > 1) {
      duplicateEmails += 1;
      const conflict = rows.some((row) => row.lifecycle !== chosen.lifecycle || row.lead.campaignId !== chosen.lead.campaignId);
      if (conflict) duplicateConflicts += 1;
      if (duplicates.length < REPORT_ROW_CAP) {
        duplicates.push({
          email,
          chosenLifecycle: chosen.lifecycle,
          conflict,
          discarded: rows.filter((row) => row !== chosen).map((row) => ({
            leadId: row.lead.id,
            campaignId: row.lead.campaignId,
            outcome: row.lifecycle ?? row.reason,
            evidenceAt: row.lead.evidenceAt,
          })),
        });
      }
    }
    if (chosen.outcome === "uncontacted") uncontacted += 1;
    else if (chosen.outcome === "ambiguous") {
      ambiguous += 1;
      reasons[chosen.reason] = (reasons[chosen.reason] ?? 0) + 1;
    }
    if (chosen.reason === "interested") {
      interested += 1;
      const campaignName = names.get(chosen.lead.campaignId ?? "")?.name ?? null;
      if (campaignRegion(campaignName) === "tennessee" && tennesseeRows.length < REPORT_ROW_CAP) {
        tennesseeRows.push({
          email,
          campaignId: chosen.lead.campaignId,
          campaignName,
          sent: chosen.lead.sent,
          fulfillment: "unknown",
        });
      }
    }
    if (chosen.reason === "reply" || chosen.reason === "wrong_person") replies += 1;
    if (chosen.lifecycle === "not_interested") notInterested += 1;
    if (chosen.lifecycle === "unsubscribed") unsubscribed += 1;
    if (chosen.lifecycle === "suppressed") suppressed += 1;
    if (chosen.lifecycle === "cold_active") coldActive += 1;
    if (chosen.lifecycle === "cold_no_response") coldNoResponse += 1;
    const proposal = proposalFrom(chosen);
    if (!proposal) continue;
    const existing = readExisting(args.currentByEmail.get(email));
    const decision = backfillMayApply(existing.lifecycle, proposal.lifecycle);
    if (decision === "create") wouldCreate += 1;
    else if (decision === "apply") wouldApply += 1;
    else if (decision === "skip_same") wouldSkipSame += 1;
    else wouldSkipStronger += 1;
    if (decision === "create" || decision === "apply") proposals.push(proposal);
    if (decision === "apply" || (decision === "create" && wouldCreateDetails.length < CREATE_DETAIL_CAP)) {
      const asset = assetDiagnostic(existing.requestedAsset, proposal.asset, existing.loaded);
      const campaign = campaignDiagnostic(existing.sourceCampaign, proposal.campaignId, existing.loaded);
      const detail: BackfillMutationDetail = {
        email,
        existingLifecycle: existing.lifecycle,
        proposedLifecycle: proposal.lifecycle,
        existingRequestedAsset: existing.loaded ? existing.requestedAsset : null,
        existingRequestedAssetLoaded: existing.loaded,
        proposedRequestedAsset: proposal.asset,
        requestedAssetValuesDiffer: asset.valuesDiffer,
        requestedAssetWouldChange: asset.wouldChange,
        requestedAssetNote: asset.note,
        existingSourceCampaign: existing.loaded ? existing.sourceCampaign : null,
        existingSourceCampaignLoaded: existing.loaded,
        proposedCampaignId: proposal.campaignId,
        proposedCampaignName: names.get(proposal.campaignId ?? "")?.name ?? null,
        sourceCampaignValuesDiffer: campaign.valuesDiffer,
        sourceCampaignWouldChange: campaign.wouldChange,
        sourceCampaignNote: campaign.note,
        reason: mutationReason(chosen.reason, existing.lifecycle, proposal.lifecycle),
        reasonCode: chosen.reason,
        lifecycleChanges: existing.lifecycle !== proposal.lifecycle,
        createsEvent: true,
        createsAction: false,
        schedulesWarmEmail: false,
      };
      if (decision === "apply") wouldApplyDetails.push(detail);
      else wouldCreateDetails.push(detail);
    }
  }

  for (const [id, stat] of campaignStats) {
    const emailSet = new Set<string>();
    for (const rows of grouped.values()) {
      if (rows.some((row) => (row.lead.campaignId ?? "none") === id)) {
        const email = rows[0]?.email;
        if (email) emailSet.add(email);
      }
    }
    stat.uniqueEmails = emailSet.size;
    const region = campaignRegion(stat.campaignName);
    if (region) regions[region].campaigns += 1;
    if (isPatCampaignName(stat.campaignName)) {
      patCampaigns.push({
        campaignId: id,
        campaignName: stat.campaignName,
        records: stat.records,
        interested: stat.interested,
        uncontacted: stat.uncontacted,
      });
    }
  }
  for (const region of Object.keys(regions) as Array<keyof typeof regions>) {
    regions[region].uniqueEmails = regionEmails.get(region)?.size ?? 0;
  }

  const paginationComplete = args.paginationComplete ?? true;
  const apiError = args.apiError ?? null;
  const namesLoaded = args.campaignNamesLoaded ?? false;
  const complete = paginationComplete && !apiError && namesLoaded;
  const tennesseeTotal = [...grouped.values()].filter((rows) => {
    const chosen = rows.reduce((best, row) => (prefers(row, best) ? row : best));
    return chosen.reason === "interested" && campaignRegion(names.get(chosen.lead.campaignId ?? "")?.name ?? null) === "tennessee";
  }).length;
  if (unparsed > 0) reasons.unparsed = (reasons.unparsed ?? 0) + unparsed;
  return {
    readable: true,
    complete,
    schedulesWarmEmail: false,
    proposals,
    fetched: args.fetched ?? fetchedRows,
    pages: args.pages ?? (fetchedRows === 0 ? 0 : 1),
    paginationComplete,
    apiError,
    campaignNamesLoaded: namesLoaded,
    campaignError: args.campaignError ?? null,
    uniqueEmails: grouped.size,
    skippedNoEmail,
    uncontacted,
    ambiguous: ambiguous + unparsed,
    wouldCreate,
    wouldApply,
    wouldSkipStronger,
    wouldSkipSame,
    wouldApplyDetails,
    wouldCreateDetails,
    wouldCreateDetailsTruncated: wouldCreate > wouldCreateDetails.length,
    wouldCreateDetailsLimit: CREATE_DETAIL_CAP,
    interested,
    replies,
    notInterested,
    unsubscribed,
    suppressed,
    coldActive,
    coldNoResponse,
    sent,
    neverSent,
    multiCampaignEmails: multiCampaign,
    duplicateEmails,
    duplicateConflicts,
    repeatedLeadIds,
    historicalFulfillmentUnknown: interested,
    assetSentProven: 0,
    campaigns: [...campaignStats.values()].sort((a, b) => a.campaignId.localeCompare(b.campaignId)),
    regions: namesLoaded ? regions : null,
    patCampaigns: namesLoaded ? patCampaigns : null,
    tennesseeInterested: namesLoaded
      ? {
        reliable: true,
        total: tennesseeTotal,
        listed: tennesseeRows.length,
        listTruncated: tennesseeTotal > tennesseeRows.length,
        rows: tennesseeRows,
      }
      : { reliable: false, total: null, listed: 0, listTruncated: false, rows: [] },
    duplicates,
    duplicatesTruncated: duplicateEmails > duplicates.length,
    unclassifiable: { total: ambiguous + unparsed, reasons },
    note: complete
      ? "Dry run is complete. No email is sent and no warm action is scheduled. Interested history does not prove a PDF was sent."
      : "Dry run is incomplete. Do not treat these counts as the whole Instantly workspace. Nothing was written.",
  };
}
