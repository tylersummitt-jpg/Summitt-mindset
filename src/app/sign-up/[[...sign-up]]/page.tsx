"use client";

import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import {
  sanitizeInternalRedirectUrl,
  sanitizeSubscribeRedirectUrl,
} from "@/lib/safe-redirect";

function isCoachSubscribeSanitizedUrl(safeSubscribeUrl: string | null): boolean {
  if (!safeSubscribeUrl || !safeSubscribeUrl.startsWith("/subscribe")) {
    return false;
  }
  try {
    const u = new URL(safeSubscribeUrl, "http://local.invalid");
    return u.searchParams.get("src") === "coach";
  } catch {
    return false;
  }
}

/**
 * ======================================================
 * Sign Up Page (CANONICAL)
 * ======================================================
 *
 * Anyone who signs up MUST go to onboarding.
 *
 * We do NOT send them to /dashboard.
 * That would cause:
 * - broken metadata
 * - missing goal
 * - retention loss
 *
 * Optional ?redirect_url= — same sanitization as sign-in (safe internal paths only).
 */

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams?.get("redirect_url");

  const safeSubscribeDestination = sanitizeSubscribeRedirectUrl(redirectUrl);
  const isCoachSignUp = isCoachSubscribeSanitizedUrl(safeSubscribeDestination);

  const safeAfterSignInUrl =
    sanitizeInternalRedirectUrl(redirectUrl) ?? "/post-sign-in";
  const safeAfterSignUpUrl =
    safeSubscribeDestination ?? "/onboarding";

  const signUp = (
    <SignUp
      afterSignInUrl={safeAfterSignInUrl}
      afterSignUpUrl={safeAfterSignUpUrl}
    />
  );

  return (
    <AuthMarketingShell authPage="sign-up">
      {isCoachSignUp ? (
        <div className="mx-auto w-full max-w-[min(100%,24rem)] sm:max-w-[25rem]">
          <div className="mb-6 w-full rounded-xl border border-white/[0.08] bg-black/75 px-3.5 py-3.5 text-white sm:px-4 sm:py-4">
            <ol
              className="grid list-none gap-2.5 pt-0.5 sm:gap-3"
              aria-label="Coach signup steps"
            >
              <li className="flex gap-3 text-left" aria-current="step">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold tabular-nums text-white shadow-sm shadow-orange-900/25"
                  aria-hidden
                >
                  1
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-white sm:text-[15px]">
                  Create your account
                </span>
              </li>
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800/90 text-sm font-semibold tabular-nums text-white/90 ring-1 ring-inset ring-white/10"
                  aria-hidden
                >
                  2
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-white/95 sm:text-[15px]">
                  Start your membership
                </span>
              </li>
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800/90 text-sm font-semibold tabular-nums text-white/90 ring-1 ring-inset ring-white/10"
                  aria-hidden
                >
                  3
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-white/95 sm:text-[15px]">
                  Complete onboarding
                </span>
              </li>
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800/90 text-sm font-semibold tabular-nums text-white/90 ring-1 ring-inset ring-white/10"
                  aria-hidden
                >
                  4
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-white/95 sm:text-[15px]">
                  We reach out to ship your Leadership Kit
                </span>
              </li>
            </ol>
          </div>
          {signUp}
        </div>
      ) : (
        signUp
      )}
    </AuthMarketingShell>
  );
}
