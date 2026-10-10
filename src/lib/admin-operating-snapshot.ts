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
import {
  emptyNonmemberCensus,
  NONMEMBER_CATEGORY_LABEL,
  NONMEMBER_CATEGORIES,
  type NonmemberCensusData,
} from "@/lib/nonmember-census";

import {
  EMPTY_LANDING_PERFORMANCE,
  formatLandingPageReport,
  type LandingPagePerformance,
} from "@/lib/landing-page-performance";
import {
  EMPTY_EXPERIMENT_REGISTRY,
  experimentDecisionLines,
  formatExperimentReport,
  NO_CONTROLLED_EXPERIMENTS,
  type ExperimentRegistry,
} from "@/lib/operating-experiments";

export { NO_CONTROLLED_EXPERIMENTS };

export const DAILY_NEW_TRIAL_GOAL = 25;

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
  census: {
    coverage: string;
    examined: string;
    clerkTotal: string;
    members: string;
    nonmembers: string;
    unknown: string;
    categories: Array<{ label: string; value: string }>;
    recovery: string;
    emailFact: string;
    permission: string;
    rows: Array<{ clerkUserId: string; createdLabel: string; category: string }>;
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
  experiments: ExperimentRegistry;
  landingPages: LandingPagePerformance;
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
  census: NonmemberCensusData;
  experiments: ExperimentRegistry;
  landingPages: LandingPagePerformance;
}): OperatingAction[] {
  const actions: OperatingAction[] = [];
  const period = args.growth.snapshot.period;
  const now = args.growth.snapshot.asOfNow;

  if (!args.landingPages.available) {
    actions.push({
      id: "landing-page-analytics-unreadable",
      title: "Landing-page analytics could not be read",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "Distribution could not read page views for the homepage and the four landing pages.",
      nextStep: "Reload Distribution after the marketing events read succeeds. Do not guess a winning page.",
    });
  } else if (args.landingPages.journeyUnreadable) {
    actions.push({
      id: "landing-page-journey-unreadable",
      title: "Landing-page trials could not be tied to visitors",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "The landing-page history or the visitor-to-account link could not be read completely.",
      nextStep: "Reload Distribution after the marketing read succeeds. Do not assign trials to a page.",
    });
  } else if (args.landingPages.billingUnreadable) {
    actions.push({
      id: "landing-page-billing-unreadable",
      title: "Landing-page trials could not be tied to billing",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "Stripe subscriptions could not be read for landing-page trial credit.",
      nextStep: "Reload Distribution after the Stripe read succeeds. Do not treat missing trials as zero.",
    });
  } else if (args.landingPages.paymentsUnreadable) {
    actions.push({
      id: "landing-page-payments-unreadable",
      title: "Landing-page payments could not be confirmed",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "Stripe invoices could not be read, so paid conversions were not assigned to a page.",
      nextStep: "Reload Distribution after the invoice read succeeds. Do not call a trial paid.",
    });
  }

  if (!args.experiments.available) {
    actions.push({
      id: "experiment-registry-unreadable",
      title: "The experiment registry could not be read",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "Distribution and Retention share one experiment table, and that read failed.",
      nextStep: "Apply the operating experiments migration, then reload both pages.",
    });
  }

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

  if (args.census.coverage === "failed") {
    actions.push({
      id: "clerk-census-failed",
      title: "Clerk accounts could not be listed",
      category: "distribution",
      priority: "high",
      kind: "limitation",
      evidence: "The nonmember census did not receive a Clerk account list.",
      nextStep: "Do not treat a missing census as zero nonmembers. Retry this page later.",
    });
  } else if (args.census.coverage === "partial") {
    actions.push({
      id: "clerk-census-partial",
      title: "The account census is only a partial scan",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence: `${args.census.examined ?? "Some"} Clerk accounts were examined. This is not every account.`,
      nextStep: "Do not quote these nonmember counts as the full customer list.",
    });
  }

  if ((args.census.unknownEntitlement ?? 0) > 0) {
    actions.push({
      id: "census-verification-incomplete",
      title: "Some account membership checks could not be finished",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence: `${args.census.unknownEntitlement} examined accounts have unknown entitlement. They are not counted as nonmembers.`,
      nextStep: "Do not email or text those accounts. Unknown is not the same as no membership.",
    });
  }

  if ((args.census.unverifiedTrial ?? 0) > 0) {
    actions.push({
      id: "census-unverified-trial",
      title: "A checkout record could not be matched to membership",
      category: "distribution",
      priority: "medium",
      kind: "limitation",
      evidence: `${args.census.unverifiedTrial} examined accounts have checkout evidence whose current membership could not be verified.`,
      nextStep: "Do not call those accounts nonmembers until the subscription can be read.",
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
  census: NonmemberCensusData;
  experiments: ExperimentRegistry;
  landingPages: LandingPagePerformance;
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
  lines.push(
    "The account census examines the newest Clerk accounts, at most 200. A partial scan is not a complete census."
  );
  lines.push(
    "Promotional email and SMS permission for nonmembers is unknown. An email address on the account is not permission to write. This page does not send anything."
  );
  lines.push(
    "Checkout categories use instrumentation version 1 only. Accounts created before that tracking are not called checkout abandoners."
  );
  if (args.census.coverage === "partial") {
    lines.push("This census did not examine every Clerk account.");
  }
  if (args.census.coverage === "failed") {
    lines.push("The Clerk account list could not be read.");
  }
  if (!args.experiments.available) {
    lines.push(
      "The experiment registry could not be read. Do not treat that as zero experiments."
    );
  }
  if (!args.landingPages.available) {
    lines.push(
      "Landing-page analytics could not be read. Do not treat that as zero visitors."
    );
  } else if (args.landingPages.billingUnreadable || args.landingPages.journeyUnreadable) {
    lines.push(
      "Landing-page trials could not be assigned. Do not treat that as zero trials."
    );
  } else if (!args.landingPages.billingConnected) {
    lines.push(
      "Landing-page visitor-to-trial and paying-member counts are not available. A page view, a button click, an account, and a checkout start are different events."
    );
  } else if (args.landingPages.paymentsUnreadable) {
    lines.push(
      "Landing-page trial starts are counted. Paid conversions could not be confirmed from invoices."
    );
  } else {
    lines.push(
      "Landing-page trial credit is the first page on or after October 10, 2026. It does not replace first-touch source. Apple memberships are not included. past_due is not paid. Trials still running are excluded from the trial-to-paid rate."
    );
  }
  if (args.experiments.available && args.experiments.records.length >= 200) {
    lines.push(
      "The experiment list stopped at 200 rows. Older experiments may be missing from this page."
    );
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
  const nextSteps = [
    ...snapshot.actions.map((action) => `- ${action.nextStep}`),
    ...experimentDecisionLines(snapshot.experiments).map((line) => `- ${line}`),
  ];
  if (nextSteps.length === 0) {
    nextSteps.push("No next step is recommended from recorded exceptions in this view.");
  }

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
    "ACCOUNTS WITHOUT MEMBERSHIP",
    snapshot.census.coverage,
    `Clerk accounts examined: ${snapshot.census.examined}`,
    `Clerk accounts in total, when the count could be read: ${snapshot.census.clerkTotal}`,
    `Confirmed current members in this scan: ${snapshot.census.members}`,
    `Confirmed nonmembers in this scan: ${snapshot.census.nonmembers}`,
    `Membership status unknown: ${snapshot.census.unknown}`,
    ...snapshot.census.categories.map((row) => `- ${row.label}: ${row.value}`),
    snapshot.census.recovery,
    snapshot.census.emailFact,
    snapshot.census.permission,
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
    ...formatLandingPageReport(snapshot.landingPages),
    "",
    "EXPERIMENTS",
    ...formatExperimentReport(snapshot.experiments),
    "",
    "UNKNOWNS AND DATA QUALITY",
    ...snapshot.limitations.map((line) => `- ${line}`),
    "",
    "RECOMMENDED NEXT STEPS",
    ...nextSteps,
    "",
  ].join("\n");
}

function censusCreatedLabel(ms: number | null): string {
  if (ms == null) return "Created date unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
  }).format(new Date(ms));
}

function censusText(census: NonmemberCensusData): OperatingSnapshot["census"] {
  const coverage =
    census.coverage === "complete"
      ? "Coverage: complete for the accounts examined."
      : census.coverage === "partial"
        ? "Coverage: partial. This is not a complete census."
        : "Coverage: the Clerk list could not be read. Counts below are unavailable.";
  return {
    coverage,
    examined: countText(census.examined),
    clerkTotal: countText(census.clerkTotal),
    members: countText(census.members),
    nonmembers: countText(census.nonmembers),
    unknown: countText(census.unknownEntitlement),
    categories: NONMEMBER_CATEGORIES.map((category) => ({
      label: NONMEMBER_CATEGORY_LABEL[category],
      value: countText(
        census.coverage === "failed" ? null : census.categories[category]
      ),
    })),
    recovery: `Possible recovery pool: ${countText(census.nonmembers)} confirmed nonmembers in this scan. This is not permission to email or text.`,
    emailFact: `Examined accounts with an email address: ${countText(census.withEmail)}. An email address is not permission to write.`,
    permission:
      "Promotional follow-up permission: Unknown. Service-message permission: Unknown. Email unsubscribe status: Unknown.",
    rows: census.rows.map((row) => ({
      clerkUserId: row.clerkUserId,
      createdLabel: censusCreatedLabel(row.createdAtMs),
      category: NONMEMBER_CATEGORY_LABEL[row.category],
    })),
  };
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
  census?: NonmemberCensusData;
  experiments?: ExperimentRegistry;
  landingPages?: LandingPagePerformance;
}): OperatingSnapshot {
  const period = args.growth.snapshot.period;
  const now = args.growth.snapshot.asOfNow;
  const checkout = args.checkout ?? emptyCheckoutMeasurement();
  const census = args.census ?? emptyNonmemberCensus();
  const experiments = args.experiments ?? EMPTY_EXPERIMENT_REGISTRY;
  const landingPages = args.landingPages ?? EMPTY_LANDING_PERFORMANCE;
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
    census: censusText(census),
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
      census,
      experiments,
      landingPages,
    }),
    experiments,
    landingPages,
    limitations: buildLimitations({
      growth: args.growth,
      challengeAttention: args.challengeAttention,
      deletionsAvailable: args.deletionsAvailable,
      checkout,
      census,
      experiments,
      landingPages,
    }),
  };

  return {
    ...withoutReport,
    report: formatOperatingReport(withoutReport),
  };
}
