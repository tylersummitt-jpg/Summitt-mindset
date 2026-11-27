"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  newOnboardingAttemptId,
  reportOnboardingClient,
} from "@/lib/onboarding-journey-diagnostics-client";
import type { OnboardingDiagnosticStep } from "@/lib/onboarding-journey-diagnostics";

const SIGN_IN_HREF = `/sign-in?redirect_url=${encodeURIComponent("/onboarding")}`;

function stepFromPath(path: string): OnboardingDiagnosticStep | null {
  if (path.startsWith("/onboarding/commitment")) return "goal";
  if (path.startsWith("/onboarding/sms")) return "texts";
  if (path.startsWith("/onboarding/complete")) return "complete";
  if (path.startsWith("/onboarding/identity")) return "identity";
  return null;
}

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[onboarding/error]", {
      digest: error.digest,
      name: error.name,
      message: error.message,
    });
    const step = stepFromPath(pathname);
    if (!step) return;
    reportOnboardingClient({
      step,
      outcome: "client_error",
      errorCode: "render_failed",
      attemptId: newOnboardingAttemptId(),
    });
  }, [error, pathname]);

  return (
    <div className="text-center space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          We couldn&apos;t load this setup step.
        </h1>
        <p className="text-base text-gray-600 leading-relaxed max-w-md mx-auto">
          Your account is okay. Please try again. If it keeps happening, sign in again and come right
          back to setup.
        </p>
      </header>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md mx-auto">
        <button
          type="button"
          onClick={() => reset()}
          className="px-6 py-3 rounded-lg font-semibold text-white bg-[var(--brand)] hover:opacity-90 transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2"
        >
          Try again
        </button>
        <a
          href={SIGN_IN_HREF}
          className="px-6 py-3 rounded-lg font-semibold text-center border-2 border-gray-300 text-gray-800 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2"
        >
          Sign in again
        </a>
      </div>

      <p className="text-sm text-gray-500">
        <a href="/onboarding" className="text-[var(--brand)] font-medium underline underline-offset-2">
          Back to onboarding start
        </a>
      </p>
    </div>
  );
}
