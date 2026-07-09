import { Suspense } from "react";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { SMS_DAILY_PRODUCTION_SEND_SLOT } from "@/lib/tyler-text-overview-types";

import TylerTextOverviewDashboard from "../tyler-text-overview-dashboard";

export default async function AdminTylerTextOverviewMorningPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Morning Text Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Review and edit current morning drafts. Morning SMS sends only from an authorized current
          draft.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">Loading drafts…</p>}>
        <TylerTextOverviewDashboard sendSlot={SMS_DAILY_PRODUCTION_SEND_SLOT} />
      </Suspense>
    </div>
  );
}
