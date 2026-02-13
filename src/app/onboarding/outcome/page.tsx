import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import OutcomeClient from "./outcome-client";

export default async function OutcomePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const arena =
    typeof md?.onboardingArena === "string" ? md.onboardingArena : null;

  if (!arena) {
    redirect("/onboarding/goal");
  }

  return (
    <div>
      <OnboardingProgress currentStep={2} />

      <h1 className="text-3xl font-bold mb-4">
        What would stronger look like in 30 days?
      </h1>

      <p className="text-gray-600 mb-10">
        Pick one. This becomes the outcome we train toward.
      </p>

      <OutcomeClient arena={arena} />
    </div>
  );
}
