import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import TylerTextOverviewDashboard from "./tyler-text-overview-dashboard";

export default async function AdminTylerTextOverviewPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Tyler Text Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Review machine drafts and edit the text that will send. Writer notebooks are stored
          exactly as OpenAI received them — never rebuilt here.
        </p>
      </div>

      <TylerTextOverviewDashboard />
    </div>
  );
}
