import Link from "next/link";

import {
  formatUnknownableCount,
  formatUnknownablePercent,
  formatUnknownableUsdFromCents,
  UNKNOWN_METRIC,
  type GrowthDateRange,
  type GrowthTrafficSource,
  type SubscriberGrowthDashboardData,
} from "@/lib/admin-subscriber-growth-pure";

import { SubscriberGrowthAdSpend } from "./subscriber-growth-ad-spend";

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

function MetricCard({
  label,
  value,
  scope,
}: {
  label: string;
  value: string;
  scope: string;
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
    </div>
  );
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
}: {
  step: number;
  label: string;
  count: string;
  conversion: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      <div className="text-[10px] text-gray-400">{step}</div>
      <div className="text-[11px] font-medium leading-snug text-gray-700">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {count}
      </div>
      <div className="text-[10px] text-gray-500">
        from prior: {conversion}
      </div>
    </div>
  );
}

export default function SubscriberGrowthDashboard({
  data,
}: {
  data: SubscriberGrowthDashboardData;
}) {
  const { snapshot, range, source } = data;
  const funnel = [
    {
      label: "Unique website visitors",
      count: snapshot.period.uniqueVisitors,
    },
    {
      label: "Free-trial button clicks",
      count: snapshot.period.freeTrialButtonClicks,
    },
    {
      label: "Accounts created",
      count: snapshot.period.accountsCreated,
    },
    {
      label: "Free trials started",
      count: snapshot.period.freeTrialsStarted,
    },
    {
      label: "Activated within 24 hours",
      count: snapshot.period.activatedWithin24h,
    },
    {
      label: "Trials converted to paid",
      count: snapshot.period.trialsConvertedToPaid,
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
          <p className="mt-1 text-xs text-gray-500">
            Aggregates only. Unknown values are {UNKNOWN_METRIC}. Snapshot
            metrics are as of now ({data.timezone}); period metrics use the
            selected range.
          </p>
          <p className="text-[11px] text-gray-500">As of {data.asOfNowLabel}</p>
          <p className="text-[11px] text-gray-500">{trackingNote}</p>
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
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map((option) => {
              const active = option.id === source;
              return (
                <Link
                  key={option.id}
                  href={sourceHref(range, option.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500">
            Traffic uses immutable first-touch. Google includes ads + organic.
            Ad metrics use paid acquisition only.
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Active paid subscribers"
            value={formatUnknownableCount(snapshot.asOfNow.activePaid)}
            scope="As of now"
          />
          <MetricCard
            label="Trial-to-paid conversion rate"
            value={formatUnknownablePercent(snapshot.period.trialToPaidRate)}
            scope="Selected period · Stripe mature trials"
          />
          <MetricCard
            label="Paid subscriber churn rate"
            value={formatUnknownablePercent(snapshot.period.paidChurnRate)}
            scope="Selected period · Stripe only"
          />
          <MetricCard
            label="Cost per paid subscriber"
            value={formatUnknownableUsdFromCents(snapshot.period.costPerPaid)}
            scope="Selected period · blended period CPS"
          />
        </div>
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
              count={formatUnknownableCount(step.count)}
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StatCell
            label="Revenue collected"
            value={formatUnknownableUsdFromCents(snapshot.period.stripeRevenueCents)}
            scope="Selected period · Stripe only"
            note="Gross paid invoices; later refunds not netted. Apple collected revenue is not available and is not estimated."
          />
          <StatCell
            label="Monthly recurring revenue equivalent"
            value={formatUnknownableUsdFromCents(snapshot.asOfNow.stripeMrrCents)}
            scope="As of now · Stripe list prices · Apple —"
            note="Apple MRR is unavailable. Annual = Price unit_amount / 12. Legacy and current prices use live Stripe amounts."
          />
          <StatCell
            label="Advertising spend"
            value={formatUnknownableUsdFromCents(snapshot.period.advertisingSpend)}
            scope="Selected period · Meta ads + Google"
          />
          <StatCell
            label="New paid subscribers attributed to advertising"
            value={formatUnknownableCount(snapshot.period.newPaidAttributedToAds)}
            scope="Selected period · first-touch paid only"
          />
          <StatCell
            label="Cost per paid subscriber"
            value={formatUnknownableUsdFromCents(snapshot.period.costPerPaid)}
            scope="Selected period · blended period CPS"
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
        {snapshot.notes.sourceTrackingUnavailable ? (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
              <table className="w-full table-fixed text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {[
                      "Source",
                      "Campaign",
                      "Specific advertisement",
                      "Website visitors",
                      "Trials started",
                      "Activated trials",
                      "Paid conversions",
                      "Advertising spend",
                      "Cost per paid subscriber",
                    ].map((heading) => (
                      <th key={heading} className="px-2 py-1.5 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-gray-700">
                    <td className="px-2 py-2" colSpan={9}>
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
              <table className="min-w-[860px] w-full text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {[
                      "Source",
                      "Campaign",
                      "Specific advertisement",
                      "Website visitors",
                      "Trials started",
                      "Activated trials",
                      "Paid conversions",
                      "Advertising spend",
                      "Cost per paid subscriber",
                    ].map((heading) => (
                      <th key={heading} className="px-2 py-1.5 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.trafficRows.length === 0 ? (
                    <tr className="text-gray-700">
                      <td className="px-2 py-2" colSpan={9}>
                        No measured traffic in this range.
                      </td>
                    </tr>
                  ) : (
                    snapshot.trafficRows.map((row) => (
                      <tr
                        key={`${row.sourceNormalized}|${row.utmCampaign}|${row.utmContent}`}
                        className="border-t border-gray-100 text-gray-800"
                      >
                        <td className="px-2 py-1.5">{displaySource(row.sourceNormalized)}</td>
                        <td className="px-2 py-1.5">{row.utmCampaign || UNKNOWN_METRIC}</td>
                        <td className="px-2 py-1.5">{row.utmContent || UNKNOWN_METRIC}</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableCount(row.visitors)}
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
                          {formatUnknownableUsdFromCents(row.advertisingSpendCents)}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatUnknownableUsdFromCents(row.costPerPaidCents)}
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
                snapshot.trafficRows.map((row) => (
                  <div
                    key={`${row.sourceNormalized}|${row.utmCampaign}|${row.utmContent}`}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px]"
                  >
                    <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div>
                        <dt className="text-gray-500">Source</dt>
                        <dd>{displaySource(row.sourceNormalized)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Campaign</dt>
                        <dd>{row.utmCampaign || UNKNOWN_METRIC}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Specific advertisement</dt>
                        <dd>{row.utmContent || UNKNOWN_METRIC}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Website visitors</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableCount(row.visitors)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Trials started</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableCount(row.trialsStarted)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Activated trials</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableCount(row.activated)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Paid conversions</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableCount(row.paidConversions)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Advertising spend</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableUsdFromCents(row.advertisingSpendCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Cost per paid subscriber</dt>
                        <dd className="tabular-nums">
                          {formatUnknownableUsdFromCents(row.costPerPaidCents)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
