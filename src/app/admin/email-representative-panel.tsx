import type { EmailRepresentativeReport } from "@/lib/acquisition/email-representative-metrics";

function show(value: number | null): string {
  return value == null ? "Not available" : String(value);
}

export function EmailRepresentativePanel({ report }: { report: EmailRepresentativeReport }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Email representative</h2>
      <p className="text-sm text-gray-700">
        These are stored counts. A reply is not counted as the cause of a trial or a payment.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Interpreted replies: {show(report.interpretedReplies)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Stored AI drafts: {show(report.aiDrafts)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Questions held for Tyler: {show(report.needsHuman)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Recorded outbound replies: {show(report.outboundReplies)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Manual answers still open: {show(report.manualOpen)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Manual answers sent: {show(report.manualSent)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
          Average time to send a manual answer: {report.averageHumanHours == null ? "No completed manual answers" : `${report.averageHumanHours} hours`}
        </p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
          Stored drafts among drafts plus held questions: {report.resolvedWithoutTylerPercent == null ? "Not available" : `${report.resolvedWithoutTylerPercent}%`}
        </p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
          Approved knowledge: {report.knowledgeInstalled ? show(report.activeKnowledge) : "Not installed"}
          {report.knowledgeInstalled ? ` active, ${show(report.retiredKnowledge)} retired` : ""}
        </p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Recorded trial_started events: {show(report.recordedTrialStarts)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Recorded paid_member events: {show(report.recordedPaidMembers)}</p>
        <p className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">Leadership Kit acceptance: not counted</p>
      </div>
      {report.repeatedTopics.length > 0 ? (
        <ul className="space-y-1 text-sm text-gray-800">
          {report.repeatedTopics.map((topic) => (
            <li key={topic.topic}>{topic.topic}: {topic.count} active entries</li>
          ))}
        </ul>
      ) : null}
      <ul className="space-y-1 text-sm text-gray-600">
        {report.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  );
}
