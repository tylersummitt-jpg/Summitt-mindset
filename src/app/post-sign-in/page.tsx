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
import {
  getOnboardingSobStatus,
  MEMBER_APP_HOME_PATH,
} from "@/lib/onboarding-sob-gates";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

/**
 * ======================================================
 * Post Sign In Router (CANONICAL)
 * ======================================================
 *
 * This is the single redirect truth after login.
 *
 * Order:
 * 1. Subscribe / app membership (if not subscribed)
 * 2. Onboarding (if incomplete)
 * 3. Victory Room (primary member home)
 *
 * Coach funnel no longer routes to /coach/setup (legacy shipping step retired from active flow).
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
  const isNativeApp = await isNativeSummittMindsetAppRequest();

  if (!user) {
    redirect(signInPathForClient(isNativeApp));
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;
  let effectiveMd = md;

  if (isCoachAttributionEnabled()) {
    const cookieStore = await cookies();
    const attributionCookieValue = cookieStore.get(
      COACH_ATTRIBUTION_COOKIE_NAME
    )?.value;
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

  try {
    await linkMarketingVisitorToClerkUser(user.id);
  } catch {
    // fail-open: analytics must never change post-sign-in redirects
  }

  const isSubscribed = isSubscribedFromMetadata(effectiveMd);
  if (!isSubscribed) {
    if (effectiveMd?.summittPlan === "paused") {
      redirect("/user");
    }
    if (isNativeApp) {
      redirect(inactiveMembershipRedirectPath(true));
    }
    redirect(
      effectiveMd.acquisitionSource === "coach"
        ? "/subscribe?from=post-sign-in&src=coach"
        : "/subscribe?from=post-sign-in"
    );
  }

  const onboardingCompleted = effectiveMd?.onboardingCompleted === true;
  if (!onboardingCompleted) {
    const gate = await getOnboardingSobStatus(user.id, effectiveMd);
    if (gate.redirectTo) {
      redirect(gate.redirectTo);
    }
    redirect("/onboarding/identity");
  }

  redirect(MEMBER_APP_HOME_PATH);
}
