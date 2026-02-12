/**
 * ======================================================
 * Onboarding Layout (Retention Shell + Subscription Gate)
 * ======================================================
 *
 * Product rule:
 * Subscribe FIRST → then complete onboarding.
 *
 * This layout gates ALL onboarding routes:
 * - /onboarding
 * - /onboarding/goal
 * - /onboarding/outcome
 * - /onboarding/schedule
 * - /onboarding/miss-plan
 * - /onboarding/training-focus
 * - /onboarding/sms
 * - /onboarding/complete
 */

import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

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
  children: React.ReactNode;
}) {
  const user = await currentUser();

  // --------------------------------------------------
  // Must be signed in
  // --------------------------------------------------
  if (!user) {
    redirect("/sign-in?redirect_url=/onboarding");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;
  const isSubscribed = isSubscribedFromMetadata(md);

  // --------------------------------------------------
  // Must be subscribed
  // --------------------------------------------------
  if (!isSubscribed) {
    redirect("/subscribe?from=onboarding");
  }

  // --------------------------------------------------
  // Render onboarding shell
  // --------------------------------------------------
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="w-full max-w-2xl py-16 space-y-10">
        {/* Summit Identity Header */}
        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Training Camp Setup
          </p>
          <h1 className="text-2xl font-bold">
            Your climb starts here.
          </h1>
          <p className="text-gray-600 text-sm">
            Just a few calm steps to personalize your daily practice.
          </p>
        </header>

        {/* Main Onboarding Content */}
        <section className="bg-white border rounded-xl shadow-sm p-8">
          {children}
        </section>
      </div>
    </main>
  );
}
