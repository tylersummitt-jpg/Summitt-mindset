"use client";

import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachAttributionSync } from "@/components/coach-attribution-sync";
import {
  isCoachSubscribeRedirectUrl,
  sanitizeInternalRedirectUrl,
  sanitizeSubscribeRedirectUrl,
  signInUrlPreservingInternalRedirect,
} from "@/lib/safe-redirect";

/**
 * ======================================================
 * Sign Up Page (CANONICAL)
 * ======================================================
 *
 * After sign-up destination is sanitized from ?redirect_url=:
 * - consumer acquisition → /checkout/start
 * - coach → /subscribe?src=coach
 * - bare /sign-up (no redirect) → /onboarding, then unpaid users
 *   are gated to /subscribe (not an automatic Checkout hop)
 *
 * We do NOT send them to /dashboard.
 *
 * forceRedirectUrl is the Clerk v6 prop that wins over Dashboard/env FORCE.
 */

const websiteSignUpAppearance = {
  layout: {
    showOptionalFields: false,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#f97316",
    colorBackground: "#ffffff",
    colorForeground: "#111827",
    colorMutedForeground: "#6b7280",
    colorInputBackground: "#ffffff",
    colorInputForeground: "#111827",
    colorBorder: "#e5e7eb",
    borderRadius: "0.75rem",
    fontFamily: "inherit",
  },
  elements: {
    card: {
      boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    },
    formButtonPrimary: {
      backgroundColor: "#f97316",
      color: "#ffffff",
      fontWeight: "600",
    },
    formFieldLabel: {
      color: "#111827",
    },
    dividerText: {
      color: "#6b7280",
    },
    headerSubtitle: {
      color: "#6b7280",
      fontSize: "0.8125rem",
    },
    footerActionLink: {
      color: "#f97316",
    },
  },
};

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams?.get("redirect_url");

  const safeSubscribeDestination = sanitizeSubscribeRedirectUrl(redirectUrl);
  const isCoachSignUp = isCoachSubscribeRedirectUrl(redirectUrl);
  const safeCheckoutStartDestination =
    sanitizeInternalRedirectUrl(redirectUrl) === "/checkout/start"
      ? "/checkout/start"
      : null;

  const safeAfterSignInUrl =
    sanitizeInternalRedirectUrl(redirectUrl) ?? "/post-sign-in";
  const safeAfterSignUpUrl =
    safeSubscribeDestination ?? safeCheckoutStartDestination ?? "/onboarding";
  const isAcquisitionSignUp = Boolean(
    safeSubscribeDestination || safeCheckoutStartDestination
  );

  const signUp = (
    <SignUp
      forceRedirectUrl={safeAfterSignUpUrl}
      fallbackRedirectUrl={safeAfterSignUpUrl}
      signInForceRedirectUrl={safeAfterSignInUrl}
      signInFallbackRedirectUrl={safeAfterSignInUrl}
      signInUrl={signInUrlPreservingInternalRedirect(redirectUrl)}
      appearance={websiteSignUpAppearance}
    />
  );

  return (
    <AuthMarketingShell
      authPage="sign-up"
      contentClassName={
        isCoachSignUp ? "w-full max-w-md" : "w-full max-w-md lg:max-w-6xl"
      }
    >
      {isCoachSignUp ? <CoachAttributionSync enabled /> : null}
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
        <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2 lg:items-center lg:gap-14">
          <div className="flex min-w-0 flex-col justify-center gap-2 text-center lg:gap-3 lg:text-left">
            {isAcquisitionSignUp ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand)]">
                  STEP 1 OF 2
                </p>
                <p className="text-lg font-semibold leading-snug text-white drop-shadow-sm sm:text-xl">
                  Start your 7-day free trial
                </p>
                <p className="text-sm leading-snug text-white/90 sm:text-[15px] sm:leading-relaxed">
                  7 days free · then $29/month
                </p>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-white drop-shadow-sm">
                  $0 DUE TODAY
                </p>
                <p className="text-sm leading-snug text-white/80 sm:text-[15px] sm:leading-relaxed">
                  Next, you&apos;ll securely add a payment method to start your trial.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold leading-snug text-white drop-shadow-sm sm:text-xl">
                  Create your account
                </p>
                <p className="text-sm leading-snug text-white/80 sm:text-[15px] sm:leading-relaxed">
                  After you sign up, we&apos;ll send you to the next step for your
                  account.
                </p>
              </>
            )}
          </div>
          <div className="w-full min-w-0 lg:justify-self-end">
            <div className="w-full max-w-md lg:ml-auto">{signUp}</div>
          </div>
        </div>
      )}
    </AuthMarketingShell>
  );
}
