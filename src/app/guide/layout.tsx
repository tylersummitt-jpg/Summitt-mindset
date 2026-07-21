import type { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { redirectIfOnboardingIncomplete } from "@/lib/onboarding-incomplete-redirect";
import { isNativeSummittMindsetIosRequest } from "@/lib/native-app/is-native-summitt-mindset-ios-request";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

function isSubscribedFromMetadata(md: Record<string, unknown>) {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;

  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

export default async function GuideLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await currentUser();
  const isNativeIos = await isNativeSummittMindsetIosRequest();

  if (!user) {
    redirect(signInPathForClient(isNativeIos));
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;

  if (!isSubscribedFromMetadata(md)) {
    redirect(inactiveMembershipRedirectPath(isNativeIos));
  }

  await redirectIfOnboardingIncomplete(user.id, md);

  return <>{children}</>;
}
