"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@clerk/nextjs";

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export default function CompleteOnboardingButton() {
  const router = useRouter();
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const timezone = getBrowserTimezone();

      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timezone }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "Something went wrong. Please try again."
        );
        setLoading(false);
        return;
      }

      await user?.reload();
      router.replace("/film-room");
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleComplete}
        disabled={loading}
        className={[
          "w-full rounded-xl px-6 py-4 text-lg font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white",
          loading ? "cursor-not-allowed bg-gray-400" : "bg-[var(--brand)] hover:opacity-90",
        ].join(" ")}
      >
        {loading ? "Finishing…" : "Enter the Film Room"}
      </button>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
