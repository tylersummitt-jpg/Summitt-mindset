"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

type TimeOfDay = "morning" | "midday" | "evening";

const OPTIONS: {
  value: TimeOfDay;
  title: string;
  description: string;
}[] = [
  {
    value: "morning",
    title: "Morning",
    description: "Start the day with calm discipline.",
  },
  {
    value: "midday",
    title: "Midday",
    description: "Reset your mindset and finish strong.",
  },
  {
    value: "evening",
    title: "Evening",
    description: "Close the day with reflection and clarity.",
  },
];

export default function ScheduleClient(): ReactElement {
  const router = useRouter();

  const [saving, setSaving] = useState<TimeOfDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseTimeOfDay(choice: TimeOfDay) {
    setError(null);
    setSaving(choice);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const res = await fetch("/api/onboarding/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          timeOfDay: choice,
          exactTime: null, // you can upgrade later to allow custom time
          timezone,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong.");
        setSaving(null);
        return;
      }

      // ✅ Go to next onboarding step
      router.push("/onboarding/miss-plan");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={saving !== null}
          onClick={() => chooseTimeOfDay(opt.value)}
          className={[
            "w-full text-left border rounded-xl p-5 bg-white shadow-sm transition",
            "hover:border-black hover:shadow-md",
            saving !== null ? "opacity-70" : "",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-gray-900">
                {opt.title}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {opt.description}
              </p>
            </div>

            <div
              className={[
                "px-4 py-2 rounded-md text-sm font-semibold transition",
                saving === opt.value
                  ? "bg-gray-300 text-gray-700"
                  : "bg-black text-white",
              ].join(" ")}
            >
              {saving === opt.value ? "Saving…" : "Select"}
            </div>
          </div>
        </button>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
