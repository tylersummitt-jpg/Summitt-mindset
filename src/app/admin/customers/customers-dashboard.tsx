"use client";

import { useCallback, useEffect, useState } from "react";

type CustomerRow = {
  clerkUserId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  subscriptionLabel: string;
  textStatus: string;
  textStatusLabel: string;
  lastSmsReplyAt: string | null;
  tylerNotes: string;
  sentQuotesBook: boolean;
  sentQuotesBookAt: string | null;
  otherItemsSent: string | null;
};

type EditState = {
  tylerNotes: string;
  sentQuotesBook: boolean;
  otherItemsSent: string;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 12)}…`;
}

export default function CustomersDashboard() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers?page=${pageNum}&limit=50`);
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.error || "Could not load customers.");
        setRows([]);
        setHasMore(false);
        return;
      }

      setRows((json.rows || []) as CustomerRow[]);
      setHasMore(Boolean(json.hasMore));
      setPage(json.page || pageNum);
    } catch (err) {
      console.error("Failed to load customers", err);
      showToast("Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [load, page]);

  function openEdit(row: CustomerRow) {
    setEditingId(row.clerkUserId);
    setEdits({
      tylerNotes: row.tylerNotes,
      sentQuotesBook: row.sentQuotesBook,
      otherItemsSent: row.otherItemsSent ?? "",
    });
  }

  function closeEdit() {
    setEditingId(null);
    setEdits(null);
  }

  async function saveEdit() {
    if (!editingId || !edits) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${encodeURIComponent(editingId)}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tylerNotes: edits.tylerNotes,
          sentQuotesBook: edits.sentQuotesBook,
          otherItemsSent: edits.otherItemsSent.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        showToast(json.error || "Save failed.");
        return;
      }

      showToast("Saved.");
      closeEdit();
      await load(page);
    } catch (err) {
      console.error("Save failed", err);
      showToast("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">Page {page}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={loading || !hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading subscribed customers…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No subscribed customers on this page.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Email
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Phone
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Subscription
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Text
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Last SMS reply
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Quotes book
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Other items
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Notes
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.clerkUserId} className="align-top">
                  <td className="px-3 py-2 text-gray-900">
                    {row.name || "—"}
                    <div className="text-xs text-gray-400">{shortId(row.clerkUserId)}</div>
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-gray-700">
                    {row.email || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {row.phone || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {row.subscriptionLabel}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {row.textStatusLabel}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {formatTimestamp(row.lastSmsReplyAt)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.sentQuotesBook ? "Yes" : "No"}
                    {row.sentQuotesBookAt ? (
                      <div className="text-xs text-gray-400">
                        {formatTimestamp(row.sentQuotesBookAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[8rem] truncate px-3 py-2 text-gray-700">
                    {row.otherItemsSent || "—"}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-gray-700">
                    {row.tylerNotes || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingId && edits ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Admin notes</h2>
            <p className="mt-1 text-xs text-gray-500">{shortId(editingId)}</p>

            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold text-gray-500">Tyler notes</span>
                <textarea
                  value={edits.tylerNotes}
                  onChange={(e) =>
                    setEdits((prev) =>
                      prev ? { ...prev, tylerNotes: e.target.value } : prev
                    )
                  }
                  rows={5}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edits.sentQuotesBook}
                  onChange={(e) =>
                    setEdits((prev) =>
                      prev ? { ...prev, sentQuotesBook: e.target.checked } : prev
                    )
                  }
                />
                <span className="text-sm text-gray-800">Sent quotes book</span>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-500">Other items sent</span>
                <input
                  type="text"
                  value={edits.otherItemsSent}
                  onChange={(e) =>
                    setEdits((prev) =>
                      prev ? { ...prev, otherItemsSent: e.target.value } : prev
                    )
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Shirt, card, etc."
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
