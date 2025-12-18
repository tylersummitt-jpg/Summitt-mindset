"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

type ConfirmState = "idle" | "saving" | "success" | "error";

export default function SubscribeSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();

  const sessionId = searchParams.get("session_id");

  const [state, setState] = useState<ConfirmState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !isLoaded) return;

    async function confirmSubscription() {
      try {
        setState("saving");
        setError(null);

        const res = await fetch("/api/stripe/confirm-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to confirm subscription.");
        }

        await res.json();

        // 🔑 CRITICAL STEP: force Clerk session refresh
        if (user) {
          await user.reload();
        }

        setState("success");
      } catch (err: any) {
        console.error("Subscription confirmation error:", err);
        setError(err.message || "Something went wrong.");
        setState("error");
      }
    }

    confirmSubscription();
  }, [sessionId, isLoaded, user]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-6 text-center">
        <h1 className="text-3xl font-semibold">You’re in 🙌</h1>

        <p className="text-sm text-gray-700">
          Your 7-day free trial for{" "}
          <span className="font-medium">Summitt Mindset</span> is active.
        </p>

        {state === "saving" && (
          <p className="text-sm text-gray-600">
            Finishing your membership setup…
          </p>
        )}

        {state === "error" && error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {state === "success" && (
          <p className="text-sm text-green-700">
            Your membership is confirmed. You’re ready to start.
          </p>
        )}

        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center justify-center rounded-md border border-black px-4 py-2 text-sm font-semibold hover:bg-black hover:text-white transition"
        >
          Go to Dashboard
        </button>
      </div>
    </main>
  );
}
