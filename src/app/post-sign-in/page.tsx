import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * ======================================================
 * Post Sign In Router (CANONICAL)
 * ======================================================
 *
 * This is the single redirect truth after login.
 *
 * Rules:
 * - If onboarding not complete -> /onboarding
 * - If not subscribed -> /subscribe
 * - If subscribed -> /dashboard/day/[currentDay]
 *
 * Also:
 * - If currentDay missing, default to 1
 */

function safeDayNumber(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 1;
  return Math.floor(n);
}

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

  const onboardingCompleted = md?.onboardingCompleted === true;
  if (!onboardingCompleted) {
    redirect("/onboarding");
  }

  const isSubscribed = isSubscribedFromMetadata(md);
  if (!isSubscribed) {
    redirect("/subscribe?from=post-sign-in");
  }

  const currentDay = safeDayNumber(md?.currentDay);

  redirect(`/dashboard/day/${currentDay}`);
}
