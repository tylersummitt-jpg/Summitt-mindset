import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { listPersonalVideos } from "@/lib/personal-videos/store";
import { repairReadyPersonalVideoPosters } from "@/lib/personal-videos/vimeo";
import { PersonalVideosClient } from "./personal-videos-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PersonalVideosPage() {
  if (!(await isTylerOwnerSession())) notFound();
  const recent = await listPersonalVideos().catch(() => null);
  if (recent) {
    await repairReadyPersonalVideoPosters(
      recent.filter((video) => video.status === "ready").map((video) => video.vimeoVideoId)
    ).catch(() => undefined);
  }
  return (
    <PersonalVideosClient
      initialRecent={
        recent?.map((video) => ({
          id: video.id,
          status: video.status,
          createdAt: video.createdAt,
          watchPath: video.watchPath,
          linkSentAt: video.linkSentAt,
        })) ?? null
      }
    />
  );
}
