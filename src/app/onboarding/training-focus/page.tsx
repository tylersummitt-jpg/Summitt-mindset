import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import TrainingFocusClient from "./training-focus-client";
import OnboardingProgress from "@/components/onboarding-progress";

export const dynamic = "force-dynamic";

export default async function TrainingFocusPage(): Promise<ReactElement> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const hasMissPlan =
    typeof md?.onboardingMissPlan === "string" && md.onboardingMissPlan.length > 0;

  if (!hasMissPlan) {
    redirect("/onboarding/miss-plan");
  }

  return (
    <div>
      <OnboardingProgress currentStep={5} />

      <h1 className="text-3xl font-bold mb-3">
        Coach Pat will train these into you.
      </h1>

      <p className="text-gray-600 mb-10">
        Pick <strong>three</strong>. These shape your first 30 days.
      </p>

      <TrainingFocusClient />
    </div>
  );
}
