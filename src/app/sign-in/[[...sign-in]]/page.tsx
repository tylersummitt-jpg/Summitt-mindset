"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachAttributionSync } from "@/components/coach-attribution-sync";
import {
  checkoutPlanFromUnknown,
  checkoutStartForceRedirectUrl,
  signUpHrefForCheckoutStart,
} from "@/lib/checkout-plan";
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
  const isCheckoutStartHop =
    sanitizeInternalRedirectUrl(redirectUrl) === "/checkout/start";
  const selectedCheckoutPlan = isCheckoutStartHop
    ? checkoutPlanFromUnknown(searchParams?.get("plan"))
    : "monthly";

  const safeSubscribeDestination = sanitizeSubscribeRedirectUrl(redirectUrl);
  const safeCheckoutStartDestination = isCheckoutStartHop
    ? checkoutStartForceRedirectUrl(selectedCheckoutPlan)
    : null;

  const safeAfterSignInUrl =
    safeCheckoutStartDestination ??
    sanitizeInternalRedirectUrl(redirectUrl) ??
    "/post-sign-in";
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
        signUpUrl={
          isCheckoutStartHop
            ? signUpHrefForCheckoutStart(selectedCheckoutPlan)
            : signUpUrlPreservingInternalRedirect(redirectUrl)
        }
      />
    </AuthMarketingShell>
  );
}
