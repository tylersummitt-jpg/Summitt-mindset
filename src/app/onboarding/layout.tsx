import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingShellMain } from "@/components/onboarding-shell-main";

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
 */

export const dynamic = "force-dynamic";

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

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await currentUser();

  // Must be signed in
  if (!user) {
    redirect("/sign-in?redirect_url=/onboarding");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;
  const isSubscribed = isSubscribedFromMetadata(md);

  // Must be subscribed
  if (!isSubscribed) {
    redirect("/subscribe?from=onboarding");
  }

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