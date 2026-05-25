import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { redirectIfOnboardingIncomplete } from "@/lib/onboarding-incomplete-redirect";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

export const dynamic = "force-dynamic";

/**
 * Post-onboarding Leadership Kit shipping for coach-attributed members.
 * Not part of the SoB onboarding spine — onboarding must be complete first.
 */
export default async function CoachSetupLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in?redirect_url=/coach/setup");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;

  if (!isSubscribedFromPublicMetadata(md)) {
    redirect(md.acquisitionSource === "coach" ? "/subscribe?src=coach" : "/subscribe");
  }

  if (md.acquisitionSource !== "coach") {
    redirect("/post-sign-in");
  }

  if (md.onboardingCompleted !== true) {
    await redirectIfOnboardingIncomplete(user.id, md);
    redirect("/onboarding/identity");
  }

  if (md.coachAddressCollected === true) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  return <>{children}</>;
}
