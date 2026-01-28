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

  async function handleComplete() {
    if (loading || showSuccess) return;

    try {
      setError(null);
      setLoading(true);

      // 1) Ensure journal autosave completes
      if (onBeforeComplete) {
        await onBeforeComplete();
      }

      // 2) Call completion API
      const res = await fetch("/api/day/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          day: dayNumber,
          videoIdShown,
        }),
      });

      if (!res.ok) {
        throw new Error("Network error completing day");
      }

      const data = await res.json();

      // 3) Domain failures (expected)
      if (data?.ok === false) {
        switch (data.reason) {
          case "journal_required":
            setError(
              "Write one honest sentence before completing today’s practice."
            );
            return;

          case "already_completed_today":
            setSuccessMessage("You already showed up today.");
            setShowSuccess(true);

            if (onAfterComplete) {
              await onAfterComplete();
            }
            return;

          default:
            setError("Unable to complete today. Please try again.");
            return;
        }
      }

      // 4) Success
      if (data?.ok === true) {
        setSuccessMessage(getRandomCompletionMessage());
        setShowSuccess(true);

        // ✅ Generate Coach Pat reply immediately after completion
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

  // ✅ AUTO-HIDE SUCCESS OVERLAY AFTER 1.5s
  useEffect(() => {
    if (!showSuccess) return;

    const timer = setTimeout(() => {
      setShowSuccess(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [showSuccess]);

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

      {/* ✅ MAIN BUTTON */}
      <button
        onClick={handleComplete}
        disabled={loading || showSuccess}
        className="w-full bg-black text-white rounded-md py-3 font-semibold hover:bg-gray-900 disabled:opacity-50"
      >
        {loading ? "Completing…" : "Complete Today’s Practice"}
      </button>

      {/* ✅ ERROR */}
      {error && (
        <p className="mt-3 text-sm text-gray-700 text-center">{error}</p>
      )}
    </>
  );
}
