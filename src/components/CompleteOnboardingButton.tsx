"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export default function CompleteOnboardingButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [ready, setReady] = useState(false);

  async function handleComplete() {
    if (!ready) return;
    if (loading) return;

    setLoading(true);

    try {
      const timezone = getBrowserTimezone();

      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timezone }),
      });

      if (!res.ok) {
        throw new Error("Failed to complete onboarding");
      }

      router.refresh();
      router.push("/post-sign-in");
    } catch (err) {
      console.error(err);
      alert("Something went wrong. Please try again.");
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
        <span>
          I&apos;m ready for Coach Pat to hold me accountable on my commitment.
        </span>
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
        {loading ? "Starting..." : "Start coaching →"}
      </button>

      {!ready && (
        <p className="text-xs text-gray-500">Check the box above to begin.</p>
      )}
    </div>
  );
}
