"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const TRAINING_THEMES = [
  {
    slug: "discipline",
    label: "Discipline & Standards",
    description: "Doing the work the right way, every day.",
  },
  {
    slug: "consistency",
    label: "Consistency",
    description: "Showing up even when it’s not exciting.",
  },
  {
    slug: "accountability",
    label: "Accountability",
    description: "Owning outcomes without excuses.",
  },
  {
    slug: "communication",
    label: "Communication",
    description: "Clarity, tone, and intent in how you lead.",
  },
  {
    slug: "focus",
    label: "Focus & Execution",
    description: "Prioritizing what matters most.",
  },
  {
    slug: "confidence",
    label: "Confidence",
    description: "Trusting your preparation and decisions.",
  },
  {
    slug: "leadership",
    label: "Leadership",
    description: "Setting the tone for others.",
  },
  {
    slug: "relationships",
    label: "Relationships",
    description: "Trust, respect, and connection.",
  },
  {
    slug: "resilience",
    label: "Resilience",
    description: "Responding well under pressure.",
  },
] as const;

export default function TrainingFocusClient() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(slug: string) {
    setError(null);

    // If already selected -> remove
    if (selectedSet.has(slug)) {
      setSelected((prev) => prev.filter((s) => s !== slug));
      return;
    }

    // If not selected and already at 5 -> block
    if (selected.length >= 5) return;

    setSelected((prev) => [...prev, slug]);
  }

  async function handleContinue() {
    setError(null);

    if (selected.length !== 5) {
      setError("Pick exactly five.");
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

      router.push("/onboarding/preferences");
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
                  <p className="text-sm text-gray-600 mt-1">{t.description}</p>
                </div>

                <div
                  className={[
                    "w-6 h-6 rounded-full border flex items-center justify-center text-sm font-bold",
                    isSelected ? "border-black" : "border-gray-300",
                  ].join(" ")}
                  aria-hidden
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
          Selected: <strong>{selected.length}</strong> / 5
        </p>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || selected.length !== 5}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold transition",
            saving || selected.length !== 5 ? "bg-gray-400" : "bg-black hover:bg-gray-900",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 mt-4">{error}</p>
      )}
    </div>
  );
}
