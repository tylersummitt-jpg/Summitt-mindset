"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachAttributionSync } from "@/components/coach-attribution-sync";
import {
  isCoachSubscribeRedirectUrl,
  sanitizeInternalRedirectUrl,
  sanitizeSubscribeRedirectUrl,
} from "@/lib/safe-redirect";

/**
 * ======================================================
 * Sign In Page (CANONICAL)
 * ======================================================
 *
 * Default behavior:
 * - afterSignIn → /post-sign-in
 *
 * BUT:
 * If user arrived here with:
 * ?redirect_url=/somewhere
 *
 * We send them there after sign-in.
 */

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams?.get("redirect_url");

  const safeAfterSignInUrl =
    sanitizeInternalRedirectUrl(redirectUrl) ?? "/post-sign-in";
  const safeAfterSignUpUrl =
    sanitizeSubscribeRedirectUrl(redirectUrl) ?? "/onboarding";

  const isCoachSignIn = isCoachSubscribeRedirectUrl(redirectUrl);

  return (
    <AuthMarketingShell authPage="sign-in">
      {isCoachSignIn ? <CoachAttributionSync enabled /> : null}
      <SignIn
        afterSignInUrl={safeAfterSignInUrl}
        afterSignUpUrl={safeAfterSignUpUrl}
      />
    </AuthMarketingShell>
  );
}
