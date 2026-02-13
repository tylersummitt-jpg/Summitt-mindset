"use client";

import { useEffect, useMemo, useState } from "react";

type Testimonial = {
  id: string;
  clerk_user_id: string;
  day_number: number;
  quote: string;
  display_name: string | null;
  approved: boolean;
  approved_at: string | null;
  tags: string[];
};

type EditState = {
  quote: string;
  display_name: string;
  tagsText: string; // comma-separated
};

function normalizeTagsFromText(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export default function TestimonialsDashboard() {
  const [pending, setPending] = useState<Testimonial[]>([]);
  const [approved, setApproved] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);

  // Local edits keyed by testimonial id
  const [edits, setEdits] = useState<Record<string, EditState>>({});

  // UI state
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  // --------------------------------------------------
  // Load
  // --------------------------------------------------
  async function load() {
    setLoading(true);

    try {
      const res = await fetch("/api/admin/testimonials/list");
      const json = await res.json();

      const p = (json.pending || []) as Testimonial[];
      const a = (json.approved || []) as Testimonial[];

      setPending(p);
      setApproved(a);

      // Initialize edit state only for new items
      setEdits((prev) => {
        const next = { ...prev };

        [...p, ...a].forEach((t) => {
          if (!next[t.id]) {
            next[t.id] = {
              quote: t.quote || "",
              display_name: t.display_name || "",
              tagsText: (t.tags || []).join(", "),
            };
          }
        });

        return next;
      });
    } catch (err) {
      console.error("Failed to load testimonials", err);
      showToast("Could not load testimonials.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // --------------------------------------------------
  // Actions
  // --------------------------------------------------
  async function approveTestimonial(id: string) {
    setActionId(id);

    try {
      await fetch("/api/admin/testimonials/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      showToast("Approved.");
      await load();
    } catch (err) {
      console.error("Approve failed", err);
      showToast("Approve failed.");
    } finally {
      setActionId(null);
    }
  }

  async function unapproveTestimonial(id: string) {
    setActionId(id);

    try {
      await fetch("/api/admin/testimonials/unapprove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      showToast("Unapproved.");
      await load();
    } catch (err) {
      console.error("Unapprove failed", err);
      showToast("Unapprove failed.");
    } finally {
      setActionId(null);
    }
  }

  async function saveEdits(id: string) {
    const e = edits[id];
    if (!e) return;

    setSavingId(id);

    try {
      await fetch("/api/admin/testimonials/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          quote: e.quote,
          displayName: e.display_name,
          tags: normalizeTagsFromText(e.tagsText),
        }),
      });

      showToast("Saved.");
      await load();
    } catch (err) {
      console.error("Save failed", err);
      showToast("Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------
  function setEdit(id: string, patch: Partial<EditState>) {
    setEdits((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { quote: "", display_name: "", tagsText: "" }),
        ...patch,
      },
    }));
  }

  const pendingCount = pending.length;
  const approvedCount = approved.length;

  const hasAny = useMemo(() => pendingCount + approvedCount > 0, [
    pendingCount,
    approvedCount,
  ]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading testimonials…</p>;
  }

  if (!hasAny) {
    return (
      <p className="text-sm text-gray-500">
        No testimonials yet. Once Day 7 and Day 30 run, they’ll show up here.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-black text-white text-sm px-4 py-2 rounded-full shadow">
            {toast}
          </div>
        </div>
      )}

      {/* ======================================================
          PENDING
         ====================================================== */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Pending Approval ({pendingCount})
        </h2>

        {pendingCount === 0 && (
          <p className="text-sm text-gray-500">
            No testimonials waiting right now.
          </p>
        )}

        {pending.map((t) => {
          const e = edits[t.id];

          return (
            <div
              key={t.id}
              className="border rounded-2xl bg-white shadow-sm p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500">
                  Quote (safe-trimmed)
                </label>

                <textarea
                  rows={3}
                  value={e?.quote ?? t.quote}
                  onChange={(ev) => setEdit(t.id, { quote: ev.target.value })}
                  className="w-full border rounded-md p-2 text-sm"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500">
                    Display Name (optional)
                  </label>

                  <input
                    value={e?.display_name ?? ""}
                    onChange={(ev) =>
                      setEdit(t.id, { display_name: ev.target.value })
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    placeholder="e.g. Sarah M."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500">
                    Tags (comma separated)
                  </label>

                  <input
                    value={e?.tagsText ?? ""}
                    onChange={(ev) =>
                      setEdit(t.id, { tagsText: ev.target.value })
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    placeholder="clarity, calm, momentum"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Day {t.day_number} • {t.clerk_user_id}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => approveTestimonial(t.id)}
                  disabled={actionId === t.id}
                  className="rounded-md bg-black text-white px-4 py-2 text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
                >
                  {actionId === t.id ? "Approving…" : "Approve ✅"}
                </button>

                <button
                  onClick={() => saveEdits(t.id)}
                  disabled={savingId === t.id}
                  className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  {savingId === t.id ? "Saving…" : "Save edits"}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* ======================================================
          APPROVED
         ====================================================== */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Approved ({approvedCount})
        </h2>

        {approvedCount === 0 && (
          <p className="text-sm text-gray-500">No approved testimonials yet.</p>
        )}

        {approved.map((t) => {
          const e = edits[t.id];

          return (
            <div
              key={t.id}
              className="border rounded-2xl bg-gray-50 p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500">
                  Quote
                </label>

                <textarea
                  rows={3}
                  value={e?.quote ?? t.quote}
                  onChange={(ev) => setEdit(t.id, { quote: ev.target.value })}
                  className="w-full border rounded-md p-2 text-sm bg-white"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500">
                    Display Name
                  </label>

                  <input
                    value={e?.display_name ?? ""}
                    onChange={(ev) =>
                      setEdit(t.id, { display_name: ev.target.value })
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    placeholder="e.g. Sarah M."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500">
                    Tags
                  </label>

                  <input
                    value={e?.tagsText ?? ""}
                    onChange={(ev) =>
                      setEdit(t.id, { tagsText: ev.target.value })
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    placeholder="clarity, calm, momentum"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Approved • Day {t.day_number}
                {t.approved_at ? ` • ${t.approved_at.slice(0, 10)}` : ""}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => unapproveTestimonial(t.id)}
                  disabled={actionId === t.id}
                  className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-white disabled:opacity-50"
                >
                  {actionId === t.id ? "Unapproving…" : "Unapprove"}
                </button>

                <button
                  onClick={() => saveEdits(t.id)}
                  disabled={savingId === t.id}
                  className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-white disabled:opacity-50"
                >
                  {savingId === t.id ? "Saving…" : "Save edits"}
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
