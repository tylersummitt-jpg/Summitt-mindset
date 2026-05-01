"use client";

import { SignUp } from "@clerk/nextjs";
import { AuthMarketingShell } from "@/components/auth-marketing-shell";

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
 */

export default function SignUpPage() {
  return (
    <AuthMarketingShell authPage="sign-up">
      <SignUp
        afterSignInUrl="/post-sign-in"
        afterSignUpUrl="/onboarding"
      />
    </AuthMarketingShell>
  );
}
