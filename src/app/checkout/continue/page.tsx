import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { HostedTestContinueClient } from "@/app/checkout/hosted-test/continue/hosted-test-continue-client";
import {
  CHECKOUT_BINDING_COOKIE,
  PUBLIC_CHECKOUT_CONTINUE_PATH,
} from "@/lib/stripe-first-checkout/constants";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Finish your membership",
};

export default async function PublicCheckoutContinuePage(): Promise<ReactElement> {
  const jar = await cookies();
  if (!hostedCompletionBrowserPresent(jar.get(CHECKOUT_BINDING_COOKIE)?.value)) {
    notFound();
  }
  const { userId } = await auth();
  if (!userId) {
    redirect(signInUrlPreservingInternalRedirect(PUBLIC_CHECKOUT_CONTINUE_PATH));
  }
  return <HostedTestContinueClient linkPath="/api/checkout/stripe-first/link" />;
}
