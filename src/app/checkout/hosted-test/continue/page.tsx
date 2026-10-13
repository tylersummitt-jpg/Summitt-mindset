import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { cookies } from "next/headers";

import { HostedTestContinueClient } from "@/app/checkout/hosted-test/continue/hosted-test-continue-client";
import {
  hostedCheckoutCredentialModeFromEnv,
  hostedCheckoutRequestAuthorized,
} from "@/lib/stripe-first-checkout/credentials";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";
import {
  HOSTED_TEST_ACCESS_COOKIE,
  HOSTED_TEST_CONTINUE_PATH,
} from "@/lib/stripe-first-checkout/constants";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Finish your membership",
};

export default async function HostedCheckoutContinuePage(): Promise<ReactElement> {
  if (hostedCheckoutCredentialModeFromEnv() !== "test") notFound();
  const jar = await cookies();
  if (!hostedCheckoutRequestAuthorized(jar.get(HOSTED_TEST_ACCESS_COOKIE)?.value)) {
    notFound();
  }
  const { userId } = await auth();
  if (!userId) {
    redirect(signInUrlPreservingInternalRedirect(HOSTED_TEST_CONTINUE_PATH));
  }
  return <HostedTestContinueClient />;
}
