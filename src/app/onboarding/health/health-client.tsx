"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function HealthClient(): ReactElement {
  const router = useRouter();

  const [physicalState, setPhysicalState] = useState("");
  const [healthGoal, setHealthGoal] = useState("");
  const [energyObstacles, setEnergyObstacles] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const payload = {
      physical_state: normalizeText(physicalState),
      health_goal: normalizeText(healthGoal),
      energy_obstacles: normalizeText(energyObstacles),
    };

    if (!payload.physical_state || !payload.health_goal || !payload.energy_obstacles) {
      setError("Please answer all three questions.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/health", {
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

      router.push("/onboarding/pressure");
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
            How are you feeling physically these days?
          </label>

          <textarea
            value={physicalState}
            onChange={(e) => setPhysicalState(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Anything you want to improve in your health or energy?
          </label>

          <textarea
            value={healthGoal}
            onChange={(e) => setHealthGoal(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What tends to throw you off physically or mentally?
          </label>

          <textarea
            value={energyObstacles}
            onChange={(e) => setEnergyObstacles(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>
      </div>

      <div className="border rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          Energy and discipline travel together.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/onboarding/work")}
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