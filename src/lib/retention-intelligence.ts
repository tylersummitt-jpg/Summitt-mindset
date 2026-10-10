/**
 * Paid-membership retention. No Stripe or database reads.
 * A missing fact stays unknown. It is not counted as retained or churned.
 */

import { contentProductionLabel } from "@/lib/content-production";

export const RETENTION_DAY_MS = 86_400_000;
const CONTINUITY_SLACK_MS = RETENTION_DAY_MS;
const SMALL_SAMPLE = 15;
const MIN_GROUP_MATURE = 5;
const MAX_GROUPS = 8;

export const RETENTION_MILESTONES = [
  { label: "D30", days: 30 },
  { label: "D60", days: 60 },
  { label: "D90", days: 90 },
  { label: "D180", days: 180 },
  { label: "D365", days: 365 },
] as const;

export type RetentionInterval = "month" | "year" | "other";

export type RetentionSpell = {
  id: string;
  clerkUserId: string | null;
  paidStartMs: number;
  endedAtMs: number | null;
  endKnown: boolean;
  open: boolean;
  interval: RetentionInterval;
  cancellationReason: string | null;
  trialStartMs: number | null;
};

export type RetentionHit = {
  clerkUserId: string;
  atMs: number;
  signal: string;
};

export type RetentionAcquisition = {
  clerkUserId: string;
  source: string | null;
  campaign: string | null;
  content: string | null;
  landing: string | null;
  experiment: string | null;
  channel?: string | null;
  production?: string | null;
};

export type CohortCounts = {
  retained: number;
  ended: number;
  rejoined: number;
  unknown: number;
  immature: number;
};

export type AcquisitionCohortBucket = {
  channel: string;
  campaign: string;
  content: string;
  production: string;
  d30: CohortCounts;
  d60: CohortCounts;
  d90: CohortCounts;
};

export type RetentionIntelligenceInput = {
  nowMs: number;
  partial: boolean;
  partialReason: string | null;
  withheld: string | null;
  spells: RetentionSpell[];
  activeWithoutPayment: number;
  appleRows: number | null;
  customerFeedbackCount: number;
  engagementReadable: boolean;
  hits: RetentionHit[];
  measuredSignals: Array<{ id: string; label: string }>;
  acquisitionReadable: boolean;
  landingReadable: boolean;
  experimentReadable: boolean;
  acquisition: RetentionAcquisition[];
};

export type RetentionMilestone = {
  label: string;
  days: number;
  retained: number;
  ended: number;
  rejoined: number;
  unknown: number;
  immature: number;
  rate: string;
  coverage: string;
};

export type RetentionBand = { label: string; count: number };

export type RetentionMember = {
  clerkUserId: string;
  days: number;
  plan: string;
  state: "active" | "completed";
};

export type RetentionComparison = {
  label: string;
  window: "First 7 paid days" | "Free trial";
  usedRetained: number;
  usedMature: number;
  unusedRetained: number;
  unusedMature: number;
  usedRate: string;
  unusedRate: string;
  small: boolean;
};

export type RetentionGroup = {
  label: string;
  retained: number;
  ended: number;
  rejoined: number;
  unknown: number;
  immature: number;
  rate: string;
};

export type RetentionReadStatus = "not_loaded" | "unreadable" | "ready";

export type RetentionIntelligence = {
  status: RetentionReadStatus;
  partial: boolean;
  withheld: string | null;
  definition: string;
  milestones: RetentionMilestone[];
  completedCount: number;
  averageCompletedDays: string;
  medianCompletedDays: string;
  longestCompletedDays: string;
  longestActiveDays: string;
  activeCount: number;
  activeByBand: RetentionBand[];
  longestMembers: RetentionMember[];
  memberRequested: number;
  paymentFailure: number;
  otherKnown: number;
  unknownReason: number;
  endTimeUnknown: number;
  customerFeedbackCount: number;
  churnNote: string;
  engagementReadable: boolean;
  engagement: RetentionComparison[];
  trialEngagement: RetentionComparison[];
  engagementNote: string;
  acquisitionReadable: boolean;
  landingReadable: boolean;
  experimentReadable: boolean;
  sources: RetentionGroup[];
  campaigns: RetentionGroup[];
  content: RetentionGroup[];
  landings: RetentionGroup[];
  experiments: RetentionGroup[];
  cohortBuckets: AcquisitionCohortBucket[];
  sourceHiddenSmall: number;
  appleNote: string;
  limitations: string[];
  recommendedStep: string;
  bridge: string;
};

const DEFINITION =
  "Paid-membership retention. Entry is the first confirmed paid Stripe invoice for a Clerk member. Trial time is not counted. A member is continuously retained when that paid membership, or a plan change with no gap longer than one day, was still entitled at the milestone. Someone who canceled and paid again later is not counted as continuously retained. Members who are not old enough are left out. An annual plan stays active without a new monthly invoice.";

export const RETENTION_NOT_LOADED: RetentionIntelligence = emptyIntelligence({
  status: "not_loaded",
  definition: "Paid membership cohorts were not calculated in this snapshot.",
  bridge: "Long-term paid retention is calculated on Retention, not in this date range.",
  recommendedStep: "",
  limitations: [],
});

export function unreadableRetentionIntelligence(reason: string): RetentionIntelligence {
  return emptyIntelligence({
    status: "unreadable",
    definition: reason,
    bridge:
      "Long-term paid retention could not be read. Do not treat that as zero. Distribution totals on this page are unchanged.",
    recommendedStep: "Reload Retention after Stripe subscriptions and paid invoices can be read.",
    limitations: [`${reason} Do not treat that as zero retention.`],
  });
}

const ENTITLED_WITHOUT_END = new Set(["active", "past_due", "trialing"]);

export function spellFromSubscription(input: {
  id: string;
  clerkUserId: string | null;
  paidAtMs: number[];
  status: string;
  endedAtMs: number | null;
  paused: boolean;
  interval: RetentionInterval;
  cancellationReason: string | null;
  trialStartMs: number | null;
}): RetentionSpell | null {
  const paid = input.paidAtMs.filter((value) => Number.isFinite(value));
  if (paid.length === 0) return null;
  const endedAtMs =
    input.endedAtMs != null && Number.isFinite(input.endedAtMs) ? input.endedAtMs : null;
  const openWithoutEnd = input.paused || ENTITLED_WITHOUT_END.has(input.status);
  const endKnown = endedAtMs != null || openWithoutEnd;
  const open = endedAtMs == null && openWithoutEnd;
  return {
    id: input.id,
    clerkUserId: input.clerkUserId?.trim() || null,
    paidStartMs: Math.min(...paid),
    endedAtMs: endKnown && !open ? endedAtMs : null,
    endKnown,
    open,
    interval: input.interval,
    cancellationReason: endKnown && !open ? input.cancellationReason : null,
    trialStartMs:
      input.trialStartMs != null && Number.isFinite(input.trialStartMs)
        ? input.trialStartMs
        : null,
  };
}

type Chain = {
  clerkUserId: string;
  startMs: number;
  endMs: number | null;
  endKnown: boolean;
  open: boolean;
  rejoined: boolean;
  interval: RetentionInterval;
  reason: string | null;
  trialStartMs: number | null;
};

type MilestoneOutcome = "immature" | "unknown" | "retained" | "ended" | "rejoined";

export function buildRetentionIntelligence(
  input: RetentionIntelligenceInput
): RetentionIntelligence {
  if (input.withheld) {
    return emptyIntelligence({
      status: "ready",
      partial: true,
      withheld: input.withheld,
      definition: DEFINITION,
      bridge:
        "Long-term paid retention is not measurable from this read. Do not treat that as zero. Open Retention for the coverage note.",
      recommendedStep:
        "Do not quote paid retention until the Stripe history read finishes. This is a data limit, not a churn incident.",
      limitations: [input.withheld],
      appleNote: appleNote(input.appleRows),
    });
  }

  const missingClerk = input.spells.filter((spell) => !spell.clerkUserId).length;
  const byClerk = new Map<string, RetentionSpell[]>();
  for (const spell of input.spells) {
    if (!spell.clerkUserId) continue;
    const list = byClerk.get(spell.clerkUserId) ?? [];
    list.push(spell);
    byClerk.set(spell.clerkUserId, list);
  }

  const chainsByClerk = new Map<string, Chain[]>();
  for (const [clerkUserId, spells] of byClerk) {
    chainsByClerk.set(clerkUserId, chainSpells(clerkUserId, spells));
  }

  const milestones = RETENTION_MILESTONES.map((milestone) =>
    summarizeMilestone(milestone, chainsByClerk, input.nowMs)
  );
  const completed = completedDurations(chainsByClerk);
  const active = activeTenures(chainsByClerk, input.nowMs);
  const longest = longestMembers(chainsByClerk, input.nowMs);
  const churn = countChurn(chainsByClerk);
  const outcomes = new Map<string, MilestoneOutcome>();
  for (const [clerkUserId, chains] of chainsByClerk) {
    const first = chains[0];
    if (first) outcomes.set(clerkUserId, outcomeAt(first, chains.length > 1, input.nowMs, 30));
  }
  const engagement = buildComparisons({
    chainsByClerk,
    outcomes,
    hits: input.hits,
    signals: input.measuredSignals,
    readable: input.engagementReadable,
    window: "paid",
  });
  const trialEngagement = buildComparisons({
    chainsByClerk,
    outcomes,
    hits: input.hits,
    signals: input.measuredSignals,
    readable: input.engagementReadable,
    window: "trial",
  });
  const grouped = groupAcquisition(chainsByClerk, outcomes, input);
  const endTimeUnknown = [...chainsByClerk.values()].filter((chains) => chains[0] && !chains[0].endKnown)
    .length;
  const limitations = buildLimitations({
    input,
    missingClerk,
    endTimeUnknown,
    activeWithoutPayment: input.activeWithoutPayment,
  });
  const d30 = milestones[0];
  const mature = d30 ? d30.retained + d30.ended + d30.rejoined : 0;
  const recommendedStep = input.partial
    ? "Do not quote these retention rates as the whole business. The Stripe read was partial."
    : mature === 0
      ? "No paid member is old enough for day 30. Keep measuring. That is not an incident."
      : "Use Retention before changing acquisition. A higher rate in one source is an observation, not proof that the source is better.";
  const bridge = input.partial
    ? `Paid retention in this read is partial. ${d30?.rate ?? "Not available"}. Do not treat it as the whole business. Open Retention for coverage.`
    : mature === 0
      ? "No paid member is old enough for a 30-day retention rate. Long-term value is not measurable yet. Open Retention for the cohort rules."
      : `Mature paid retention, day 30: ${d30?.rate ?? "Not available"}. This is continuous paid membership, not trial starts. Source detail is on Retention.`;

  return {
    status: "ready",
    partial: input.partial,
    withheld: null,
    definition: DEFINITION,
    milestones,
    completedCount: completed.length,
    averageCompletedDays: averageText(completed),
    medianCompletedDays: medianText(completed),
    longestCompletedDays: longestCompletedText(chainsByClerk),
    longestActiveDays: active.length === 0 ? "Not available" : `${Math.max(...active)} days`,
    activeCount: active.length,
    activeByBand: bands(active),
    longestMembers: longest,
    memberRequested: churn.memberRequested,
    paymentFailure: churn.paymentFailure,
    otherKnown: churn.otherKnown,
    unknownReason: churn.unknownReason,
    endTimeUnknown,
    customerFeedbackCount: input.customerFeedbackCount,
    churnNote:
      "A canceled subscription is not counted as a member request unless Stripe recorded cancellation_requested. A failed payment is counted here only when the paid membership has an end time. Past due and paused memberships are still entitled. The app does not ask for a cancellation reason.",
    engagementReadable: input.engagementReadable,
    engagement,
    trialEngagement,
    engagementNote: input.engagementReadable
      ? "These comparisons are observations. They do not show that a feature caused someone to stay. Quiet coaching texts are not a system failure."
      : "First-week product use could not be read. Missing use is not treated as inactivity.",
    acquisitionReadable: input.acquisitionReadable,
    landingReadable: input.landingReadable,
    experimentReadable: input.experimentReadable,
    sources: grouped.sources.rows,
    campaigns: grouped.campaigns.rows,
    content: grouped.content.rows,
    landings: grouped.landings.rows,
    experiments: grouped.experiments.rows,
    cohortBuckets: input.acquisitionReadable
      ? cohortBuckets(chainsByClerk, input)
      : [],
    sourceHiddenSmall: grouped.sources.hiddenSmall,
    appleNote: appleNote(input.appleRows),
    limitations,
    recommendedStep,
    bridge,
  };
}

export function formatRetentionIntelligence(intel: RetentionIntelligence): string[] {
  if (intel.status === "not_loaded") {
    return [
      "RETENTION INTELLIGENCE",
      "Paid membership cohorts were not calculated in this snapshot.",
    ];
  }
  if (intel.status === "unreadable") {
    return ["RETENTION INTELLIGENCE", intel.definition, "Do not treat that as zero retention."];
  }
  const lines = [
    "RETENTION INTELLIGENCE",
    intel.definition,
    intel.partial
      ? "PARTIAL. Do not quote this as the whole business."
      : "The Stripe subscription and paid-invoice reads finished.",
  ];
  if (intel.withheld) {
    lines.push(intel.withheld);
    lines.push(intel.appleNote);
    return lines;
  }
  for (const milestone of intel.milestones) {
    lines.push(
      `${milestone.label}: ${milestone.rate}. Continuously retained ${milestone.retained}. Ended ${milestone.ended}. Rejoined ${milestone.rejoined}. Unknown ${milestone.unknown}. Not old enough ${milestone.immature}.`
    );
  }
  lines.push(
    `Completed paid periods: ${intel.completedCount}. Average ${intel.averageCompletedDays}. Median ${intel.medianCompletedDays}. Longest completed ${intel.longestCompletedDays}. Longest active ${intel.longestActiveDays}.`
  );
  lines.push(
    `Current paying members in this read: ${intel.activeCount}. Tenure: ${intel.activeByBand
      .map((band) => `${band.label} ${band.count}`)
      .join(", ")}.`
  );
  lines.push(
    `Ended paid periods: member-requested ${intel.memberRequested}, payment failure ${intel.paymentFailure}, other known ${intel.otherKnown}, unknown reason ${intel.unknownReason}. End time unknown ${intel.endTimeUnknown}.`
  );
  lines.push(intel.churnNote);
  lines.push(
    intel.customerFeedbackCount > 0
      ? `Stripe stored a feedback value on ${intel.customerFeedbackCount} ended memberships. Those words are not copied here.`
      : "No customer-written cancellation reason is stored on these ended memberships."
  );
  lines.push(intel.engagementNote);
  if (intel.engagement.length === 0) {
    lines.push("No first-paid-week comparison is available.");
  }
  for (const row of intel.engagement) {
    lines.push(
      `${row.window}, ${row.label}: used ${row.usedRate}; did not use ${row.unusedRate}.${row.small ? " Small sample." : ""}`
    );
  }
  for (const row of intel.trialEngagement) {
    lines.push(
      `${row.window}, ${row.label}: used ${row.usedRate}; did not use ${row.unusedRate}.${row.small ? " Small sample." : ""}`
    );
  }
  lines.push(
    intel.acquisitionReadable
      ? "Retention by first-touch source is an observation, not an experiment."
      : "Acquisition source could not be joined. Unknown is not filled in."
  );
  for (const row of intel.sources) {
    const mature = row.retained + row.ended + row.rejoined;
    lines.push(
      `Source ${row.label}: ${row.rate}. Unknown history ${row.unknown}. Not old enough ${row.immature}.${mature > 0 && mature < 15 ? " Small sample." : ""}`
    );
  }
  lines.push(intel.appleNote);
  lines.push(intel.recommendedStep);
  return lines;
}

function chainSpells(clerkUserId: string, spells: RetentionSpell[]): Chain[] {
  const sorted = [...spells].sort(
    (a, b) => a.paidStartMs - b.paidStartMs || a.id.localeCompare(b.id)
  );
  const chains: Chain[] = [];
  let current: Chain | null = null;
  for (const spell of sorted) {
    if (!current) {
      current = startChain(clerkUserId, spell, false);
      continue;
    }
    const continuous =
      current.endKnown &&
      !current.open &&
      current.endMs != null &&
      spell.paidStartMs <= current.endMs + CONTINUITY_SLACK_MS;
    const overlapsOpen = current.open && current.endKnown;
    if (continuous || overlapsOpen) {
      absorb(current, spell);
    } else {
      chains.push(current);
      current = startChain(clerkUserId, spell, true);
    }
  }
  if (current) chains.push(current);
  return chains;
}

function startChain(clerkUserId: string, spell: RetentionSpell, rejoined: boolean): Chain {
  const chain: Chain = {
    clerkUserId,
    startMs: spell.paidStartMs,
    endMs: null,
    endKnown: true,
    open: false,
    rejoined,
    interval: spell.interval,
    reason: null,
    trialStartMs: spell.trialStartMs,
  };
  absorb(chain, spell);
  chain.startMs = spell.paidStartMs;
  chain.rejoined = rejoined;
  chain.trialStartMs = spell.trialStartMs;
  return chain;
}

function absorb(chain: Chain, spell: RetentionSpell) {
  if (spell.interval === "year") chain.interval = "year";
  else if (chain.interval !== "year" && spell.interval === "month") chain.interval = "month";
  if (!spell.endKnown) {
    chain.endKnown = false;
    chain.open = false;
    chain.endMs = null;
    chain.reason = null;
    return;
  }
  if (spell.open) {
    chain.open = true;
    chain.endKnown = true;
    chain.endMs = null;
    chain.reason = null;
    return;
  }
  if (chain.open) return;
  if (spell.endedAtMs != null && (chain.endMs == null || spell.endedAtMs > chain.endMs)) {
    chain.endMs = spell.endedAtMs;
    chain.reason = spell.cancellationReason;
  }
}

function outcomeAt(
  first: Chain,
  hasLater: boolean,
  nowMs: number,
  days: number
): MilestoneOutcome {
  const at = first.startMs + days * RETENTION_DAY_MS;
  if (nowMs < at) return "immature";
  if (!first.endKnown) return "unknown";
  if (first.open || (first.endMs != null && first.endMs >= at)) return "retained";
  return hasLater ? "rejoined" : "ended";
}

function summarizeMilestone(
  milestone: { label: string; days: number },
  chainsByClerk: Map<string, Chain[]>,
  nowMs: number
): RetentionMilestone {
  const counts = { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 0 };
  for (const chains of chainsByClerk.values()) {
    const first = chains[0];
    if (!first) continue;
    counts[outcomeAt(first, chains.length > 1, nowMs, milestone.days)] += 1;
  }
  const mature = counts.retained + counts.ended + counts.rejoined;
  return {
    label: milestone.label,
    days: milestone.days,
    ...counts,
    rate: rateText(counts.retained, mature),
    coverage: `${counts.retained} continuously retained of ${mature} mature members. ${counts.unknown} unknown. ${counts.immature} not old enough. ${counts.rejoined} ended and paid again later, and are not continuously retained.`,
  };
}

function completedDurations(chainsByClerk: Map<string, Chain[]>): number[] {
  const days: number[] = [];
  for (const chains of chainsByClerk.values()) {
    for (const chain of chains) {
      if (chain.open || !chain.endKnown || chain.endMs == null) continue;
      days.push(Math.floor((chain.endMs - chain.startMs) / RETENTION_DAY_MS));
    }
  }
  return days;
}

function activeTenures(chainsByClerk: Map<string, Chain[]>, nowMs: number): number[] {
  const days: number[] = [];
  for (const chains of chainsByClerk.values()) {
    const open = chains.filter((chain) => chain.open && chain.endKnown);
    const current = open.sort((a, b) => b.startMs - a.startMs)[0];
    if (!current) continue;
    days.push(Math.max(0, Math.floor((nowMs - current.startMs) / RETENTION_DAY_MS)));
  }
  return days;
}

function longestCompletedText(chainsByClerk: Map<string, Chain[]>): string {
  const days = completedDurations(chainsByClerk);
  if (days.length === 0) return "Not available";
  return `${Math.max(...days)} days`;
}

function longestMembers(chainsByClerk: Map<string, Chain[]>, nowMs: number): RetentionMember[] {
  const rows: RetentionMember[] = [];
  for (const [clerkUserId, chains] of chainsByClerk) {
    let best: RetentionMember | null = null;
    for (const chain of chains) {
      if (!chain.endKnown) continue;
      const state = chain.open ? "active" : "completed";
      const end = chain.open ? nowMs : chain.endMs;
      if (end == null) continue;
      const days = Math.max(0, Math.floor((end - chain.startMs) / RETENTION_DAY_MS));
      if (!best || days > best.days) {
        best = { clerkUserId, days, plan: planLabel(chain.interval), state };
      }
    }
    if (best) rows.push(best);
  }
  return rows.sort((a, b) => b.days - a.days || a.clerkUserId.localeCompare(b.clerkUserId)).slice(0, 8);
}

function countChurn(chainsByClerk: Map<string, Chain[]>) {
  const counts = { memberRequested: 0, paymentFailure: 0, otherKnown: 0, unknownReason: 0 };
  for (const chains of chainsByClerk.values()) {
    for (const chain of chains) {
      if (chain.open || !chain.endKnown || chain.endMs == null) continue;
      const reason = chain.reason;
      if (reason === "cancellation_requested") counts.memberRequested += 1;
      else if (reason === "payment_failed") counts.paymentFailure += 1;
      else if (reason) counts.otherKnown += 1;
      else counts.unknownReason += 1;
    }
  }
  return counts;
}

function buildComparisons(args: {
  chainsByClerk: Map<string, Chain[]>;
  outcomes: Map<string, MilestoneOutcome>;
  hits: RetentionHit[];
  signals: Array<{ id: string; label: string }>;
  readable: boolean;
  window: "paid" | "trial";
}): RetentionComparison[] {
  if (!args.readable) return [];
  const hitsByMember = new Map<string, RetentionHit[]>();
  for (const hit of args.hits) {
    const list = hitsByMember.get(hit.clerkUserId) ?? [];
    list.push(hit);
    hitsByMember.set(hit.clerkUserId, list);
  }
  return args.signals.map((signal) => {
    let usedRetained = 0;
    let usedMature = 0;
    let unusedRetained = 0;
    let unusedMature = 0;
    for (const [clerkUserId, chains] of args.chainsByClerk) {
      const first = chains[0];
      const outcome = args.outcomes.get(clerkUserId);
      if (!first || (outcome !== "retained" && outcome !== "ended" && outcome !== "rejoined")) {
        continue;
      }
      const window = args.window === "paid" ? paidWeek(first) : trialWindow(first);
      if (!window) continue;
      const used = (hitsByMember.get(clerkUserId) ?? []).some(
        (hit) => hit.signal === signal.id && hit.atMs >= window.start && hit.atMs < window.end
      );
      const retained = outcome === "retained";
      if (used) {
        usedMature += 1;
        if (retained) usedRetained += 1;
      } else {
        unusedMature += 1;
        if (retained) unusedRetained += 1;
      }
    }
    return {
      label: signal.label,
      window: args.window === "paid" ? "First 7 paid days" : "Free trial",
      usedRetained,
      usedMature,
      unusedRetained,
      unusedMature,
      usedRate: rateText(usedRetained, usedMature),
      unusedRate: rateText(unusedRetained, unusedMature),
      small: usedMature < SMALL_SAMPLE || unusedMature < SMALL_SAMPLE,
    };
  });
}

function paidWeek(chain: Chain): { start: number; end: number } {
  return { start: chain.startMs, end: chain.startMs + 7 * RETENTION_DAY_MS };
}

function trialWindow(chain: Chain): { start: number; end: number } | null {
  if (chain.trialStartMs == null || chain.trialStartMs >= chain.startMs) return null;
  return { start: chain.trialStartMs, end: chain.startMs };
}

function cohortBuckets(
  chainsByClerk: Map<string, Chain[]>,
  input: RetentionIntelligenceInput
): AcquisitionCohortBucket[] {
  const acquisition = new Map(input.acquisition.map((row) => [row.clerkUserId, row]));
  const buckets = new Map<string, AcquisitionCohortBucket>();
  for (const [clerkUserId, chains] of chainsByClerk) {
    const first = chains[0];
    if (!first) continue;
    const row = acquisition.get(clerkUserId);
    const channel = row?.channel?.trim() || row?.source?.trim() || "Unknown";
    const campaign = row?.campaign?.trim() || "Unknown";
    const content = row?.content?.trim() || "Unknown";
    const production = contentProductionLabel(row?.production);
    const key = `${channel}\u0000${campaign}\u0000${content}\u0000${production}`;
    const bucket = buckets.get(key) ?? {
      channel,
      campaign,
      content,
      production,
      d30: emptyCohortCounts(),
      d60: emptyCohortCounts(),
      d90: emptyCohortCounts(),
    };
    addCohort(bucket.d30, outcomeAt(first, chains.length > 1, input.nowMs, 30));
    addCohort(bucket.d60, outcomeAt(first, chains.length > 1, input.nowMs, 60));
    addCohort(bucket.d90, outcomeAt(first, chains.length > 1, input.nowMs, 90));
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

function emptyCohortCounts(): CohortCounts {
  return { retained: 0, ended: 0, rejoined: 0, unknown: 0, immature: 0 };
}

function addCohort(counts: CohortCounts, outcome: MilestoneOutcome) {
  counts[outcome] += 1;
}

function groupAcquisition(
  chainsByClerk: Map<string, Chain[]>,
  outcomes: Map<string, MilestoneOutcome>,
  input: RetentionIntelligenceInput
) {
  const acquisition = new Map(input.acquisition.map((row) => [row.clerkUserId, row]));
  const members = [...chainsByClerk.keys()].map((clerkUserId) => {
    const row = acquisition.get(clerkUserId);
    return {
      clerkUserId,
      outcome: outcomes.get(clerkUserId) ?? "unknown",
      source: row?.source ?? null,
      campaign: row?.campaign ?? null,
      content: row?.content ?? null,
      landing: row?.landing ?? null,
      experiment: row?.experiment ?? null,
    };
  });
  return {
    sources: groupBy(members, input.acquisitionReadable, (row) => row.source, "Unknown"),
    campaigns: groupBy(members, input.acquisitionReadable, (row) => row.campaign, "Unknown"),
    content: groupBy(members, input.acquisitionReadable, (row) => row.content, "Unknown"),
    landings: groupBy(members, input.landingReadable, (row) => row.landing, "Unknown"),
    experiments: groupBy(
      members,
      input.experimentReadable,
      (row) => row.experiment,
      "Not in a controlled experiment"
    ),
  };
}

function groupBy<T extends { outcome: MilestoneOutcome }>(
  members: T[],
  readable: boolean,
  labelOf: (row: T) => string | null,
  unknownLabel: string
): { rows: RetentionGroup[]; hiddenSmall: number } {
  if (!readable) return { rows: [], hiddenSmall: 0 };
  const buckets = new Map<string, RetentionGroup>();
  for (const member of members) {
    const label = labelOf(member)?.trim() || unknownLabel;
    const bucket = buckets.get(label) ?? {
      label,
      retained: 0,
      ended: 0,
      rejoined: 0,
      unknown: 0,
      immature: 0,
      rate: "Not available",
    };
    if (member.outcome === "retained") bucket.retained += 1;
    else if (member.outcome === "ended") bucket.ended += 1;
    else if (member.outcome === "rejoined") bucket.rejoined += 1;
    else if (member.outcome === "immature") bucket.immature += 1;
    else bucket.unknown += 1;
    buckets.set(label, bucket);
  }
  const rows = [...buckets.values()].map((row) => ({
    ...row,
    rate: rateText(row.retained, row.retained + row.ended + row.rejoined),
  }));
  const visible: RetentionGroup[] = [];
  let hiddenSmall = 0;
  const ranked = rows.sort((a, b) => matureOf(b) - matureOf(a) || a.label.localeCompare(b.label));
  for (const row of ranked) {
    const keep = row.label === unknownLabel || row.label === "Unknown" || matureOf(row) >= MIN_GROUP_MATURE;
    if (!keep) {
      hiddenSmall += 1;
      continue;
    }
    if (visible.length >= MAX_GROUPS && row.label !== unknownLabel && row.label !== "Unknown") {
      hiddenSmall += 1;
      continue;
    }
    visible.push(row);
  }
  return { rows: visible, hiddenSmall };
}

function matureOf(row: RetentionGroup): number {
  return row.retained + row.ended + row.rejoined;
}

function buildLimitations(args: {
  input: RetentionIntelligenceInput;
  missingClerk: number;
  endTimeUnknown: number;
  activeWithoutPayment: number;
}): string[] {
  const lines = [
    "Trial days are not included in paid tenure.",
    "Feature comparisons are observations. They do not show that a feature caused someone to stay.",
    "Source comparisons use the existing first-touch attribution. They are not controlled experiments.",
    "Member-written cancellation reasons are not collected in the app. Weekly Feedback is the existing place to read their words.",
    appleNote(args.input.appleRows),
  ];
  if (args.input.partial && args.input.partialReason) lines.push(args.input.partialReason);
  if (args.activeWithoutPayment > 0) {
    lines.push(
      `${args.activeWithoutPayment} active Stripe subscriptions have no confirmed paid invoice. They are not in the paid cohort and are not counted as churned.`
    );
  }
  if (args.endTimeUnknown > 0) {
    lines.push(
      `${args.endTimeUnknown} paid memberships have no reliable end time. Their milestones are Unknown.`
    );
  }
  if (args.missingClerk > 0) {
    lines.push(
      `${args.missingClerk} paid subscriptions have no Clerk user id. They are unknown and were not matched another way.`
    );
  }
  if (!args.input.engagementReadable) {
    lines.push("First-week product use could not be read. That is not counted as inactivity.");
  }
  if (!args.input.acquisitionReadable) {
    lines.push("First-touch source could not be joined to paid members.");
  }
  return lines;
}

function appleNote(appleRows: number | null): string {
  if (appleRows == null) {
    return "Apple memberships could not be counted. They are not in this paid cohort, and they are not counted as churned.";
  }
  return `Apple memberships are not in this paid cohort because a first confirmed Apple payment time is not stored. ${appleRows} Apple rows were seen. They are not counted as churned.`;
}

function bands(days: number[]): RetentionBand[] {
  const labels = [
    { label: "Under 30 days", test: (value: number) => value < 30 },
    { label: "30–59 days", test: (value: number) => value >= 30 && value < 60 },
    { label: "60–89 days", test: (value: number) => value >= 60 && value < 90 },
    { label: "90–179 days", test: (value: number) => value >= 90 && value < 180 },
    { label: "180–364 days", test: (value: number) => value >= 180 && value < 365 },
    { label: "365+ days", test: (value: number) => value >= 365 },
  ];
  return labels.map((band) => ({
    label: band.label,
    count: days.filter((value) => band.test(value)).length,
  }));
}

function rateText(retained: number, mature: number): string {
  if (mature <= 0) return "Not available";
  return `${Math.round((100 * retained) / mature)}% (${retained} of ${mature})`;
}

function averageText(values: number[]): string {
  if (values.length === 0) return "Not available";
  const total = values.reduce((sum, value) => sum + value, 0);
  return `${Math.round(total / values.length)} days`;
}

function medianText(values: number[]): string {
  if (values.length === 0) return "Not available";
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return `${value} days`;
}

function planLabel(interval: RetentionInterval): string {
  if (interval === "year") return "Annual";
  if (interval === "month") return "Monthly";
  return "Plan not specified";
}

function emptyIntelligence(args: {
  status: RetentionReadStatus;
  definition: string;
  bridge: string;
  recommendedStep: string;
  limitations: string[];
  partial?: boolean;
  withheld?: string | null;
  appleNote?: string;
}): RetentionIntelligence {
  return {
    status: args.status,
    partial: args.partial ?? false,
    withheld: args.withheld ?? null,
    definition: args.definition,
    milestones: [],
    completedCount: 0,
    averageCompletedDays: "Not available",
    medianCompletedDays: "Not available",
    longestCompletedDays: "Not available",
    longestActiveDays: "Not available",
    activeCount: 0,
    activeByBand: [],
    longestMembers: [],
    memberRequested: 0,
    paymentFailure: 0,
    otherKnown: 0,
    unknownReason: 0,
    endTimeUnknown: 0,
    customerFeedbackCount: 0,
    churnNote: "",
    engagementReadable: false,
    engagement: [],
    trialEngagement: [],
    engagementNote: "",
    acquisitionReadable: false,
    landingReadable: false,
    experimentReadable: false,
    sources: [],
    campaigns: [],
    content: [],
    landings: [],
    experiments: [],
    cohortBuckets: [],
    sourceHiddenSmall: 0,
    appleNote: args.appleNote ?? "",
    limitations: args.limitations,
    recommendedStep: args.recommendedStep,
    bridge: args.bridge,
  };
}
