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
  clerkUserId: string;
  preferredName: string | null;
  receivedAt: string;
  question: string;
  replyBody: string;
  thread: ThreadLine[];
};

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString();
}

export default function ManualPatAnswersDashboard({
  highlightMessageSid = "",
}: {
  highlightMessageSid?: string;
}) {
  const [rows, setRows] = useState<Card[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingSid, setSavingSid] = useState<string | null>(null);
  const [sendingSid, setSendingSid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await fetch("/api/admin/manual-pat-answers", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPageError(json.error || "Could not load questions.");
        setRows([]);
        return;
      }
      const next = (json.rows || []) as Card[];
      setRows(next);
      setEdits((prev) => {
        const merged: Record<string, string> = { ...prev };
        for (const row of next) {
          if (merged[row.messageSid] === undefined) {
            merged[row.messageSid] = row.replyBody ?? "";
          }
        }
        return merged;
      });
    } catch (err) {
      console.error("Failed to load manual Pat answers", err);
      setPageError("Could not load questions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightMessageSid) return;
    const el = document.getElementById(`manual-pat-${highlightMessageSid}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightMessageSid, rows]);

  async function save(row: Card) {
    const sid = row.messageSid;
    if (savingSid || sendingSid) return;
    setSavingSid(sid);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/manual-pat-answers/${encodeURIComponent(sid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_body: edits[sid] ?? "" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrors((prev) => ({ ...prev, [sid]: json.error || "Save failed." }));
        return;
      }
      const persisted = typeof json.replyBody === "string" ? json.replyBody : edits[sid] ?? "";
      setEdits((prev) => ({ ...prev, [sid]: persisted }));
      setRows((prev) =>
        prev.map((r) => (r.messageSid === sid ? { ...r, replyBody: persisted } : r))
      );
      setFeedback((prev) => ({ ...prev, [sid]: "Saved." }));
    } catch (err) {
      console.error("Save failed", err);
      setErrors((prev) => ({ ...prev, [sid]: "Save failed." }));
    } finally {
      setSavingSid(null);
    }
  }

  async function send(row: Card) {
    const sid = row.messageSid;
    if (savingSid || sendingSid) return;
    const body = (edits[sid] ?? "").trim();
    if (!body) {
      setErrors((prev) => ({ ...prev, [sid]: "Answer is empty." }));
      return;
    }
    setSendingSid(sid);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    try {
      const saveRes = await fetch(`/api/admin/manual-pat-answers/${encodeURIComponent(sid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_body: edits[sid] ?? "" }),
      });
      const saveJson = await saveRes.json();
      if (!saveRes.ok || !saveJson.ok) {
        setErrors((prev) => ({
          ...prev,
          [sid]: saveJson.error || "Save before send failed.",
        }));
        return;
      }

      const res = await fetch(
        `/api/admin/manual-pat-answers/${encodeURIComponent(sid)}/send`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrors((prev) => ({ ...prev, [sid]: json.error || "Send failed." }));
        return;
      }
      setFeedback((prev) => ({ ...prev, [sid]: "Sent." }));
      setRows((prev) => prev.filter((r) => r.messageSid !== sid));
    } catch (err) {
      console.error("Send failed", err);
      setErrors((prev) => ({ ...prev, [sid]: "Send failed." }));
    } finally {
      setSendingSid(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading questions…</p>;
  }

  if (pageError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-800">{pageError}</p>
        <button
          type="button"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-600">No questions waiting.</p>;
  }

  return (
    <div className="space-y-8">
      {rows.map((row) => {
        const sid = row.messageSid;
        const isSaving = savingSid === sid;
        const isSending = sendingSid === sid;
        const busy = Boolean(savingSid || sendingSid);
        const draft = edits[sid] ?? "";
        const highlighted = highlightMessageSid === sid;
        return (
          <article
            key={sid}
            id={`manual-pat-${sid}`}
            className={`rounded border bg-white p-5 shadow-sm ${
              highlighted ? "border-gray-900" : "border-gray-200"
            }`}
          >
            <h2 className="text-lg font-semibold text-gray-900">
              {row.preferredName?.trim() || "Unnamed member"}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Received: {formatReceived(row.receivedAt)}
            </p>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Question
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
              {row.question || "(empty)"}
            </p>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-700">
                Recent conversation ({row.thread.length})
              </summary>
              <ol className="mt-2 space-y-2">
                {row.thread.length === 0 ? (
                  <li className="text-xs text-gray-500">No recent messages.</li>
                ) : (
                  row.thread.map((line, i) => (
                    <li key={`${line.at}-${i}`} className="text-sm">
                      <span className="font-medium text-gray-800">
                        {line.role === "coach" ? "Coach" : "User"}:
                      </span>{" "}
                      <span className="whitespace-pre-wrap text-gray-700">{line.body}</span>
                    </li>
                  ))
                )}
              </ol>
            </details>

            <label className="mt-4 block text-sm font-medium text-gray-900">
              Your Coach Pat reply
              <textarea
                className="mt-1 min-h-[120px] w-full rounded border border-gray-300 p-2 text-sm"
                value={draft}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  setEdits((prev) => ({ ...prev, [sid]: value }));
                  setFeedback((prev) => {
                    const next = { ...prev };
                    delete next[sid];
                    return next;
                  });
                }}
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void save(row)}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                disabled={busy || !draft.trim()}
                onClick={() => void send(row)}
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>

            {feedback[sid] ? (
              <p className="mt-2 text-sm text-green-800">{feedback[sid]}</p>
            ) : null}
            {errors[sid] ? (
              <p className="mt-2 text-sm text-red-800">{errors[sid]}</p>
            ) : null}
            <p className="mt-3 font-mono text-[11px] text-gray-400">{sid}</p>
          </article>
        );
      })}
    </div>
  );
}
