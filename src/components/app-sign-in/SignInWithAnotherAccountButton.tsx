"use client";

import { SignOutButton } from "@clerk/nextjs";
import { APP_SIGN_IN_PATH } from "@/lib/app-sign-in/app-sign-in-constants";

/**
 * Signs out with the same Clerk SignOutButton the app already uses,
 * then opens the app sign-in screen so the member can try another email.
 */
export default function SignInWithAnotherAccountButton({
  prominence = "primary",
}: {
  prominence?: "primary" | "quiet";
}) {
  const className =
    prominence === "primary"
      ? "w-full rounded-md bg-[var(--text)] px-4 py-3 text-base font-semibold text-[var(--bg)]"
      : "w-full rounded-md px-4 py-3 text-base font-medium text-[var(--text)] underline underline-offset-4";

  return (
    <SignOutButton redirectUrl={APP_SIGN_IN_PATH}>
      <button type="button" className={className}>
        Sign in with another email
      </button>
    </SignOutButton>
  );
}
