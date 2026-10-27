/**
 * Cold-email command center.
 * People, events, and actions stay in separate counts.
 * A missing measurement stays null. It is not shown as zero.
 */

import { SUBSCRIBER_GROWTH_TZ } from "@/lib/admin-subscriber-growth-pure";
import type {
  InstantlyAccount,
  InstantlyAccountDaily,
  InstantlyCampaignAnalytics,
  InstantlyCampaignProfile,
  InstantlyCampaignStatusFilter,
  InstantlyDailyPoint,
  InstantlyOverview,
  InstantlyStepPoint,
} from "@/lib/acquisition/instantly-analytics";
import { getDateKeyInTimezone } from "@/lib/timezone";

export type Trust = "TRUSTWORTHY" | "PARTIAL" | "NOT YET TRUSTWORTHY" | "UNAVAILABLE";

export type LedgerEvent = {
  personId: string | null;
  provider: string;
  providerEventId: string | null;
  eventType: string;
  occurredAt: string;
  campaignId: string | null;
  sender: string | null;
  rawInstantlyType: string | null;
  step: number | null;
};

export type LedgerPerson = {
  id: string;
  lifecycle: string;
  sourceCampaign: string | null;
  sport: string | null;
  role: string | null;
  geography: string | null;
  offerKey: string | null;
};

export type LedgerAction = {
  personId: string;
  campaignId: string | null;
  actionType: string;
  status: string;
  attemptCount: number;
  delivered: boolean;
  claimed: boolean;
};

export type LedgerMessage = {
  direction: string;
  processingStatus: string;
  aiOutcome: string | null;
  campaignId: string | null;
  occurredAt: string;
};

export type InstantlyRead = {
  credential: "missing" | "present";
  analytics: InstantlyCampaignAnalytics[] | null;
  analyticsError: string | null;
  overview: InstantlyOverview | null;
  overviewError: string | null;
  daily: InstantlyDailyPoint[] | null;
  dailyError: string | null;
  steps: InstantlyStepPoint[] | null;
  stepsError: string | null;
  selectedSteps: InstantlyStepPoint[] | null;
  selectedDaily: InstantlyDailyPoint[] | null;
  selectedError: string | null;
  profiles: InstantlyCampaignProfile[] | null;
  profilesTruncated: boolean;
  profilesError: string | null;
  accounts: InstantlyAccount[] | null;
  accountsTruncated: boolean;
  accountsError: string | null;
  accountDaily: InstantlyAccountDaily[] | null;
  accountDailyError: string | null;
};

export type AgeState = "ready" | "immature" | "unknown_start";

export type AgeSlice = {
  state: AgeState;
  contacted: number | null;
  sends: number | null;
  replyPeople: number | null;
  note: string;
};

export type StepSlice = {
  step: string;
  sends: number;
  people: number;
  replyPeople: number;
};

export type CampaignView = {
  id: string;
  name: string | null;
  statusLabel: string;
  statusFilter: InstantlyCampaignStatusFilter | "unknown";
  peopleStored: number;
  webhookContacted: number | null;
  webhookSends: number | null;
  webhookReplyPeople: number | null;
  webhookReplyEvents: number | null;
  interestedWebhookPeople: number | null;
  sequenceFinishedEvents: number | null;
  unknownWebhookEvents: number | null;
  instantlyLeads: number | null;
  instantlyContacted: number | null;
  instantlySent: number | null;
  instantlyUniqueReplies: number | null;
  instantlyBouncedLeads: number | null;
  instantlyUnsubscribed: number | null;
  instantlyCompletedLeads: number | null;
  instantlyOpportunities: number | null;
  scheduledAssets: number | null;
  acceptedAssets: number | null;
  deliveredAssets: number | null;
  firstRecordedSend: string | null;
  instantlyCreated: string | null;
  startSource: "instantly_created" | "first_recorded_send" | "unknown";
  openTracking: boolean | null;
  linkTracking: boolean | null;
  offerStored: false;
  steps: StepSlice[];
  mailboxes: Array<{ email: string; sends: number }>;
  age: Record<"7" | "14" | "30", AgeSlice>;
  completionNote: string;
};

export type MailboxView = {
  email: string;
  domain: string;
  accountId: string | null;
  statusCode: number | null;
  ledgerSends: number;
  campaignIds: string[];
  instantlySent: number | null;
  instantlyBounced: number | null;
  instantlyUniqueReplies: number | null;
};

export type DistributionCommandReport = {
  readable: boolean;
  truncated: boolean;
  note: string;
  rangeLabel: string;
  peopleStored: number | null;
  peopleWithWebhookSend: number | null;
  peopleWithSnapshotOnly: number | null;
  webhookSends: number | null;
  webhookReplyPeople: number | null;
  webhookReplyEvents: number | null;
  interestedWebhookPeople: number | null;
  sequenceFinishedEvents: number | null;
  unknownWebhookEvents: number | null;
  videoEvents: number | null;
  unknownWebhookTypes: Array<{ type: string; events: number }>;
  suppressedPeople: number | null;
  sportFilled: number | null;
  roleFilled: number | null;
  geographyFilled: number | null;
  geographyDistinct: number | null;
  offerFilled: number | null;
  journeysOpen: number | null;
  journeysClosed: number | null;
  peopleWithoutJourney: number | null;
  fulfillment: Record<string, number> | null;
  messages: {
    inbound: number | null;
    interpreted: number | null;
    stored: number | null;
    outboundSent: number | null;
    outcomes: Array<{ outcome: string; count: number }>;
  };
  ledgerDaily: Array<{ date: string; sends: number }>;
  instantly: InstantlyRead;
  campaigns: CampaignView[];
  mailboxes: MailboxView[];
  domains: Array<{ domain: string; mailboxes: number; ledgerSends: number }>;
  attention: string[];
  nextDecision: string;
  gaps: string[];
};

const SEQUENCE_FINISHED = "campaign_completed_for_lead_without_reply";
const DAY_MS = 86_400_000;

export function emptyInstantlyRead(credential: "missing" | "present", error: string | null = null): InstantlyRead {
  return {
    credential,
    analytics: null,
    analyticsError: error,
    overview: null,
    overviewError: error,
    daily: null,
    dailyError: error,
    steps: null,
    stepsError: error,
    selectedSteps: null,
    selectedDaily: null,
    selectedError: error,
    profiles: null,
    profilesTruncated: false,
    profilesError: error,
    accounts: null,
    accountsTruncated: false,
    accountsError: error,
    accountDaily: null,
    accountDailyError: error,
  };
}

export function unreadableDistributionCommand(note: string, rangeLabel: string): DistributionCommandReport {
  const instantly = emptyInstantlyRead("missing", "not_read");
  return {
    readable: false,
    truncated: false,
    note,
    rangeLabel,
    peopleStored: null,
    peopleWithWebhookSend: null,
    peopleWithSnapshotOnly: null,
    webhookSends: null,
    webhookReplyPeople: null,
    webhookReplyEvents: null,
    interestedWebhookPeople: null,
    sequenceFinishedEvents: null,
    unknownWebhookEvents: null,
    videoEvents: null,
    unknownWebhookTypes: [],
    suppressedPeople: null,
    sportFilled: null,
    roleFilled: null,
    geographyFilled: null,
    geographyDistinct: null,
    offerFilled: null,
    journeysOpen: null,
    journeysClosed: null,
    peopleWithoutJourney: null,
    fulfillment: null,
    messages: { inbound: null, interpreted: null, stored: null, outboundSent: null, outcomes: [] },
    ledgerDaily: [],
    instantly,
    campaigns: [],
    mailboxes: [],
    domains: [],
    attention: [note],
    nextDecision: "No next-experiment decision. The cold-email ledger could not be read.",
    gaps: [note],
  };
}

function inRange(iso: string, startMs: number | null, endMs: number): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  if (startMs != null && ms < startMs) return false;
  return ms < endMs;
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "Unknown domain";
  return email.slice(at + 1);
}

function dedupeKey(event: LedgerEvent): string | null {
  if (!event.providerEventId) return null;
  return `${event.provider}:${event.providerEventId}`;
}

function classify(event: LedgerEvent): "send" | "reply" | "interested" | "sequence_finished" | "unknown" | "other" {
  if (event.provider !== "instantly") return "other";
  if (event.eventType === "email_sent") return "send";
  if (event.eventType === "reply_received") return "reply";
  if (event.eventType === "lead_interested") return "interested";
  if (event.eventType === "unrecognized" && event.rawInstantlyType === SEQUENCE_FINISHED) return "sequence_finished";
  if (event.eventType === "unrecognized") return "unknown";
  return "other";
}

type MutableCampaign = CampaignView & {
  sendPeople: Set<string>;
  replyPeople: Set<string>;
  interestPeople: Set<string>;
  observedPeople: Set<string>;
  mailboxSends: Map<string, number>;
  stepSends: Map<string, { events: number; people: Set<string>; replyPeople: Set<string> }>;
  sendsForAge: Array<{ at: number; personId: string | null; step: number | null }>;
  repliesForAge: Array<{ at: number; personId: string | null }>;
};

function blankCampaign(id: string): MutableCampaign {
  const unknownAge = (days: 7 | 14 | 30): AgeSlice => ({
    state: "unknown_start",
    contacted: null,
    sends: null,
    replyPeople: null,
    note: `No start time is stored, so the first ${days} days cannot be compared.`,
  });
  return {
    id,
    name: null,
    statusLabel: "Unknown",
    statusFilter: "unknown",
    peopleStored: 0,
    webhookContacted: 0,
    webhookSends: 0,
    webhookReplyPeople: 0,
    webhookReplyEvents: 0,
    interestedWebhookPeople: 0,
    sequenceFinishedEvents: 0,
    unknownWebhookEvents: 0,
    instantlyLeads: null,
    instantlyContacted: null,
    instantlySent: null,
    instantlyUniqueReplies: null,
    instantlyBouncedLeads: null,
    instantlyUnsubscribed: null,
    instantlyCompletedLeads: null,
    instantlyOpportunities: null,
    scheduledAssets: null,
    acceptedAssets: null,
    deliveredAssets: null,
    firstRecordedSend: null,
    instantlyCreated: null,
    startSource: "unknown",
    openTracking: null,
    linkTracking: null,
    offerStored: false,
    steps: [],
    mailboxes: [],
    age: { "7": unknownAge(7), "14": unknownAge(14), "30": unknownAge(30) },
    completionNote: "Completion is unknown. A pause or an old start date is not a finished experiment.",
    sendPeople: new Set(),
    replyPeople: new Set(),
    interestPeople: new Set(),
    observedPeople: new Set(),
    mailboxSends: new Map(),
    stepSends: new Map(),
    sendsForAge: [],
    repliesForAge: [],
  };
}

function ageSlice(campaign: MutableCampaign, days: 7 | 14 | 30, nowMs: number): AgeSlice {
  const startIso = campaign.instantlyCreated ?? campaign.firstRecordedSend;
  if (!startIso) {
    return campaign.age[String(days) as "7"];
  }
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) {
    return {
      state: "unknown_start",
      contacted: null,
      sends: null,
      replyPeople: null,
      note: "The stored start time could not be read.",
    };
  }
  const endMs = startMs + days * DAY_MS;
  if (nowMs < endMs) {
    return {
      state: "immature",
      contacted: null,
      sends: null,
      replyPeople: null,
      note: `This campaign has not reached ${days} days. It is left out of this age comparison.`,
    };
  }
  const people = new Set<string>();
  let sends = 0;
  for (const send of campaign.sendsForAge) {
    if (send.at < startMs || send.at >= endMs) continue;
    sends += 1;
    if (send.personId) people.add(send.personId);
  }
  const replies = new Set<string>();
  for (const reply of campaign.repliesForAge) {
    if (reply.at < startMs || reply.at >= endMs || !reply.personId) continue;
    replies.add(reply.personId);
  }
  const source = campaign.startSource === "instantly_created"
    ? "Instantly's created time"
    : "the first recorded send webhook";
  return {
    state: "ready",
    contacted: people.size,
    sends,
    replyPeople: replies.size,
    note: `First ${days} days from ${source}. Webhook coverage before that start is still incomplete. Not a winner.`,
  };
}

export function showCount(value: number | null, noun: string): string {
  if (value == null) return "Unavailable";
  if (!noun) return String(value);
  const singular: Record<string, string> = {
    people: "person",
    events: "event",
    messages: "message",
    actions: "action",
    leads: "lead",
  };
  const label = value === 1 && singular[noun] ? singular[noun] : noun;
  return `${value} ${label}`;
}

export function sortCampaigns(
  campaigns: readonly CampaignView[],
  args: {
    sort: "name" | "webhook_sends" | "webhook_replies" | "instantly_contacted";
    view: "calendar" | "age";
    age: "7" | "14" | "30";
  },
): CampaignView[] {
  const name = (campaign: CampaignView) => campaign.name ?? campaign.id;
  const byName = (a: CampaignView, b: CampaignView) => name(a).localeCompare(name(b));
  if (args.sort === "name" || (args.view === "age" && args.sort === "instantly_contacted")) {
    return [...campaigns].sort(byName);
  }
  const metric = (campaign: CampaignView): number | null => {
    if (args.view === "age") {
      const slice = campaign.age[args.age];
      if (slice.state !== "ready") return null;
      return args.sort === "webhook_sends" ? slice.sends : slice.replyPeople;
    }
    if (args.sort === "webhook_sends") return campaign.webhookSends;
    if (args.sort === "webhook_replies") return campaign.webhookReplyPeople;
    return campaign.instantlyContacted;
  };
  return [...campaigns].sort((a, b) => {
    const left = metric(a);
    const right = metric(b);
    if (left == null && right == null) return byName(a, b);
    if (left == null) return 1;
    if (right == null) return -1;
    return right - left || byName(a, b);
  });
}

export function showRate(numerator: number | null, denominator: number | null): string | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

export function buildDistributionCommand(args: {
  readable: boolean;
  truncated: boolean;
  rangeLabel: string;
  startMs: number | null;
  endMs: number;
  nowMs: number;
  people: LedgerPerson[];
  events: LedgerEvent[];
  actions: LedgerAction[] | null;
  messages: LedgerMessage[] | null;
  openJourneys: number | null;
  closedJourneys: number | null;
  peopleWithJourney: number | null;
  instantly: InstantlyRead;
}): DistributionCommandReport {
  if (!args.readable || args.truncated) {
    const note = args.truncated
      ? "The cold-email read hit its row cap. Totals are withheld because they would be incomplete."
      : "The cold-email ledger could not be read. Do not treat that as zero.";
    return unreadableDistributionCommand(note, args.rangeLabel);
  }

  const seen = new Set<string>();
  const campaigns = new Map<string, MutableCampaign>();
  const ensure = (id: string) => {
    const existing = campaigns.get(id);
    if (existing) return existing;
    const created = blankCampaign(id);
    campaigns.set(id, created);
    return created;
  };

  for (const person of args.people) {
    if (person.sourceCampaign) ensure(person.sourceCampaign).peopleStored += 1;
  }

  let webhookSends = 0;
  let webhookReplyEvents = 0;
  let sequenceFinishedEvents = 0;
  let unknownWebhookEvents = 0;
  let videoEvents = 0;
  const unknownTypes = new Map<string, number>();
  const sendPeople = new Set<string>();
  const observedPeople = new Set<string>();
  const replyPeople = new Set<string>();
  const interestPeople = new Set<string>();
  const daily = new Map<string, number>();
  const mailboxCampaigns = new Map<string, { sends: number; campaigns: Set<string> }>();

  for (const event of args.events) {
    const key = dedupeKey(event);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const kind = classify(event);
    if (!inRange(event.occurredAt, args.startMs, args.endMs)) {
      if (event.campaignId && kind === "send") {
        const campaign = ensure(event.campaignId);
        const at = Date.parse(event.occurredAt);
        if (Number.isFinite(at)) {
          campaign.sendsForAge.push({ at, personId: event.personId, step: event.step });
          if (!campaign.firstRecordedSend || event.occurredAt < campaign.firstRecordedSend) {
            campaign.firstRecordedSend = event.occurredAt;
          }
        }
      }
      if (event.campaignId && kind === "reply") {
        const at = Date.parse(event.occurredAt);
        if (Number.isFinite(at)) ensure(event.campaignId).repliesForAge.push({ at, personId: event.personId });
      }
      continue;
    }
    if (event.provider === "personal_video") videoEvents += 1;
    if (kind === "unknown") {
      unknownWebhookEvents += 1;
      const type = event.rawInstantlyType || "unrecognized";
      unknownTypes.set(type, (unknownTypes.get(type) || 0) + 1);
    }
    if (event.personId && event.eventType === "instantly_lead_observed") observedPeople.add(event.personId);
    if (kind === "send") {
      webhookSends += 1;
      if (event.personId) sendPeople.add(event.personId);
    } else if (kind === "reply") {
      webhookReplyEvents += 1;
      if (event.personId) replyPeople.add(event.personId);
    } else if (kind === "interested" && event.personId) {
      interestPeople.add(event.personId);
    } else if (kind === "sequence_finished") {
      sequenceFinishedEvents += 1;
    }
    if (!event.campaignId) continue;
    const campaign = ensure(event.campaignId);
    if (kind === "send") {
      if (event.personId) campaign.sendPeople.add(event.personId);
      campaign.webhookSends = (campaign.webhookSends ?? 0) + 1;
        const at = Date.parse(event.occurredAt);
        if (Number.isFinite(at)) campaign.sendsForAge.push({ at, personId: event.personId, step: event.step });
        if (!campaign.firstRecordedSend || event.occurredAt < campaign.firstRecordedSend) {
          campaign.firstRecordedSend = event.occurredAt;
        }
        const day = getDateKeyInTimezone(new Date(event.occurredAt), SUBSCRIBER_GROWTH_TZ);
        daily.set(day, (daily.get(day) || 0) + 1);
        const stepKey = event.step == null ? "Not recorded" : String(event.step);
        const step = campaign.stepSends.get(stepKey) ?? { events: 0, people: new Set<string>(), replyPeople: new Set<string>() };
        step.events += 1;
        if (event.personId) step.people.add(event.personId);
        campaign.stepSends.set(stepKey, step);
        const sender = event.sender?.trim().toLowerCase() || null;
        if (sender) {
          campaign.mailboxSends.set(sender, (campaign.mailboxSends.get(sender) || 0) + 1);
          const box = mailboxCampaigns.get(sender) ?? { sends: 0, campaigns: new Set<string>() };
          box.sends += 1;
          if (event.campaignId) box.campaigns.add(event.campaignId);
          mailboxCampaigns.set(sender, box);
        }
    } else if (kind === "reply") {
      campaign.webhookReplyEvents = (campaign.webhookReplyEvents ?? 0) + 1;
      if (event.personId) {
        campaign.replyPeople.add(event.personId);
        if (event.step != null) {
          const step = campaign.stepSends.get(String(event.step));
          if (step) step.replyPeople.add(event.personId);
        }
      }
      const at = Date.parse(event.occurredAt);
      if (Number.isFinite(at)) campaign.repliesForAge.push({ at, personId: event.personId });
    } else if (kind === "interested" && event.personId) {
      campaign.interestPeople.add(event.personId);
    } else if (kind === "sequence_finished") {
      campaign.sequenceFinishedEvents = (campaign.sequenceFinishedEvents ?? 0) + 1;
    } else if (kind === "unknown") {
      campaign.unknownWebhookEvents = (campaign.unknownWebhookEvents ?? 0) + 1;
    }
  }

  let snapshotOnly = 0;
  for (const personId of observedPeople) {
    if (!sendPeople.has(personId)) snapshotOnly += 1;
  }

  const fulfillment: Record<string, number> | null = args.actions == null ? null : {};
  if (args.actions) {
    for (const action of args.actions) {
      const key = `${action.actionType}:${action.status}`;
      fulfillment![key] = (fulfillment![key] || 0) + 1;
      if (!action.campaignId || action.actionType !== "send_asset") continue;
      const campaign = ensure(action.campaignId);
      campaign.scheduledAssets ??= 0;
      campaign.acceptedAssets ??= 0;
      campaign.deliveredAssets ??= 0;
      if (action.status === "scheduled") campaign.scheduledAssets += 1;
      if (action.status === "accepted" || action.status === "delivered") campaign.acceptedAssets += 1;
      if (action.delivered) campaign.deliveredAssets += 1;
    }
  }

  const outcomeCounts = new Map<string, number>();
  let inbound: number | null = args.messages == null ? null : 0;
  let interpreted: number | null = args.messages == null ? null : 0;
  let stored: number | null = args.messages == null ? null : 0;
  let outboundSent: number | null = args.messages == null ? null : 0;
  for (const message of args.messages ?? []) {
    if (!inRange(message.occurredAt, args.startMs, args.endMs)) continue;
    if (message.direction === "inbound") {
      inbound = (inbound ?? 0) + 1;
      if (message.processingStatus === "interpreted") interpreted = (interpreted ?? 0) + 1;
      if (message.processingStatus === "stored") stored = (stored ?? 0) + 1;
      if (message.aiOutcome) outcomeCounts.set(message.aiOutcome, (outcomeCounts.get(message.aiOutcome) || 0) + 1);
    }
    if (message.direction === "outbound" && message.processingStatus === "sent") outboundSent = (outboundSent ?? 0) + 1;
  }

  if (args.instantly.analytics) {
    for (const row of args.instantly.analytics) ensure(row.campaignId);
  }
  if (args.instantly.profiles) {
    for (const row of args.instantly.profiles) ensure(row.id);
  }

  const profileById = new Map((args.instantly.profiles ?? []).map((row) => [row.id, row]));
  const analyticsById = new Map((args.instantly.analytics ?? []).map((row) => [row.campaignId, row]));

  for (const campaign of campaigns.values()) {
    if (args.actions) {
      campaign.scheduledAssets ??= 0;
      campaign.acceptedAssets ??= 0;
      campaign.deliveredAssets ??= 0;
    }
    const profile = profileById.get(campaign.id);
    const analytics = analyticsById.get(campaign.id);
    if (analytics?.campaignName) campaign.name = analytics.campaignName;
    else if (profile?.name) campaign.name = profile.name;
    if (analytics) {
      campaign.statusLabel = analytics.statusLabel;
      campaign.statusFilter = analytics.statusFilter;
      campaign.instantlyLeads = analytics.leadsCount;
      campaign.instantlyContacted = analytics.contactedCount;
      campaign.instantlySent = analytics.emailsSentCount;
      campaign.instantlyUniqueReplies = analytics.replyCountUnique;
      campaign.instantlyBouncedLeads = analytics.bouncedCount;
      campaign.instantlyUnsubscribed = analytics.unsubscribedCount;
      campaign.instantlyCompletedLeads = analytics.completedCount;
      campaign.instantlyOpportunities = analytics.totalOpportunities;
    } else if (profile) {
      campaign.statusLabel = profile.statusLabel;
      campaign.statusFilter = profile.statusFilter;
    }
    if (profile?.createdAt) {
      campaign.instantlyCreated = profile.createdAt;
      campaign.startSource = "instantly_created";
    } else if (campaign.firstRecordedSend) {
      campaign.startSource = "first_recorded_send";
    }
    campaign.openTracking = profile?.openTracking ?? null;
    campaign.linkTracking = profile?.linkTracking ?? null;
    campaign.webhookContacted = campaign.sendPeople.size;
    campaign.webhookReplyPeople = campaign.replyPeople.size;
    campaign.interestedWebhookPeople = campaign.interestPeople.size;
    campaign.steps = [...campaign.stepSends.entries()]
      .map(([step, value]) => ({
        step,
        sends: value.events,
        people: value.people.size,
        replyPeople: value.replyPeople.size,
      }))
      .sort((a, b) => a.step.localeCompare(b.step));
    campaign.mailboxes = [...campaign.mailboxSends.entries()]
      .map(([email, sends]) => ({ email, sends }))
      .sort((a, b) => b.sends - a.sends || a.email.localeCompare(b.email));
    campaign.age = {
      "7": ageSlice(campaign, 7, args.nowMs),
      "14": ageSlice(campaign, 14, args.nowMs),
      "30": ageSlice(campaign, 30, args.nowMs),
    };
    campaign.completionNote = completionNote(campaign);
  }

  const accountByEmail = new Map((args.instantly.accounts ?? []).map((row) => [row.email, row]));
  const accountDailyByEmail = new Map<string, { sent: number; bounced: number; replies: number; complete: boolean }>();
  if (args.instantly.accountDaily) {
    for (const row of args.instantly.accountDaily) {
      const current = accountDailyByEmail.get(row.email) ?? { sent: 0, bounced: 0, replies: 0, complete: true };
      if (row.sent == null || row.bounced == null) current.complete = false;
      current.sent += row.sent ?? 0;
      current.bounced += row.bounced ?? 0;
      accountDailyByEmail.set(row.email, current);
    }
  }
  const emails = new Set<string>([...mailboxCampaigns.keys(), ...accountByEmail.keys()]);
  const mailboxes: MailboxView[] = [...emails].map((email) => {
    const ledger = mailboxCampaigns.get(email);
    const account = accountByEmail.get(email);
    const dailyTotals = accountDailyByEmail.get(email);
    const dailyKnown = dailyTotals?.complete === true;
    return {
      email,
      domain: domainOf(email),
      accountId: account?.id ?? null,
      statusCode: account?.statusCode ?? null,
      ledgerSends: ledger?.sends ?? 0,
      campaignIds: [...(ledger?.campaigns ?? [])].sort(),
      instantlySent: dailyKnown ? dailyTotals.sent : null,
      instantlyBounced: dailyKnown ? dailyTotals.bounced : null,
      instantlyUniqueReplies: null,
    };
  }).sort((a, b) => b.ledgerSends - a.ledgerSends || a.domain.localeCompare(b.domain) || a.email.localeCompare(b.email));

  const domainMap = new Map<string, { mailboxes: number; ledgerSends: number }>();
  for (const mailbox of mailboxes) {
    const domain = domainMap.get(mailbox.domain) ?? { mailboxes: 0, ledgerSends: 0 };
    domain.mailboxes += 1;
    domain.ledgerSends += mailbox.ledgerSends;
    domainMap.set(mailbox.domain, domain);
  }

  const reportCampaigns = [...campaigns.values()]
    .map((campaign) => {
      const { sendPeople: _s, replyPeople: _r, interestPeople: _i, observedPeople: _o, mailboxSends: _m, stepSends: _t, sendsForAge: _a, repliesForAge: _p, ...view } = campaign;
      return view;
    })
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  const suppressedPeople = args.people.filter((person) => person.lifecycle === "suppressed").length;
  const sportFilled = args.people.filter((person) => person.sport).length;
  const roleFilled = args.people.filter((person) => person.role).length;
  const geographyFilled = args.people.filter((person) => person.geography).length;
  const geographyDistinct = new Set(args.people.map((person) => person.geography).filter(Boolean)).size;
  const offerFilled = args.people.filter((person) => person.offerKey).length;

  const instantly = args.instantly;
  const attention = [
    "Inbox placement is unavailable. Missing complaints and a low bounce count do not mean the mail reached the inbox.",
    instantly.credential === "missing"
      ? "Instantly analytics is unavailable in this environment. Webhook counts are not Instantly's totals."
      : instantly.analyticsError
        ? "Instantly campaign analytics could not be read. Do not treat that as zero enrolled leads."
        : "Instantly campaign totals are Instantly's report for this calendar range. They are not merged with webhook counts.",
  ];
  const scheduled = fulfillment?.["send_asset:scheduled"] ?? null;
  if (scheduled == null) attention.push("Fulfillment actions could not be read. Do not treat that as zero scheduled PDFs.");
  else if (scheduled > 0) attention.push(`${scheduled} PDF${scheduled === 1 ? " is" : "s are"} still scheduled. Scheduled is not sent.`);
  if (unknownWebhookEvents > 0) {
    attention.push(`${unknownWebhookEvents} webhook events have no usable type. They are not replies, bounces, or completions.`);
  }
  attention.push("No campaign is ready for a next-experiment decision. Trial and revenue attribution is not measured.");

  const gaps = [
    "People stored are not Instantly's enrolled-lead count.",
    "Webhook sends start on 22 Oct 2026. Earlier sends can be missing.",
    "lead_interested is not a reply and is not a positive reply.",
    "Instantly opportunities and total_interested are Instantly's labels, not our positive-reply definition.",
    "Hard and soft bounces are not separated. Instantly's bounced_count is bounced leads.",
    "Cold-mail spam complaints are not in the analytics response we read. Estimated spam placement is unavailable.",
    "Open and click counts are withheld. Tracking flags are shown only so a missing open count is not read as zero.",
    "Role, sport, offer, list, and cold subject are not complete enough to compare.",
    "A filled geography value is not a verified recipient state.",
    "Trial, paid, and revenue are unavailable. A matching email address is not attribution.",
    "Instantly Completed is the sequence status. It is not this app's automation switch and it is not a finished experiment.",
    sequenceFinishedEvents > 0
      ? `${sequenceFinishedEvents} campaign_completed_for_lead_without_reply events are preserved as sequence evidence. They did not close a journey.`
      : "No preserved sequence-finished webhook is in this range.",
  ];

  return {
    readable: true,
    truncated: false,
    note: "Cold email is separate from the website funnel below. Date buttons filter webhook activity and the Instantly calendar request. The current PDF outbox and the people-stored count stay all-time.",
    rangeLabel: args.rangeLabel,
    peopleStored: args.people.length,
    peopleWithWebhookSend: sendPeople.size,
    peopleWithSnapshotOnly: snapshotOnly,
    webhookSends,
    webhookReplyPeople: replyPeople.size,
    webhookReplyEvents,
    interestedWebhookPeople: interestPeople.size,
    sequenceFinishedEvents,
    unknownWebhookEvents,
    videoEvents,
    unknownWebhookTypes: [...unknownTypes.entries()].map(([type, events]) => ({ type, events })).sort((a, b) => b.events - a.events),
    suppressedPeople,
    sportFilled,
    roleFilled,
    geographyFilled,
    geographyDistinct,
    offerFilled,
    journeysOpen: args.openJourneys,
    journeysClosed: args.closedJourneys,
    peopleWithoutJourney: args.peopleWithJourney == null ? null : Math.max(0, args.people.length - args.peopleWithJourney),
    fulfillment,
    messages: {
      inbound,
      interpreted,
      stored,
      outboundSent,
      outcomes: [...outcomeCounts.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    },
    ledgerDaily: [...daily.entries()].map(([date, sends]) => ({ date, sends })).sort((a, b) => a.date.localeCompare(b.date)),
    instantly,
    campaigns: reportCampaigns,
    mailboxes,
    domains: [...domainMap.entries()]
      .map(([domain, value]) => ({ domain, mailboxes: value.mailboxes, ledgerSends: value.ledgerSends }))
      .sort((a, b) => b.ledgerSends - a.ledgerSends || a.domain.localeCompare(b.domain)),
    attention,
    nextDecision: "No next campaign is selected. Sequence completion, outstanding replies, fulfillment, and trial attribution are not all known. Instantly's Completed status does not answer it.",
    gaps,
  };
}

function completionNote(campaign: CampaignView): string {
  const scheduled = campaign.scheduledAssets;
  if (scheduled == null) {
    return "Fulfillment for this campaign could not be read, so completion is unknown.";
  }
  const instantlyCompleted = campaign.statusFilter === "completed";
  const leadsDone = campaign.instantlyCompletedLeads;
  if (campaign.statusFilter === "paused") {
    return "Instantly status is Paused. Paused is not finished, and it is not this app's automation switch.";
  }
  if (instantlyCompleted && scheduled > 0) {
    return "Instantly status is Completed, and a PDF is still scheduled. Sequence status and fulfillment are different. This is not a finished experiment.";
  }
  if (instantlyCompleted) {
    return "Instantly status is Completed. That is not this app's automation switch, and trial attribution is still unmeasured, so the experiment is not finished.";
  }
  if (leadsDone != null && campaign.instantlyLeads != null && leadsDone < campaign.instantlyLeads) {
    return "Instantly still has leads that have not completed the sequence.";
  }
  if (campaign.sequenceFinishedEvents && campaign.sequenceFinishedEvents > 0) {
    return "Some leads have a preserved sequence-finished webhook. That does not finish the campaign or the experiment.";
  }
  return "Completion is unknown. A pause or an old start date is not a finished experiment.";
}
