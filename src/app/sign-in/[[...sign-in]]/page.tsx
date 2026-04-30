"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import {
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

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <SignIn
        afterSignInUrl={safeAfterSignInUrl}
        afterSignUpUrl={safeAfterSignUpUrl}
      />
    </div>
  );
}
