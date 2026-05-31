"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

import ManageMembershipButton from "@/components/manage-membership-button";
import AccountSmsBlock from "@/components/text-check-ins-section";

function capitalizeDisplay(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function MembershipStatusCard() {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const planRaw = md?.summittPlan;
  const planStr = typeof planRaw === "string" ? planRaw : "";
  const subscribed = md?.summittSubscribed === true;

  let status: string;
  if (!isLoaded) {
    status = "—";
  } else if (planStr === "paused") {
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
  } else if (planStr === "paused") {
    plan = "Paused";
  } else if (planStr.trim() !== "") {
    plan = capitalizeDisplay(planStr);
  } else {
    plan = "Unknown";
  }

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Status</span>
        <span className="font-medium text-gray-900">{status}</span>
      </div>
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Plan</span>
        <span className="font-medium text-gray-900">{plan}</span>
      </div>
    </div>
  );
}

function AccountabilitySummaryCard() {
  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-left space-y-3">
      <p className="font-semibold text-gray-900">Accountability</p>
      <p className="text-gray-600 leading-relaxed">
        Pat checks in by text on one commitment you name—not a numbered-day score. Victory Room is
        your home for proof, your current bar, and goal updates.
      </p>
      <div className="flex flex-col gap-2 pt-1">
        <Link
          href={MEMBER_APP_HOME_PATH}
          className="inline-flex w-full justify-center rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
        >
          Open Victory Room
        </Link>
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  return (
    <>
      <SignedIn>
        <main className="min-h-screen flex flex-col items-center px-6 py-8 md:py-10">
          <div className="w-full max-w-4xl mx-auto flex flex-col gap-8">
            <header className="text-center space-y-2">
              <h1 className="text-2xl font-semibold">Account</h1>
              <p className="text-sm text-gray-600">
                Manage your membership, billing, and profile settings.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                Need help? Email us anytime —{" "}
                <a
                  href="mailto:Support@SummittMindset.com"
                  className="font-medium text-gray-900 underline underline-offset-2 hover:text-gray-700"
                >
                  Support@SummittMindset.com
                </a>
              </p>
              <div className="pt-1">
                <Link
                  href="/sign-out"
                  className="text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
                >
                  Sign out
                </Link>
              </div>
            </header>

            <div className="w-full">
              <UserProfile />
            </div>

            <section className="w-full flex flex-col gap-3">
              <MembershipStatusCard />

              <AccountSmsBlock />

              <AccountabilitySummaryCard />

              <div className="flex flex-col items-center pt-1">
                <ManageMembershipButton />
              </div>
            </section>
          </div>
        </main>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
