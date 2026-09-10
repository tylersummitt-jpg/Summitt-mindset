import Link from "next/link";

import {
  adSpendDisplayStatus,
  computeGrowthGoal,
  formatAdvertisingSpendDisplay,
  formatCostPerPaidDisplay,
  formatGoalTarget,
  formatLatestTrialSignedUp,
  formatMaybeAvailableCount,
  formatPersonFlag,
  formatSignedNet,
  formatUnknownableCount,
  formatUnknownablePercent,
  formatUnknownableUsdFromCents,
  organicSocialPlatformLabel,
  NOT_AVAILABLE,
  ROAD_TO_2500_DEADLINE_DATE_KEY,
  ROAD_TO_2500_TARGET,
  ROAD_TO_500_DEADLINE_DATE_KEY,
  ROAD_TO_500_TARGET,
  SPEND_NOT_ENTERED,
  UNKNOWN_METRIC,
  UNKNOWN_SOURCE_LABEL,
  type GrowthDateRange,
  type GrowthGoalComputed,
  type GrowthTrafficSource,
  type LatestTrialRow,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";

import { SubscriberGrowthAdSpend } from "./subscriber-growth-ad-spend";
import { TrackingLinkBuilder } from "./tracking-link-builder";

const DATE_RANGE_OPTIONS: Array<{ id: GrowthDateRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "all_time", label: "All time" },
];

const SOURCE_OPTIONS: Array<{ id: GrowthTrafficSource; label: string }> = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "organic_social", label: "Organic social" },
  { id: "meta_ads", label: "Meta ads" },
  { id: "google", label: "Google" },
  { id: "referral", label: "Referral" },
];

function sourceHref(range: GrowthDateRange, source: GrowthTrafficSource): string {
  return `/admin/subscriber-growth?range=${range}&source=${source}`;
}

function displaySource(raw: string): string {
  if (raw === "meta") return "Meta ads";
  if (raw === "organic_social") return "Organic social";
  if (raw === "google") return "Google";
  if (raw === "direct") return "Direct";
  if (raw === "referral") return "Referral";
  return raw;
}

function displayPlatform(raw: string): string {
  return raw || UNKNOWN_METRIC;
}

function trafficRowKey(row: {
  sourceNormalized: string;
  platform: string;
  utmCampaign: string;
  utmContent: string;
}): string {
  return `${row.sourceNormalized}|${row.platform}|${row.utmCampaign}|${row.utmContent}`;
}

const TRAFFIC_TABLE_HEADINGS = [
  "Source",
  "Platform",
  "Campaign",
  "Post / Link",
  "Visitors",
  "Accounts",
  "Trials",
  "Activated",
  "Paid",
  "Advertising spend",
  "Cost per paid subscriber",
] as const;

const TRAFFIC_TABLE_COLSPAN = TRAFFIC_TABLE_HEADINGS.length;

const LATEST_TRIALS_HEADINGS = [
  "Signed Up",
  "Person",
  "Source",
  "Platform",
  "Campaign",
  "Post / Link",
  "Activated",
  "Paid",
] as const;

function activatedMark(value: boolean, available: boolean): string {
  if (!available) return NOT_AVAILABLE;
  return formatPersonFlag(value);
}

function MetricCard({
  label,
  value,
  scope,
  alsoCalled,
  note,
}: {
  label: string;
  value: string;
  scope: string;
  alsoCalled?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-gray-500">{scope}</div>
      {alsoCalled ? (
        <p className="mt-0.5 text-[10px] text-gray-500">{alsoCalled}</p>
      ) : null}
      {note ? <p className="mt-1 text-[10px] leading-snug text-gray-500">{note}</p> : null}
    </div>
  );
}

function growthGoalPaceCopy(goal: GrowthGoalComputed): string {
  if (goal.reached) return "Goal reached";
  if (goal.deadlinePassed) {
    const remaining =
      goal.remaining == null ? NOT_AVAILABLE : formatGoalTarget(goal.remaining);
    return `Deadline passed · ${remaining} to go`;
  }
  return `About ${formatUnknownableCount(goal.neededPerWeek)} net new paid subscribers needed per week`;
}

function GrowthGoalCard({
  title,
  subtitle,
  target,
  goal,
}: {
  title: string;
  subtitle: string;
  target: number;
  goal: GrowthGoalComputed;
}) {
  const available = goal.current != null;
  const barPct = available ? clampProgressPercent(goal.progress) : 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-[10px] text-gray-500">{subtitle}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-gray-900">
        {available
          ? `${formatUnknownableCount(goal.current)} of ${formatGoalTarget(target)} paying members`
          : NOT_AVAILABLE}
      </p>
      {available ? (
        <p className="text-[11px] text-gray-600">
          {formatGoalTarget(goal.remaining ?? 0)} to go
        </p>
      ) : null}
      <div
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barPct}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100"
      >
        <div
          className="h-full rounded-full bg-gray-800"
          style={{ width: `${barPct}%` }}
        />
      </div>
      {available ? (
        <p className="mt-2 text-[11px] leading-snug text-gray-600">
          {growthGoalPaceCopy(goal)}
        </p>
      ) : null}
    </div>
  );
}

function clampProgressPercent(progress: number | null): number {
  if (progress == null || !Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress * 100));
}

function StatCell({
  label,
  value,
  scope,
  note,
}: {
  label: string;
  value: string;
  scope: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium text-gray-700">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {value}
      </div>
      <div className="text-[10px] text-gray-500">{scope}</div>
      {note ? <p className="mt-1 text-[10px] leading-snug text-gray-500">{note}</p> : null}
    </div>
  );
}

function FunnelStep({
  step,
  label,
  count,
  conversion,
  alsoCalled,
  note,
}: {
  step: number;
  label: string;
  count: string;
  conversion: string;
  alsoCalled?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      <div className="text-[10px] text-gray-400">{step}</div>
      <div className="text-[11px] font-medium leading-snug text-gray-700">{label}</div>
      {alsoCalled ? <p className="text-[10px] text-gray-500">{alsoCalled}</p> : null}
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {count}
      </div>
      <div className="text-[10px] text-gray-500">
        from prior: {conversion}
      </div>
      {note ? <p className="mt-1 text-[10px] leading-snug text-gray-500">{note}</p> : null}
    </div>
  );
}

const GLOSSARY: Array<{ term: string; meaning: string }> = [
  {
    term: "Accounts created",
    meaning:
      "People who created a Summitt account during the selected dates. When source is All, this is every new account, not only people we can tie to a tracking link.",
  },
  {
    term: "Active annual subscribers",
    meaning:
      "Paying members on a yearly plan right now. Stripe only. Apple does not have a yearly plan.",
  },
  {
    term: "Active monthly subscribers",
    meaning:
      "Paying members on a monthly plan right now. Includes Stripe monthly members and Apple members.",
  },
  {
    term: "Active paid subscribers",
    meaning:
      "People who currently have paid Summitt Mindset access. Free trials are not included. Also shown as Paying members. Includes Stripe and Apple.",
  },
  {
    term: "Advertising spend",
    meaning:
      "The Meta or Google ad money typed into Add Ad Spend for the selected dates. If nothing is saved, this says Spend not entered — not $0.",
  },
  {
    term: "Answered first morning check in 24 hours",
    meaning:
      "A strict yes: they finished onboarding, set a current goal, received Coach Pat’s morning check, and replied, all within 24 hours of starting the trial. Also called Activated within 24 hours. Many engaged members will be No.",
  },
  {
    term: "Activated within 24 hours",
    meaning: "See Answered first morning check in 24 hours.",
  },
  {
    term: "Cancelled during free trial",
    meaning:
      "They cancelled their Stripe membership before the 7-day free week ended.",
  },
  {
    term: "Campaign",
    meaning:
      "The campaign name on the tracking link. To attach ad spend to a campaign row, type this name exactly.",
  },
  {
    term: "Cost per paid subscriber",
    meaning:
      "Ad spend in this period divided by people from paid ads who became paying members in this period. The spend and those people may not be from the same signup week.",
  },
  {
    term: "Direct",
    meaning:
      "We recorded a first visit with no ad click, no social or Google clue, and no other website. This is not the same as Unknown.",
  },
  {
    term: "Ended (Stripe)",
    meaning:
      "Paying Stripe members whose access fully ended from Monday through now. Scheduled cancel at period end is not an end until access actually stops. Apple is not included.",
  },
  {
    term: "Finished trial without becoming paid",
    meaning:
      "The 7-day Stripe trial ended and they never became a paying member. They did not cancel in the middle.",
  },
  {
    term: "Free-trial button clicks",
    meaning: "How many times someone clicked a start-trial button. This is clicks, not people.",
  },
  {
    term: "Free trials started",
    meaning: "Stripe 7-day free weeks that began during the selected dates. Apple has no free trial.",
  },
  {
    term: "Google",
    meaning: "Includes both Google Ads and Google Search. The table does not split them yet.",
  },
  {
    term: "Meta ads",
    meaning: "Paid Facebook or Instagram ads (and related Meta ads).",
  },
  {
    term: "Monthly recurring revenue equivalent",
    meaning:
      "Current monthly value of Stripe memberships. Yearly plans are divided by 12. This is not cash collected. Apple is not included. Also shown as Monthly value of current Stripe members.",
  },
  {
    term: "Monthly value of current Stripe members",
    meaning: "See Monthly recurring revenue equivalent.",
  },
  {
    term: "Net new paid subscribers needed per week",
    meaning:
      "The approximate number of additional paying members we need each remaining calendar week to reach the goal by its deadline. Uses the current whole-company Paying Members count.",
  },
  {
    term: "New paid (Stripe)",
    meaning:
      "People who became paying Stripe members from Monday through now. Free trials that have not become paid are not counted. Apple is not included.",
  },
  {
    term: "Not available",
    meaning: "The system could not calculate this number reliably. Do not treat it as zero.",
  },
  {
    term: "Organic social",
    meaning:
      "They came from Instagram, Facebook, TikTok, X, or similar, without a paid-ad marker.",
  },
  {
    term: "Paid subscriber churn",
    meaning:
      "Of Stripe members who were already paying at the start of the period, the share whose paid access fully ended. Apple is not included. All time is — because there is no starting point.",
  },
  {
    term: "Payment failed",
    meaning:
      "A billing attempt failed during the selected period. This is not the same as currently past due. Includes Stripe payment failures and Apple failed renewals when available.",
  },
  {
    term: "Paying members",
    meaning: "See Active paid subscribers.",
  },
  {
    term: "Platform",
    meaning:
      "Which social app we can name from the tracking link, when we know it. A dash means we do not have a platform name.",
  },
  {
    term: "Post / Link",
    meaning:
      "The bio, story, reel, or ad name on the tracking link. A dash means none was stored.",
  },
  {
    term: "Reactivated subscriber",
    meaning: "They were a paying Stripe member, fully ended, then paid again.",
  },
  {
    term: "Referral",
    meaning: "Includes Coach referral links and links from other websites.",
  },
  {
    term: "Road to 2,500",
    meaning:
      "Whole-company paying members compared with the goal of 2,500 by December 31, 2027. Apple paying members are included. Date and source filters do not change this.",
  },
  {
    term: "Road to 500",
    meaning:
      "Whole-company paying members compared with the goal of 500 by December 31, 2026. Apple paying members are included. Date and source filters do not change this.",
  },
  {
    term: "Revenue collected",
    meaning:
      "Successful Stripe payments collected during the selected dates. Apple payments are not included. Refunds later are not subtracted. Also shown as Stripe cash collected.",
  },
  {
    term: "Spend not entered",
    meaning: "No Meta or Google ad spend has been saved for this view. Type it in Add Ad Spend.",
  },
  {
    term: "Stripe cash collected",
    meaning: "See Revenue collected.",
  },
  {
    term: "Stripe net this week",
    meaning:
      "New paid Stripe members minus ended Stripe members from Monday through now. Apple is not included in this weekly number. Apple is still included in Paying members and both growth goals.",
  },
  {
    term: "Subscription fully ended",
    meaning:
      "A paying member’s access fully ended during the selected dates. Stripe, plus Apple expirations when we have them.",
  },
  {
    term: "Trial-to-paid conversion",
    meaning:
      "Of Stripe free trials whose 7-day trial ended during this period, the share that became paid. Trials still running are not included.",
  },
  {
    term: "Unique website visitors",
    meaning:
      "Distinct website visitors we counted, not named people. Only after marketing tracking started.",
  },
  {
    term: "Unknown",
    meaning:
      "We never saved a first visit for this person. This is not Direct.",
  },
];

export default function SubscriberGrowthDashboard({
  data,
}: {
  data: SubscriberGrowthDashboardData;
}) {
  const { snapshot, range, source } = data;
  const spendStatus = adSpendDisplayStatus({
    queryComplete: data.adSpendQueryComplete,
    entryCount: data.adSpendEntries.length,
  });
  const spendValue = formatAdvertisingSpendDisplay(
    snapshot.period.advertisingSpend,
    spendStatus
  );
  const costPerPaidValue = formatCostPerPaidDisplay(
    snapshot.period.costPerPaid,
    spendStatus
  );
  const costPerPaidNote =
    spendStatus === "empty"
      ? "Enter ad spend below to calculate."
      : spendStatus === "unavailable"
        ? "We could not load ad spend, so this cost is not available."
        : "Ad spend this period ÷ people from paid ads who became paying members this period. Those people may not be from the same signup week.";

  const roadTo500 = computeGrowthGoal({
    current: snapshot.asOfNow.activePaid,
    target: ROAD_TO_500_TARGET,
    todayDateKey: data.todayDateKey,
    deadlineDateKey: ROAD_TO_500_DEADLINE_DATE_KEY,
  });
  const roadTo2500 = computeGrowthGoal({
    current: snapshot.asOfNow.activePaid,
    target: ROAD_TO_2500_TARGET,
    todayDateKey: data.todayDateKey,
    deadlineDateKey: ROAD_TO_2500_DEADLINE_DATE_KEY,
  });

  const funnel = [
    {
      label: "Unique website visitors",
      count: formatUnknownableCount(snapshot.period.uniqueVisitors),
    },
    {
      label: "Free-trial button clicks",
      count: formatUnknownableCount(snapshot.period.freeTrialButtonClicks),
    },
    {
      label: "Accounts created",
      count: formatUnknownableCount(snapshot.period.accountsCreated),
    },
    {
      label: "Free trials started",
      count: formatUnknownableCount(snapshot.period.freeTrialsStarted),
    },
    {
      label: "Answered first morning check in 24 hours",
      count: formatMaybeAvailableCount(
        snapshot.period.activatedWithin24h,
        data.activationQueryComplete
      ),
      alsoCalled: "Also called: Activated within 24 hours",
      note: "They finished onboarding, set a current goal, received Coach Pat's morning check, and replied — all within 24 hours of starting the trial. This is a strict test. A member can be engaged and still not meet it.",
    },
    {
      label: "Trials converted to paid",
      count: formatUnknownableCount(snapshot.period.trialsConvertedToPaid),
      note: "Paid conversion uses finished trials, not the same 24-hour check group, so this step does not show a from-prior percentage.",
    },
  ];

  const mixLabel =
    snapshot.asOfNow.monthlyShare == null || snapshot.asOfNow.annualShare == null
      ? UNKNOWN_METRIC
      : `${formatUnknownablePercent(snapshot.asOfNow.monthlyShare)} monthly / ${formatUnknownablePercent(snapshot.asOfNow.annualShare)} annual`;

  const trackingNote =
    snapshot.notes.trackingFromNote ??
    (snapshot.notes.instrumentationStartLabel
      ? `Traffic & attribution data available from ${snapshot.notes.instrumentationStartLabel}.`
      : "Attribution tracking has not started yet.");

  return (
    <div data-admin-wide className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Subscriber Growth Dashboard
          </h1>
          <p className="text-[11px] text-gray-500">As of {data.asOfNowLabel}</p>
          <div className="mt-2 text-[11px] text-gray-600">
            <p className="font-medium text-gray-700">How this page works</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>&quot;Right now&quot; numbers show the whole company.</li>
              <li>
                Growth goals and This week on Stripe also ignore date and source
                filters.
              </li>
              <li>Date and source filters change the historical reports below.</li>
              <li>
                {snapshot.notes.instrumentationStartLabel
                  ? `Marketing source tracking is only available from ${snapshot.notes.instrumentationStartLabel}.`
                  : "Marketing source tracking has not started yet."}
              </li>
            </ul>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">{trackingNote}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {DATE_RANGE_OPTIONS.map((option) => {
              const active = option.id === range;
              return (
                <Link
                  key={option.id}
                  href={sourceHref(option.id, source)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    active
                      ? "border-gray-700 bg-gray-700 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500">Last 7 days includes today.</p>
          <div className="flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map((option) => {
              const active = option.id === source;
              return (
                <Link
                  key={option.id}
                  href={sourceHref(range, option.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    active
                      ? "border-gray-700 bg-gray-700 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500">
            Google includes Google ads and Google search. Referral includes Coach links and other websites.
          </p>
          <p className="text-[10px] text-gray-600">
            These filters change the historical reports below. They do not
            change Company right now, growth goals, or This week on Stripe.
          </p>
        </div>
      </div>

      {data.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <section>
        <h2 className="mb-0.5 text-sm font-semibold text-gray-900">
          Company right now
        </h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          Whole company. Filters do not change these numbers.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Paying members"
            value={formatMaybeAvailableCount(
              snapshot.asOfNow.activePaid,
              snapshot.asOfNow.activePaid != null
            )}
            scope="Right now · Stripe + Apple · free trials not included"
            alsoCalled="Also called: Active paid subscribers"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-0.5 text-sm font-semibold text-gray-900">This period</h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          Uses the date and source you selected above.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Trial-to-paid conversion rate"
            value={formatUnknownablePercent(snapshot.period.trialToPaidRate)}
            scope="Of free trials whose 7-day trial ended during this period, this percentage became paid. Stripe only. Trials still running are not included."
          />
          <MetricCard
            label="Paid subscriber churn rate"
            value={formatUnknownablePercent(snapshot.period.paidChurnRate)}
            scope="Of Stripe members who were already paying at the start of this period, this percentage fully lost access during the period. Apple is not included."
          />
          <MetricCard
            label="Cost per paid subscriber"
            value={costPerPaidValue}
            scope="Selected period · blended period CPS"
            note={costPerPaidNote}
          />
        </div>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <GrowthGoalCard
            title="Road to 500"
            subtitle="500 paying members by December 31, 2026."
            target={ROAD_TO_500_TARGET}
            goal={roadTo500}
          />
          <GrowthGoalCard
            title="Road to 2,500"
            subtitle="2,500 paying members by December 31, 2027."
            target={ROAD_TO_2500_TARGET}
            goal={roadTo2500}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-0.5 text-sm font-semibold text-gray-900">
          This week on Stripe
        </h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          Monday through today · Eastern Time. Apple is not included in this
          weekly change because we cannot reliably reconstruct past Apple
          membership.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MetricCard
            label="New paid (Stripe)"
            value={formatMaybeAvailableCount(
              data.stripeWeek.newPaid,
              data.stripeWeek.newPaid != null
            )}
            scope="Became paying Stripe members from Monday through now"
          />
          <MetricCard
            label="Ended (Stripe)"
            value={formatMaybeAvailableCount(
              data.stripeWeek.ended,
              data.stripeWeek.ended != null
            )}
            scope="Paid Stripe access fully ended from Monday through now"
          />
          <MetricCard
            label="Stripe net this week"
            value={formatSignedNet(data.stripeWeek.net)}
            scope="New paid minus ended. Stripe only."
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-gray-500">
          Apple paying members are included in the total Paying Members count
          and both growth goals. They are not included in this week&apos;s
          plus/minus because historical Apple membership cannot currently be
          reconstructed reliably.
        </p>
      </section>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-gray-900">Growth funnel</h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          Selected period. Conversion is {UNKNOWN_METRIC} when adjacent stages
          use incompatible tracking windows.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {funnel.map((step, index) => (
            <FunnelStep
              key={step.label}
              step={index + 1}
              label={step.label}
              count={step.count}
              alsoCalled={step.alsoCalled}
              note={step.note}
              conversion={
                index === 0
                  ? "—"
                  : formatUnknownablePercent(
                      snapshot.period.funnelConversions[index - 1] ?? null
                    )
              }
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-gray-900">
          Subscribers &amp; retention
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StatCell
            label="Active monthly subscribers"
            value={formatUnknownableCount(snapshot.asOfNow.activeMonthly)}
            scope="As of now · Stripe monthly + Apple monthly"
          />
          <StatCell
            label="Active annual subscribers"
            value={formatUnknownableCount(snapshot.asOfNow.activeAnnual)}
            scope="As of now · Stripe annual; Apple has no annual SKU"
          />
          <StatCell
            label="Monthly versus annual"
            value={mixLabel}
            scope="As of now · among known paid plans"
          />
          <StatCell
            label="Cancelled during the free trial"
            value={formatUnknownableCount(snapshot.period.cancelledDuringTrial)}
            scope="Selected period · Stripe"
          />
          <StatCell
            label="Finished the trial without becoming paid"
            value={formatUnknownableCount(snapshot.period.finishedTrialWithoutPaid)}
            scope="Selected period · Stripe mature trials"
          />
          <StatCell
            label="Payment failed"
            value={formatUnknownableCount(snapshot.period.paymentFailed)}
            scope={`Selected period · ${snapshot.notes.paymentFailedScope}`}
            note="A billing attempt failed during the selected period. This is not the same as 'currently past due.' Includes Stripe payment failures and Apple failed renewals when available."
          />
          <StatCell
            label="Paid cancellation requested but access is still active"
            value={formatUnknownableCount(
              snapshot.asOfNow.appleCancelRequestedStillActive
            )}
            scope="As of now · Apple only"
            note={snapshot.notes.appleCancelRequestedNote}
          />
          <StatCell
            label="Paid subscription fully ended"
            value={formatUnknownableCount(snapshot.period.paidFullyEnded)}
            scope={`Selected period · ${snapshot.notes.paidEndedScope}`}
          />
          <StatCell
            label="Reactivated subscriber"
            value={formatUnknownableCount(snapshot.period.reactivated)}
            scope="Selected period · Stripe only"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-gray-900">Revenue</h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          These two numbers are different on purpose: one is actual Stripe cash
          collected during the period; the other is the current monthly value of
          Stripe subscriptions.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StatCell
            label="Stripe cash collected"
            value={formatUnknownableUsdFromCents(snapshot.period.stripeRevenueCents)}
            scope="Successful Stripe payments collected during the selected dates. Apple payments are not included. Refunds later are not subtracted."
            note="Also called: Revenue collected"
          />
          <StatCell
            label="Monthly value of current Stripe members"
            value={formatUnknownableUsdFromCents(snapshot.asOfNow.stripeMrrCents)}
            scope="Current monthly value of Stripe memberships. Annual plans are divided by 12. This is not cash collected. Apple is not included."
            note="Also called: Monthly recurring revenue equivalent"
          />
          <StatCell
            label="Advertising spend"
            value={spendValue}
            scope="Selected period · Meta ads + Google"
            note={
              spendStatus === "empty"
                ? "Add Meta or Google spend below to calculate advertising costs."
                : spendStatus === "unavailable"
                  ? "Ad spend could not be loaded."
                  : undefined
            }
          />
          <StatCell
            label="New paid subscribers attributed to advertising"
            value={formatUnknownableCount(snapshot.period.newPaidAttributedToAds)}
            scope="Selected period · first-touch paid only"
          />
          <StatCell
            label="Cost per paid subscriber"
            value={costPerPaidValue}
            scope="Selected period · blended period CPS"
            note={costPerPaidNote}
          />
        </div>
        <div className="mt-2">
          <SubscriberGrowthAdSpend entries={data.adSpendEntries} />
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-gray-900">
          Traffic source
        </h2>
        <div className="mb-2">
          <TrackingLinkBuilder />
        </div>
        {snapshot.notes.sourceTrackingUnavailable ? (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
              <table className="w-full table-fixed text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {TRAFFIC_TABLE_HEADINGS.map((heading) => (
                      <th key={heading} className="px-2 py-1.5 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-gray-700">
                    <td className="px-2 py-2" colSpan={TRAFFIC_TABLE_COLSPAN}>
                      Attribution tracking has not started yet. {UNKNOWN_METRIC}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600 md:hidden">
              <p className="font-medium text-gray-800">
                Attribution tracking has not started yet.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
              <table className="min-w-[960px] w-full text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {TRAFFIC_TABLE_HEADINGS.map((heading) => (
                      <th key={heading} className="px-2 py-1.5 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.trafficRows.length === 0 ? (
                    <tr className="text-gray-700">
                      <td className="px-2 py-2" colSpan={TRAFFIC_TABLE_COLSPAN}>
                        No measured traffic in this range.
                      </td>
                    </tr>
                  ) : (
                    snapshot.trafficRows.map((row) => (
                      <tr
                        key={trafficRowKey(row)}
                        className="border-t border-gray-100 text-gray-800"
                      >
                        <td className="px-2 py-1.5">{displaySource(row.sourceNormalized)}</td>
                        <td className="px-2 py-1.5">{displayPlatform(row.platform)}</td>
                        <td className="px-2 py-1.5">{row.utmCampaign || UNKNOWN_METRIC}</td>
                        <td className="px-2 py-1.5">{row.utmContent || UNKNOWN_METRIC}</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.visitors)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.accounts)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.trialsStarted)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.activated)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.paidConversions)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {row.advertisingSpendCents == null
                            ? UNKNOWN_METRIC
                            : spendStatus === "empty" && row.advertisingSpendCents === 0
                              ? SPEND_NOT_ENTERED
                              : spendStatus === "unavailable"
                                ? NOT_AVAILABLE
                                : formatUnknownableUsdFromCents(row.advertisingSpendCents)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatCostPerPaidDisplay(row.costPerPaidCents, spendStatus)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {snapshot.trafficRows.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
                  No measured traffic in this range.
                </div>
              ) : (
                snapshot.trafficRows.map((row) => {
                  const title = row.platform || displaySource(row.sourceNormalized);
                  return (
                    <div
                      key={trafficRowKey(row)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px]"
                    >
                      <div className="font-medium text-gray-900">{title}</div>
                      <div className="text-gray-700">
                        {row.utmContent || UNKNOWN_METRIC}
                      </div>
                      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <div>
                          <dt className="text-gray-500">Visitors</dt>
                          <dd className="tabular-nums">
                            {formatUnknownableCount(row.visitors)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Accounts</dt>
                          <dd className="tabular-nums">
                            {formatUnknownableCount(row.accounts)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Trials</dt>
                          <dd className="tabular-nums">
                            {formatUnknownableCount(row.trialsStarted)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Activated</dt>
                          <dd className="tabular-nums">
                            {formatUnknownableCount(row.activated)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Paid</dt>
                          <dd className="tabular-nums">
                            {formatUnknownableCount(row.paidConversions)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-1 text-gray-500">
                        Campaign: {row.utmCampaign || UNKNOWN_METRIC}
                      </p>
                      {row.advertisingSpendCents != null &&
                      row.advertisingSpendCents > 0 ? (
                        <p className="text-gray-500">
                          Spend:{" "}
                          {formatUnknownableUsdFromCents(row.advertisingSpendCents)}
                          {row.costPerPaidCents != null
                            ? ` · CPS ${formatUnknownableUsdFromCents(row.costPerPaidCents)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </section>

      <section data-latest-trials>
        <h2 className="mb-0.5 text-sm font-semibold text-gray-900">
          Latest Trials
        </h2>
        <p className="mb-1.5 text-[10px] text-gray-500">
          Last 20 people who started a free trial
        </p>
        <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {LATEST_TRIALS_HEADINGS.map((heading) => (
                  <th key={heading} className="px-2 py-1.5 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.latestTrials.length === 0 ? (
                <tr className="text-gray-700">
                  <td className="px-2 py-2" colSpan={LATEST_TRIALS_HEADINGS.length}>
                    No trial signups found.
                  </td>
                </tr>
              ) : (
                data.latestTrials.map((row, index) => (
                  <tr
                    key={latestTrialRowKey(row, index)}
                    className="border-t border-gray-100 text-gray-800"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {formatLatestTrialSignedUp(row.trialStartUnix)}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.personEmail || UNKNOWN_METRIC}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.sourceNormalized
                        ? displaySource(row.sourceNormalized)
                        : UNKNOWN_SOURCE_LABEL}
                    </td>
                    <td className="px-2 py-1.5">
                      {displayPlatform(
                        organicSocialPlatformLabel(
                          row.sourceNormalized,
                          row.utmSource
                        )
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.utmCampaign || UNKNOWN_METRIC}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.utmContent || UNKNOWN_METRIC}
                    </td>
                    <td className="px-2 py-1.5">
                      {activatedMark(row.activated, data.latestTrialsActivationComplete)}
                    </td>
                    <td className="px-2 py-1.5">{formatPersonFlag(row.paid)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 md:hidden">
          {data.latestTrials.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
              No trial signups found.
            </div>
          ) : (
            data.latestTrials.map((row, index) => {
              const sourceLabel = row.sourceNormalized
                ? displaySource(row.sourceNormalized)
                : null;
              const platformLabel = organicSocialPlatformLabel(
                row.sourceNormalized,
                row.utmSource
              );
              const headline = platformLabel
                ? `${platformLabel} · ${sourceLabel}`
                : sourceLabel;
              return (
                <div
                  key={latestTrialRowKey(row, index)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px]"
                >
                  <div className="font-medium text-gray-900">
                    {formatLatestTrialSignedUp(row.trialStartUnix)}
                  </div>
                  <div className="text-gray-800">
                    {row.personEmail || UNKNOWN_METRIC}
                  </div>
                  {headline ? (
                    <div className="mt-1.5 text-gray-700">{headline}</div>
                  ) : (
                    <div className="mt-1.5 text-gray-700">
                      Source {UNKNOWN_SOURCE_LABEL}
                    </div>
                  )}
                  {row.sourceNormalized ? (
                    <>
                      <p className="text-gray-500">
                        Campaign: {row.utmCampaign || UNKNOWN_METRIC}
                      </p>
                      <p className="text-gray-500">
                        Post: {row.utmContent || UNKNOWN_METRIC}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-500">
                        Campaign: {UNKNOWN_METRIC}
                      </p>
                      <p className="text-gray-500">
                        Post / Link {UNKNOWN_METRIC}
                      </p>
                    </>
                  )}
                  <p className="mt-1 text-gray-700">
                    Activated{" "}
                    {activatedMark(row.activated, data.latestTrialsActivationComplete)}
                  </p>
                  <p className="text-gray-700">Paid {formatPersonFlag(row.paid)}</p>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <details className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            Definitions &amp; how this dashboard works
          </summary>
          <div className="mt-2 space-y-3 text-[11px] text-gray-700">
            <div>
              <h3 className="text-xs font-semibold text-gray-900">
                How to use this page
              </h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  &quot;Company right now&quot; shows live whole-company numbers.
                </li>
                <li>
                  Growth goals and This week on Stripe ignore the date and source
                  filters.
                </li>
                <li>&quot;This period&quot; reports use the date/source filters.</li>
                <li>
                  Marketing source tracking only exists from the instrumentation
                  start date
                  {snapshot.notes.instrumentationStartLabel
                    ? ` (${snapshot.notes.instrumentationStartLabel})`
                    : ""}
                  .
                </li>
                <li>
                  Stripe and Apple do not always provide the same types of data.
                </li>
                <li>Ad spend is entered manually.</li>
                <li>
                  {UNKNOWN_METRIC} means there is no usable answer, not zero.
                </li>
                <li>
                  {NOT_AVAILABLE} means the system could not calculate the metric
                  reliably.
                </li>
                <li>
                  {SPEND_NOT_ENTERED} means ad spend has not been saved.
                </li>
                <li>No means a person did not do that thing.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-gray-900">Definitions</h3>
              <dl className="mt-1 space-y-2">
                {GLOSSARY.map((row) => (
                  <div key={row.term}>
                    <dt className="font-medium text-gray-900">{row.term}</dt>
                    <dd className="text-gray-600">{row.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

function latestTrialRowKey(row: LatestTrialRow, index: number): string {
  return [
    String(row.trialStartUnix),
    row.personEmail ?? "",
    row.sourceNormalized ?? "",
    row.utmContent ?? "",
    String(index),
  ].join("|");
}
