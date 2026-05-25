"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReviewAcknowledgeButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLooksRight() {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong.");
        setLoading(false);
        return;
      }

      router.push("/onboarding/sms");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={handleLooksRight}
        disabled={loading}
        className="w-full text-center bg-[var(--brand)] text-white rounded-md py-3 text-sm font-semibold disabled:opacity-50"
      >
        {loading ? "Saving…" : "Looks right →"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-600 text-center">{error}</p> : null}
    </div>
  );
}
