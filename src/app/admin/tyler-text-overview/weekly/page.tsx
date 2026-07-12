import { Suspense } from "react";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import TylerTextOverviewWeeklyDashboard from "../tyler-text-overview-weekly-dashboard";

export default async function AdminTylerTextOverviewWeeklyPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Weekly Text Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Review and edit weekly_review drafts. This page does not send. Live weekly SMS still
          comes from /api/cron/weekly-sms until cutover.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">Loading drafts…</p>}>
        <TylerTextOverviewWeeklyDashboard />
      </Suspense>
    </div>
  );
}
