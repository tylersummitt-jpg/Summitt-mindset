"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SelectGoalButton({ goal }: { goal: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSelect() {
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/goal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ goal }),
      });

      if (!res.ok) {
        throw new Error("Failed to save goal");
      }

      router.push("/onboarding/preferences");
    } catch (err) {
      console.error(err);
      alert("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleSelect}
      disabled={loading}
      className="text-blue-600 underline text-sm disabled:opacity-50"
    >
      {loading ? "Saving..." : "Select →"}
    </button>
  );
}
