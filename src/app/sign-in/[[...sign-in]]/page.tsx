"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

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

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <SignIn
        afterSignInUrl={redirectUrl || "/post-sign-in"}
        afterSignUpUrl="/onboarding"
      />
    </div>
  );
}
