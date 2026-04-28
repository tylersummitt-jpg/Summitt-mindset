"use client";

type Props = {
  occurredAt: string;
  eventType: string;
  summary: string;
  rawPayloadJson: string;
};

export function CoachStateEventRow({ occurredAt, eventType, summary, rawPayloadJson }: Props) {
  return (
    <li className="border-b border-gray-200 py-3 text-sm last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <time className="font-mono text-xs text-gray-500">{occurredAt}</time>
        <span className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-800">
          {eventType}
        </span>
      </div>
      <p className="mt-1 text-gray-800">{summary}</p>
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">
          Raw payload
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px] leading-snug text-gray-800">
          {rawPayloadJson}
        </pre>
      </details>
    </li>
  );
}
