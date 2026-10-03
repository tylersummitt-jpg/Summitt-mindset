"use client";

import { useCallback, useEffect, useState } from "react";

type ThreadLine = {
  role: "user" | "coach";
  body: string;
  at: string;
  atLocal: string;
};

type Card = {
  messageSid: string;
  memberName: string;
  receivedAt: string;
  triggeringText: string;
  thread: ThreadLine[];
  latestInboundAt: string;
  textsAlreadyStopped: boolean;
  stopIncomplete: boolean;
  pauseStillActive: boolean;
  laterInbound: boolean;
};

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString();
}

export default function SmsOptOutReviewsDashboard({
  highlightMessageSid = "",
}: {
  highlightMessageSid?: string;
}) {
  const [rows, setRows] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySid, setBusySid] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await fetch("/api/admin/sms-opt-out-reviews", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPageError(json.error || "Could not load reviews.");
        setRows([]);
        return;
      }
      setRows((json.rows || []) as Card[]);
    } catch (err) {
      console.error("Failed to load SMS opt-out reviews", err);
      setPageError("Could not load reviews.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightMessageSid) return;
    const el = document.getElementById(`sms-opt-out-review-${highlightMessageSid}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightMessageSid, rows]);

  async function decide(row: Card, action: "stop_texts" | "keep_texts_on") {
    if (busySid) return;
    setBusySid(row.messageSid);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[row.messageSid];
      return next;
    });
    try {
      const res = await fetch(
        `/api/admin/sms-opt-out-reviews/${encodeURIComponent(row.messageSid)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            latest_inbound_at: row.latestInboundAt,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.card && typeof json.card === "object") {
          setRows((prev) =>
            prev.map((item) =>
              item.messageSid === row.messageSid ? { ...item, ...json.card } : item
            )
          );
        }
        setErrors((prev) => ({
          ...prev,
          [row.messageSid]: json.error || "That did not go through.",
        }));
        return;
      }
      await load();
    } catch (err) {
      console.error("SMS opt-out review action failed", err);
      setErrors((prev) => ({
        ...prev,
        [row.messageSid]: "That did not go through.",
      }));
    } finally {
      setBusySid(null);
    }
  }

  if (loading && rows.length === 0) {
    return <p className="text-sm text-gray-600">Loading reviews…</p>;
  }

  if (pageError) {
    return <p className="text-sm text-red-700">{pageError}</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-600">No SMS opt-out reviews waiting.</p>;
  }

  return (
    <div className="space-y-8">
      {rows.map((row) => {
        const busy = busySid === row.messageSid;
        const highlighted = highlightMessageSid === row.messageSid;
        return (
          <article
            key={row.messageSid}
            id={`sms-opt-out-review-${row.messageSid}`}
            className={`rounded border bg-white p-5 shadow-sm ${
              highlighted ? "border-gray-900" : "border-gray-200"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              SMS Opt-Out Review
            </p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900">{row.memberName}</h2>
            <p className="mt-1 text-sm text-gray-600">{formatReceived(row.receivedAt)}</p>

            <p className="mt-4 text-sm text-gray-800">They said:</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
              “{row.triggeringText || "(empty)"}”
            </p>

            <p className="mt-4 text-sm font-medium text-gray-900">
              Automatic Morning, Evening, and Weekly texts are currently being held.
            </p>

            {row.textsAlreadyStopped ? (
              <p className="mt-2 text-sm font-medium text-gray-900">Texts are already stopped.</p>
            ) : null}
            {row.stopIncomplete ? (
              <p className="mt-2 text-sm font-medium text-gray-900">
                Stopping texts did not finish. Press STOP TEXTS.
              </p>
            ) : null}
            {row.pauseStillActive ? (
              <p className="mt-2 text-sm text-gray-700">A pause is still in place.</p>
            ) : null}
            {row.laterInbound ? (
              <p className="mt-2 text-sm text-gray-700">
                There are messages after the original request.
              </p>
            ) : null}

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recent conversation
            </p>
            <ol className="mt-2 space-y-2">
              {row.thread.length === 0 ? (
                <li className="text-sm text-gray-500">No recent messages.</li>
              ) : (
                row.thread.map((line, i) => (
                  <li key={`${line.at}-${i}`} className="text-sm">
                    <span className="font-medium text-gray-800">
                      {line.role === "coach" ? "Coach" : row.memberName}:
                    </span>{" "}
                    <span className="whitespace-pre-wrap text-gray-700">{line.body}</span>
                    {line.atLocal ? (
                      <span className="ml-2 text-xs text-gray-500">{line.atLocal}</span>
                    ) : null}
                  </li>
                ))
              )}
            </ol>

            {errors[row.messageSid] ? (
              <p className="mt-3 text-sm text-red-700">{errors[row.messageSid]}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void decide(row, "stop_texts")}
              >
                STOP TEXTS
              </button>
              {row.textsAlreadyStopped || row.stopIncomplete ? null : (
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void decide(row, "keep_texts_on")}
                >
                  KEEP TEXTS ON
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
