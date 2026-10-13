import type { ReactElement } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { isTylerAdminSession } from "@/lib/auth/require-tyler-admin";
import { hostedTestAccessCookieIsValid } from "@/lib/stripe-first-checkout/access-token";
import { HOSTED_TEST_ACCESS_COOKIE } from "@/lib/stripe-first-checkout/constants";
import { hostedCheckoutCredentialModeFromEnv } from "@/lib/stripe-first-checkout/credentials";
import { auth } from "@clerk/nextjs/server";
import {
  HostedTestEnable,
  HostedTestStart,
} from "@/app/checkout/hosted-test/hosted-test-client";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Hosted checkout test",
};

export default async function HostedCheckoutTestPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}): Promise<ReactElement> {
  const mode = hostedCheckoutCredentialModeFromEnv();
  const admin = await isTylerAdminSession();
  if (mode !== "test") {
    if (!admin) notFound();
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Hosted checkout test</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          This deployment is not using Stripe test credentials and the development
          Clerk instance. Checkout stays closed.
        </p>
      </div>
    );
  }

  const jar = await cookies();
  const allowed = hostedTestAccessCookieIsValid(
    jar.get(HOSTED_TEST_ACCESS_COOKIE)?.value,
    process.env.CLERK_SECRET_KEY ?? ""
  );
  if (!allowed && !admin) notFound();
  if (!allowed) return <HostedTestEnable />;

  const params = await searchParams;
  const { userId } = await auth();
  return <HostedTestStart canceled={params.canceled === "1"} signedIn={Boolean(userId)} />;
}
