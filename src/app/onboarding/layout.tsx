import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingShellMain } from "@/components/onboarding-shell-main";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

/**
 * ======================================================
 * Onboarding Layout (Retention Shell + Subscription Gate)
 * ======================================================
 *
 * Product rule:
 * Subscribe FIRST → then onboarding.
 *
 * This layout gates ALL onboarding routes. Canonical flow (4 steps):
 * Identity → Commitment → SMS → Complete
 * - /onboarding
 * - /onboarding/identity (combined identity + relationships intake)
 * - /onboarding/commitment
 * - /onboarding/sms
 * - /onboarding/complete
 * Legacy: /onboarding/relationships redirects to /onboarding/identity.
 * /onboarding/pressure redirects to /onboarding/commitment.
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
  console.error(
    JSON.stringify({
      routeGroup: "onboarding",
      ...payload,
    })
  );
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
    logOnboardingLayoutEvent({
      stage: "redirect_sign_in",
      outcome: "redirect",
      userId: null,
      redirect: "/sign-in?redirect_url=/onboarding",
    });
    redirect("/sign-in?redirect_url=/onboarding");
  }

  const isSubscribed = isSubscribedFromPublicMetadata(user.publicMetadata);

  logOnboardingLayoutEvent({
    stage: "subscription_check",
    outcome: isSubscribed ? "subscribed" : "not_subscribed",
    userId: user.id,
  });

  if (!isSubscribed) {
    logOnboardingLayoutEvent({
      stage: "redirect_subscribe",
      outcome: "redirect",
      userId: user.id,
      redirect: "/subscribe?from=onboarding",
    });
    redirect("/subscribe?from=onboarding");
  }

  logOnboardingLayoutEvent({
    stage: "render_children",
    outcome: "success",
    userId: user.id,
  });

  return (
    <OnboardingShellMain>
      <div className="w-full max-w-2xl py-12">
        <section className="bg-white border rounded-xl shadow-sm p-8">
          {children}
        </section>
      </div>
    </OnboardingShellMain>
  );
}
