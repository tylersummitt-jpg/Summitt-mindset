"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SavePreferencesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Placeholder preferences for now
        body: JSON.stringify({
          notifications: "email",
          timezone: "America/New_York",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save preferences");
      }

      router.push("/onboarding/complete");
    } catch (err) {
      console.error(err);
      alert("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleContinue}
      disabled={loading}
      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md text-lg disabled:opacity-50"
    >
      {loading ? "Saving..." : "Continue →"}
    </button>
  );
}
