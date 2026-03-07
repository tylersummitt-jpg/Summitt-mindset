import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

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

export default async function OnboardingPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;
  const isSubscribed = isSubscribedFromMetadata(md);

  // 🚨 HARD GATE: Must subscribe first
  if (!isSubscribed) {
    redirect("/subscribe?from=onboarding");
  }

  // If onboarding already complete → go to today
  if (md?.onboardingCompleted === true) {
    const currentDay =
      typeof md?.currentDay === "number" && md.currentDay > 0
        ? md.currentDay
        : 1;

    redirect(`/dashboard/day/${currentDay}`);
  }

  return (
    <div className="text-center space-y-12">
      <header className="space-y-5">
        <h1 className="text-3xl sm:text-4xl font-bold">
          You’re in the right place.
        </h1>

        <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl mx-auto">
          Summitt Mindset is a calm daily system built around one thing:{" "}
          <strong>Coach Pat guiding you one day at a time.</strong>
        </p>

        <p className="text-gray-600">
          We’ll ask a few questions first so Coach Pat can coach you like she
          actually knows you.
        </p>
      </header>

      <section className="border rounded-xl bg-white shadow-sm p-6 sm:p-8 text-left space-y-4">
        <p className="font-semibold text-gray-900">Here’s how it works:</p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>One daily practice (3–7 minutes).</li>
          <li>One honest reflection.</li>
          <li>Coach Pat guides you quietly.</li>
          <li>No catching up. No guilt. Just today.</li>
        </ul>
      </section>

      {/* ORANGE BRAND BUTTON — BOX STYLE */}
      <div className="flex justify-center">
        <Link
          href="/onboarding/identity"
          className="
            block
            w-full
            sm:w-auto
            sm:min-w-[320px]
            text-center
            whitespace-nowrap
            px-10
            py-4
            rounded-xl
            font-semibold
            text-base
            sm:text-lg
            leading-tight
            tracking-wide
            shadow-md
            transition
            duration-200
            focus:outline-none
            focus:ring-4
            hover:opacity-95
            active:opacity-90
          "
          style={{
            backgroundColor: "var(--brand)",
            color: "#ffffff",
            boxShadow: "0 10px 30px rgba(249,115,22,0.22)",
          }}
        >
          → Start Setup →
        </Link>
      </div>

      <p className="text-xs text-gray-500">
        Short answers are perfect. This takes 2–3 minutes.
      </p>
    </div>
  );
}