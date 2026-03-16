"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function PressureClient(): ReactElement {
  const router = useRouter();

  const [pressureSummary, setPressureSummary] = useState("");
  const [proudOf, setProudOf] = useState("");
  const [bestSelfTrigger, setBestSelfTrigger] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const payload = {
      pressure_summary: normalizeText(pressureSummary),
      proud_of: normalizeText(proudOf),
      best_self_trigger: normalizeText(bestSelfTrigger),
    };

    if (!payload.pressure_summary || !payload.proud_of || !payload.best_self_trigger) {
      setError("Please answer all three questions.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/pressure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        setSaving(false);
        return;
      }

      router.push("/onboarding/sms");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What pressure are you carrying right now?
          </label>

          <textarea
            value={pressureSummary}
            onChange={(e) => setPressureSummary(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What are you most proud of so far?
          </label>

          <textarea
            value={proudOf}
            onChange={(e) => setProudOf(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            When does the best version of you show up?
          </label>

          <textarea
            value={bestSelfTrigger}
            onChange={(e) => setBestSelfTrigger(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>
      </div>

      <div className="border rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          Never forget the strength you’ve already built.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/onboarding/relationships")}
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