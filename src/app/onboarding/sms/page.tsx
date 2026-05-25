import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import SmsClient from "./sms-client";

/**
 * SMS Consent Step (Twilio-facing Compliance Screen)
 * CANONICAL: No SMS schedule selection; fixed morning send time in API.
 */

export const dynamic = "force-dynamic";

export default async function SmsPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  await requireOnboardingSobPath(user.id, md, "/onboarding/sms");

  return (
    <div>
      <OnboardingProgress currentStep={4} />

      <h1 className="text-3xl font-bold mb-4">Daily Accountability Texts</h1>

      <p className="text-gray-600 mb-8">
        This is where Summitt Mindset does its best work — short, direct
        accountability over text.
      </p>

      <SmsClient
        initialPhone={typeof md?.phoneNumber === "string" ? md.phoneNumber : null}
        initialConsentAccepted={md?.smsDisclosureAccepted === true ? true : null}
      />
    </div>
  );
}
