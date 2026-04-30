import Link from "next/link";
import {
  loadOperatorSmsQaDetail,
  loadOperatorSmsQaRecentUsers,
  type OperatorSmsQaLoaded,
} from "@/lib/operator-sms-qa-view";

async function resolveSearchParams(
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
): Promise<Record<string, string | string[] | undefined>> {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs text-gray-500">{subtitle}</p> : null}
      <div className="mt-3 space-y-2 text-sm text-gray-800">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(8rem,11rem)_1fr] sm:items-start">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="break-words text-sm text-gray-900">{value}</div>
    </div>
  );
}

function FlagPills({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-xs text-gray-400">None derived</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <li
          key={f}
          className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200"
        >
          {f}
        </li>
      ))}
    </ul>
  );
}

export default async function OperatorSmsQaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const sp = await resolveSearchParams(searchParams);
  const rawUser = sp.userId;
  const userId = typeof rawUser === "string" ? rawUser.trim() : Array.isArray(rawUser) ? rawUser[0]?.trim() ?? "" : "";
  const rawPhone = sp.phone;
  const phoneFilter =
    typeof rawPhone === "string" ? rawPhone.trim() : Array.isArray(rawPhone) ? rawPhone[0]?.trim() ?? "" : "";

  const recent = await loadOperatorSmsQaRecentUsers({
    phoneFilter: phoneFilter || null,
  });

  const detail = userId ? await loadOperatorSmsQaDetail(userId) : null;

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">SMS transcript QA</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only relationship review. Uses same operator allowlist as{" "}
          <Link href="/internal/coach-state" className="underline hover:text-gray-800">
            Coach state
          </Link>
          . No mutations.
        </p>
      </div>

      <Card title="Load user" subtitle="GET ?userId=&phone=">
        <form method="get" action="/internal/sms-qa" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Clerk user id</span>
            <input
              name="userId"
              type="text"
              defaultValue={userId}
              placeholder="user_…"
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm outline-none ring-gray-400 focus:ring-2"
              autoComplete="off"
            />
          </label>
          <label className="min-w-[10rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Phone filter (recent list)</span>
            <input
              name="phone"
              type="text"
              defaultValue={phoneFilter}
              placeholder="digits"
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm outline-none ring-gray-400 focus:ring-2"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
            Load
          </button>
        </form>
      </Card>

      <Card title="Recent SMS activity (sample)" subtitle="Union of recent inbound + send tails — max 40 ids">
        {recent.length === 0 ? (
          <p className="text-sm text-gray-600">No rows yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded border border-gray-100 text-sm">
            {recent.map((u) => (
              <li key={u.clerk_user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  href={`/internal/sms-qa?userId=${encodeURIComponent(u.clerk_user_id)}${phoneFilter ? `&phone=${encodeURIComponent(phoneFilter)}` : ""}`}
                  className="font-mono text-xs text-blue-700 underline hover:text-blue-900"
                >
                  {u.clerk_user_id}
                </Link>
                <span className="text-xs text-gray-500">{u.last_activity_at}</span>
                {u.phone_hint ? <span className="text-xs text-gray-600">{u.phone_hint}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!userId ? (
        <Card title="Empty state" subtitle="Enter Clerk user id">
          <p className="text-sm text-gray-600">Select a user above or pick one from recent activity.</p>
        </Card>
      ) : null}

      {userId && detail?.kind === "user_not_found" ? (
        <Card title="Nothing to show" subtitle={detail.target}>
          <p className="text-sm text-gray-600">No profile, commitment, or SMS rows found for this id.</p>
        </Card>
      ) : null}

      {userId && detail?.kind === "loaded" ? <SmsQaLoadedView data={detail} /> : null}
    </main>
  );
}

function SmsQaLoadedView({ data }: { data: OperatorSmsQaLoaded }) {
  const c = data.commitment;
  return (
    <>
      <Card title="Quality flags (derived)" subtitle="Heuristic — scan spine payloads + weekly metadata">
        <FlagPills flags={data.global_flags} />
      </Card>

      <Card title="Profile & commitment (summary)" subtitle="Identity anchor only when quotable/trusted">
        <Row label="preferred_name" value={data.profile.preferred_name ?? "—"} />
        <Row label="identity_anchor_text" value={data.profile.identity_anchor_text ?? "—"} />
        <Row label="identity_source" value={data.profile.identity_source ?? "—"} />
        <Row label="quotable anchor?" value={data.profile.identity_shown_as_quotable ? "yes" : "no"} />
        <Row
          label="people_summary"
          value={
            <span>
              {data.profile.people_summary ?? "—"}{" "}
              <span className="text-xs text-gray-500">({data.profile.relationship_context_note})</span>
            </span>
          }
        />
        <Row label="responsibility" value={data.profile.responsibility ?? "—"} />
        <Row label="commitment id" value={c ? <span className="font-mono text-xs">{c.id}</span> : "—"} />
        <Row label="title" value={c?.title ?? "—"} />
        <Row label="behavior_statement" value={c?.behavior_statement ?? "—"} />
        <Row label="effective_coaching_ask" value={data.effective_coaching_ask ?? "—"} />
        <Row label="accountability_phase" value={data.accountability_phase ?? "—"} />
        <Row label="pending_resolution_kind" value={data.pending_resolution_kind ?? "—"} />
        <Row label="blocker_capture" value={c?.blocker_capture_expires_at ? `pending until ${c.blocker_capture_expires_at}` : "—"} />
        <Row label="coaching_summary" value={data.coaching_summary ?? "—"} />
        <Row label="latest_blocker_preview" value={data.latest_blocker_preview ?? "—"} />
        <Row label="14d outcome hint" value={data.yes_no_partial_hint ?? "—"} />
      </Card>

      <Card title="Transcript timeline" subtitle="Inbound messages + sms_send_events (coach). Chronological.">
        {data.timeline.length === 0 ? (
          <p className="text-sm text-gray-600">No timeline rows.</p>
        ) : (
          <ul className="max-h-[480px] space-y-3 overflow-auto rounded border border-gray-100 p-2 text-sm">
            {data.timeline.map((row, i) => (
              <li key={`${row.at}-${i}`} className="border-b border-gray-50 pb-2 last:border-b-0">
                <div className="flex flex-wrap gap-x-2 text-xs text-gray-500">
                  <time className="font-mono">{row.at}</time>
                  <span
                    className={
                      row.role === "user"
                        ? "rounded bg-blue-100 px-1 text-blue-900"
                        : "rounded bg-green-100 px-1 text-green-900"
                    }
                  >
                    {row.role}
                  </span>
                  <span className="text-gray-600">{row.label}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-gray-900">{row.body}</pre>
                {row.ref ? <p className="mt-1 font-mono text-[10px] text-gray-400">{row.ref}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Weekly send events (sms_weekly_send_events)" subtitle="V2 weekly proof metadata when present">
        {data.weekly_send_events.length === 0 ? (
          <p className="text-sm text-gray-600">No rows.</p>
        ) : (
          <ul className="space-y-2">
            {data.weekly_send_events.map((w, i) => (
              <li key={`${w.week_key}-${i}`} className="rounded border border-gray-100 p-2 text-xs">
                <div className="flex flex-wrap gap-2 text-gray-600">
                  <span className="font-mono">{w.week_key}</span>
                  <span>{w.status}</span>
                  <span>{w.metadata_summary}</span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-gray-500">metadata</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 font-mono text-[10px]">{w.metadata_redacted_json}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Spine events (v2_commitment_event)" subtitle="Newest first; prompt-like keys redacted">
        {!c ? (
          <p className="text-sm text-gray-600">No active commitment — no spine for this user.</p>
        ) : data.spine.length === 0 ? (
          <p className="text-sm text-gray-600">No spine rows in window.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded border border-gray-100">
            {data.spine.map((e, i) => (
              <li key={`${e.occurred_at}-${e.event_type}-${i}`} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <time className="font-mono text-xs text-gray-500">{e.occurred_at}</time>
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs">{e.event_type}</span>
                </div>
                <div className="mt-1">
                  <FlagPills flags={e.flags} />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-gray-500">payload (redacted)</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-100 bg-white p-2 font-mono text-[11px] leading-snug">
                    {e.payload_redacted_json}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-xs text-gray-400">
        <Link href="/internal/coach-state" className="underline hover:text-gray-600">
          Coach state
        </Link>
        {" · "}
        <Link href="/dashboard" className="underline hover:text-gray-600">
          Dashboard
        </Link>
      </p>
    </>
  );
}
