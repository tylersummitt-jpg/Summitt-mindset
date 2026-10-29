import "server-only";

import { saveCampaignPlaybook } from "@/lib/acquisition/playbook.server";
import type { PlaybookFulfillment, PlaybookSendAction, PlaybookStatus } from "@/lib/acquisition/playbook";
import { acquisitionRecipientToken } from "@/lib/acquisition/store";
import { isAcquisitionLifecycle, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import { signAcquisitionJourneyId } from "@/lib/acquisition/email-acquired-member-notice";
import { membershipMapOrUnverified } from "@/lib/acquisition/audience-clearance";
import { liveMembershipByEmail } from "@/lib/acquisition/audience-membership.server";
import {
  decideLead,
  instantlyLeadCsv,
  isVideoFirstPlaybook,
  openJourneyVideoFacts,
  parseProspectList,
  playbookCanReceiveExistingLeads,
  recipientVideoUrl,
  skipReport,
  type ColdVideoPlaybook,
  type LeadFacts,
  type MembershipClearance,
  type ProspectLead,
  type VerificationClearance,
} from "@/lib/acquisition/video-first-prep";
import { supabaseServer } from "@/lib/supabase-server";

export type VideoFirstLeadResult =
  | { ok: false; error: string }
  | {
      ok: true;
      campaignName: string;
      videoId: string;
      prepared: number;
      reused: number;
      invalid: number;
      csv: string;
      skips: Array<{ email: string; reason: string }>;
      skipCsv: string;
    };

type PersonHit = {
  id: string;
  lifecycle: AcquisitionLifecycle;
  stripeSubscriptionId: string | null;
  clerkUserId: string | null;
};

const CHUNK = 100;

export async function prepareVideoFirstLeads(args: {
  campaignId: string;
  personalVideoId: string;
  prospects: string;
}): Promise<VideoFirstLeadResult> {
  const campaignId = args.campaignId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(campaignId)) {
    return { ok: false, error: "Choose a campaign from the list. Nothing was written." };
  }
  const parsed = parseProspectList(args.prospects);
  if (!parsed.ok) return parsed;
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16 || !signAcquisitionJourneyId("00000000-0000-4000-8000-000000000001", secret)) {
    return { ok: false, error: "Video links cannot be signed right now. Nothing was written." };
  }

  const videoId = args.personalVideoId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(videoId)) {
    return { ok: false, error: "Choose a personal video. Nothing was written." };
  }
  const ready = await videoIsReady(videoId);
  if (ready === "unavailable") return { ok: false, error: "The personal video could not be read. Nothing was written." };
  if (!ready) return { ok: false, error: "The personal video is not ready. Nothing was written." };
  const playbook = await ensureVideoPlaybook(campaignId, videoId);
  if ("error" in playbook) return { ok: false, error: playbook.error };
  const issued = await issueVideoFirstLinks({
    campaignId,
    personalVideoId: videoId,
    leads: parsed.leads,
    playbook,
  });
  if (!issued.ok) return issued;
  return {
    ok: true,
    campaignName: playbook.name,
    videoId,
    prepared: issued.links.length,
    reused: issued.reused,
    invalid: parsed.invalid,
    csv: instantlyLeadCsv(issued.links),
    skips: issued.skips,
    skipCsv: skipReport(issued.skips),
  };
}

export async function currentQuietVideoPlaybook(
  campaignId: string,
  videoId: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const current = await currentPlaybook(campaignId);
  if (current === "unavailable") return { error: "The playbook could not be read. Nothing was written." };
  if (!current) return { error: "This campaign has no saved playbook. Nothing was written." };
  if (!playbookCanReceiveExistingLeads(current, videoId)) {
    return { error: "Choose the video saved on this campaign's current playbook. Automatic sending has to stay off. Nothing was written." };
  }
  return { id: current.id, name: current.name };
}

export async function issueVideoFirstLinks(args: {
  campaignId: string;
  personalVideoId: string;
  leads: ProspectLead[];
  playbook: { id: string; name: string };
  sourceCampaignId?: string | null;
  membershipByEmail?: ReadonlyMap<string, MembershipClearance>;
  verificationByEmail?: ReadonlyMap<string, VerificationClearance>;
}): Promise<
  | { ok: false; error: string }
  | { ok: true; links: Array<ProspectLead & { videoUrl: string }>; skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }>; reused: number }
> {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16 || !signAcquisitionJourneyId("00000000-0000-4000-8000-000000000001", secret)) {
    return { ok: false, error: "Video links cannot be signed right now. Nothing was written." };
  }
  const { campaignId, playbook } = args;
  const sourceCampaignId = args.sourceCampaignId?.trim() || null;
  const videoId = args.personalVideoId;
  const emails = args.leads.map((lead) => lead.email);
  const people = await peopleByEmail(emails);
  if (!people) return { ok: false, error: "Existing people could not be read. No leads were prepared." };
  const stopped = await stoppedEmails(emails);
  if (!stopped) return { ok: false, error: "The opt-out list could not be read. No leads were prepared." };
  const history = await journeyHistory(people.ids, videoId);
  if (!history) return { ok: false, error: "Existing journeys could not be read. No leads were prepared." };
  const outstanding = await peopleWithOutstandingFulfillment(people.ids);
  if (!outstanding) return { ok: false, error: "Scheduled fulfillment could not be read. Nothing was released." };

  const membershipByEmail = args.membershipByEmail ?? membershipMapOrUnverified(
    emails,
    await liveMembershipByEmail(
      emails.map((email) => {
        const person = people.byEmail.get(email);
        return {
          email,
          clerkUserId: person?.clerkUserId ?? null,
          stripeSubscriptionId: person?.stripeSubscriptionId ?? null,
        };
      }),
    ),
  );

  const included: Array<ProspectLead & { videoUrl: string }> = [];
  const skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }> = [];
  let reused = 0;

  for (const lead of args.leads) {
    const person = people.byEmail.get(lead.email) ?? null;
    const facts = factsFor(lead.email, person, stopped, outstanding, history, campaignId, sourceCampaignId, {
      membership: membershipByEmail.get(lead.email) ?? "unverified",
      verification: args.verificationByEmail?.get(lead.email) ?? "verified",
    });
    const decision = decideLead(facts);
    if (decision.outcome === "skip") {
      skips.push({ email: lead.email, reason: decision.reason, kind: decision.kind });
      continue;
    }
    if (decision.outcome === "boundary") {
      const closed = await closePreviousJourney(decision.previousJourneyId);
      if (!closed) {
        skips.push({ email: lead.email, reason: "The earlier journey could not be closed safely. Nothing of theirs was changed, and they were left out." });
        continue;
      }
    }
    const journeyId = decision.outcome === "reuse"
      ? decision.journeyId
      : await openJourney(person?.id ?? await insertPerson(lead, campaignId), campaignId, playbook.id);
    if (!journeyId) {
      skips.push({ email: lead.email, reason: "This person could not be prepared safely. They were left out." });
      continue;
    }
    const journeyToken = signAcquisitionJourneyId(journeyId, secret);
    const ownerId = decision.outcome === "reuse" ? person?.id : await personIdForJourney(journeyId);
    if (!journeyToken || !ownerId) {
      skips.push({ email: lead.email, reason: "This person could not be prepared safely. They were left out." });
      continue;
    }
    const token = await acquisitionRecipientToken(ownerId, videoId);
    if (token === "unavailable" || !token) {
      skips.push({ email: lead.email, reason: "The video link could not be issued. This person was left out." });
      continue;
    }
    const recorded = await rememberPreparedLink({ personId: ownerId, journeyId, campaignId, videoId });
    if (!recorded) {
      skips.push({ email: lead.email, reason: "The prepared link could not be recorded. This person was left out of the file." });
      continue;
    }
    if (decision.outcome === "reuse") reused += 1;
    included.push({ ...lead, videoUrl: recipientVideoUrl(token, journeyToken) });
  }

  return { ok: true, links: included, skips, reused };
}

type JourneyRow = {
  id: string;
  campaignId: string;
  closed: boolean;
  videoFirst: boolean;
  sameVideo: boolean;
};

function factsFor(
  email: string,
  person: PersonHit | null,
  stopped: Set<string>,
  outstanding: Set<string>,
  history: { rows: Map<string, JourneyRow[]> },
  campaignId: string,
  sourceCampaignId: string | null,
  clearance: { membership: MembershipClearance; verification: VerificationClearance },
): LeadFacts {
  const rows = person ? history.rows.get(person.id) ?? [] : [];
  const openHere = rows.filter((journey) => !journey.closed && journey.campaignId === campaignId);
  const openOnThisCampaign = openHere.length > 1
    ? { journeyId: openHere[0]!.id, videoFirst: false, sameVideo: false, ambiguous: true }
    : openHere.length === 1
      ? {
          journeyId: openHere[0]!.id,
          videoFirst: openHere[0]!.videoFirst,
          sameVideo: openHere[0]!.sameVideo,
          ambiguous: false,
        }
      : null;
  const migrating = Boolean(sourceCampaignId && sourceCampaignId !== campaignId);
  const sourceOpen = migrating
    ? rows.filter((journey) => !journey.closed && journey.campaignId === sourceCampaignId && journey.videoFirst)
    : [];
  return {
    lifecycle: person?.lifecycle ?? null,
    stripeSubscriptionId: person?.stripeSubscriptionId ?? null,
    suppressed: stopped.has(email),
    outstandingFulfillment: person ? outstanding.has(person.id) : false,
    openVideoElsewhere: rows.some((journey) =>
      !journey.closed
      && journey.campaignId !== campaignId
      && (!migrating || journey.campaignId !== sourceCampaignId)
      && journey.videoFirst),
    openVideoOnSource: sourceOpen.length === 1
      ? { journeyId: sourceOpen[0]!.id, sameVideo: sourceOpen[0]!.sameVideo }
      : null,
    sourceAmbiguous: migrating && sourceOpen.length > 1,
    membership: clearance.membership,
    verification: clearance.verification,
    openOnThisCampaign,
  };
}

async function currentPlaybook(campaignId: string): Promise<(ColdVideoPlaybook & { name: string; audience: string }) | null | "unavailable"> {
  const { data, error } = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("id, name, audience, status, personal_video_id, permitted_actions, fulfillment")
    .eq("campaign_id", campaignId)
    .eq("status", "current")
    .order("version", { ascending: false })
    .limit(2);
  if (error) return "unavailable";
  const rows = data ?? [];
  if (rows.length !== 1) return rows.length === 0 ? null : "unavailable";
  const row = rows[0];
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.audience !== "string") return "unavailable";
  const fulfillment = row.fulfillment;
  const status = row.status;
  if (status !== "current" && status !== "paused" && status !== "retired" && status !== "superseded") return "unavailable";
  if (fulfillment !== "none" && fulfillment !== "manual" && fulfillment !== "catalog" && fulfillment !== "video" && fulfillment !== "catalog_and_video") {
    return "unavailable";
  }
  const permitted = Array.isArray(row.permitted_actions)
    ? row.permitted_actions.filter((item): item is PlaybookSendAction => item === "send_asset" || item === "send_video")
    : [];
  return {
    id: row.id,
    name: row.name,
    audience: row.audience,
    status: status as PlaybookStatus,
    personalVideoId: typeof row.personal_video_id === "string" ? row.personal_video_id : null,
    permittedActions: permitted,
    fulfillment: fulfillment as PlaybookFulfillment,
  };
}

async function videoIsReady(videoId: string): Promise<boolean | "unavailable"> {
  const { data, error } = await supabaseServer.from("personal_videos").select("status").eq("id", videoId).maybeSingle();
  if (error) return "unavailable";
  return data?.status === "ready";
}

async function peopleByEmail(emails: string[]): Promise<{ byEmail: Map<string, PersonHit>; ids: string[] } | null> {
  const byEmail = new Map<string, PersonHit>();
  for (const chunk of chunks(emails, CHUNK)) {
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("id, email_normalized, lifecycle_state, stripe_subscription_id, clerk_user_id")
      .in("email_normalized", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.id !== "string" || typeof row.email_normalized !== "string" || !isAcquisitionLifecycle(String(row.lifecycle_state))) continue;
      byEmail.set(row.email_normalized, {
        id: row.id,
        lifecycle: row.lifecycle_state,
        stripeSubscriptionId: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
        clerkUserId: typeof row.clerk_user_id === "string" ? row.clerk_user_id : null,
      });
    }
  }
  return { byEmail, ids: [...byEmail.values()].map((person) => person.id) };
}

async function stoppedEmails(emails: string[]): Promise<Set<string> | null> {
  const stopped = new Set<string>();
  for (const chunk of chunks(emails, CHUNK)) {
    const [suppressions, blocks] = await Promise.all([
      supabaseServer.from("recovery_suppressions").select("email_normalized").in("email_normalized", chunk),
      supabaseServer.from("acquisition_instantly_blocks").select("email_normalized").in("email_normalized", chunk),
    ]);
    if (suppressions.error || blocks.error) return null;
    for (const row of [...(suppressions.data ?? []), ...(blocks.data ?? [])]) {
      if (typeof row.email_normalized === "string") stopped.add(row.email_normalized);
    }
  }
  return stopped;
}

async function journeyHistory(personIds: string[], videoId: string): Promise<{ rows: Map<string, JourneyRow[]> } | null> {
  const stored = new Map<string, Array<{ id: string; campaignId: string; closed: boolean }>>();
  for (const chunk of chunks(personIds, CHUNK)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_journeys")
      .select("id, person_id, campaign_id, closed_at")
      .in("person_id", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.id !== "string" || typeof row.person_id !== "string" || typeof row.campaign_id !== "string") continue;
      const list = stored.get(row.person_id) ?? [];
      list.push({ id: row.id, campaignId: row.campaign_id, closed: row.closed_at != null });
      stored.set(row.person_id, list);
    }
  }
  const openIds = [...stored.values()].flat().filter((journey) => !journey.closed).map((journey) => journey.id);
  const pins = new Map<string, string>();
  for (const chunk of chunks(openIds, CHUNK)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_journey_playbook_pins")
      .select("journey_id, playbook_id")
      .in("journey_id", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.journey_id === "string" && typeof row.playbook_id === "string") pins.set(row.journey_id, row.playbook_id);
    }
  }
  const playbooks = await playbooksById([...new Set(pins.values())]);
  if (!playbooks) return null;
  const prepared = await preparedJourneys(openIds);
  if (!prepared) return null;
  const rows = new Map<string, JourneyRow[]>();
  for (const [personId, list] of stored) {
    rows.set(personId, list.map((journey) => {
      const playbook = pins.has(journey.id) ? playbooks.get(pins.get(journey.id)!) : undefined;
      const videoFacts = openJourneyVideoFacts(playbook, prepared.get(journey.id), videoId);
      return {
        id: journey.id,
        campaignId: journey.campaignId,
        closed: journey.closed,
        videoFirst: videoFacts.videoFirst,
        sameVideo: videoFacts.sameVideo,
      };
    }));
  }
  return { rows };
}

async function playbooksById(ids: string[]): Promise<Map<string, { personalVideoId: string | null; fulfillment: string; permittedActions: string[] }> | null> {
  const found = new Map<string, { personalVideoId: string | null; fulfillment: string; permittedActions: string[] }>();
  for (const chunk of chunks(ids, CHUNK)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_campaign_playbooks")
      .select("id, personal_video_id, fulfillment, permitted_actions")
      .in("id", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.id !== "string") continue;
      const permitted = Array.isArray(row.permitted_actions) ? row.permitted_actions.filter((item): item is string => typeof item === "string") : [];
      found.set(row.id, {
        personalVideoId: typeof row.personal_video_id === "string" ? row.personal_video_id : null,
        fulfillment: typeof row.fulfillment === "string" ? row.fulfillment : "",
        permittedActions: permitted,
      });
    }
  }
  return found;
}

async function preparedJourneys(journeyIds: string[]): Promise<Map<string, string> | null> {
  const found = new Map<string, string>();
  for (const chunk of chunks(journeyIds, CHUNK)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_events")
      .select("journey_id, metadata")
      .eq("event_type", "video_link_prepared")
      .in("journey_id", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as { personal_video_id?: unknown } : {};
      if (typeof row.journey_id === "string" && typeof metadata.personal_video_id === "string") {
        found.set(row.journey_id, metadata.personal_video_id);
      }
    }
  }
  return found;
}

async function peopleWithOutstandingFulfillment(personIds: string[]): Promise<Set<string> | null> {
  const found = new Set<string>();
  for (const chunk of chunks(personIds, CHUNK)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_actions")
      .select("person_id")
      .in("person_id", chunk)
      .in("status", ["scheduled", "claimed"]);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.person_id === "string") found.add(row.person_id);
    }
  }
  return found;
}

async function closePreviousJourney(journeyId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", journeyId)
    .is("closed_at", null)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function ensureVideoPlaybook(campaignId: string, videoId: string): Promise<{ id: string; name: string } | { error: string }> {
  const current = await currentPlaybook(campaignId);
  if (current === "unavailable") return { error: "The playbook could not be read. Nothing was written." };
  if (!current) return { error: "This campaign has no saved playbook. Nothing was written." };
  if (isVideoFirstPlaybook(current, videoId)) return { id: current.id, name: current.name };
  const saved = await saveCampaignPlaybook({
    campaignId,
    name: current.name,
    audience: current.audience,
    offerLabel: null,
    offerKey: null,
    resources: [],
    manualResource: null,
    personalVideoId: videoId,
    permittedActions: [],
    replyGuidance: null,
    fulfillment: "none",
  });
  if (!saved.ok) return { error: `${saved.error} No leads were prepared.` };
  return { id: saved.id, name: current.name };
}

async function insertPerson(lead: ProspectLead, campaignId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .insert({
      email_normalized: lead.email,
      first_name: lead.firstName,
      last_name: lead.lastName,
      acquisition_source: "cold_email",
      source_campaign: campaignId,
      source_provider: "instantly",
      lifecycle_state: "cold_active",
    })
    .select("id")
    .maybeSingle();
  if (!error && typeof data?.id === "string") return data.id;
  if ((error as { code?: string } | null)?.code !== "23505") return null;
  const again = await supabaseServer
    .from("acquisition_people")
    .select("id, lifecycle_state, stripe_subscription_id")
    .eq("email_normalized", lead.email)
    .maybeSingle();
  if (again.error || typeof again.data?.id !== "string" || !isAcquisitionLifecycle(String(again.data.lifecycle_state))) return null;
  if (salesStop(again.data.lifecycle_state) || again.data.stripe_subscription_id) return null;
  return again.data.id;
}

function salesStop(state: AcquisitionLifecycle): boolean {
  return state === "trial_started" || state === "paid_member" || state === "unsubscribed" || state === "suppressed";
}

async function openJourney(personId: string | null, campaignId: string, playbookId: string): Promise<string | null> {
  if (!personId) return null;
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .insert({ person_id: personId, campaign_id: campaignId })
    .select("id")
    .maybeSingle();
  let journeyId = typeof data?.id === "string" ? data.id : null;
  if ((error as { code?: string } | null)?.code === "23505") {
    const existing = await supabaseServer
      .from("acquisition_journeys")
      .select("id")
      .eq("person_id", personId)
      .eq("campaign_id", campaignId)
      .is("closed_at", null)
      .limit(2);
    if (existing.error || !Array.isArray(existing.data) || existing.data.length !== 1 || typeof existing.data[0]?.id !== "string") return null;
    journeyId = existing.data[0].id;
  } else if (error || !journeyId) {
    return null;
  }
  const pinInsert = await supabaseServer.from("acquisition_journey_playbook_pins").insert({
    journey_id: journeyId,
    playbook_id: playbookId,
  });
  if (pinInsert.error && (pinInsert.error as { code?: string }).code !== "23505") return null;
  const pin = await supabaseServer
    .from("acquisition_journey_playbook_pins")
    .select("playbook_id")
    .eq("journey_id", journeyId)
    .maybeSingle();
  if (pin.error || pin.data?.playbook_id !== playbookId) return null;
  return journeyId;
}

async function personIdForJourney(journeyId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .select("person_id")
    .eq("id", journeyId)
    .maybeSingle();
  if (error || typeof data?.person_id !== "string") return null;
  return data.person_id;
}

async function rememberPreparedLink(args: {
  personId: string;
  journeyId: string;
  campaignId: string;
  videoId: string;
}): Promise<boolean> {
  const { error } = await supabaseServer.from("acquisition_events").insert({
    person_id: args.personId,
    provider: "system",
    provider_event_id: `video_link:${args.journeyId}:${args.videoId}`,
    event_type: "video_link_prepared",
    occurred_at: new Date().toISOString(),
    campaign_id: args.campaignId,
    journey_id: args.journeyId,
    metadata: { personal_video_id: args.videoId },
  });
  if (!error) return true;
  return (error as { code?: string }).code === "23505";
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
