"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

export default function DayCompleteButton() {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Extract day number from URL: /dashboard/day-4 → 4
  const dayMatch = pathname.match(/day-(\d+)/);
  const pageDay = dayMatch ? Number(dayMatch[1]) : null;

  async function handleComplete() {
    if (loading || completed || !pageDay) return;

    setLoading(true);

    try {
      await fetch("/api/day/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ day: pageDay }),
      });

      setCompleted(true);

      setTimeout(() => {
        router.push("/dashboard");
      }, 600);
    } catch (err) {
      console.error("Day completion failed", err);
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleComplete}
      disabled={loading || completed}
      className={`w-full px-6 py-3 rounded-md font-semibold transition ${
        completed
          ? "bg-gray-400 text-white cursor-not-allowed"
          : "bg-green-600 hover:bg-green-700 text-white"
      }`}
    >
      {completed
        ? "Completed ✓"
        : loading
        ? "Completing..."
        : "Mark Day Complete →"}
    </button>
  );
}
