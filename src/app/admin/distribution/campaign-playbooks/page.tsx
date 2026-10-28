import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { listPersonalVideos } from "@/lib/personal-videos/store";

import CampaignPlaybooksDashboard from "./campaign-playbooks-dashboard";

export const dynamic = "force-dynamic";

export default async function CampaignPlaybooksPage() {
  if (!(await isTylerOwnerSession())) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Campaign playbooks</h1>
        <p className="mt-3 text-sm text-gray-800">This configuration is limited to the account owner.</p>
      </main>
    );
  }
  const videos = await listPersonalVideos().catch(() => []);
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Campaign playbooks</h1>
      <p className="text-sm text-gray-700">
        Find the campaign by its Instantly name, confirm the audience and offer, then read the checklist before turning on post-reply automation. Instantly sends the cold email. This page does not. Saving a playbook does not send mail.
      </p>
      <CampaignPlaybooksDashboard
        videos={videos.map((video) => ({ id: video.id, status: video.status, createdAt: video.createdAt }))}
      />
    </main>
  );
}
