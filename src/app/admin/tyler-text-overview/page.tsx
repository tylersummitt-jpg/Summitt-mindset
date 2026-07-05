import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import TylerTextOverviewDashboard from "./tyler-text-overview-dashboard";

export default async function AdminTylerTextOverviewPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Tyler Text Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Shows the persisted primary writer input for each current draft generation. Skipped
          writers, no-send drafts, and stale generation pointers are labeled explicitly.
        </p>
      </div>

      <TylerTextOverviewDashboard />
    </div>
  );
}
