"use client";

import { usePathname } from "next/navigation";

/**
 * Root /onboarding: top-align the shell so the card sits higher (no vertical centering).
 * Step routes: preserve centered layout as before.
 */
export function OnboardingShellMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isRootOnboarding =
    pathname === "/onboarding" || pathname === "/onboarding/";

  return (
    <main
      className={
        isRootOnboarding
          ? "min-h-screen bg-gray-50 flex items-start justify-center px-6 pt-16"
          : "min-h-screen bg-gray-50 flex items-center justify-center px-6"
      }
    >
      {children}
    </main>
  );
}
