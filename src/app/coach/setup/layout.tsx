import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function isSubscribedFromMetadata(md: Record<string, unknown>): boolean {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;
  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

/**
 * Legacy coach kit shipping route — no longer part of the active coach funnel.
 * Subscribed coaches are sent to onboarding or dashboard.
 * Page + API retained for admin/legacy use.
 */
export default async function CoachSetupLayout({
  children: _children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in?redirect_url=/coach/setup");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;

  if (!isSubscribedFromMetadata(md)) {
    redirect(md.acquisitionSource === "coach" ? "/subscribe?src=coach" : "/subscribe");
  }

  if (md.acquisitionSource !== "coach") {
    redirect("/onboarding");
  }

  /** Active funnel no longer collects shipping here — send coaches forward. */
  if (md.onboardingCompleted === true) {
    redirect("/dashboard");
  }

  redirect("/onboarding");
}
