import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { listPersonalVideos } from "@/lib/personal-videos/store";
import { PersonalVideosClient } from "./personal-videos-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PersonalVideosPage() {
  if (!(await isTylerOwnerSession())) notFound();
  const recent = await listPersonalVideos().catch(() => null);
  return (
    <PersonalVideosClient
      initialRecent={
        recent?.map((video) => ({
          id: video.id,
          status: video.status,
          createdAt: video.createdAt,
          watchPath: video.watchPath,
        })) ?? null
      }
    />
  );
}
