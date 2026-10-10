/**
 * Channel and content rollups for Distribution.
 * Counts come from the existing traffic rows. Retention counts come from the paid cohort.
 * Missing spend stays missing. A higher rate is not a winner.
 */

import {
  formatUnknownableUsdFromCents,
  type TrafficSourceRow,
} from "@/lib/admin-subscriber-growth-pure";
import type { AcquisitionCohortBucket, CohortCounts } from "@/lib/retention-intelligence";

const MAX_CHANNELS = 8;
const MAX_CONTENT = 12;
const SMALL_SAMPLE = 15;

export type DistributionMetricRow = {
  channel: string;
  platform: string;
  campaign: string;
  content: string;
  production: string;
  visitors: string;
  trials: string;
  paid: string;
  trialToPaid: string;
  retention: string;
  spend: string;
  costPerTrial: string;
  costPerPaid: string;
  coverage: string;
};

export type DistributionIntelligence = {
  readable: boolean;
  note: string;
  observational: string;
  channels: DistributionMetricRow[];
  content: DistributionMetricRow[];
  hiddenChannels: number;
  hiddenContent: number;
  unattributedTrials: string;
  unattributedPaid: string;
  limitations: string[];
  recommendedStep: string;
};

export function buildDistributionIntelligence(args: {
  trackingReadable: boolean;
  spendReadable: boolean;
  retentionReady: boolean;
  trafficRows: TrafficSourceRow[];
  rangeTrials: number | null;
  rangePaid: number | null;
  cohorts: AcquisitionCohortBucket[];
}): DistributionIntelligence {
  if (!args.trackingReadable) {
    return {
      readable: false,
      note: "Acquisition events for this range could not be read. Do not treat that as zero visitors.",
      observational:
        "Channel and content results are observations. They are not a controlled experiment, and a higher rate is not a winner.",
      channels: [],
      content: [],
      hiddenChannels: 0,
      hiddenContent: 0,
      unattributedTrials: "Not available",
      unattributedPaid: "Not available",
      limitations: [
        "Channel and content performance could not be read for this range.",
      ],
      recommendedStep:
        "Reload Distribution after the marketing read succeeds. Do not pick a channel from a missing table.",
    };
  }

  const channels = rollupChannels(args);
  const content = rollupContent(args);
  const shownChannels = channels.slice(0, MAX_CHANNELS);
  const shownContent = content.slice(0, MAX_CONTENT);
  const trialSum = channels.reduce((sum, row) => sum + row.trials, 0);
  const paidSum = channels.reduce((sum, row) => sum + row.paid, 0);

  return {
    readable: true,
    note: "Visitors, trials, and paid members use this date range and the existing first-touch rows. Retention uses the paid-membership cohort and does not follow the date range. Someone who arrived through two campaigns can be counted in two visitor rows. Trials and paid members stay on one first-touch row.",
    observational:
      "These comparisons are observational. A Meta ad and a LinkedIn post do not reach the same people. A higher rate, including Brooke-created versus AI-assisted, is not proof of causation, and it is not a reason to spend more.",
    channels: shownChannels.map((row) => presentChannel(row, args.spendReadable, args.retentionReady)),
    content: shownContent.map((row) => presentContent(row, args.spendReadable, args.retentionReady)),
    hiddenChannels: Math.max(0, channels.length - shownChannels.length),
    hiddenContent: Math.max(0, content.length - shownContent.length),
    unattributedTrials: gapText(args.rangeTrials, trialSum),
    unattributedPaid: gapText(args.rangePaid, paidSum),
    limitations: [
      "Missing advertising spend is not zero.",
      "Post-level spend is recorded only when one campaign has one content row. Campaign spend is not exact spending for one post.",
      "Cold email, newsletters, and Pinterest can still be classified as Direct by the existing source classifier.",
      "Production class is Unknown unless a future tracked visit stored Brooke-created, AI-assisted, or Hybrid. Older posts are not classified.",
      "Apple memberships are outside the paid retention cohort because a first Apple payment time is not stored.",
      "Social likes, views, and shares are not in this table. A click is not a free trial.",
    ],
    recommendedStep:
      "Use a tracking link on the next post if its results should be separable. Do not move budget from a small or incomplete row.",
  };
}

export function formatDistributionIntelligence(intel: DistributionIntelligence): string[] {
  const lines = [
    "CHANNEL AND CONTENT",
    intel.note,
    intel.observational,
    line("Trials without a first-touch row", intel.unattributedTrials),
    line("Paid members without a first-touch row", intel.unattributedPaid),
  ];
  if (!intel.readable) {
    lines.push(intel.recommendedStep);
    return lines;
  }
  lines.push("Channels");
  if (intel.channels.length === 0) lines.push("No channel rows in this range.");
  for (const row of intel.channels.slice(0, 5)) {
    lines.push(
      `${row.channel}: visitors ${row.visitors}, trials ${row.trials}, paid ${row.paid}, trial-to-paid ${row.trialToPaid}, retention ${row.retention}, spend ${row.spend}.`
    );
  }
  lines.push("Content");
  if (intel.content.length === 0) lines.push("No content rows in this range.");
  for (const row of intel.content.slice(0, 5)) {
    lines.push(
      `${row.platform} · ${row.campaign} · ${row.content} · ${row.production}: visitors ${row.visitors}, trials ${row.trials}, paid ${row.paid}, retention ${row.retention}, spend ${row.spend}.`
    );
  }
  if (intel.hiddenContent > 0) lines.push(`${intel.hiddenContent} more content rows are on Distribution only.`);
  lines.push(intel.recommendedStep);
  return lines;
}

type ChannelAcc = {
  channel: string;
  visitors: number;
  trials: number;
  paid: number;
  spendCents: number | null;
  d30: CohortCounts;
  d60: CohortCounts;
  d90: CohortCounts;
};

type ContentAcc = ChannelAcc & {
  platform: string;
  campaign: string;
  content: string;
  production: string;
  productions: Set<string>;
};

function rollupChannels(args: {
  trafficRows: TrafficSourceRow[];
  cohorts: AcquisitionCohortBucket[];
  spendReadable: boolean;
}): ChannelAcc[] {
  const map = new Map<string, ChannelAcc>();
  for (const row of args.trafficRows) {
    const channel = channelFromTraffic(row);
    const acc = map.get(channel) ?? emptyChannel(channel);
    acc.visitors += row.visitors ?? 0;
    acc.trials += row.trialsStarted ?? 0;
    acc.paid += row.paidConversions ?? 0;
    if (args.spendReadable && row.advertisingSpendCents != null && !row.utmContent) {
      acc.spendCents = (acc.spendCents ?? 0) + row.advertisingSpendCents;
    }
    map.set(channel, acc);
  }
  for (const bucket of args.cohorts) {
    const acc = map.get(bucket.channel) ?? emptyChannel(bucket.channel);
    addCounts(acc.d30, bucket.d30);
    addCounts(acc.d60, bucket.d60);
    addCounts(acc.d90, bucket.d90);
    map.set(bucket.channel, acc);
  }
  return [...map.values()].sort(byOutcome);
}

function rollupContent(args: {
  trafficRows: TrafficSourceRow[];
  cohorts: AcquisitionCohortBucket[];
  spendReadable: boolean;
}): ContentAcc[] {
  const map = new Map<string, ContentAcc>();
  for (const row of args.trafficRows) {
    if (!row.utmCampaign && !row.utmContent) continue;
    const key = contentKey(row.utmCampaign || "Unknown", row.utmContent || "Unknown");
    const acc =
      map.get(key) ??
      emptyContent({
        channel: channelFromTraffic(row),
        platform: row.platform || row.firstTouchLabel || "Unknown",
        campaign: row.utmCampaign || "Unknown",
        content: row.utmContent || "Unknown",
      });
    acc.visitors += row.visitors ?? 0;
    acc.trials += row.trialsStarted ?? 0;
    acc.paid += row.paidConversions ?? 0;
    map.set(key, acc);
  }
  for (const bucket of args.cohorts) {
    if (bucket.campaign === "Unknown" && bucket.content === "Unknown") continue;
    const key = contentKey(bucket.campaign, bucket.content);
    const acc =
      map.get(key) ??
      emptyContent({
        channel: bucket.channel,
        platform: bucket.channel,
        campaign: bucket.campaign,
        content: bucket.content,
      });
    acc.productions.add(bucket.production);
    addCounts(acc.d30, bucket.d30);
    addCounts(acc.d60, bucket.d60);
    addCounts(acc.d90, bucket.d90);
    map.set(key, acc);
  }
  for (const acc of map.values()) {
    const classes = [...acc.productions].filter((label) => label !== "Unknown");
    acc.production = classes.length === 1 ? classes[0] : "Unknown";
    if (args.spendReadable) {
      const campaignSpend = campaignSpendFor(args.trafficRows, acc.campaign);
      const siblings = [...map.values()].filter((row) => row.campaign === acc.campaign).length;
      if (campaignSpend != null && siblings === 1) acc.spendCents = campaignSpend;
    }
  }
  return [...map.values()].sort(byOutcome);
}

function presentChannel(
  row: ChannelAcc,
  spendReadable: boolean,
  retentionReady: boolean
): DistributionMetricRow {
  return {
    channel: row.channel,
    platform: row.channel,
    campaign: "",
    content: "",
    production: "",
    visitors: String(row.visitors),
    trials: String(row.trials),
    paid: String(row.paid),
    trialToPaid: rate(row.paid, row.trials),
    retention: retentionText(row, retentionReady),
    spend: spendText(row.spendCents, spendReadable),
    costPerTrial: costText(row.spendCents, row.trials, spendReadable),
    costPerPaid: costText(row.spendCents, row.paid, spendReadable),
    coverage: "First-touch rows in this range. Retention is the paid cohort.",
  };
}

function presentContent(
  row: ContentAcc,
  spendReadable: boolean,
  retentionReady: boolean
): DistributionMetricRow {
  return {
    channel: row.channel,
    platform: row.platform,
    campaign: row.campaign,
    content: row.content,
    production: row.production,
    visitors: String(row.visitors),
    trials: String(row.trials),
    paid: String(row.paid),
    trialToPaid: rate(row.paid, row.trials),
    retention: retentionText(row, retentionReady),
    spend: !spendReadable
      ? "Not available"
      : row.spendCents == null
        ? "Spend not recorded for this post"
        : spendText(row.spendCents, true),
    costPerTrial: costText(row.spendCents, row.trials, spendReadable),
    costPerPaid: costText(row.spendCents, row.paid, spendReadable),
    coverage:
      row.visitors === 0 && (row.trials > 0 || row.paid > 0 || mature(row.d30) > 0)
        ? "Paid outcome is outside this date range, or the visit was not in the loaded rows."
        : "First-touch content id. A missing tracking link stays Unknown, not zero.",
  };
}

function retentionText(row: ChannelAcc, ready: boolean): string {
  if (!ready) return "Not available";
  return `D30 ${milestone(row.d30)} D60 ${milestone(row.d60)} D90 ${milestone(row.d90)}`;
}

function milestone(counts: CohortCounts): string {
  const ready = counts.retained + counts.ended + counts.rejoined;
  if (ready <= 0) {
    if (counts.unknown > 0) return `Not available. Unknown ${counts.unknown}.`;
    return counts.immature > 0 ? "Not old enough" : "Not available";
  }
  const text = `${Math.round((100 * counts.retained) / ready)}% (${counts.retained} of ${ready})`;
  const small = ready < SMALL_SAMPLE ? " Small sample." : "";
  const unknown = counts.unknown > 0 ? ` Unknown ${counts.unknown}.` : "";
  return `${text}.${small}${unknown}`;
}

function channelFromTraffic(row: TrafficSourceRow): string {
  if (row.platform) return row.platform;
  return row.firstTouchLabel || "Unknown";
}

function contentKey(campaign: string, content: string): string {
  return `${campaign}\u0000${content}`;
}

function campaignSpendFor(rows: TrafficSourceRow[], campaign: string): number | null {
  let total: number | null = null;
  for (const row of rows) {
    if ((row.utmCampaign || "Unknown") !== campaign) continue;
    if (row.utmContent) continue;
    if (row.advertisingSpendCents == null) continue;
    total = (total ?? 0) + row.advertisingSpendCents;
  }
  return total;
}

function line(label: string, value: string): string {
  const text = value.endsWith(".") ? value.slice(0, -1) : value;
  return `${label}: ${text}.`;
}

function gapText(total: number | null, attributed: number): string {
  if (total == null) return "Not available";
  if (attributed > total) return "Not available. The row total is larger than the range total.";
  return String(total - attributed);
}

function rate(paid: number, trials: number): string {
  if (trials <= 0) return "Not available";
  return `${Math.round((100 * paid) / trials)}% (${paid} of ${trials})`;
}

function spendText(cents: number | null, readable: boolean): string {
  if (!readable) return "Not available";
  if (cents == null) return "Spend not recorded";
  return formatUnknownableUsdFromCents(cents);
}

function costText(cents: number | null, count: number, readable: boolean): string {
  if (!readable || cents == null || count <= 0) return "Not available";
  return formatUnknownableUsdFromCents(Math.round(cents / count));
}

function emptyCounts(): CohortCounts {
  return { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 0 };
}

function addCounts(into: CohortCounts, extra: CohortCounts) {
  into.retained += extra.retained;
  into.ended += extra.ended;
  into.rejoined += extra.rejoined;
  into.unknown += extra.unknown;
  into.immature += extra.immature;
}

function emptyChannel(channel: string): ChannelAcc {
  return {
    channel,
    visitors: 0,
    trials: 0,
    paid: 0,
    spendCents: null,
    d30: emptyCounts(),
    d60: emptyCounts(),
    d90: emptyCounts(),
  };
}

function emptyContent(args: {
  channel: string;
  platform: string;
  campaign: string;
  content: string;
}): ContentAcc {
  return {
    ...emptyChannel(args.channel),
    platform: args.platform,
    campaign: args.campaign,
    content: args.content,
    production: "Unknown",
    productions: new Set(),
  };
}

function mature(counts: CohortCounts): number {
  return counts.retained + counts.ended + counts.rejoined;
}

function byOutcome(a: ChannelAcc, b: ChannelAcc): number {
  return b.paid - a.paid || b.trials - a.trials || b.visitors - a.visitors || a.channel.localeCompare(b.channel);
}
