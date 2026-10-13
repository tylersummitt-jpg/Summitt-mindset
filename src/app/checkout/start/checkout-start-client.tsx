"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { checkoutPlanFromUnknown } from "@/lib/checkout-plan";

const CHECKOUT_TIMEOUT_MS = 15000;
export const CHECKOUT_CLERK_WAIT_MS = 4000;
const CHECKOUT_START_LOCK = "sm_checkout_start_lock";
const CHECKOUT_START_LOCK_MS = 15000;

function claimCheckoutStart(): boolean {
  try {
    const now = Date.now();
    const heldUntil = Number(localStorage.getItem(CHECKOUT_START_LOCK) || 0);
    if (heldUntil > now) return false;
    localStorage.setItem(CHECKOUT_START_LOCK, String(now + CHECKOUT_START_LOCK_MS));
    return true;
  } catch {
    return true;
  }
}

function releaseCheckoutStart(): void {
  try {
    localStorage.removeItem(CHECKOUT_START_LOCK);
  } catch {
    // A private browser can refuse storage. One start still proceeds.
  }
}

export default function CheckoutStartClient({
  plan,
}: {
  plan?: string;
}) {
  const checkoutPlan = checkoutPlanFromUnknown(plan);
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (startedRef.current) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);
    let clerkWait: number | undefined;

    async function readBody(res: Response): Promise<{ error?: string; action?: string; message?: string; url?: string }> {
      return res.json().catch(() => ({}));
    }

    async function start(signedIn: boolean) {
      if (startedRef.current) return;
      if (!claimCheckoutStart()) {
        setError("Checkout is already opening. Wait a moment and try again.");
        return;
      }
      startedRef.current = true;
      try {
        let res = await fetch(
          signedIn
            ? "/api/stripe/create-checkout-session"
            : "/api/checkout/stripe-first/start",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ plan: checkoutPlan }),
            signal: controller.signal,
          }
        );
        if (!signedIn && res.status === 409) {
          const first = await readBody(res);
          if (first.error === "signed_in") {
            res = await fetch("/api/stripe/create-checkout-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ plan: checkoutPlan }),
              signal: controller.signal,
            });
          }
        }

        if (!res.ok) {
          if (res.status === 409) {
            const body = await readBody(res);
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
          setError("We couldn’t start checkout right now. Please try again.");
          return;
        }

        const data = await readBody(res);
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
        releaseCheckoutStart();
      }
    }

    if (isLoaded) {
      void start(Boolean(isSignedIn));
    } else {
      clerkWait = window.setTimeout(() => {
        void start(false);
      }, CHECKOUT_CLERK_WAIT_MS);
    }

    return () => {
      clearTimeout(timeoutId);
      if (clerkWait !== undefined) window.clearTimeout(clerkWait);
    };
  }, [checkoutPlan, isLoaded, isSignedIn, router, retryNonce]);

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
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand)]">
              STEP 2 OF 3
            </p>
            <h1 className="text-xl font-semibold text-[var(--text)]">
              Start your free trial
            </h1>
            <p className="text-sm font-medium text-[var(--text)]">
              Opening secure checkout…
            </p>
            <p className="text-sm text-[var(--muted)]">
              $0 due today.
              After checkout, you&apos;ll set up Coach Pat.
            </p>
            {checkoutPlan === "annual" ? (
              <p className="text-sm text-[var(--muted)]">
                $249/year after your 7-day free trial.
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
