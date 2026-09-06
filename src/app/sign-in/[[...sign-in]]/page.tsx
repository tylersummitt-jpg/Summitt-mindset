"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachAttributionSync } from "@/components/coach-attribution-sync";
import {
  isCoachSubscribeRedirectUrl,
  sanitizeInternalRedirectUrl,
  sanitizeSubscribeRedirectUrl,
  signUpUrlPreservingInternalRedirect,
} from "@/lib/safe-redirect";

/**
 * ======================================================
 * Sign In Page (CANONICAL)
 * ======================================================
 *
 * Default after sign-in: /post-sign-in
 * Optional ?redirect_url= — sanitized internal paths only.
 *
 * Sign Up footer link preserves the same sanitized redirect
 * (consumer hop /checkout/start, coach /subscribe?src=coach).
 */

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams?.get("redirect_url");

  const safeSubscribeDestination = sanitizeSubscribeRedirectUrl(redirectUrl);
  const safeCheckoutStartDestination =
    sanitizeInternalRedirectUrl(redirectUrl) === "/checkout/start"
      ? "/checkout/start"
      : null;

  const safeAfterSignInUrl =
    sanitizeInternalRedirectUrl(redirectUrl) ?? "/post-sign-in";
  const safeAfterSignUpUrl =
    safeSubscribeDestination ?? safeCheckoutStartDestination ?? "/onboarding";

  const isCoachSignIn = isCoachSubscribeRedirectUrl(redirectUrl);

  return (
    <AuthMarketingShell authPage="sign-in">
      {isCoachSignIn ? <CoachAttributionSync enabled /> : null}
      <SignIn
        forceRedirectUrl={safeAfterSignInUrl}
        fallbackRedirectUrl={safeAfterSignInUrl}
        signUpForceRedirectUrl={safeAfterSignUpUrl}
        signUpFallbackRedirectUrl={safeAfterSignUpUrl}
        signUpUrl={signUpUrlPreservingInternalRedirect(redirectUrl)}
      />
    </AuthMarketingShell>
  );
}
