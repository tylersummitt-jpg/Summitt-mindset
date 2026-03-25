import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import HealthClient from "./health-client";

export const dynamic = "force-dynamic";

export default async function HealthPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  return (
    <div>
      <OnboardingProgress currentStep={4} />

      <h1 className="text-3xl font-bold mb-4">Health and energy matter here too.</h1>

      <p className="text-gray-600 mb-10">
        Coach Pat is not only coaching your goals. She is coaching the person trying
        to carry them.
      </p>

      <HealthClient />
    </div>
  );
}