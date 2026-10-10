import Link from "next/link";

import { CopyBusinessReportButton } from "@/app/admin/copy-business-report-button";
import { ExperimentRegistryPanel } from "@/app/admin/experiment-registry";
import type { OperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { NO_CONTROLLED_EXPERIMENTS } from "@/lib/admin-operating-snapshot";
import { EXPERIMENT_NO_AUTOMATIC_WINNER } from "@/lib/operating-experiments";
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Experiments</h2>
        {!snapshot.experiments.available ? (
          <p className="text-sm text-gray-800">
            The experiment registry could not be read. Do not treat that as zero
            experiments.
          </p>
        ) : (
          <>
            {snapshot.experiments.records.some((record) => record.status === "running") ? (
              snapshot.experiments.records.some(
                (record) => record.area === focus && record.status === "running"
              ) ? null : (
                <p className="text-sm text-gray-800">
                  No {focus} experiments are running.
                </p>
              )
            ) : (
              <p className="text-sm text-gray-800">{NO_CONTROLLED_EXPERIMENTS}</p>
            )}
            <p className="text-sm text-gray-600">{EXPERIMENT_NO_AUTOMATIC_WINNER}</p>
            <p className="text-sm text-gray-600">
              Historical marketing changes are not listed as experiments. Evidence
              stays not yet tested until someone records a result.
            </p>
            <ExperimentRegistryPanel
              focus={focus}
              records={snapshot.experiments.records}
            />
          </>
        )}
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

function CheckoutFunnel({ snapshot }: { snapshot: OperatingSnapshot }) {
  const c = snapshot.checkout;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Checkout funnel</h2>
      <p className="text-sm text-gray-700">{c.cutover}</p>
      <p className="text-sm text-gray-700">{c.stepRate}</p>
      <p className="text-sm text-gray-700">{c.definitions}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric
          label="Visitors"
          value={snapshot.distribution.visitors}
          note="Unique people with a recorded page view."
        />
        <Metric
          label="Join clicks"
          value={c.joinClicks}
          note="Recorded trial_cta_clicked events. A click is not a checkout start."
        />
        <Metric
          label="Accounts created"
          value={snapshot.distribution.accountsCreated}
          note="Existing Clerk account count for this range."
        />
        <Metric
          label="Checkout started"
          value={c.sessions}
          note="Marked Checkout Sessions, not unique people and not Stripe customer ids."
        />
        <Metric
          label="Trials started"
          value={snapshot.distribution.trialStarts}
          note="Existing subscription trial starts. Not a second definition."
        />
      </div>
      <h3 className="text-base font-semibold text-gray-900">
        What happened to those checkout sessions
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Completed trial" value={c.completedTrial} />
        <Metric label="Still pending" value={c.pending} />
        <Metric label="Expired" value={c.expired} />
        <Metric label="Incomplete after 24 hours" value={c.incomplete} />
        <Metric label="Technical creation failures" value={c.creationFailed} note="Not included in the session total." />
        <Metric label="Unknown outcome" value={c.unknown} />
      </div>
      <p className="text-sm text-gray-700">
        Visitor link: {c.withVisitor} with a visitor id, {c.accountWithoutVisitor}{" "}
        known account without a visitor id, {c.noVisitorMatch} with no visitor
        match. Unknown source: {c.unknownSource}. Unattributed sessions stay in
        the checkout total.
      </p>
    </section>
  );
}

function AccountsWithoutMembership({ snapshot }: { snapshot: OperatingSnapshot }) {
  const census = snapshot.census;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Accounts Without Membership</h2>
      <p className="text-sm text-gray-700">{census.coverage}</p>
      <p className="text-sm text-gray-700">{census.recovery}</p>
      <p className="text-sm text-gray-700">{census.permission}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Clerk accounts examined" value={census.examined} />
        <Metric label="Clerk accounts in total" value={census.clerkTotal} note="Blank means the total count could not be read." />
        <Metric label="Confirmed current members" value={census.members} note="Stripe entitled, trialing, past due, or paused, or a current Apple grant." />
        <Metric label="Confirmed nonmembers" value={census.nonmembers} />
        <Metric label="Membership status unknown" value={census.unknown} note="Unknown is not counted as no membership." />
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        {census.categories.map((row) => (
          <li key={row.label}>
            {row.label}: {row.value}
          </li>
        ))}
      </ul>
      <p className="text-sm text-gray-700">{census.emailFact}</p>
      <p className="text-sm text-gray-700">
        <Link href="/admin/customers" className="underline">
          Open Customers
        </Link>{" "}
        to look up a person. This list has no email addresses or phone numbers.
      </p>
      {census.rows.length === 0 ? (
        <p className="text-sm text-gray-600">No confirmed nonmembers in this scan.</p>
      ) : (
        <ul className="space-y-2">
          {census.rows.map((row) => (
            <li
              key={row.clerkUserId}
              className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
            >
              <span className="font-medium">{row.category}</span>
              {". "}
              {row.createdLabel}. Clerk id {row.clerkUserId}.
            </li>
          ))}
        </ul>
      )}
    </section>
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

      <CheckoutFunnel snapshot={snapshot} />

      <AccountsWithoutMembership snapshot={snapshot} />

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

      <LandingPagePerformance snapshot={snapshot} />
      <LandingExperiments snapshot={snapshot} />
    </>
  );
}

function LandingExperiments({ snapshot }: { snapshot: OperatingSnapshot }) {
  const tests = snapshot.landingExperiments.filter((test) => test.loaded);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Controlled landing test</h2>
      <details className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">How this works</summary>
        <div className="mt-3 space-y-2">
          <p>
            We have five landing pages: the homepage, Leadership, Become Proud, Daily Coaching,
            and Life Worth Remembering.
          </p>
          <p>
            A test compares two of those pages. It has one entry link, such as /go/proud-test.
            Only people who use that link are in the test. Someone who opens a page on their own
            is not in the test.
          </p>
          <p>
            To make a test, create a planned experiment, type a short slug, and choose the two
            pages. The link is /go/ plus that slug. You do not need a new page or a new route.
          </p>
          <p>
            Start lets new visitors through that link get a page. Pause stops new people from
            joining. People already in the test keep their page. Complete is where you record
            the decision. The app does not pick a winner.
          </p>
          <p>
            Each person is placed once, about half on each page. The same person keeps the same
            page on later visits. Bots are left out. If placement fails, they see the homepage.
          </p>
          <p>
            Placement is not the same as seeing the page. We count a person only after they land
            on the page they were given. The redirect itself is not a view. A refresh does not
            count them again.
          </p>
          <p>
            A free trial counts when that person starts a real trial within 7 days and we can tie
            them to one page. A confirmed payment is a paid invoice after that trial. Changing
            Today or Last 7 Days on this dashboard does not change those numbers.
          </p>
          <p>
            Ads, email, and people who arrive on their own are different traffic. This test only
            compares people who came through the same entry link.
          </p>
          <p>
            A higher percentage is not a winner. Wait for 200 people on each page and 14 days.
            Trials that are still running are not finished payment results. If the tracking is
            unclear, the result is inconclusive.
          </p>
          <p>
            The app can prepare the planned test and count views, trials, and payments. You
            choose when to start, pause, and complete, and you write the decision.
          </p>
          <p>
            Later, these tests can be tied to who stays and what a customer is worth. This test
            does not do that yet.
          </p>
        </div>
      </details>
      {tests.map((test) => (
        <LandingExperimentResult key={test.entrySlug ?? test.name} test={test} />
      ))}
    </section>
  );
}

function LandingExperimentResult({ test }: { test: OperatingSnapshot["landingExperiments"][number] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium text-gray-900">{test.name}</h3>
      {test.entrySlug ? (
        <p className="text-sm text-gray-700">Entry: /go/{test.entrySlug}</p>
      ) : null}
      <p className="text-sm text-gray-700">{test.note}</p>
      <p className="text-sm text-gray-700">
        Status: {test.status}. Evidence: {test.evidence ?? "Not recorded."} Started:{" "}
        {test.startOn ?? "Not started."}
      </p>
      <p className="text-sm text-gray-700">
        Decision: {test.conclusion ?? "No measured result is stored."}
      </p>
      <p className="text-sm text-gray-700">Next: {test.nextAction ?? "No next action recorded."}</p>
      <p className="text-sm text-gray-700">Trial-start rate difference: {test.difference}</p>
      <p className="text-sm text-gray-600">{test.coverage}</p>
      {test.exposuresUnreadable ? (
        <p className="text-sm text-gray-800">
          Exposures could not be read. Do not treat that as zero visitors.
        </p>
      ) : (
        <div className="space-y-3">
          {test.rows.map((row) => (
            <article
              key={row.variant}
              className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
            >
              <h3 className="font-medium text-gray-900">
                {row.label} <span className="font-normal text-gray-500">{row.path}</span>
              </h3>
              <p className="mt-2">Exposed visitors: {row.exposed}</p>
              <p>Join clicks: {row.clicks}</p>
              <p>Checkout starts: {row.checkouts}</p>
              <p>Checkout creation failures: {row.checkoutFailures}</p>
              <p>Attributed trials: {row.trials}</p>
              <p>Trial-start rate: {row.trialRate}</p>
              <p>Confirmed paid conversions: {row.paid}</p>
              <p>Mature paid-conversion rate: {row.matureRate}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function LandingPagePerformance({ snapshot }: { snapshot: OperatingSnapshot }) {
  const landing = snapshot.landingPages;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Landing Page Performance</h2>
      <p className="text-sm text-gray-700">
        Range: {snapshot.rangeLabel}. {snapshot.timezone}.
      </p>
      <p className="text-sm text-gray-700">{landing.note}</p>
      {!landing.available ? (
        <p className="text-sm text-gray-800">
          Landing-page analytics could not be read. Do not treat that as zero visitors.
        </p>
      ) : (
        <div className="space-y-3">
          {landing.rows.map((row) => (
            <article
              key={row.id}
              className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
            >
              <h3 className="font-medium text-gray-900">
                {row.label}{" "}
                <span className="font-normal text-gray-500">{row.path}</span>
              </h3>
              <p className="mt-2">Unique visitors: {row.visitors}</p>
              <p>Trial-button clicks: {row.ctaClicks}</p>
              <p>Click rate: {row.ctaRate}</p>
              <p>Attributed trials: {row.trials}</p>
              <p>Visitor-to-trial: {row.visitorToTrial}</p>
              <p>Confirmed paid conversions: {row.paid}</p>
              <p>Trial-to-paid, mature trials: {row.trialToPaid}</p>
              <p className="mt-2 text-gray-600">{row.gap}</p>
            </article>
          ))}
        </div>
      )}
    </section>
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
