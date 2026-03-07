import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import RelationshipsClient from "./relationships-client";

export const dynamic = "force-dynamic";

export default async function RelationshipsPage(): Promise<ReactElement> {
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
      <OnboardingProgress currentStep={2} />

      <h1 className="text-3xl font-bold mb-4">Who do you show up for most?</h1>

      <p className="text-gray-600 mb-10">
        Coach Pat leads people, not schedules. The people who matter most in your
        life matter here too.
      </p>

      <RelationshipsClient />
    </div>
  );
}