import { ReactNode } from "react";
import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PendingResolutionBanner } from "@/app/dashboard/pending-resolution-banner";
import { resolveActionablePendingResolutionKindForDashboard } from "@/lib/v2-dashboard-pending-resolution";

const DASHBOARD_BG_MOBILE = "/brand/dashboard-bg-mobile.png";
const DASHBOARD_BG_DESKTOP = "/brand/dashboard-bg-desktop.png";

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

  // 🔒 HARD GATE — onboarding required
  if (!onboardingCompleted) {
    redirect("/onboarding");
  }

  const pendingKind = await resolveActionablePendingResolutionKindForDashboard(user.id);

  return (
    <div className="relative isolate min-w-0 overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div className="absolute inset-0 md:hidden">
          <Image
            src={DASHBOARD_BG_MOBILE}
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>
        <div className="absolute inset-0 hidden md:block">
          <Image
            src={DASHBOARD_BG_DESKTOP}
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>
      </div>

      {/* Subtle veil: slightly stronger on small screens if photography is busy */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-black/[0.08] md:bg-black/[0.05]"
        aria-hidden
      />

      <div className="relative z-10">
        {pendingKind ? <PendingResolutionBanner kind={pendingKind} /> : null}
        {children}
      </div>
    </div>
  );
}
