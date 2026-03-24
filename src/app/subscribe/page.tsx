"use client";

export const dynamic = "force-dynamic";

import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import { getPageImage } from "@/data/page-images";
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
  const image =
    getPageImage("/subscribe") ?? {
      src: "/brand/subscribe-celebration.jpg",
      alt: "Coach Pat Summitt celebrating with confetti",
    };

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          Section 1 — Hero
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-16 grid gap-10 md:grid-cols-2 items-center">
        <div className="text-center md:text-left">
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-4">
            Start Your Daily Practice
          </h1>
        <p className="text-lg text-[var(--muted)] mb-4">
          Summitt Mindset helps you apply Coach Pat’s leadership standards one
          day at a time.
        </p>
        <p className="text-[var(--text)]">
          One short daily practice. One honest reflection. Real consistency over
          time.
        </p>
        </div>
        <div className="relative w-full h-[300px] rounded-2xl overflow-hidden">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover object-top"
          />
        </div>
      </section>

      {/* --------------------------------------------------
          Section 4 — Pricing (existing)
          -------------------------------------------------- */}
      <section className="flex items-center justify-center px-4 py-20">
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
      </section>

      {/* --------------------------------------------------
          Section 2 — What You Get
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 pt-6 pb-16">
        <h2 className="text-2xl font-bold text-[var(--text)] text-center mb-12">
          Your Membership Includes
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Daily Practice
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              A short leadership practice each day with a reflection prompt.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Ask Pat
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Ask leadership questions and receive guidance inspired by Pat
              Summitt’s philosophy.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Film Room
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Watch leadership lessons from respected voices in sports, media,
              and business.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Section 3 — How It Fits Your Life
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-6">
          Built for real life.
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Most daily practices take just a few minutes.
        </p>
        <p className="text-[var(--text)] leading-relaxed mt-4">
          Some members use the app. Others receive their daily practice by text
          message.
        </p>
        <p className="text-[var(--text)] leading-relaxed mt-4">
          The goal is simple: show up every day.
        </p>
      </section>
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
