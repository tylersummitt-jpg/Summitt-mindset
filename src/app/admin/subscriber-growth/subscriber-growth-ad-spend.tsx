"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { formatUnknownableUsdFromCents } from "@/lib/admin-subscriber-growth-pure";

type AdSpendEntry = {
  id: string;
  spend_date: string;
  source_normalized: string;
  utm_campaign: string;
  amount_cents: number;
};

function sourceLabel(raw: string): string {
  if (raw === "meta") return "Meta ads";
  if (raw === "google") return "Google";
  return raw;
}

export function SubscriberGrowthAdSpend({
  entries,
}: {
  entries: AdSpendEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ad-spend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spend_date: data.get("spend_date"),
          source: data.get("source"),
          campaign: data.get("campaign") || null,
          amount_usd: data.get("amount_usd"),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !json.ok) {
        setError("Could not save spend.");
        return;
      }
      form.reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save spend.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ad-spend?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Could not delete spend.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not delete spend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-gray-700">Add Ad Spend</div>
        <button
          type="button"
          className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-500"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Open"}
        </button>
      </div>
      {open ? (
        <form className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" onSubmit={onSubmit}>
          <label className="text-[11px] text-gray-600">
            Date
            <input
              required
              name="spend_date"
              type="date"
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </label>
          <label className="text-[11px] text-gray-600">
            Source
            <select
              required
              name="source"
              defaultValue="meta"
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs"
            >
              <option value="meta">Meta ads</option>
              <option value="google">Google</option>
            </select>
          </label>
          <label className="text-[11px] text-gray-600">
            Campaign (optional)
            <input
              name="campaign"
              type="text"
              maxLength={200}
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </label>
          <label className="text-[11px] text-gray-600">
            Amount USD
            <input
              required
              name="amount_usd"
              type="number"
              min="0.01"
              step="0.01"
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-gray-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save spend"}
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
      {entries.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
          {entries.slice(0, 8).map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 text-[11px] text-gray-700"
            >
              <span>
                {row.spend_date} · {sourceLabel(row.source_normalized)}
                {row.utm_campaign.trim() ? ` · ${row.utm_campaign.trim()}` : ""} ·{" "}
                {formatUnknownableUsdFromCents(row.amount_cents)}
              </span>
              <button
                type="button"
                disabled={busy}
                className="text-gray-500 underline"
                onClick={() => onDelete(row.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
