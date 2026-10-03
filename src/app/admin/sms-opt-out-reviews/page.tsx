import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import SmsOptOutReviewsDashboard from "./sms-opt-out-reviews-dashboard";

export default async function SmsOptOutReviewsPage({
  searchParams,
}: {
  searchParams?: Promise<{ message_sid?: string | string[] }>;
}) {
  await requireTylerAdmin();
  const resolved = searchParams ? await searchParams : {};
  const raw = resolved.message_sid;
  const highlightMessageSid = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">SMS Opt-Out Reviews</h1>
        <p className="mt-2 text-sm text-gray-600">
          Someone may want the automatic texts to stop. Morning, Evening, and Weekly
          stay held until you choose.
        </p>
      </div>
      <SmsOptOutReviewsDashboard highlightMessageSid={highlightMessageSid} />
    </div>
  );
}
