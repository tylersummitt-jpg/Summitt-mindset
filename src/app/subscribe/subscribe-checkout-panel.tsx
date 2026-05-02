"use client";

import { useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { trackCoachInitiateCheckout } from "@/lib/meta-pixel";

type Plan = "monthly" | "annual";

const CHECKOUT_TIMEOUT_MS = 15000;

export default function SubscribeCheckoutPanel() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const srcParam = searchParams.get("src");
  const canceled = searchParams.get("canceled") === "1";
  const isCoachSrc = srcParam === "coach";
  const subscribeReturnPath = isCoachSrc ? "/subscribe?src=coach" : "/subscribe";

  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initiateCheckoutFiredForAttemptRef = useRef(false);

  const disabled = useMemo(() => loadingPlan !== null, [loadingPlan]);

  async function handleCheckout(plan: Plan) {
    console.info("[subscribe] plan clicked", { plan });
    setError(null);
    initiateCheckoutFiredForAttemptRef.current = false;
    setLoadingPlan(plan);

    if (!isSignedIn) {
      console.info("[subscribe] user not signed in; redirecting to sign-in");
      setLoadingPlan(null);
      router.push(
        `/sign-in?redirect_url=${encodeURIComponent(subscribeReturnPath)}`
      );
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

    try {
      console.info("[subscribe] checkout fetch started", { plan });

      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isCoachSrc ? { plan, src: "coach" as const } : { plan }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        console.warn("[subscribe] checkout fetch failed", {
          plan,
          status: res.status,
        });

        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          const msg =
            typeof body?.message === "string"
              ? body.message
              : "You already have an active Summitt Mindset membership.";
          setError(msg);
        } else {
          const text = await res.text().catch(() => "");
          setError(
            text || "We couldn’t start checkout right now. Please try again."
          );
        }
        setLoadingPlan(null);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (typeof data?.url !== "string" || !data.url) {
        console.warn("[subscribe] checkout response missing url", { plan });
        setError("We couldn’t start checkout right now. Please try again.");
        setLoadingPlan(null);
        return;
      }

      console.info("[subscribe] checkout fetch succeeded; redirecting to Stripe", {
        plan,
      });
      if (
        isCoachSrc &&
        !initiateCheckoutFiredForAttemptRef.current
      ) {
        initiateCheckoutFiredForAttemptRef.current = true;
        trackCoachInitiateCheckout(plan);
      }
      window.location.href = data.url;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn("[subscribe] checkout fetch timed out", { plan });
        setError(
          "This is taking longer than expected. Please check your connection and try again."
        );
      } else {
        console.warn("[subscribe] checkout fetch threw", { plan });
        setError("We couldn’t start checkout right now. Please try again.");
      }
      setLoadingPlan(null);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto md:mx-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 w-full">
        <button
          onClick={() => handleCheckout("monthly")}
          disabled={disabled}
          className="relative w-full cursor-pointer border-2 border-[var(--brand)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition disabled:cursor-wait disabled:opacity-70"
        >
          <p className="text-sm font-semibold mb-1">Founding Member Monthly</p>
          <p className="text-2xl font-bold mb-2">$19.99</p>
          <p className="text-sm text-[var(--muted)]">Lowest price locked in.</p>
          {loadingPlan === "monthly" && (
            <p className="absolute top-4 right-4 text-xs text-[var(--muted)]">
              Redirecting…
            </p>
          )}
        </button>

        <button
          onClick={() => handleCheckout("annual")}
          disabled={disabled}
          className="relative w-full cursor-pointer border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface)] text-left hover:bg-[var(--brand-soft)] transition disabled:cursor-wait disabled:opacity-70"
        >
          <p className="text-sm font-semibold mb-1">Founding Member Annual</p>
          <p className="text-2xl font-bold mb-2">$120</p>
          <p className="text-sm text-[var(--muted)]">Save 50% vs. monthly.</p>
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
  );
}
