"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type Plan = "monthly" | "annual";

/**
 * ======================================================
 * Subscribe Page — Twilio-Compliant Public Version
 * ======================================================
 *
 * IMPORTANT:
 * - Page must render publicly (no forced login)
 * - Login only required at checkout
 * - Stripe session still requires auth
 */

function SubscribePageInner() {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);

  // --------------------------------------------------
  // Handle Stripe cancel return
  // --------------------------------------------------
  useEffect(() => {
    if (searchParams.get("canceled") === "1") {
      setCanceled(true);
    }
  }, [searchParams]);

  // --------------------------------------------------
  // Checkout handler
  // --------------------------------------------------
  async function handleCheckout(plan: Plan) {
    try {
      setError(null);
      setCanceled(false);
      setLoadingPlan(plan);

      // If not signed in → send to login first
      if (!isSignedIn) {
        router.push("/sign-in?redirect_url=/subscribe");
        return;
      }

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

  // --------------------------------------------------
  // PUBLIC PAGE RENDER (always visible)
  // --------------------------------------------------
  return (
    <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-20">
      <div className="max-w-xl w-full">
        {/* ======================================================
            Header
           ====================================================== */}
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">
            Founding Member Launch
          </p>

          <h1 className="text-3xl md:text-4xl font-semibold mb-3">
            Start your daily practice.
          </h1>

          <p className="text-[var(--muted)] text-lg">
            Summitt Mindset is a paid membership offering a short daily
            practice (3–7 minutes), journaling, and optional SMS coaching
            inspired by Coach Pat Summitt.
          </p>

          <p className="text-[var(--muted)] text-lg mt-4">
            7-day free trial. <strong>You won’t be charged today.</strong>
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
          <p>Cancel anytime. Secure checkout via Stripe.</p>
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
