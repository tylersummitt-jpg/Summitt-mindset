"use client";

import { useState } from "react";

export default function Day7NpsFeedback({ dayNumber }: { dayNumber: number }) {
  const [step, setStep] = useState<"rating" | "followup" | "done">("rating");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const isPromoter = rating !== null && rating >= 9;
  const isDetractor = rating !== null && rating <= 6;

  /**
   * STEP 1 — Canonical Day 7 NPS completion
   * This ALWAYS runs first.
   */
  async function submitNpsCompletion() {
    if (rating === null) return;

    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "app",
        moment: "day7_completion",
        type: "nps",
        dayNumber,
        rating,
        message: message.trim() || null,
        metadata: { canonical: true },
      }),
    });
  }

  /**
   * STEP 2 — Conditional follow-up routing
   */
  async function submitFollowup() {
    if (rating === null) return;

    setSending(true);

    try {
      // Promoter → testimonial seed (air-gapped public lane)
      if (isPromoter) {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "app",
            moment: "day7_promoter_seed",
            type: "testimonial_seed",
            dayNumber,
            message: message.trim() || null,
            sharePermission: true,
            metadata: { canonical: true },
          }),
        });
      }

      // Detractor → retention roadmap input
      if (isDetractor) {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "app",
            moment: "day8_detractor_lever",
            type: "friction",
            dayNumber,
            message: message.trim() || null,
            metadata: { canonical: true },
          }),
        });
      }
    } catch (err) {
      console.error("Day 7 follow-up failed", err);
    } finally {
      setSending(false);
      setStep("done");
    }
  }

  async function handleContinue() {
    await submitNpsCompletion();
    setStep("followup");
  }

  return (
    <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4 mt-6">
      {/* STEP 1 — NPS Rating */}
      {step === "rating" && (
        <>
          <p className="font-semibold text-gray-900">
            Quick question — how likely are you to recommend this so far?
          </p>

          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 11 }).map((_, i) => (
              <button
                key={i}
                onClick={() => setRating(i)}
                className={[
                  "w-10 h-10 rounded-md border text-sm font-semibold",
                  rating === i
                    ? "bg-black text-white border-black"
                    : "hover:bg-gray-50",
                ].join(" ")}
              >
                {i}
              </button>
            ))}
          </div>

          <button
            disabled={rating === null}
            onClick={handleContinue}
            className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
          >
            Continue →
          </button>
        </>
      )}

      {/* STEP 2 — Conditional Follow-Up */}
      {step === "followup" && (
        <>
          {isPromoter && (
            <>
              <p className="font-semibold text-gray-900">
                One sentence is enough — what changed this week?
              </p>
              <textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional — your words help others."
                className="w-full border rounded-md p-2 text-sm"
              />
              <button
                disabled={sending}
                onClick={submitFollowup}
                className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
              >
                {sending ? "Saving…" : "Share ✅"}
              </button>
            </>
          )}

          {isDetractor && (
            <>
              <p className="font-semibold text-gray-900">
                Thank you — what would make this a 9?
              </p>
              <textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="One honest sentence is enough."
                className="w-full border rounded-md p-2 text-sm"
              />
              <button
                disabled={sending}
                onClick={submitFollowup}
                className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
              >
                {sending ? "Saving…" : "Submit ✅"}
              </button>
            </>
          )}

          {!isPromoter && !isDetractor && (
            <>
              <p className="font-semibold text-gray-900">
                Thank you. One sentence — what stands out most so far?
              </p>
              <textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional"
                className="w-full border rounded-md p-2 text-sm"
              />
              <button
                disabled={sending}
                onClick={() => setStep("done")}
                className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
              >
                Done ✅
              </button>
            </>
          )}
        </>
      )}

      {/* DONE */}
      {step === "done" && (
        <p className="text-sm text-gray-600">
          Thank you. That helps us keep this calm and strong.
        </p>
      )}
    </div>
  );
}
