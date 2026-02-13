"use client";

import { useState } from "react";

function countWords(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return 0;
  return t.split(" ").length;
}

export default function PulseClient({ token }: { token: string | null }) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = countWords(text);

  async function submit() {
    setError(null);

    if (!token) {
      setError("This link is missing a token.");
      return;
    }

    if (!text.trim()) return;

    if (words > 3) {
      setError("One word is enough (two or three is okay).");
      return;
    }

    setLoading(true);

    try {
      await fetch("/api/sms/pulse-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          message: text.trim(),
        }),
      });

      setSubmitted(true);
    } catch (e) {
      setSubmitted(true); // calm fail
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm text-gray-600 text-center">
        Thank you. That helps us keep this calm and real.
      </p>
    );
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="One word…"
        className="w-full border rounded-md p-3 text-sm"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        disabled={loading || !text.trim()}
        onClick={submit}
        className="w-full bg-black text-white rounded-md py-3 font-semibold disabled:opacity-50"
      >
        {loading ? "Saving…" : "Submit ✅"}
      </button>

      <p className="text-xs text-gray-500 text-center">
        No marketing. Just truth.
      </p>
    </section>
  );
}
