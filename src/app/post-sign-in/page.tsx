import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * ======================================================
 * Post Sign In Router (CANONICAL)
 * ======================================================
 *
 * This is the single redirect truth after login.
 *
 * Order:
 * 1. Coach setup (if applicable: subscribed + coach acquisition + address not collected)
 * 2. Onboarding
 * 3. Subscribe (if needed)
 * 4. Dashboard (commitment-first home)
 */

function isSubscribedFromMetadata(md: Record<string, any>) {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;

  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

export default async function PostSignInPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (
    isSubscribedFromMetadata(md) &&
    md.acquisitionSource === "coach" &&
    md.coachAddressCollected !== true
  ) {
    redirect("/coach/setup");
  }

  const onboardingCompleted = md?.onboardingCompleted === true;
  if (!onboardingCompleted) {
    redirect("/onboarding");
  }

  const isSubscribed = isSubscribedFromMetadata(md);
  if (!isSubscribed) {
    redirect("/subscribe?from=post-sign-in");
  }

  redirect("/dashboard");
}
