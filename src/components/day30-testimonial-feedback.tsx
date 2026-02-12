"use client";

import { useState } from "react";

export default function Day30TestimonialFeedback({
  dayNumber,
}: {
  dayNumber: number;
}) {
  const [step, setStep] = useState<"ask" | "form" | "done">("ask");

  const [quote, setQuote] = useState("");
  const [sending, setSending] = useState(false);

  // --------------------------------------------------
  // ✅ STEP 1 — Permission Ask
  // --------------------------------------------------
  function handleYes() {
    setStep("form");
  }

  function handleNo() {
    setStep("done");
  }

  // --------------------------------------------------
  // ✅ STEP 2 — Submit Story → Air-Gapped Testimonial Lane
  // --------------------------------------------------
  async function handleSubmit() {
    if (!quote.trim()) return;

    setSending(true);

    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "day30_story_permission",
          type: "testimonial_seed",
          dayNumber,

          rating: null,
          reasonCode: null,
          message: quote.trim(),

          // ✅ This is the only time sharePermission defaults true
          sharePermission: true,

          metadata: {
            canonical: true,
            milestone: "day30",
          },
        }),
      });
    } catch (err) {
      console.error("Day 30 testimonial submission failed", err);
    } finally {
      setSending(false);
      setStep("done");
      setQuote("");
    }
  }

  // --------------------------------------------------
  // ✅ DONE STATE
  // --------------------------------------------------
  if (step === "done") {
    return (
      <p className="text-sm text-gray-600 mt-6 text-center">
        Thank you. That means more than you know.
      </p>
    );
  }

  return (
    <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4 mt-6">
      {/* ======================================================
          ✅ STEP 1 — Permission Gate
         ====================================================== */}
      {step === "ask" && (
        <>
          <p className="font-semibold text-gray-900">
            Day 30 is earned.
          </p>

          <p className="text-sm text-gray-600">
            Would you share a short sentence or story about what’s changed for
            you so far?
          </p>

          <div className="flex gap-3">
            <button
              onClick={handleYes}
              className="flex-1 bg-black text-white rounded-md py-2 font-semibold"
            >
              Yes ✅
            </button>

            <button
              onClick={handleNo}
              className="flex-1 border rounded-md py-2 font-semibold"
            >
              Not right now
            </button>
          </div>
        </>
      )}

      {/* ======================================================
          ✅ STEP 2 — Story Form
         ====================================================== */}
      {step === "form" && (
        <>
          <p className="font-semibold text-gray-900">
            One honest sentence is enough.
          </p>

          <textarea
            rows={3}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="What has shifted for you these past 30 days?"
            className="w-full border rounded-md p-2 text-sm"
          />

          <button
            disabled={sending || !quote.trim()}
            onClick={handleSubmit}
            className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
          >
            {sending ? "Saving…" : "Share Story ✅"}
          </button>

          <p className="text-xs text-gray-500">
            This will only be shared publicly if you approve it later.
          </p>
        </>
      )}
    </div>
  );
}
