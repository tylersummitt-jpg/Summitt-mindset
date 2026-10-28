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
  journeyId?: string | null;
  sender: string | null;
  rawInstantlyType: string | null;
  step: number | null;
  videoId?: string | null;
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
  personId: string | null;
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
  attributedTrials: number;
  attributedPaid: number;
  /** Trials and payments whose journey has a prepared video link. Earlier journeys stay in the totals above. */
  videoFirstTrials: number;
  videoFirstPaid: number;
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
  claimedAssets: number | null;
  acceptedAssets: number | null;
  deliveredAssets: number | null;
  resourceRequestPeople: number | null;
  videoScheduled: number | null;
  videoClaimed: number | null;
  videoAccepted: number | null;
  videoDelivered: number | null;
  firstReminderScheduled: number | null;
  firstReminderClaimed: number | null;
  firstReminderAccepted: number | null;
  firstReminderDelivered: number | null;
  finalReminderScheduled: number | null;
  finalReminderClaimed: number | null;
  finalReminderAccepted: number | null;
  finalReminderDelivered: number | null;
  remindersCanceled: number | null;
  /** Verified person, journey, and campaign. Null only when the ledger could not be read. */
  videoVisitPeople: number | null;
  videoPlayPeople: number | null;
  videoPlayerReadyPeople: number | null;
  videoWatched25People: number | null;
  videoWatched50People: number | null;
  videoWatched75People: number | null;
  videoWatched95People: number | null;
  videoCtaPeople: number | null;
  linksPrepared: number | null;
  videoIds: string[];
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

export type FunnelRates = {
  reply: string | null;
  resourceToDelivery: string | null;
  videoSentToPlay: string | null;
  playToCta: string | null;
  videoToTrial: null;
  trialToPaid: string | null;
  notes: {
    reply: string;
    resourceToDelivery: string;
    videoSentToPlay: string;
    playToCta: string;
    videoToTrial: string;
    trialToPaid: string;
  };
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
  videoVisitPeople: number | null;
  videoVisitEvents: number | null;
  videoPlayPeople: number | null;
  videoPlayEvents: number | null;
  videoCtaPeople: number | null;
  videoCtaEvents: number | null;
  videoPlayerReadyPeople: number | null;
  videoWatched25People: number | null;
  videoWatched50People: number | null;
  videoWatched75People: number | null;
  videoWatched95People: number | null;
  /** Video events with a person and no verified journey. Missing playback is not in this count. */
  unattributedVideoEvents: number | null;
  linksPrepared: number | null;
  /** Confirmed accept_offer messages. lead_interested is not included. */
  resourceRequestPeople: number | null;
  /** Always null. Cancellation does not store a reason. */
  remindersCanceledByPlay: null;
  rates: FunnelRates;
  attributedTrialPeople: number | null;
  attributedPaidPeople: number | null;
  emailOnlyTrialPeople: number | null;
  emailOnlyPaidPeople: number | null;
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
    videoVisitPeople: null,
    videoVisitEvents: null,
    videoPlayPeople: null,
    videoPlayEvents: null,
    videoCtaPeople: null,
    videoCtaEvents: null,
    videoPlayerReadyPeople: null,
    videoWatched25People: null,
    videoWatched50People: null,
    videoWatched75People: null,
    videoWatched95People: null,
    unattributedVideoEvents: null,
    linksPrepared: null,
    resourceRequestPeople: null,
    remindersCanceledByPlay: null,
    rates: emptyRates("The cold-email ledger could not be read."),
    attributedTrialPeople: null,
    attributedPaidPeople: null,
    emailOnlyTrialPeople: null,
    emailOnlyPaidPeople: null,
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
  trialPeople: Set<string>;
  paidPeople: Set<string>;
  videoFirstTrialPeople: Set<string>;
  videoFirstPaidPeople: Set<string>;
  requestPeople: Set<string>;
  mailboxSends: Map<string, number>;
  stepSends: Map<string, { events: number; people: Set<string>; replyPeople: Set<string> }>;
  sendsForAge: Array<{ at: number; personId: string | null; step: number | null }>;
  repliesForAge: Array<{ at: number; personId: string | null }>;
  videoIdSet: Set<string>;
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
    attributedTrials: 0,
    attributedPaid: 0,
    videoFirstTrials: 0,
    videoFirstPaid: 0,
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
    claimedAssets: null,
    acceptedAssets: null,
    deliveredAssets: null,
    resourceRequestPeople: null,
    videoScheduled: null,
    videoClaimed: null,
    videoAccepted: null,
    videoDelivered: null,
    firstReminderScheduled: null,
    firstReminderClaimed: null,
    firstReminderAccepted: null,
    firstReminderDelivered: null,
    finalReminderScheduled: null,
    finalReminderClaimed: null,
    finalReminderAccepted: null,
    finalReminderDelivered: null,
    remindersCanceled: null,
    videoVisitPeople: null,
    videoPlayPeople: null,
    videoPlayerReadyPeople: null,
    videoWatched25People: null,
    videoWatched50People: null,
    videoWatched75People: null,
    videoWatched95People: null,
    videoCtaPeople: null,
    linksPrepared: null,
    videoIds: [],
    videoIdSet: new Set<string>(),
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
    trialPeople: new Set(),
    paidPeople: new Set(),
    videoFirstTrialPeople: new Set(),
    videoFirstPaidPeople: new Set(),
    requestPeople: new Set(),
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

function emptyRates(reason: string): FunnelRates {
  return {
    reply: null,
    resourceToDelivery: null,
    videoSentToPlay: null,
    playToCta: null,
    videoToTrial: null,
    trialToPaid: null,
    notes: {
      reply: reason,
      resourceToDelivery: reason,
      videoSentToPlay: reason,
      playToCta: reason,
      videoToTrial: "A video play does not store the journey, so it is not divided into trials.",
      trialToPaid: reason,
    },
  };
}

export function actionCount(
  fulfillment: Record<string, number> | null,
  actionType: string,
  status: string,
): number | null {
  if (!fulfillment) return null;
  return fulfillment[`${actionType}:${status}`] ?? 0;
}

/** Provider-accepted plus confirmed delivered. Scheduled and claimed are not sends. */
export function sentActionCount(
  fulfillment: Record<string, number> | null,
  actionType: string,
): number | null {
  const accepted = actionCount(fulfillment, actionType, "accepted");
  const delivered = actionCount(fulfillment, actionType, "delivered");
  if (accepted == null || delivered == null) return null;
  return accepted + delivered;
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
    emails: "email",
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
  let videoVisitEvents = 0;
  let videoPlayEvents = 0;
  let videoCtaEvents = 0;
  let unattributedVideoEvents = 0;
  let videoPeopleIncomplete = false;
  const unknownTypes = new Map<string, number>();
  const sendPeople = new Set<string>();
  const observedPeople = new Set<string>();
  const replyPeople = new Set<string>();
  const interestPeople = new Set<string>();
  const attributedTrialPeople = new Set<string>();
  const attributedPaidPeople = new Set<string>();
  const emailOnlyTrialPeople = new Set<string>();
  const emailOnlyPaidPeople = new Set<string>();
  const videoVisitPeople = new Set<string>();
  const videoPlayPeople = new Set<string>();
  const videoCtaPeople = new Set<string>();
  const videoVisitsByCampaign = new Map<string, Set<string>>();
  const videoPlaysByCampaign = new Map<string, Set<string>>();
  const videoReadyByCampaign = new Map<string, Set<string>>();
  const video25ByCampaign = new Map<string, Set<string>>();
  const video50ByCampaign = new Map<string, Set<string>>();
  const video75ByCampaign = new Map<string, Set<string>>();
  const video95ByCampaign = new Map<string, Set<string>>();
  const videoCtasByCampaign = new Map<string, Set<string>>();
  const linksByCampaign = new Map<string, Set<string>>();
  const videoReadyPeople = new Set<string>();
  const video25People = new Set<string>();
  const video50People = new Set<string>();
  const video75People = new Set<string>();
  const video95People = new Set<string>();
  const linksPreparedPeople = new Set<string>();
  const videoJourneyIds = new Set<string>();
  const deliveredAssetPeople = new Map<string, Set<string>>();
  const daily = new Map<string, number>();
  const mailboxCampaigns = new Map<string, { sends: number; campaigns: Set<string> }>();

  const videoBucket = (eventType: string): { people: Set<string>; byCampaign: Map<string, Set<string>> } | null => {
    if (eventType === "personal_video_visited") return { people: videoVisitPeople, byCampaign: videoVisitsByCampaign };
    if (eventType === "personal_video_played") return { people: videoPlayPeople, byCampaign: videoPlaysByCampaign };
    if (eventType === "personal_video_player_ready") return { people: videoReadyPeople, byCampaign: videoReadyByCampaign };
    if (eventType === "personal_video_watched_25") return { people: video25People, byCampaign: video25ByCampaign };
    if (eventType === "personal_video_watched_50") return { people: video50People, byCampaign: video50ByCampaign };
    if (eventType === "personal_video_watched_75") return { people: video75People, byCampaign: video75ByCampaign };
    if (eventType === "personal_video_watched_95") return { people: video95People, byCampaign: video95ByCampaign };
    if (eventType === "personal_video_cta_clicked") return { people: videoCtaPeople, byCampaign: videoCtasByCampaign };
    return null;
  };

  for (const event of args.events) {
    const key = dedupeKey(event);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const kind = classify(event);
    if (event.provider === "system" && event.eventType === "video_link_prepared" && event.journeyId) {
      videoJourneyIds.add(event.journeyId);
    }
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
    if (event.provider === "personal_video" || (event.provider === "system" && event.eventType === "video_link_prepared")) {
      const verified = Boolean(event.personId && event.campaignId && event.journeyId);
      if (event.provider === "system") {
        if (verified && event.personId && event.campaignId) {
          linksPreparedPeople.add(event.personId);
          const people = linksByCampaign.get(event.campaignId) ?? new Set<string>();
          people.add(event.personId);
          linksByCampaign.set(event.campaignId, people);
          if (event.videoId) ensure(event.campaignId).videoIdSet.add(event.videoId);
        }
      } else {
        const bucket = videoBucket(event.eventType);
        if (bucket) {
          if (event.eventType === "personal_video_visited") videoVisitEvents += 1;
          if (event.eventType === "personal_video_played") videoPlayEvents += 1;
          if (event.eventType === "personal_video_cta_clicked") videoCtaEvents += 1;
          const people = bucket.people;
          if (event.personId) people.add(event.personId);
          else videoPeopleIncomplete = true;
          if (!verified) {
            if (event.personId) unattributedVideoEvents += 1;
          } else if (event.personId && event.campaignId && bucket.byCampaign) {
            const campaignPeople = bucket.byCampaign.get(event.campaignId) ?? new Set<string>();
            campaignPeople.add(event.personId);
            bucket.byCampaign.set(event.campaignId, campaignPeople);
            if (event.videoId) ensure(event.campaignId).videoIdSet.add(event.videoId);
          }
        }
      }
    }
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
    if (
      event.personId &&
      event.provider === "stripe" &&
      (event.eventType === "trial_started" || event.eventType === "paid_member")
    ) {
      const verifiedCampaign = event.campaignId && event.journeyId ? event.campaignId : null;
      if (event.eventType === "trial_started") {
        if (verifiedCampaign) {
          attributedTrialPeople.add(event.personId);
          const campaign = ensure(verifiedCampaign);
          campaign.trialPeople.add(event.personId);
          if (event.journeyId && videoJourneyIds.has(event.journeyId)) campaign.videoFirstTrialPeople.add(event.personId);
        } else emailOnlyTrialPeople.add(event.personId);
      } else if (verifiedCampaign) {
        attributedPaidPeople.add(event.personId);
        const campaign = ensure(verifiedCampaign);
        campaign.paidPeople.add(event.personId);
        if (event.journeyId && videoJourneyIds.has(event.journeyId)) campaign.videoFirstPaidPeople.add(event.personId);
      } else emailOnlyPaidPeople.add(event.personId);
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
      if (action.campaignId && action.actionType === "send_asset" && action.status === "delivered") {
        const delivered = deliveredAssetPeople.get(action.personId) ?? new Set<string>();
        delivered.add(action.campaignId);
        deliveredAssetPeople.set(action.personId, delivered);
      }
      if (!action.campaignId) continue;
      addCampaignAction(ensure(action.campaignId), action);
    }
  }

  const outcomeCounts = new Map<string, number>();
  let inbound: number | null = args.messages == null ? null : 0;
  let interpreted: number | null = args.messages == null ? null : 0;
  let stored: number | null = args.messages == null ? null : 0;
  let outboundSent: number | null = args.messages == null ? null : 0;
  let resourceRequestsIncomplete = args.messages == null;
  for (const message of args.messages ?? []) {
    if (!inRange(message.occurredAt, args.startMs, args.endMs)) continue;
    if (message.aiOutcome === "accept_offer") {
      if (!message.personId) resourceRequestsIncomplete = true;
      else if (message.campaignId) ensure(message.campaignId).requestPeople.add(message.personId);
      else resourceRequestsIncomplete = true;
    }
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
      campaign.claimedAssets ??= 0;
      campaign.acceptedAssets ??= 0;
      campaign.deliveredAssets ??= 0;
      campaign.videoScheduled ??= 0;
      campaign.videoClaimed ??= 0;
      campaign.videoAccepted ??= 0;
      campaign.videoDelivered ??= 0;
      campaign.firstReminderScheduled ??= 0;
      campaign.firstReminderClaimed ??= 0;
      campaign.firstReminderAccepted ??= 0;
      campaign.firstReminderDelivered ??= 0;
      campaign.finalReminderScheduled ??= 0;
      campaign.finalReminderClaimed ??= 0;
      campaign.finalReminderAccepted ??= 0;
      campaign.finalReminderDelivered ??= 0;
      campaign.remindersCanceled ??= 0;
    }
    campaign.resourceRequestPeople = resourceRequestsIncomplete ? null : campaign.requestPeople.size;
    campaign.videoVisitPeople = videoVisitsByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoPlayPeople = videoPlaysByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoPlayerReadyPeople = videoReadyByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoWatched25People = video25ByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoWatched50People = video50ByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoWatched75People = video75ByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoWatched95People = video95ByCampaign.get(campaign.id)?.size ?? 0;
    campaign.videoCtaPeople = videoCtasByCampaign.get(campaign.id)?.size ?? 0;
    campaign.linksPrepared = linksByCampaign.get(campaign.id)?.size ?? 0;
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
    campaign.attributedTrials = campaign.trialPeople.size;
    campaign.attributedPaid = campaign.paidPeople.size;
    campaign.videoFirstTrials = campaign.videoFirstTrialPeople.size;
    campaign.videoFirstPaid = campaign.videoFirstPaidPeople.size;
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

  const resourceRequestIds = new Set<string>();
  if (!resourceRequestsIncomplete) {
    for (const campaign of campaigns.values()) {
      for (const personId of campaign.requestPeople) resourceRequestIds.add(personId);
    }
  }
  let requestPairs: number | null = resourceRequestsIncomplete ? null : 0;
  let deliveredRequestPairs: number | null = !resourceRequestsIncomplete && args.actions && args.startMs == null ? 0 : null;
  if (requestPairs != null) {
    for (const campaign of campaigns.values()) {
      for (const personId of campaign.requestPeople) {
        requestPairs += 1;
        if (deliveredRequestPairs != null && deliveredAssetPeople.get(personId)?.has(campaign.id)) {
          deliveredRequestPairs += 1;
        }
      }
    }
  }
  const videoSentPeople = new Set<string>();
  if (args.actions) {
    for (const action of args.actions) {
      if (action.actionType !== "send_video") continue;
      if (action.status === "accepted" || action.status === "delivered") videoSentPeople.add(action.personId);
    }
  }
  const rates = funnelRates({
    allTime: args.startMs == null,
    replyPeople: replyPeople.size,
    contactedPeople: sendPeople.size,
    resourceRequests: requestPairs,
    deliveredRequests: deliveredRequestPairs,
    actionsReadable: args.actions != null,
    videoSentPeople: args.actions ? videoSentPeople.size : null,
    videoPlayPeople: videoPeopleIncomplete ? null : videoPlayPeople.size,
    videoCtaPeople: videoPeopleIncomplete ? null : videoCtaPeople.size,
    trialPeople: attributedTrialPeople,
    paidPeople: attributedPaidPeople,
  });

  const reportCampaigns = [...campaigns.values()]
    .map((campaign) => {
      const { sendPeople: _s, replyPeople: _r, interestPeople: _i, observedPeople: _o, trialPeople: _trial, paidPeople: _paid, videoFirstTrialPeople: _videoTrial, videoFirstPaidPeople: _videoPaid, requestPeople: _request, mailboxSends: _m, stepSends: _t, sendsForAge: _a, repliesForAge: _p, videoIdSet, ...view } = campaign;
      return { ...view, videoIds: [...videoIdSet].sort() };
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
  attention.push("No campaign is ready for a next-experiment decision. Journey-verified trials and paid members are counted, and revenue is still unmeasured.");

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
    "A campaign trial or paid count includes only a Stripe event whose campaign was copied from a journey that belongs to that person. An email match without that journey is listed separately and is not campaign attribution. Collected revenue is unavailable. Older events were not backfilled.",
    "Instantly's email totals are not added to webhook totals.",
    "A video visit, a play, and a trial-button click are separate events. A play is the first press of play, not a completed watch.",
    "25%, 50%, 75%, and 95% count the first time Vimeo reported that share of the video as played. Seeking the playhead does not add time. A milestone is not a measure of attention. 95% also includes the player reporting that the video ended.",
    "A campaign video count includes only an event that stores the person, the journey, and the campaign. Other video events in this range are unattributed and are not placed on a campaign. A missing player report is not a verified zero watch.",
    "Journey-verified trials and payments include every journey on that campaign. Video-first trials and payments include only journeys that have a prepared video link. Earlier PDF journeys stay in the broader count. Old events are not rewritten.",
    "Reminder cancellation does not store a reason, so a canceled reminder is not counted as canceled by a play.",
    "Confirmed resource requests are accept_offer messages. lead_interested is not a request.",
    "Scheduled and claimed actions are still held. Accepted by Resend is not delivered.",
    "Instantly Completed is the sequence status. It is not this app's automation switch and it is not a finished experiment.",
    sequenceFinishedEvents > 0
      ? `${sequenceFinishedEvents} campaign_completed_for_lead_without_reply events are preserved as sequence evidence. They did not close a journey.`
      : "No preserved sequence-finished webhook is in this range.",
  ];

  return {
    readable: true,
    truncated: false,
    note: "Cold email is separate from the website funnel below. Date buttons filter webhook activity, video events, confirmed resource requests, and the Instantly calendar request. The current outbox — scheduled, claimed, accepted, and delivered — stays all-time. Instantly totals are not added to webhook totals.",
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
    videoEvents: videoVisitEvents + videoPlayEvents + videoCtaEvents,
    videoVisitPeople: videoPeopleIncomplete ? null : videoVisitPeople.size,
    videoVisitEvents,
    videoPlayPeople: videoPeopleIncomplete ? null : videoPlayPeople.size,
    videoPlayEvents,
    videoCtaPeople: videoPeopleIncomplete ? null : videoCtaPeople.size,
    videoCtaEvents,
    videoPlayerReadyPeople: videoPeopleIncomplete ? null : videoReadyPeople.size,
    videoWatched25People: videoPeopleIncomplete ? null : video25People.size,
    videoWatched50People: videoPeopleIncomplete ? null : video50People.size,
    videoWatched75People: videoPeopleIncomplete ? null : video75People.size,
    videoWatched95People: videoPeopleIncomplete ? null : video95People.size,
    unattributedVideoEvents,
    linksPrepared: linksPreparedPeople.size,
    resourceRequestPeople: resourceRequestsIncomplete ? null : resourceRequestIds.size,
    remindersCanceledByPlay: null,
    rates,
    attributedTrialPeople: attributedTrialPeople.size,
    attributedPaidPeople: attributedPaidPeople.size,
    emailOnlyTrialPeople: [...emailOnlyTrialPeople].filter((id) => !attributedTrialPeople.has(id)).length,
    emailOnlyPaidPeople: [...emailOnlyPaidPeople].filter((id) => !attributedPaidPeople.has(id)).length,
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
    nextDecision: "No next campaign is selected. Journey-verified trials and paid members are counted, and revenue is still unmeasured. Instantly's Completed status does not answer it.",
    gaps,
  };
}

function addCampaignAction(campaign: MutableCampaign, action: LedgerAction): void {
  const status = action.status;
  if (action.actionType === "send_asset") {
    if (status === "scheduled") campaign.scheduledAssets = (campaign.scheduledAssets ?? 0) + 1;
    if (status === "claimed") campaign.claimedAssets = (campaign.claimedAssets ?? 0) + 1;
    if (status === "accepted") campaign.acceptedAssets = (campaign.acceptedAssets ?? 0) + 1;
    if (status === "delivered") campaign.deliveredAssets = (campaign.deliveredAssets ?? 0) + 1;
    return;
  }
  if (action.actionType === "send_video") {
    if (status === "scheduled") campaign.videoScheduled = (campaign.videoScheduled ?? 0) + 1;
    if (status === "claimed") campaign.videoClaimed = (campaign.videoClaimed ?? 0) + 1;
    if (status === "accepted") campaign.videoAccepted = (campaign.videoAccepted ?? 0) + 1;
    if (status === "delivered") campaign.videoDelivered = (campaign.videoDelivered ?? 0) + 1;
    return;
  }
  if (status === "canceled" && (action.actionType === "send_video_reminder" || action.actionType === "send_video_reminder_final")) {
    campaign.remindersCanceled = (campaign.remindersCanceled ?? 0) + 1;
    return;
  }
  const scheduled = action.actionType === "send_video_reminder" ? "firstReminderScheduled" : action.actionType === "send_video_reminder_final" ? "finalReminderScheduled" : null;
  const claimed = action.actionType === "send_video_reminder" ? "firstReminderClaimed" : action.actionType === "send_video_reminder_final" ? "finalReminderClaimed" : null;
  const accepted = action.actionType === "send_video_reminder" ? "firstReminderAccepted" : action.actionType === "send_video_reminder_final" ? "finalReminderAccepted" : null;
  const delivered = action.actionType === "send_video_reminder" ? "firstReminderDelivered" : action.actionType === "send_video_reminder_final" ? "finalReminderDelivered" : null;
  if (!scheduled || !claimed || !accepted || !delivered) return;
  if (status === "scheduled") campaign[scheduled] = (campaign[scheduled] ?? 0) + 1;
  if (status === "claimed") campaign[claimed] = (campaign[claimed] ?? 0) + 1;
  if (status === "accepted") campaign[accepted] = (campaign[accepted] ?? 0) + 1;
  if (status === "delivered") campaign[delivered] = (campaign[delivered] ?? 0) + 1;
}

function funnelRates(args: {
  allTime: boolean;
  replyPeople: number;
  contactedPeople: number;
  resourceRequests: number | null;
  deliveredRequests: number | null;
  actionsReadable: boolean;
  videoSentPeople: number | null;
  videoPlayPeople: number | null;
  videoCtaPeople: number | null;
  trialPeople: Set<string>;
  paidPeople: Set<string>;
}): FunnelRates {
  const rates = emptyRates("");
  rates.reply = showRate(args.replyPeople, args.contactedPeople);
  rates.notes.reply = rates.reply
    ? "Webhook reply people divided by webhook contacts in this same range. Instantly's reply count is not used here."
    : "No webhook-contact denominator in this range. This is not a 0% reply rate.";
  if (args.resourceRequests == null || args.deliveredRequests == null) {
    rates.notes.resourceToDelivery = args.actionsReadable
      ? "Confirmed requests use this date range. A delivered PDF is the current outbox. The rate is calculated only for all time, and only when every request has a person and a campaign."
      : "Fulfillment actions could not be read, so delivery is not divided into requests.";
  } else {
    rates.resourceToDelivery = showRate(args.deliveredRequests, args.resourceRequests);
    rates.notes.resourceToDelivery = rates.resourceToDelivery
      ? "All-time confirmed requests that now have a delivered PDF on that same campaign, divided by those requests. lead_interested is not a request."
      : "No confirmed resource request is in this read, so the rate is not calculated.";
  }
  if (!args.allTime || args.videoSentPeople == null || args.videoPlayPeople == null || args.videoPlayPeople > args.videoSentPeople) {
    rates.notes.videoSentToPlay = "A play is counted in the date range. A sent video is the current outbox. The rate is calculated only for all time, and only when recorded plays do not exceed sent videos. A play is not a completed watch.";
  } else {
    rates.videoSentToPlay = showRate(args.videoPlayPeople, args.videoSentPeople);
    rates.notes.videoSentToPlay = rates.videoSentToPlay
      ? "All-time people with a recorded play, divided by people whose video email was accepted or delivered. A visit is not a play. A play is not a completed watch."
      : "No accepted or delivered personal video is in the outbox, so the rate is not calculated.";
  }
  if (args.videoPlayPeople == null || args.videoCtaPeople == null || args.videoCtaPeople > args.videoPlayPeople) {
    rates.notes.playToCta = "Calculated only when both counts are in this range and trial-button clicks do not exceed recorded plays. A click does not mean the video was watched through.";
  } else {
    rates.playToCta = showRate(args.videoCtaPeople, args.videoPlayPeople);
    rates.notes.playToCta = rates.playToCta
      ? "People with a trial-button click in this range, divided by people with a play in this range. A click is not a completed watch."
      : "No recorded play is in this range, so the rate is not calculated. A visit is not a play.";
  }
  rates.notes.videoToTrial = "Plays are not divided into trials. A trial is counted only when checkout stored a verified journey.";
  const paidOutsideTrials = [...args.paidPeople].some((personId) => !args.trialPeople.has(personId));
  if (!args.allTime || paidOutsideTrials) {
    rates.notes.trialToPaid = "Calculated only for all time, and only when every journey-verified paid member also has a journey-verified trial. A short range can show a payment whose trial happened earlier.";
  } else {
    rates.trialToPaid = showRate(args.paidPeople.size, args.trialPeople.size);
    rates.notes.trialToPaid = rates.trialToPaid
      ? "All-time journey-verified paid people divided by journey-verified trial people. An email match is not included."
      : "No journey-verified trial is in this read, so the rate is not calculated.";
  }
  return rates;
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
    return "Instantly status is Completed. That is not this app's automation switch, and revenue is still unmeasured, so the experiment is not finished.";
  }
  if (leadsDone != null && campaign.instantlyLeads != null && leadsDone < campaign.instantlyLeads) {
    return "Instantly still has leads that have not completed the sequence.";
  }
  if (campaign.sequenceFinishedEvents && campaign.sequenceFinishedEvents > 0) {
    return "Some leads have a preserved sequence-finished webhook. That does not finish the campaign or the experiment.";
  }
  return "Completion is unknown. A pause or an old start date is not a finished experiment.";
}

export function watchMeasurementNote(campaign: Pick<CampaignView, "videoVisitPeople" | "videoPlayerReadyPeople" | "videoPlayPeople">): string {
  if (campaign.videoVisitPeople == null || campaign.videoPlayerReadyPeople == null || campaign.videoPlayPeople == null) {
    return "Watch counts could not be read.";
  }
  if (campaign.videoVisitPeople > 0 && campaign.videoPlayerReadyPeople === 0) {
    return "People opened the page, and the player did not report. That is missing playback data, not a verified zero watch.";
  }
  if (campaign.videoPlayerReadyPeople > 0 && campaign.videoPlayPeople === 0) {
    return "The player connected, and no play was recorded.";
  }
  return "A milestone is the first time played time reached that share of the video. It is not a measure of attention, and a play is not a completed watch.";
}

export function distributionFactsText(report: DistributionCommandReport): string {
  const lines = [
    "Summitt Mindset distribution facts",
    `Range: ${report.rangeLabel}`,
    "",
    "Definitions",
    "Instantly sends, replies, bounces, and unsubscribes are Instantly's own totals. They are not added to webhook history.",
    "Webhook history starts 22 Oct 2026. Older campaigns can be missing sends.",
    "lead_interested is not a reply.",
    "A prepared video link is one recipient journey with a video_url. Preparing a link does not send email.",
    "A visit is a page open. A play is the first press of play. A play is not a completed watch.",
    "25%, 50%, 75%, and 95% are the first time Vimeo reported that share of the video as played. Seeking the playhead does not add time. These are not measures of attention. 95% also includes the player reporting that the video ended.",
    "A campaign count includes only an event that stores the person, the journey, and the campaign.",
    "Unattributed video events are not placed on a campaign. A missing player report is not a verified zero watch.",
    "A journey-verified trial or paid member comes from checkout that carried a signed journey for that person. An email match is not included. Revenue is unavailable.",
    "Nothing here ranks a campaign or explains why someone subscribed.",
    "",
    `Unattributed video events: ${report.unattributedVideoEvents ?? "could not be read"}`,
    `Prepared video links: ${report.linksPrepared ?? "could not be read"}`,
    "",
    "Campaigns",
  ];
  for (const campaign of report.campaigns) {
    lines.push(
      [
        campaign.name ?? "Name unavailable",
        campaign.id,
        `status ${campaign.statusLabel}`,
        `videos ${campaign.videoIds.length > 0 ? campaign.videoIds.join(" ") : "none stored"}`,
        `instantly sent ${showCount(campaign.instantlySent, "")}`,
        `instantly unique replies ${showCount(campaign.instantlyUniqueReplies, "")}`,
        `webhook reply rate ${showRate(campaign.webhookReplyPeople, campaign.webhookContacted) ?? "not calculated"}`,
        `instantly bounced leads ${showCount(campaign.instantlyBouncedLeads, "")}`,
        `instantly unsubscribed leads ${showCount(campaign.instantlyUnsubscribed, "")}`,
        `links prepared ${showCount(campaign.linksPrepared, "")}`,
        `visits ${showCount(campaign.videoVisitPeople, "")}`,
        `player ready ${showCount(campaign.videoPlayerReadyPeople, "")}`,
        `plays ${showCount(campaign.videoPlayPeople, "")}`,
        `25% ${showCount(campaign.videoWatched25People, "")}`,
        `50% ${showCount(campaign.videoWatched50People, "")}`,
        `75% ${showCount(campaign.videoWatched75People, "")}`,
        `95% or ended ${showCount(campaign.videoWatched95People, "")}`,
        `cta ${showCount(campaign.videoCtaPeople, "")}`,
        `verified trials ${campaign.attributedTrials}`,
        `verified paid ${campaign.attributedPaid}`,
        `video-first trials ${campaign.videoFirstTrials}`,
        `video-first paid ${campaign.videoFirstPaid}`,
      ].join(" | "),
    );
    lines.push(watchMeasurementNote(campaign));
  }
  if (report.campaigns.length === 0) lines.push("No campaign is in this read.");
  return `${lines.join("\n")}\n`;
}
