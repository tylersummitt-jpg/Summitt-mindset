import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import WorkClient from "./work-client";

export const dynamic = "force-dynamic";

export default async function WorkPage(): Promise<ReactElement> {
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
      <OnboardingProgress currentStep={3} />

      <h1 className="text-3xl font-bold mb-4">Let’s talk about responsibility.</h1>

      <p className="text-gray-600 mb-10">
        The pressure on your shoulders shapes your day. Coach Pat should know what
        you’re carrying.
      </p>

      <WorkClient />
    </div>
  );
}