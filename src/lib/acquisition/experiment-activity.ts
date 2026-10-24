/**
 * Historical acquisition counts for the distribution date range.
 * Lifecycle headcount stays separate. A trial is not assigned to a campaign.
 */

import { isAcquisitionLifecycle, salesEmailMustStop } from "@/lib/acquisition/model";

export type ActivityEventRow = {
  personId: string | null;
  provider: string;
  providerEventId: string | null;
  eventType: string;
  occurredAt: string;
  campaignId?: string | null;
};

export type ActivityActionRow = {
  personId: string | null;
  actionType: string;
  status: string;
  updatedAt: string | null;
  deliveredAt: string | null;
};

export type CountPair = { events: number; people: number };

export type ExperimentActivityCounts = {
  coldEmailsSent: CountPair | null;
  repliesReceived: CountPair | null;
  unsubscribes: CountPair | null;
  bounces: CountPair | null;
  complaints: CountPair | null;
  campaignsCompleted: CountPair | null;
  resourcesAccepted: CountPair | null;
  resourcesDelivered: CountPair | null;
  prospectsInEvents: number | null;
  acquisitionTrials: CountPair | null;
};

type CompleteActivityCounts = {
  [Key in keyof ExperimentActivityCounts]: NonNullable<ExperimentActivityCounts[Key]>;
};

export type ExperimentActivity = {
  readable: boolean;
  truncated: boolean;
  note: string;
  counts: ExperimentActivityCounts | null;
  /** Always unset. A trial row does not prove which campaign or journey preceded it. */
  campaignAttributedTrials: null;
};

export type EligibilityPerson = { email: string; lifecycle: string };

export type EligibilityReport = {
  readable: boolean;
  truncated: boolean;
  eligible: number | null;
  stopped: number | null;
  unknown: number | null;
  note: string;
};

export function unavailableExperimentActivity(note: string, truncated = false): ExperimentActivity {
  return { readable: false, truncated, note, counts: null, campaignAttributedTrials: null };
}

export function unavailableEligibility(note: string, truncated = false): EligibilityReport {
  return { readable: false, truncated, eligible: null, stopped: null, unknown: null, note };
}

function inRange(iso: string | null, startMs: number | null, endMs: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  if (startMs != null && ms < startMs) return false;
  return ms < endMs;
}

function add(pair: CountPair, personId: string | null, people: Set<string>): void {
  pair.events += 1;
  if (!personId || people.has(personId)) return;
  people.add(personId);
  pair.people += 1;
}

export function foldExperimentActivity(args: {
  events: ActivityEventRow[];
  actions: ActivityActionRow[];
  startMs: number | null;
  endMs: number;
}): CompleteActivityCounts {
  const counts: CompleteActivityCounts = {
    coldEmailsSent: { events: 0, people: 0 },
    repliesReceived: { events: 0, people: 0 },
    unsubscribes: { events: 0, people: 0 },
    bounces: { events: 0, people: 0 },
    complaints: { events: 0, people: 0 },
    campaignsCompleted: { events: 0, people: 0 },
    resourcesAccepted: { events: 0, people: 0 },
    resourcesDelivered: { events: 0, people: 0 },
    prospectsInEvents: 0,
    acquisitionTrials: { events: 0, people: 0 },
  };
  const seenEvents = new Set<string>();
  const prospectIds = new Set<string>();
  const buckets = {
    coldEmailsSent: new Set<string>(),
    repliesReceived: new Set<string>(),
    unsubscribes: new Set<string>(),
    bounces: new Set<string>(),
    complaints: new Set<string>(),
    campaignsCompleted: new Set<string>(),
    acquisitionTrials: new Set<string>(),
  };

  for (const event of args.events) {
    if (!inRange(event.occurredAt, args.startMs, args.endMs)) continue;
    if (event.providerEventId) {
      const key = `${event.provider}:${event.providerEventId}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
    }
    const personId = event.personId;
    const instantly = event.provider === "instantly";
    const resend = event.provider === "resend";
    const stripe = event.provider === "stripe";
    let counted = false;
    if (instantly && event.eventType === "email_sent") {
      add(counts.coldEmailsSent, personId, buckets.coldEmailsSent);
      counted = true;
    } else if (instantly && event.eventType === "reply_received") {
      add(counts.repliesReceived, personId, buckets.repliesReceived);
      counted = true;
    } else if ((instantly && event.eventType === "lead_unsubscribed") || (resend && event.eventType === "resend_unsubscribed")) {
      add(counts.unsubscribes, personId, buckets.unsubscribes);
      counted = true;
    } else if ((instantly && event.eventType === "email_bounced") || (resend && event.eventType === "resend_bounced")) {
      add(counts.bounces, personId, buckets.bounces);
      counted = true;
    } else if (resend && event.eventType === "resend_complained") {
      add(counts.complaints, personId, buckets.complaints);
      counted = true;
    } else if (instantly && event.eventType === "campaign_completed") {
      add(counts.campaignsCompleted, personId, buckets.campaignsCompleted);
      counted = true;
    } else if (stripe && event.eventType === "trial_started") {
      // campaignId is ignored. A trial is not credited to a campaign or journey.
      add(counts.acquisitionTrials, personId, buckets.acquisitionTrials);
    }
    if (counted && personId) prospectIds.add(personId);
  }

  const acceptedPeople = new Set<string>();
  const deliveredPeople = new Set<string>();
  for (const action of args.actions) {
    if (action.actionType !== "send_asset") continue;
    if (action.status !== "accepted" && action.status !== "delivered") continue;
    if (inRange(action.updatedAt, args.startMs, args.endMs)) {
      add(counts.resourcesAccepted, action.personId, acceptedPeople);
    }
    if (action.status === "delivered" && inRange(action.deliveredAt, args.startMs, args.endMs)) {
      add(counts.resourcesDelivered, action.personId, deliveredPeople);
    }
  }
  counts.prospectsInEvents = prospectIds.size;
  return counts;
}

function shown(readable: boolean, value: number | null | undefined): string {
  return readable && value != null ? String(value) : "Not available";
}

export type ExperimentMetric = { label: string; value: string; note?: string };

export function experimentHistoryMetrics(activity: ExperimentActivity): ExperimentMetric[] {
  const counts = activity.counts;
  const pair = (events: CountPair | null | undefined) =>
    `${shown(activity.readable, events?.events)} events, ${shown(activity.readable, events?.people)} people`;
  return [
    { label: "Cold emails sent", value: pair(counts?.coldEmailsSent), note: "Recorded Instantly email_sent events." },
    { label: "Replies received", value: pair(counts?.repliesReceived), note: "Recorded reply_received events. lead_interested is not a reply." },
    { label: "Unsubscribes", value: pair(counts?.unsubscribes), note: "Instantly lead_unsubscribed and Resend unsubscribe events." },
    { label: "Bounces", value: pair(counts?.bounces), note: "Instantly email_bounced and Resend bounce events." },
    { label: "Complaints", value: pair(counts?.complaints), note: "Recorded Resend complaint events." },
    { label: "Completed sequences", value: pair(counts?.campaignsCompleted), note: "Recorded Instantly campaign_completed events." },
    {
      label: "Resource emails accepted by Resend",
      value: pair(counts?.resourcesAccepted),
      note: "Resend accepted the send. This is not confirmed delivery.",
    },
    {
      label: "Resource emails with confirmed delivery",
      value: pair(counts?.resourcesDelivered),
      note: "A later Resend delivery event. This is not an open and not a trial.",
    },
    {
      label: "Distinct prospects in these events",
      value: shown(activity.readable, counts?.prospectsInEvents),
      note: "People represented by the event counts above. This is not a sum of those events, and it does not include resource emails or trials.",
    },
  ];
}

export function experimentTrialMetrics(args: {
  companyTrialStarts: string;
  activity: ExperimentActivity;
}): ExperimentMetric[] {
  const trials = args.activity.counts?.acquisitionTrials;
  return [
    {
      label: "All Summitt Mindset trial starts",
      value: args.companyTrialStarts,
      note: "The company Stripe count for this range. Acquisition trials are not added to it.",
    },
    {
      label: "Acquisition trial links recorded",
      value: `${shown(args.activity.readable, trials?.events)} events, ${shown(args.activity.readable, trials?.people)} people`,
      note: "Counted when the acquisition system recorded a Stripe trial link. This may differ from actual trial-start timing and may include test accounts.",
    },
    {
      label: "Campaign or journey attributed trial starts",
      value: "Not available",
      note: "Not proven. A trial event does not record the campaign or journey, and source_campaign is not used.",
    },
  ];
}

export function experimentEligibilityMetrics(eligibility: EligibilityReport): ExperimentMetric[] {
  return [
    { label: "Currently eligible in the acquisition database", value: shown(eligibility.readable, eligibility.eligible) },
    { label: "Globally stopped or suppressed", value: shown(eligibility.readable, eligibility.stopped) },
    { label: "Unknown eligibility", value: shown(eligibility.readable, eligibility.unknown) },
  ];
}

export function formatExperimentSections(args: {
  rangeLabel: string;
  timezone: string;
  companyTrialStarts: string;
  activity: ExperimentActivity;
  eligibility: EligibilityReport;
}): string[] {
  return [
    "HISTORICAL ACQUISITION ACTIVITY",
    `Range: ${args.rangeLabel} (${args.timezone}). These are recorded events. The lifecycle headcount below is all time and is not filtered by this range.`,
    args.activity.note,
    ...experimentHistoryMetrics(args.activity).map((metric) => `${metric.label}: ${metric.value}. ${metric.note ?? ""}`.trim()),
    "",
    "TRIAL PERFORMANCE",
    ...experimentTrialMetrics(args).map((metric) => `${metric.label}: ${metric.value}. ${metric.note ?? ""}`.trim()),
    "",
    "CURRENT ELIGIBILITY — ALL TIME",
    args.eligibility.note,
    ...experimentEligibilityMetrics(args.eligibility).map((metric) => `${metric.label}: ${metric.value}`),
  ];
}

export function presentExperimentActivity(args: {
  counts: CompleteActivityCounts;
  eventsFailed: boolean;
  actionsFailed: boolean;
  eventsComplete: boolean;
  actionsComplete: boolean;
}): ExperimentActivity {
  const eventsReady = !args.eventsFailed && args.eventsComplete;
  const actionsReady = !args.actionsFailed && args.actionsComplete;
  if (!eventsReady && !actionsReady) {
    const truncated = (!args.eventsFailed && !args.eventsComplete) || (!args.actionsFailed && !args.actionsComplete);
    return unavailableExperimentActivity(
      truncated
        ? "The read hit its row cap. Totals are not shown because they would be incomplete."
        : "Acquisition events could not be read. Do not treat that as zero.",
      truncated,
    );
  }
  const counts: ExperimentActivityCounts = {
    coldEmailsSent: eventsReady ? args.counts.coldEmailsSent : null,
    repliesReceived: eventsReady ? args.counts.repliesReceived : null,
    unsubscribes: eventsReady ? args.counts.unsubscribes : null,
    bounces: eventsReady ? args.counts.bounces : null,
    complaints: eventsReady ? args.counts.complaints : null,
    campaignsCompleted: eventsReady ? args.counts.campaignsCompleted : null,
    prospectsInEvents: eventsReady ? args.counts.prospectsInEvents : null,
    acquisitionTrials: eventsReady ? args.counts.acquisitionTrials : null,
    resourcesAccepted: actionsReady ? args.counts.resourcesAccepted : null,
    resourcesDelivered: actionsReady ? args.counts.resourcesDelivered : null,
  };
  const missing = !eventsReady
    ? "Event totals are not available. Do not treat that as zero."
    : !actionsReady
      ? "Resource acceptance totals are not available. Do not treat that as zero."
      : "Event counts use occurred_at. Resource acceptance uses the time Resend accepted the send. Confirmed delivery uses the later delivery time.";
  return {
    readable: true,
    truncated: !eventsReady || !actionsReady,
    note: `${missing} lead_interested is not a reply or an acceptance. A scheduled action is not a send.`,
    counts,
    campaignAttributedTrials: null,
  };
}

export function foldEligibility(args: {
  people: EligibilityPerson[];
  suppressedEmails: readonly string[];
  peopleComplete: boolean;
  suppressionComplete: boolean;
}): EligibilityReport {
  if (!args.peopleComplete) {
    return unavailableEligibility(
      "The prospect read hit its row cap. Eligibility totals are not shown because they would be incomplete.",
      true,
    );
  }
  if (!args.suppressionComplete) {
    return unavailableEligibility(
      "Suppression could not be read in full. Eligibility is unknown. Do not treat that as zero.",
      true,
    );
  }
  const suppressed = new Set(args.suppressedEmails);
  const seen = new Set<string>();
  let eligible = 0;
  let stopped = 0;
  let unknown = 0;
  for (const person of args.people) {
    if (seen.has(person.email)) continue;
    seen.add(person.email);
    if (!isAcquisitionLifecycle(person.lifecycle)) {
      unknown += 1;
      continue;
    }
    if (salesEmailMustStop(person.lifecycle) || suppressed.has(person.email)) stopped += 1;
    else eligible += 1;
  }
  return {
    readable: true,
    truncated: false,
    eligible,
    stopped,
    unknown,
    note: "Eligible means the acquisition record is not in a stop state and the email is not on the suppression list. Clerk membership was not rechecked. This does not prove Instantly has stopped sending or will send.",
  };
}

