import type { OperatorMessagingForensics } from "@/lib/operator-messaging-forensics";

function Subheading({ title, sourceLabel }: { title: string; sourceLabel: string }) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{sourceLabel}</p>
    </div>
  );
}

function QuietEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}

export function MessagingForensicsSection({ data }: { data: OperatorMessagingForensics }) {
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer select-none text-base font-semibold text-gray-900">
        Messaging &amp; delivery (read-only)
      </summary>
      <div className="mt-3 space-y-1 text-sm text-gray-800">
        <p className="text-xs text-gray-500">
          <strong className="text-gray-700">Not the same as the spine:</strong>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">v2_commitment_event.check_sent</code> is the
          accountability product log above. <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">sms_send_events</code>{" "}
          is the operational send / reservation ledger (Twilio attempts, day_key, status).
        </p>

        <Subheading
          title="1. Last outbound context"
          sourceLabel="sms_last_outbound_context — operational snapshot (one row per user, overwritten on qualifying sends)"
        />
        {data.last_outbound_context ? (
          <div className="mt-2 space-y-2 rounded border border-gray-100 bg-gray-50/80 p-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
              <span className="text-xs font-medium uppercase text-gray-500">sent_at</span>
              <span className="font-mono text-xs">{data.last_outbound_context.sent_at}</span>
            </div>
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
              <span className="text-xs font-medium uppercase text-gray-500">message_kind</span>
              <span>{data.last_outbound_context.message_kind}</span>
            </div>
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
              <span className="text-xs font-medium uppercase text-gray-500">time_of_day</span>
              <span>{data.last_outbound_context.time_of_day ?? "—"}</span>
            </div>
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
              <span className="text-xs font-medium uppercase text-gray-500">twilio_message_sid</span>
              <span className="break-all font-mono text-xs">{data.last_outbound_context.twilio_message_sid ?? "—"}</span>
            </div>
            {data.last_outbound_context.question_position != null ? (
              <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
                <span className="text-xs font-medium uppercase text-gray-500">question_position</span>
                <span>{data.last_outbound_context.question_position}</span>
              </div>
            ) : null}
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-start">
              <span className="text-xs font-medium uppercase text-gray-500">preview</span>
              <span className="text-gray-800">{data.last_outbound_context.body_preview}</span>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-gray-500">Full body</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 font-mono text-[11px]">
                {data.last_outbound_context.full_body || "—"}
              </pre>
            </details>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-gray-500">delivery_snapshot (JSON)</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px]">
                {data.last_outbound_context.delivery_snapshot_json}
              </pre>
            </details>
          </div>
        ) : (
          <QuietEmpty>No sms_last_outbound_context row.</QuietEmpty>
        )}

        <Subheading
          title="2. Outbound send log"
          sourceLabel="sms_send_events — operational send ledger (newest first, last 20)"
        />
        {data.sms_send_events.length === 0 ? (
          <QuietEmpty>No sms_send_events rows for this user.</QuietEmpty>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.sms_send_events.map((row, i) => (
              <li key={`send-${row.day_key ?? "x"}-${row.created_at ?? i}-${i}`} className="rounded border border-gray-100 p-2 text-xs">
                <div className="font-mono text-gray-600">
                  {row.created_at ?? "—"} {row.updated_at ? `· updated ${row.updated_at}` : ""}
                </div>
                <div>
                  <span className="text-gray-500">day_key</span>{" "}
                  <span className="font-mono">{row.day_key ?? "—"}</span> ·{" "}
                  <span className="text-gray-500">status</span> <strong>{row.status ?? "—"}</strong>
                </div>
                <div className="break-all font-mono text-gray-700">sid {row.message_sid ?? "—"}</div>
                <div className="mt-1 text-gray-800">{row.metadata_summary}</div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-gray-500">metadata (JSON)</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 font-mono text-[11px]">
                    {row.metadata_raw_json}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}

        <Subheading
          title="3. Inbound messages"
          sourceLabel="sms_inbound_messages — inbound capture from Twilio (newest first, last 20)"
        />
        {data.sms_inbound_messages.length === 0 ? (
          <QuietEmpty>No sms_inbound_messages rows.</QuietEmpty>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.sms_inbound_messages.map((row, i) => (
              <li key={`in-${row.message_sid}-${i}`} className="rounded border border-gray-100 p-2 text-xs">
                <div className="font-mono text-gray-600">{row.occurred_at ?? "—"}</div>
                <div className="break-all font-mono text-gray-700">{row.message_sid}</div>
                <div className="text-gray-500">from {row.phone_number ?? "—"}</div>
                <p className="mt-1 text-gray-800">{row.body_preview}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-gray-500">Full raw_body</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px]">
                    {row.raw_body || "—"}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}

        <Subheading
          title="4. Inbound coach jobs"
          sourceLabel="sms_inbound_coach_jobs — async processing / queue state (newest first, last 20)"
        />
        {data.sms_inbound_coach_jobs.length === 0 ? (
          <QuietEmpty>No sms_inbound_coach_jobs rows.</QuietEmpty>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.sms_inbound_coach_jobs.map((row, i) => (
              <li key={`job-${row.message_sid}-${i}`} className="rounded border border-gray-100 p-2 text-xs">
                <div className="text-gray-800">{row.summary}</div>
                <div className="mt-1 font-mono text-[11px] text-gray-600">
                  created {row.created_at} · updated {row.updated_at} · next_retry {row.next_retry_at}
                </div>
                <div>
                  sent_at {row.sent_at ?? "—"} · outbound_sid{" "}
                  <span className="break-all font-mono">{row.outbound_message_sid ?? "—"}</span>
                </div>
                <div className="mt-1 text-amber-900/90">last_error: {row.last_error_preview}</div>
                <div className="mt-1 text-gray-800">inbound: {row.raw_body_preview}</div>
                <div className="text-gray-800">reply: {row.reply_body_preview}</div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-gray-500">Full last_error / bodies</summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px]">
                    {JSON.stringify(
                      {
                        last_error: row.last_error_full,
                        raw_body: row.raw_body_full,
                        reply_body: row.reply_body_full,
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
