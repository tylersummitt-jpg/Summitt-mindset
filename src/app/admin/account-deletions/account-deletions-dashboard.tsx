import Link from "next/link";
import type { ReactNode } from "react";

import type {
  AccountDeletionAdminSummary,
  AccountDeletionAdminViewRow,
} from "@/lib/account-deletion/admin-observability";
import type { AccountDeletionStatus } from "@/lib/account-deletion/types";
import { ACCOUNT_DELETION_STATUSES } from "@/lib/account-deletion/types";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "muted";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-gray-100 text-gray-800",
    ok: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-900",
    danger: "bg-red-50 text-red-800",
    muted: "bg-slate-50 text-slate-600",
  };
  return (
    <span
      className={`inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function leaseTone(
  state: AccountDeletionAdminViewRow["leaseState"]
): "neutral" | "ok" | "warn" | "danger" | "muted" {
  if (state === "active") return "warn";
  if (state === "expired") return "muted";
  if (state === "malformed") return "danger";
  return "ok";
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

const FILTERS: Array<"all" | AccountDeletionStatus> = [
  "all",
  ...ACCOUNT_DELETION_STATUSES,
];

export default function AccountDeletionsDashboard({
  rows,
  summary,
  appliedStatus,
  appliedLimit,
}: {
  rows: AccountDeletionAdminViewRow[];
  summary: AccountDeletionAdminSummary;
  appliedStatus: AccountDeletionStatus | "all";
  appliedLimit: number;
}) {
  return (
    <div className="space-y-6">
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        role="status"
      >
        Read-only. No request can be created, retried, unlocked, or processed
        from this page.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryCard label="Visible" value={summary.totalVisible} />
        <SummaryCard label="In progress" value={summary.inProgress} />
        <SummaryCard label="Retryable" value={summary.failedRetryable} />
        <SummaryCard label="Terminal" value={summary.failedTerminal} />
        <SummaryCard label="Completed" value={summary.completed} />
        <SummaryCard
          label="Inconsistent"
          value={summary.structurallyInconsistent}
        />
        <SummaryCard
          label="Discoverable"
          value={summary.currentlyDiscoverable}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {FILTERS.map((status) => {
          const href =
            status === "all"
              ? `/admin/account-deletions?limit=${appliedLimit}`
              : `/admin/account-deletions?status=${status}&limit=${appliedLimit}`;
          const active = appliedStatus === status;
          return (
            <Link
              key={status}
              href={href}
              className={
                active
                  ? "rounded-full bg-gray-900 px-3 py-1 text-white"
                  : "rounded-full border border-gray-200 bg-white px-3 py-1 text-gray-700 hover:border-gray-400"
              }
            >
              {status}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-600">
          No account deletion requests are currently recorded.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Current step</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Lease</th>
                <th className="px-3 py-2">Discoverable</th>
                <th className="px-3 py-2">Stage states</th>
                <th className="px-3 py-2">Error code</th>
                <th className="px-3 py-2">Consistency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.requestId} className="align-top">
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-gray-900">
                      {row.requestId.slice(0, 8)}…
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-gray-500">
                      {row.maskedClerkUserId}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone="muted">{row.currentStep}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-700">
                    {formatTimestamp(row.updatedAt)}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-800">
                    {row.attemptCount}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={leaseTone(row.leaseState)}>
                      {row.leaseState}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={row.currentlyDiscoverable ? "ok" : "muted"}>
                      {row.currentlyDiscoverable ? "yes" : "no"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge tone="muted">sms:{row.smsState}</Badge>
                      <Badge tone="muted">stripe:{row.stripeState}</Badge>
                      <Badge tone="muted">purge:{row.purgeState}</Badge>
                      <Badge tone="muted">clerk:{row.clerkState}</Badge>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-gray-700">
                    {row.lastErrorCode ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {row.structurallyConsistent ? (
                      <Badge tone="ok">ok</Badge>
                    ) : (
                      <Badge tone="danger">{row.inconsistencyCode}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
