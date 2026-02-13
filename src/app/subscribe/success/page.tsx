"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

function isSubscribedFromMetadata(md: Record<string, any>) {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;

  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

function SubscribeSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, user } = useUser();

  const [seconds, setSeconds] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((s) => (s <= 1 ? 1 : s - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function run() {
      if (isLoaded && !isSignedIn) {
        router.push("/sign-in?redirect_url=/subscribe/success");
        return;
      }

      if (!isLoaded || !isSignedIn || !user) return;

      if (!sessionId) {
        console.warn("Missing session_id on subscribe success page");
      }

      try {
        await new Promise((r) => setTimeout(r, 1500));
        await user.reload();

        let md = (user.publicMetadata || {}) as Record<string, any>;
        let isSubscribed = isSubscribedFromMetadata(md);

        if (!isSubscribed) {
          await new Promise((r) => setTimeout(r, 2500));
          await user.reload();

          md = (user.publicMetadata || {}) as Record<string, any>;
          isSubscribed = isSubscribedFromMetadata(md);

          if (!isSubscribed) {
            router.push("/subscribe?canceled=0");
            return;
          }
        }

        // Canonical redirect truth
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
            Something went wrong finalizing your membership.
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
          Finalizing your membership and preparing today.
        </p>

        <p className="text-sm text-gray-500">Taking you in… ({seconds})</p>
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
