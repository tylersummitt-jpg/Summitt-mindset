import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import MissPlanClient from "./miss-plan-client";

export default async function MissPlanPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const hasSchedule =
    typeof md?.onboardingPracticeTimeOfDay === "string";

  if (!hasSchedule) {
    redirect("/onboarding/schedule");
  }

  return (
    <div>
      <OnboardingProgress currentStep={4} />

      <h1 className="text-3xl font-bold mb-4">
        If you miss, what’s your reset plan?
      </h1>

      <p className="text-gray-600 mb-10">
        Missing happens. Reset quickly. No catching up.
      </p>

      <MissPlanClient />
    </div>
  );
}
