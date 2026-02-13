"use client";

import { useState } from "react";

export default function WinbackClient({ token }: { token: string | null }) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;

    setLoading(true);

    try {
      await fetch("/api/winback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          token, // ✅ links response to user if present/valid
        }),
      });

      setSubmitted(true);
    } catch (err) {
      console.error("Winback submission failed", err);
      setSubmitted(true); // calm fail
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm text-gray-600 text-center">
        Thank you. That helps us build this the right way.
      </p>
    );
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="If you could change one thing…"
        className="w-full border rounded-md p-3 text-sm"
      />

      <button
        disabled={loading || !text.trim()}
        onClick={handleSubmit}
        className="w-full bg-black text-white rounded-md py-3 font-semibold disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send Reflection"}
      </button>

      <p className="text-xs text-gray-500 text-center">No marketing. Just truth.</p>
    </section>
  );
}
