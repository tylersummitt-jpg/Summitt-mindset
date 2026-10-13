import { Suspense } from "react";

import { HostedTestReturnClient } from "@/app/checkout/hosted-test/return/hosted-test-return-client";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Finishing checkout",
};

export default function HostedCheckoutReturnPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16 text-sm text-gray-700">Loading checkout…</div>}>
      <HostedTestReturnClient />
    </Suspense>
  );
}
