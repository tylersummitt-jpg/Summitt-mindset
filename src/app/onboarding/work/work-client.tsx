"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function WorkClient(): ReactElement {
  const router = useRouter();

  const [responsibility, setResponsibility] = useState("");
  const [financialGoals, setFinancialGoals] = useState("");
  const [workChallenge, setWorkChallenge] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const payload = {
      responsibility: normalizeText(responsibility),
      financial_goals: normalizeText(financialGoals),
      work_challenge: normalizeText(workChallenge),
    };

    if (!payload.responsibility || !payload.financial_goals || !payload.work_challenge) {
      setError("Please answer all three questions.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/work", {
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

      router.push("/onboarding/health");
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
            What responsibility is on your shoulders right now?
          </label>

          <textarea
            value={responsibility}
            onChange={(e) => setResponsibility(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What financial goals matter to you right now?
          </label>

          <textarea
            value={financialGoals}
            onChange={(e) => setFinancialGoals(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What feels hardest about work right now?
          </label>

          <textarea
            value={workChallenge}
            onChange={(e) => setWorkChallenge(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>
      </div>

      <div className="border rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          Responsibility reveals character over time.
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