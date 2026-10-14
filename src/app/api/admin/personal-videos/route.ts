import { NextResponse } from "next/server";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { isPersonalVideoByteSize, newPersonalVideoToken } from "@/lib/personal-videos/personal-video";
import { insertPersonalVideo, listPersonalVideos } from "@/lib/personal-videos/store";
import { createPersonalVimeoUpload, deletePersonalVimeoVideo } from "@/lib/personal-videos/vimeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forbidden() {
  if (await isTylerOwnerSession()) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function publicVideo(video: {
  id: string;
  status: string;
  createdAt: string;
  watchPath: string | null;
}) {
  return {
    id: video.id,
    status: video.status,
    createdAt: video.createdAt,
    watchPath: video.watchPath,
  };
}

export async function GET() {
  const denied = await forbidden();
  if (denied) return denied;
  try {
    const videos = await listPersonalVideos();
    return NextResponse.json(
      { videos: videos.map(publicVideo) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await forbidden();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { byteSize?: unknown } | null;
  if (!isPersonalVideoByteSize(body?.byteSize)) {
    return NextResponse.json({ error: "invalid_video" }, { status: 400 });
  }
  let created: { vimeoId: string; uploadLink: string };
  try {
    created = await createPersonalVimeoUpload(body.byteSize);
  } catch {
    return NextResponse.json({ error: "upload_unavailable" }, { status: 503 });
  }
  try {
    const video = await insertPersonalVideo({
      publicToken: newPersonalVideoToken(),
      vimeoVideoId: created.vimeoId,
    });
    return NextResponse.json(
      { id: video.id, uploadLink: created.uploadLink },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    await deletePersonalVimeoVideo(created.vimeoId).catch(() => undefined);
    return NextResponse.json({ error: "save_failed" }, { status: 503 });
  }
}
