import "server-only";

import { redirect } from "next/navigation";
import { getOnboardingSobStatus } from "@/lib/onboarding-sob-gates";
import type { ClerkSmsMetadata } from "@/lib/onboarding-sms-consent";

/** Sends incomplete onboarding users to the earliest missing no-Why step. */
export async function redirectIfOnboardingIncomplete(
  clerkUserId: string,
  md: ClerkSmsMetadata
): Promise<void> {
  if (md?.onboardingCompleted === true) {
    return;
  }

  const gate = await getOnboardingSobStatus(clerkUserId, md);
  if (gate.redirectTo) {
    redirect(gate.redirectTo);
  }
  redirect("/onboarding/identity");
}
