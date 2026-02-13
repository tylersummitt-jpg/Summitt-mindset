import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ArenaClient from "./goal-client";
import OnboardingProgress from "@/components/onboarding-progress";

export const dynamic = "force-dynamic";

export default async function ArenaPage(): Promise<ReactElement> {
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
        Where do you want Coach Pat to focus first?
      </h1>

      <p className="text-gray-600 mb-10">
        Pick one arena. This becomes your lens for Training Camp.
      </p>

      <ArenaClient />
    </div>
  );
}
