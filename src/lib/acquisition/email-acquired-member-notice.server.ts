import "server-only";

import { Resend } from "resend";

import {
  confirmedPreviousOutreach,
  decideNoticeClaim,
  deliverEmailAcquiredMemberNotice,
  describeResendResource,
  emailAcquiredMemberNotifyKey,
  groupHistoryByJourney,
  journeyIdFromStripeMetadata,
  readSignedAcquisitionJourneyId,
  resendResourceCountsAsSent,
  type HistoryRow,
  type NoticeClaimRow,
  type OutreachHistorySection,
  type RecordedConversationEntry,
} from "@/lib/acquisition/email-acquired-member-notice";
import { ACQUISITION_CLAIM_MS, normalizeAcquisitionEmail } from "@/lib/acquisition/model";
import { supabaseServer } from "@/lib/supabase-server";

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function journeyLinkSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  return secret.length >= 16 ? secret : null;
}

export function verifiedJourneyToken(token: unknown): string | null {
  const secret = journeyLinkSecret();
  if (!secret) return null;
  return readSignedAcquisitionJourneyId(token, secret);
}

export async function verifiedAcquisitionJourneyId(token: unknown): Promise<string | null> {
  const id = verifiedJourneyToken(token);
  if (!id) return null;
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .select("id, campaign_id")
    .eq("id", id)
    .maybeSingle();
  if (error || typeof data?.campaign_id !== "string" || !data.campaign_id.trim()) return null;
  return id;
}

function stepDetail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const step = (metadata as { step?: unknown }).step;
  return typeof step === "number" && Number.isFinite(step) ? `Step ${step}.` : null;
}

type LoadedOutreach = {
  personId: string;
  acquisitionName: string | null;
  acquisitionEmail: string | null;
  section: OutreachHistorySection;
  emailSent: number;
  inboundReplies: number;
  sentOutboundReplies: number;
  acceptedOrDeliveredResources: number;
  outreachUnreadable: boolean;
  repliesUnreadable: boolean;
  resourcesUnreadable: boolean;
  truncated: boolean;
};

export async function maybeNotifyEmailAcquiredMember(args: {
  subscriptionId: string;
  metadata: { [key: string]: string | undefined } | null | undefined;
  ownerCanary: boolean;
  memberName: string | null;
  memberEmail: string | null;
}): Promise<"sent" | "skipped" | "failed"> {
  if (args.ownerCanary) return "skipped";
  const key = emailAcquiredMemberNotifyKey(args.subscriptionId);
  if (!key) return "skipped";

  const memberEmail = normalizeAcquisitionEmail(args.memberEmail);
  const signedJourneyId = journeyIdFromStripeMetadata(args.metadata);
  const exact = memberEmail ? await loadPersonByEmail(memberEmail) : null;
  const signedJourney = signedJourneyId ? await loadSignedJourney(signedJourneyId) : null;
  if (exact === "error" && !signedJourney) return "skipped";

  const signedEmail = signedJourney && signedJourney !== "error" ? signedJourney.email : null;
  const emailsMatch = Boolean(signedEmail && memberEmail && signedEmail === memberEmail);
  const exactSource = exact && exact !== "error"
    ? exact
    : emailsMatch && signedJourney && signedJourney !== "error" && signedEmail
      ? { id: signedJourney.personId, name: signedJourney.name, email: signedEmail }
      : null;
  const exactHistory = exactSource
    ? await loadOutreach({
      personId: exactSource.id,
      acquisitionName: exactSource.name,
      acquisitionEmail: exactSource.email,
      journeyId: null,
      association: "exact_email",
    })
    : null;
  const emailsDiffer = Boolean(signedEmail && memberEmail && signedEmail !== memberEmail);
  const memberEmailMissing = !memberEmail;
  const samePerson = Boolean(exact && exact !== "error" && signedJourney && signedJourney !== "error" && exact.id === signedJourney.personId);
  const signedHistory = signedJourney && signedJourney !== "error" && (emailsDiffer || memberEmailMissing) && !samePerson
    ? await loadOutreach({
      personId: signedJourney.personId,
      acquisitionName: signedJourney.name,
      acquisitionEmail: signedJourney.email,
      journeyId: signedJourney.id,
      association: "signed_journey",
    })
    : null;

  const exactConfirmed = Boolean(exactHistory && qualifies(exactHistory));
  const signedConfirmed = Boolean(signedHistory && qualifies(signedHistory));
  const sections = [
    exactConfirmed && exactHistory ? exactHistory.section : null,
    signedConfirmed && signedHistory ? signedHistory.section : null,
  ].filter((section): section is OutreachHistorySection => Boolean(section));
  const histories = [exactHistory, signedHistory].filter((history): history is LoadedOutreach => Boolean(history));
  const claimPersonId = (exactConfirmed ? exactHistory?.personId : null) ?? (signedConfirmed ? signedHistory?.personId : null);
  const claimCampaignId = sections.flatMap((section) => section.campaigns).find((campaign) => campaign.id)?.id ?? null;
  const claimJourneyId = signedConfirmed ? signedJourneyId : null;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();
  const from = process.env.COACH_KIT_NOTIFY_FROM?.trim() || "challenge@summittmindset.com";
  return deliverEmailAcquiredMemberNotice({
    history: {
      ownerCanary: false,
      exactEmailConfirmed: exactConfirmed,
      signedJourneyConfirmed: signedConfirmed,
    },
    notice: {
      memberName: text(args.memberName, 120),
      memberEmail: memberEmail ?? text(args.memberEmail, 254),
      sections,
      outreachUnreadable: histories.some((history) => history.outreachUnreadable) || exact === "error" || signedJourney === "error",
      repliesUnreadable: histories.some((history) => history.repliesUnreadable),
      resourcesUnreadable: histories.some((history) => history.resourcesUnreadable),
      truncated: histories.some((history) => history.truncated),
    },
    subscriptionId: args.subscriptionId,
    credentialsReady: Boolean(apiKey && to),
    claim: () => claimPersonId
      ? claimEmailAcquiredNotice({
        key,
        personId: claimPersonId,
        campaignId: claimCampaignId,
        journeyId: claimJourneyId,
        subscriptionId: args.subscriptionId,
      })
      : Promise.resolve("fail"),
    send: async (message, idempotencyKey) => {
      if (!apiKey || !to) return { state: "skipped" };
      const result = await new Resend(apiKey).emails.send(
        { from, to, subject: message.subject, text: message.text, html: message.html },
        { idempotencyKey }
      );
      const providerMessageId = result.data?.id?.trim() ?? "";
      if (result.error || !providerMessageId) return { state: "failed" };
      return { state: "sent", providerMessageId };
    },
    record: (result, providerMessageId) => recordEmailAcquiredNotice({
      key,
      journeyId: claimJourneyId,
      subscriptionId: args.subscriptionId,
      result,
      providerMessageId,
    }),
  });
}

function qualifies(history: LoadedOutreach): boolean {
  return confirmedPreviousOutreach({
    emailSent: history.outreachUnreadable ? 0 : history.emailSent,
    inboundReplies: history.repliesUnreadable ? 0 : history.inboundReplies,
    sentOutboundReplies: history.repliesUnreadable ? 0 : history.sentOutboundReplies,
    acceptedOrDeliveredResources: history.resourcesUnreadable ? 0 : history.acceptedOrDeliveredResources,
  });
}

async function loadPersonByEmail(email: string): Promise<{ id: string; name: string | null; email: string } | null | "error"> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .select("id, first_name, last_name, email_normalized")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) return "error";
  const id = text(data?.id, 80);
  const stored = text(data?.email_normalized, 254);
  if (!id || !stored) return null;
  return { id, name: personName(data?.first_name, data?.last_name), email: stored };
}

async function loadSignedJourney(journeyId: string): Promise<{
  id: string;
  personId: string;
  name: string | null;
  email: string | null;
} | null | "error"> {
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .select("id, person_id, campaign_id")
    .eq("id", journeyId)
    .maybeSingle();
  const id = text(data?.id, 80);
  const personId = text(data?.person_id, 80);
  const campaignId = text(data?.campaign_id, 80);
  if (error || !id || !personId || !campaignId) return error ? "error" : null;
  const person = await supabaseServer
    .from("acquisition_people")
    .select("first_name, last_name, email_normalized")
    .eq("id", personId)
    .maybeSingle();
  if (person.error) return "error";
  return {
    id,
    personId,
    name: personName(person.data?.first_name, person.data?.last_name),
    email: text(person.data?.email_normalized, 254),
  };
}

async function loadOutreach(args: {
  personId: string;
  acquisitionName: string | null;
  acquisitionEmail: string | null;
  journeyId: string | null;
  association: OutreachHistorySection["association"];
}): Promise<LoadedOutreach> {
  let events = supabaseServer
    .from("acquisition_events")
    .select("occurred_at, sender, metadata, campaign_id, journey_id")
    .eq("person_id", args.personId)
    .eq("event_type", "email_sent");
  let messages = supabaseServer
    .from("acquisition_messages")
    .select("direction, body_text, occurred_at, subject, sender_account, ai_outcome, processing_status, journey_id, campaign_id")
    .eq("person_id", args.personId);
  let actions = supabaseServer
    .from("acquisition_actions")
    .select("action_type, status, promised_label, scheduled_at, updated_at, delivered_at, journey_id")
    .eq("person_id", args.personId)
    .in("action_type", ["send_asset", "send_video", "send_video_reminder", "send_video_reminder_final", "send_trial_followup"]);
  let journeys = supabaseServer
    .from("acquisition_journeys")
    .select("id, campaign_id")
    .eq("person_id", args.personId);
  if (args.journeyId) {
    events = events.eq("journey_id", args.journeyId);
    messages = messages.eq("journey_id", args.journeyId);
    actions = actions.eq("journey_id", args.journeyId);
    journeys = journeys.eq("id", args.journeyId);
  }
  const [eventResult, messageResult, actionResult, journeyResult] = await Promise.all([
    events.order("occurred_at", { ascending: true }).limit(40),
    messages.order("occurred_at", { ascending: true }).limit(40),
    actions.order("scheduled_at", { ascending: true }).limit(20),
    journeys.limit(20),
  ]);

  const rows: HistoryRow[] = [];
  let emailSent = 0;
  if (!eventResult.error) {
    for (const row of eventResult.data ?? []) {
      emailSent += 1;
      const at = text(row.occurred_at, 40);
      if (!at) continue;
      rows.push({
        at,
        journeyId: text(row.journey_id, 80),
        campaignId: text(row.campaign_id, 80),
        entry: {
          at,
          kind: "instantly_outreach",
          sender: text(row.sender, 254) ?? "Instantly mailbox not stored",
          subject: null,
          body: null,
          detail: stepDetail(row.metadata),
        },
      });
    }
  }
  let inboundReplies = 0;
  let sentOutboundReplies = 0;
  if (!messageResult.error) {
    for (const row of messageResult.data ?? []) {
      if (row.direction === "inbound") inboundReplies += 1;
      if (row.direction === "outbound" && row.processing_status === "sent") sentOutboundReplies += 1;
      const at = text(row.occurred_at, 40);
      if (!at || (row.direction !== "inbound" && row.direction !== "outbound")) continue;
      const sent = row.processing_status === "sent";
      rows.push({
        at,
        journeyId: text(row.journey_id, 80),
        campaignId: text(row.campaign_id, 80),
        entry: {
          at,
          kind: row.direction === "inbound" ? "inbound_reply" : sent ? "ai_reply" : "ai_draft",
          sender: row.direction === "inbound"
            ? "Prospect"
            : text(row.sender_account, 254) ?? "Instantly mailbox not stored",
          subject: text(row.subject, 300),
          body: text(row.body_text, 20000),
          detail: text(row.ai_outcome, 40) ? `Stored AI outcome: ${text(row.ai_outcome, 40)}.` : null,
        },
      });
    }
  }
  let acceptedOrDeliveredResources = 0;
  if (!actionResult.error) {
    for (const row of actionResult.data ?? []) {
      const status = text(row.status, 40);
      const deliveredAt = text(row.delivered_at, 40);
      if (resendResourceCountsAsSent(status, deliveredAt)) acceptedOrDeliveredResources += 1;
      const at = text(row.scheduled_at, 40) ?? text(row.updated_at, 40);
      if (!at || (row.action_type !== "send_asset" && row.action_type !== "send_video" && row.action_type !== "send_video_reminder" && row.action_type !== "send_video_reminder_final" && row.action_type !== "send_trial_followup")) continue;
      rows.push({
        at,
        journeyId: text(row.journey_id, 80),
        campaignId: null,
        entry: {
          at,
          kind: "resend_resource",
          sender: "Resend",
          subject: null,
          body: null,
          detail: describeResendResource({
            status,
            resource: text(row.promised_label, 120),
            deliveredAt,
          }),
        },
      });
    }
  }
  const kindOrder: Record<RecordedConversationEntry["kind"], number> = {
    instantly_outreach: 0,
    inbound_reply: 1,
    ai_reply: 2,
    ai_draft: 3,
    resend_resource: 4,
  };
  rows.sort((a, b) => a.at.localeCompare(b.at) || kindOrder[a.entry.kind] - kindOrder[b.entry.kind]);

  const journeyRows = journeyResult.error
    ? []
    : (journeyResult.data ?? []).flatMap((row) => {
      const id = text(row.id, 80);
      return id ? [{ id, campaignId: text(row.campaign_id, 80) }] : [];
    });
  const names = await campaignNames(journeyRows.map((journey) => journey.id));
  return {
    personId: args.personId,
    acquisitionName: args.acquisitionName,
    acquisitionEmail: args.acquisitionEmail,
    section: {
      association: args.association,
      acquisitionName: args.acquisitionName,
      acquisitionEmail: args.acquisitionEmail,
      campaigns: groupHistoryByJourney(
        journeyRows.map((journey) => ({
          id: journey.id,
          campaignId: journey.campaignId,
          name: names.names.get(journey.id) ?? null,
        })),
        rows,
      ),
    },
    emailSent,
    inboundReplies,
    sentOutboundReplies,
    acceptedOrDeliveredResources,
    outreachUnreadable: Boolean(eventResult.error),
    repliesUnreadable: Boolean(messageResult.error),
    resourcesUnreadable: Boolean(actionResult.error),
    truncated:
      (eventResult.data?.length ?? 0) >= 40 ||
      (messageResult.data?.length ?? 0) >= 40 ||
      (actionResult.data?.length ?? 0) >= 20 ||
      (journeyResult.data?.length ?? 0) >= 20,
  };
}

function personName(first: unknown, last: unknown): string | null {
  return [text(first, 80), text(last, 80)].filter(Boolean).join(" ") || null;
}

async function campaignNames(journeyIds: string[]): Promise<{ names: Map<string, string> }> {
  const names = new Map<string, string>();
  if (journeyIds.length === 0) return { names };
  const pins = await supabaseServer
    .from("acquisition_journey_playbook_pins")
    .select("journey_id, playbook_id")
    .in("journey_id", journeyIds);
  if (pins.error) return { names };
  const playbookIds = [...new Set((pins.data ?? []).flatMap((row) => {
    const id = text(row.playbook_id, 80);
    return id ? [id] : [];
  }))];
  if (playbookIds.length === 0) return { names };
  const playbooks = await supabaseServer
    .from("acquisition_campaign_playbooks")
    .select("id, name")
    .in("id", playbookIds);
  if (playbooks.error) return { names };
  const byPlaybook = new Map<string, string>();
  for (const row of playbooks.data ?? []) {
    const id = text(row.id, 80);
    const name = text(row.name, 80);
    if (id && name) byPlaybook.set(id, name);
  }
  for (const row of pins.data ?? []) {
    const journeyId = text(row.journey_id, 80);
    const playbookId = text(row.playbook_id, 80);
    const name = playbookId ? byPlaybook.get(playbookId) : undefined;
    if (journeyId && name) names.set(journeyId, name);
  }
  return { names };
}

function noticeMetadata(args: {
  journeyId: string | null;
  subscriptionId: string;
  state: "claim" | "failed" | "accepted";
  claimUntil: string | null;
  resendId: string | null;
}) {
  return {
    journey_id: args.journeyId,
    subscription_id: args.subscriptionId,
    state: args.state,
    claim_until: args.claimUntil,
    resend_id: args.resendId,
  };
}

function claimRow(metadata: unknown): NoticeClaimRow {
  const row = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const until = typeof row.claim_until === "string" ? Date.parse(row.claim_until) : NaN;
  return {
    state: typeof row.state === "string" ? row.state : null,
    claimUntilMs: Number.isFinite(until) ? until : null,
    resendId: typeof row.resend_id === "string" && row.resend_id.trim() ? row.resend_id.trim() : null,
  };
}

async function readNotice(key: string): Promise<NoticeClaimRow | null | "error"> {
  const { data, error } = await supabaseServer
    .from("acquisition_events")
    .select("metadata")
    .eq("provider", "system")
    .eq("provider_event_id", key)
    .maybeSingle();
  if (error) return "error";
  if (!data) return null;
  return claimRow(data.metadata);
}

async function claimEmailAcquiredNotice(args: {
  key: string | null;
  personId: string;
  campaignId: string | null;
  journeyId: string | null;
  subscriptionId: string;
}): Promise<"send" | "skip" | "fail"> {
  if (!args.key) return "fail";
  const now = Date.now();
  const claimUntil = new Date(now + ACQUISITION_CLAIM_MS).toISOString();
  const metadata = noticeMetadata({
    journeyId: args.journeyId,
    subscriptionId: args.subscriptionId,
    state: "claim",
    claimUntil,
    resendId: null,
  });
  const inserted = await supabaseServer.from("acquisition_events").insert({
    person_id: args.personId,
    provider: "system",
    provider_event_id: args.key,
    event_type: "email_campaign_member_notified",
    occurred_at: new Date(now).toISOString(),
    campaign_id: args.campaignId,
    metadata,
  });
  if (!inserted.error) return "send";
  if ((inserted.error as { code?: string }).code !== "23505") return "fail";
  const existing = await readNotice(args.key);
  if (existing === "error" || !existing) return "fail";
  const decision = decideNoticeClaim(existing, now);
  if (decision === "skip") return "skip";
  if (decision !== "takeover") return "fail";
  const observedUntil = existing.claimUntilMs == null ? null : new Date(existing.claimUntilMs).toISOString();
  let removal = supabaseServer
    .from("acquisition_events")
    .delete()
    .eq("provider", "system")
    .eq("provider_event_id", args.key)
    .eq("metadata->>state", existing.state ?? "");
  if (observedUntil) removal = removal.eq("metadata->>claim_until", observedUntil);
  const removed = await removal.select("id");
  if (removed.error || !removed.data?.length) {
    const again = await readNotice(args.key);
    if (again === "error" || !again) return "fail";
    return decideNoticeClaim(again, Date.now()) === "skip" ? "skip" : "fail";
  }
  const retry = await supabaseServer.from("acquisition_events").insert({
    person_id: args.personId,
    provider: "system",
    provider_event_id: args.key,
    event_type: "email_campaign_member_notified",
    occurred_at: new Date().toISOString(),
    campaign_id: args.campaignId,
    metadata,
  });
  if (!retry.error) return "send";
  if ((retry.error as { code?: string }).code !== "23505") return "fail";
  const raced = await readNotice(args.key);
  if (raced === "error" || !raced) return "fail";
  return decideNoticeClaim(raced, Date.now()) === "skip" ? "skip" : "fail";
}

async function recordEmailAcquiredNotice(args: {
  key: string | null;
  journeyId: string | null;
  subscriptionId: string;
  result: "accepted" | "failed";
  providerMessageId: string | null;
}): Promise<void> {
  if (!args.key) return;
  const accepted = args.result === "accepted" && args.providerMessageId;
  await supabaseServer
    .from("acquisition_events")
    .update({
      metadata: noticeMetadata({
        journeyId: args.journeyId,
        subscriptionId: args.subscriptionId,
        state: accepted ? "accepted" : "failed",
        claimUntil: null,
        resendId: accepted ? args.providerMessageId : null,
      }),
    })
    .eq("provider", "system")
    .eq("provider_event_id", args.key)
    .eq("metadata->>state", "claim");
}

