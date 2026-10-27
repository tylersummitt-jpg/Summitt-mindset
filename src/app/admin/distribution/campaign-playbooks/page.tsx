import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { listPersonalVideos } from "@/lib/personal-videos/store";

import CampaignPlaybooksDashboard from "./campaign-playbooks-dashboard";

export const dynamic = "force-dynamic";

export default async function CampaignPlaybooksPage() {
  if (!(await isTylerOwnerSession())) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Campaign playbooks</h1>
        <p className="mt-3 text-sm text-gray-800">This configuration is limited to the account owner.</p>
      </main>
    );
  }
  const videos = await listPersonalVideos().catch(() => []);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Campaign playbooks</h1>
      <p className="text-sm text-gray-700">
        Instantly sends the opening sequence. This page controls what happens after a reply. Saving a playbook does not authorize automated replies or fulfillment. Activate one campaign when those sends should run. Global automation, conversation sending, unsubscribe, and the blocklist still apply. Instantly stop-on-reply stays unverified until it is confirmed in Instantly.
      </p>
      <CampaignPlaybooksDashboard
        videos={videos.map((video) => ({ id: video.id, status: video.status, createdAt: video.createdAt }))}
      />
    </main>
  );
}
