"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARENAS } from "@/lib/onboarding-config";

export default function ArenaClient() {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseArena(arena: string) {
    setError(null);
    setSaving(arena);

    try {
      const res = await fetch("/api/onboarding/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ arena }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong.");
        return;
      }

      // ✅ small calm “commitment moment”
      setCelebrating(true);

      setTimeout(() => {
        router.push("/onboarding/outcome");
      }, 850);
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
            Good. That’s where we focus first.
          </p>
        </div>
      )}

      <div className="space-y-4 mb-8">
        {ARENAS.map((arena) => (
          <div
            key={arena}
            className="border rounded-lg p-4 bg-white shadow-sm flex items-center justify-between gap-4"
          >
            <p className="text-gray-900">{arena}</p>

            <button
              type="button"
              onClick={() => chooseArena(arena)}
              disabled={saving !== null}
              className={[
                "px-4 py-2 rounded-md text-sm font-semibold transition",
                saving === arena
                  ? "bg-gray-300 text-gray-700"
                  : "bg-black text-white hover:bg-gray-900",
              ].join(" ")}
            >
              {saving === arena ? "Saving…" : "Select"}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
