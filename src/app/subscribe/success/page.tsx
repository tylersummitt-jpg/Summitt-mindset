"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

function SubscribeSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, user } = useUser();

  const [error, setError] = useState<string | null>(null);

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    async function run() {
      if (isLoaded && !isSignedIn) {
        router.push("/sign-in?redirect_url=/subscribe/success");
        return;
      }

      if (!isLoaded || !isSignedIn || !user) return;

      try {
        if (!sessionId) {
          throw new Error("Missing session_id");
        }

        // 🔥 Call synchronous confirm endpoint
        const res = await fetch("/api/stripe/confirm-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text);
        }

        // Reload Clerk user so metadata is fresh
        await user.reload();

        // Deterministic redirect
        router.push("/post-sign-in");
      } catch (err: any) {
        console.error("Subscribe success flow error:", err);
        setError(err?.message || "Something went wrong.");
      }
    }

    run();
  }, [isLoaded, isSignedIn, user, router, sessionId]);

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Loading…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Almost there</h1>

          <p className="text-gray-600 text-sm">
            We couldn't automatically confirm your membership.
          </p>

          <p className="text-red-600 text-sm">{error}</p>

          <button
            onClick={() => router.push("/post-sign-in")}
            className="rounded-md bg-black text-white px-6 py-3 font-semibold hover:bg-gray-900 transition"
          >
            Continue →
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-lg w-full text-center space-y-4">
        <h1 className="text-3xl font-semibold">You’re in.</h1>

        <p className="text-gray-600">
          Finalizing your membership…
        </p>
      </div>
    </main>
  );
}

export default function SubscribeSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-6">
          <p>Loading…</p>
        </main>
      }
    >
      <SubscribeSuccessInner />
    </Suspense>
  );
}