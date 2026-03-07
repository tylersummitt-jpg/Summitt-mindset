import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import PressureClient from "./pressure-client";

export const dynamic = "force-dynamic";

export default async function PressurePage(): Promise<ReactElement> {
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
      <OnboardingProgress currentStep={5} />

      <h1 className="text-3xl font-bold mb-4">Let Coach Pat see both the weight and the strength.</h1>

      <p className="text-gray-600 mb-10">
        Pressure matters. So does what you have already handled well.
      </p>

      <PressureClient />
    </div>
  );
}