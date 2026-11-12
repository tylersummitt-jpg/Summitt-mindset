import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { HostedTestReturnClient } from "@/app/checkout/hosted-test/return/hosted-test-return-client";
import { CHECKOUT_BINDING_COOKIE } from "@/lib/stripe-first-checkout/constants";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";
import { recordCheckoutReturn } from "@/lib/stripe-first-checkout/signup-diagnostics";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Finishing checkout",
};

export default async function PublicCheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>;
}) {
  const jar = await cookies();
  const binding = jar.get(CHECKOUT_BINDING_COOKIE)?.value;
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
  await recordCheckoutReturn({ bindingCookie: binding, sessionId });
  if (!hostedCompletionBrowserPresent(binding)) {
    notFound();
  }
  return (
    <Suspense fallback={<div className="px-6 py-16 text-sm text-gray-700">Loading checkout…</div>}>
      <HostedTestReturnClient
        activatePath="/api/checkout/stripe-first/activate"
        confirmPath="/api/checkout/stripe-first/confirm-session"
      />
    </Suspense>
  );
}
