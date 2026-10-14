import { NextResponse } from "next/server";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import {
  deletePersonalVideoRow,
  getPersonalVideo,
  markPersonalVideoSent,
  updatePersonalVideoStatus,
} from "@/lib/personal-videos/store";
import {
  deletePersonalVimeoVideo,
  readPersonalVimeoVideo,
  repairPersonalVideoPoster,
} from "@/lib/personal-videos/vimeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function denied() {
  if (await isTylerOwnerSession()) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function payload(video: {
  id: string;
  status: string;
  createdAt: string;
  watchPath: string | null;
  linkSentAt: string | null;
}) {
  return {
    id: video.id,
    status: video.status,
    createdAt: video.createdAt,
    watchPath: video.watchPath,
    linkSentAt: video.linkSentAt,
  };
}

export async function GET(_request: Request, context: Context) {
  const block = await denied();
  if (block) return block;
  const { id } = await context.params;
  const existing = await getPersonalVideo(id).catch(() => null);
  if (!existing) return NextResponse.json({ error: "missing" }, { status: 404 });
  if (existing.status === "failed") {
    return NextResponse.json(payload(existing), { headers: { "Cache-Control": "no-store" } });
  }
  if (existing.status === "ready") {
    await repairPersonalVideoPoster(existing.vimeoVideoId).catch(() => false);
    return NextResponse.json(payload(existing), { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const next = await readPersonalVimeoVideo(existing.vimeoVideoId);
    const updated =
      next === existing.status ? existing : await updatePersonalVideoStatus(existing.id, next);
    return NextResponse.json(payload(updated ?? existing), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(payload(existing), { headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request, context: Context) {
  const block = await denied();
  if (block) return block;
  const body = (await request.json().catch(() => null)) as { sent?: unknown } | null;
  if (body?.sent !== true) return NextResponse.json({ error: "sent_required" }, { status: 400 });
  const { id } = await context.params;
  const updated = await markPersonalVideoSent(id).catch(() => null);
  if (!updated) return NextResponse.json({ error: "missing" }, { status: 404 });
  return NextResponse.json(payload(updated), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, context: Context) {
  const block = await denied();
  if (block) return block;
  const { id } = await context.params;
  const existing = await getPersonalVideo(id).catch(() => null);
  if (!existing) return NextResponse.json({ error: "missing" }, { status: 404 });
  try {
    await deletePersonalVimeoVideo(existing.vimeoVideoId);
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 503 });
  }
  try {
    await deletePersonalVideoRow(existing.id);
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 503 });
  }
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}
