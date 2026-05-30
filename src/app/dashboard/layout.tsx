import { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardBackgroundFrame } from "@/app/dashboard/DashboardBackgroundFrame";
import { PendingResolutionBanner } from "@/app/dashboard/pending-resolution-banner";
import { resolveActionablePendingResolutionKindForDashboard } from "@/lib/v2-dashboard-pending-resolution";
import { getOnboardingSobStatus } from "@/lib/onboarding-sob-gates";

/**
 * ======================================================
 * Dashboard Layout Gate (CANONICAL)
 * ======================================================
 *
 * Rule:
 * - /dashboard is the Daily OS (paid member area)
 * - Must be signed in
 * - Must be subscribed
 * - Must have completed onboarding
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

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  const isSubscribed = isSubscribedFromMetadata(md);

  // 🔒 HARD GATE — subscription required
  if (!isSubscribed) {
    redirect("/subscribe");
  }

  const onboardingCompleted = md?.onboardingCompleted === true;

  // 🔒 HARD GATE — onboarding required (earliest missing no-Why step)
  if (!onboardingCompleted) {
    const gate = await getOnboardingSobStatus(user.id, md);
    if (gate.redirectTo) {
      redirect(gate.redirectTo);
    }
    redirect("/onboarding/identity");
  }

  const pendingKind = await resolveActionablePendingResolutionKindForDashboard(user.id);

  return (
    <DashboardBackgroundFrame>
      {pendingKind ? <PendingResolutionBanner kind={pendingKind} /> : null}
      {children}
    </DashboardBackgroundFrame>
  );
}
