import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { redirectIfOnboardingIncomplete } from "@/lib/onboarding-incomplete-redirect";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

export const dynamic = "force-dynamic";

/**
 * Coach-only completion screen — gated server-side.
 */
export default async function CoachCompleteLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await currentUser();
  const isNativeApp = await isNativeSummittMindsetAppRequest();

  if (!user) {
    redirect(
      `${signInPathForClient(isNativeApp)}?redirect_url=${encodeURIComponent("/coach/complete")}`
    );
  }

  const md = user.publicMetadata as Record<string, unknown> | undefined;

  if (md?.acquisitionSource !== "coach") {
    redirect("/post-sign-in");
  }

  if (!isSubscribedFromPublicMetadata(md)) {
    redirect(
      isNativeApp
        ? inactiveMembershipRedirectPath(true)
        : "/subscribe?src=coach"
    );
  }

  await redirectIfOnboardingIncomplete(user.id, md);

  return <>{children}</>;
}
