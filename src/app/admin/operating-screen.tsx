import Link from "next/link";

import { CopyBusinessReportButton } from "@/app/admin/copy-business-report-button";
import { DistributionIntelligencePanel } from "@/app/admin/distribution-intelligence-panel";
import type { PersonalVideoDistribution } from "@/lib/personal-videos/analytics";
import { NonmemberRecoveryPanel } from "@/app/admin/nonmember-recovery-panel";
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

function PersonalVideosSection({ report }: { report: PersonalVideoDistribution }) {
  const count = (value: number | null) => (report.eventsReadable ? String(value ?? 0) : "Not available");
  const billing = (value: number | null) => (report.billingReadable ? String(value ?? 0) : "Not available");
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Personal Videos</h2>
        <Link href="/admin/personal-videos" className="text-sm text-gray-800 underline">
          Open Personal Video Studio
        </Link>
      </div>
      <p className="text-sm text-gray-700">{report.note}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Links marked sent" value={report.linksSent == null ? "Not available" : String(report.linksSent)} note="Manual sent marks. Created videos are not this count." />
        <Metric label="Links visited" value={report.linksVisited == null ? "Not available" : String(report.linksVisited)} note="Sent links with at least one recorded visit." />
        <Metric label="Link visit rate" value={report.linkVisitRate} note="Links visited / links marked sent." />
        <Metric label="Unique visitors" value={report.uniqueVisitors} note="Distinct browsers. This is not the link visit rate." />
        <Metric label="Video plays" value={report.plays} note={report.playRate} />
        <Metric label="CTA clicks" value={report.ctaClicks} note={report.ctaRate} />
        <Metric label="Attributed free trials" value={report.trials} note={report.trialRate} />
        <Metric label="Attributed paying subscribers" value={report.paid} note={report.paidRate} />
      </div>
      {report.rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm text-gray-800">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Visits</th>
                <th className="px-3 py-2 font-medium">Plays</th>
                <th className="px-3 py-2 font-medium">CTA clicks</th>
                <th className="px-3 py-2 font-medium">Trials</th>
                <th className="px-3 py-2 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{row.createdAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.sentAt ? row.sentAt.slice(0, 10) : "Not sent"}</td>
                  <td className="px-3 py-2">{count(row.visitors)}</td>
                  <td className="px-3 py-2">{count(row.plays)}</td>
                  <td className="px-3 py-2">{count(row.ctaClicks)}</td>
                  <td className="px-3 py-2">{billing(row.trials)}</td>
                  <td className="px-3 py-2">{billing(row.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
          label="Start Free Trial clicks"
          value={snapshot.distribution.trialClicks}
          note="Recorded trial_cta_clicked events. A click is not a checkout start."
        />
        <Metric
          label="Checkout started"
          value={snapshot.distribution.checkoutSessions}
          note="Distinct checkout_opened Checkout Session ids. A session is not a free trial."
        />
        <Metric
          label="Trials started"
          value={snapshot.distribution.trialStarts}
          note="Stripe subscriptions whose free trial started. Monthly and annual both count. Not a checkout session."
        />
        <Metric
          label="Paying subscribers"
          value={snapshot.distribution.newPayingMembers}
          note="Trials whose free week ended in this range and became paid. Not every new invoice."
        />
        <Metric
          label="Account creation"
          value={snapshot.distribution.accountsCreated}
          note="Clerk accounts created in this range. Not a trial and not a checkout."
        />
      </div>
      <p className="text-sm text-gray-700">{snapshot.distribution.checkoutNote}</p>
      <h3 className="text-base font-semibold text-gray-900">
        Stamped Checkout Session outcomes
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
        <Metric label="Start Free Trial clicks" value={d.trialClicks} />
        <Metric
          label="Checkout started"
          value={d.checkoutSessions}
          note="Distinct Checkout Sessions. Not a free trial."
        />
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
        <Metric
          label="Account creation"
          value={d.accountsCreated}
          note="Clerk accounts. Not a trial and not a checkout."
        />
        <Metric label="Trials per day in this range" value={d.trialsPerDay} />
      </section>

      <CheckoutFunnel snapshot={snapshot} />

      <AccountsWithoutMembership snapshot={snapshot} />

      <p className="text-sm text-gray-800">
        {snapshot.recoveryAutomation.repliesNeeding == null ? (
          <>Reply monitoring is not connected. This is not zero replies.</>
        ) : snapshot.recoveryAutomation.repliesNeeding > 0 ? (
          <a href="#needs-your-reply" className="font-medium underline">
            Recovery replies needing your attention: {snapshot.recoveryAutomation.repliesNeeding}
          </a>
        ) : (
          <>Recovery replies needing your attention: 0</>
        )}
      </p>

      <NonmemberRecoveryPanel
        recovery={snapshot.nonmemberRecovery}
        attention={snapshot.recoveryAutomation}
      />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Where visitors and subscribers came from</h2>
        <p className="text-sm text-gray-600">
          Visitor, Start Free Trial click, Checkout Session with a stored source, free trial,
          then paying subscriber. Meta, Google, organic social, email, referral, direct, and UTM
          rows stay on the source already stored. A person who cannot be matched is not assigned
          a source. The homepage test of / and /become-proud is unchanged.
        </p>
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
                {source.visitors} visitors, {source.trialClicks} trial clicks,{" "}
                {source.checkouts} checkout started, {source.trials} trials, {source.paid}{" "}
                paid
              </li>
            ))}
          </ul>
        )}
      </section>

      <PersonalVideosSection report={snapshot.personalVideos} />

      <DistributionIntelligencePanel intel={snapshot.distributionIntelligence} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Connection to retention</h2>
        <p className="text-sm text-gray-700">{snapshot.retentionIntelligence.bridge}</p>
        <p className="text-sm text-gray-700">
          <Link href="/admin/retention" className="text-gray-800 underline">
            Open Retention
          </Link>{" "}
          for cohort, tenure, and source detail. A source with a higher rate is not a winner.
        </p>
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
            We have two landing pages: the homepage and Become Proud. Entry is automatic homepage
            traffic — /. Eligible anonymous visitors are placed about half on each page. Meta,
            Google, organic, social, email, and direct visits to / are in the same test.
          </p>
          <p>
            A direct visit to /become-proud is not an assignment. Signed-in members are not
            enrolled. The old /go/proud-test link only redirects to /, where the split happens.
          </p>
          <p>
            Pause stops new people from joining. People already in the test keep their page.
            Complete is where you record the decision. The app does not pick a winner.
          </p>
          <p>
            Each person is placed once, about half on each page. The same person keeps the same
            page on later visits. Bots are left out. If placement fails, they see the homepage.
          </p>
          <p>
            Placement is stored as its own record and is not the same as seeing the page. The
            primary trial rate uses everyone who was assigned, including people who never produced
            a page view. The exposed-visitor rate is shown separately. A refresh does not assign
            them again. Returning visitors keep the page they were given.
          </p>
          <p>
            A free trial counts when Stripe starts a real trial within 7 days of assignment and
            we can tie that person to one page. Creating an account is not a trial. A Clerk
            account created after Stripe is still account creation, not a trial. A button click
            is not a checkout. A checkout session is not proof the hosted checkout page was seen.
            Public signup is Stripe-first. Assignment to / or /become-proud is unchanged.
            A confirmed payment is a paid invoice after that trial. Apple memberships are not
            included. Changing Today or Last 7 Days on this dashboard does not change those numbers.
          </p>
          <p>
            Everyone eligible who opens the homepage is in one population. A direct open of
            Become Proud stays outside that population.
          </p>
          <p>
            A higher percentage is not a winner. The screen says Collecting Data until 14 days
            have passed and each page has 100 visitors whose 7-day trial window has closed.
            People assigned more recently stay in the live counts and are not treated as failures.
            Promising Direction means one page is ahead, but that is not a reason to move the
            budget. Actionable Winner requires 28 days, 100 closed-window visitors on each page,
            at least 15 tied trials, and a wider 99% bar because these results are checked more
            than once. A large gap in confirmed page views blocks that call. Inconclusive means
            that observation happened and the gap is too small. Measurement Problem means the
            tracking could not be read, or the pages are not being measured the same way. Stripe
            trials with no visitor link are labeled Unknown and are not subtracted from either
            page. This does not pick a winner. You record the decision.
          </p>
          <p>
            The app can prepare the planned test and count views, trials, and payments. You
            choose when to start, pause, and complete, and you write the decision.
          </p>
          <p>
            Long-term retention is on the retention view, not this scoreboard. Scroll depth,
            section visibility, and engaged time explain where people go. They do not decide
            the winner. Scroll percentages are imperfect because the pages have different lengths.
            Neither sales page currently plays a video.
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
      {test.entrySlug === "proud-test" ? (
        <p className="text-sm text-gray-700">Entry: Automatic homepage traffic — /</p>
      ) : test.entrySlug ? (
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
      <p className="text-sm font-medium text-gray-900">Evidence: {test.evidenceState}</p>
      <p className="text-sm text-gray-700">{test.evidenceNote}</p>
      <p className="text-sm text-gray-700">Trial-start rate difference: {test.difference}</p>
      <p className="text-sm text-gray-600">{test.coverage}</p>
      {test.exposuresUnreadable ? (
        <p className="text-sm text-gray-800">
          Exposures could not be read. Do not treat that as zero visitors.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {test.rows.map((row) => (
            <article
              key={row.variant}
              className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
            >
              <h3 className="font-medium text-gray-900">
                {row.label} <span className="font-normal text-gray-500">{row.path}</span>
              </h3>
              <p className="mt-2">Assigned visitors: {row.assigned}</p>
              <p>Confirmed page exposures: {row.exposed}</p>
              <p>CTA clickers: {row.clicks}</p>
              <p>Completed accounts: {row.accounts}</p>
              <p>Accounts that already existed: {row.priorAccounts}</p>
              <p>Checkout sessions created: {row.checkouts}</p>
              <p>Checkout creation failures: {row.checkoutFailures}</p>
              <p>Genuine free-trial starts: {row.trials}</p>
              <p>Trial rate per assigned visitor: {row.trialRate}</p>
              <p>Trial rate per exposed visitor: {row.exposedTrialRate}</p>
              <p>First paying subscribers: {row.paid}</p>
              <p>Mature trial-to-paid: {row.matureRate}</p>
            </article>
          ))}
        </div>
      )}
      <details className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Funnel details</summary>
        <p className="mt-3">
          Checkout sessions created are not proof the visitor saw the hosted checkout page. Account
          created is not a trial. A failed checkout creation is separate from someone who left.
        </p>
      </details>
      <details className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Visitor behavior</summary>
        <div className="mt-3 space-y-2">
          <p>{test.behaviorNote}</p>
          {test.ctaRows.length === 0 ? (
            <p>No named CTA clicks recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {test.ctaRows.map((row) => (
                <li key={row.surface}>
                  {row.label}: {row.clickers} people, {row.rawClicks} clicks, {row.rate} of exposed
                  visitors on that page.
                </li>
              ))}
            </ul>
          )}
          {test.sectionLines.length > 0 ? (
            <ul className="space-y-1">
              {test.sectionLines.map((line) => (
                <li key={line.id}>
                  {line.path} {line.label}: {line.reached} reached, {line.rate} of visitors with
                  behavior telemetry.
                </li>
              ))}
            </ul>
          ) : null}
          <p>{test.scrollNote}</p>
          <p>{test.engagedNote}</p>
          <p>{test.videoNote}</p>
        </div>
      </details>
      <details className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Traffic and devices</summary>
        <div className="mt-3 space-y-2">
          <p>{test.campaignNote}</p>
          <p>{test.deviceNote}</p>
        </div>
      </details>
      <details className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Measurement health</summary>
        <div className="mt-3 space-y-2">
          <p>Unknown trials: {test.unknownTrials}. These were not assigned to either page.</p>
          <p>
            Assignment counts are rows that were saved. A failed save is not a zero. A blocked
            browser id is not a person.
          </p>
          <p>{test.videoNote}</p>
        </div>
      </details>
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

function RetentionGroupList({
  title,
  rows,
  hiddenSmall,
  empty,
}: {
  title: string;
  rows: OperatingSnapshot["retentionIntelligence"]["sources"];
  hiddenSmall?: number;
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {rows.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="font-medium text-gray-900">{row.label}: </span>
              {row.rate}. Continuously retained {row.retained}. Ended {row.ended}. Rejoined{" "}
              {row.rejoined}. Unknown {row.unknown}. Not old enough {row.immature}.
              {row.retained + row.ended + row.rejoined > 0 &&
              row.retained + row.ended + row.rejoined < 15
                ? " Small sample."
                : ""}
            </li>
          ))}
        </ul>
      )}
      {hiddenSmall ? <p>{hiddenSmall} smaller groups are not shown.</p> : null}
    </div>
  );
}

function RetentionBody({ snapshot }: { snapshot: OperatingSnapshot }) {
  const r = snapshot.retention;
  const intel = snapshot.retentionIntelligence;
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
          {intel.status === "ready"
            ? "Milestone retention is in the sections below. A quiet member is not an incident."
            : "D30, D60, and D90 cohorts are not available. This page does not guess why someone left, and it does not flag someone for being quiet."}
        </p>
      </section>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-lg font-semibold text-gray-900">Retention intelligence</h2>
        <p>
          Lifetime of paid membership. The date range above applies to the counts in the first
          section. It does not change these cohorts.
        </p>
        <details className="rounded border border-gray-200 bg-white px-4 py-3">
          <summary className="cursor-pointer font-medium text-gray-900">How this works</summary>
          <div className="mt-3 space-y-2">
            <p>
              Retention here means a person is still entitled to a paid membership a set number
              of days after their first confirmed payment.
            </p>
            <p>
              Day 30, 60, 90, 180, and 365 show whether people are still members after a month,
              two months, a quarter, half a year, and a year.
            </p>
            <p>
              Only members who have already reached that day are counted. Someone who started
              paying 20 days ago is left out of day 30. They are not a failure.
            </p>
            <p>
              The free trial is not paid time. Paid time starts at the first confirmed paid
              invoice, not at the trial start.
            </p>
            <p>
              The longest-lasting list uses verified paid time for members with a Clerk id. It
              is only on this page. The copied report has the totals, not the names or ids.
            </p>
            <p>
              An annual membership stays active until it ends. A missing monthly payment does
              not end it, because an annual plan is not billed every month.
            </p>
            <p>
              Member-requested means Stripe recorded that the member asked to cancel. Payment
              failure means Stripe recorded a failed payment and the membership has an end time.
              A canceled status by itself is not a request. Past due and paused memberships are
              still entitled.
            </p>
            <p>
              Feature use is compared beside retention. That is an observation. It does not
              prove the feature made someone stay.
            </p>
            <p>
              Source, campaign, and controlled-test labels come from the same first-touch
              attribution the business already stores. The landing page is the earliest
              homepage or audience page recorded on or after October 10, 2026. If that page
              cannot be linked, it is Unknown. A higher rate is not an experiment result.
            </p>
            <p>
              Apple memberships are not in these cohorts, because a first confirmed Apple
              payment time is not stored. A membership with no reliable end time is Unknown.
              A paid subscription with no Clerk id is Unknown. Unknown is not churn.
            </p>
            <p>
              The page calculates this from existing billing and product records when it loads.
              Tyler reads it and decides what to change. This page does not cancel, contact,
              or start a test.
            </p>
            <p>
              The later goal is to see which acquisition sources and product experiences show
              up among members who stay for years. This version only measures. It does not
              pick a winner.
            </p>
          </div>
        </details>
        <p>{intel.definition}</p>
        {intel.partial ? (
          <p className="text-gray-900">Partial read. Do not quote this as the whole business.</p>
        ) : null}
        {intel.status === "unreadable" || intel.withheld ? (
          <p>{intel.withheld ?? intel.definition}</p>
        ) : (
          <>
            <h3 className="font-medium text-gray-900">Retention over time</h3>
            {intel.milestones.map((milestone) => (
              <p key={milestone.label}>
                <span className="font-medium text-gray-900">{milestone.label}: </span>
                {milestone.rate}. {milestone.coverage}
              </p>
            ))}

            <h3 className="font-medium text-gray-900">Membership longevity</h3>
            <p>
              Completed paid periods: {intel.completedCount}. Average {intel.averageCompletedDays}.
              Median {intel.medianCompletedDays}. Current active memberships are not included in
              the average or median.
            </p>
            <p>
              Longest completed {intel.longestCompletedDays}. Longest active {intel.longestActiveDays}.
              Current paying members: {intel.activeCount}.
            </p>
            <ul className="space-y-1">
              {intel.activeByBand.map((band) => (
                <li key={band.label}>
                  {band.label}: {band.count}
                </li>
              ))}
            </ul>

            <h3 className="font-medium text-gray-900">Longest-lasting members</h3>
            <p>
              Admin lookup only. Phone numbers and email addresses are not shown. This list is
              not in the copied report.
            </p>
            {intel.longestMembers.length === 0 ? (
              <p>No verified paid tenure in this read.</p>
            ) : (
              <ul className="space-y-1">
                {intel.longestMembers.map((member) => (
                  <li key={`${member.clerkUserId}-${member.state}`}>
                    {member.days} days, {member.state}, {member.plan}. {member.clerkUserId}
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link href="/admin/customers" className="text-gray-800 underline">
                Open Customers
              </Link>
            </p>

            <h3 className="font-medium text-gray-900">Why memberships end</h3>
            <p>
              Member-requested {intel.memberRequested}. Payment failure {intel.paymentFailure}.
              Other known {intel.otherKnown}. Unknown reason {intel.unknownReason}. End time
              unknown {intel.endTimeUnknown}.
            </p>
            <p>{intel.churnNote}</p>
            <p>
              {intel.customerFeedbackCount > 0
                ? `Stripe stored a feedback value on ${intel.customerFeedbackCount} ended memberships. Those words are not copied here.`
                : "No customer-written cancellation reason is stored on these ended memberships."}
            </p>
            <p>
              <Link href="/admin/feedback" className="text-gray-800 underline">
                Weekly Feedback
              </Link>
            </p>

            <h3 className="font-medium text-gray-900">Member experiences and retention</h3>
            <p>{intel.engagementNote}</p>
            {intel.engagement.map((row) => (
              <p key={`paid-${row.label}`}>
                {row.window}, {row.label}: used {row.usedRate}; did not use {row.unusedRate}.
                {row.small ? " Small sample." : ""}
              </p>
            ))}
            {intel.trialEngagement.length > 0 ? (
              <p className="font-medium text-gray-900">During the free trial, among people who later paid</p>
            ) : null}
            {intel.trialEngagement.map((row) => (
              <p key={`trial-${row.label}`}>
                {row.label}: used {row.usedRate}; did not use {row.unusedRate}.
                {row.small ? " Small sample." : ""}
              </p>
            ))}

            <h3 className="font-medium text-gray-900">Where long-lasting members come from</h3>
            <p>Day 30, observational. Unknown stays visible. This is not an experiment result.</p>
            <RetentionGroupList
              title="First-touch source"
              rows={intel.sources}
              hiddenSmall={intel.sourceHiddenSmall}
              empty={
                intel.acquisitionReadable
                  ? "No source rows in this read."
                  : "Acquisition source could not be joined."
              }
            />
            <RetentionGroupList
              title="Campaign"
              rows={intel.campaigns}
              empty={intel.acquisitionReadable ? "No campaign rows in this read." : "Campaigns could not be joined."}
            />
            <RetentionGroupList
              title="Content"
              rows={intel.content}
              empty={intel.acquisitionReadable ? "No content rows in this read." : "Content could not be joined."}
            />
            <RetentionGroupList
              title="Landing page"
              rows={intel.landings}
              empty={intel.landingReadable ? "No landing-page rows in this read." : "Landing page could not be joined."}
            />
            <RetentionGroupList
              title="Controlled experiment"
              rows={intel.experiments}
              empty={
                intel.experimentReadable
                  ? "No experiment rows in this read."
                  : "Experiment exposure could not be joined."
              }
            />
          </>
        )}
        <p>{intel.appleNote}</p>
      </section>
    </>
  );
}
