"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type Plan = "monthly" | "annual";

function SubscribePageInner() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    if (searchParams.get("canceled") === "1") {
      setCanceled(true);
    }
  }, [searchParams]);

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
        setError(await res.text());
        setLoadingPlan(null);
        return;
      }

      const data = await res.json();
      if (!data.url) throw new Error("No checkout URL returned");

      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
      setLoadingPlan(null);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-6 text-center">
        <h1 className="text-3xl font-semibold">Join Summitt Mindset</h1>

        {canceled && (
          <p className="text-sm text-red-600">
            Looks like you canceled checkout — no worries.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <button onClick={() => handleCheckout("monthly")} disabled={!!loadingPlan}>
            Monthly — $25
          </button>
          <button onClick={() => handleCheckout("annual")} disabled={!!loadingPlan}>
            Annual — $120
          </button>
        </div>

        {loadingPlan && <p>Redirecting to checkout…</p>}
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </main>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<p className="text-center mt-20">Loading…</p>}>
      <SubscribePageInner />
    </Suspense>
  );
}
