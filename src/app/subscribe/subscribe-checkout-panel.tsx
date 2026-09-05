"use client";

import { useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { trackCoachInitiateCheckout } from "@/lib/meta-pixel";
import ResumeMembershipButton from "@/components/resume-membership-button";

type Plan = "monthly" | "annual";

const CHECKOUT_TIMEOUT_MS = 15000;

export default function SubscribeCheckoutPanel() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const srcParam = searchParams.get("src");
  const canceled = searchParams.get("canceled") === "1";
  const coachFromMeta =
    user?.publicMetadata &&
    typeof user.publicMetadata === "object" &&
    (user.publicMetadata as Record<string, unknown>).acquisitionSource ===
      "coach";
  const isCoachExperience =
    srcParam === "coach" || coachFromMeta === true;
  const subscribeReturnPath = isCoachExperience
    ? "/subscribe?src=coach"
    : "/subscribe";

  const md =
    user?.publicMetadata && typeof user.publicMetadata === "object"
      ? (user.publicMetadata as Record<string, unknown>)
      : null;
  const pausedFromClerk = md?.summittPlan === "paused";

  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forcePausedUi, setForcePausedUi] = useState(false);
  const initiateCheckoutFiredForAttemptRef = useRef(false);

  const showPausedResume = Boolean(isSignedIn && (pausedFromClerk || forcePausedUi));
  const disabled = useMemo(
    () => !isLoaded || loadingPlan !== null,
    [isLoaded, loadingPlan]
  );

  async function handleCheckout(plan: Plan) {
    if (!isLoaded) {
      return;
    }

    console.info("[subscribe] plan clicked", { plan });
    setError(null);
    initiateCheckoutFiredForAttemptRef.current = false;
    setLoadingPlan(plan);

    if (!isSignedIn) {
      console.info(
        "[subscribe] user not signed in; redirecting to auth with return path"
      );
      setLoadingPlan(null);
      const authHref = `/sign-up?redirect_url=${encodeURIComponent(subscribeReturnPath)}`;
      router.push(authHref);
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
        body: JSON.stringify(
          isCoachExperience ? { plan, src: "coach" as const } : { plan }
        ),
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
          if (body?.error === "membership_paused" || body?.action === "resume") {
            setForcePausedUi(true);
            setError(null);
            setLoadingPlan(null);
            return;
          }
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
        isCoachExperience &&
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

  if (showPausedResume) {
    return (
      <div className="w-full max-w-lg mx-auto md:mx-0 space-y-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-3 text-left">
          <p className="text-lg font-semibold text-[var(--text)]">
            Your membership is paused.
          </p>
          <p className="text-sm text-[var(--muted)]">
            Resume your existing membership to continue on the same plan.
          </p>
          <ResumeMembershipButton variant="subscribe" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto md:mx-0" data-growth-ignore="checkout">
      {isCoachExperience ? (
        <div className="mb-5 text-left">
          <ol
            className="grid list-none gap-2.5 pt-0.5 sm:gap-3"
            aria-label="Coach subscribe steps"
          >
            <li className="flex gap-3 text-left">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-neutral-100 text-sm font-semibold tabular-nums text-neutral-600"
                aria-hidden
              >
                1
              </span>
              <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-[var(--text)] sm:text-[15px]">
                Create your account
              </span>
            </li>
            <li className="flex gap-3 text-left" aria-current="step">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold tabular-nums text-white shadow-sm shadow-orange-500/20"
                aria-hidden
              >
                2
              </span>
              <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-[var(--text)] sm:text-[15px]">
                Start your membership
              </span>
            </li>
            <li className="flex gap-3 text-left">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-neutral-100 text-sm font-semibold tabular-nums text-neutral-600"
                aria-hidden
              >
                3
              </span>
              <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-[var(--text)] sm:text-[15px]">
                Complete onboarding
              </span>
            </li>
            <li className="flex gap-3 text-left">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-neutral-100 text-sm font-semibold tabular-nums text-neutral-600"
                aria-hidden
              >
                4
              </span>
              <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-[var(--text)] sm:text-[15px]">
                We reach out to ship your Leadership Kit
              </span>
            </li>
          </ol>
        </div>
      ) : null}

      <div className="space-y-4">
        <div
          className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--surface)] p-5 text-left sm:p-6"
          data-subscribe-offer="monthly-primary"
        >
          <p className="text-2xl font-bold tracking-tight text-[var(--text)]">
            $29/month
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--text)]">
            7 days free · then $29/month
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">Cancel anytime</p>
          <button
            type="button"
            onClick={() => handleCheckout("monthly")}
            disabled={disabled}
            className="mt-4 w-full cursor-pointer rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white shadow-md shadow-orange-500/20 transition hover:opacity-95 disabled:cursor-wait disabled:opacity-70"
          >
            {loadingPlan === "monthly"
              ? "Opening secure checkout…"
              : "Continue to Secure Checkout"}
          </button>
        </div>

        <p className="text-sm leading-snug text-[var(--muted)]">
          Secure checkout powered by Stripe. You won&apos;t be charged today.
        </p>

        <blockquote className="border-t border-[var(--border)] pt-4 text-left">
          <p className="text-sm leading-relaxed text-[var(--text)]">
            &ldquo;Talking with &lsquo;Coach Pat&rsquo; through Summitt Mindset
            feels like having Pat Summitt sitting on my shoulder.&rdquo;
          </p>
          <footer className="mt-2 text-sm font-medium text-[var(--muted)]">
            — Kathy P., Oregon
          </footer>
        </blockquote>

        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3"
          data-subscribe-offer="annual-secondary"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--muted)]">
              Prefer annual?
            </p>
            <p className="text-sm font-semibold text-[var(--text)]">
              $249/year
            </p>
            <p className="text-xs text-[var(--muted)]">Save $99 vs monthly</p>
          </div>
          <button
            type="button"
            onClick={() => handleCheckout("annual")}
            disabled={disabled}
            className="shrink-0 cursor-pointer rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--brand-soft)] disabled:cursor-wait disabled:opacity-70"
          >
            {loadingPlan === "annual"
              ? "Opening secure checkout…"
              : "Choose annual"}
          </button>
        </div>
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
