import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import IdentityClient from "./identity-client";

export const dynamic = "force-dynamic";

export default async function IdentityPage(): Promise<ReactElement> {
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
      <OnboardingProgress currentStep={1} />

      <h1 className="text-3xl font-bold mb-4">Let’s start with what matters most.</h1>

      <p className="text-gray-600 mb-10">
        Short answers are perfect. Coach Pat does not need polished answers.
        She just needs the truth.
      </p>

      <IdentityClient />
    </div>
  );
}