import { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * ======================================================
 * Dashboard Layout Gate (CANONICAL)
 * ======================================================
 *
 * Users may NOT enter the Daily Practice system
 * until onboarding is complete.
 *
 * This prevents:
 * - skipped personalization
 * - broken metadata state
 * - retention loss on Day 1
 */

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const onboardingCompleted =
    user.publicMetadata?.onboardingCompleted === true;

  // ✅ HARD GATE — onboarding is mandatory
  if (!onboardingCompleted) {
    redirect("/onboarding");
  }

  return <>{children}</>;
}
