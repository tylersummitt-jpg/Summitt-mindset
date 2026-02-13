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

  const [pledgeDaily, setPledgeDaily] = useState(false);
  const [pledgeNoBacklog, setPledgeNoBacklog] = useState(false);

  const pledgeComplete = pledgeDaily && pledgeNoBacklog;

  async function handleComplete() {
    if (!pledgeComplete) return;

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
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={pledgeDaily}
            onChange={(e) => setPledgeDaily(e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong>One practice per day.</strong>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={pledgeNoBacklog}
            onChange={(e) => setPledgeNoBacklog(e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong>No catching up. No guilt.</strong> Just training.
          </span>
        </label>
      </div>

      <button
        onClick={handleComplete}
        disabled={loading || !pledgeComplete}
        className={[
          "w-full bg-black hover:bg-gray-900 text-white px-6 py-3 rounded-md text-lg font-semibold transition",
          loading || !pledgeComplete ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {loading ? "Starting..." : "Start Day 1 →"}
      </button>

      {!pledgeComplete && (
        <p className="text-xs text-gray-500">Check both boxes to begin.</p>
      )}
    </div>
  );
}
