"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type Plan = "monthly" | "annual";

function SubscribePageInner() {
  const { isLoaded, isSignedIn } = useUser();
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
        credentials: "include",
        body: JSON.stringify({ plan }),
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
    <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-20">
      <div className="max-w-xl w-full">
        {/* ======================================================
            Header
           ====================================================== */}
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">
            Be part of the Founding Member Launch
          </p>

          <h1 className="text-3xl md:text-4xl font-semibold mb-3">
            Start your daily practice.
          </h1>

          <p className="text-[var(--muted)] text-lg">
            7-day free trial. <strong>You won’t be charged today.</strong>
            <br />
            Lock in our lowest price: <strong>$19.99/month</strong> (as long as
            your membership stays active).
            <br />
            Help shape the future of Summitt Mindset.
          </p>
        </div>

        {/* ======================================================
            Pricing Cards
           ====================================================== */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {/* Monthly */}
          <button
            onClick={() => handleCheckout("monthly")}
            disabled={!!loadingPlan}
            className="relative border-2 border-[var(--brand)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition"
          >
            <p className="text-sm font-semibold mb-1">
              Founding Member Monthly
            </p>

            <p className="text-2xl font-bold mb-2">$19.99</p>

            <p className="text-sm text-[var(--muted)]">
              Lowest price locked in.
            </p>

            {loadingPlan === "monthly" && (
              <p className="absolute top-4 right-4 text-xs text-[var(--muted)]">
                Redirecting…
              </p>
            )}
          </button>

          {/* Annual */}
          <button
            onClick={() => handleCheckout("annual")}
            disabled={!!loadingPlan}
            className="relative border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition"
          >
            <p className="text-sm font-semibold mb-1">
              Founding Member Annual
            </p>

            <p className="text-2xl font-bold mb-2">$120</p>

            <p className="text-sm text-[var(--muted)]">
              Save 50% vs. monthly.
            </p>

            {loadingPlan === "annual" && (
              <p className="absolute top-4 right-4 text-xs text-[var(--muted)]">
                Redirecting…
              </p>
            )}
          </button>
        </div>

        {/* ======================================================
            Status / Errors
           ====================================================== */}
        {canceled && (
          <p className="text-sm text-red-600 text-center mb-4">
            Looks like you canceled checkout — no worries.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 text-center mb-4">{error}</p>
        )}

        {/* ======================================================
            Trust + Reassurance
           ====================================================== */}
        <div className="text-center text-sm text-[var(--muted)] space-y-2">
          <p>7-day free trial. You won’t be charged today. Cancel anytime.</p>
          <p>
            “Successful people are simply those with successful habits.”
            <span className="ml-2">— Pat Summitt</span>
          </p>
        </div>
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
