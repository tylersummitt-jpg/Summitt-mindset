"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
type Props = {
  recommendationId: string;
  headline: string;
  body: string;
};

export default function EvolutionRecommendationCard(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"dismiss" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(intent: "dismiss" | "accept") {
    if (loading) return;
    setLoading(intent);
    setError(null);
    try {
      const res = await fetch("/api/v2/commitment-evolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recommendationId: props.recommendationId,
          intent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong.");
        setLoading(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setLoading(null);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50/90 p-5">
      <h2 className="text-sm font-semibold text-slate-900">{props.headline}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-800">{props.body}</p>
      <p className="mt-2 text-xs text-slate-500">
        This note does not change your commitment by itself. Use SMS with Pat for check-ins and any
        refresh prompts you already have in flight.
      </p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => submit("dismiss")}
          disabled={loading !== null}
          className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
        <button
          type="button"
          onClick={() => submit("accept")}
          disabled={loading !== null}
          className="inline-flex rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:hover:opacity-100"
        >
          {loading === "accept" ? "Acknowledging…" : "Acknowledge"}
        </button>
      </div>
    </section>
  );
}
