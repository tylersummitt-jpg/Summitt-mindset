import "server-only";

import { parseInstantlyLead } from "@/lib/acquisition/backfill";
import { fetchInstantlyBackfillSource } from "@/lib/acquisition/store";
import { membershipMapOrUnverified } from "@/lib/acquisition/audience-clearance";
import { liveMembershipByEmail } from "@/lib/acquisition/audience-membership.server";
import {
  classifyLetterHistory,
  decideLetterFacts,
  finishLetterClearance,
  LETTER_AUDIENCE_CAP,
  LETTER_FACT_BATCH,
  letterLeadCsv,
  letterMembershipVerdict,
  signLetterBatch,
  signLetterOutcomes,
  verifyLetterPending,
  type LetterFactTicket,
  type LetterLead,
  type LetterLocalFacts,
  type LetterPendingTicket,
  type LetterSkip,
} from "@/lib/acquisition/letter-audience";
import { getClerkUserOrNull, listClerkUsersByEmail } from "@/lib/clerk-rest";
import {
  readHistoricalLetterDecisions,
  type LetterHistoricalAccount,
} from "@/lib/historical-never-subscriber.server";
import { emailBlockedByDomain } from "@/lib/acquisition/instantly-block-import";
import { isAcquisitionLifecycle, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import { currentQuietPlaybook } from "@/lib/acquisition/video-first-leads.server";
import { supabaseServer } from "@/lib/supabase-server";

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CHUNK = 100;
const LEDGER_EVENT = {
  email_sent: "emailed",
  reply_received: "replied",
  interested: "replied",
  bounced: "bounced",
  unsubscribed: "stopped",
  not_interested: "stopped",
  complained: "stopped",
  wrong_person: "stopped",
  campaign_completed: "sequence",
} as const;

export type LetterAudienceResult =
  | { ok: false; error: string }
  | {
      ok: true;
      complete: false;
      manifest: string;
      tickets: LetterPendingTicket[];
      skips: LetterSkip[];
      unique: number;
      pending: number;
      batchSize: number;
      note: string;
    }
  | {
      ok: true;
      complete: false;
      outcomes: LetterFactTicket[];
      note: string;
    }
  | {
      ok: true;
      complete: true;
      unique: number;
      eligible: number;
      excluded: number;
      unverified: number;
      groups: Array<{ campaignId: string; count: number; csv: string }>;
      skips: LetterSkip[];
      note: string;
    };

const NOT_CLEARED = "This is not a cleared audience. Nothing was written.";
const LEDGER_UNREAD_BATCH = "Membership, blocks, or the acquisition ledger could not be read. The roster is not cleared. Nothing was written.";

/**
 * Read-only clearance for a personal letter. No video, no Instantly import,
 * and no journey or fulfillment writes. A finished import file is returned
 * only after every unique coach has a verified result.
 */
export async function checkLetterAudience(args: {
  phase: "history" | "facts" | "finish";
  sourceCampaignIds: readonly string[];
  launchCampaignId: string;
  pairCampaignId?: string | null;
  manifest?: string;
  tickets?: LetterPendingTicket[];
  pending?: LetterLead[];
  historySkips?: LetterSkip[];
  outcomes?: LetterFactTicket[];
}): Promise<LetterAudienceResult> {
  const sourceCampaignIds = [...new Set(args.sourceCampaignIds.map((id) => id.trim()).filter(Boolean))];
  const launchCampaignId = args.launchCampaignId.trim();
  const pairCampaignId = args.pairCampaignId?.trim() || null;
  if (sourceCampaignIds.length === 0 || sourceCampaignIds.length > 20 || sourceCampaignIds.some((id) => !CAMPAIGN_ID.test(id)) || !CAMPAIGN_ID.test(launchCampaignId)) {
    return { ok: false, error: "Choose a source audience and a campaign. Nothing was written." };
  }
  if (pairCampaignId && !CAMPAIGN_ID.test(pairCampaignId)) {
    return { ok: false, error: "Choose a second campaign from the list. Nothing was written." };
  }
  if (pairCampaignId === launchCampaignId) {
    return { ok: false, error: "The two campaigns have to be different. Nothing was written." };
  }
  const launchIds = pairCampaignId ? [launchCampaignId, pairCampaignId] : [launchCampaignId];
  for (const id of launchIds) {
    const playbook = await currentQuietPlaybook(id);
    if ("error" in playbook) return { ok: false, error: playbook.error };
  }
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    return { ok: false, error: "Eligibility could not be signed. Nobody was marked eligible. Nothing was written." };
  }

  if (args.phase === "history") return historyPhase({ sourceCampaignIds, launchCampaignId, pairCampaignId, secret });
  if (args.phase === "facts") {
    return factsPhase({
      secret,
      manifest: args.manifest ?? "",
      tickets: args.tickets ?? [],
    });
  }
  const finished = finishLetterClearance({
    secret,
    manifest: args.manifest ?? "",
    sourceCampaignIds,
    launchCampaignId,
    pairCampaignId,
    pending: args.pending ?? [],
    historySkips: args.historySkips ?? [],
    outcomes: args.outcomes ?? [],
  });
  if (!finished.ok) return finished;
  return {
    ok: true,
    complete: true,
    unique: finished.unique,
    eligible: finished.eligible,
    excluded: finished.excluded,
    unverified: finished.unverified,
    groups: finished.groups.map((group) => ({
      campaignId: group.campaignId,
      count: group.leads.length,
      csv: letterLeadCsv(group.leads),
    })),
    skips: finished.skips,
    note: `Unique coaches ${finished.unique}. Eligible ${finished.eligible}, excluded ${finished.excluded}, unverified ${finished.unverified}. Eligibility only. No leads were imported, no campaign was activated, and no email was sent.`,
  };
}

async function historyPhase(args: {
  sourceCampaignIds: string[];
  launchCampaignId: string;
  pairCampaignId: string | null;
  secret: string;
}): Promise<LetterAudienceResult> {
  const history = await fetchInstantlyBackfillSource();
  if (!history.paginationComplete || history.apiError) {
    return {
      ok: false,
      error: "Instantly contact history across campaigns is incomplete. Nobody was marked eligible. Nothing was written.",
    };
  }
  const leads = [];
  for (const row of history.leads) {
    const lead = parseInstantlyLead(row);
    if (!lead) {
      return { ok: false, error: "An Instantly row could not be read. Nobody was marked eligible. Nothing was written." };
    }
    leads.push(lead);
  }
  const classified = classifyLetterHistory({
    sourceCampaignIds: args.sourceCampaignIds,
    leads,
    campaignActivity: history.campaignNamesLoaded ? campaignActivityMap(history.campaigns) : null,
  });
  const unique = classified.pending.length + classified.skips.length;
  if (unique > LETTER_AUDIENCE_CAP) {
    return { ok: false, error: "This audience is larger than the clearance limit. Nobody was marked eligible. Nothing was written." };
  }
  const signed = signLetterBatch({
    secret: args.secret,
    sourceCampaignIds: args.sourceCampaignIds,
    launchCampaignId: args.launchCampaignId,
    pairCampaignId: args.pairCampaignId,
    pending: classified.pending,
    historySkips: classified.skips,
  });
  if (!signed) {
    return { ok: false, error: "Eligibility could not be signed. Nobody was marked eligible. Nothing was written." };
  }
  if (classified.pending.length === 0) {
    const finished = finishLetterClearance({
      secret: args.secret,
      manifest: signed.manifest,
      sourceCampaignIds: args.sourceCampaignIds,
      launchCampaignId: args.launchCampaignId,
      pairCampaignId: args.pairCampaignId,
      pending: [],
      historySkips: classified.skips,
      outcomes: [],
    });
    if (!finished.ok) return finished;
    return {
      ok: true,
      complete: true,
      unique: finished.unique,
      eligible: finished.eligible,
      excluded: finished.excluded,
      unverified: finished.unverified,
      groups: finished.groups.map((group) => ({
        campaignId: group.campaignId,
        count: group.leads.length,
        csv: letterLeadCsv(group.leads),
      })),
      skips: finished.skips,
      note: `Unique coaches ${finished.unique}. Eligible ${finished.eligible}, excluded ${finished.excluded}, unverified ${finished.unverified}. Eligibility only. No leads were imported, no campaign was activated, and no email was sent.`,
    };
  }
  return {
    ok: true,
    complete: false,
    manifest: signed.manifest,
    tickets: signed.tickets,
    skips: classified.skips,
    unique,
    pending: classified.pending.length,
    batchSize: LETTER_FACT_BATCH,
    note: `Contact history is complete for ${unique} unique coaches. ${classified.pending.length} still need membership checks. ${NOT_CLEARED}`,
  };
}

async function factsPhase(args: {
  secret: string;
  manifest: string;
  tickets: readonly LetterPendingTicket[];
}): Promise<LetterAudienceResult> {
  if (!args.manifest || args.tickets.length === 0 || args.tickets.length > LETTER_FACT_BATCH) {
    return { ok: false, error: `Eligibility checks membership for ${LETTER_FACT_BATCH} coaches at a time. ${NOT_CLEARED}` };
  }
  if (args.tickets.some((ticket) => !verifyLetterPending({ secret: args.secret, manifest: args.manifest, ticket }))) {
    return { ok: false, error: "This eligibility batch could not be verified. The roster is not cleared. Nothing was written." };
  }
  const locals = await localFacts(args.tickets.map((ticket) => ticket.email));
  if (!locals) return { ok: false, error: LEDGER_UNREAD_BATCH };
  const decided = decideLetterFacts(args.tickets.map((ticket) => ticket.lead), locals);
  const outcomes = signLetterOutcomes({
    secret: args.secret,
    manifest: args.manifest,
    eligible: decided.eligible,
    skips: decided.skips,
  });
  if (!outcomes || outcomes.length !== args.tickets.length) {
    return { ok: false, error: "Eligibility could not be signed. The roster is not cleared. Nothing was written." };
  }
  return {
    ok: true,
    complete: false,
    outcomes,
    note: `Membership checked for ${args.tickets.length} coaches. ${NOT_CLEARED}`,
  };
}

async function localFacts(emails: string[]): Promise<Map<string, LetterLocalFacts> | null> {
  const people = new Map<string, { id: string; lifecycle: AcquisitionLifecycle; stripeSubscriptionId: string | null; clerkUserId: string | null }>();
  for (const chunk of chunks(emails, CHUNK)) {
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("id, email_normalized, lifecycle_state, stripe_subscription_id, clerk_user_id")
      .in("email_normalized", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.id !== "string" || typeof row.email_normalized !== "string" || !isAcquisitionLifecycle(String(row.lifecycle_state))) continue;
      people.set(row.email_normalized, {
        id: row.id,
        lifecycle: row.lifecycle_state,
        stripeSubscriptionId: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
        clerkUserId: typeof row.clerk_user_id === "string" ? row.clerk_user_id : null,
      });
    }
  }

  const optedOut = new Set<string>();
  const addressBlocked = new Set<string>();
  for (const chunk of chunks(emails, CHUNK)) {
    const [stops, blocks] = await Promise.all([
      supabaseServer.from("recovery_suppressions").select("email_normalized").in("email_normalized", chunk),
      supabaseServer.from("acquisition_instantly_blocks").select("email_normalized").in("email_normalized", chunk),
    ]);
    if (stops.error || blocks.error) return null;
    for (const row of stops.data ?? []) {
      if (typeof row.email_normalized === "string") optedOut.add(row.email_normalized);
    }
    for (const row of blocks.data ?? []) {
      if (typeof row.email_normalized === "string") addressBlocked.add(row.email_normalized);
    }
  }
  const domains = await blockedDomains();
  if (!domains) return null;

  const ids = [...people.values()].map((person) => person.id);
  const journeyPeople = new Set<string>();
  const heldPeople = new Set<string>();
  const ledger = new Map<string, { emailed: boolean; replied: boolean; bounced: boolean; stopped: boolean; sequence: boolean }>();
  for (const chunk of chunks(ids, CHUNK)) {
    if (chunk.length === 0) continue;
    const [journeys, actions, events] = await Promise.all([
      supabaseServer.from("acquisition_journeys").select("person_id").in("person_id", chunk),
      supabaseServer.from("acquisition_actions").select("person_id").in("person_id", chunk).in("status", ["scheduled", "claimed"]),
      supabaseServer.from("acquisition_events").select("person_id, event_type").in("person_id", chunk).in("event_type", Object.keys(LEDGER_EVENT)),
    ]);
    if (journeys.error || actions.error || events.error) return null;
    for (const row of journeys.data ?? []) if (typeof row.person_id === "string") journeyPeople.add(row.person_id);
    for (const row of actions.data ?? []) if (typeof row.person_id === "string") heldPeople.add(row.person_id);
    for (const row of events.data ?? []) {
      if (typeof row.person_id !== "string" || typeof row.event_type !== "string") continue;
      const kind = LEDGER_EVENT[row.event_type as keyof typeof LEDGER_EVENT];
      if (!kind) continue;
      const current = ledger.get(row.person_id) ?? { emailed: false, replied: false, bounced: false, stopped: false, sequence: false };
      current[kind] = true;
      ledger.set(row.person_id, current);
    }
  }

  const membership = membershipMapOrUnverified(
    emails,
    await liveMembershipByEmail(emails.map((email) => {
      const person = people.get(email);
      return {
        email,
        clerkUserId: person?.clerkUserId ?? null,
        stripeSubscriptionId: person?.stripeSubscriptionId ?? null,
      };
    })),
  );
  for (const [email, person] of people) {
    if (person.lifecycle === "trial_started" || person.lifecycle === "paid_member" || person.stripeSubscriptionId) {
      membership.set(email, "member");
    }
  }

  const accounts: LetterHistoricalAccount[] = [];
  const clerkUnread = new Set<string>();
  for (const email of emails) {
    const account = await clerkAccount(email, people.get(email)?.clerkUserId ?? null, people.get(email)?.stripeSubscriptionId ?? null);
    if (!account) clerkUnread.add(email);
    else accounts.push(account);
  }
  let historical = new Map<string, { decision: Parameters<typeof letterMembershipVerdict>[0]["decision"]; statuses: string[] } | null>();
  try {
    historical = await readHistoricalLetterDecisions(accounts);
  } catch {
    historical = new Map();
  }

  const facts = new Map<string, LetterLocalFacts>();
  for (const email of emails) {
    const person = people.get(email);
    const history = historical.get(email);
    const historicalMembership = clerkUnread.has(email) || history == null
      ? "unverified"
      : letterMembershipVerdict({
          decision: history.decision,
          subscriptions: history.statuses.map((status) => ({ status })),
        });
    const historicalDetail = historicalMembership === "clear"
      ? null
      : clerkUnread.has(email) || history == null
        ? "Historical membership could not be read."
        : history.decision?.reason || "Historical membership could not be read.";
    facts.set(email, {
      lifecycle: person?.lifecycle ?? null,
      addressBlocked: addressBlocked.has(email),
      domainBlocked: emailBlockedByDomain(email, [...domains]),
      optedOut: optedOut.has(email),
      outstandingFulfillment: person ? heldPeople.has(person.id) : false,
      hasJourney: person ? journeyPeople.has(person.id) : false,
      ledgerEmailed: person ? ledger.get(person.id)?.emailed === true : false,
      ledgerReplied: person ? ledger.get(person.id)?.replied === true : false,
      ledgerBounced: person ? ledger.get(person.id)?.bounced === true : false,
      ledgerStopped: person ? ledger.get(person.id)?.stopped === true : false,
      ledgerSequence: person ? ledger.get(person.id)?.sequence === true : false,
      membership: membership.get(email) ?? "unverified",
      historicalMembership,
      historicalDetail,
    });
  }
  return facts;
}

async function clerkAccount(
  email: string,
  clerkUserId: string | null,
  stripeSubscriptionId: string | null,
): Promise<LetterHistoricalAccount | null> {
  try {
    const linked = clerkUserId ? await getClerkUserOrNull(clerkUserId) : null;
    const user = linked ?? (await listClerkUsersByEmail(email))[0] ?? null;
    const metadata = user?.public_metadata ?? {};
    const createdAt = typeof user?.created_at === "number" ? new Date(user.created_at).toISOString() : "";
    return {
      email,
      clerkId: user?.id ?? "",
      createdAt,
      summittSubscribed: metadataText(metadata.summittSubscribed),
      summittPlan: metadataText(metadata.summittPlan),
      stripeSubscriptionId: metadataText(metadata.stripeSubscriptionId) || stripeSubscriptionId || "",
      stripeCustomerId: metadataText(metadata.stripeCustomerId),
    };
  } catch {
    return null;
  }
}

function metadataText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function blockedDomains(): Promise<string[] | null> {
  const domains: string[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data, error } = await supabaseServer
      .from("acquisition_blocked_domains")
      .select("domain")
      .range(from, from + page - 1);
    if (error) return null;
    const rows = data ?? [];
    for (const row of rows) {
      if (typeof row.domain === "string" && row.domain.trim()) domains.push(row.domain);
    }
    if (rows.length < page) return domains;
  }
  return null;
}

function campaignActivityMap(
  campaigns: readonly { id: string; status: number | null }[],
): Map<string, "active" | "inactive"> {
  const activity = new Map<string, "active" | "inactive">();
  for (const campaign of campaigns) {
    if (!campaign.id || campaign.status === null) continue;
    activity.set(campaign.id, campaign.status === 1 || campaign.status === 4 ? "active" : "inactive");
  }
  return activity;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
