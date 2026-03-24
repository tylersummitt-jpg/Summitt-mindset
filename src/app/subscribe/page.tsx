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
      {/* Mobile: hero → trial + cards → trust → image. Desktop: hero | same stack. */}
      <section className="max-w-6xl mx-auto px-4 py-6 md:py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 md:items-center">
          <div className="order-1 text-center md:text-left min-w-0 max-w-md mx-auto md:mx-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-3 md:mb-4">
              Start Your Daily Practice
            </h1>
            <p className="text-lg text-[var(--muted)] mb-3">
              Summitt Mindset helps you apply Coach Pat’s leadership standards one
              day at a time.
            </p>
            <p className="text-[var(--text)]">
              One short daily practice. One honest reflection. Real consistency over
              time.
            </p>
          </div>

          <div className="order-2 flex flex-col gap-4 md:gap-4 w-full min-w-0">
            <div className="w-full max-w-xl mx-auto md:max-w-none md:mx-0">
              <p className="text-sm text-[var(--muted)] text-center md:text-left mb-3">
                7-day free trial. You won’t be charged today.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 w-full">
                <button
                  onClick={() => handleCheckout("monthly")}
                  disabled={!!loadingPlan}
                  className="relative w-full border-2 border-[var(--brand)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition"
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

                <button
                  onClick={() => handleCheckout("annual")}
                  disabled={!!loadingPlan}
                  className="relative w-full border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition"
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

              {canceled && (
                <p className="text-sm text-red-600 text-center md:text-left mt-3">
                  Looks like you canceled checkout — no worries.
                </p>
              )}

              {error && (
                <p className="text-sm text-red-600 text-center md:text-left mt-3 break-words">
                  {error}
                </p>
              )}
            </div>

            <div className="text-center md:text-left text-sm text-[var(--muted)] space-y-2 w-full max-w-xl mx-auto md:max-w-none md:mx-0">
              <p>Cancel anytime. Secure checkout via Stripe.</p>
              <p>
                “Successful people are simply those with successful habits.”
                <span className="ml-2">— Pat Summitt</span>
              </p>
            </div>

            <div className="relative w-full h-[180px] sm:h-[220px] md:h-[220px] rounded-2xl overflow-hidden shrink-0">
              <Image
                src={image.src}
                alt={image.alt}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover object-top"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Section 2 — What You Get
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 pt-2 md:pt-6 pb-16">
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
