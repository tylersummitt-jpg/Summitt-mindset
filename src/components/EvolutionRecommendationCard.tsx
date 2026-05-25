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
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-black/[0.03]">
      <h2 className="text-base font-semibold text-gray-900">{props.headline}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{props.body}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
        This note does not change your commitment by itself. Text Pat for check-ins and any
        refresh prompts you already have in flight.
      </p>
      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => submit("dismiss")}
          disabled={loading !== null}
          className="member-secondary-btn"
        >
          {loading === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
        <button
          type="button"
          onClick={() => submit("accept")}
          disabled={loading !== null}
          className="member-primary-cta disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:hover:opacity-100"
        >
          {loading === "accept" ? "Acknowledging…" : "Acknowledge"}
        </button>
      </div>
    </section>
  );
}
