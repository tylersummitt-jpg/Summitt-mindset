"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

import ManageMembershipButton from "@/components/manage-membership-button";
import ResumeMembershipButton from "@/components/resume-membership-button";
import {
  utBody,
  utCard,
  utCardDivider,
  utClerkSectionLabel,
  utClerkShell,
  utLink,
  utPageCanvas,
  utPageInnerAccount,
  utPageTitle,
  utSecondaryBtn,
  utSectionTitle,
} from "@/components/utility-page-visual";

function capitalizeDisplay(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function AccountMembershipRows() {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const planRaw = md?.summittPlan;
  const planStr = typeof planRaw === "string" ? planRaw : "";
  const subscribed = md?.summittSubscribed === true;
  const isPaused = planStr === "paused";

  let status: string;
  if (!isLoaded) {
    status = "—";
  } else if (isPaused) {
    status = "Paused";
  } else if (subscribed) {
    status = "Active";
  } else {
    status = "Inactive";
  }

  let plan: string;
  if (!isLoaded) {
    plan = "—";
  } else if (planStr === "monthly") {
    plan = "Monthly";
  } else if (planStr === "yearly" || planStr === "annual") {
    plan = "Yearly";
  } else if (isPaused) {
    plan = "Paused";
  } else if (planStr.trim() !== "") {
    plan = capitalizeDisplay(planStr);
  } else {
    plan = "Unknown";
  }

  return (
    <div className="space-y-3">
      <div className="grid w-fit max-w-full grid-cols-[auto_auto] gap-x-8 gap-y-1">
        <span className="text-stone-400">Membership Status</span>
        <span className="font-medium text-stone-100">{status}</span>
        <span className="text-stone-400">Plan</span>
        <span className="font-medium text-stone-100">{plan}</span>
      </div>
      {isPaused ? (
        <div className="space-y-2 max-w-md">
          <p className="text-sm text-stone-300">
            Your membership is paused. Resume to continue on your existing plan.
          </p>
          <ResumeMembershipButton variant="account" />
        </div>
      ) : null}
    </div>
  );
}

function AccountTopCard({ dangerZone }: { dangerZone?: ReactNode }) {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;
  const isPaused = isLoaded && md?.summittPlan === "paused";

  return (
    <div className={`w-full text-sm text-left ${utCard}`}>
      <section className="space-y-2 px-4 py-4">
        <h2 className={utSectionTitle}>Need help?</h2>
        <p className={utBody}>
          Email us anytime —{" "}
          <a href="mailto:Support@SummittMindset.com" className={utLink}>
            Support@SummittMindset.com
          </a>
        </p>
      </section>

      <section className={`space-y-2 px-4 py-4 ${utCardDivider}`}>
        <h2 className={utSectionTitle}>Text Messages</h2>
        <p className={utBody}>
          Text STOP to stop text messages. Text START to resume text messages. Text HELP for info.
        </p>
      </section>

      <section className={`space-y-3 px-4 py-4 ${utCardDivider}`}>
        <h2 className={utSectionTitle}>Account</h2>
        <AccountMembershipRows />
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href="/sign-out" className={utSecondaryBtn}>
            Sign out
          </Link>
          {!isPaused ? (
            <div className="w-full sm:w-auto [&>div]:w-full sm:[&>div]:w-auto [&_button]:w-full sm:[&_button]:w-auto [&_button]:border-white/20 [&_button]:bg-transparent [&_button]:text-stone-100 [&_button]:hover:bg-white [&_button]:hover:text-gray-900">
              <ManageMembershipButton />
            </div>
          ) : null}
        </div>
      </section>

      {dangerZone ? (
        <section
          className={`space-y-3 px-4 py-4 ${utCardDivider}`}
          data-testid="account-danger-zone-slot"
        >
          {dangerZone}
        </section>
      ) : null}
    </div>
  );
}

export default function UserAccountClient({
  dangerZone,
}: {
  dangerZone?: ReactNode;
}) {
  return (
    <>
      <SignedIn>
        <main className={utPageCanvas}>
          <div className={utPageInnerAccount}>
            <header className="text-center">
              <h1 className={utPageTitle}>Account</h1>
            </header>

            <AccountTopCard dangerZone={dangerZone} />

            <div className="w-full space-y-2">
              <p className={utClerkSectionLabel}>Profile & security</p>
              <div className={utClerkShell}>
                <UserProfile />
              </div>
            </div>
          </div>
        </main>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
