"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

const CHECKOUT_TIMEOUT_MS = 15000;
const SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`;

export default function CheckoutStartClient() {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace(SIGN_UP_HREF);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await fetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ plan: "monthly" }),
          signal: controller.signal,
        });

        if (!res.ok) {
          if (res.status === 409) {
            const body = await res.json().catch(() => ({}));
            const code = typeof body?.error === "string" ? body.error : "";
            if (code === "already_subscribed") {
              router.replace("/post-sign-in");
              return;
            }
            if (
              code === "membership_paused" ||
              body?.action === "resume" ||
              code === "checkout_pending"
            ) {
              router.replace("/subscribe");
              return;
            }
            if (code === "checkout_processing") {
              setError(
                typeof body?.message === "string" && body.message
                  ? body.message
                  : "Your checkout is still finishing. Please wait a moment and try again."
              );
              return;
            }
            if (code === "checkout_unavailable") {
              setError(
                typeof body?.message === "string" && body.message
                  ? body.message
                  : "Checkout could not be restarted. Please try again in a little while."
              );
              return;
            }
            router.replace("/subscribe");
            return;
          }
          if (res.status === 401) {
            router.replace(SIGN_UP_HREF);
            return;
          }
          setError("We couldn’t start checkout right now. Please try again.");
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (typeof data?.url !== "string" || !data.url) {
          setError("We couldn’t start checkout right now. Please try again.");
          return;
        }
        window.location.assign(data.url);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError(
            "This is taking longer than expected. Please check your connection and try again."
          );
          return;
        }
        setError("We couldn’t start checkout right now. Please try again.");
      } finally {
        clearTimeout(timeoutId);
      }
    })();
  }, [isLoaded, isSignedIn, router, retryNonce]);

  function handleRetry() {
    startedRef.current = false;
    setError(null);
    setRetryNonce((value) => value + 1);
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-md space-y-4 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-[var(--text)]">
              Checkout didn’t start
            </h1>
            <p className="text-sm text-[var(--muted)]">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--text)]">
              Opening secure checkout…
            </h1>
            <p className="text-sm text-[var(--muted)]">
              You’ll add a payment method to start your 7-day free trial. $0 due
              today.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
