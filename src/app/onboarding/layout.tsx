import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingShellMain } from "@/components/onboarding-shell-main";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

/**
 * ======================================================
 * Onboarding Layout (Retention Shell + Subscription Gate)
 * ======================================================
 *
 * Product rule:
 * Subscribe FIRST → then onboarding.
 *
 * This layout gates ALL onboarding routes. Canonical no-Why flow:
 * Welcome → Identity → Current Goal → Review → SMS → Complete → Victory Room
 * - /onboarding (Welcome)
 * - /onboarding/identity (My Identity; optional important people)
 * - /onboarding/commitment (My Current Goal)
 * - /onboarding/review
 * - /onboarding/sms
 * - /onboarding/complete
 * Legacy redirects only (no data collection):
 * /onboarding/relationships → identity; /onboarding/pressure → commitment; /onboarding/why → identity.
 *
 * NOTE: Uncaught errors in this layout are NOT handled by onboarding/error.tsx
 * (Next.js error boundaries cover segment children, not the layout component).
 * We log and rethrow around currentUser(); redirect() must never be caught (it throws NEXT_REDIRECT).
 */

export const dynamic = "force-dynamic";

function logOnboardingLayoutEvent(payload: {
  stage: string;
  outcome: string;
  userId?: string | null;
  redirect?: string;
  errorPhase?: string;
  errorName?: string;
}) {
  const line = JSON.stringify({
    routeGroup: "onboarding",
    ...payload,
  });
  const isFailure =
    payload.stage === "error" || payload.outcome === "failure";
  if (isFailure) {
    console.error(line);
    return;
  }
  if (process.env.NODE_ENV === "development") {
    console.log(line);
  }
}

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  let user;
  try {
    user = await currentUser();
  } catch (err: unknown) {
    const e = err as Error;
    logOnboardingLayoutEvent({
      stage: "error",
      outcome: "failure",
      errorPhase: "current_user",
      errorName: e?.name,
    });
    throw err;
  }

  logOnboardingLayoutEvent({
    stage: "current_user",
    outcome: user ? "success" : "no_session",
    userId: user?.id ?? null,
  });

  if (!user) {
    const isNativeApp = await isNativeSummittMindsetAppRequest();
    const signInPath = signInPathForClient(isNativeApp);
    const redirectTarget = isNativeApp
      ? signInPath
      : `${signInPath}?redirect_url=${encodeURIComponent("/onboarding")}`;
    logOnboardingLayoutEvent({
      stage: "redirect_sign_in",
      outcome: "redirect",
      userId: null,
      redirect: redirectTarget,
    });
    redirect(redirectTarget);
  }

  const isSubscribed = isSubscribedFromPublicMetadata(user.publicMetadata);

  logOnboardingLayoutEvent({
    stage: "subscription_check",
    outcome: isSubscribed ? "subscribed" : "not_subscribed",
    userId: user.id,
  });

  if (!isSubscribed) {
    const mdSub = user.publicMetadata as Record<string, unknown> | undefined;
    const isNativeApp = await isNativeSummittMindsetAppRequest();
    const subscribePath = isNativeApp
      ? inactiveMembershipRedirectPath(true)
      : mdSub?.acquisitionSource === "coach"
        ? "/subscribe?from=onboarding&src=coach"
        : "/subscribe?from=onboarding";
    logOnboardingLayoutEvent({
      stage: "redirect_subscribe",
      outcome: "redirect",
      userId: user.id,
      redirect: subscribePath,
    });
    redirect(subscribePath);
  }

  logOnboardingLayoutEvent({
    stage: "render_children",
    outcome: "success",
    userId: user.id,
  });

  const mdOnboarding = user.publicMetadata as Record<string, unknown> | undefined;
  const showCoachOnboardingBanner =
    mdOnboarding?.acquisitionSource === "coach" &&
    mdOnboarding?.onboardingCompleted !== true;

  const coachCompleteHero =
    mdOnboarding?.acquisitionSource === "coach" &&
    mdOnboarding?.onboardingCompleted === true;

  return (
    <OnboardingShellMain>
      <div
        className={
          coachCompleteHero ? "w-full max-w-none py-0" : "w-full max-w-2xl py-12"
        }
      >
        {showCoachOnboardingBanner ? (
          <div className="mb-5 px-1">
            <ol
              className="mx-auto grid max-w-sm list-none gap-2.5 pt-0.5 text-left sm:max-w-md sm:gap-3"
              aria-label="Coach onboarding steps"
            >
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-sm font-semibold tabular-nums text-gray-600"
                  aria-hidden
                >
                  1
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-gray-900 sm:text-[15px]">
                  Create your account
                </span>
              </li>
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-sm font-semibold tabular-nums text-gray-600"
                  aria-hidden
                >
                  2
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-gray-900 sm:text-[15px]">
                  Start your membership
                </span>
              </li>
              <li className="flex gap-3 text-left" aria-current="step">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold tabular-nums text-white shadow-sm shadow-orange-500/20"
                  aria-hidden
                >
                  3
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-gray-900 sm:text-[15px]">
                  Complete onboarding
                </span>
              </li>
              <li className="flex gap-3 text-left">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-sm font-semibold tabular-nums text-gray-600"
                  aria-hidden
                >
                  4
                </span>
                <span className="min-w-0 pt-0.5 text-sm font-semibold leading-snug text-gray-900 sm:text-[15px]">
                  We reach out to ship your Leadership Kit
                </span>
              </li>
            </ol>
          </div>
        ) : null}
        {coachCompleteHero ? (
          <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen max-w-[100vw] overflow-x-hidden">
            {children}
          </div>
        ) : (
          <section className="bg-white border rounded-xl shadow-sm p-8">
            {children}
          </section>
        )}
      </div>
    </OnboardingShellMain>
  );
}
