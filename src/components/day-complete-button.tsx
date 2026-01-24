"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  videoIdShown?: string | null;
};

export default function DayCompleteButton({
  dayNumber,
  onBeforeComplete,
  videoIdShown = null,
}: Props) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (loading || showSuccess) return;

    try {
      setError(null);
      setLoading(true);

      // 1. Force journal save
      if (onBeforeComplete) {
        await onBeforeComplete();
      }

      // 2. Complete day
      const res = await fetch("/api/day/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          day: dayNumber,
          videoIdShown,
        }),
      });

      const data = await res.json();

      // 3. Guards
      if (data?.reason === "journal_required") {
        setError(
          "Write one honest sentence before completing today’s practice."
        );
        return;
      }

      // Treat already-completed as SUCCESS UX
      if (data?.reason === "already_completed_today") {
        setSuccessMessage("You already showed up today.");
        setShowSuccess(true);
        return;
      }

      // ✅ FIX: trust API contract
      if (!res.ok || data?.ok !== true) {
        throw new Error("Day completion failed");
      }

      // 4. Success
      setSuccessMessage(getRandomCompletionMessage());
      setShowSuccess(true);
    } catch (err) {
      console.error("Failed to complete day", err);
      setError("Something went wrong completing your day. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-redirect after confirmation
  useEffect(() => {
    if (!showSuccess) return;

    const timer = setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1500);

    return () => clearTimeout(timer);
  }, [showSuccess, router]);

  return (
    <>
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

      <button
        onClick={handleComplete}
        disabled={loading || showSuccess}
        className="w-full bg-black text-white rounded-md py-3 font-semibold hover:bg-gray-900 disabled:opacity-50"
      >
        {loading
          ? "Completing…"
          : showSuccess
          ? "Practice complete"
          : "Complete Today’s Practice"}
      </button>

      {error && (
        <p className="mt-3 text-sm text-gray-700 text-center">{error}</p>
      )}
    </>
  );
}
