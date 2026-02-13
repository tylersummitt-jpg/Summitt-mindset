"use client";

import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getOutcomesForArena,
  isArena,
  type Arena,
} from "@/lib/onboarding-config";

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export default function OutcomeClient({
  arena,
}: {
  arena: string;
}): ReactElement {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeArena: Arena | null = useMemo(() => {
    const cleaned = normalizeText(arena);
    return isArena(cleaned) ? cleaned : null;
  }, [arena]);

  const outcomes = useMemo(() => {
    if (!safeArena) return [];
    return getOutcomesForArena(safeArena);
  }, [safeArena]);

  async function chooseOutcome(outcome: string) {
    if (!safeArena) return;

    setError(null);
    setSaving(outcome);

    try {
      const res = await fetch("/api/onboarding/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ arena: safeArena, outcome }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong.");
        return;
      }

      setCelebrating(true);

      setTimeout(() => {
        router.push("/onboarding/schedule");
      }, 850);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(null);
    }
  }

  if (!safeArena) {
    return (
      <div className="border rounded-lg p-6 bg-white shadow-sm">
        <p className="text-gray-700">
          Something got out of sync. Go back and choose your arena again.
        </p>

        <button
          className="mt-4 underline text-sm"
          onClick={() => router.push("/onboarding/goal")}
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {celebrating && (
        <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-xl z-10">
          <p className="text-lg font-semibold text-gray-900">
            Perfect. We’ll train toward that.
          </p>
        </div>
      )}

      <div className="space-y-4 mb-8">
        {outcomes.map((outcome) => (
          <div
            key={outcome}
            className="border rounded-lg p-4 bg-white shadow-sm flex items-center justify-between gap-4"
          >
            <p className="text-gray-900">{outcome}</p>

            <button
              type="button"
              onClick={() => chooseOutcome(outcome)}
              disabled={saving !== null}
              className={[
                "px-4 py-2 rounded-md text-sm font-semibold transition",
                saving === outcome
                  ? "bg-gray-300 text-gray-700"
                  : "bg-black text-white hover:bg-gray-900",
              ].join(" ")}
            >
              {saving === outcome ? "Saving…" : "Select"}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
