"use client";

import { ReactNode, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type SubscriptionGateProps = {
  children: ReactNode;
  redirectAfterSubscribe?: string;
};

export function SubscriptionGate({
  children,
  redirectAfterSubscribe = "/dashboard",
}: SubscriptionGateProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromParam = searchParams?.get("from");

  // --- AUTH REDIRECT ---
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      const currentPath = window.location.pathname;
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
        <p>Redirecting to sign in…</p>
      </main>
    );
  }

  /**
   * 🔑 CRITICAL FIX
   *
   * - Clerk metadata can lag on first client render
   * - Treat `true` OR `"true"` as subscribed
   * - Allow trialing users
   */
  const subscribedRaw = user?.publicMetadata?.summittSubscribed;
  const plan = user?.publicMetadata?.summittPlan as string | undefined;

  const isSubscribed =
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual";

  // --- SAFETY: brief grace window while metadata hydrates ---
  if (subscribedRaw === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Finalizing your membership…</p>
      </main>
    );
  }

  // --- NOT SUBSCRIBED ---
  if (!isSubscribed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="max-w-lg w-full space-y-6 text-center">
          <h1 className="text-3xl font-semibold">Membership required</h1>
          <p className="text-sm text-gray-600">
            This part of Summitt Mindset is for active members only.
            Start your 7-day free trial to unlock full access.
          </p>

          <button
            onClick={() => {
              const target = `/subscribe${
                fromParam ? `?from=${encodeURIComponent(fromParam)}` : ""
              }`;
              router.push(target);
            }}
            className="inline-flex items-center justify-center rounded-md border border-black px-6 py-3 text-sm font-semibold hover:bg-black hover:text-white transition"
          >
            Join Summitt Mindset
          </button>

          <p className="text-xs text-gray-500">
            You can cancel anytime during your trial. After that, your
            membership continues automatically unless you cancel.
          </p>
        </div>
      </main>
    );
  }

  // --- SUBSCRIBED ---
  return <>{children}</>;
}
