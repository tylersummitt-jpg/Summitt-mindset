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
    <div className="w-full max-w-md sm:max-w-lg mx-auto rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
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

function formatSmsPhoneDisplay(phoneRaw: unknown): string | null {
  if (typeof phoneRaw !== "string" || !phoneRaw.trim()) return null;
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  const last4 = digits.slice(-4);
  return `(***) ***-${last4}`;
}

function smsTimePreferenceLabel(pref: unknown): string {
  if (pref === "morning") return "Morning (7:00 AM)";
  if (pref === "evening") return "Evening (7:00 PM)";
  if (pref === "early_morning") return "Morning";
  if (pref === "midday") return "Evening";
  if (pref === "afternoon") return "Afternoon";
  return "Morning (7:00 AM)";
}

function TextMessagesCard() {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const smsOn = md?.smsEnabled === true;
  const pref = md?.smsTimePreference;
  const maskedPhone = formatSmsPhoneDisplay(md?.phoneNumber);

  let status: string;
  let timeLabel: string;
  let phoneLabel: string;

  if (!isLoaded) {
    status = "—";
    timeLabel = "—";
    phoneLabel = "—";
  } else {
    status = smsOn ? "On" : "Off";
    timeLabel = smsTimePreferenceLabel(pref);
    phoneLabel = maskedPhone ?? "Not set";
  }

  return (
    <div className="w-full max-w-md sm:max-w-lg mx-auto space-y-2">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Status</span>
          <span className="font-medium text-gray-900">{status}</span>
        </div>
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Time</span>
          <span className="font-medium text-gray-900">{timeLabel}</span>
        </div>
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Phone</span>
          <span className="font-medium text-gray-900">{phoneLabel}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 text-center">
        Text STOP anytime to pause messages.
      </p>
    </div>
  );
}

function AccountabilitySummaryCard() {
  return (
    <div className="w-full max-w-md sm:max-w-lg mx-auto rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-left space-y-3">
      <p className="font-semibold text-gray-900">Accountability</p>
      <p className="text-gray-600 leading-relaxed">
        Pat checks in over SMS on one commitment you name—not a numbered-day score. Use the
        dashboard for your bar; Victory Room for proof.
      </p>
      <div className="flex flex-col gap-2 pt-1">
        <Link
          href="/dashboard"
          className="inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Open dashboard
        </Link>
        <Link
          href="/dashboard/victory-room"
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
        <main className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-16">
          <div className="text-center space-y-3">
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="text-sm text-gray-600">
              Manage your membership, billing, and profile settings.
            </p>
          </div>

          <div className="w-full max-w-4xl">
            <UserProfile />
          </div>

          <section className="text-center space-y-3 w-full">
            <MembershipStatusCard />

            <TextMessagesCard />

            <AccountabilitySummaryCard />

            <ManageMembershipButton />

            <p className="mt-4 text-sm text-gray-600 text-center max-w-md sm:max-w-lg mx-auto">
              Need help? Email us anytime —{" "}
              <a href="mailto:Support@SummittMindset.com">
                Support@SummittMindset.com
              </a>
            </p>

            <div className="w-full max-w-md sm:max-w-lg mx-auto rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-center space-y-3">
              <p className="font-semibold text-gray-900">
                Keep Your Coaching Accurate
              </p>
              <p className="text-gray-600">
                If anything in your life has changed, update it here so your
                coaching stays relevant.
              </p>
              <Link
                href="/life-context"
                className="inline-block rounded-md border px-5 py-2 text-sm font-semibold hover:bg-black hover:text-white transition"
              >
                Update Life Context
              </Link>
            </div>
          </section>
        </main>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
