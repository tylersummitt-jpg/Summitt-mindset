import Link from "next/link";

import { CopyBusinessReportButton } from "@/app/admin/copy-business-report-button";
import type { OperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { NO_CONTROLLED_EXPERIMENTS } from "@/lib/admin-operating-snapshot";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";

const RANGES: Array<{ id: GrowthDateRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "all_time", label: "All time" },
];

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-1 text-xs text-gray-500">{note}</p> : null}
    </div>
  );
}

export function OperatingScreen({
  focus,
  snapshot,
}: {
  focus: "distribution" | "retention";
  snapshot: OperatingSnapshot;
}) {
  const href = (range: GrowthDateRange) =>
    focus === "distribution"
      ? `/admin/distribution?range=${range}`
      : `/admin/retention?range=${range}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {focus === "distribution" ? "Distribution" : "Retention"}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {focus === "distribution"
            ? "How are we getting customers, what's working, and what should we do next?"
            : "Are people staying, why might they leave, and what should we improve?"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          As of {snapshot.asOfLabel}. Range: {snapshot.rangeLabel}.{" "}
          {snapshot.timezone}.
        </p>
      </div>

      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/admin/distribution" className="text-gray-800 underline">
          Distribution
        </Link>
        <Link href="/admin/retention" className="text-gray-800 underline">
          Retention
        </Link>
        <Link href="/admin/subscriber-growth" className="text-gray-800 underline">
          Subscriber Growth
        </Link>
        <Link href="/admin/customers" className="text-gray-800 underline">
          Customers
        </Link>
        <Link href="/admin/feedback" className="text-gray-800 underline">
          Weekly Feedback
        </Link>
        <Link href="/admin/tyler-text-overview" className="text-gray-800 underline">
          Tyler Text Overview
        </Link>
        <Link href="/admin/sms-opt-out-reviews" className="text-gray-800 underline">
          Opt-Out Reviews
        </Link>
        <Link href="/admin/account-deletions" className="text-gray-800 underline">
          Account Deletions
        </Link>
      </nav>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((range) => (
          <Link
            key={range.id}
            href={href(range.id)}
            className={
              snapshot.range === range.id
                ? "rounded bg-gray-900 px-3 py-1 text-sm text-white"
                : "rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800"
            }
          >
            {range.label}
          </Link>
        ))}
      </div>

      <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
        {snapshot.distribution.goal}
      </p>

      {focus === "distribution" ? (
        <DistributionBody snapshot={snapshot} />
      ) : (
        <RetentionBody snapshot={snapshot} />
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Today&apos;s actions</h2>
        {snapshot.actions.length === 0 ? (
          <p className="text-sm text-gray-600">
            Nothing recorded needs action in this view.
          </p>
        ) : (
          <ul className="space-y-3">
            {snapshot.actions.map((action) => (
              <li
                key={action.id}
                className="rounded border border-gray-200 bg-white px-4 py-3 text-sm"
              >
                <p className="font-medium text-gray-900">
                  {action.title}{" "}
                  <span className="font-normal text-gray-500">
                    {action.category} · {action.priority} · {action.kind}
                  </span>
                </p>
                <p className="mt-1 text-gray-700">{action.evidence}</p>
                <p className="mt-1 text-gray-700">Next: {action.nextStep}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Experiments</h2>
        <p className="text-sm text-gray-800">{NO_CONTROLLED_EXPERIMENTS}</p>
        <p className="text-sm text-gray-600">
          Active, planned, and completed are empty. Evidence is not yet tested.
          Historical marketing changes are not listed as experiments.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Unknowns</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          {snapshot.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Business report</h2>
          <CopyBusinessReportButton report={snapshot.report} />
        </div>
        <p className="text-xs text-gray-500">
          The same report is copied from Distribution and Retention.
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-4 text-xs text-gray-800">
          {snapshot.report}
        </pre>
      </section>
    </div>
  );
}

function DistributionBody({ snapshot }: { snapshot: OperatingSnapshot }) {
  const d = snapshot.distribution;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2">
        <Metric label="Unique visitors" value={d.visitors} />
        <Metric label="Trial starts" value={d.trialStarts} />
        <Metric
          label="Visitor-to-trial"
          value={d.visitorToTrial}
          note="Trial starts divided by visitors, using the existing conversion rate. Blank means one of those counts is missing."
        />
        <Metric
          label="Trial-to-paid"
          value={d.trialToPaid}
          note="Existing rate for trials that already ended in this range."
        />
        <Metric
          label="New paying members"
          value={d.newPayingMembers}
          note="Mature trials in this range that converted. Not every new invoice."
        />
        <Metric label="Accounts created" value={d.accountsCreated} />
        <Metric label="Trials per day in this range" value={d.trialsPerDay} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Where trials came from</h2>
        {snapshot.sources.length === 0 ? (
          <p className="text-sm text-gray-600">No source rows for this range.</p>
        ) : (
          <ul className="space-y-2">
            {snapshot.sources.map((source, index) => (
              <li
                key={`${source.label}-${index}`}
                className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
              >
                <span className="font-medium">{source.label}</span>
                {": "}
                {source.visitors} visitors, {source.trials} trials, {source.paid}{" "}
                paid
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RetentionBody({ snapshot }: { snapshot: OperatingSnapshot }) {
  const r = snapshot.retention;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2">
        <Metric
          label="Current paying members"
          value={r.payingMembers}
          note="Existing active paid count. Apple grants are included when that count is available."
        />
        <Metric label="Trials that converted to paid" value={r.trialsConverted} />
        <Metric label="Cancelled during trial" value={r.cancelledDuringTrial} />
        <Metric
          label="Finished trial without paying"
          value={r.finishedTrialWithoutPaid}
        />
        <Metric label="Paid memberships ended" value={r.paidMembershipsEnded} />
        <Metric label="Paid subscriber churn" value={r.churn} />
        <Metric label="Stripe past due now" value={r.pastDueNow} />
        <Metric label="Payment failures in this range" value={r.paymentFailedInRange} />
        <Metric label="Free week running now" value={r.freeWeekNow} />
        <Metric
          label="Stripe revenue"
          value={r.stripeRevenue}
          note="Apple revenue is not in this number."
        />
      </section>

      <section className="space-y-2 text-sm text-gray-700">
        <h2 className="text-lg font-semibold text-gray-900">Why someone might leave</h2>
        <p>
          <span className="font-medium text-gray-900">From the member: </span>
          not collected here. Read Weekly Feedback for words they actually wrote.
        </p>
        <p>
          <span className="font-medium text-gray-900">Observed: </span>
          {r.cancelledDuringTrial} cancelled during a trial,{" "}
          {r.finishedTrialWithoutPaid} finished a trial without paying, and{" "}
          {r.paidMembershipsEnded} paid memberships ended. These are counts, not
          reasons.
        </p>
        <p>
          <span className="font-medium text-gray-900">Unknown: </span>
          D30, D60, and D90 cohorts are not available. This page does not guess
          why someone left, and it does not flag someone for being quiet.
        </p>
      </section>
    </>
  );
}
