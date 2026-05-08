import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import {
  COACH_ATTRIBUTION_COOKIE_NAME,
  COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
  COACH_ATTRIBUTION_SYNCED_COOKIE_NAME,
  isCoachAttributionEnabled,
  shouldSyncCoachAttribution,
} from "@/lib/coach-attribution";

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
  let effectiveMd = md;

  if (isCoachAttributionEnabled()) {
    const cookieStore = await cookies();
    const attributionCookieValue = cookieStore.get(COACH_ATTRIBUTION_COOKIE_NAME)?.value;
    const acquisitionSource = md?.acquisitionSource;

    const shouldSync = shouldSyncCoachAttribution({
      acquisitionSource,
      attributionCookieValue,
    });

    if (shouldSync && user?.id) {
      try {
        await updateClerkPublicMetadata(user.id, {
          acquisitionSource: COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
        });
        effectiveMd = {
          ...md,
          acquisitionSource: COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
        };
        cookieStore.set(COACH_ATTRIBUTION_SYNCED_COOKIE_NAME, "1", {
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          httpOnly: false,
        });
      } catch (err) {
        console.warn(
          "[post-sign-in] failed to persist coach attribution to Clerk; continuing routing",
          err
        );
      }
    }
  }

  if (
    isSubscribedFromMetadata(effectiveMd) &&
    effectiveMd.acquisitionSource === "coach" &&
    effectiveMd.coachAddressCollected !== true
  ) {
    redirect("/coach/setup");
  }

  const onboardingCompleted = effectiveMd?.onboardingCompleted === true;
  if (!onboardingCompleted) {
    if (
      effectiveMd.acquisitionSource === "coach" &&
      effectiveMd.coachAddressCollected === true
    ) {
      redirect("/onboarding/identity");
    }
    redirect("/onboarding");
  }

  const isSubscribed = isSubscribedFromMetadata(effectiveMd);
  if (!isSubscribed) {
    redirect("/subscribe?from=post-sign-in");
  }

  redirect("/dashboard");
}
