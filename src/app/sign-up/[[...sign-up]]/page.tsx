"use client";

import { SignUp } from "@clerk/nextjs";

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
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <SignUp
        afterSignInUrl="/post-sign-in"
        afterSignUpUrl="/onboarding"
      />
    </div>
  );
}
