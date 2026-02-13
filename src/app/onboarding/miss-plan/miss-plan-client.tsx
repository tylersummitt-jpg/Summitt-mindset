"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MISS_PLAN_OPTIONS } from "@/lib/onboarding-config";

export default function MissPlanClient() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    if (!selected) {
      setError("Select your reset plan.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/miss-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ missPlan: selected }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong.");
        return;
      }

      router.push("/onboarding/training-focus");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {MISS_PLAN_OPTIONS.map((plan) => (
          <button
            key={plan}
            type="button"
            onClick={() => setSelected(plan)}
            className={[
              "w-full border rounded-lg p-4 text-left transition",
              selected === plan
                ? "border-black bg-white"
                : "border-gray-200 bg-white hover:bg-gray-50",
            ].join(" ")}
          >
            <p className="text-gray-900">{plan}</p>
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={() => router.push("/onboarding/schedule")}
          className="text-sm underline text-gray-500"
        >
          ← Back
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold transition",
            saving ? "bg-gray-400" : "bg-black hover:bg-gray-900",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
