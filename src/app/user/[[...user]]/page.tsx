"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";

import ManageMembershipButton from "@/components/manage-membership-button";

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
    <>
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Status</span>
        <span className="font-medium text-gray-900">{status}</span>
      </div>
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Plan</span>
        <span className="font-medium text-gray-900">{plan}</span>
      </div>
    </>
  );
}

function AccountTopCard() {
  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white text-sm text-left">
      <section className="px-4 py-4 space-y-2">
        <h2 className="font-semibold text-gray-900">Need help?</h2>
        <p className="text-gray-600 leading-relaxed">
          Email us anytime —{" "}
          <a
            href="mailto:Support@SummittMindset.com"
            className="font-medium text-gray-900 underline underline-offset-2 hover:text-gray-700"
          >
            Support@SummittMindset.com
          </a>
        </p>
      </section>

      <section className="px-4 py-4 space-y-2 border-t border-gray-100">
        <h2 className="font-semibold text-gray-900">Text Messages</h2>
        <p className="text-gray-600 leading-relaxed">
          Text STOP to stop text messages. Text START to resume text messages. Text HELP for info.
        </p>
      </section>

      <section className="px-4 py-4 space-y-3 border-t border-gray-100">
        <h2 className="font-semibold text-gray-900">Account</h2>
        <AccountMembershipRows />
        <div className="pt-1">
          <Link
            href="/sign-out"
            className="text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            Sign out
          </Link>
        </div>
        <div className="flex flex-col items-center pt-1">
          <ManageMembershipButton />
        </div>
      </section>
    </div>
  );
}

export default function UserProfilePage() {
  return (
    <>
      <SignedIn>
        <main className="min-h-screen flex flex-col items-center px-6 py-8 md:py-10">
          <div className="w-full max-w-4xl mx-auto flex flex-col gap-8">
            <header className="text-center">
              <h1 className="text-2xl font-semibold">Account</h1>
            </header>

            <AccountTopCard />

            <div className="w-full">
              <UserProfile />
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
