import "server-only";

import { redirect } from "next/navigation";
import { resolveOnboardingSobRedirect } from "@/lib/onboarding-sob-gates";
import type { ClerkSmsMetadata } from "@/lib/onboarding-sms-consent";

export async function requireOnboardingSobPath(
  clerkUserId: string,
  md: ClerkSmsMetadata,
  currentPath: string
): Promise<void> {
  const dest = await resolveOnboardingSobRedirect(clerkUserId, md, currentPath);
  if (dest) {
    redirect(dest);
  }
}
