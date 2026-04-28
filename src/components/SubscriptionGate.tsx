"use client";

import { ReactNode, useEffect, Suspense, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type SubscriptionGateProps = {
  children: ReactNode;
  redirectAfterSubscribe?: string;
};

function SubscriptionGateInner({
  children,
  redirectAfterSubscribe = "/dashboard",
}: SubscriptionGateProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromParam = searchParams?.get("from");

  // ✅ hydration grace timer
  const [graceExpired, setGraceExpired] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setGraceExpired(true);
    }, 6000); // ✅ 6 seconds max grace window

    return () => clearTimeout(timer);
  }, []);

  // --- AUTH REDIRECT ---
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      const currentPath = window.location.pathname;

      /**
       * ======================================================
       * IMPORTANT
       * ======================================================
       *
       * We pass redirect_url so that if a user tries to access:
       * /ask-pat
       * /film-room
       * etc.
       *
       * They return to that page after signing in.
       *
       * If no redirect_url is present, /post-sign-in will
       * send them to Today by default.
       */
      router.push(`/sign-in?redirect_url=${encodeURIComponent(currentPath)}`);
    }
  }, [isLoaded, isSignedIn, router]);

  // --- LOADING STATE ---
  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Loading…</p>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Redirecting…</p>
      </main>
    );
  }

  // ✅ Subscription truth
  const subscribedRaw = user?.publicMetadata?.summittSubscribed;
  const plan = user?.publicMetadata?.summittPlan as string | undefined;

  const isSubscribed =
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual";

  /**
   * ======================================================
   * Grace window while webhook updates Clerk
   * ======================================================
   *
   * Sometimes summittSubscribed arrives first.
   * Sometimes summittPlan arrives first.
   *
   * We only show the grace screen if BOTH are missing.
   */
  const waitingForWebhook =
    subscribedRaw === undefined && (plan === undefined || plan === null);

  if (waitingForWebhook && !graceExpired) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Finalizing your membership…</p>
      </main>
    );
  }

  // --- NOT SUBSCRIBED ---
  if (!isSubscribed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="max-w-lg w-full space-y-6 text-center">
          <h1 className="text-3xl font-semibold">Membership required</h1>

          <p className="text-sm text-gray-600">
            This part of Summitt Mindset is for active members only.
          </p>

          <button
            onClick={() => {
              const target = `/subscribe${
                fromParam ? `?from=${encodeURIComponent(fromParam)}` : ""
              }`;
              router.push(target);
            }}
            className="rounded-md bg-[var(--brand)] px-6 py-3 font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
          >
            Start Free Trial →
          </button>

          <p className="text-xs text-gray-500">
            Cancel anytime during your first 7 days.
          </p>
        </div>
      </main>
    );
  }

  // ✅ SUBSCRIBED
  return <>{children}</>;
}

export function SubscriptionGate(props: SubscriptionGateProps) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p>Loading…</p>
        </main>
      }
    >
      <SubscriptionGateInner {...props} />
    </Suspense>
  );
}
