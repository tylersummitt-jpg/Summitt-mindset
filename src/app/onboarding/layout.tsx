import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * ======================================================
 * Onboarding Layout (Retention Shell + Subscription Gate)
 * ======================================================
 *
 * Product rule:
 * Subscribe FIRST → then onboarding.
 *
 * This layout gates ALL onboarding routes:
 * - /onboarding
 * - /onboarding/identity
 * - /onboarding/relationships
 * - /onboarding/pressure
 * - /onboarding/sms
 * - /onboarding/complete
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
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="w-full max-w-2xl py-16 space-y-10">
        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Training Camp Setup
          </p>
          <h1 className="text-2xl font-bold">Let’s get to know your life.</h1>
          <p className="text-gray-600 text-sm">
            A few calm questions so Coach Pat can coach you like she knows you.
          </p>
        </header>

        <section className="bg-white border rounded-xl shadow-sm p-8">
          {children}
        </section>
      </div>
    </main>
  );
}