import { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

function isSubscribedFromMetadata(md: Record<string, unknown>) {
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
 * PR7: `/dashboard/day/*` is no longer a progression surface; gate auth/subscription then send users
 * to the commitment-first dashboard.
 */
export default async function DayLayout({ children: _children }: { children: ReactNode }) {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;

  if (!isSubscribedFromMetadata(md)) {
    redirect("/subscribe");
  }

  if (md?.onboardingCompleted !== true) {
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
