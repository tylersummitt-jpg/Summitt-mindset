"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { LEADERSHIP_KIT_STATEMENT, LEADERSHIP_KIT_TOPIC } from "@/lib/acquisition/email-knowledge";

type KnowledgeCard = {
  id: string;
  topic: string;
  statement: string;
  category: string;
  scope: string;
  campaignId: string | null;
  offerKey: string | null;
  status: string;
  approvedAt: string;
  sourceRequestId: string | null;
  supersedesId: string | null;
  retiredAt: string | null;
};

const CATEGORIES = ["membership", "offer", "pat_biography", "tyler_biography", "product", "approved_answer"] as const;

const emptyForm = {
  topic: "",
  statement: "",
  category: "product",
  scope: "general",
  campaignId: "",
  offerKey: "",
  explicitApproval: false,
};

export default function EmailKnowledgeDashboard() {
  const [rows, setRows] = useState<KnowledgeCard[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/acquisition/email-knowledge", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage(json.error || "Could not load knowledge.");
        setRows([]);
        return;
      }
      setRows(json.rows || []);
      setMessage(null);
    } catch {
      setMessage("Could not load knowledge.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createEntry(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/admin/acquisition/email-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setMessage(res.ok && json.ok ? "Approved. It will be used only where its scope matches." : (json.error || "Not saved."));
    if (res.ok && json.ok) {
      setForm(emptyForm);
      await load();
    }
  }

  async function retire(id: string) {
    const res = await fetch(`/api/admin/acquisition/email-knowledge/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire" }),
    });
    const json = await res.json();
    setMessage(res.ok && json.ok ? "Retired. It will no longer be used." : (json.error || "Not retired."));
    if (res.ok && json.ok) await load();
  }

  async function replace(row: KnowledgeCard, statement: string) {
    const res = await fetch(`/api/admin/acquisition/email-knowledge/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "replace",
        topic: row.topic,
        statement,
        category: row.category,
        scope: row.scope,
        campaignId: row.campaignId,
        offerKey: row.offerKey,
        explicitApproval: true,
      }),
    });
    const json = await res.json();
    setMessage(res.ok && json.ok ? "The previous wording was retired and the new wording is active." : (json.error || "Not replaced."));
    if (res.ok && json.ok) await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={(event) => void createEntry(event)} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Approve a fact</h2>
        <button
          type="button"
          className="text-sm text-gray-800 underline"
          onClick={() => setForm({
            topic: LEADERSHIP_KIT_TOPIC,
            statement: LEADERSHIP_KIT_STATEMENT,
            category: "offer",
            scope: "campaign",
            campaignId: "",
            offerKey: "",
            explicitApproval: false,
          })}
        >
          Start from the Leadership Kit description
        </button>
        <p className="text-sm text-gray-600">
          The Kit description does not include shipping or eligibility. Approve it for one campaign or one offer. It is not saved until you confirm below.
        </p>
        <label className="block text-sm text-gray-800">
          Topic
          <input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} className="mt-1 w-full rounded border border-gray-300 p-2" />
        </label>
        <label className="block text-sm text-gray-800">
          Category
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 w-full rounded border border-gray-300 p-2">
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="block text-sm text-gray-800">
          Applies to
          <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} className="mt-1 w-full rounded border border-gray-300 p-2">
            <option value="general">Everyone</option>
            <option value="campaign">One campaign</option>
            <option value="offer">One offer</option>
          </select>
        </label>
        {form.scope === "campaign" ? (
          <label className="block text-sm text-gray-800">
            Campaign id
            <input value={form.campaignId} onChange={(event) => setForm({ ...form, campaignId: event.target.value })} className="mt-1 w-full rounded border border-gray-300 p-2" />
          </label>
        ) : null}
        {form.scope === "offer" ? (
          <label className="block text-sm text-gray-800">
            Offer key
            <input value={form.offerKey} onChange={(event) => setForm({ ...form, offerKey: event.target.value })} className="mt-1 w-full rounded border border-gray-300 p-2" />
          </label>
        ) : null}
        <label className="block text-sm text-gray-800">
          Approved statement
          <textarea value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} rows={8} className="mt-1 w-full rounded border border-gray-300 p-2" />
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={form.explicitApproval} onChange={(event) => setForm({ ...form, explicitApproval: event.target.checked })} />
          I approve this statement as reusable knowledge. This does not change a live campaign.
        </label>
        <button type="submit" className="rounded bg-gray-900 px-3 py-2 text-sm text-white">Approve knowledge</button>
      </form>
      {message ? <p className="text-sm text-gray-800">{message}</p> : null}
      {loading ? <p className="text-sm text-gray-600">Loading knowledge.</p> : null}
      <div className="space-y-4">
        {rows.map((row) => (
          <KnowledgeRow key={row.id} row={row} onRetire={retire} onReplace={replace} />
        ))}
      </div>
    </div>
  );
}

function KnowledgeRow({
  row,
  onRetire,
  onReplace,
}: {
  row: KnowledgeCard;
  onRetire: (id: string) => Promise<void>;
  onReplace: (row: KnowledgeCard, statement: string) => Promise<void>;
}) {
  const [statement, setStatement] = useState(row.statement);
  return (
    <article className="space-y-2 rounded border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-700">
        {row.status} · {row.category} · {row.scope}
        {row.campaignId ? ` · campaign ${row.campaignId}` : ""}
        {row.offerKey ? ` · offer ${row.offerKey}` : ""}
      </p>
      <p className="text-sm font-medium text-gray-900">{row.topic}</p>
      <p className="text-sm text-gray-600">
        Approved {row.approvedAt}
        {row.sourceRequestId ? ` · from manual answer ${row.sourceRequestId}` : " · no manual-answer source"}
        {row.supersedesId ? ` · replaces ${row.supersedesId}` : ""}
      </p>
      <textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={6} disabled={row.status !== "active"} className="w-full rounded border border-gray-300 p-2 text-sm" />
      {row.status === "active" ? (
        <div className="flex gap-3">
          <button type="button" onClick={() => void onReplace(row, statement)} className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900">Save edited wording</button>
          <button type="button" onClick={() => void onRetire(row.id)} className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900">Retire</button>
        </div>
      ) : null}
    </article>
  );
}
