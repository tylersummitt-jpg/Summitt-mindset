"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useUser,
} from "@clerk/nextjs";

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
    <div className="w-full max-w-sm mx-auto rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
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
  if (pref === "early_morning") return "Early Morning";
  if (pref === "midday") return "Midday";
  if (pref === "morning") return "Morning";
  return "Morning";
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
    <div className="w-full max-w-sm mx-auto space-y-2">
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

function YourProgressCard() {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const rawCurrent = md?.currentDay;
  const rawTotal = md?.totalDaysCompleted;
  const rawStreak = md?.daysInRow;

  let currentDayDisplay: string;
  let totalDisplay: string;
  let phaseDisplay: string;
  let showStreakRow = false;
  let streakDisplay: string;

  if (!isLoaded) {
    currentDayDisplay = "—";
    totalDisplay = "—";
    phaseDisplay = "—";
    streakDisplay = "";
  } else {
    const resolvedCurrent =
      typeof rawCurrent === "number" ? rawCurrent : 1;
    currentDayDisplay = String(resolvedCurrent);
    totalDisplay = String(
      typeof rawTotal === "number" ? rawTotal : 0
    );
    phaseDisplay =
      resolvedCurrent <= 30 ? "Training Camp" : "In Season";
    if (typeof rawStreak === "number" && rawStreak >= 2) {
      showStreakRow = true;
      streakDisplay = String(rawStreak);
    } else {
      streakDisplay = "";
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Current Day</span>
        <span className="font-medium text-gray-900">{currentDayDisplay}</span>
      </div>
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Total Completed</span>
        <span className="font-medium text-gray-900">{totalDisplay}</span>
      </div>
      {showStreakRow ? (
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Days in a Row</span>
          <span className="font-medium text-gray-900">{streakDisplay}</span>
        </div>
      ) : null}
      <div className="flex justify-between gap-4 py-1">
        <span className="text-gray-600">Phase</span>
        <span className="font-medium text-gray-900">{phaseDisplay}</span>
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  return (
    <>
      <SignedIn>
        <main className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-16">
          {/* ✅ Membership Management */}
          <section className="text-center space-y-3">
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="text-sm text-gray-600">
              Manage your membership, billing, and profile settings.
            </p>

            <MembershipStatusCard />

            <TextMessagesCard />

            <YourProgressCard />

            <ManageMembershipButton />

            <p className="mt-4 text-xs text-gray-500 text-center max-w-sm mx-auto">
              We&apos;re here if you need anything — Support@SummittMindset.com
            </p>
          </section>

          {/* ✅ Clerk Profile */}
          <div className="w-full max-w-4xl">
            <UserProfile />
          </div>
        </main>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
