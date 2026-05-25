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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (!ready || loading) return;

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
      router.refresh();
      router.push("/dashboard/victory-room");
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <label className="flex items-start gap-3 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={ready}
          onChange={(e) => setReady(e.target.checked)}
          className="mt-1"
        />
        <span>I&apos;m ready to finish setup and enter my Victory Room.</span>
      </label>

      <button
        onClick={handleComplete}
        disabled={loading || !ready}
        className={[
          "w-full px-6 py-3 rounded-md text-lg font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white",
          loading || !ready
            ? "cursor-not-allowed bg-gray-400"
            : "bg-[var(--brand)] hover:opacity-90",
        ].join(" ")}
      >
        {loading ? "Finishing…" : "Finish Setup →"}
      </button>

      {!ready && (
        <p className="text-xs text-gray-500">Check the box above to finish setup.</p>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
