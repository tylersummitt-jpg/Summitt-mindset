import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

export const dynamic = "force-dynamic";

export default async function OnboardingPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = user.publicMetadata as Record<string, unknown> | undefined;
  const isSubscribed = isSubscribedFromPublicMetadata(md);

  // 🚨 HARD GATE: Must subscribe first
  if (!isSubscribed) {
    redirect("/subscribe?from=onboarding");
  }

  // If onboarding already complete → dashboard (commitment / SMS home)
  if (md && typeof md === "object" && md.onboardingCompleted === true) {
    redirect("/dashboard");
  }

  return (
    <div className="text-center space-y-12">
      <header className="space-y-5">
        <h1 className="text-3xl sm:text-4xl font-bold">
          You’re in the right place.
        </h1>

        <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl mx-auto">
          A few honest answers will help Coach Pat personalize your daily accountability.
        </p>

        <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl mx-auto">
          You don’t need perfect answers. Short, real ones are enough.
        </p>
      </header>

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
          Start Setup
        </Link>
      </div>

      <p className="text-xs text-gray-500">Takes about 2–3 minutes.</p>
    </div>
  );
}
