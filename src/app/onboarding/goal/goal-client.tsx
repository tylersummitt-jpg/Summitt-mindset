"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GoalClient() {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goals = [
    "Build confidence",
    "Improve communication",
    "Increase accountability",
    "Strengthen consistency",
    "Grow as a leader",
    "Reduce overwhelm / gain clarity",
  ];

  async function chooseGoal(goal: string) {
    setError(null);
    setSaving(goal);

    try {
      const res = await fetch("/api/onboarding/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ goal }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data?.error || "Something went wrong.");
        return;
      }

      // ✅ Celebration moment
      setCelebrating(true);

      setTimeout(() => {
        router.push("/onboarding/training-focus");
      }, 900);
    } catch (e) {
      setError("Something went wrong.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="relative">
      {/* ✅ Celebration Overlay */}
      {celebrating && (
        <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-xl z-10">
          <p className="text-lg font-semibold text-gray-900">
            Great choice. That’s your summit.
          </p>
        </div>
      )}

      <div className="space-y-4 mb-8">
        {goals.map((goal) => (
          <div
            key={goal}
            className="border rounded-lg p-4 bg-white shadow-sm flex items-center justify-between gap-4"
          >
            <p className="text-gray-900">{goal}</p>

            <button
              type="button"
              onClick={() => chooseGoal(goal)}
              disabled={saving !== null}
              className={[
                "px-4 py-2 rounded-md text-sm font-semibold transition",
                saving === goal
                  ? "bg-gray-300 text-gray-700"
                  : "bg-black text-white hover:bg-gray-900",
              ].join(" ")}
            >
              {saving === goal ? "Saving…" : "Select"}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
