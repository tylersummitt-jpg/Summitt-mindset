import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { detectSummittMindsetPlatformFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  memberExperiencePlatform,
  recordMemberExperienceEvent,
} from "@/lib/member-experience-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 2048;

function filmIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const filmId = (body as { filmId?: unknown }).filmId;
  if (typeof filmId !== "string") return null;
  const trimmed = filmId.trim();
  if (!trimmed || trimmed.length > 128 || /\s/.test(trimmed)) return null;
  return trimmed;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const user = await currentUser();
  if (!user || user.id !== userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const filmId = filmIdFromBody(parsed);
  if (!filmId) return NextResponse.json({ ok: false }, { status: 400 });
  if (!isSubscribedFromPublicMetadata(user.publicMetadata)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from("film_videos")
    .select("id")
    .eq("id", filmId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  if (!data || data.id !== filmId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const recorded = await recordMemberExperienceEvent({
    clerkUserId: user.id,
    metadata: user.publicMetadata,
    eventType: "film_room_played",
    filmId,
    platform: memberExperiencePlatform(detectSummittMindsetPlatformFromRequest(req)),
  });
  if (recorded.status === "rejected") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (recorded.status === "failed") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
