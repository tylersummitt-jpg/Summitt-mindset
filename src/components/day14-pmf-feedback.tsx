"use client";

import { useState } from "react";

const OPTIONS = [
  "The daily practice itself",
  "The journaling reflection",
  "Coach Pat’s voice",
  "The calm structure",
  "The accountability rhythm",
  "Something else",
];

export default function Day14PMFFeedback({
  dayNumber,
}: {
  dayNumber: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!selected || sending) return;

    try {
      setSending(true);

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "day14_completion",
          type: "friction",
          dayNumber,

          rating: null,
          reasonCode: "pmf_attribution",
          message: selected,

          sharePermission: false,
          metadata: { canonical: true },
        }),
      });

      setDone(true);
    } catch (err) {
      console.error("Day 14 feedback failed", err);
      setDone(true); // calm failure
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-gray-600 text-center mt-4">
        Thank you. That helps us protect what matters most.
      </p>
    );
  }

  return (
    <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4 mt-6">
      <p className="font-semibold text-gray-900">
        Quick question — which part matters most so far?
      </p>

      <div className="space-y-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelected(opt)}
            className={[
              "w-full text-left px-3 py-2 rounded-md border text-sm",
              selected === opt
                ? "border-black bg-gray-50 font-semibold"
                : "hover:bg-gray-50",
            ].join(" ")}
          >
            {opt}
          </button>
        ))}
      </div>

      <button
        disabled={!selected || sending}
        onClick={submit}
        className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
      >
        {sending ? "Saving…" : "Submit ✅"}
      </button>
    </div>
  );
}
