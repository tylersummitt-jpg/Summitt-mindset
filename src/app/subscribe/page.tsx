"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type Plan = "monthly" | "annual";

export default function SubscribePage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState<boolean>(false);

  // Check if user canceled checkout
  useEffect(() => {
    if (searchParams.get("canceled") === "1") {
      setCanceled(true);
    }
  }, [searchParams]);

  // Redirect to sign-in if not logged in
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push("/sign-in?redirect_url=/subscribe");
    }
  }, [isLoaded, isSignedIn, router]);

  async function handleCheckout(plan: Plan) {
    try {
      setError(null);
      setCanceled(false);
      setLoadingPlan(plan);

      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, userId: user?.id }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn("Checkout failed:", res.status, text);
        setError(text || "Failed to start checkout. Please try again in a minute.");
        setLoadingPlan(null);
        return;
      }

      const data = await res.json();

      if (!data.url) {
        throw new Error("No checkout URL returned");
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
      setLoadingPlan(null);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-6 text-center">

        <h1 className="text-3xl font-semibold">Join Summitt Mindset</h1>
        <p className="text-sm text-gray-600">
          Start your 7-day free trial. Cancel anytime.
        </p>

        {/* Canceled checkout notice */}
        {canceled && (
          <p className="text-sm text-red-600">
            Looks like you canceled checkout — no worries, you can try again anytime.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          {/* MONTHLY PLAN */}
          <button
            onClick={() => handleCheckout("monthly")}
            disabled={!!loadingPlan}
            className="border rounded-lg px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-60"
          >
            <div className="font-medium flex items-baseline justify-between">
              <span>Monthly</span>
              <span className="text-xl">$25</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Billed monthly after your 7-day free trial.
            </p>
          </button>

          {/* ANNUAL PLAN */}
          <button
            onClick={() => handleCheckout("annual")}
            disabled={!!loadingPlan}
            className="border rounded-lg px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-60"
          >
            <div className="font-medium flex items-baseline justify-between">
              <span>Annual</span>
              <span className="text-xl">$120</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Best value — save over 60% vs monthly.
            </p>
          </button>
        </div>

        {loadingPlan && (
          <p className="text-sm text-gray-700">
            Redirecting to secure checkout…
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <p className="text-xs text-gray-500 mt-4">
          7-day free trial. 14-day results-based guarantee.
        </p>

      </div>
    </main>
  );
}
