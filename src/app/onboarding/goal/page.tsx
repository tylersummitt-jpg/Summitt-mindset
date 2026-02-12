import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import GoalClient from "./goal-client";
import OnboardingProgress from "@/components/onboarding-progress";

export default async function GoalPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  return (
    <div>
      <OnboardingProgress currentStep={1} />

      <h1 className="text-3xl font-bold mb-4">
        What summit are you climbing right now?
      </h1>

      <p className="text-gray-600 mb-10">
        Pick one focus. We’ll build your Training Camp around it.
      </p>

      <GoalClient />
    </div>
  );
}
