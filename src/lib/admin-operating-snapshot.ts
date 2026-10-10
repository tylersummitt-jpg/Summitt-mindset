/**
 * Shared Distribution and Retention view.
 * Numbers come from the existing subscriber-growth snapshot. Null stays unknown.
 */

import {
  conversionRate,
  formatUnknownableCount,
  formatUnknownablePercent,
  formatUnknownableUsdFromCents,
  type GrowthDateRange,
  type SubscriberGrowthDashboardData,
  type TrafficSourceRow,
} from "@/lib/admin-subscriber-growth-pure";
import type { AccountDeletionAdminSummary } from "@/lib/account-deletion/admin-observability";
import {
  CHECKOUT_TRACKING_VERSION,
  emptyCheckoutMeasurement,
  type CheckoutMeasurement,
} from "@/lib/checkout-tracking";

export const DAILY_NEW_TRIAL_GOAL = 25;

export const NO_CONTROLLED_EXPERIMENTS =
  "No controlled experiments are running yet.";

export type OperatingArea = "distribution" | "retention";

export type OperatingActionKind = "recorded" | "limitation";

export type OperatingAction = {
  id: string;
  title: string;
  category: OperatingArea;
  priority: "high" | "medium";
  kind: OperatingActionKind;
  evidence: string;
  nextStep: string;
};

export type OperatingExperiment = {
  name: string;
  area: OperatingArea;
  status: "active" | "planned" | "completed";
  hypothesis: string;
  primaryOutcome: string;
  evidence:
    | "not_yet_tested"
    | "not_enough_mature_data"
    | "directional"
    | "proven"
    | "disproven"
    | "tracking_untrustworthy";
};

export type OperatingSnapshot = {
  asOfLabel: string;
  range: GrowthDateRange;
  rangeLabel: string;
  timezone: string;
  distribution: {
    visitors: string;
    trialStarts: string;
    visitorToTrial: string;
    trialToPaid: string;
    newPayingMembers: string;
    accountsCreated: string;
    trialsPerDay: string;
    goal: string;
  };
  checkout: {
    joinClicks: string;
    sessions: string;
    completedTrial: string;
    pending: string;
    expired: string;
    incomplete: string;
    unknown: string;
    creationFailed: string;
    withVisitor: string;
    accountWithoutVisitor: string;
    noVisitorMatch: string;
    unknownSource: string;
    stepRate: string;
    cutover: string;
    definitions: string;
  };
  retention: {
    payingMembers: string;
    trialsConverted: string;
    cancelledDuringTrial: string;
    finishedTrialWithoutPaid: string;
    paidMembershipsEnded: string;
    churn: string;
    pastDueNow: string;
    paymentFailedInRange: string;
    freeWeekNow: string;
    stripeRevenue: string;
  };
  sources: Array<{
    label: string;
    visitors: string;
    trials: string;
    paid: string;
  }>;
  actions: OperatingAction[];
  experiments: OperatingExperiment[];
  limitations: string[];
  report: string;
};

const RANGE_LABEL: Record<GrowthDateRange, string> = {
  today: "Today",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  all_time: "All time",
};

function daysInRange(range: GrowthDateRange): number | null {
  if (range === "today") return 1;
  if (range === "last_7") return 7;
  if (range === "last_30") return 30;
  return null;
}

function countText(value: number | null): string {
  return formatUnknownableCount(value);
}

function percentText(value: number | null): string {
  return formatUnknownablePercent(value);
}

function topSources(rows: TrafficSourceRow[]) {
  return [...rows]
    .filter(
      (row) => (row.trialsStarted ?? 0) > 0 || (row.visitors ?? 0) > 0
    )
    .sort((a, b) => (b.trialsStarted ?? -1) - (a.trialsStarted ?? -1))
    .slice(0, 5)
    .map((row) => ({
      label: row.firstTouchLabel || "Unknown",
      visitors: countText(row.visitors),
      trials: countText(row.trialsStarted),
      paid: countText(row.paidConversions),
    }));
}

function buildActions(args: {
  growth: SubscriberGrowthDashboardData;
  challengeAttention: number | null;
  deletions: AccountDeletionAdminSummary | null;
  checkout: CheckoutMeasurement;
}): OperatingAction[] {
  const actions: OperatingAction[] = [];
  const period = args.growth.snapshot.period;
  const now = args.growth.snapshot.asOfNow;

  if (args.challengeAttention != null && args.challengeAttention > 0) {
    actions.push({
      id: "challenge-attention",
      title: "Challenge lesson deliveries need attention",
      category: "distribution",
      priority: "high",
      kind: "recorded",
      evidence: `${args.challengeAttention} unfinished challenge participants have a recorded send problem.`,
      nextStep:
        "Use the internal challenge alert already sent to the coach inbox. Do not resend an uncertain lesson from this page.",
    });
  }

  if (
    args.checkout.creationFailed != null &&
    args.checkout.creationFailed > 0
  ) {
    actions.push({
      id: "checkout-creation-failed",
      title: "Stripe could not create some Checkout Sessions",
      category: "distribution",
      priority: "high",
      kind: "recorded",
      evidence: `${args.checkout.creationFailed} checkout creation failures were recorded in this range. Those attempts never became a Checkout Session.`,
      nextStep:
        "Read the checkout-tracking server log for the Stripe error. Do not treat unfinished checkouts as this failure.",
    });
  }

  if (!args.checkout.listComplete) {
    actions.push({
      id: "checkout-outcomes-unreadable",
      title: "Checkout outcomes could not be read",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence:
        "Instrumented Checkout Sessions could not be listed for this range, so pending, expired, incomplete, and completed trial counts are unavailable.",
      nextStep:
        "Do not decide where checkout loses people until the Stripe session list can be read.",
    });
  } else if (
    args.checkout.openedEvents != null &&
    args.checkout.sessions != null &&
    args.checkout.openedEvents > args.checkout.sessions
  ) {
    actions.push({
      id: "checkout-marker-gap",
      title: "Some recorded checkout starts are missing the Stripe marker",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence: `${args.checkout.openedEvents} local checkout_opened records and ${args.checkout.sessions} marked Checkout Sessions are in this range.`,
      nextStep:
        "Do not treat the local event count as the funnel total. The page uses marked Stripe sessions.",
    });
  }

  if (args.growth.snapshot.notes.sourceTrackingUnavailable) {
    const note = args.growth.snapshot.notes.trackingFromNote;
    actions.push({
      id: "source-tracking",
      title: "Acquisition source is not reliable for this range",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence:
        note ??
        "Marketing attribution was not recorded for part or all of this range.",
      nextStep:
        "Do not pick a winning channel from this range. Unknown source stays unknown.",
    });
  }

  if (period.paymentFailed != null && period.paymentFailed > 0) {
    actions.push({
      id: "stripe-payment-failed-period",
      title: "Stripe payments failed in this range",
      category: "retention",
      priority: "high",
      kind: "recorded",
      evidence: `${period.paymentFailed} Stripe invoice failures were counted in the selected range.`,
      nextStep:
        "Review those invoices in Stripe. This page does not list customer emails or card details.",
    });
  }

  if (now.paymentFailed != null && now.paymentFailed > 0) {
    actions.push({
      id: "stripe-past-due-now",
      title: "Some Stripe memberships are past due now",
      category: "retention",
      priority: "high",
      kind: "recorded",
      evidence: `${now.paymentFailed} Stripe members are past due in the existing membership count.`,
      nextStep:
        "Review past-due subscriptions in Stripe before changing access by hand.",
    });
  }

  if (args.deletions) {
    const failed =
      args.deletions.failedRetryable +
      args.deletions.failedTerminal +
      args.deletions.structurallyInconsistent;
    if (failed > 0) {
      actions.push({
        id: "account-deletion-failures",
        title: "Account deletions need review",
        category: "retention",
        priority: "high",
        kind: "recorded",
        evidence: `${failed} failed or inconsistent account-deletion records are in the latest admin list. That list is not a full historical count.`,
        nextStep: "Open Account Deletions and review the failed or inconsistent rows.",
      });
    }
    if (args.deletions.inProgress > 0) {
      actions.push({
        id: "account-deletion-in-progress",
        title: "Account deletions are still in progress",
        category: "retention",
        priority: "medium",
        kind: "recorded",
        evidence: `${args.deletions.inProgress} account deletions are in progress in the latest admin list.`,
        nextStep: "Open Account Deletions. Do not unlock access from this page.",
      });
    }
  }

  const rank = { high: 0, medium: 1 };
  return actions.sort(
    (a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title)
  );
}

function buildLimitations(args: {
  growth: SubscriberGrowthDashboardData;
  challengeAttention: number | null;
  deletionsAvailable: boolean;
  checkout: CheckoutMeasurement;
}): string[] {
  const notes = args.growth.snapshot.notes;
  const lines = [
    "D30, D60, and D90 retention cohorts are not available. This page does not estimate them.",
    `Checkout measurement is instrumentation version ${CHECKOUT_TRACKING_VERSION}. Only Stripe Checkout Sessions marked summittCheckoutTrack=${CHECKOUT_TRACKING_VERSION} are counted. Earlier sessions are not backfilled.`,
    "A checkout count is sessions, not unique people. One person can start more than one checkout.",
    "Pending means the session is still open and less than 24 hours old. Expired means Stripe marked the session expired. Incomplete means it is still open after 24 hours. Expired sessions are not also counted as incomplete.",
    "Completed trial means the session is complete and the subscription has a trial start. The trial-start number elsewhere on this page is still the existing subscription count.",
    "A completed checkout without a verified trial start is unknown. This page does not guess why someone left.",
    "Technical creation failures never became a session, so they are not inside the session total.",
    "Visitors, join clicks, accounts, checkout sessions, and trial starts are different counts, so no single step-to-step rate is shown.",
    "A Stripe customer id is not proof that someone paid or started a trial.",
    "Cancellation reasons written by members are not on this page. Weekly Feedback has their words. Observed cancellations are counts, not reasons.",
    "Historical Stripe webhook completion is unverified. Older event rows are kept so they are not processed again. A row from before the completion marker is not proof the event finished successfully.",
    "Apple revenue is not included. Stripe revenue is the existing Stripe total and is gross of refunds.",
    notes.appleCancelRequestedNote,
    notes.stripeChurnOnly
      ? "Paid subscriber churn is the existing Stripe churn rate. Apple churn is not in that rate."
      : "Paid subscriber churn uses the existing calculator.",
  ];
  if (notes.sourceTrackingUnavailable) {
    lines.push(
      notes.trackingFromNote ??
        "Some marketing attribution for this range is unknown."
    );
  }
  if (args.challengeAttention == null) {
    lines.push("Challenge delivery health could not be read.");
  }
  if (!args.deletionsAvailable) {
    lines.push("The account-deletion summary could not be read.");
  }
  if (!args.checkout.listComplete) {
    lines.push("Checkout session outcomes could not be read for this range.");
  }
  if (!args.checkout.eventsComplete) {
    lines.push("Checkout creation-failure records could not be read for this range.");
  }
  return lines;
}

export function formatOperatingReport(snapshot: Omit<OperatingSnapshot, "report">): string {
  const actionLines =
    snapshot.actions.length === 0
      ? ["None. Nothing recorded needs action in this view."]
      : snapshot.actions.map(
          (action) =>
            `- [${action.priority}] ${action.category}: ${action.title} (${action.kind})\n  Evidence: ${action.evidence}\n  Next: ${action.nextStep}`
        );
  const sourceLines =
    snapshot.sources.length === 0
      ? ["No source rows for this range."]
      : snapshot.sources.map(
          (source) =>
            `- ${source.label}: visitors ${source.visitors}, trials ${source.trials}, paid ${source.paid}`
        );
  const nextSteps =
    snapshot.actions.length === 0
      ? ["No next step is recommended from recorded exceptions in this view."]
      : snapshot.actions.map((action) => `- ${action.nextStep}`);

  return [
    "Summitt business report",
    `As of: ${snapshot.asOfLabel}`,
    `Range: ${snapshot.rangeLabel} (${snapshot.timezone})`,
    snapshot.distribution.goal,
    "",
    "DISTRIBUTION",
    `Unique visitors: ${snapshot.distribution.visitors}`,
    `Trial starts: ${snapshot.distribution.trialStarts}`,
    `Visitor-to-trial: ${snapshot.distribution.visitorToTrial}`,
    `Trial-to-paid: ${snapshot.distribution.trialToPaid}`,
    `New paying members: ${snapshot.distribution.newPayingMembers}`,
    `Accounts created: ${snapshot.distribution.accountsCreated}`,
    `Trials per day in this range: ${snapshot.distribution.trialsPerDay}`,
    "",
    "Known acquisition sources",
    ...sourceLines,
    "",
    "CHECKOUT FUNNEL",
    snapshot.checkout.cutover,
    snapshot.checkout.definitions,
    snapshot.checkout.stepRate,
    `Join clicks: ${snapshot.checkout.joinClicks}`,
    `Checkout sessions started: ${snapshot.checkout.sessions}`,
    `Completed trial: ${snapshot.checkout.completedTrial}`,
    `Still pending: ${snapshot.checkout.pending}`,
    `Expired: ${snapshot.checkout.expired}`,
    `Technical creation failures: ${snapshot.checkout.creationFailed}`,
    `Incomplete after 24 hours: ${snapshot.checkout.incomplete}`,
    `Unknown outcome: ${snapshot.checkout.unknown}`,
    `Sessions with a visitor id: ${snapshot.checkout.withVisitor}`,
    `Known account, no visitor id: ${snapshot.checkout.accountWithoutVisitor}`,
    `No visitor match: ${snapshot.checkout.noVisitorMatch}`,
    `Unknown source: ${snapshot.checkout.unknownSource}`,
    "",
    "RETENTION",
    `Current paying members: ${snapshot.retention.payingMembers}`,
    `Trials that converted to paid: ${snapshot.retention.trialsConverted}`,
    `Cancelled during trial: ${snapshot.retention.cancelledDuringTrial}`,
    `Finished trial without paying: ${snapshot.retention.finishedTrialWithoutPaid}`,
    `Paid memberships ended: ${snapshot.retention.paidMembershipsEnded}`,
    `Paid subscriber churn: ${snapshot.retention.churn}`,
    `Stripe past due now: ${snapshot.retention.pastDueNow}`,
    `Stripe payment failures in range: ${snapshot.retention.paymentFailedInRange}`,
    `Free week running now: ${snapshot.retention.freeWeekNow}`,
    `Stripe revenue: ${snapshot.retention.stripeRevenue}`,
    "",
    "TODAY'S ACTIONS",
    ...actionLines,
    "",
    "EXPERIMENTS",
    NO_CONTROLLED_EXPERIMENTS,
    "Active: none.",
    "Planned: none.",
    "Completed: none.",
    "Evidence: not yet tested. No winner is claimed.",
    "",
    "UNKNOWNS AND DATA QUALITY",
    ...snapshot.limitations.map((line) => `- ${line}`),
    "",
    "RECOMMENDED NEXT STEPS",
    ...nextSteps,
    "",
  ].join("\n");
}

function checkoutText(measurement: CheckoutMeasurement): OperatingSnapshot["checkout"] {
  return {
    joinClicks: "",
    sessions: countText(measurement.sessions),
    completedTrial: countText(measurement.completedTrial),
    pending: countText(measurement.pending),
    expired: countText(measurement.expired),
    incomplete: countText(measurement.incomplete),
    unknown: countText(measurement.unknown),
    creationFailed: countText(measurement.creationFailed),
    withVisitor: countText(measurement.withVisitor),
    accountWithoutVisitor: countText(measurement.accountWithoutVisitor),
    noVisitorMatch: countText(measurement.noVisitorMatch),
    unknownSource: countText(measurement.unknownSource),
    stepRate:
      "Not shown. Visitors, join clicks, accounts, checkout sessions, and trial starts are different counts.",
    cutover: `Instrumentation version ${CHECKOUT_TRACKING_VERSION}. Checkout starts are Stripe Checkout Sessions marked summittCheckoutTrack=${CHECKOUT_TRACKING_VERSION}. Earlier sessions are not included.`,
    definitions:
      "Pending is still open and under 24 hours. Expired is Stripe's expired status. Incomplete is still open after 24 hours. Those are separate. Completed trial requires a subscription trial start. Creation failures are not sessions. This does not say why someone left.",
  };
}

export function buildOperatingSnapshot(args: {
  growth: SubscriberGrowthDashboardData;
  challengeAttention: number | null;
  deletions: AccountDeletionAdminSummary | null;
  deletionsAvailable: boolean;
  checkout?: CheckoutMeasurement;
}): OperatingSnapshot {
  const period = args.growth.snapshot.period;
  const now = args.growth.snapshot.asOfNow;
  const checkout = args.checkout ?? emptyCheckoutMeasurement();
  const days = daysInRange(args.growth.range);
  const trialsPerDay =
    days != null && period.freeTrialsStarted != null
      ? `${(period.freeTrialsStarted / days).toFixed(1)} (trial starts divided by ${days} day${days === 1 ? "" : "s"})`
      : "Not shown. All time has no fixed day count in the existing range.";

  const withoutReport = {
    asOfLabel: args.growth.asOfNowLabel,
    range: args.growth.range,
    rangeLabel: RANGE_LABEL[args.growth.range],
    timezone: args.growth.timezone,
    distribution: {
      visitors: countText(period.uniqueVisitors),
      trialStarts: countText(period.freeTrialsStarted),
      visitorToTrial: percentText(
        conversionRate(period.freeTrialsStarted, period.uniqueVisitors)
      ),
      trialToPaid: percentText(period.trialToPaidRate),
      newPayingMembers: countText(period.trialsConvertedToPaid),
      accountsCreated: countText(period.accountsCreated),
      trialsPerDay,
      goal: `Goal: ${DAILY_NEW_TRIAL_GOAL} new trials per day. This is a target, not a measured result.`,
    },
    checkout: {
      ...checkoutText(checkout),
      joinClicks: countText(period.freeTrialButtonClicks),
    },
    retention: {
      payingMembers: countText(now.activePaid),
      trialsConverted: countText(period.trialsConvertedToPaid),
      cancelledDuringTrial: countText(period.cancelledDuringTrial),
      finishedTrialWithoutPaid: countText(period.finishedTrialWithoutPaid),
      paidMembershipsEnded: countText(period.paidFullyEnded),
      churn: percentText(period.paidChurnRate),
      pastDueNow: countText(now.paymentFailed),
      paymentFailedInRange: countText(period.paymentFailed),
      freeWeekNow: countText(args.growth.currentFreeTrials.onFreeWeekNow),
      stripeRevenue: formatUnknownableUsdFromCents(period.stripeRevenueCents),
    },
    sources: topSources(args.growth.snapshot.trafficRows),
    actions: buildActions({
      growth: args.growth,
      challengeAttention: args.challengeAttention,
      deletions: args.deletions,
      checkout,
    }),
    experiments: [] as OperatingExperiment[],
    limitations: buildLimitations({
      growth: args.growth,
      challengeAttention: args.challengeAttention,
      deletionsAvailable: args.deletionsAvailable,
      checkout,
    }),
  };

  return {
    ...withoutReport,
    report: formatOperatingReport(withoutReport),
  };
}
