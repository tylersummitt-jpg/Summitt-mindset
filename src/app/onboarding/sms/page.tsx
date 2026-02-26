import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import SmsClient from "./sms-client";

/**
 * ======================================================
 * SMS Consent Step (Twilio-facing Compliance Screen)
 * ======================================================
 *
 * CANONICAL RULE:
 * - No SMS schedule selection.
 * - SMS always sends at 8:00 AM local time.
 */

export const dynamic = "force-dynamic";

export default async function SmsPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const hasTrainingThemes =
    Array.isArray(md?.trainingThemes) && md.trainingThemes.length > 0;

  if (!hasTrainingThemes) {
    redirect("/onboarding/training-focus");
  }

  return (
    <div>
      <OnboardingProgress currentStep={4} />

      <h1 className="text-3xl font-bold mb-4">
        Daily SMS is part of training.
      </h1>

      <p className="text-gray-600 mb-10">
        Most members use text as their primary way to stay consistent.
        <br />
        <strong>Texts arrive at 8:00 AM in your local time zone.</strong>
      </p>

      <SmsClient />
    </div>
  );
}