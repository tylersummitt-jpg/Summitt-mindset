"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

const CLERK_READY_TIMEOUT_MS = 15000;
const CONFIRM_TIMEOUT_MS = 15000;

function SubscribeSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, user } = useUser();

  const [error, setError] = useState<string | null>(null);
  const [clerkTimedOut, setClerkTimedOut] = useState(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const confirmStartedForSession = useRef<string | null>(null);

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    console.info("[subscribe/success] mounted");
  }, []);

  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => {
      console.warn("[subscribe/success] clerk load timeout");
      setClerkTimedOut(true);
    }, CLERK_READY_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isLoaded]);

  useEffect(() => {
    async function run() {
      console.info("[subscribe/success] run confirm flow", {
        isLoaded,
        isSignedIn,
        hasUser: Boolean(user),
      });

      if (isLoaded && !isSignedIn) {
        router.push("/sign-in?redirect_url=/subscribe/success");
        return;
      }

      if (!isLoaded || !isSignedIn || !user) return;

      setClerkTimedOut(false);
      setConfirmTimedOut(false);
      setError(null);

      try {
        if (!sessionId) {
          throw new Error("Missing session_id");
        }

        const runId = `${sessionId}:${attempt}`;
        if (confirmStartedForSession.current === runId) {
          return;
        }
        confirmStartedForSession.current = runId;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIRM_TIMEOUT_MS);

        try {
          console.info("[subscribe/success] confirm request started");

          // 🔥 Call synchronous confirm endpoint
          const res = await fetch("/api/stripe/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }

          console.info("[subscribe/success] confirm request succeeded");

          // Reload Clerk user so metadata is fresh
          await user.reload();

          console.info("[subscribe/success] redirecting to post-sign-in");

          // Deterministic redirect
          router.push("/post-sign-in");
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          console.warn("[subscribe/success] confirm request timed out");
          setConfirmTimedOut(true);
          return;
        }
        console.error("Subscribe success flow error:", err);
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setError(message || "Something went wrong.");
      }
    }

    run();
  }, [isLoaded, isSignedIn, user, router, sessionId, attempt]);

  if (!isLoaded && !clerkTimedOut) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Loading…</p>
      </main>
    );
  }

  if (clerkTimedOut || confirmTimedOut) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Still finalizing your membership</h1>
          <p className="text-gray-600 text-sm">
            This is taking longer than expected. Your checkout may still be processing.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => router.push("/post-sign-in")}
              className="rounded-md bg-black text-white px-6 py-3 font-semibold hover:bg-gray-900 transition"
            >
              Continue to account
            </button>
            <button
              onClick={() => {
                setClerkTimedOut(false);
                setConfirmTimedOut(false);
                setError(null);
                setAttempt((v) => v + 1);
              }}
              className="rounded-md border border-black text-black px-6 py-3 font-semibold hover:bg-gray-100 transition"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Almost there</h1>

          <p className="text-gray-600 text-sm">
            We couldn&apos;t automatically confirm your membership.
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
      <div className="max-w-lg w-full text-center">
        <p className="text-base text-gray-600">
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