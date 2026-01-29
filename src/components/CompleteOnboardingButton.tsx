"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CompleteOnboardingButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to complete onboarding");
      }

      // ✅ Retention Hook: Start Day 1 Immediately
      router.push("/dashboard/day/1");
    } catch (err) {
      console.error(err);
      alert("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleComplete}
      disabled={loading}
      className="bg-black hover:bg-gray-900 text-white px-6 py-3 rounded-md text-lg font-semibold disabled:opacity-50"
    >
      {loading ? "Starting..." : "Start Day 1 Now →"}
    </button>
  );
}
