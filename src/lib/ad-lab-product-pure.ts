/**
 * Rules for the Summitt Ad Lab. No network, no Stripe calls.
 * A Meta-reported conversion is never treated as a Stripe subscriber.
 * Creative-level attribution requires utm_content to be the Meta ad id.
 */

import type { AdLabPanel } from "@/lib/ad-lab-import-pure";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const AD_LAB_ID = /^[0-9]{5,20}$/;

export type AdLabOutcomePerson = {
  clerkUserId: string;
  utmContent: string | null;
  utmCampaign: string | null;
  trialStartUnix: number | null;
  trialEndUnix: number | null;
  trialing: boolean;
  paid: boolean | null;
  interval: "month" | "year" | null;
};

export type AdLabNotes = {
  hook: string;
  angle: string;
  audience: string;
  emotion: string;
  personFeatured: string;
  offer: string;
  concept: string;
  hypothesis: string;
  variableChanged: string;
  notes: string;
};

export const EMPTY_NOTES: AdLabNotes = {
  hook: "",
  angle: "",
  audience: "",
  emotion: "",
  personFeatured: "",
  offer: "",
  concept: "",
  hypothesis: "",
  variableChanged: "",
  notes: "",
};

export type AdLabCreative = {
  body: string | null;
  headline: string | null;
  cta: string | null;
  link: string | null;
  thumbnailUrl: string | null;
  format: string | null;
};

export type AdLabAdCard = {
  metaAdId: string;
  adName: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  status: string | null;
  creativeId: string | null;
  spendCents: number | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  /** Outbound clicks divided by impressions. Null when either number is missing or impressions are 0. */
  outboundCtr: number | null;
  cpmCents: number | null;
  costPerOutboundClickCents: number | null;
  costPerLandingPageViewCents: number | null;
  /** Trials whose start date is inside the same window as this spend. Null when the cohort cannot be trusted. */
  trials: number | null;
  stillTrialing: number | null;
  maturedUnpaid: number | null;
  paidMonthly: number | null;
  paidAnnual: number | null;
  /** Same ad, trial started after the spend window. Not used in cost. */
  trialsAfterWindow: number | null;
  costPerTrialCents: number | null;
  costPerPaidCents: number | null;
  economicsNote: string | null;
  creative: AdLabCreative | null;
  notes: AdLabNotes;
};

export type AdLabExperimentAd = {
  metaAdId: string;
  role: "included" | "control" | "challenger";
  adNameSnapshot: string;
  campaignNameSnapshot: string | null;
  card: AdLabAdCard | null;
};

export type AdLabExperimentView = {
  id: string;
  name: string;
  question: string;
  hypothesis: string;
  successMetric: string;
  status: "draft" | "active" | "completed" | "archived";
  startsOn: string | null;
  reviewOn: string | null;
  plannedDays: number | null;
  budgetCents: number | null;
  stopSpendCents: number | null;
  stopClicks: number | null;
  stopTrials: number | null;
  variableTested: string;
  notes: string;
  outcome: string;
  winnerMetaAdId: string | null;
  whatWorked: string;
  whatDidnt: string;
  decision: string;
  nextTest: string;
  ads: AdLabExperimentAd[];
  spendCents: number | null;
  evidence: string;
  comparisonNote: string;
  windowSince: string | null;
  windowUntil: string | null;
};

export type AdLabRecommendation = {
  says: string;
  learned: string;
  next: string;
};

export type AdLabLab = {
  currency: string;
  timezone: string;
  rangeSince: string;
  rangeUntil: string;
  lastImportedAt: string | null;
  stale: boolean;
  activeCount: number | null;
  todaySpendCents: number | null;
  weekSpendCents: number | null;
  rangeSpendCents: number | null;
  paymentsKnown: boolean;
  subscriptionsComplete: boolean;
  attributionComplete: boolean;
  adAttributedTrials: number | null;
  campaignOnlyTrials: number | null;
  unattributedTrials: number | null;
  stillTrialing: number | null;
  paidMonthly: number | null;
  paidAnnual: number | null;
  ads: AdLabAdCard[];
  experiments: AdLabExperimentView[];
  recommendation: AdLabRecommendation;
  storageReady: boolean;
  creativeRead: "ready" | "unavailable";
};

export type AdLabIdentityInput = {
  metaAdId: string;
  adName: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  effectiveStatus: string | null;
  creativeId: string | null;
};

export type AdLabDayInput = {
  metaAdId: string;
  spendDate: string;
  spendCents: number | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
};

export type AdLabExperimentInput = {
  id: string;
  name: string;
  question: string;
  hypothesis: string;
  successMetric: string;
  status: AdLabExperimentView["status"];
  startsOn: string | null;
  reviewOn: string | null;
  plannedDays: number | null;
  budgetCents: number | null;
  stopSpendCents: number | null;
  stopClicks: number | null;
  stopTrials: number | null;
  variableTested: string;
  notes: string;
  outcome: string;
  winnerMetaAdId: string | null;
  whatWorked: string;
  whatDidnt: string;
  decision: string;
  nextTest: string;
  ads: {
    metaAdId: string;
    role: AdLabExperimentAd["role"];
    adNameSnapshot: string;
    campaignNameSnapshot: string | null;
  }[];
};

function add(left: number | null, right: number | null): number | null {
  if (left == null || right == null) return null;
  return left + right;
}

function sumField(
  rows: readonly { value: number | null }[]
): number | null {
  if (rows.length === 0) return null;
  return rows.reduce<number | null>((total, row) => add(total, row.value), 0);
}

export function costPer(spendCents: number | null, count: number | null): number | null {
  if (spendCents == null || count == null || count <= 0) return null;
  return Math.round(spendCents / count);
}

export function outboundCtr(clicks: number | null, impressions: number | null): number | null {
  if (clicks == null || impressions == null || impressions <= 0) return null;
  return clicks / impressions;
}

export function cpmCents(spendCents: number | null, impressions: number | null): number | null {
  if (spendCents == null || impressions == null || impressions <= 0) return null;
  return Math.round((spendCents / impressions) * 1000);
}

export function attributionLevel(
  person: Pick<AdLabOutcomePerson, "utmContent" | "utmCampaign">,
  ads: readonly { metaAdId: string; campaignId: string | null }[]
): { level: "ad"; metaAdId: string } | { level: "campaign"; campaignId: string } | { level: "none" } {
  const content = person.utmContent?.trim() ?? "";
  if (AD_LAB_ID.test(content) && ads.some((ad) => ad.metaAdId === content)) {
    return { level: "ad", metaAdId: content };
  }
  const campaign = person.utmCampaign?.trim() ?? "";
  if (AD_LAB_ID.test(campaign) && ads.some((ad) => ad.campaignId === campaign)) {
    return { level: "campaign", campaignId: campaign };
  }
  return { level: "none" };
}

function tally(people: readonly AdLabOutcomePerson[], paymentsKnown: boolean) {
  let trials = 0;
  let stillTrialing = 0;
  let maturedUnpaid = 0;
  let paidMonthly = 0;
  let paidAnnual = 0;
  let paidUnknownInterval = 0;
  for (const person of people) {
    trials += 1;
    if (person.trialing) stillTrialing += 1;
    if (!paymentsKnown || person.paid == null) continue;
    if (person.paid && person.interval === "month") paidMonthly += 1;
    else if (person.paid && person.interval === "year") paidAnnual += 1;
    else if (person.paid) paidUnknownInterval += 1;
    else if (!person.trialing) maturedUnpaid += 1;
  }
  return {
    trials,
    stillTrialing,
    maturedUnpaid: paymentsKnown ? maturedUnpaid : null,
    paidMonthly: paymentsKnown ? paidMonthly : null,
    paidAnnual: paymentsKnown ? paidAnnual : null,
    paidTotal: paymentsKnown ? paidMonthly + paidAnnual + paidUnknownInterval : null,
  };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function trialStartDate(unix: number | null, timezone: string): string | null {
  if (unix == null || !Number.isFinite(unix)) return null;
  try {
    const key = getDateKeyInTimezone(new Date(unix * 1000), timezone);
    return DATE_KEY.test(key) ? key : null;
  } catch {
    return null;
  }
}

export type AdLabCohortEconomics = {
  spendCents: number | null;
  impressions: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  trials: number | null;
  stillTrialing: number | null;
  maturedUnpaid: number | null;
  paidMonthly: number | null;
  paidAnnual: number | null;
  trialsAfterWindow: number | null;
  costPerTrialCents: number | null;
  costPerPaidCents: number | null;
  economicsNote: string | null;
};

/**
 * Spend and trials share one inclusive date window.
 * A trial counts only when its start date is inside that window.
 * A later trial is reported separately and is not part of either cost.
 */
export function cohortEconomics(args: {
  days: readonly AdLabDayInput[];
  metaAdId: string;
  since: string;
  until: string;
  people: readonly AdLabOutcomePerson[];
  identities: readonly { metaAdId: string; campaignId: string | null }[];
  timezone: string;
  paymentsKnown: boolean;
  reliable: boolean;
  covered: boolean;
}): AdLabCohortEconomics {
  const blank = (note: string): AdLabCohortEconomics => ({
    spendCents: null,
    impressions: null,
    outboundClicks: null,
    landingPageViews: null,
    trials: null,
    stillTrialing: null,
    maturedUnpaid: null,
    paidMonthly: null,
    paidAnnual: null,
    trialsAfterWindow: null,
    costPerTrialCents: null,
    costPerPaidCents: null,
    economicsNote: note,
  });
  if (!DATE_KEY.test(args.since) || !DATE_KEY.test(args.until) || args.until < args.since) {
    return blank("These dates are not a usable measurement window, so cost is unavailable.");
  }
  if (!args.covered) {
    return blank("Delivery for these dates is not all stored, so cost is unavailable.");
  }
  const days = args.days.filter(
    (day) => day.metaAdId === args.metaAdId && day.spendDate >= args.since && day.spendDate <= args.until
  );
  const spendCents = sumField(days.map((day) => ({ value: day.spendCents })));
  const impressions = sumField(days.map((day) => ({ value: day.impressions })));
  const outboundClicks = sumField(days.map((day) => ({ value: day.outboundClicks })));
  const landingPageViews = sumField(days.map((day) => ({ value: day.landingPageViews })));
  const delivery = {
    spendCents,
    impressions,
    outboundClicks,
    landingPageViews,
  };
  if (!args.reliable) {
    return {
      ...delivery,
      trials: null,
      stillTrialing: null,
      maturedUnpaid: null,
      paidMonthly: null,
      paidAnnual: null,
      trialsAfterWindow: null,
      costPerTrialCents: null,
      costPerPaidCents: null,
      economicsNote: "Trial matching is incomplete, so cost per result is unavailable.",
    };
  }
  const matched = args.people.filter((person) => {
    const level = attributionLevel(person, args.identities);
    return level.level === "ad" && level.metaAdId === args.metaAdId;
  });
  const inWindow: AdLabOutcomePerson[] = [];
  const after: AdLabOutcomePerson[] = [];
  let undated = false;
  for (const person of matched) {
    const started = trialStartDate(person.trialStartUnix, args.timezone);
    if (!started) {
      undated = true;
      continue;
    }
    if (started >= args.since && started <= args.until) inWindow.push(person);
    else if (started > args.until) after.push(person);
  }
  if (undated) {
    return {
      ...delivery,
      trials: null,
      stillTrialing: null,
      maturedUnpaid: null,
      paidMonthly: null,
      paidAnnual: null,
      trialsAfterWindow: null,
      costPerTrialCents: null,
      costPerPaidCents: null,
      economicsNote: "A matched trial has no start date, so cost is unavailable.",
    };
  }
  const counts = tally(inWindow, args.paymentsKnown);
  const trialsAfterWindow = after.length;
  let economicsNote: string | null = null;
  let costPerTrialCents: number | null = null;
  let costPerPaidCents: number | null = null;
  if (spendCents == null) {
    economicsNote = "Spend for these dates is incomplete, so cost is unavailable.";
  } else if (counts.trials === 0) {
    costPerTrialCents = null;
    economicsNote =
      trialsAfterWindow > 0
        ? "No trial started in these dates. A later trial is kept separate and is not part of the cost."
        : "No verified trial started in these dates, so cost per trial is unavailable.";
  } else {
    costPerTrialCents = costPer(spendCents, counts.trials);
    if (!args.paymentsKnown) {
      economicsNote = "Paid invoices are incomplete, so cost per paying subscriber is unavailable.";
    } else if (counts.stillTrialing > 0) {
      economicsNote = "Someone who started in these dates is still trialing, so cost per paying subscriber is not ready.";
    } else if ((counts.paidTotal ?? 0) === 0) {
      economicsNote = "These trials have ended without a paying subscriber, so that cost is unavailable.";
    } else {
      costPerPaidCents = costPer(spendCents, counts.paidTotal);
    }
  }
  return {
    ...delivery,
    trials: counts.trials,
    stillTrialing: counts.stillTrialing,
    maturedUnpaid: counts.maturedUnpaid,
    paidMonthly: counts.paidMonthly,
    paidAnnual: counts.paidAnnual,
    trialsAfterWindow,
    costPerTrialCents,
    costPerPaidCents,
    economicsNote,
  };
}

export function buildAdCards(args: {
  identities: readonly AdLabIdentityInput[];
  days: readonly AdLabDayInput[];
  rangeSince: string;
  rangeUntil: string;
  loadedSince: string;
  loadedUntil: string;
  timezone: string;
  people: readonly AdLabOutcomePerson[];
  paymentsKnown: boolean;
  reliable: boolean;
  notesByAd: ReadonlyMap<string, AdLabNotes>;
  creativeByAd: ReadonlyMap<string, AdLabCreative>;
}): AdLabAdCard[] {
  const covered = args.rangeSince >= args.loadedSince && args.rangeUntil <= args.loadedUntil;
  return args.identities.map((ad) => {
    const economics = cohortEconomics({
      days: args.days,
      metaAdId: ad.metaAdId,
      since: args.rangeSince,
      until: args.rangeUntil,
      people: args.people,
      identities: args.identities,
      timezone: args.timezone,
      paymentsKnown: args.paymentsKnown,
      reliable: args.reliable,
      covered,
    });
    return {
      metaAdId: ad.metaAdId,
      adName: ad.adName,
      campaignId: ad.campaignId,
      campaignName: ad.campaignName,
      adsetName: ad.adsetName,
      status: ad.effectiveStatus,
      creativeId: ad.creativeId,
      spendCents: economics.spendCents,
      impressions: economics.impressions,
      outboundClicks: economics.outboundClicks,
      landingPageViews: economics.landingPageViews,
      outboundCtr: outboundCtr(economics.outboundClicks, economics.impressions),
      cpmCents: cpmCents(economics.spendCents, economics.impressions),
      costPerOutboundClickCents: costPer(economics.spendCents, economics.outboundClicks),
      costPerLandingPageViewCents: costPer(economics.spendCents, economics.landingPageViews),
      trials: economics.trials,
      stillTrialing: economics.stillTrialing,
      maturedUnpaid: economics.maturedUnpaid,
      paidMonthly: economics.paidMonthly,
      paidAnnual: economics.paidAnnual,
      trialsAfterWindow: economics.trialsAfterWindow,
      costPerTrialCents: economics.costPerTrialCents,
      costPerPaidCents: economics.costPerPaidCents,
      economicsNote: economics.economicsNote,
      creative: args.creativeByAd.get(ad.metaAdId) ?? null,
      notes: args.notesByAd.get(ad.metaAdId) ?? EMPTY_NOTES,
    };
  });
}

function evidenceFor(ads: readonly AdLabAdCard[]): { evidence: string; note: string } {
  const live = ads.filter((ad) => ad != null);
  if (live.length < 2) {
    return {
      evidence: "Not enough evidence",
      note: "Add at least two advertisements before comparing them.",
    };
  }
  const thin = live.some(
    (ad) =>
      ad.impressions == null ||
      ad.trials == null ||
      ad.impressions < 100 ||
      ad.outboundClicks == null ||
      (ad.outboundClicks < 10 && ad.trials < 3)
  );
  if (thin) {
    return {
      evidence: "Not enough evidence",
      note: "One or more ads are missing delivery numbers or are still too small to compare. A handful of clicks is not a winner.",
    };
  }
  const ranked = [...live].sort(
    (a, b) => (b.trials ?? 0) - (a.trials ?? 0) || (b.outboundClicks ?? 0) - (a.outboundClicks ?? 0)
  );
  const best = ranked[0];
  const rest = ranked.slice(1);
  const bestTrials = best.trials ?? 0;
  const othersHaveTrials = rest.every((ad) => (ad.trials ?? 0) >= 5);
  if (bestTrials >= 5 && othersHaveTrials && rest.every((ad) => bestTrials >= (ad.trials ?? 0) * 2)) {
    return {
      evidence: "Stronger observed performer",
      note: `${best.adName} has at least twice the verified trials that started in this experiment's dates. That is an observation, not a proof.`,
    };
  }
  const quiet = live.find(
    (ad) => (ad.impressions ?? 0) >= 200 && (ad.outboundClicks ?? 0) === 0
  );
  const loud = live.find((ad) => (ad.outboundClicks ?? 0) >= 20);
  if (quiet && loud) {
    return {
      evidence: "Clear underperformer",
      note: `${quiet.adName} was shown at least 200 times and produced no outbound clicks, while another ad in this comparison did.`,
    };
  }
  return {
    evidence: "Early directional leader",
    note: `${best.adName} is ahead on the numbers we have. Keep the comparison going before treating it as a decision.`,
  };
}

export function experimentWindow(
  experiment: Pick<AdLabExperimentInput, "startsOn" | "reviewOn">,
  todayKey: string
): { since: string; until: string } | null {
  if (!experiment.startsOn || !DATE_KEY.test(experiment.startsOn) || !DATE_KEY.test(todayKey)) return null;
  const review = experiment.reviewOn && DATE_KEY.test(experiment.reviewOn) ? experiment.reviewOn : todayKey;
  const until = review < todayKey ? review : todayKey;
  if (until < experiment.startsOn) return null;
  return { since: experiment.startsOn, until };
}

export function buildExperiments(args: {
  experiments: readonly AdLabExperimentInput[];
  identities: readonly AdLabIdentityInput[];
  days: readonly AdLabDayInput[];
  people: readonly AdLabOutcomePerson[];
  timezone: string;
  todayKey: string;
  loadedSince: string;
  loadedUntil: string;
  paymentsKnown: boolean;
  reliable: boolean;
  notesByAd: ReadonlyMap<string, AdLabNotes>;
  creativeByAd: ReadonlyMap<string, AdLabCreative>;
}): AdLabExperimentView[] {
  return args.experiments.map((experiment) => {
    const window = experimentWindow(experiment, args.todayKey);
    if (!window) {
      const ads = experiment.ads.map((ad) => ({ ...ad, card: null }));
      return {
        ...experiment,
        ads,
        spendCents: null,
        evidence: "Not enough evidence",
        comparisonNote: experiment.startsOn
          ? "This experiment has not started, so there is no cost to compare."
          : "This experiment has no start date, so spend and trials are not compared.",
        windowSince: null,
        windowUntil: null,
      };
    }
    const covered = window.since >= args.loadedSince && window.until <= args.loadedUntil;
    const ads = experiment.ads.map((member) => {
      const identity = args.identities.find((ad) => ad.metaAdId === member.metaAdId);
      const economics = cohortEconomics({
        days: args.days,
        metaAdId: member.metaAdId,
        since: window.since,
        until: window.until,
        people: args.people,
        identities: args.identities,
        timezone: args.timezone,
        paymentsKnown: args.paymentsKnown,
        reliable: args.reliable,
        covered,
      });
      const card: AdLabAdCard = {
        metaAdId: member.metaAdId,
        adName: identity?.adName ?? member.adNameSnapshot,
        campaignId: identity?.campaignId ?? null,
        campaignName: identity?.campaignName ?? member.campaignNameSnapshot,
        adsetName: identity?.adsetName ?? null,
        status: identity?.effectiveStatus ?? null,
        creativeId: identity?.creativeId ?? null,
        spendCents: economics.spendCents,
        impressions: economics.impressions,
        outboundClicks: economics.outboundClicks,
        landingPageViews: economics.landingPageViews,
        outboundCtr: outboundCtr(economics.outboundClicks, economics.impressions),
        cpmCents: cpmCents(economics.spendCents, economics.impressions),
        costPerOutboundClickCents: costPer(economics.spendCents, economics.outboundClicks),
        costPerLandingPageViewCents: costPer(economics.spendCents, economics.landingPageViews),
        trials: economics.trials,
        stillTrialing: economics.stillTrialing,
        maturedUnpaid: economics.maturedUnpaid,
        paidMonthly: economics.paidMonthly,
        paidAnnual: economics.paidAnnual,
        trialsAfterWindow: economics.trialsAfterWindow,
        costPerTrialCents: economics.costPerTrialCents,
        costPerPaidCents: economics.costPerPaidCents,
        economicsNote: economics.economicsNote,
        creative: args.creativeByAd.get(member.metaAdId) ?? null,
        notes: args.notesByAd.get(member.metaAdId) ?? EMPTY_NOTES,
      };
      return { ...member, card };
    });
    const cards = ads.map((ad) => ad.card).filter((card): card is AdLabAdCard => card != null);
    const spendCents = sumField(cards.map((card) => ({ value: card.spendCents })));
    const judged = evidenceFor(cards);
    const evidence =
      experiment.status === "completed" ? `Experiment complete. ${judged.evidence}` : judged.evidence;
    const basis = `Measured ${window.since} through ${window.until}. Spend and trials both use those dates. A trial that started later is not part of the cost.`;
    return {
      ...experiment,
      ads,
      spendCents,
      evidence,
      comparisonNote: `${basis} ${judged.note}`,
      windowSince: window.since,
      windowUntil: window.until,
    };
  });
}

export function recommend(args: {
  ads: readonly AdLabAdCard[];
  experiments: readonly AdLabExperimentView[];
  stale: boolean;
  lastImportedAt: string | null;
  adAttributedTrials: number | null;
  campaignOnlyTrials: number | null;
  unattributedTrials: number | null;
  paymentsKnown: boolean;
  subscriptionsComplete: boolean;
  attributionComplete: boolean;
}): AdLabRecommendation {
  if (!args.lastImportedAt) {
    return {
      says: "No stored Meta delivery yet. The scheduled import has not written a day for this account.",
      learned: "There is nothing to learn from delivery until the first successful import.",
      next: "Wait for the next import, then open Live Ads. Do not enter these Meta numbers into the hand-entered spend form.",
    };
  }
  if (args.stale) {
    return {
      says: "The last successful import is more than 36 hours old, so today’s picture may be incomplete.",
      learned: "A stale import is not a performance result.",
      next: "Check that the Ad Lab import ran before changing an advertisement.",
    };
  }
  if (!args.attributionComplete) {
    return {
      says: "First-touch records are incomplete, so trial costs are hidden.",
      learned: "A partial match would look like a real cost. It is not one.",
      next: "Use the delivery numbers until the first-touch read is complete.",
    };
  }
  if (!args.subscriptionsComplete || args.adAttributedTrials == null || args.campaignOnlyTrials == null || args.unattributedTrials == null) {
    return {
      says: "Stripe subscriptions could not be fully read, so trial and paid results are hidden.",
      learned: "A partial list would look like a real result. It is not one.",
      next: "Use the delivery numbers. Decide on trials after the subscription list is complete.",
    };
  }
  const adAttributedTrials = args.adAttributedTrials;
  const campaignOnlyTrials = args.campaignOnlyTrials;
  const unattributedTrials = args.unattributedTrials;
  const active = args.experiments.find((experiment) => experiment.status === "active");
  if (active && active.evidence === "Not enough evidence") {
    return {
      says: active.comparisonNote,
      learned: active.hypothesis.trim()
        ? `This test is still about: ${active.hypothesis.trim()}`
        : "The comparison has not answered its question yet.",
      next: "Hold this comparison. Do not start a new variable until these ads have more results.",
    };
  }
  if (active && active.evidence === "Clear underperformer") {
    return {
      says: active.comparisonNote,
      learned: "One advertisement is being shown and is not earning outbound clicks.",
      next: "Pause that underperformer only after you look at it. The Lab cannot change Meta for you.",
    };
  }
  if (active && active.evidence === "Stronger observed performer") {
    return {
      says: active.comparisonNote,
      learned: active.variableTested.trim()
        ? `The difference being tested is ${active.variableTested.trim()}.`
        : "One ad is ahead on verified trials.",
      next: "Keep the leader running and write down what was different before you test a new variable.",
    };
  }
  const totals = {
    impressions: sumField(args.ads.map((ad) => ({ value: ad.impressions }))),
    clicks: sumField(args.ads.map((ad) => ({ value: ad.outboundClicks }))),
    landing: sumField(args.ads.map((ad) => ({ value: ad.landingPageViews }))),
  };
  const ctr = outboundCtr(totals.clicks, totals.impressions);
  if ((totals.impressions ?? 0) >= 1000 && ctr != null && ctr < 0.005) {
    return {
      says: "These ads are being shown, and fewer than 1 in 200 impressions becomes an outbound click.",
      learned: "The opening is not earning the click. This is a hypothesis, not a proof of cause.",
      next: "Create the next ad by changing the opening hook only. Keep the audience and offer the same.",
    };
  }
  if ((totals.clicks ?? 0) >= 20 && totals.landing == null) {
    return {
      says: "Meta reported outbound clicks, and landing-page views were not in the import.",
      learned: "A missing landing-page number is a measurement gap. It is not proof the page failed.",
      next: "Do not judge the landing page from this gap. Compare ads on outbound clicks until landing-page views arrive.",
    };
  }
  if ((totals.landing ?? 0) >= 20 && adAttributedTrials === 0 && (campaignOnlyTrials > 0 || unattributedTrials > 0)) {
    return {
      says: "In the selected dates, people are reaching the site and trials started, but those trials are not tied to one advertisement.",
      learned: "First touch is stored as a campaign or a label, not the Meta ad id. Creative-level cost per trial is unavailable.",
      next: "Use the campaign result for the decision. Do not treat one creative as the winner.",
    };
  }
  if ((totals.landing ?? 0) >= 30 && adAttributedTrials === 0 && campaignOnlyTrials === 0 && unattributedTrials === 0) {
    return {
      says: "In the selected dates, landing-page views are coming in and no verified Stripe trial started.",
      learned: "The page, the offer, or the checkout path may be the limit. That is a hypothesis.",
      next: "Review the landing page before making another creative. Do not start a new ad test until this is looked at.",
    };
  }
  const still = args.ads.reduce((sum, ad) => sum + (ad.stillTrialing ?? 0), 0);
  const paid = (args.ads.reduce((sum, ad) => sum + (ad.paidMonthly ?? 0) + (ad.paidAnnual ?? 0), 0));
  if (args.paymentsKnown && adAttributedTrials >= 3 && still >= adAttributedTrials && paid === 0) {
    return {
      says: "In the selected dates, verified trials started, and those people are still inside the trial.",
      learned: "A trial that has not ended is not a failed subscriber.",
      next: "Wait until the trial ends before judging paid conversion. Keep the current ads running.",
    };
  }
  if (args.ads.filter((ad) => ad.status === "ACTIVE").length >= 2 && !active) {
    return {
      says: "More than one ad is active, and no experiment is recording the comparison.",
      learned: "Without an experiment, later renames will make it harder to remember what was tested.",
      next: "Start an experiment with the ads you are actually comparing. Leave budget and duration blank if you have not chosen them.",
    };
  }
  return {
    says: "Delivery is importing, and nothing in the current numbers is strong enough to change course.",
    learned: "Hold the current message until a comparison has enough clicks or verified trials.",
    next: "Keep the current leader running. Write a note on the ad if you want the learning library to remember the hook.",
  };
}

export function assembleLab(args: {
  identities: readonly AdLabIdentityInput[];
  days: readonly AdLabDayInput[];
  rangeSince: string;
  rangeUntil: string;
  loadedSince: string;
  loadedUntil: string;
  todayKey: string;
  currency: string;
  timezone: string;
  lastImportedAt: string | null;
  stale: boolean;
  activeCount: number | null;
  todaySpendCents: number | null;
  weekSpendCents: number | null;
  people: readonly AdLabOutcomePerson[];
  paymentsKnown: boolean;
  subscriptionsComplete: boolean;
  attributionComplete: boolean;
  notesByAd: ReadonlyMap<string, AdLabNotes>;
  creativeByAd: ReadonlyMap<string, AdLabCreative>;
  experiments: readonly AdLabExperimentInput[];
  storageReady: boolean;
  creativeRead: "ready" | "unavailable";
}): AdLabLab {
  const reliable = args.subscriptionsComplete && args.attributionComplete;
  const ads = buildAdCards({ ...args, reliable });
  const experiments = buildExperiments({ ...args, reliable });
  let adAttributedTrials = 0;
  let campaignOnlyTrials = 0;
  let unattributedTrials = 0;
  let stillTrialing = 0;
  let paidMonthly = 0;
  let paidAnnual = 0;
  let dated = true;
  if (reliable) {
    for (const person of args.people) {
      const started = trialStartDate(person.trialStartUnix, args.timezone);
      if (!started) {
        dated = false;
        break;
      }
      if (started < args.rangeSince || started > args.rangeUntil) continue;
      const level = attributionLevel(person, args.identities);
      if (level.level === "ad") {
        adAttributedTrials += 1;
        if (person.trialing) stillTrialing += 1;
        if (args.paymentsKnown && person.paid && person.interval === "month") paidMonthly += 1;
        if (args.paymentsKnown && person.paid && person.interval === "year") paidAnnual += 1;
      } else if (level.level === "campaign") campaignOnlyTrials += 1;
      else unattributedTrials += 1;
    }
  }
  const rangeSpendCents = sumField(ads.map((ad) => ({ value: ad.spendCents })));
  const recommendation = recommend({
    ads,
    experiments,
    stale: args.stale,
    lastImportedAt: args.lastImportedAt,
    adAttributedTrials: reliable && dated ? adAttributedTrials : null,
    campaignOnlyTrials: reliable && dated ? campaignOnlyTrials : null,
    unattributedTrials: reliable && dated ? unattributedTrials : null,
    paymentsKnown: args.paymentsKnown,
    subscriptionsComplete: args.subscriptionsComplete && dated,
    attributionComplete: args.attributionComplete,
  });
  return {
    currency: args.currency,
    timezone: args.timezone,
    rangeSince: args.rangeSince,
    rangeUntil: args.rangeUntil,
    lastImportedAt: args.lastImportedAt,
    stale: args.stale,
    activeCount: args.activeCount,
    todaySpendCents: args.todaySpendCents,
    weekSpendCents: args.weekSpendCents,
    rangeSpendCents,
    paymentsKnown: args.paymentsKnown,
    subscriptionsComplete: args.subscriptionsComplete,
    attributionComplete: args.attributionComplete,
    adAttributedTrials: reliable && dated ? adAttributedTrials : null,
    campaignOnlyTrials: reliable && dated ? campaignOnlyTrials : null,
    unattributedTrials: reliable && dated ? unattributedTrials : null,
    stillTrialing: reliable && dated ? stillTrialing : null,
    paidMonthly: reliable && dated && args.paymentsKnown ? paidMonthly : null,
    paidAnnual: reliable && dated && args.paymentsKnown ? paidAnnual : null,
    ads,
    experiments,
    recommendation,
    storageReady: args.storageReady,
    creativeRead: args.creativeRead,
  };
}

export function notesFromRow(row: Record<string, unknown> | null): AdLabNotes {
  const text = (key: string) => (typeof row?.[key] === "string" ? (row[key] as string) : "");
  return {
    hook: text("hook"),
    angle: text("angle"),
    audience: text("audience"),
    emotion: text("emotion"),
    personFeatured: text("person_featured"),
    offer: text("offer"),
    concept: text("concept"),
    hypothesis: text("hypothesis"),
    variableChanged: text("variable_changed"),
    notes: text("notes"),
  };
}

export function clipNote(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export type AdLabPageView =
  | Exclude<AdLabPanel, { status: "ready" }>
  | (Extract<AdLabPanel, { status: "ready" }> & { lab?: AdLabLab });

