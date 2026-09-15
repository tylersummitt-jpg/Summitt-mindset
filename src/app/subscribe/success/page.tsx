"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";

const CLERK_READY_TIMEOUT_MS = 15000;
const CONFIRM_TIMEOUT_MS = 15000;

function successReturnCandidate(sessionId: string | null): string {
  if (!sessionId) return "/subscribe/success";
  return `/subscribe/success?session_id=${sessionId}`;
}

function SubscribeSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, user } = useUser();

  const [error, setError] = useState<string | null>(null);
  const [authRecovery, setAuthRecovery] = useState(false);
  const [ownershipError, setOwnershipError] = useState(false);
  const [clerkTimedOut, setClerkTimedOut] = useState(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const confirmStartedForSession = useRef<string | null>(null);

  const sessionId = searchParams.get("session_id");
  const signInHref = signInUrlPreservingInternalRedirect(
    successReturnCandidate(sessionId)
  );

  useEffect(() => {
    console.info("[subscribe/success] mounted");
  }, []);

  useEffect(() => {
    if (isLoaded) {
      setClerkTimedOut(false);
      return;
    }
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

      if (!isLoaded) return;

      if (!isSignedIn) {
        return;
      }

      if (!user) return;

      try {
        if (!sessionId) {
          const runId = `missing:${attempt}`;
          if (confirmStartedForSession.current === runId) {
            return;
          }
          confirmStartedForSession.current = runId;
          router.push("/post-sign-in");
          return;
        }

        const runId = `${sessionId}:${attempt}`;
        if (confirmStartedForSession.current === runId) {
          return;
        }
        confirmStartedForSession.current = runId;

        setConfirmTimedOut(false);
        setError(null);
        setAuthRecovery(false);
        setOwnershipError(false);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIRM_TIMEOUT_MS);

        try {
          console.info("[subscribe/success] confirm request started");

          const res = await fetch("/api/stripe/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
            signal: controller.signal,
          });

          if (res.status === 401) {
            setAuthRecovery(true);
            return;
          }

          if (res.status === 403) {
            const text = await res.text();
            setOwnershipError(true);
            setError(text || "Session does not belong to user");
            return;
          }

          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }

          console.info("[subscribe/success] confirm request succeeded");

          await user.reload();

          console.info("[subscribe/success] redirecting to post-sign-in");

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

  function resetAndRetry() {
    setClerkTimedOut(false);
    setConfirmTimedOut(false);
    setError(null);
    setAuthRecovery(false);
    setOwnershipError(false);
    setAttempt((v) => v + 1);
  }

  const signInCta = (
    <a
      href={signInHref}
      className="rounded-md bg-black text-white px-6 py-3 font-semibold hover:bg-gray-900 transition inline-block"
    >
      Sign In to Finish Setup
    </a>
  );

  const tryAgainButton = (
    <button
      onClick={resetAndRetry}
      className="rounded-md border border-black text-black px-6 py-3 font-semibold hover:bg-gray-100 transition"
    >
      Try again
    </button>
  );

  const signedInContinueButton = (
    <button
      onClick={() => router.push("/post-sign-in")}
      className="rounded-md bg-black text-white px-6 py-3 font-semibold hover:bg-gray-900 transition"
    >
      Set Up Coach Pat →
    </button>
  );

  if (!isLoaded && !clerkTimedOut) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Loading…</p>
      </main>
    );
  }

  if (clerkTimedOut && !isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Still starting your trial</h1>
          <p className="text-gray-600 text-sm">
            This is taking longer than expected. Your checkout may still be processing.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {tryAgainButton}
            {signInCta}
          </div>
        </div>
      </main>
    );
  }

  if (ownershipError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">We couldn&apos;t confirm this checkout</h1>
          <p className="text-gray-600 text-sm">
            This checkout does not belong to the signed-in account.
          </p>
          {error ? <p className="text-red-600 text-sm">{error}</p> : null}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {signInCta}
          </div>
        </div>
      </main>
    );
  }

  if (authRecovery || (isLoaded && !isSignedIn)) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Your trial is started.</h1>
          <p className="text-gray-600 text-sm">
            Sign in to finish setting up Coach Pat.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {signInCta}
          </div>
        </div>
      </main>
    );
  }

  if (confirmTimedOut) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Still starting your trial</h1>
          <p className="text-gray-600 text-sm">
            This is taking longer than expected. Your checkout may still be processing.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {tryAgainButton}
            {isSignedIn ? signedInContinueButton : signInCta}
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">Your trial is started. Next: set up Coach Pat.</h1>

          <p className="text-gray-600 text-sm">
            We couldn&apos;t automatically confirm your membership.
          </p>

          <p className="text-red-600 text-sm">{error}</p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {tryAgainButton}
            {isSignedIn ? signedInContinueButton : signInCta}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <p className="text-base text-gray-600">
          Starting your free trial…
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
