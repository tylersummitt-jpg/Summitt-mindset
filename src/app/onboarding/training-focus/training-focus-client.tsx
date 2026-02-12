"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TRAINING_THEMES } from "@/lib/onboarding-config";

export default function TrainingFocusClient() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(slug: string) {
    setError(null);

    if (selectedSet.has(slug)) {
      setSelected((prev) => prev.filter((s) => s !== slug));
      return;
    }

    if (selected.length >= 3) return;

    setSelected((prev) => [...prev, slug]);
  }

  async function handleContinue() {
    setError(null);

    if (selected.length !== 3) {
      setError("Pick exactly three.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/training-focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trainingThemes: selected }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        return;
      }

      router.push("/onboarding/sms");
    } catch (e) {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {TRAINING_THEMES.map((t) => {
          const isSelected = selectedSet.has(t.slug);

          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => toggle(t.slug)}
              className={[
                "text-left border rounded-lg p-5 bg-white shadow-sm transition",
                "hover:bg-gray-50",
                isSelected ? "border-black" : "border-gray-200",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-900">{t.label}</p>
                </div>

                <div
                  className={[
                    "w-6 h-6 rounded-full border flex items-center justify-center text-sm font-bold",
                    isSelected ? "border-black" : "border-gray-300",
                  ].join(" ")}
                >
                  {isSelected ? "✓" : ""}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          Selected: <strong>{selected.length}</strong> / 3
        </p>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || selected.length !== 3}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold transition",
            saving || selected.length !== 3
              ? "bg-gray-400"
              : "bg-black hover:bg-gray-900",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
    </div>
  );
}
