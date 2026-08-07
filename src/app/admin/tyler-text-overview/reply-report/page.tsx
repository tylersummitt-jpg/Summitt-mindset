import Link from "next/link";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  buildTylerTextOverviewReplyReport,
  formatRepliesOverSent,
  formatReplyLatencyMs,
  formatReplyRate,
  parseTtoReplyReportRange,
  type TtoReplyReportRange,
  type TtoReplyReportResult,
  type TtoReplyReportSlotStats,
} from "@/lib/tyler-text-overview-reply-report";

export const dynamic = "force-dynamic";

function rangeHref(range: TtoReplyReportRange): string {
  return `/admin/tyler-text-overview/reply-report?range=${range}`;
}

function SlotBlock({ label, stats }: { label: string; stats: TtoReplyReportSlotStats }) {
  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">
        {formatRepliesOverSent(stats.repliedCount, stats.sentCount)}
      </p>
      <p className="mt-1 text-sm text-gray-700">
        Rate {formatReplyRate(stats.replyRate)} · median{" "}
        {formatReplyLatencyMs(stats.medianReplyLatencyMs)} · avg{" "}
        {formatReplyLatencyMs(stats.averageReplyLatencyMs)}
      </p>
    </div>
  );
}

function ReportBody({ report }: { report: TtoReplyReportResult }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Overall</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <SlotBlock label="Morning" stats={report.overall.morning} />
          <SlotBlock label="Evening" stats={report.overall.evening} />
        </div>
        <p className="text-xs text-gray-500">
          Rates are descriptive only. Small sample sizes can be noisy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Per member</h2>
        {report.members.length === 0 ? (
          <p className="text-sm text-gray-600">No Twilio-accepted Morning/Evening sends in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Morning</th>
                  <th className="px-3 py-2 font-semibold">Evening</th>
                </tr>
              </thead>
              <tbody>
                {report.members.map((m) => (
                  <tr key={m.clerkUserId} className="border-b border-gray-100 align-top">
                    <td className="px-3 py-3 font-medium text-gray-900">{m.displayName}</td>
                    <td className="px-3 py-3 text-gray-800">
                      <div>{formatRepliesOverSent(m.morning.repliedCount, m.morning.sentCount)}</div>
                      <div className="text-xs text-gray-600">
                        {formatReplyRate(m.morning.replyRate)} · median{" "}
                        {formatReplyLatencyMs(m.morning.medianReplyLatencyMs)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gray-800">
                      <div>{formatRepliesOverSent(m.evening.repliedCount, m.evening.sentCount)}</div>
                      <div className="text-xs text-gray-600">
                        {formatReplyRate(m.evening.replyRate)} · median{" "}
                        {formatReplyLatencyMs(m.evening.medianReplyLatencyMs)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Weekday (by outbound day_key)</h2>
        {report.weekdays.length === 0 ? (
          <p className="text-sm text-gray-600">No weekday data.</p>
        ) : (
          <ul className="space-y-2 text-sm text-gray-800">
            {report.weekdays.map((w) => (
              <li key={w.weekday} className="rounded border border-gray-200 bg-white px-3 py-2">
                <span className="font-medium">{w.weekday}</span>
                <span className="ml-3 text-gray-700">
                  Morning {w.morningReplied}/{w.morningSent}
                </span>
                <span className="ml-3 text-gray-700">
                  Evening {w.eveningReplied}/{w.eveningSent}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Attribution detail</h2>
        {report.details.length === 0 ? (
          <p className="text-sm text-gray-600">No detail rows.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b bg-gray-50 uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">Member</th>
                  <th className="px-2 py-2">Day</th>
                  <th className="px-2 py-2">Slot</th>
                  <th className="px-2 py-2">Sent</th>
                  <th className="px-2 py-2">Outbound</th>
                  <th className="px-2 py-2">Replied</th>
                  <th className="px-2 py-2">Reply</th>
                  <th className="px-2 py-2">Latency</th>
                </tr>
              </thead>
              <tbody>
                {report.details.map((d, idx) => (
                  <tr
                    key={`${d.clerkUserId}-${d.outboundSentAt}-${d.slot}-${idx}`}
                    className="border-b border-gray-100 align-top"
                  >
                    <td className="px-2 py-2 font-medium text-gray-900">{d.displayName}</td>
                    <td className="px-2 py-2 font-mono text-gray-700">{d.dayKey}</td>
                    <td className="px-2 py-2 text-gray-700">
                      {d.slot === "evening_checkin" ? "Evening" : "Morning"}
                    </td>
                    <td className="px-2 py-2 font-mono text-gray-700">{d.outboundSentAt}</td>
                    <td className="px-2 py-2 text-gray-800 max-w-[220px]">{d.outboundBodyPreview}</td>
                    <td className="px-2 py-2">{d.replied ? "yes" : "no"}</td>
                    <td className="px-2 py-2 text-gray-800 max-w-[220px]">
                      {d.replied ? (
                        <>
                          <div className="font-mono text-[11px] text-gray-500">{d.replyAt}</div>
                          <div>{d.replyBodyPreview}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">{formatReplyLatencyMs(d.replyLatencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default async function AdminTylerTextOverviewReplyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireTylerAdmin();
  const params = await searchParams;
  const range = parseTtoReplyReportRange(params.range);
  const report = await buildTylerTextOverviewReplyReport({ range });

  const ranges: TtoReplyReportRange[] = ["7", "30", "all"];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Morning vs Evening Reply Report</h1>
        <p className="mt-2 text-sm text-gray-600">
          Observe-only engagement reporting. Does not change sends, generation, or coaching.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/admin/tyler-text-overview/morning" className="underline text-gray-800">
            Morning TTO
          </Link>
          <Link href="/admin/tyler-text-overview/evening" className="underline text-gray-800">
            Evening TTO
          </Link>
          <Link href="/admin/tyler-text-overview/weekly" className="underline text-gray-800">
            Weekly TTO
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {ranges.map((r) => (
          <Link
            key={r}
            href={rangeHref(r)}
            className={`rounded border px-3 py-1.5 ${
              range === r
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 bg-white text-gray-800"
            }`}
          >
            {r === "all" ? "All time" : `Last ${r} days`}
          </Link>
        ))}
      </div>

      <ReportBody report={report} />
    </div>
  );
}
