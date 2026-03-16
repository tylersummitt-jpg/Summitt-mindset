"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function IdentityClient(): ReactElement {
  const router = useRouter();

  const [preferredName, setPreferredName] = useState("");
  const [lifeDesires, setLifeDesires] = useState("");
  const [ninetyDayVision, setNinetyDayVision] = useState("");
  const [supportArea, setSupportArea] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const payload = {
      preferred_name: normalizeText(preferredName) || null,
      life_desires: normalizeText(lifeDesires),
      ninety_day_vision: normalizeText(ninetyDayVision),
      support_area: normalizeText(supportArea),
    };

    if (!payload.life_desires || !payload.ninety_day_vision || !payload.support_area) {
      setError("Please answer all three questions.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/identity", {
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

      router.push("/onboarding/relationships");
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
            What do you prefer to be called?{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>

          <input
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="First name or nickname"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What do you want out of life right now?
          </label>

          <textarea
            value={lifeDesires}
            onChange={(e) => setLifeDesires(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            If the next 90 days went well, what would have happened?
          </label>

          <textarea
            value={ninetyDayVision}
            onChange={(e) => setNinetyDayVision(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Where would you most like guidance or support from Coach Pat right now?
          </label>

          <textarea
            value={supportArea}
            onChange={(e) => setSupportArea(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Short answers are perfect."
          />
        </div>
      </div>

      <div className="border rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          Clarity about what matters most is where leadership begins.
        </p>
      </div>

      <div className="flex items-center justify-end">
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