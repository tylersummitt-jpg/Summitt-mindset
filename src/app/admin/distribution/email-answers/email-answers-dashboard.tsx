"use client";

import { useCallback, useEffect, useState } from "react";

type HistoryLine = {
  direction: string;
  body: string;
  occurredAt: string;
};

type Card = {
  id: string;
  campaignId: string | null;
  offerLabel: string | null;
  question: string;
  history: HistoryLine[];
  missingReason: string;
  status: string;
  createdAt: string;
  ageHours: number;
  notificationStatus: string;
  notificationError: string | null;
  sendError: string | null;
  approvedBody: string;
  hasReplyTarget: boolean;
  hasSender: boolean;
};

export default function EmailAnswersDashboard({ highlightRequestId = "" }: { highlightRequestId?: string }) {
  const [rows, setRows] = useState<Card[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await fetch("/api/admin/acquisition/email-answers", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPageError(json.error || "Could not load questions.");
        setRows([]);
        return;
      }
      const next = (json.rows || []) as Card[];
      setRows(next);
      setEdits((prev) => {
        const merged = { ...prev };
        for (const row of next) {
          if (merged[row.id] === undefined) merged[row.id] = row.approvedBody;
        }
        return merged;
      });
    } catch {
      setPageError("Could not load questions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightRequestId) return;
    document.getElementById(`email-answer-${highlightRequestId}`)?.scrollIntoView({ block: "start" });
  }, [highlightRequestId, rows]);

  async function save(id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/acquisition/email-answers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedBody: edits[id] ?? "" }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setFeedback((prev) => ({ ...prev, [id]: json.error || "Save failed." }));
      return false;
    }
    setFeedback((prev) => ({ ...prev, [id]: "Saved. This answer is not a general policy." }));
    return true;
  }

  async function send(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const saved = await save(id);
      if (!saved) return;
      const res = await fetch(`/api/admin/acquisition/email-answers/${encodeURIComponent(id)}/send`, { method: "POST" });
      const json = await res.json();
      setFeedback((prev) => ({
        ...prev,
        [id]: res.ok && json.ok ? "Sent on the original thread." : (json.error || "Send did not complete."),
      }));
      if (res.ok && json.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-gray-600">Loading questions.</p>;
  if (pageError) return <p className="text-sm text-gray-800">{pageError}</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-600">No email questions are waiting.</p>;

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <article id={`email-answer-${row.id}`} key={row.id} className="space-y-3 rounded border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-700">
            {row.ageHours}h · {row.status}
            {row.sendError ? ` · ${row.sendError}` : ""}
            {" · notice "}
            {row.notificationStatus}
            {row.notificationError ? ` · ${row.notificationError}` : ""}
          </p>
          {row.status === "uncertain" ? (
            <p className="text-sm text-gray-800">
              This send was not confirmed. It stays here for investigation and will not be posted again automatically.
            </p>
          ) : null}
          <p className="text-sm text-gray-800">Campaign: {row.campaignId || "Not stored"}</p>
          <p className="text-sm text-gray-800">
            Promised offer: {row.offerLabel || "No proven offer on this campaign."}
          </p>
          <p className="text-sm text-gray-800">Missing information: {row.missingReason}</p>
          <p className="whitespace-pre-wrap text-sm text-gray-900">{row.question}</p>
          {row.history.length > 0 ? (
            <ul className="space-y-2 border-t border-gray-100 pt-3">
              {row.history.map((line, index) => (
                <li key={`${row.id}-${index}`} className="text-sm text-gray-700">
                  <span className="font-medium">{line.direction}.</span> {line.body}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-gray-600">
            {row.hasReplyTarget && row.hasSender
              ? "The original thread and mailbox are stored on this message."
              : "This message is missing its original thread or mailbox, so it cannot be sent."}
          </p>
          <textarea
            value={edits[row.id] ?? ""}
            onChange={(event) => setEdits((prev) => ({ ...prev, [row.id]: event.target.value }))}
            rows={6}
            disabled={row.status !== "open" || busyId === row.id}
            className="w-full rounded border border-gray-300 p-2 text-sm text-gray-900"
          />
          <p className="text-sm text-gray-600">This answer stays on this thread. It is not saved as a general policy.</p>
          {row.status === "open" ? (
            <button
              type="button"
              onClick={() => void send(row.id)}
              disabled={busyId === row.id}
              className="rounded bg-gray-900 px-3 py-2 text-sm text-white"
            >
              Send this answer
            </button>
          ) : null}
          {feedback[row.id] ? <p className="text-sm text-gray-800">{feedback[row.id]}</p> : null}
        </article>
      ))}
    </div>
  );
}
