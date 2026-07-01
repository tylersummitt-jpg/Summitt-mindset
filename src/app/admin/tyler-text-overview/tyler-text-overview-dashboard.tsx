"use client";

import { useCallback, useEffect, useState } from "react";

import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";

type EditState = Record<string, string>;

function notebookLabel(role: string): string {
  return role.toUpperCase();
}

export default function TylerTextOverviewDashboard() {
  const [rows, setRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
  const [availableDayKeys, setAvailableDayKeys] = useState<string[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string>("");
  const [edits, setEdits] = useState<EditState>({});
  const [loading, setLoading] = useState(true);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  const load = useCallback(async (dayKey: string) => {
    setLoading(true);
    try {
      const qs = dayKey ? `?draft_for_day_key=${encodeURIComponent(dayKey)}` : "";
      const res = await fetch(`/api/admin/tyler-text-overview${qs}`);
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.error || "Could not load drafts.");
        setRows([]);
        setAvailableDayKeys([]);
        return;
      }

      const nextRows = (json.rows || []) as TylerTextOverviewAdminDraftRow[];
      setRows(nextRows);
      setAvailableDayKeys((json.availableDayKeys || []) as string[]);
      setEdits(
        Object.fromEntries(
          nextRows.map((row) => [row.draftId, row.currentBodyToSend ?? ""])
        )
      );
    } catch (err) {
      console.error("Failed to load Tyler Text Overview drafts", err);
      showToast("Could not load drafts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDayKey);
  }, [load, selectedDayKey]);

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
    setSavingDraftId(row.draftId);
    try {
      const res = await fetch(`/api/admin/tyler-text-overview/${encodeURIComponent(row.draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBodyToSend: edits[row.draftId] ?? "",
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.error || "Save failed.");
        return;
      }

      const updated = json.row as TylerTextOverviewAdminDraftRow;
      setRows((prev) => prev.map((r) => (r.draftId === updated.draftId ? updated : r)));
      setEdits((prev) => ({ ...prev, [updated.draftId]: updated.currentBodyToSend ?? "" }));
      showToast("Saved.");
    } catch (err) {
      console.error("Failed to save draft", err);
      showToast("Save failed.");
    } finally {
      setSavingDraftId(null);
    }
  }

  return (
    <div className="space-y-6">
      {toast ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {toast}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Draft day</span>
          <select
            className="mt-1 block rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            value={selectedDayKey}
            onChange={(e) => setSelectedDayKey(e.target.value)}
          >
            <option value="">All current days</option>
            {availableDayKeys.map((dayKey) => (
              <option key={dayKey} value={dayKey}>
                {dayKey}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading drafts…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No current drafts found.</p>
      ) : (
        <ul className="space-y-8">
          {rows.map((row) => (
            <li
              key={row.draftId}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-5"
            >
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Admin only
                </h2>
                <div>
                  <p className="text-xs font-medium text-gray-500">clerk_user_id</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 break-all">{row.clerkUserId}</p>
                </div>
                <div>
                  <label
                    className="text-xs font-medium text-gray-500"
                    htmlFor={`body-${row.draftId}`}
                  >
                    current_body_to_send
                  </label>
                  <textarea
                    id={`body-${row.draftId}`}
                    className="mt-1 w-full min-h-[96px] rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                    value={edits[row.draftId] ?? ""}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [row.draftId]: e.target.value }))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={savingDraftId === row.draftId}
                  onClick={() => saveDraft(row)}
                >
                  {savingDraftId === row.draftId ? "Saving…" : "Save"}
                </button>
              </section>

              <section className="space-y-3 border-t border-gray-100 pt-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  OpenAI writer notebook
                </h2>
                {row.writerOpenAiMessages.length === 0 ? (
                  <p className="text-sm text-gray-500">No writer notebook stored for this draft.</p>
                ) : (
                  <div className="space-y-3">
                    {row.writerOpenAiMessages.map((message, index) => (
                      <div key={`${row.draftId}-${index}`}>
                        <p className="text-xs font-semibold text-gray-600">
                          {notebookLabel(message.role)}
                        </p>
                        <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap">
                          {message.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
