import "server-only";

import { parseInstantlyLead } from "@/lib/acquisition/backfill";
import { fetchInstantlyBackfillSource } from "@/lib/acquisition/store";
import { membershipMapOrUnverified } from "@/lib/acquisition/audience-clearance";
import { liveMembershipByEmail } from "@/lib/acquisition/audience-membership.server";
import {
  emailsWithClearHistory,
  letterLeadCsv,
  letterMembershipVerdict,
  reviewLetterAudience,
  splitLetterAudience,
  type LetterLocalFacts,
} from "@/lib/acquisition/letter-audience";
import { getClerkUserOrNull, listClerkUsersByEmail } from "@/lib/clerk-rest";
import {
  readHistoricalLetterDecisions,
  type LetterHistoricalAccount,
} from "@/lib/historical-never-subscriber.server";
import { isAcquisitionLifecycle, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import { currentQuietPlaybook } from "@/lib/acquisition/video-first-leads.server";
import { supabaseServer } from "@/lib/supabase-server";

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CHUNK = 100;
const OUTREACH_EVENTS = [
  "email_sent",
  "reply_received",
  "interested",
  "not_interested",
  "unsubscribed",
  "bounced",
  "complained",
  "campaign_completed",
  "wrong_person",
];

export type LetterAudienceResult =
  | { ok: false; error: string }
  | {
      ok: true;
      sourceCampaignId: string;
      scanned: number;
      eligible: number;
      excluded: number;
      unverified: number;
      groups: Array<{ campaignId: string; count: number; csv: string }>;
      skips: Array<{ email: string; reason: string; kind: "excluded" | "unverified" }>;
      note: string;
    };

/**
 * Read-only clearance for a personal letter. No video, no Instantly import,
 * and no journey or fulfillment writes.
 */
export async function checkLetterAudience(args: {
  sourceCampaignId: string;
  launchCampaignId: string;
  pairCampaignId?: string | null;
}): Promise<LetterAudienceResult> {
  const sourceCampaignId = args.sourceCampaignId.trim();
  const launchCampaignId = args.launchCampaignId.trim();
  const pairCampaignId = args.pairCampaignId?.trim() || null;
  if (!CAMPAIGN_ID.test(sourceCampaignId) || !CAMPAIGN_ID.test(launchCampaignId)) {
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

  const localByEmail = await localFacts(emailsWithClearHistory(sourceCampaignId, leads));
  if (!localByEmail) {
    return { ok: false, error: "Membership and the acquisition ledger could not be read. Nobody was marked eligible. Nothing was written." };
  }
  const reviewed = reviewLetterAudience({ sourceCampaignId, leads, localByEmail });
  const excluded = reviewed.skips.filter((skip) => skip.kind === "excluded").length;
  const unverified = reviewed.skips.filter((skip) => skip.kind === "unverified").length;
  const groups = pairCampaignId
    ? splitLetterAudience(reviewed.eligible, [launchCampaignId, pairCampaignId]).groups
    : [{ campaignId: launchCampaignId, leads: reviewed.eligible }];

  return {
    ok: true,
    sourceCampaignId,
    scanned: leads.length,
    eligible: reviewed.eligible.length,
    excluded,
    unverified,
    groups: groups.map((group) => ({
      campaignId: group.campaignId,
      count: group.leads.length,
      csv: letterLeadCsv(group.leads),
    })),
    skips: reviewed.skips,
    note: "Eligibility only. No leads were imported, no campaign was activated, and no email was sent.",
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

  const suppressed = new Set<string>();
  for (const chunk of chunks(emails, CHUNK)) {
    const [stops, blocks] = await Promise.all([
      supabaseServer.from("recovery_suppressions").select("email_normalized").in("email_normalized", chunk),
      supabaseServer.from("acquisition_instantly_blocks").select("email_normalized").in("email_normalized", chunk),
    ]);
    if (stops.error || blocks.error) return null;
    for (const row of [...(stops.data ?? []), ...(blocks.data ?? [])]) {
      if (typeof row.email_normalized === "string") suppressed.add(row.email_normalized);
    }
  }

  const ids = [...people.values()].map((person) => person.id);
  const journeyPeople = new Set<string>();
  const heldPeople = new Set<string>();
  const outreachPeople = new Set<string>();
  for (const chunk of chunks(ids, CHUNK)) {
    if (chunk.length === 0) continue;
    const [journeys, actions, events] = await Promise.all([
      supabaseServer.from("acquisition_journeys").select("person_id").in("person_id", chunk),
      supabaseServer.from("acquisition_actions").select("person_id").in("person_id", chunk).in("status", ["scheduled", "claimed"]),
      supabaseServer.from("acquisition_events").select("person_id").in("person_id", chunk).in("event_type", OUTREACH_EVENTS),
    ]);
    if (journeys.error || actions.error || events.error) return null;
    for (const row of journeys.data ?? []) if (typeof row.person_id === "string") journeyPeople.add(row.person_id);
    for (const row of actions.data ?? []) if (typeof row.person_id === "string") heldPeople.add(row.person_id);
    for (const row of events.data ?? []) if (typeof row.person_id === "string") outreachPeople.add(row.person_id);
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
    facts.set(email, {
      lifecycle: person?.lifecycle ?? null,
      suppressed: suppressed.has(email),
      outstandingFulfillment: person ? heldPeople.has(person.id) : false,
      hasJourney: person ? journeyPeople.has(person.id) : false,
      recordedOutreach: person ? outreachPeople.has(person.id) : false,
      membership: membership.get(email) ?? "unverified",
      historicalMembership,
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

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
