import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isYoureInVideoEventType,
  YOURE_IN_VIMEO_ID,
  youreInVideoIdempotencyKey,
  type YoureInVideoEventType,
} from "@/lib/youre-in-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 512;
const SOURCE = "member_experience";

function eventFromBody(body: unknown): YoureInVideoEventType | null {
  if (!body || typeof body !== "object") return null;
  const event = (body as { event?: unknown }).event;
  if (!isYoureInVideoEventType(event)) return null;
  return event;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const user = await currentUser();
  if (!user || user.id !== userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isSubscribedFromPublicMetadata(user.publicMetadata)) {
    return NextResponse.json({ ok: false }, { status: 403 });
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
  const event = eventFromBody(parsed);
  if (!event) return NextResponse.json({ ok: false }, { status: 400 });

  const clerkUserId = user.id.trim();
  const { error } = await supabaseServer.from("v2_event").insert({
    idempotency_key: youreInVideoIdempotencyKey(event, clerkUserId),
    clerk_user_id: clerkUserId,
    event_type: event,
    source: SOURCE,
    occurred_at: new Date().toISOString(),
    payload_json: { vimeoVideoId: YOURE_IN_VIMEO_ID },
  });

  if (!error || error.code === "23505") {
    return NextResponse.json({ ok: true });
  }
  console.error("[youre-in-video] write failed", {
    eventType: event,
    code: error.code ?? "unknown",
  });
  return NextResponse.json({ ok: false }, { status: 500 });
}
