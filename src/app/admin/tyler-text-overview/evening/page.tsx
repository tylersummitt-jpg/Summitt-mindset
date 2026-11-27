import { Suspense } from "react";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

import TylerTextOverviewDashboard from "../tyler-text-overview-dashboard";

export default async function AdminTylerTextOverviewEveningPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Evening Text Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Review the Evening batch. Generation and delivery run automatically at each member&apos;s
          saved local time. Review is optional, and saving an edit does not send a text.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">Loading drafts…</p>}>
        <TylerTextOverviewDashboard sendSlot={SMS_DAILY_EVENING_PREVIEW_SEND_SLOT} />
      </Suspense>
    </div>
  );
}
