import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs"; // IMPORTANT: ensures server runtime

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VIMEO_TOKEN = process.env.VIMEO_ACCESS_TOKEN!;

async function fetchThumbnail(vimeoId: string): Promise<string | null> {
  const res = await fetch(`https://api.vimeo.com/videos/${vimeoId}`, {
    headers: {
      Authorization: `Bearer ${VIMEO_TOKEN}`,
      Accept: "application/vnd.vimeo.*+json;version=3.4",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch Vimeo video ${vimeoId}`);
    return null;
  }

  const json = await res.json();
  const sizes = json?.pictures?.sizes;

  if (!Array.isArray(sizes) || sizes.length === 0) return null;

  // Use the largest available thumbnail
  return sizes[sizes.length - 1].link ?? null;
}

export async function POST() {
  try {
    await requireTylerAdmin();
  } catch (err: any) {
    const status = err?.status ?? 401;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  if (!VIMEO_TOKEN) {
    return NextResponse.json(
      { error: "Missing VIMEO_ACCESS_TOKEN" },
      { status: 500 }
    );
  }

  const { data: videos, error } = await supabase
    .from("film_videos")
    .select("id, vimeo_video_id");

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  let updated = 0;

  for (const video of videos ?? []) {
    if (!video.vimeo_video_id) continue;

    const thumbnail = await fetchThumbnail(video.vimeo_video_id);
    if (!thumbnail) continue;

    await supabase
      .from("film_videos")
      .update({ thumbnail_url: thumbnail })
      .eq("id", video.id);

    updated++;
    console.log(`✓ Updated thumbnail for ${video.vimeo_video_id}`);
  }

  return NextResponse.json({
    success: true,
    updated,
    message: "All Vimeo thumbnails fetched and saved.",
  });
}
