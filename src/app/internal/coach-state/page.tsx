import Link from "next/link";
import { loadOperatorCoachStateView } from "@/lib/operator-coach-state-view";
import { CoachStateEventRow } from "./coach-state-event-row";
import { MessagingForensicsSection } from "./messaging-forensics-section";

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

async function resolveSearchParams(
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
): Promise<Record<string, string | string[] | undefined>> {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

export default async function OperatorCoachStatePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const sp = await resolveSearchParams(searchParams);
  const rawTarget = sp.target;
  const targetParam = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;
  const target = typeof targetParam === "string" ? targetParam.trim() : "";

  const view = await loadOperatorCoachStateView(target || null);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Coach state</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only lookup by Clerk user id. Canonical fields come from{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">user_profiles</code> and{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">v2_commitment</code>; coaching memory and
          event summaries are projections / history.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-gray-500">
          <Link href="/internal/refresh-reconcile" className="underline hover:text-gray-700">
            View refresh reconcile cases
          </Link>
          <Link href="/internal/sms-qa" className="underline hover:text-gray-700">
            SMS transcript QA
          </Link>
        </p>
      </div>

      <Card title="Lookup" subtitle="GET form — no mutations">
        <form method="get" action="/internal/coach-state" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Clerk user id</span>
            <input
              name="target"
              type="text"
              defaultValue={target}
              placeholder="user_…"
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm outline-none ring-gray-400 focus:ring-2"
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Load
          </button>
        </form>
      </Card>

      {view.kind === "needs_target" ? (
        <Card title="Empty state" subtitle="Enter a Clerk user id and submit">
          <p className="text-sm text-gray-600">No user selected. Paste a Clerk user id from the Clerk dashboard.</p>
        </Card>
      ) : null}

      {view.kind === "no_profile_or_commitment" ? (
        <div className="space-y-4">
          <Card title="Not found" subtitle="No user_profiles row and no active v2_commitment for this id">
            <Row label="Clerk user id" value={<span className="font-mono">{view.target_clerk_user_id}</span>} />
            <p className="text-sm text-gray-600">
              Double-check the id, or confirm the member completed V2 onboarding with an active commitment.
            </p>
          </Card>
          <MessagingForensicsSection data={view.messagingForensics} />
        </div>
      ) : null}

      {view.kind === "profile_no_active_commitment" ? (
        <div className="space-y-4">
          <Card title="Identity (source of truth: user_profiles)" subtitle="Canonical identity fields">
            <Row label="Anchor" value={view.identity.identity_anchor_text ?? "—"} />
            <Row label="Refresh due" value={view.identity.identity_refresh_due_at ?? "—"} />
            <Row label="Last confirmed" value={view.identity.identity_last_confirmed_at ?? "—"} />
            <Row label="Last referenced" value={view.identity.identity_last_referenced_at ?? "—"} />
          </Card>
          <Card title="V2 commitment" subtitle="Source of truth: v2_commitment">
            <p className="text-sm text-amber-800">
              No active V2 commitment for this user (<code className="font-mono">status = active</code>).
            </p>
          </Card>
          <MessagingForensicsSection data={view.messagingForensics} />
        </div>
      ) : null}

      {view.kind === "loaded" ? (
        <div className="space-y-4">
          {view.identity ? (
            <Card title="Identity" subtitle="Source of truth: user_profiles">
              <Row label="Anchor" value={view.identity.identity_anchor_text ?? "—"} />
              <Row label="Refresh due" value={view.identity.identity_refresh_due_at ?? "—"} />
              <Row label="Last confirmed" value={view.identity.identity_last_confirmed_at ?? "—"} />
              <Row label="Last referenced" value={view.identity.identity_last_referenced_at ?? "—"} />
            </Card>
          ) : (
            <Card title="Identity" subtitle="No user_profiles row for this Clerk id">
              <p className="text-sm text-gray-600">
                Identity anchor fields are authoritative on <code className="font-mono">user_profiles</code> only —
                this user has no profile row yet.
              </p>
            </Card>
          )}

          <Card title="Commitment core" subtitle="Source of truth: v2_commitment">
                <Row label="Commitment id" value={<span className="font-mono text-xs">{view.commitment.id}</span>} />
                <Row label="Title" value={view.commitment.title} />
                <Row label="Status" value={view.commitment.status} />
                <Row label="Behavior (base ask)" value={view.commitment.behavior_statement} />
                <Row label="Updated at" value={view.commitment.updated_at ?? "—"} />
                <Row
                  label="Blocker capture"
                  value={
                    view.commitment.blocker_capture_expires_at
                      ? `expires ${view.commitment.blocker_capture_expires_at} (after ${view.commitment.blocker_capture_after_event ?? "—"})`
                      : "—"
                  }
                />
              </Card>

              <Card
                title="Effective ask & contract"
                subtitle="Derived with getEffectiveCoachingAsk / overlay helpers — same logic as SMS"
              >
                <Row label="Effective coaching ask" value={view.contract.effective_coaching_ask} />
                <Row label="Overlay active" value={view.contract.overlay_active ? "yes" : "no"} />
                <Row label="Overlay expires" value={view.contract.overlay_expires_at ?? "—"} />
                <Row label="Overlay contract kind" value={view.contract.overlay_contract_kind ?? "—"} />
                <Row label="Pending proposal valid" value={view.contract.pending_proposal_valid ? "yes" : "no"} />
                <Row label="Pending proposal text" value={view.contract.pending_proposal_text ?? "—"} />
                <Row label="Pending proposal expires" value={view.contract.pending_proposal_expires_at ?? "—"} />
                <Row
                  label="Pending proposal contract kind (from spine)"
                  value={view.contract.pending_proposal_contract_kind ?? "—"}
                />
              </Card>

              <Card title="Refresh & guided resolution" subtitle="Source of truth: v2_commitment columns / JSON">
                <Row
                  label="refresh_session"
                  value={
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[11px]">
                      {JSON.stringify(view.commitment.refresh_session ?? null, null, 2)}
                    </pre>
                  }
                />
                <Row label="commitment_refresh_last_prompted_at" value={view.commitment.commitment_refresh_last_prompted_at ?? "—"} />
                <Row label="pending_resolution_kind" value={view.commitment.pending_resolution_kind ?? "—"} />
                <Row
                  label="pending_resolution_created_at"
                  value={view.commitment.pending_resolution_created_at ?? "—"}
                />
                <Row
                  label="pending_resolution_expires_at"
                  value={view.commitment.pending_resolution_expires_at ?? "—"}
                />
                <Row
                  label="pending_resolution_payload"
                  value={
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[11px]">
                      {JSON.stringify(view.commitment.pending_resolution_payload ?? null, null, 2)}
                    </pre>
                  }
                />
              </Card>

              <Card title="Phase & reactivation" subtitle="Source of truth: v2_commitment">
                <Row label="accountability_phase" value={view.commitment.accountability_phase} />
                <Row label="reactivation_entered_at" value={view.commitment.reactivation_entered_at ?? "—"} />
                <Row label="reactivation_last_sent_at" value={view.commitment.reactivation_last_sent_at ?? "—"} />
                <Row
                  label="reactivation_entry_reason_code"
                  value={view.commitment.reactivation_entry_reason_code ?? "—"}
                />
              </Card>

              <Card
                title="Coaching memory (projection)"
                subtitle="v2_commitment_coaching_memory + mirrors — may lag until next recompute; do not treat as gates"
              >
                {view.coaching_memory_projection ? (
                  <>
                    <Row label="coaching_state" value={view.coaching_memory_projection.coaching_state} />
                    <Row label="silence_tier_snapshot" value={view.coaching_memory_projection.silence_tier_snapshot} />
                    <Row
                      label="unanswered_checks_snapshot"
                      value={String(view.coaching_memory_projection.unanswered_checks_snapshot)}
                    />
                    <Row
                      label="days_since_last_user_outcome_snapshot"
                      value={String(view.coaching_memory_projection.days_since_last_user_outcome_snapshot)}
                    />
                    <Row label="cadence_level" value={view.coaching_memory_projection.cadence_level} />
                    <Row label="cadence_reason_code" value={view.coaching_memory_projection.cadence_reason_code} />
                    <Row label="next_move_type" value={view.coaching_memory_projection.next_move_type} />
                    <Row label="next_move_reason_code" value={view.coaching_memory_projection.next_move_reason_code} />
                    <Row
                      label="coaching_summary"
                      value={view.coaching_memory_projection.coaching_summary ?? "—"}
                    />
                    <Row
                      label="relationship_profile_version"
                      value={view.coaching_memory_projection.relationship_profile_version ?? "—"}
                    />
                    <Row
                      label="relationship_profile_updated_at"
                      value={view.coaching_memory_projection.relationship_profile_updated_at ?? "—"}
                    />
                    <Row
                      label="sms_relationship_profile (derived)"
                      value={
                        view.coaching_memory_projection.sms_relationship_profile ? (
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-amber-100 bg-amber-50/40 p-2 font-mono text-[11px]">
                            {JSON.stringify(view.coaching_memory_projection.sms_relationship_profile, null, 2)}
                          </pre>
                        ) : (
                          "— (empty or not yet recomputed / invalid JSON)"
                        )
                      }
                    />
                    <p className="text-xs text-amber-900/80">
                      <strong>Derived relationship layer only</strong> (rule-based counters → bands). Not canonical
                      commitment state; does not replace cadence, next_move, overlays, reactivation, or identity gates.
                    </p>
                    <p className="text-xs text-gray-500">
                      Memory row also stores streaks / blocker preview / overlay flags; mirrors refresh + pending on
                      the row for prompts. If a field disagrees with{" "}
                      <code className="font-mono">v2_commitment</code>, trust the commitment row.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-600">No coaching_memory row yet for this commitment.</p>
                )}
              </Card>

              <Card title="Learned send-time profile" subtitle="v2_user_send_time_profile (user-scoped)">
                {view.send_time_profile ? (
                  <>
                    <Row label="preferred_window" value={view.send_time_profile.preferred_window} />
                    <Row label="confidence" value={String(view.send_time_profile.confidence)} />
                    <Row
                      label="reply counts"
                      value={`morning ${view.send_time_profile.reply_count_morning}, midday ${view.send_time_profile.reply_count_midday}, afternoon ${view.send_time_profile.reply_count_afternoon}, evening ${view.send_time_profile.reply_count_evening}`}
                    />
                    <Row label="updated_at" value={view.send_time_profile.updated_at} />
                  </>
                ) : (
                  <p className="text-sm text-gray-600">No profile row.</p>
                )}
              </Card>

              <Card
                title="Recent spine events"
                subtitle="Append-only v2_commitment_event — newest first; summary is derived from payload keys"
              >
                {view.events.length === 0 ? (
                  <p className="text-sm text-gray-600">No events in window.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded border border-gray-100">
                    {view.events.map((e, i) => (
                      <CoachStateEventRow
                        key={`${e.occurred_at}-${e.event_type}-${i}`}
                        occurredAt={e.occurred_at}
                        eventType={e.event_type}
                        summary={e.summary}
                        rawPayloadJson={e.raw_payload_json}
                      />
                    ))}
                  </ul>
                )}
              </Card>

          <MessagingForensicsSection data={view.messagingForensics} />
        </div>
      ) : null}

      <p className="text-center text-xs text-gray-400">
        <Link href="/dashboard" className="underline hover:text-gray-600">
          Back to dashboard
        </Link>
      </p>
    </main>
  );
}
