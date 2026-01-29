import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import TrainingFocusClient from "./training-focus-client";
import OnboardingProgress from "@/components/onboarding-progress";

export default async function TrainingFocusPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const metadata = user.publicMetadata as any;

  const hasGoal =
    typeof metadata?.summittGoal === "string" &&
    metadata.summittGoal.length > 0;

  if (!hasGoal) redirect("/onboarding/goal");

  return (
    <div>
      <OnboardingProgress currentStep={2} />

      <h1 className="text-3xl font-bold mb-3">
        Coach Pat will train these into you.
      </h1>

      <p className="text-gray-600 mb-10">
        Pick <strong>five</strong>. These become your focus for the next 30 days.
      </p>

      <TrainingFocusClient />
    </div>
  );
}
