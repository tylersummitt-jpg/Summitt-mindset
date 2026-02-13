"use client";

import { useState } from "react";

export default function RescueClient({ token }: { token: string | null }) {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function choose(yes: boolean) {
    if (!token) {
      setDone(true);
      return;
    }

    setLoading(true);
    try {
      await fetch("/api/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, yes }),
      });
    } catch {
      // calm failure
    } finally {
      setLoading(false);
      setDone(true);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-gray-600 text-center">
        Got it. Tomorrow stays calm.
      </p>
    );
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
      <p className="font-semibold text-gray-900">Want a smaller version tomorrow?</p>

      <div className="flex gap-3">
        <button
          disabled={loading}
          onClick={() => choose(true)}
          className="flex-1 bg-black text-white rounded-md py-3 font-semibold disabled:opacity-50"
        >
          {loading ? "Saving…" : "Yes ✅"}
        </button>

        <button
          disabled={loading}
          onClick={() => choose(false)}
          className="flex-1 border rounded-md py-3 font-semibold disabled:opacity-50"
        >
          Not right now
        </button>
      </div>

      {!token && (
        <p className="text-xs text-gray-500">
          This link is missing a token, so nothing will be saved.
        </p>
      )}
    </section>
  );
}
