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
 * Coach kit shipping — gated: signed in, subscribed, coach funnel, address not yet collected.
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

  if (!isSubscribedFromMetadata(md)) {
    redirect("/subscribe");
  }

  if (md.acquisitionSource !== "coach") {
    redirect("/onboarding");
  }

  if (md.coachAddressCollected === true) {
    redirect("/onboarding/identity");
  }

  return <>{children}</>;
}
