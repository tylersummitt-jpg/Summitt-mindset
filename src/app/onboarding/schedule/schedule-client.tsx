import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import ScheduleClient from "./schedule-client";

export const dynamic = "force-dynamic";

export default async function SchedulePage(): Promise<ReactElement> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const hasOutcome =
    typeof md?.onboardingOutcome === "string" && md.onboardingOutcome.length > 0;

  if (!hasOutcome) {
    redirect("/onboarding/outcome");
  }

  return (
    <div>
      <OnboardingProgress currentStep={3} />

      <h1 className="text-3xl font-bold mb-4">
        When will you do your daily practice?
      </h1>

      <p className="text-gray-600 mb-10">
        Pick a consistent time. Small repetition builds momentum.
      </p>

      <ScheduleClient />
    </div>
  );
}


