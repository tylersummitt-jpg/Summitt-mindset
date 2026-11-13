"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { AdLabAdCard, AdLabExperimentView, AdLabLab, AdLabNotes } from "@/lib/ad-lab-product-pure";

type Tab = "overview" | "ads" | "experiments" | "learning";

const METRIC_LABEL: Record<string, string> = {
  outbound_ctr: "Outbound click rate",
  verified_trials: "Verified Stripe trials",
  paying_subscribers: "Paying subscribers",
  cost_per_trial: "Cost per verified trial",
};

export function AdLabWorkspace({ lab }: { lab: AdLabLab }) {
  const [tab, setTab] = useState<Tab>("overview");
  const active = lab.experiments.filter((experiment) => experiment.status === "active");
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Summitt Ad Lab</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Imported Meta delivery, Stripe trials only where the first touch is a stored Meta id, and
            experiments you choose. This does not change the hand-entered spend above.
          </p>
        </div>
        <p className="text-xs text-stone-500">{freshness(lab)}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["overview", "Overview"],
            ["ads", "Live ads"],
            ["experiments", "Experiments"],
            ["learning", "Learning library"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              tab === id ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "overview" ? <Overview lab={lab} active={active} /> : null}
        {tab === "ads" ? <LiveAds lab={lab} /> : null}
        {tab === "experiments" ? <Experiments lab={lab} /> : null}
        {tab === "learning" ? <Learning lab={lab} /> : null}
      </div>
    </section>
  );
}

function Overview({ lab, active }: { lab: AdLabLab; active: AdLabExperimentView[] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Today's Meta spend" value={money(lab.todaySpendCents, lab.currency)} />
        <Stat label="This week" value={money(lab.weekSpendCents, lab.currency)} />
        <Stat label="Active ads" value={lab.activeCount == null ? "—" : String(lab.activeCount)} />
      </div>
      <div className="rounded-xl bg-stone-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">What the data says</p>
        <p className="mt-1 text-sm text-stone-900">{lab.recommendation.says}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">What we have learned</p>
        <p className="mt-1 text-sm text-stone-800">{lab.recommendation.learned}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">What to do next</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{lab.recommendation.next}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <Stat label="Trials tied to one ad" value={lab.adAttributedTrials == null ? "—" : String(lab.adAttributedTrials)} />
        <Stat label="Trials tied to a campaign only" value={lab.campaignOnlyTrials == null ? "—" : String(lab.campaignOnlyTrials)} />
        <Stat
          label="Paying subscribers tied to one ad"
          value={
            lab.paidMonthly == null
              ? "—"
              : `${lab.paidMonthly} monthly, ${lab.paidAnnual ?? 0} annual`
          }
        />
      </div>
      <p className="text-sm text-stone-600">
        Counts and costs on this screen use {lab.rangeSince} through {lab.rangeUntil}. A trial counts only when it started in those dates. A later trial is not part of the cost. Cost per paying subscriber stays blank while anyone in that group is still trialing.
        A trial is tied to one ad only when its stored first-touch content is that Meta ad id.
        Campaign-only and unlabeled trials are not assigned to a creative.{" "}
        {lab.unattributedTrials == null
          ? "Trial counts are hidden because the Stripe list was incomplete."
          : `${lab.unattributedTrials} trial${lab.unattributedTrials === 1 ? "" : "s"} have no stored Meta ad id.`}
        {" "}People still inside a trial are not counted as failed subscribers.
        {lab.stillTrialing != null && lab.stillTrialing > 0
          ? ` ${lab.stillTrialing} of the ad-tied trials are still inside the trial.`
          : ""}
        {!lab.paymentsKnown ? " Paid counts are hidden because the Stripe invoice read was incomplete." : ""}
        {!lab.attributionComplete ? " First-touch read was incomplete, so some matches may be missing." : ""}
        {!lab.storageReady ? " Experiment storage is not ready yet, so notes and experiments cannot be saved." : ""}
      </p>
      {active.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Active experiments</h3>
          <ul className="mt-2 space-y-2">
            {active.map((experiment) => (
              <li key={experiment.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                <span className="font-medium">{experiment.name}</span>
                <span className="ml-2 text-stone-500">{experiment.evidence}</span>
                <p className="mt-1 text-stone-600">{experiment.comparisonNote}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-stone-600">No experiment is active.</p>
      )}
    </div>
  );
}

function LiveAds({ lab }: { lab: AdLabLab }) {
  if (lab.ads.length === 0) {
    return <p className="text-sm text-stone-600">No advertisements are stored for this range.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        Delivery and trials both use {lab.rangeSince} through {lab.rangeUntil}. Outbound CTR is outbound clicks divided by impressions. A dash means the number was not reported, or the cost cannot be calculated. It is not zero.
        {lab.creativeRead === "unavailable" ? " Creative text could not be read from Meta just now." : ""}
      </p>
      {lab.ads.map((ad) => (
        <details key={ad.metaAdId} className="rounded-xl border border-stone-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-stone-900">
            {ad.adName}{" "}
            <span className="font-normal text-stone-500">{ad.status ?? "status unknown"}</span>
          </summary>
          <AdFacts ad={ad} currency={lab.currency} />
          <NoteForm ad={ad} />
        </details>
      ))}
    </div>
  );
}

function AdFacts({ ad, currency }: { ad: AdLabAdCard; currency: string }) {
  const rows: [string, string][] = [
    ["Campaign", ad.campaignName ?? "—"],
    ["Ad set", ad.adsetName ?? "—"],
    ["Spend", money(ad.spendCents, currency)],
    ["Impressions", count(ad.impressions)],
    ["Outbound clicks", count(ad.outboundClicks)],
    ["Landing page views", count(ad.landingPageViews)],
    ["Outbound CTR (clicks ÷ impressions)", percent(ad.outboundCtr)],
    ["CPM", money(ad.cpmCents, currency)],
    ["Cost per outbound click", money(ad.costPerOutboundClickCents, currency)],
    ["Cost per landing page view", money(ad.costPerLandingPageViewCents, currency)],
    ["Verified trials on this ad", count(ad.trials)],
    ["Still trialing", count(ad.stillTrialing)],
    ["Matured, not paid", ad.maturedUnpaid == null ? "—" : String(ad.maturedUnpaid)],
    ["Paid monthly", ad.paidMonthly == null ? "—" : String(ad.paidMonthly)],
    ["Paid annual", ad.paidAnnual == null ? "—" : String(ad.paidAnnual)],
    ["Trials started after these dates", count(ad.trialsAfterWindow)],
    ["Cost per verified trial", money(ad.costPerTrialCents, currency)],
    ["Cost per paying subscriber", money(ad.costPerPaidCents, currency)],
  ];
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
      {ad.creative?.thumbnailUrl ? (
        // Meta thumbnail URLs expire. This is a preview, not an archive.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.creative.thumbnailUrl} alt="" className="h-28 w-40 rounded-lg object-cover" />
      ) : (
        <div className="flex h-28 w-40 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-500">
          No preview
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-stone-500">{label}</dt>
            <dd className="text-stone-900">{value}</dd>
          </div>
        ))}
        {ad.creative ? (
          <>
            <dt className="text-stone-500">Primary text</dt>
            <dd>{ad.creative.body ?? "—"}</dd>
            <dt className="text-stone-500">Headline</dt>
            <dd>{ad.creative.headline ?? "—"}</dd>
            <dt className="text-stone-500">Button</dt>
            <dd>{ad.creative.cta ?? "—"}</dd>
            <dt className="text-stone-500">Landing page</dt>
            <dd className="break-all">{ad.creative.link ?? "—"}</dd>
          </>
        ) : null}
      </dl>
      {ad.economicsNote ? <p className="mt-2 text-sm text-stone-600">{ad.economicsNote}</p> : null}
    </div>
  );
}

function NoteForm({ ad }: { ad: AdLabAdCard }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    const notes: AdLabNotes = {
      hook: String(formData.get("hook") ?? ""),
      angle: String(formData.get("angle") ?? ""),
      audience: String(formData.get("audience") ?? ""),
      emotion: String(formData.get("emotion") ?? ""),
      personFeatured: String(formData.get("personFeatured") ?? ""),
      offer: String(formData.get("offer") ?? ""),
      concept: String(formData.get("concept") ?? ""),
      hypothesis: String(formData.get("hypothesis") ?? ""),
      variableChanged: String(formData.get("variableChanged") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    };
    const response = await fetch("/api/admin/ad-lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "note", metaAdId: ad.metaAdId, notes }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    setPending(false);
    setMessage(body.ok ? "Saved." : body.error ?? "Could not save.");
    if (body.ok) router.refresh();
  }
  const fields: [keyof AdLabNotes, string][] = [
    ["hook", "Hook"],
    ["angle", "Angle"],
    ["audience", "Audience"],
    ["emotion", "Emotion"],
    ["personFeatured", "Person featured"],
    ["offer", "Offer"],
    ["concept", "Concept"],
    ["hypothesis", "Hypothesis"],
    ["variableChanged", "What changed"],
    ["notes", "Notes"],
  ];
  return (
    <form action={onSubmit} className="mt-3 grid gap-2 sm:grid-cols-2">
      <p className="sm:col-span-2 text-xs text-stone-500">
        Optional notes. These do not replace the Meta name, status, or delivery.
      </p>
      {fields.map(([key, label]) => (
        <label key={key} className="text-xs text-stone-600">
          {label}
          <input name={key} defaultValue={ad.notes[key]} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1 text-sm" />
        </label>
      ))}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save notes"}
        </button>
        {message ? <span className="ml-3 text-sm text-stone-600">{message}</span> : null}
      </div>
    </form>
  );
}

function Experiments({ lab }: { lab: AdLabLab }) {
  return (
    <div className="space-y-4">
      <ExperimentForm lab={lab} />
      {lab.experiments.length === 0 ? (
        <p className="text-sm text-stone-600">No experiments yet.</p>
      ) : (
        lab.experiments.map((experiment) => (
          <article key={experiment.id} className="rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-stone-900">{experiment.name}</h3>
              <span className="text-xs uppercase tracking-wide text-stone-500">{experiment.status}</span>
            </div>
            <p className="mt-1 text-sm text-stone-700">{experiment.evidence}. {experiment.comparisonNote}</p>
            {experiment.question ? <p className="mt-1 text-sm text-stone-600">Question: {experiment.question}</p> : null}
            <p className="mt-1 text-xs text-stone-500">
              Success: {METRIC_LABEL[experiment.successMetric] ?? experiment.successMetric}. Spend in the experiment dates{" "}
              {money(experiment.spendCents, lab.currency)}.
              {experiment.reviewOn ? ` Review ${experiment.reviewOn}.` : ""}
              {experiment.plannedDays ? ` Planned ${experiment.plannedDays} days.` : ""}
              {experiment.budgetCents != null ? ` Budget ${money(experiment.budgetCents, lab.currency)}.` : ""}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-stone-500">
                  <tr>
                    <th className="py-1 pr-3">Ad</th>
                    <th className="py-1 pr-3">Role</th>
                    <th className="py-1 pr-3">Spend</th>
                    <th className="py-1 pr-3">Clicks</th>
                    <th className="py-1 pr-3">Trials</th>
                    <th className="py-1 pr-3">Paid</th>
                    <th className="py-1">Cost / trial</th>
                  </tr>
                </thead>
                <tbody>
                  {experiment.ads.map((member) => (
                    <tr key={member.metaAdId} className="border-t border-stone-100">
                      <td className="py-1 pr-3">{member.card?.adName ?? member.adNameSnapshot}</td>
                      <td className="py-1 pr-3">{member.role}</td>
                      <td className="py-1 pr-3">{money(member.card?.spendCents ?? null, lab.currency)}</td>
                      <td className="py-1 pr-3">{count(member.card?.outboundClicks ?? null)}</td>
                      <td className="py-1 pr-3">{count(member.card?.trials ?? null)}</td>
                      <td className="py-1 pr-3">
                        {member.card?.paidMonthly == null
                          ? "—"
                          : `${member.card.paidMonthly + (member.card.paidAnnual ?? 0)}`}
                      </td>
                      <td className="py-1">{money(member.card?.costPerTrialCents ?? null, lab.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ExperimentForm lab={lab} existing={experiment} />
          </article>
        ))
      )}
    </div>
  );
}

function ExperimentForm({ lab, existing }: { lab: AdLabLab; existing?: AdLabExperimentView }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selected = useMemo(
    () => new Set(existing?.ads.map((ad) => ad.metaAdId) ?? []),
    [existing]
  );
  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    const ads = lab.ads
      .filter((ad) => formData.get(`ad-${ad.metaAdId}`) === "on")
      .map((ad) => ({
        metaAdId: ad.metaAdId,
        role: String(formData.get(`role-${ad.metaAdId}`) ?? "included"),
        adNameSnapshot: ad.adName,
        campaignNameSnapshot: ad.campaignName ?? "",
      }));
    const response = await fetch("/api/admin/ad-lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "experiment",
        id: existing?.id ?? "",
        name: formData.get("name"),
        question: formData.get("question"),
        hypothesis: formData.get("hypothesis"),
        successMetric: formData.get("successMetric"),
        status: formData.get("status"),
        startsOn: formData.get("startsOn"),
        reviewOn: formData.get("reviewOn"),
        plannedDays: formData.get("plannedDays"),
        budgetCents: dollarsToCents(formData.get("budget")),
        stopSpendCents: dollarsToCents(formData.get("stopSpend")),
        stopClicks: formData.get("stopClicks"),
        stopTrials: formData.get("stopTrials"),
        variableTested: formData.get("variableTested"),
        notes: formData.get("notes"),
        outcome: formData.get("outcome"),
        winnerMetaAdId: formData.get("winnerMetaAdId"),
        whatWorked: formData.get("whatWorked"),
        whatDidnt: formData.get("whatDidnt"),
        decision: formData.get("decision"),
        nextTest: formData.get("nextTest"),
        ads,
      }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    setPending(false);
    setMessage(body.ok ? "Saved." : body.error ?? "Could not save.");
    if (body.ok) router.refresh();
  }
  return (
    <details className="mt-3 rounded-lg bg-stone-50 p-3" open={!existing}>
      <summary className="cursor-pointer text-sm font-medium text-stone-800">
        {existing ? "Edit experiment and lesson" : "New experiment"}
      </summary>
      <form action={onSubmit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field name="name" label="Name" defaultValue={existing?.name ?? ""} required />
        <label className="text-xs text-stone-600">
          Status
          <select name="status" defaultValue={existing?.status ?? "draft"} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1 text-sm">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <Field name="question" label="Question" defaultValue={existing?.question ?? ""} />
        <Field name="hypothesis" label="Hypothesis" defaultValue={existing?.hypothesis ?? ""} />
        <label className="text-xs text-stone-600">
          Success means
          <select name="successMetric" defaultValue={existing?.successMetric ?? "verified_trials"} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1 text-sm">
            {Object.entries(METRIC_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <Field name="variableTested" label="One thing being tested" defaultValue={existing?.variableTested ?? ""} />
        <Field name="startsOn" label="Start date" type="date" defaultValue={existing?.startsOn ?? ""} />
        <Field name="reviewOn" label="Review date" type="date" defaultValue={existing?.reviewOn ?? ""} />
        <Field name="plannedDays" label="Planned days (optional)" defaultValue={existing?.plannedDays?.toString() ?? ""} />
        <Field name="budget" label="Budget in dollars (optional)" defaultValue={centsToDollars(existing?.budgetCents)} />
        <Field name="stopSpend" label="Stop after spend $" defaultValue={centsToDollars(existing?.stopSpendCents)} />
        <Field name="stopClicks" label="Stop after clicks" defaultValue={existing?.stopClicks?.toString() ?? ""} />
        <Field name="stopTrials" label="Stop after trials" defaultValue={existing?.stopTrials?.toString() ?? ""} />
        <div className="sm:col-span-2">
          <p className="text-xs text-stone-600">Ads in this experiment. Pick as many as you are comparing.</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {lab.ads.map((ad) => (
              <li key={ad.metaAdId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`ad-${ad.metaAdId}`} defaultChecked={selected.has(ad.metaAdId)} />
                <span className="flex-1">{ad.adName}</span>
                <select name={`role-${ad.metaAdId}`} defaultValue={existing?.ads.find((member) => member.metaAdId === ad.metaAdId)?.role ?? "included"} className="rounded-md border border-stone-300 px-1 py-0.5 text-xs">
                  <option value="included">Included</option>
                  <option value="control">Control</option>
                  <option value="challenger">Challenger</option>
                </select>
              </li>
            ))}
          </ul>
        </div>
        <Field name="outcome" label="Outcome" defaultValue={existing?.outcome ?? ""} />
        <Field name="winnerMetaAdId" label="Winning ad id, if you decided" defaultValue={existing?.winnerMetaAdId ?? ""} />
        <Field name="whatWorked" label="What worked" defaultValue={existing?.whatWorked ?? ""} />
        <Field name="whatDidnt" label="What did not" defaultValue={existing?.whatDidnt ?? ""} />
        <Field name="decision" label="What you decided" defaultValue={existing?.decision ?? ""} />
        <Field name="nextTest" label="What to test next" defaultValue={existing?.nextTest ?? ""} />
        <label className="sm:col-span-2 text-xs text-stone-600">
          Notes
          <textarea name="notes" defaultValue={existing?.notes ?? ""} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1 text-sm" rows={2} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={pending || !lab.storageReady} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {pending ? "Saving…" : existing ? "Save experiment" : "Create experiment"}
          </button>
          {message ? <span className="ml-3 text-sm text-stone-600">{message}</span> : null}
        </div>
      </form>
    </details>
  );
}

function Learning({ lab }: { lab: AdLabLab }) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");
  const needle = query.trim().toLowerCase();
  const lessons = lab.experiments.filter((experiment) => {
    const blob = [
      experiment.name,
      experiment.hypothesis,
      experiment.variableTested,
      experiment.outcome,
      experiment.whatWorked,
      experiment.whatDidnt,
      experiment.decision,
      experiment.nextTest,
      ...experiment.ads.flatMap((ad) => [
        ad.adNameSnapshot,
        ad.campaignNameSnapshot ?? "",
        ad.card?.notes.hook ?? "",
        ad.card?.notes.angle ?? "",
        ad.card?.notes.audience ?? "",
        ad.card?.notes.offer ?? "",
        ad.card?.notes.personFeatured ?? "",
        ad.card?.creative?.format ?? "",
      ]),
    ]
      .join(" ")
      .toLowerCase();
    if (needle && !blob.includes(needle)) return false;
    if (person && !blob.includes(person.toLowerCase())) return false;
    return experiment.status === "completed" || experiment.decision || experiment.whatWorked || experiment.outcome;
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search hook, offer, campaign, outcome" className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
        <input value={person} onChange={(event) => setPerson(event.target.value)} placeholder="Person featured" className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
      </div>
      {lessons.length === 0 ? (
        <p className="text-sm text-stone-600">Completed experiments and written lessons will show up here.</p>
      ) : (
        lessons.map((experiment) => (
          <article key={experiment.id} className="rounded-xl border border-stone-200 p-3 text-sm">
            <h3 className="font-semibold text-stone-900">{experiment.name}</h3>
            <p className="text-stone-500">
              {experiment.startsOn ?? "No start"}{experiment.reviewOn ? ` to ${experiment.reviewOn}` : ""} · {experiment.evidence}
            </p>
            <p className="mt-1">{experiment.whatWorked || "No written result yet."}</p>
            {experiment.whatDidnt ? <p className="mt-1 text-stone-600">Did not: {experiment.whatDidnt}</p> : null}
            {experiment.decision ? <p className="mt-1">Decided: {experiment.decision}</p> : null}
            {experiment.nextTest ? <p className="mt-1">Next: {experiment.nextTest}</p> : null}
            <p className="mt-1 text-xs text-stone-500">
              Ads kept by the names they had when saved: {experiment.ads.map((ad) => ad.adNameSnapshot).join(", ") || "none"}
            </p>
          </article>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-stone-600">
      {label}
      <input name={name} type={type} required={required} defaultValue={defaultValue} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1 text-sm" />
    </label>
  );
}

function money(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function count(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function freshness(lab: AdLabLab): string {
  if (!lab.lastImportedAt) return "No successful import yet";
  const when = new Date(lab.lastImportedAt).toLocaleString("en-US", { timeZone: lab.timezone });
  return lab.stale ? `Import is stale. Last success ${when}` : `Last import ${when}`;
}

function dollarsToCents(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return raw;
  const [whole, fraction = ""] = raw.split(".");
  return String(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}
