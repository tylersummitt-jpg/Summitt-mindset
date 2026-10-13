import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { HostedTestReturnClient } from "@/app/checkout/hosted-test/return/hosted-test-return-client";
import { CHECKOUT_BINDING_COOKIE } from "@/lib/stripe-first-checkout/constants";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Finishing checkout",
};

export default async function HostedCheckoutReturnPage() {
  const jar = await cookies();
  if (!hostedCompletionBrowserPresent(jar.get(CHECKOUT_BINDING_COOKIE)?.value)) {
    notFound();
  }
  return (
    <Suspense fallback={<div className="px-6 py-16 text-sm text-gray-700">Loading checkout…</div>}>
      <HostedTestReturnClient />
    </Suspense>
  );
}
