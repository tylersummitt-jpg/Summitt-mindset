"use client";

import { useEffect, useState } from "react";

const COMPLETION_MESSAGES = [
  "You showed up today.",
  "That counts.",
  "Practice complete.",
  "Another day practiced.",
  "Consistency beats intensity.",
  "Good work. See you tomorrow.",
];

function getRandomCompletionMessage() {
  return COMPLETION_MESSAGES[
    Math.floor(Math.random() * COMPLETION_MESSAGES.length)
  ];
}

type Props = {
  dayNumber: number;
  onBeforeComplete?: () => Promise<void>;
  onAfterComplete?: () => Promise<void>;
  videoIdShown?: string | null;
};

export default function DayCompleteButton({
  dayNumber,
  onBeforeComplete,
  onAfterComplete,
  videoIdShown = null,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ✅ Day 1 Feedback State
  const [showSurvey, setShowSurvey] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);

  async function handleComplete() {
    if (loading || showSuccess) return;

    try {
      setError(null);
      setLoading(true);

      if (onBeforeComplete) {
        await onBeforeComplete();
      }

      const res = await fetch("/api/day/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          day: dayNumber,
          videoIdShown,
        }),
      });

      if (!res.ok) throw new Error("Network error completing day");

      const data = await res.json();

      if (data?.ok === false) {
        if (data.reason === "journal_required") {
          setError("Write one honest sentence before completing today.");
          return;
        }

        if (data.reason === "already_completed_today") {
          setSuccessMessage("You already showed up today.");
          setShowSuccess(true);

          if (onAfterComplete) await onAfterComplete();
          return;
        }

        setError("Unable to complete today. Please try again.");
        return;
      }

      // ✅ SUCCESS
      if (data?.ok === true) {
        // ✅ Day 1 gets special celebration
        if (dayNumber === 1) {
          setSuccessMessage("Training Camp has begun.");
        } else {
          setSuccessMessage(getRandomCompletionMessage());
        }

        setShowSuccess(true);

        if (onAfterComplete) {
          await onAfterComplete();
        }

        return;
      }

      throw new Error("Unexpected completion response");
    } catch (err) {
      console.error("Failed to complete day", err);
      setError("Something went wrong completing your day. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // ✅ Auto-hide overlay + trigger survey if Day 1
  useEffect(() => {
    if (!showSuccess) return;

    const timer = setTimeout(() => {
      setShowSuccess(false);

      // ✅ Day 1 Survey triggers after success fades
      if (dayNumber === 1) {
        setShowSurvey(true);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [showSuccess, dayNumber]);

  async function sendFeedback(wasEasy: boolean) {
    setSendingFeedback(true);

    await fetch("/api/feedback/day1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wasEasy,
        message: feedbackText.trim(),
      }),
    });

    setSendingFeedback(false);
    setShowSurvey(false);
  }

  return (
    <>
      {/* ✅ SUCCESS OVERLAY */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl px-8 py-6 shadow-lg text-center max-w-sm w-full">
            <div className="mb-3 text-2xl">✓</div>
            <p className="text-lg font-medium text-gray-900">
              {successMessage}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              No catching up. No backlog. Just today.
            </p>
          </div>
        </div>
      )}

      {/* ✅ DAY 1 SURVEY */}
      {showSurvey && (
        <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
          <p className="font-semibold text-gray-900">
            Quick question — was today easy?
          </p>

          <textarea
            rows={2}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Optional: anything unclear?"
            className="w-full border rounded-md p-2 text-sm"
          />

          <div className="flex gap-3">
            <button
              disabled={sendingFeedback}
              onClick={() => sendFeedback(true)}
              className="flex-1 bg-black text-white rounded-md py-2 font-semibold"
            >
              Yes ✅
            </button>

            <button
              disabled={sendingFeedback}
              onClick={() => sendFeedback(false)}
              className="flex-1 border rounded-md py-2 font-semibold"
            >
              Not really
            </button>
          </div>
        </div>
      )}

      {/* ✅ MAIN BUTTON */}
      {!showSurvey && (
        <button
          onClick={handleComplete}
          disabled={loading || showSuccess}
          className="w-full bg-black text-white rounded-md py-3 font-semibold hover:bg-gray-900 disabled:opacity-50"
        >
          {loading ? "Completing…" : "Complete Today’s Practice"}
        </button>
      )}

      {/* ✅ ERROR */}
      {error && (
        <p className="mt-3 text-sm text-gray-700 text-center">{error}</p>
      )}
    </>
  );
}
